/**
 * Streaming execution — real-time output from long-running commands.
 *
 * @example
 * ```ts
 * const stream = await caged.sandboxes.execStream(sandbox.id, "npm test");
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk);
 * }
 * console.log("Exit code:", stream.exitCode);
 * ```
 *
 * ## How this works, and why it is not just "send the command"
 *
 * There is no streaming exec endpoint. The only streaming surface is the
 * terminal WebSocket, which attaches a login shell to a PTY and speaks
 * `{"type": "input" | "output" | "resize"}` — and nothing else. It never
 * sends an `exit` message and has no notion of a command's exit code.
 *
 * So this used to send the command into the shell and then wait for a
 * message type the server does not emit: `exitCode` stayed `null` forever
 * and the iterator ended only when the sandbox's idle timeout closed the
 * socket. The output also included the login banner, the shell's own echo of
 * the command, and the prompt.
 *
 * Instead the command is bracketed by two markers carrying a per-call nonce.
 * Everything before the first is dropped (banner, echo), the exit code is
 * read from the second, and the shell is asked to exit, which closes the
 * stream deterministically rather than at a timeout.
 */
import type { WebSocketLike } from "./types";

export class ExecStream implements AsyncIterable<string> {
  private readonly ws: WebSocketLike;
  private readonly filter: MarkerFilter;
  private readonly chunks: string[] = [];
  private readonly waiters: ((value: IteratorResult<string>) => void)[] = [];
  private done = false;
  private failure: Error | null = null;

  /** @internal */
  constructor(ws: WebSocketLike) {
    this.ws = ws;
    const nonce = randomNonce();
    this.filter = new MarkerFilter(
      `__CAGED_BEGIN_${nonce}__`,
      `__CAGED_EXIT_${nonce}__`
    );

    this.ws.addEventListener("message", (event) => {
      const text = messageText(event.data);
      if (text === null) return;
      const [out, finished] = this.filter.feed(text);
      if (out) this.push(out);
      if (finished) this.finish();
    });
    this.ws.addEventListener("close", () => this.finish());
    this.ws.addEventListener("error", () =>
      this.fail(new Error("WebSocket error during exec"))
    );
  }

  /** @internal Drives the command through the shell. */
  start(command: string): void {
    for (const line of this.filter.shellLines(command)) {
      this.ws.send(JSON.stringify({ type: "input", data: line }));
    }
  }

  /**
   * The command's exit code, once the stream has completed.
   *
   * `null` while it is still running, and also if the connection dropped
   * before the command finished — in which case the exit status is genuinely
   * unknown rather than zero.
   */
  get exitCode(): number | null {
    return this.filter.exitCode;
  }

  /** Close the stream, abandoning the command. */
  kill(): void {
    this.ws.close();
    this.finish();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    for (;;) {
      if (this.chunks.length > 0) {
        yield this.chunks.shift() as string;
        continue;
      }
      if (this.failure) throw this.failure;
      if (this.done) return;

      const result = await new Promise<IteratorResult<string>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (result.done) {
        if (this.failure) throw this.failure;
        return;
      }
      yield result.value;
    }
  }

  /** Collect all output as a single string. */
  async text(): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this) parts.push(chunk);
    return parts.join("");
  }

  private push(data: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: data, done: false });
      return;
    }
    this.chunks.push(data);
  }

  private finish(): void {
    if (this.done) return;
    // Whatever the filter is still holding back is output the user saw. It
    // used to be dropped, which lost the tail of every interrupted command.
    const tail = this.filter.flush();
    if (tail) this.push(tail);
    this.done = true;
    this.drainWaiters();
    // The shell has exited, or the socket has gone; either way the
    // connection is finished with.
    try {
      this.ws.close();
    } catch {
      // Already shutting down.
    }
  }

  private fail(err: Error): void {
    this.failure = err;
    this.done = true;
    this.drainWaiters();
  }

  private drainWaiters(): void {
    for (const waiter of this.waiters) {
      waiter({ value: undefined as unknown as string, done: true });
    }
    this.waiters.length = 0;
  }
}

/** Pull the output text out of one terminal protocol message. */
function messageText(data: unknown): string | null {
  if (data === undefined || data === null) return null;
  const text = String(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: the endpoint speaks JSON, but a raw frame is still output
    // rather than something to discard.
    return text;
  }
  if (typeof parsed === "object" && parsed !== null) {
    const msg = parsed as { type?: unknown; data?: unknown };
    if (msg.type === "output") {
      return typeof msg.data === "string" ? msg.data : null;
    }
  }
  return null;
}

function randomNonce(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (crypto?.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return Math.random().toString(16).slice(2).padEnd(16, "0").slice(0, 16);
}

/**
 * Extracts one command's output and exit code from a shell PTY stream.
 *
 * Separated from the socket so it can be tested directly, including the case
 * that makes naive versions of this wrong: a marker split across two
 * WebSocket messages.
 *
 * @internal
 */
export class MarkerFilter {
  private buf = "";
  private started = false;
  private finished = false;
  private code: number | null = null;
  private readonly keep: number;

  constructor(
    public readonly begin: string,
    public readonly end: string
  ) {
    // Hold back enough characters that a marker straddling two messages is
    // still found, plus room for the exit digits and the newline.
    this.keep = Math.max(begin.length, end.length + 12);
  }

  get exitCode(): number | null {
    return this.code;
  }

  /**
   * The lines to type into the shell to run `command`.
   *
   * Three separate lines, not one: the command is passed through untouched,
   * so a multi-line command (a heredoc, a `for` loop) still works. `$?` then
   * reports the last command's status, which is what a shell means by the
   * status of what it just ran.
   */
  shellLines(command: string): string[] {
    return [
      // Suppress the shell's echo of the lines below, then mark the start of
      // real output. `stty` is absent in some minimal images; a failure
      // there costs an echoed command line, not the command.
      `stty -echo 2>/dev/null; printf '%s\\n' '${this.begin}'\n`,
      command.endsWith("\n") ? command : command + "\n",
      `__caged_rc=$?; printf '%s%d\\n' '${this.end}' "$__caged_rc"; ` +
        `exit $__caged_rc\n`,
    ];
  }

  /**
   * Consume one chunk of PTY output.
   *
   * Returns the text to hand the caller and whether the command finished.
   */
  feed(chunk: string): [string, boolean] {
    if (this.finished) return ["", true];
    this.buf += chunk;

    if (!this.started) {
      const index = this.buf.indexOf(this.begin);
      if (index < 0) {
        if (this.buf.length > this.keep) {
          this.buf = this.buf.slice(-this.keep);
        }
        return ["", false];
      }
      this.buf = this.buf
        .slice(index + this.begin.length)
        .replace(/^[\r\n]+/, "");
      this.started = true;
    }

    const index = this.buf.indexOf(this.end);
    if (index < 0) {
      if (this.buf.length <= this.keep) return ["", false];
      const out = this.buf.slice(0, this.buf.length - this.keep);
      this.buf = this.buf.slice(-this.keep);
      return [out, false];
    }

    const out = this.buf.slice(0, index);
    const tail = this.buf.slice(index + this.end.length);
    const digits = /^\s*(\d+)/.exec(tail);
    if (digits === null) {
      // The marker has arrived but its digits have not. Emit what came
      // before it and wait; the buffer keeps the marker so the next chunk
      // completes it.
      this.buf = this.buf.slice(index);
      return [out, false];
    }
    this.code = Number.parseInt(digits[1], 10);
    this.finished = true;
    this.buf = "";
    return [out, true];
  }

  /**
   * Whatever is still held back when the stream ends unfinished.
   *
   * Output is deliberately held back so a marker straddling two frames is
   * still recognised, which means that at the moment a socket drops, the last
   * few hundred characters the user did see are still in this buffer. A
   * trailing fragment that could be the start of the end marker is not
   * emitted: it is protocol, not output.
   */
  flush(): string {
    if (this.finished || !this.started) {
      this.buf = "";
      return "";
    }
    const out = this.buf;
    this.buf = "";
    for (let cut = this.end.length - 1; cut > 0; cut--) {
      if (out.endsWith(this.end.slice(0, cut))) return out.slice(0, -cut);
    }
    return out;
  }
}

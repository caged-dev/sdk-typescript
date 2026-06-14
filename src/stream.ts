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
 */
export class ExecStream implements AsyncIterable<string> {
  private ws: WebSocket;
  private chunks: string[] = [];
  private done = false;
  private error: Error | null = null;
  private waiters: ((value: IteratorResult<string>) => void)[] = [];
  private _exitCode: number | null = null;

  /** @internal */
  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === "output") {
          this.push(msg.data);
        } else if (msg.type === "exit") {
          this._exitCode = msg.code ?? 0;
          this.finish();
        } else if (msg.type === "error") {
          this.fail(new Error(msg.message || "exec failed"));
        }
      } catch {
        this.push(String(event.data));
      }
    });
    this.ws.addEventListener("close", () => this.finish());
    this.ws.addEventListener("error", () =>
      this.fail(new Error("WebSocket error during exec"))
    );
  }

  /** The exit code (available after stream completes). */
  get exitCode(): number | null {
    return this._exitCode;
  }

  /** Close the stream and kill the process. */
  kill(): void {
    this.ws.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    while (true) {
      if (this.chunks.length > 0) {
        yield this.chunks.shift()!;
        continue;
      }
      if (this.done) return;
      if (this.error) throw this.error;

      // Wait for more data.
      const result = await new Promise<IteratorResult<string>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (result.done) return;
      yield result.value;
    }
  }

  /** Collect all output as a single string. */
  async text(): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this) {
      parts.push(chunk);
    }
    return parts.join("");
  }

  private push(data: string): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter({ value: data, done: false });
    } else {
      this.chunks.push(data);
    }
  }

  private finish(): void {
    this.done = true;
    for (const waiter of this.waiters) {
      waiter({ value: undefined as any, done: true });
    }
    this.waiters = [];
  }

  private fail(err: Error): void {
    this.error = err;
    this.done = true;
    for (const waiter of this.waiters) {
      waiter({ value: undefined as any, done: true });
    }
    this.waiters = [];
  }
}

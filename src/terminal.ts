/**
 * WebSocket-based terminal session for interactive PTY access to a sandbox.
 *
 * @example
 * ```ts
 * const terminal = await caged.sandboxes.terminal(sandbox.id);
 * terminal.onOutput((data) => process.stdout.write(data));
 * terminal.send("ls -la\n");
 * // Later...
 * terminal.close();
 * ```
 */
import { CagedError } from "./errors";
import type { WebSocketLike } from "./types";

export class TerminalSession {
  private readonly ws: WebSocketLike;
  private readonly outputHandlers: ((data: string) => void)[] = [];
  private readonly closeHandlers: (() => void)[] = [];
  private readonly errorHandlers: ((err: Error) => void)[] = [];
  private isClosed = false;

  /** @internal */
  constructor(ws: WebSocketLike) {
    this.ws = ws;
    this.ws.addEventListener("message", (event) => {
      const data = event.data;
      if (data === undefined || data === null) return;
      const text = String(data);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Raw frame: still output.
        this.emit(text);
        return;
      }
      if (typeof parsed === "object" && parsed !== null) {
        const msg = parsed as { type?: unknown; data?: unknown };
        if (msg.type === "output" && typeof msg.data === "string" && msg.data) {
          this.emit(msg.data);
        }
      }
    });
    this.ws.addEventListener("close", () => {
      this.isClosed = true;
      for (const handler of this.closeHandlers) handler();
    });
    this.ws.addEventListener("error", () => {
      const err = new CagedError("WebSocket error on the terminal session");
      for (const handler of this.errorHandlers) handler(err);
    });
  }

  /** Send input to the terminal (include `\n` for Enter). */
  send(input: string): void {
    if (this.isClosed) {
      throw new CagedError("Terminal session is closed");
    }
    this.ws.send(JSON.stringify({ type: "input", data: input }));
  }

  /** Resize the terminal. */
  resize(rows: number, cols: number): void {
    if (this.isClosed) return;
    this.ws.send(JSON.stringify({ type: "resize", rows, cols }));
  }

  /** Register a handler for terminal output. */
  onOutput(handler: (data: string) => void): void {
    this.outputHandlers.push(handler);
  }

  /** Register a handler for close events. */
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  /** Register a handler for errors. */
  onError(handler: (err: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  /** Whether the session is closed. */
  get closed(): boolean {
    return this.isClosed;
  }

  /** Close the terminal session. */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.ws.close();
  }

  private emit(data: string): void {
    for (const handler of this.outputHandlers) handler(data);
  }
}

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
export class TerminalSession {
  private ws: WebSocket;
  private outputHandlers: ((data: string) => void)[] = [];
  private closeHandlers: (() => void)[] = [];
  private errorHandlers: ((err: Error) => void)[] = [];
  private _closed = false;

  /** @internal */
  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === "output" && msg.data) {
          for (const handler of this.outputHandlers) {
            handler(msg.data);
          }
        }
      } catch {
        // Raw text fallback.
        for (const handler of this.outputHandlers) {
          handler(String(event.data));
        }
      }
    });
    this.ws.addEventListener("close", () => {
      this._closed = true;
      for (const handler of this.closeHandlers) handler();
    });
    this.ws.addEventListener("error", (event) => {
      const err = new Error("WebSocket error");
      for (const handler of this.errorHandlers) handler(err);
    });
  }

  /** Send input to the terminal (include \n for Enter). */
  send(input: string): void {
    if (this._closed) throw new Error("Terminal session is closed");
    this.ws.send(JSON.stringify({ type: "input", data: input }));
  }

  /** Resize the terminal. */
  resize(rows: number, cols: number): void {
    if (this._closed) return;
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
    return this._closed;
  }

  /** Close the terminal session. */
  close(): void {
    if (!this._closed) {
      this._closed = true;
      this.ws.close();
    }
  }
}

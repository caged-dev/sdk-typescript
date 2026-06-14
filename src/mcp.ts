/**
 * MCP (Model Context Protocol) client for interacting with sandbox tools.
 *
 * @example
 * ```ts
 * const mcp = await caged.sandboxes.mcp(sandbox.id);
 *
 * // List available tools
 * const tools = await mcp.listTools();
 *
 * // Call a tool
 * const result = await mcp.callTool("terminal_exec", { command: "npm test" });
 * console.log(result.content[0].text);
 *
 * mcp.close();
 * ```
 */
export class MCPClient {
  private ws: WebSocket;
  private _closed = false;
  private requestId = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: any) => void }
  >();
  private notificationHandlers: ((method: string, params: any) => void)[] = [];
  private closeHandlers: (() => void)[] = [];

  /** @internal */
  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new MCPError(msg.error.code, msg.error.message));
          } else {
            resolve(msg.result);
          }
        } else if (!msg.id && msg.method) {
          // Notification from server.
          for (const handler of this.notificationHandlers) {
            handler(msg.method, msg.params);
          }
        }
      } catch {
        // Ignore malformed messages.
      }
    });
    this.ws.addEventListener("close", () => {
      this._closed = true;
      // Reject all pending requests.
      for (const [, { reject }] of this.pending) {
        reject(new Error("MCP connection closed"));
      }
      this.pending.clear();
      for (const handler of this.closeHandlers) handler();
    });
  }

  /** Initialize the MCP session. Called automatically on connect. */
  async initialize(): Promise<MCPInitializeResult> {
    return this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "@caged-dev/sdk", version: "0.2.0" },
    });
  }

  /** List available tools in the sandbox. */
  async listTools(): Promise<MCPTool[]> {
    const result = await this.request("tools/list", {});
    return result.tools;
  }

  /** Call a tool by name with arguments. */
  async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<MCPToolResult> {
    return this.request("tools/call", { name, arguments: args });
  }

  /** List available resources. */
  async listResources(): Promise<MCPResource[]> {
    const result = await this.request("resources/list", {});
    return result.resources;
  }

  /** Read a resource by URI. */
  async readResource(uri: string): Promise<MCPResourceContent> {
    return this.request("resources/read", { uri });
  }

  /** List available prompts. */
  async listPrompts(): Promise<MCPPrompt[]> {
    const result = await this.request("prompts/list", {});
    return result.prompts;
  }

  /** Get a prompt with arguments. */
  async getPrompt(
    name: string,
    args: Record<string, string> = {}
  ): Promise<MCPPromptResult> {
    return this.request("prompts/get", { name, arguments: args });
  }

  /** Ping the server. */
  async ping(): Promise<void> {
    await this.request("ping", {});
  }

  /** Listen for server notifications (e.g., streaming output). */
  onNotification(handler: (method: string, params: any) => void): void {
    this.notificationHandlers.push(handler);
  }

  /** Register a close handler. */
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  /** Whether the connection is closed. */
  get closed(): boolean {
    return this._closed;
  }

  /** Close the MCP connection. */
  close(): void {
    if (!this._closed) {
      this._closed = true;
      this.ws.close();
    }
  }

  private request(method: string, params: unknown): Promise<any> {
    if (this._closed) {
      return Promise.reject(new Error("MCP connection closed"));
    }

    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(
        JSON.stringify({ jsonrpc: "2.0", id, method, params })
      );
    });
  }
}

/** Error from the MCP server. */
export class MCPError extends Error {
  public readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "MCPError";
    this.code = code;
  }
}

// --- MCP Types ---

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolResult {
  content: MCPContentBlock[];
  isError?: boolean;
}

export interface MCPContentBlock {
  type: string;
  text?: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceContent {
  contents: { uri: string; mimeType?: string; text?: string }[];
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface MCPPromptResult {
  messages: { role: string; content: { type: string; text: string } }[];
}

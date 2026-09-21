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
import { CagedError } from "./errors";
import type { WebSocketLike } from "./types";
import { VERSION } from "./version";

/** Error returned by the MCP server, as a JSON-RPC error object. */
export class MCPError extends CagedError {
  public readonly code: number;

  constructor(code: number, message: string) {
    super(`MCP error ${code}: ${message}`);
    this.name = "MCPError";
    this.code = code;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class MCPClient {
  private readonly ws: WebSocketLike;
  private readonly pending = new Map<number, Pending>();
  private readonly notificationHandlers: ((
    method: string,
    params: unknown
  ) => void)[] = [];
  private readonly closeHandlers: (() => void)[] = [];
  private isClosed = false;
  private requestId = 0;

  /** @internal */
  constructor(ws: WebSocketLike) {
    this.ws = ws;
    this.ws.addEventListener("message", (event) => {
      const data = event.data;
      if (data === undefined || data === null) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return; // Malformed frame.
      }
      if (typeof parsed !== "object" || parsed === null) return;
      this.dispatch(parsed as Record<string, unknown>);
    });
    this.ws.addEventListener("close", () => {
      this.isClosed = true;
      this.failPending(new MCPError(-1, "MCP connection closed"));
      for (const handler of this.closeHandlers) handler();
    });
  }

  /** Initialize the MCP session. Called for you by `caged.sandboxes.mcp()`. */
  async initialize(): Promise<MCPInitializeResult> {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      // Read from the package version rather than written out again: a
      // hardcoded version here is how the published 0.2.0 came to announce
      // itself as 0.1.0.
      clientInfo: { name: "@caged-dev/sdk", version: VERSION },
    });
    return (result ?? {}) as MCPInitializeResult;
  }

  /** List available tools in the sandbox. */
  async listTools(): Promise<MCPTool[]> {
    const result = await this.request("tools/list", {});
    return listField<MCPTool>(result, "tools");
  }

  /** Call a tool by name with arguments. */
  async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<MCPToolResult> {
    const result = await this.request("tools/call", { name, arguments: args });
    return (result ?? {}) as MCPToolResult;
  }

  /** List available resources. */
  async listResources(): Promise<MCPResource[]> {
    const result = await this.request("resources/list", {});
    return listField<MCPResource>(result, "resources");
  }

  /** Read a resource by URI. */
  async readResource(uri: string): Promise<MCPResourceContent> {
    const result = await this.request("resources/read", { uri });
    return (result ?? {}) as MCPResourceContent;
  }

  /** List available prompts. */
  async listPrompts(): Promise<MCPPrompt[]> {
    const result = await this.request("prompts/list", {});
    return listField<MCPPrompt>(result, "prompts");
  }

  /** Get a prompt with arguments. */
  async getPrompt(
    name: string,
    args: Record<string, string> = {}
  ): Promise<MCPPromptResult> {
    const result = await this.request("prompts/get", {
      name,
      arguments: args,
    });
    return (result ?? {}) as MCPPromptResult;
  }

  /** Ping the server. */
  async ping(): Promise<void> {
    await this.request("ping", {});
  }

  /** Listen for server notifications (e.g. streaming output). */
  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandlers.push(handler);
  }

  /** Register a close handler. */
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  /** Whether the connection is closed. */
  get closed(): boolean {
    return this.isClosed;
  }

  /** Close the MCP connection. */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.failPending(new MCPError(-1, "MCP connection closed"));
    this.ws.close();
  }

  private dispatch(msg: Record<string, unknown>): void {
    const id = msg.id;
    if (typeof id === "number") {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      const error = msg.error;
      if (typeof error === "object" && error !== null) {
        const { code, message } = error as {
          code?: unknown;
          message?: unknown;
        };
        pending.reject(
          new MCPError(
            typeof code === "number" ? code : -1,
            typeof message === "string" ? message : "unknown MCP error"
          )
        );
        return;
      }
      pending.resolve(msg.result);
      return;
    }
    if (typeof msg.method === "string") {
      for (const handler of this.notificationHandlers) {
        handler(msg.method, msg.params);
      }
    }
  }

  private failPending(err: Error): void {
    for (const [, pending] of this.pending) pending.reject(err);
    this.pending.clear();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.isClosed) {
      return Promise.reject(new MCPError(-1, "MCP connection closed"));
    }
    const id = ++this.requestId;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }
}

/**
 * Read an array out of a JSON-RPC result.
 *
 * Absent or non-array means an empty list rather than a crash: `listTools()`
 * used to return `result.tools` unchecked, so a server that answered `{}`
 * handed the caller `undefined` typed as `MCPTool[]`, and the `.map` after
 * the call threw.
 */
function listField<T>(result: unknown, key: string): T[] {
  if (typeof result !== "object" || result === null) return [];
  const value = (result as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : [];
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

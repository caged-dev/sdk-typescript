import { CagedAPIError, CagedTimeoutError } from "./errors";
import { TerminalSession } from "./terminal";
import { MCPClient } from "./mcp";
import { ExecStream } from "./stream";
import type {
  CagedConfig,
  Sandbox,
  SandboxCreateParams,
  ExecResult,
  FileEntry,
  Snapshot,
  SnapshotCreateParams,
  APIKey,
  Session,
  TrustScore,
  Port,
  LogEntry,
  AgentSession,
  ReplayEvent,
  ReplaySummary,
  Alert,
  AlertRule,
  Notification,
  NotificationConfig,
  Subscription,
  EventPayload,
  IngestResponse,
} from "./types";

const DEFAULT_BASE_URL = "https://api.caged.dev";
const DEFAULT_TIMEOUT = 30_000;

// Command execution can include long-running agent prompts.
const DEFAULT_EXEC_TIMEOUT = 300_000;

// Sandbox creation can include a repo clone and agent installs.
const DEFAULT_CREATE_TIMEOUT = 360_000;

/**
 * Caged SDK client.
 *
 * @example
 * ```ts
 * import { Caged } from "@caged-dev/sdk";
 *
 * const caged = new Caged({ apiKey: "caged_sk_..." });
 * const sandbox = await caged.sandboxes.create({ template: "node-20" });
 * console.log(sandbox.id, sandbox.status);
 * ```
 */
export class Caged {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  public readonly sandboxes: SandboxesAPI;
  public readonly files: FilesAPI;
  public readonly snapshots: SnapshotsAPI;
  public readonly account: AccountAPI;
  public readonly sessions: SessionsAPI;
  public readonly events: EventsAPI;
  public readonly alerts: AlertsAPI;
  public readonly notifications: NotificationsAPI;
  public readonly billing: BillingAPI;

  constructor(config: CagedConfig) {
    if (!config.apiKey) {
      throw new Error("apiKey is required");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;

    this.sandboxes = new SandboxesAPI(this);
    this.files = new FilesAPI(this);
    this.snapshots = new SnapshotsAPI(this);
    this.account = new AccountAPI(this);
    this.sessions = new SessionsAPI(this);
    this.events = new EventsAPI(this);
    this.alerts = new AlertsAPI(this);
    this.notifications = new NotificationsAPI(this);
    this.billing = new BillingAPI(this);
  }

  /** @internal */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<T> {
    const url = `${this.baseUrl}/v1${path}`;
    const timeout = timeoutMs ?? this.timeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "@caged-dev/sdk/0.1.0",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        throw new CagedAPIError(res.status, errorBody);
      }

      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err: unknown) {
      if (err instanceof CagedAPIError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new CagedTimeoutError(timeout);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @internal Create a WebSocket connection to a sandbox endpoint. */
  connectWebSocket(path: string): WebSocket {
    const wsBase = this.baseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");
    const url = `${wsBase}/v1${path}`;
    const separator = url.includes("?") ? "&" : "?";
    return new WebSocket(`${url}${separator}token=${this.apiKey}`, ["mcp"]);
  }
}

class SandboxesAPI {
  constructor(private client: Caged) {}

  /** Create a new sandbox. */
  async create(params: SandboxCreateParams = {}): Promise<Sandbox> {
    return this.client.request<Sandbox>(
      "POST",
      "/sandboxes",
      params,
      DEFAULT_CREATE_TIMEOUT
    );
  }

  /**
   * Run a shell command in a sandbox and return its output and exit code.
   *
   * Supports pipes and redirects. A non-zero exit code does not throw;
   * check `result.exit_code` (or `result.error` for infrastructure failures).
   */
  async exec(
    id: string,
    command: string,
    timeoutMs: number = DEFAULT_EXEC_TIMEOUT
  ): Promise<ExecResult> {
    return this.client.request<ExecResult>(
      "POST",
      `/sandboxes/${id}/exec`,
      { command },
      timeoutMs
    );
  }

  /**
   * Run a command with real-time streaming output.
   *
   * Returns an async iterable that yields output chunks as they arrive.
   *
   * @example
   * ```ts
   * const stream = await caged.sandboxes.execStream(id, "npm test");
   * for await (const chunk of stream) {
   *   process.stdout.write(chunk);
   * }
   * console.log("Exit code:", stream.exitCode);
   * ```
   */
  execStream(id: string, command: string): ExecStream {
    const ws = this.client.connectWebSocket(
      `/sandboxes/${id}/terminal`
    );
    // Send the command once connected.
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "input", data: command + "\n" }));
    });
    return new ExecStream(ws);
  }

  /**
   * Connect an interactive terminal session to the sandbox.
   *
   * @example
   * ```ts
   * const terminal = await caged.sandboxes.terminal(sandbox.id);
   * terminal.onOutput((data) => process.stdout.write(data));
   * terminal.send("ls -la\n");
   * terminal.close();
   * ```
   */
  terminal(id: string, opts?: { rows?: number; cols?: number }): Promise<TerminalSession> {
    const rows = opts?.rows ?? 24;
    const cols = opts?.cols ?? 80;
    const ws = this.client.connectWebSocket(
      `/sandboxes/${id}/terminal?rows=${rows}&cols=${cols}`
    );
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(new TerminalSession(ws)));
      ws.addEventListener("error", () =>
        reject(new Error("Failed to connect terminal"))
      );
    });
  }

  /**
   * Connect to the sandbox via MCP (Model Context Protocol).
   *
   * Provides tool calling for filesystem, terminal, git, and network operations.
   *
   * @example
   * ```ts
   * const mcp = await caged.sandboxes.mcp(sandbox.id);
   * const tools = await mcp.listTools();
   * const result = await mcp.callTool("filesystem_read", { path: "package.json" });
   * mcp.close();
   * ```
   */
  mcp(id: string): Promise<MCPClient> {
    const ws = this.client.connectWebSocket(`/sandboxes/${id}/mcp`);
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", async () => {
        const client = new MCPClient(ws);
        try {
          await client.initialize();
          resolve(client);
        } catch (err) {
          reject(err);
        }
      });
      ws.addEventListener("error", () =>
        reject(new Error("Failed to connect MCP"))
      );
    });
  }

  /** List all sandboxes for the authenticated account. */
  async list(): Promise<Sandbox[]> {
    return this.client.request<Sandbox[]>("GET", "/sandboxes");
  }

  /** Get a sandbox by ID. */
  async get(id: string): Promise<Sandbox> {
    return this.client.request<Sandbox>("GET", `/sandboxes/${id}`);
  }

  /** Destroy (permanently delete) a sandbox. */
  async destroy(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/sandboxes/${id}`);
  }

  /** Pause a running sandbox. */
  async pause(id: string): Promise<void> {
    await this.client.request<void>("POST", `/sandboxes/${id}/pause`);
  }

  /** Resume a paused sandbox. */
  async resume(id: string): Promise<void> {
    await this.client.request<void>("POST", `/sandboxes/${id}/resume`);
  }

  /** Get sandbox logs (stdout/stderr). */
  async logs(id: string, tail?: number): Promise<LogEntry[]> {
    const query = tail ? `?tail=${tail}` : "";
    return this.client.request<LogEntry[]>("GET", `/sandboxes/${id}/logs${query}`);
  }

  /** List open ports for a sandbox. */
  async ports(id: string): Promise<Port[]> {
    return this.client.request<Port[]>("GET", `/sandboxes/${id}/ports`);
  }

  /** Get trust score for a sandbox session. */
  async trustScore(sandboxId: string): Promise<TrustScore[]> {
    return this.client.request<TrustScore[]>(
      "GET",
      `/trust/sandboxes/${sandboxId}`
    );
  }
}

class FilesAPI {
  constructor(private client: Caged) {}

  /** List files in a directory. */
  async list(sandboxId: string, path: string = "/"): Promise<FileEntry[]> {
    const encoded = encodeURIComponent(path);
    return this.client.request<FileEntry[]>(
      "GET",
      `/sandboxes/${sandboxId}/files?path=${encoded}`
    );
  }

  /** Read file content. */
  async read(sandboxId: string, path: string): Promise<string> {
    const encoded = encodeURIComponent(path);
    return this.client.request<string>(
      "GET",
      `/sandboxes/${sandboxId}/files/content?path=${encoded}`
    );
  }

  /** Write content to a file. */
  async write(
    sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    await this.client.request<void>(
      "PUT",
      `/sandboxes/${sandboxId}/files/content`,
      { path, content }
    );
  }

  /** Get git diff for the sandbox workspace. */
  async gitDiff(sandboxId: string): Promise<string> {
    return this.client.request<string>(
      "GET",
      `/sandboxes/${sandboxId}/git/diff`
    );
  }
}

class SnapshotsAPI {
  constructor(private client: Caged) {}

  /** List snapshots for a sandbox. */
  async list(sandboxId: string): Promise<Snapshot[]> {
    return this.client.request<Snapshot[]>(
      "GET",
      `/sandboxes/${sandboxId}/snapshots`
    );
  }

  /** Create a snapshot of the sandbox workspace. */
  async create(
    sandboxId: string,
    params: SnapshotCreateParams = {}
  ): Promise<Snapshot> {
    return this.client.request<Snapshot>(
      "POST",
      `/sandboxes/${sandboxId}/snapshots`,
      params
    );
  }

  /** Get snapshot details. */
  async get(snapshotId: string): Promise<Snapshot> {
    return this.client.request<Snapshot>("GET", `/snapshots/${snapshotId}`);
  }

  /** Delete a snapshot. */
  async delete(snapshotId: string): Promise<void> {
    await this.client.request<void>("DELETE", `/snapshots/${snapshotId}`);
  }

  /** Get a presigned download URL for a snapshot. */
  async downloadUrl(snapshotId: string): Promise<{ url: string }> {
    return this.client.request<{ url: string }>(
      "GET",
      `/snapshots/${snapshotId}/download`
    );
  }

  /** Restore a snapshot into its sandbox. */
  async restore(snapshotId: string): Promise<void> {
    await this.client.request<void>("POST", `/snapshots/${snapshotId}/restore`);
  }
}

class AccountAPI {
  constructor(private client: Caged) {}

  /** List API keys. */
  async listKeys(): Promise<APIKey[]> {
    return this.client.request<APIKey[]>("GET", "/account/keys");
  }

  /** Create a new API key. */
  async createKey(name: string): Promise<APIKey & { key: string }> {
    return this.client.request<APIKey & { key: string }>("POST", "/account/keys", {
      name,
    });
  }

  /** Revoke an API key. */
  async revokeKey(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/account/keys/${id}`);
  }

  /** List active sessions. */
  async listSessions(): Promise<Session[]> {
    return this.client.request<Session[]>("GET", "/account/sessions");
  }

  /** Revoke a session. */
  async revokeSession(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/account/sessions/${id}`);
  }
}

// --- Sessions (Agent session history & replay) ---

class SessionsAPI {
  constructor(private client: Caged) {}

  /** List agent sessions for a sandbox. */
  async listBySandbox(sandboxId: string): Promise<AgentSession[]> {
    return this.client.request<AgentSession[]>(
      "GET",
      `/sandboxes/${sandboxId}/sessions`
    );
  }

  /** Get an agent session by ID. */
  async get(sessionId: string): Promise<AgentSession> {
    return this.client.request<AgentSession>("GET", `/sessions/${sessionId}`);
  }

  /** Get full replay timeline for a session. */
  async replay(sessionId: string): Promise<ReplayEvent[]> {
    return this.client.request<ReplayEvent[]>(
      "GET",
      `/sessions/${sessionId}/replay`
    );
  }

  /** Get a summary of a session replay (cost, tokens, duration). */
  async replaySummary(sessionId: string): Promise<ReplaySummary> {
    return this.client.request<ReplaySummary>(
      "GET",
      `/sessions/${sessionId}/replay/summary`
    );
  }
}

// --- Events (Observability ingestion) ---

class EventsAPI {
  constructor(private client: Caged) {}

  /**
   * Ingest observability events (LLM calls, tool calls, file ops, etc.).
   *
   * Used by agents/SDKs to push structured events to the Caged pipeline.
   * Max 1000 events per batch.
   */
  async ingest(events: EventPayload[]): Promise<IngestResponse> {
    return this.client.request<IngestResponse>("POST", "/events/ingest", {
      events,
    });
  }
}

// --- Alerts ---

class AlertsAPI {
  constructor(private client: Caged) {}

  /** List all alerts for the account. */
  async list(): Promise<Alert[]> {
    return this.client.request<Alert[]>("GET", "/alerts");
  }

  /** Get an alert by ID. */
  async get(id: string): Promise<Alert> {
    return this.client.request<Alert>("GET", `/alerts/${id}`);
  }

  /** Resolve an alert. */
  async resolve(id: string): Promise<void> {
    await this.client.request<void>("POST", `/alerts/${id}/resolve`);
  }

  /** List alert rules. */
  async listRules(): Promise<AlertRule[]> {
    return this.client.request<AlertRule[]>("GET", "/alerts/rules");
  }

  /** Update an alert rule. */
  async updateRule(id: string, rule: Partial<AlertRule>): Promise<AlertRule> {
    return this.client.request<AlertRule>("PUT", `/alerts/rules/${id}`, rule);
  }
}

// --- Notifications ---

class NotificationsAPI {
  constructor(private client: Caged) {}

  /** List notifications. */
  async list(): Promise<Notification[]> {
    return this.client.request<Notification[]>("GET", "/notifications");
  }

  /** Get unread notification count. */
  async unreadCount(): Promise<{ count: number }> {
    return this.client.request<{ count: number }>(
      "GET",
      "/notifications/unread-count"
    );
  }

  /** Mark a notification as read. */
  async markRead(id: string): Promise<void> {
    await this.client.request<void>("POST", `/notifications/${id}/read`);
  }

  /** Mark all notifications as read. */
  async markAllRead(): Promise<void> {
    await this.client.request<void>("POST", "/notifications/read-all");
  }

  /** Get notification configuration (channels, thresholds). */
  async getConfig(): Promise<NotificationConfig> {
    return this.client.request<NotificationConfig>(
      "GET",
      "/notifications/config"
    );
  }

  /** Update notification configuration. */
  async updateConfig(config: Partial<NotificationConfig>): Promise<NotificationConfig> {
    return this.client.request<NotificationConfig>(
      "PUT",
      "/notifications/config",
      config
    );
  }
}

// --- Billing ---

class BillingAPI {
  constructor(private client: Caged) {}

  /** Get current subscription details. */
  async getSubscription(): Promise<Subscription> {
    return this.client.request<Subscription>("GET", "/billing/subscription");
  }

  /** Create a Stripe checkout session for upgrading. Returns a checkout URL. */
  async createCheckout(plan: string): Promise<{ url: string }> {
    return this.client.request<{ url: string }>("POST", "/billing/checkout", {
      plan,
    });
  }

  /** Create a Stripe billing portal session. Returns a portal URL. */
  async createPortal(): Promise<{ url: string }> {
    return this.client.request<{ url: string }>("POST", "/billing/portal");
  }

  /** Cancel the current subscription. */
  async cancel(): Promise<void> {
    await this.client.request<void>("POST", "/billing/cancel");
  }
}

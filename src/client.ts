import {
  CagedConnectionError,
  CagedError,
  CagedNotFoundError,
  CagedTimeoutError,
  errorForStatus,
} from "./errors";
import { ExecStream } from "./stream";
import { MCPClient } from "./mcp";
import { TerminalSession } from "./terminal";
import type {
  Account,
  AccountSession,
  Alert,
  AlertPage,
  AlertRule,
  AlertRuleUpdate,
  AgentSession,
  AgentSessionPage,
  APIKey,
  APIKeyScope,
  CagedConfig,
  CreatedAPIKey,
  EventPayload,
  ExecResult,
  FileEntry,
  GitDiff,
  IngestResponse,
  LogEntry,
  Notification,
  NotificationConfig,
  NotificationConfigUpdate,
  NotificationPage,
  Port,
  ProblemDetail,
  ReplayPage,
  ReplaySummary,
  Sandbox,
  SandboxCreateParams,
  Snapshot,
  SnapshotCreateParams,
  SnapshotDownload,
  SocketTicket,
  Subscription,
  TrustScoreSummary,
  Usage,
  WebSocketFactory,
  WebSocketLike,
} from "./types";
import { VERSION } from "./version";

const DEFAULT_BASE_URL = "https://api.caged.dev";
const DEFAULT_TIMEOUT = 30_000;

// Command execution can include long-running agent prompts.
const DEFAULT_EXEC_TIMEOUT = 300_000;

// Sandbox creation can include a repo clone and agent installs.
const DEFAULT_CREATE_TIMEOUT = 360_000;

type QueryValue = string | number | boolean;

interface RequestSpec {
  method: string;
  path: string;
  /** Query parameters. Encoded here; never interpolate into `path`. */
  query?: Record<string, QueryValue | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  contentType: string;
  text: string;
}

/**
 * Caged SDK client.
 *
 * @example
 * ```ts
 * import { Caged } from "@caged-dev/sdk";
 *
 * const caged = new Caged({ apiKey: process.env.CAGED_API_KEY! });
 * const sandbox = await caged.sandboxes.create({ template: "node-20" });
 * console.log(sandbox.id, sandbox.status);
 * ```
 */
export class Caged {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly webSocketImpl: WebSocketFactory | undefined;

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
      throw new CagedError("apiKey is required");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new CagedError(
        "global fetch is not available; pass `fetch` in the client config or run on Node.js 18+"
      );
    }
    // Bound so an unbound global `fetch` cannot throw "Illegal invocation".
    this.fetchImpl = fetchImpl.bind(globalThis);

    this.webSocketImpl = config.webSocket;

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

  /** @internal Performs the request and returns the undecoded body. */
  private async send(spec: RequestSpec): Promise<RawResponse> {
    const timeout = spec.timeoutMs ?? this.timeout;
    const url = this.baseUrl + "/v1" + spec.path + encodeQuery(spec.query);

    const controller = new AbortController();
    // Every external call is bounded: no request can outlive this timer.
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `@caged-dev/sdk/${VERSION}`,
    };
    let payload: string | undefined;
    if (spec.body !== undefined) {
      payload = JSON.stringify(spec.body);
      headers["Content-Type"] = "application/json";
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: spec.method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (isAbort(err)) throw new CagedTimeoutError(timeout);
      throw new CagedConnectionError(
        `${spec.method} ${spec.path} failed before a response arrived: ${describe(err)}`,
        err
      );
    } finally {
      clearTimeout(timer);
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err: unknown) {
      if (isAbort(err)) throw new CagedTimeoutError(timeout);
      throw new CagedConnectionError(
        `${spec.method} ${spec.path} returned ${res.status} but the body could not be read: ${describe(err)}`,
        err
      );
    }

    const raw: RawResponse = {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      text,
    };

    if (!res.ok) {
      throw errorForStatus(res.status, text, parseProblem(raw));
    }
    return raw;
  }

  /** @internal Request expecting a JSON body. */
  async requestJSON<T>(spec: RequestSpec): Promise<T> {
    const raw = await this.send(spec);
    if (raw.text.trim() === "") {
      throw new CagedError(
        `${spec.method} ${spec.path} returned ${raw.status} with an empty body where JSON was expected`
      );
    }
    try {
      return JSON.parse(raw.text) as T;
    } catch {
      throw new CagedError(
        `${spec.method} ${spec.path} returned ${raw.status} with a body that is not JSON ` +
          `(content-type: ${raw.contentType || "none"})`
      );
    }
  }

  /** @internal Request expecting a plain-text body (e.g. file content). */
  async requestText(spec: RequestSpec): Promise<string> {
    const raw = await this.send(spec);
    return raw.text;
  }

  /** @internal Request whose response body is discarded. */
  async requestVoid(spec: RequestSpec): Promise<void> {
    await this.send(spec);
  }

  /**
   * Mint a short-lived, single-use credential for one WebSocket.
   *
   * A handshake cannot set an `Authorization` header, so the credential has
   * to ride in the URL — and a URL reaches every proxy that logs a request
   * line. The API therefore issues tickets that expire in a minute and are
   * refused anywhere but a handshake.
   */
  async socketTicket(): Promise<SocketTicket> {
    return this.requestJSON<SocketTicket>({
      method: "POST",
      path: "/auth/socket-ticket",
    });
  }

  /**
   * @internal The credential to put in a WebSocket handshake URL.
   *
   * Prefers a ticket, falling back to the API key when the API does not
   * serve the ticket endpoint — a deployment older than the endpoint would
   * otherwise lose every socket. That fallback is what this SDK always did,
   * and what the server logs a warning about.
   */
  private async socketToken(): Promise<string> {
    try {
      const ticket = await this.socketTicket();
      return ticket.ticket || this.apiKey;
    } catch (err: unknown) {
      if (err instanceof CagedNotFoundError) return this.apiKey;
      throw err;
    }
  }

  /** @internal Opens a WebSocket to a sandbox endpoint, once it is open. */
  async connectWebSocket(
    path: string,
    subprotocol: string,
    query: Record<string, QueryValue | undefined> = {}
  ): Promise<WebSocketLike> {
    const factory = this.webSocketImpl ?? defaultWebSocketFactory();
    const token = await this.socketToken();
    const wsBase = this.baseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");
    const url = wsBase + "/v1" + path + encodeQuery({ ...query, token });

    // The subprotocol matters: the terminal endpoint offers "terminal" and
    // the MCP endpoint offers "mcp". This SDK asked for "mcp" on every
    // socket, leaving the terminal handshake with no agreed subprotocol --
    // tolerated by today's server and by nothing else.
    const ws = factory(url, [subprotocol]);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () =>
        reject(
          new CagedConnectionError(`WebSocket to ${path} failed to open`, null)
        )
      );
    });
    return ws;
  }
}

function defaultWebSocketFactory(): WebSocketFactory {
  const impl = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof impl !== "function") {
    throw new CagedError(
      "global WebSocket is not available; pass `webSocket` in the client " +
        "config (e.g. from the `ws` package) or run on Node.js 22+"
    );
  }
  const ctor = impl as new (url: string, protocols: string[]) => WebSocketLike;
  return (url, protocols) => new ctor(url, protocols);
}

function encodeQuery(
  query: Record<string, QueryValue | undefined> | undefined
): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.append(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function parseProblem(raw: RawResponse): ProblemDetail | null {
  if (!raw.contentType.includes("json")) return null;
  try {
    const parsed: unknown = JSON.parse(raw.text);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as ProblemDetail;
    }
  } catch {
    // Body claimed JSON but is not — the raw text is kept on the error.
  }
  return null;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class SandboxesAPI {
  constructor(private client: Caged) {}

  /**
   * Create a new sandbox.
   *
   * `template` is required — the API rejects a create without one.
   */
  async create(params: SandboxCreateParams): Promise<Sandbox> {
    if (!params || !params.template) {
      throw new CagedError("template is required to create a sandbox");
    }
    return this.client.requestJSON<Sandbox>({
      method: "POST",
      path: "/sandboxes",
      body: params,
      timeoutMs: DEFAULT_CREATE_TIMEOUT,
    });
  }

  /**
   * Run a shell command in a sandbox and return its output and exit code.
   *
   * Supports pipes and redirects. A non-zero exit code does not throw;
   * check `result.exit_code` (`result.error` is only set when the command
   * could not be run at all).
   *
   * @example
   * ```ts
   * const result = await caged.sandboxes.exec(sandbox.id, 'claude -p "explain this repo"');
   * console.log(result.output);
   * ```
   */
  async exec(
    id: string,
    command: string,
    timeoutMs: number = DEFAULT_EXEC_TIMEOUT
  ): Promise<ExecResult> {
    return this.client.requestJSON<ExecResult>({
      method: "POST",
      path: `/sandboxes/${encodeURIComponent(id)}/exec`,
      body: { command },
      timeoutMs,
    });
  }

  /**
   * Run a command with real-time streaming output.
   *
   * Returns an async iterable that yields output chunks as they arrive and
   * carries the command's exit code once it has finished. There is no
   * streaming exec endpoint: this drives the terminal WebSocket and brackets
   * the command with markers carrying a per-call nonce, so the login banner,
   * the shell's echo and the prompt are stripped and the exit code is read
   * back from the shell rather than waited for on a message the endpoint
   * does not send.
   *
   * @example
   * ```ts
   * const stream = await caged.sandboxes.execStream(id, "npm test");
   * for await (const chunk of stream) process.stdout.write(chunk);
   * console.log("Exit code:", stream.exitCode);
   * ```
   */
  async execStream(id: string, command: string): Promise<ExecStream> {
    const ws = await this.client.connectWebSocket(
      `/sandboxes/${encodeURIComponent(id)}/terminal`,
      "terminal"
    );
    const stream = new ExecStream(ws);
    stream.start(command);
    return stream;
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
  async terminal(
    id: string,
    opts: { rows?: number; cols?: number } = {}
  ): Promise<TerminalSession> {
    const ws = await this.client.connectWebSocket(
      `/sandboxes/${encodeURIComponent(id)}/terminal`,
      "terminal",
      { rows: opts.rows ?? 24, cols: opts.cols ?? 80 }
    );
    return new TerminalSession(ws);
  }

  /**
   * Connect to the sandbox via MCP (Model Context Protocol).
   *
   * Provides tool calling for filesystem, terminal, git and network
   * operations. The returned client has completed its `initialize`
   * handshake. The sandbox must be running.
   */
  async mcp(id: string): Promise<MCPClient> {
    const ws = await this.client.connectWebSocket(
      `/sandboxes/${encodeURIComponent(id)}/mcp`,
      "mcp"
    );
    const client = new MCPClient(ws);
    await client.initialize();
    return client;
  }

  /** List all sandboxes for the authenticated account. */
  async list(): Promise<Sandbox[]> {
    return this.client.requestJSON<Sandbox[]>({
      method: "GET",
      path: "/sandboxes",
    });
  }

  /** Get a sandbox by ID. */
  async get(id: string): Promise<Sandbox> {
    return this.client.requestJSON<Sandbox>({
      method: "GET",
      path: `/sandboxes/${encodeURIComponent(id)}`,
    });
  }

  /** Destroy (permanently delete) a sandbox. */
  async destroy(id: string): Promise<void> {
    await this.client.requestVoid({
      method: "DELETE",
      path: `/sandboxes/${encodeURIComponent(id)}`,
    });
  }

  /** Pause a running sandbox. */
  async pause(id: string): Promise<void> {
    await this.client.requestVoid({
      method: "POST",
      path: `/sandboxes/${encodeURIComponent(id)}/pause`,
    });
  }

  /** Resume a paused sandbox. */
  async resume(id: string): Promise<void> {
    await this.client.requestVoid({
      method: "POST",
      path: `/sandboxes/${encodeURIComponent(id)}/resume`,
    });
  }

  /** List open ports for a sandbox. */
  async ports(id: string): Promise<Port[]> {
    return this.client.requestJSON<Port[]>({
      method: "GET",
      path: `/sandboxes/${encodeURIComponent(id)}/ports`,
    });
  }

  /**
   * Fetch recent lifecycle log entries for a sandbox.
   *
   * `tail` is the number of lines; the API clamps it to its own ceiling
   * and falls back to its default for a non-positive value.
   */
  async logs(id: string, tail?: number): Promise<LogEntry[]> {
    return this.client.requestJSON<LogEntry[]>({
      method: "GET",
      path: `/sandboxes/${encodeURIComponent(id)}/logs`,
      query: { tail },
    });
  }

  /**
   * Trust scores for every agent session run in a sandbox.
   *
   * `score` is an integer out of 100.
   */
  async trustScores(sandboxId: string): Promise<TrustScoreSummary[]> {
    return this.client.requestJSON<TrustScoreSummary[]>({
      method: "GET",
      path: `/trust/sandboxes/${encodeURIComponent(sandboxId)}`,
    });
  }

  /**
   * @deprecated Renamed to `trustScores` in 0.2.0 — it always returned a
   * list, one row per session. Removed no earlier than 0.4.0.
   */
  async trustScore(sandboxId: string): Promise<TrustScoreSummary[]> {
    warnDeprecated(
      "caged.sandboxes.trustScore() is deprecated; use caged.sandboxes.trustScores()"
    );
    return this.trustScores(sandboxId);
  }
}

class FilesAPI {
  constructor(private client: Caged) {}

  /** List files in a directory (default: `/workspace`). */
  async list(sandboxId: string, path: string = "/workspace"): Promise<FileEntry[]> {
    return this.client.requestJSON<FileEntry[]>({
      method: "GET",
      path: `/sandboxes/${encodeURIComponent(sandboxId)}/files`,
      query: { path },
    });
  }

  /**
   * Read file content.
   *
   * The endpoint answers `text/plain`, so the file's bytes are returned as
   * a string rather than parsed as JSON. Files over 1MB are rejected by
   * the API with a 400.
   */
  async read(sandboxId: string, path: string): Promise<string> {
    return this.client.requestText({
      method: "GET",
      path: `/sandboxes/${encodeURIComponent(sandboxId)}/files/content`,
      query: { path },
    });
  }

  /**
   * Write content to a file.
   *
   * The target path travels in the query string — that is where the API
   * reads it from — and only the content is sent in the body.
   */
  async write(sandboxId: string, path: string, content: string): Promise<void> {
    await this.client.requestVoid({
      method: "PUT",
      path: `/sandboxes/${encodeURIComponent(sandboxId)}/files/content`,
      query: { path },
      body: { content },
    });
  }

  /**
   * Get the git status and diff for a working tree in the sandbox
   * (default: `/workspace`).
   */
  async gitDiff(sandboxId: string, path?: string): Promise<GitDiff> {
    return this.client.requestJSON<GitDiff>({
      method: "GET",
      path: `/sandboxes/${encodeURIComponent(sandboxId)}/git/diff`,
      query: { path },
    });
  }
}

class SnapshotsAPI {
  constructor(private client: Caged) {}

  /** List snapshots for a sandbox. */
  async list(sandboxId: string): Promise<Snapshot[]> {
    return this.client.requestJSON<Snapshot[]>({
      method: "GET",
      path: `/sandboxes/${encodeURIComponent(sandboxId)}/snapshots`,
    });
  }

  /** Create a snapshot of the sandbox workspace. */
  async create(
    sandboxId: string,
    params: SnapshotCreateParams = {}
  ): Promise<Snapshot> {
    return this.client.requestJSON<Snapshot>({
      method: "POST",
      path: `/sandboxes/${encodeURIComponent(sandboxId)}/snapshots`,
      body: params,
    });
  }

  /** Get snapshot details. */
  async get(snapshotId: string): Promise<Snapshot> {
    return this.client.requestJSON<Snapshot>({
      method: "GET",
      path: `/snapshots/${encodeURIComponent(snapshotId)}`,
    });
  }

  /** Delete a snapshot. */
  async delete(snapshotId: string): Promise<void> {
    await this.client.requestVoid({
      method: "DELETE",
      path: `/snapshots/${encodeURIComponent(snapshotId)}`,
    });
  }

  /**
   * Get a download URL for a snapshot, with its expiry.
   *
   * With an S3-backed store the URL is presigned and absolute; with a
   * filesystem-backed store it is the API-relative streaming path
   * `/v1/snapshots/{id}/download/content`, which needs the API key.
   */
  async download(snapshotId: string): Promise<SnapshotDownload> {
    return this.client.requestJSON<SnapshotDownload>({
      method: "GET",
      path: `/snapshots/${encodeURIComponent(snapshotId)}/download`,
    });
  }

  /**
   * @deprecated Use `download()`, which also returns the expiry. This
   * wrapper stays until at least 0.5.0.
   */
  async downloadUrl(snapshotId: string): Promise<SnapshotDownload> {
    warnDeprecated(
      "caged.snapshots.downloadUrl() is deprecated; use caged.snapshots.download()"
    );
    return this.download(snapshotId);
  }

  /**
   * Restore a snapshot into a sandbox.
   *
   * `targetSandboxId` is required: a snapshot is restored into a sandbox
   * the caller names, not into the one it was taken from.
   */
  async restore(snapshotId: string, targetSandboxId: string): Promise<void> {
    if (!targetSandboxId) {
      throw new CagedError("targetSandboxId is required to restore a snapshot");
    }
    await this.client.requestVoid({
      method: "POST",
      path: `/snapshots/${encodeURIComponent(snapshotId)}/restore`,
      body: { target_sandbox_id: targetSandboxId },
    });
  }
}

class AccountAPI {
  constructor(private client: Caged) {}

  /** Get the authenticated account. */
  async get(): Promise<Account> {
    return this.client.requestJSON<Account>({
      method: "GET",
      path: "/account",
    });
  }

  /** List API keys. */
  async listKeys(): Promise<APIKey[]> {
    return this.client.requestJSON<APIKey[]>({
      method: "GET",
      path: "/account/keys",
    });
  }

  /**
   * Create a new API key.
   *
   * The secret is in `result.key` and is never returned again; the
   * metadata is in `result.info`.
   */
  async createKey(
    name: string,
    scope: APIKeyScope = "full"
  ): Promise<CreatedAPIKey> {
    return this.client.requestJSON<CreatedAPIKey>({
      method: "POST",
      path: "/account/keys",
      body: { name, scope },
    });
  }

  /** Revoke an API key. */
  async revokeKey(id: string): Promise<void> {
    await this.client.requestVoid({
      method: "DELETE",
      path: `/account/keys/${encodeURIComponent(id)}`,
    });
  }

  /** List active dashboard sessions. */
  async listSessions(): Promise<AccountSession[]> {
    return this.client.requestJSON<AccountSession[]>({
      method: "GET",
      path: "/account/sessions",
    });
  }

  /** Revoke a dashboard session. */
  async revokeSession(id: string): Promise<void> {
    await this.client.requestVoid({
      method: "DELETE",
      path: `/account/sessions/${encodeURIComponent(id)}`,
    });
  }
}

/** Agent session history and replay. */
class SessionsAPI {
  constructor(private client: Caged) {}

  /**
   * List every agent session in the account, newest first.
   *
   * Paginated: the sessions are in `result.data` and the position in
   * `result.pagination`.
   */
  async list(page = 1, perPage?: number): Promise<AgentSessionPage> {
    return this.client.requestJSON<AgentSessionPage>({
      method: "GET",
      path: "/sessions",
      query: { page, per_page: perPage },
    });
  }

  /** List agent sessions for one sandbox. */
  async listBySandbox(sandboxId: string): Promise<AgentSession[]> {
    return this.client.requestJSON<AgentSession[]>({
      method: "GET",
      path: `/sandboxes/${encodeURIComponent(sandboxId)}/sessions`,
    });
  }

  /** Get an agent session by ID. */
  async get(sessionId: string): Promise<AgentSession> {
    return this.client.requestJSON<AgentSession>({
      method: "GET",
      path: `/sessions/${encodeURIComponent(sessionId)}`,
    });
  }

  /**
   * Fetch a page of a session's replay timeline.
   *
   * The endpoint answers an object, not a bare array: the events are in
   * `result.events`, and while `result.has_more` is true the next page
   * starts at `after_seq = result.next_seq`. `limit` is clamped to 1000 by
   * the API.
   */
  async replay(
    sessionId: string,
    opts: { afterSeq?: number; limit?: number; type?: string } = {}
  ): Promise<ReplayPage> {
    return this.client.requestJSON<ReplayPage>({
      method: "GET",
      path: `/sessions/${encodeURIComponent(sessionId)}/replay`,
      query: {
        after_seq: opts.afterSeq,
        limit: opts.limit,
        type: opts.type,
      },
    });
  }

  /**
   * Event counts and wall-clock duration for a session's replay.
   *
   * Tokens and cost are on the session, not here.
   */
  async replaySummary(sessionId: string): Promise<ReplaySummary> {
    return this.client.requestJSON<ReplaySummary>({
      method: "GET",
      path: `/sessions/${encodeURIComponent(sessionId)}/replay/summary`,
    });
  }
}

/** Observability event ingestion. */
class EventsAPI {
  constructor(private client: Caged) {}

  /**
   * Ingest observability events. Max 1000 events per batch.
   *
   * The account is taken from the API key; an `account_id` on an event is
   * ignored by the server. An event without a `timestamp` is stamped with
   * the current time here, because the server decodes that field into a
   * non-nullable `time.Time` and rejects the batch without it.
   */
  async ingest(events: EventPayload[]): Promise<IngestResponse> {
    if (events.length > 1000) {
      throw new CagedError(
        `batch too large: ${events.length} events, the API accepts at most 1000`
      );
    }
    const stamped = events.map((event) => ({
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    }));
    return this.client.requestJSON<IngestResponse>({
      method: "POST",
      path: "/events/ingest",
      body: { events: stamped },
    });
  }
}

class AlertsAPI {
  constructor(private client: Caged) {}

  /**
   * List alerts for the account, newest first.
   *
   * The alerts are in `result.alerts` and the account's total in
   * `result.total`. `limit` must be 1-100; the API serves 50 for anything
   * outside that.
   */
  async list(opts: { limit?: number; offset?: number } = {}): Promise<AlertPage> {
    return this.client.requestJSON<AlertPage>({
      method: "GET",
      path: "/alerts",
      query: { limit: opts.limit, offset: opts.offset },
    });
  }

  /** Get an alert by ID. */
  async get(id: string): Promise<Alert> {
    return this.client.requestJSON<Alert>({
      method: "GET",
      path: `/alerts/${encodeURIComponent(id)}`,
    });
  }

  /** Resolve an alert. */
  async resolve(id: string): Promise<void> {
    await this.client.requestVoid({
      method: "POST",
      path: `/alerts/${encodeURIComponent(id)}/resolve`,
    });
  }

  /** List the account's alert rules. */
  async listRules(): Promise<AlertRule[]> {
    return this.client.requestJSON<AlertRule[]>({
      method: "GET",
      path: "/alerts/rules",
    });
  }

  /**
   * Enable, disable or retune an alert rule.
   *
   * Only what is passed is changed. The endpoint accepts exactly `enabled`
   * and `config`; a rule's type is fixed.
   */
  async updateRule(id: string, update: AlertRuleUpdate): Promise<AlertRule> {
    if (update.enabled === undefined && update.config === undefined) {
      throw new CagedError("updateRule needs enabled or config");
    }
    const body: AlertRuleUpdate = {};
    if (update.enabled !== undefined) body.enabled = update.enabled;
    if (update.config !== undefined) body.config = update.config;
    return this.client.requestJSON<AlertRule>({
      method: "PUT",
      path: `/alerts/rules/${encodeURIComponent(id)}`,
      body,
    });
  }
}

class NotificationsAPI {
  constructor(private client: Caged) {}

  /**
   * List notifications.
   *
   * The notifications are in `result.notifications` and the unread badge
   * count in `result.unread_count`. `limit` must be 1-100.
   */
  async list(
    opts: { unreadOnly?: boolean; limit?: number } = {}
  ): Promise<NotificationPage> {
    return this.client.requestJSON<NotificationPage>({
      method: "GET",
      path: "/notifications",
      query: {
        limit: opts.limit,
        unread: opts.unreadOnly ? "true" : undefined,
      },
    });
  }

  /** The unread notifications only, as a plain list. */
  async listUnread(limit?: number): Promise<Notification[]> {
    const page = await this.list({ unreadOnly: true, limit });
    return page.notifications;
  }

  /**
   * Count unread notifications.
   *
   * The endpoint answers `{"unread_count": n}`; the key is not `count`.
   */
  async unreadCount(): Promise<number> {
    const body = await this.client.requestJSON<{ unread_count?: number }>({
      method: "GET",
      path: "/notifications/unread-count",
    });
    if (typeof body.unread_count !== "number") {
      throw new CagedError(
        "GET /notifications/unread-count did not return an unread_count"
      );
    }
    return body.unread_count;
  }

  /** Mark one notification as read. */
  async markRead(id: string): Promise<void> {
    await this.client.requestVoid({
      method: "POST",
      path: `/notifications/${encodeURIComponent(id)}/read`,
    });
  }

  /** Mark every notification as read. */
  async markAllRead(): Promise<void> {
    await this.client.requestVoid({
      method: "POST",
      path: "/notifications/read-all",
    });
  }

  /**
   * Get the account's notification channel configuration.
   *
   * Credentials are never returned; each is reported as a `*_configured`
   * boolean with a hint.
   */
  async getConfig(): Promise<NotificationConfig> {
    return this.client.requestJSON<NotificationConfig>({
      method: "GET",
      path: "/notifications/config",
    });
  }

  /**
   * Update the account's notification channel configuration.
   *
   * An omitted webhook URL is left as it is; pass `CLEAR_CREDENTIAL` to
   * remove one.
   */
  async updateConfig(
    update: NotificationConfigUpdate
  ): Promise<NotificationConfig> {
    return this.client.requestJSON<NotificationConfig>({
      method: "PUT",
      path: "/notifications/config",
      body: update,
    });
  }
}

class BillingAPI {
  constructor(private client: Caged) {}

  /** Get the account's subscription. The plan name is `tier`. */
  async getSubscription(): Promise<Subscription> {
    return this.client.requestJSON<Subscription>({
      method: "GET",
      path: "/billing/subscription",
    });
  }

  /** Get metered compute time for the current billing period. */
  async getUsage(): Promise<Usage> {
    return this.client.requestJSON<Usage>({
      method: "GET",
      path: "/billing/usage",
    });
  }

  /**
   * Create a Stripe Checkout session and return its URL.
   *
   * `plan` is "pro" or "team". It travels as `plan_id`, which is the field
   * the endpoint reads — it was sent as `plan` and ignored.
   */
  async createCheckout(plan: string): Promise<string> {
    if (!plan) {
      throw new CagedError("plan is required; it is 'pro' or 'team'");
    }
    const body = await this.client.requestJSON<{ url?: string }>({
      method: "POST",
      path: "/billing/checkout",
      body: { plan_id: plan },
    });
    return urlFrom(body, "POST /billing/checkout");
  }

  /** Create a Stripe billing portal session and return its URL. */
  async createPortal(): Promise<string> {
    const body = await this.client.requestJSON<{ url?: string }>({
      method: "POST",
      path: "/billing/portal",
      body: {},
    });
    return urlFrom(body, "POST /billing/portal");
  }

  /** Cancel the subscription at the end of the current period. */
  async cancel(): Promise<void> {
    await this.client.requestVoid({
      method: "POST",
      path: "/billing/cancel",
    });
  }
}

function urlFrom(body: { url?: string }, what: string): string {
  if (typeof body.url !== "string" || body.url === "") {
    throw new CagedError(`${what} did not return a url`);
  }
  return body.url;
}

const warned = new Set<string>();

function warnDeprecated(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[@caged-dev/sdk] ${message}`);
}

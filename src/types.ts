/**
 * Wire types for the Caged REST API.
 *
 * Every interface below mirrors a Go response struct in
 * `internal/api`. Field names are the JSON tags, not camel-cased
 * equivalents: the SDK is a thin wrapper and does not rename the wire.
 */

/** Configuration for the Caged client. */
export interface CagedConfig {
  /** API key (starts with `caged_sk_`). */
  apiKey: string;
  /** Base URL override (default: https://api.caged.dev). */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000). */
  timeout?: number;
  /**
   * `fetch` implementation to use. Defaults to the global `fetch`
   * (Node.js 18+). Injecting one is how tests avoid the network.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * WebSocket factory, for the terminal, streaming exec and MCP clients.
   *
   * Defaults to the global `WebSocket`, which browsers have and Node.js has
   * only from 22. This package deliberately does not depend on `ws`; on an
   * older Node pass one in:
   *
   * ```ts
   * import WebSocket from "ws";
   * new Caged({ apiKey, webSocket: (url, protocols) => new WebSocket(url, protocols) as never });
   * ```
   */
  webSocket?: WebSocketFactory;
}

/** The part of a WebSocket this SDK uses. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "message" | "open" | "close" | "error",
    listener: (event: { data?: unknown }) => void
  ): void;
}

/** Opens a WebSocket for a URL, requesting one subprotocol. */
export type WebSocketFactory = (
  url: string,
  protocols: string[]
) => WebSocketLike;

export type SandboxStatus =
  | "pending"
  | "running"
  | "paused"
  | "stopped"
  | "error"
  | "destroyed";

/** Summary of the `.caged.yaml` config detected for a sandbox. */
export interface SandboxConfigSummary {
  /** "yaml", "flags" or "merged". */
  source: string;
  raw?: string;
}

/** Mirrors `api.SandboxResponse`. */
export interface Sandbox {
  id: string;
  status: SandboxStatus;
  template: string;
  ip?: string;
  cpus: number;
  memory_mb: number;
  disk_gb: number;
  network_mode: string;
  repo_url?: string;
  /** Budget cap in USD. */
  budget?: number;
  init_script?: string;
  /** Idle timeout in seconds. */
  timeout?: number;
  config?: SandboxConfigSummary;
  created_at: string;
  /** RFC 3339; absent until the sandbox has started. */
  started_at?: string;
  /** RFC 3339; absent while the sandbox is still running. */
  stopped_at?: string;
  /**
   * Dollars of accrued COMPUTE — machine time — spent so far. Always
   * present, including zero.
   *
   * This is half the money. Model spend is metered per session and reported
   * as {@link Sandbox.llm_cost}. Showing `cost` against `budget` shows a
   * fraction of the figure the ceiling is compared to, which is how a
   * sandbox appears to pause at a tenth of its budget.
   */
  cost: number;
  /** Dollars this sandbox's sessions have spent on model tokens. */
  llm_cost: number;
  /** `cost` + `llm_cost`: the figure the budget is enforced against. Show THIS one next to `budget`. */
  total_cost: number;
}

/**
 * Result of executing a command in a sandbox. Mirrors `api.ExecResponse`.
 *
 * A non-zero `exit_code` means the command ran and failed; `error` is only
 * set when the command could not be run at all.
 */
export interface ExecResult {
  output: string;
  exit_code: number;
  error?: string;
}

/** Mirrors `api.CreateSandboxRequest`. */
export interface SandboxCreateParams {
  /**
   * Template name. Required — the API rejects a create with no template.
   *
   * The templates this API serves are "minimal", "node-22", "node-20",
   * "python-312", "python-311" and "desktop" (see
   * `rootfs.AvailableTemplates`). The aliases "node", "python", "gui" and
   * "computer" also resolve. Typed as `string` rather than a union so a
   * template added server-side does not need an SDK release.
   */
  template: string;
  /** Number of vCPUs, 1-8 (0 or omitted = server default). */
  cpus?: number;
  /** Memory in MB, up to 8192 (0 or omitted = server default). */
  memory_mb?: number;
  /** Disk in GB, up to 50 (0 or omitted = server default). */
  disk_gb?: number;
  /** Network mode: "none", "allowlist", "full". */
  network_mode?: "none" | "allowlist" | "full";
  /** Allowed outbound hosts. Required when network_mode is "allowlist". */
  allowlist?: string[];
  /** Environment variables injected into the sandbox. */
  env?: Record<string, string>;
  /** Git repository URL to clone. */
  repo?: string;
  /** PAT/OAuth token for private repos. */
  repo_token?: string;
  /** Branch to clone (default: main). */
  repo_branch?: string;
  /** Commit SHA to check out (overrides branch). */
  repo_commit?: string;
  /** Subdirectory within a monorepo. */
  repo_subdir?: string;
  /** Budget cap in USD. */
  budget?: number;
  /** Init script to run after clone. */
  init_script?: string;
  /** Names of env vars to treat as secrets (not logged). */
  secrets?: string[];
  /** Idle timeout in seconds. Must not be negative. */
  timeout?: number;
  /** Packages to pre-install (npm, pip, etc.). */
  packages?: string[];
  /**
   * AI agents to install. The catalogue is "claude-code", "aider",
   * "codex", "grok", "cline", "continue", "goose", plus custom MCP agents.
   */
  agents?: string[];
  /** Persona whose Environment should be merged into `env`. */
  persona_id?: string;
  /** Harness whose Environment should be merged into `env`. */
  harness_id?: string;
}

/** Mirrors `api.FileEntry`. */
export interface FileEntry {
  name: string;
  path: string;
  /** The API emits "directory", not "dir". */
  type: "file" | "directory";
  /** Size in bytes; 0 when the listing line did not parse. */
  size: number;
  /** RFC 3339 in UTC; empty string when the listing line did not parse. */
  mod_time: string;
}

/** Mirrors `api.LogEntryResponse`. */
export interface LogEntry {
  timestamp: string;
  type: string;
  message: string;
}

/** Mirrors `api.GitFileStatus`. */
export interface GitFileStatus {
  path: string;
  /** "modified", "added", "deleted" or "untracked". */
  status: string;
}

/** Mirrors the anonymous response struct of `FilesHandler.GitDiff`. */
export interface GitDiff {
  files: GitFileStatus[];
  diff: string;
  staged_diff: string;
}

/** Mirrors `api.snapshotResponse`. */
export interface Snapshot {
  id: string;
  sandbox_id: string;
  name: string;
  description: string;
  status: "pending" | "completed" | "failed";
  trigger: string;
  size_bytes: number;
  created_at: string;
  completed_at?: string;
}

export interface SnapshotCreateParams {
  name?: string;
  description?: string;
}

/** Mirrors `api.downloadResponse`. */
export interface SnapshotDownload {
  url: string;
  expires_in_seconds: number;
}

/** Mirrors `api.apiKeyResponse`. */
export interface APIKey {
  id: string;
  name: string;
  prefix: string;
  /** "full" or "read_only". */
  scope: string;
  /** RFC 3339, or null when the key has never been used. */
  last_used: string | null;
  /** RFC 3339, or null when the key does not expire. */
  expires_at: string | null;
  created_at: string;
}

/** Mirrors `api.createAPIKeyResponse`. The secret is only returned here. */
export interface CreatedAPIKey {
  /** The full secret key. Shown exactly once. */
  key: string;
  info: APIKey;
}

/** Scope of a newly created API key. */
export type APIKeyScope = "full" | "read_only";

/** Mirrors `api.accountSessionResponse` (a dashboard login session). */
export interface AccountSession {
  id: string;
  user_agent: string;
  /** The API emits `ip`, not `ip_address`. */
  ip: string;
  expires_at: string;
  created_at: string;
}

/** Mirrors `api.accountResponse`. */
export interface Account {
  id: string;
  email: string;
  name: string;
  tier: string;
  email_verified: boolean;
  created_at: string;
}

/**
 * Mirrors `api.TrustScoreSummary` — the row shape returned by
 * `GET /v1/trust/sandboxes/{id}`.
 *
 * `score` is an integer out of 100, not a 0-1 fraction, and the per-rule
 * breakdown is not part of this listing.
 */
export interface TrustScoreSummary {
  session_id: string;
  score: number;
  updated_at: string;
}

/** Mirrors `api.portResponse`. */
export interface Port {
  port: number;
  preview_url: string;
  protocol: string;
  protected: boolean;
  /** RFC 3339; absent when the host did not report a detection time. */
  detected_at?: string;
}

/**
 * Mirrors `failure.Reason` — the machine-readable half of a refusal.
 *
 * Present on refusals the API classified (`api.RefusalProblem`). Branch on
 * `code`, not on the message: `detail`/`message` is prose for a human and
 * may be reworded, `code` is stable.
 */
export interface Refusal {
  /** Stable cause, e.g. "plan_limit_reached", "policy_denied". */
  code: string;
  /** One sentence, safe to show a user. */
  message: string;
  /** Next step the caller can take, e.g. "upgrade_plan". Empty if none. */
  action?: string;
  /** What `subject_id` identifies. */
  subject_type?: string;
  /** Public ID of the thing to act on. */
  subject_id?: string;
}

/**
 * Mirrors the RFC 7807 body the API returns for every error, plus the
 * `reason` that classified refusals carry.
 */
export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  reason?: Refusal;
}

// ---------------------------------------------------------------------------
// Agent sessions and replay
// ---------------------------------------------------------------------------

/** Mirrors `api.Pagination`. */
export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export type SessionStatus = "active" | "completed" | "failed";

/**
 * Mirrors `api.sessionResponse` — one agent run inside a sandbox.
 *
 * `cost_usd` is the blended total: model spend plus this session's share of
 * its sandbox's machine time (ADR-036). `llm_cost` and `compute_cost` are its
 * two halves and `total_cost` repeats the blended figure under the name the
 * rest of the API uses. All four are always present, including zero.
 */
export interface AgentSession {
  id: string;
  sandbox_id: string;
  /** The Persona that worked this session as a Shift, or null. */
  persona_id: string | null;
  status: SessionStatus;
  agent_type: string | null;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  llm_cost: number;
  compute_cost: number;
  total_cost: number;
  /** Integer out of 100, or null when the session has not been scored. */
  trust_score: number | null;
  event_count: number;
  duration_ms: number | null;
  started_at: string;
  ended_at: string | null;
}

/** Mirrors `api.sessionListResponse`. */
export interface AgentSessionPage {
  data: AgentSession[];
  pagination: Pagination;
}

/** Mirrors `replay.Event`. */
export interface ReplayEvent {
  id: string;
  session_id: string;
  /** Monotonic within a session; feed the last one back as `after_seq`. */
  sequence: number;
  type: string;
  timestamp: string;
  duration_ms: number;
  /** Shape depends on `type`; the API does not constrain it. */
  data: unknown;
}

/**
 * Mirrors the `GET /v1/sessions/{id}/replay` body.
 *
 * The endpoint answers an object, not a bare array: page through it by
 * passing `next_seq` back as `after_seq` while `has_more` is true.
 */
export interface ReplayPage {
  events: ReplayEvent[];
  has_more: boolean;
  next_seq: number;
  total: number;
}

/**
 * Mirrors `replay.SessionSummary`.
 *
 * Event counts and wall-clock duration only — tokens and cost live on
 * {@link AgentSession}, not here.
 */
export interface ReplaySummary {
  session_id: string;
  event_count: number;
  start_time: string;
  end_time: string;
  duration_ms: number;
  /** Event count keyed by event type. */
  types: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Event ingestion
// ---------------------------------------------------------------------------

/** Event types the pipeline knows (`events.KnownTypes`); anything else is "other". */
export const EVENT_TYPES = [
  "llm_call",
  "tool_call",
  "file_op",
  "command",
  "network",
  "error",
  "lifecycle",
  "desktop",
] as const;

/**
 * One event submitted to `POST /v1/events/ingest`. Mirrors `events.Event`.
 *
 * The event body goes in `payload` — the key the server reads — and
 * free-form string tags in `meta`. `account_id` is not accepted: the server
 * stamps it from the API key. An omitted `timestamp` is filled in as "now"
 * by the SDK, because the server decodes it into a non-nullable `time.Time`
 * and rejects an event without one.
 */
export interface EventPayload {
  type: string;
  id?: string;
  sandbox_id?: string;
  session_id?: string;
  process_id?: string;
  /** RFC 3339. Defaulted to now (UTC) when omitted. */
  timestamp?: string;
  duration_ns?: number;
  meta?: Record<string, string>;
  payload?: Record<string, unknown>;
}

/** Mirrors `events.IngestResponse`. */
export interface IngestResponse {
  accepted: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertState = "open" | "resolved" | "muted";

/** Mirrors `alerts.Alert`. */
export interface Alert {
  id: string;
  account_id: string;
  rule_id: string;
  /** The rule that fired, e.g. "budget_exceeded". */
  rule_type: string;
  severity: AlertSeverity;
  state: AlertState;
  title: string;
  message: string;
  sandbox_id: string;
  session_id: string;
  meta: Record<string, string>;
  created_at: string;
  resolved_at?: string;
}

/** Mirrors the `GET /v1/alerts` body. */
export interface AlertPage {
  alerts: Alert[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Mirrors `alerts.RuleConfig`.
 *
 * Which field matters depends on the rule type: `threshold_percent` for
 * "budget_exceeded", `multiplier_threshold` for "cost_anomaly",
 * `idle_minutes` for "agent_stuck", `error_count_threshold` with
 * `window_minutes` for "error_spike", `score_threshold` for
 * "trust_score_low". Zero means "use the server's default".
 */
export interface RuleConfig {
  threshold_percent?: number;
  multiplier_threshold?: number;
  idle_minutes?: number;
  error_count_threshold?: number;
  window_minutes?: number;
  score_threshold?: number;
}

/**
 * Mirrors `alerts.Rule`. The tunables live in `config`; there is no
 * top-level threshold or cooldown, and channels are configured per account
 * through the notification config rather than per rule.
 */
export interface AlertRule {
  id: string;
  account_id: string;
  type: string;
  enabled: boolean;
  config: RuleConfig;
  created_at: string;
}

/** Body for `PUT /v1/alerts/rules/{id}`; the endpoint accepts these two fields. */
export interface AlertRuleUpdate {
  enabled?: boolean;
  config?: RuleConfig;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Mirrors `notifications.Notification`. The body key is `message`, not `body`. */
export interface Notification {
  id: string;
  account_id: string;
  alert_id: string;
  /** "slack", "discord", "email" or "in_app". */
  channel: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

/** Mirrors the `GET /v1/notifications` body. */
export interface NotificationPage {
  notifications: Notification[];
  unread_count: number;
}

/**
 * Mirrors `api.notificationConfigResponse`.
 *
 * A read never returns a credential — for a webhook the URL *is* the
 * credential — so each is reported as a `*_configured` boolean with a hint.
 */
export interface NotificationConfig {
  account_id: string;
  enabled_channels: string[];
  slack_channel_id?: string;
  email_address?: string;
  slack_webhook_configured: boolean;
  slack_webhook_hint?: string;
  slack_bot_token_configured: boolean;
  slack_bot_token_hint?: string;
  discord_webhook_configured: boolean;
  discord_webhook_hint?: string;
}

/**
 * Body for `PUT /v1/notifications/config`.
 *
 * An omitted webhook URL leaves the stored one untouched; send
 * {@link CLEAR_CREDENTIAL} to remove it. The Slack bot token cannot be set
 * through this endpoint.
 */
export interface NotificationConfigUpdate {
  /** Any of "slack", "discord", "email", "in_app". */
  enabled_channels?: string[];
  slack_channel_id?: string;
  email_address?: string;
  slack_webhook_url?: string;
  discord_webhook_url?: string;
}

/** Sent in place of a webhook URL to remove the stored one (`api.ClearCredentialSentinel`). */
export const CLEAR_CREDENTIAL = "__clear__";

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

/** Mirrors `subscription.SubscriptionStatus`. The plan name is `tier`. */
export interface Subscription {
  /** "free", "pro" or "team". The API has never called this `plan`. */
  tier: string;
  status: string;
  customer_id?: string;
  current_period_end?: string;
  cancel_at_period_end: boolean;
  trial_ends_at?: string;
}

/** Mirrors `subscription.AccountUsage` — metered compute this period. */
export interface Usage {
  /** Reported minutes plus the banked sub-minute remainder. */
  compute_minutes: number;
  reported_minutes: number;
  pending_seconds: number;
  last_reported_at?: string;
}

// ---------------------------------------------------------------------------
// WebSockets
// ---------------------------------------------------------------------------

/**
 * Mirrors `api.socketTicketResponse` — a short-lived, single-use credential
 * for one WebSocket handshake.
 */
export interface SocketTicket {
  ticket: string;
  expires_in: number;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Deprecated aliases
// ---------------------------------------------------------------------------

/**
 * @deprecated Renamed to {@link AccountSession} in 0.3.0, and its fields
 * corrected: the API emits `ip` and `expires_at`, never `ip_address` or
 * `last_active_at`. Removed no earlier than 0.5.0.
 */
export type Session = AccountSession;

/**
 * @deprecated Renamed to {@link TrustScoreSummary} in 0.3.0, and its fields
 * corrected: the listing returns `{session_id, score, updated_at}` only.
 * Removed no earlier than 0.5.0.
 */
export type TrustScore = TrustScoreSummary;

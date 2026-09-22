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

// --- third-party MCP servers -------------------------------------------------
//
// These mirror caged-api's `internal/api` MCP surface. Two of them carry the
// facts that decide whether a setup works or fails silently, so they are worth
// reading before the rest:
//
//  * `MCPPolicyAdvice` — whether policy will actually allow a bound server's
//    tools. A brokered tool name matches nothing in Caged's autonomy-tier
//    table, so a bound external tool is denied at every tier until a rule
//    allows it. Binding alone is not enough, and this type is how the SDK says
//    so rather than leaving it to the docs.
//  * `MCPToolDiff` — the definition a human approved beside the one the server
//    is advertising now. Approving a change without reading it is the outcome
//    digest pinning exists to prevent.
//
// None of these has a field for a credential or a token, and none ever will:
// Caged does not return one, and a type with a field for it would surface one
// the day the API changed.

export type MCPServerStatus = "pending" | "active" | "quarantined" | "disabled";
export type MCPToolState = "pending" | "active" | "quarantined" | "withdrawn";
export type MCPAuthKind = "none" | "bearer" | "header" | "oauth";

/**
 * How policy currently answers for one server's tools.
 *
 * `"unknown"` is never a synonym for allowed: an unresolvable policy is
 * reported as unknown, because a readiness screen that renders a resolution
 * failure as a green tick is worse than one that renders nothing.
 */
export type MCPPolicyStatus =
  | "allowed"
  | "partial"
  | "needs_approval"
  | "unclassified"
  | "denied"
  | "no_tools"
  | "unknown";

/** One registered third-party MCP server. */
export interface MCPServer {
  id: string;
  /** Tools from this server are namespaced `alias__tool`. */
  alias: string;
  display_name: string;
  description?: string;
  transport: string;
  endpoint?: string;
  catalogue_id?: string;
  /**
   * `false` for a server registered from an arbitrary URL rather than from
   * Caged's reviewed catalogue. The word also reaches the agent's model in the
   * tool framing, so it is not cosmetic.
   */
  verified: boolean;
  /** WHICH kind of credential is stored, never the value. */
  auth_kind: MCPAuthKind | string;
  protocol_era?: string;
  protocol_version?: string;
  status: MCPServerStatus | string;
  quarantine_reason?: string;
  /**
   * Set on an `oauth` registration that is not authorized yet. It names the
   * flow, so a registered-but-silent server is not a mystery.
   */
  oauth_next_step?: string;
  created_at: string;
  updated_at: string;
}

/**
 * One pinned catalogue entry.
 *
 * Named `MCPServerTool` rather than `MCPTool` because `MCPTool` already means
 * "a tool on the agent's own MCP connection" in this package. They are
 * different things and a shared name would make the wrong one importable.
 */
export interface MCPServerTool {
  /** The UPSTREAM name. */
  name: string;
  /** What an agent calls and what a policy rule matches: `alias__tool`. */
  namespaced_name: string;
  description?: string;
  state: MCPToolState | string;
  flags?: string[];
  /** Named an estimate because it is one: a measured character heuristic. */
  definition_tokens_estimate: number;
  first_seen_at?: string;
  last_seen_at?: string;
  approved_at?: string | null;
}

/** A registration plus its pinned tool catalogue. */
export interface MCPServerDetail extends MCPServer {
  tools: MCPServerTool[];
}

/**
 * What a subject may SEE.
 *
 * A binding is not authorization. It decides what is advertised; whether a call
 * is permitted is a policy decision on the namespaced name, per call. See
 * {@link MCPPolicyAdvice}.
 */
export interface MCPBinding {
  id: string;
  server_id: string;
  subject_kind: string;
  subject_id?: string;
  tool_allowlist: string[];
  tool_denylist: string[];
  pinned: boolean;
  enabled: boolean;
  argument_ceiling_bytes?: number;
  created_at: string;
}

/** Which policy and rule decided, and whether anybody can edit it. */
export interface MCPPolicyDecider {
  layer?: string;
  policy_id?: string;
  policy_name?: string;
  rule_id?: string;
  by_default?: boolean;
  /**
   * `false` for an autonomy-tier template, which is code rather than data.
   * A client must not send a reader to a policy editor that cannot reach it.
   */
  editable: boolean;
}

/**
 * Whether policy will actually allow a bound server's tools.
 *
 * Read this when brokered calls are being refused. Caged's autonomy-tier table
 * classifies its OWN tool names, so a third-party name like `github__get_issue`
 * is unclassified — and an unclassified tool is denied at **every** tier,
 * including `autonomous`.
 *
 * That default is deliberate: Caged cannot know whether a stranger's tool reads
 * an issue or wires money. `client.mcp.allow()` writes the one rule that clears
 * it; {@link mcpNeedsAllowRule} is the predicate to branch on.
 */
export interface MCPPolicyAdvice {
  server_id: string;
  alias: string;
  persona_id?: string;
  status: MCPPolicyStatus | string;
  tools_evaluated: number;
  tools_allowed: number;
  tools_paused: number;
  tools_denied: number;
  /**
   * An action token — `allow_mcp_server`, `edit_policy`,
   * `change_autonomy_tier`, `contact_support` — or absent when nothing needs
   * doing.
   */
  remedy?: string;
  rule_id?: string;
  tool_pattern?: string;
  granted_rule_exists: boolean;
  explanation: string;
  allow_endpoint?: string;
  decided_by?: MCPPolicyDecider;
}

/** What writing the policy allow rule did. */
export interface MCPGrantResult {
  policy_id: string;
  rule_id: string;
  /**
   * `true` when the persona had no stored policy and Caged created one as an
   * exact copy of its tier template plus this rule. Surfaced because "Caged
   * created a policy for this persona" is a fact to learn now, not later.
   */
  policy_created: boolean;
  tier_template_id?: string;
  tool_pattern: string;
  /** `true` when the rule was already there and nothing changed. */
  already_present: boolean;
}

/**
 * A created binding plus what still has to happen.
 *
 * `policy_advice` is why this type exists rather than returning a bare
 * {@link MCPBinding}: an operator who binds a server and is not told that its
 * tools are still denied discovers it one refused call at a time.
 */
export interface MCPBindResult extends MCPBinding {
  policy_advice?: MCPPolicyAdvice;
  policy_rule_written?: MCPGrantResult;
  /**
   * Caged's own sentence when an `allowTools` request could not be honoured.
   * The binding still exists, so this arrives on a success rather than turning
   * the whole call into a failure that leaves you unsure which half happened.
   */
  policy_rule_error?: string;
}

/**
 * What one catalogue refresh did.
 *
 * `quarantined` is the one to act on: a definition whose digest differs from
 * the stored one is held, not merged, and its tool is advertised to no agent
 * until a human decides.
 */
export interface MCPRefreshReport {
  server_id: string;
  alias: string;
  protocol_era?: string;
  protocol_version?: string;
  added: string[];
  unchanged: string[];
  changed: string[];
  withdrawn: string[];
  quarantined: string[];
}

/** One server Caged has reviewed. Registering from here is VERIFIED. */
export interface MCPCatalogueEntry {
  id: string;
  display_name: string;
  description?: string;
  endpoint?: string;
  transport: string;
  auth_kind: string;
  default_alias?: string;
}

/** One definition a server has advertised, and the decision about it. */
export interface MCPToolRevision {
  description: string;
  input_schema?: Record<string, unknown>;
  flags?: string[];
  decision: "pending" | "approved" | "rejected" | string;
  note?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  definition_tokens_estimate?: number;
}

/**
 * What changed between the approved definition and the current one.
 *
 * `approved` is absent when nothing has ever been approved: a first sighting
 * has nothing to compare against, and `explanation` says so rather than reading
 * as "nothing changed".
 *
 * `added_properties` is the one to read first. A new parameter on an existing
 * tool is how a tool acquires a field an agent can be talked into filling with
 * a secret.
 */
export interface MCPToolDiff {
  alias: string;
  tool_name: string;
  namespaced_name: string;
  state: string;
  approved?: MCPToolRevision;
  current?: MCPToolRevision;
  changed: string[];
  added_properties: string[];
  removed_properties: string[];
  approved_digest?: string;
  current_digest?: string;
  explanation: string;
  approve_endpoint?: string;
  reject_endpoint?: string;
}

/**
 * What is currently authorized. There is no field for a token.
 *
 * Caged holds the token itself: sealed at rest, never written into a sandbox,
 * never in an environment variable, and never returned by any read.
 */
export interface MCPOAuthStatus {
  server_id: string;
  authorized: boolean;
  issuer?: string;
  scopes?: string[];
  expires_at?: string;
  has_refresh_token: boolean;
  obtained_at?: string;
  /** Reported rather than hidden: calls start failing when this is true. */
  expired: boolean;
}

/**
 * One recorded human decision.
 *
 * `persona_id` absent is an ACCOUNT-wide consent, which is a real and different
 * decision from a per-persona one. A persona's own consent outranks the
 * account-wide one.
 */
export interface MCPOAuthConsent {
  id: string;
  account_id?: string;
  persona_id?: string;
  server_id: string;
  issuer: string;
  scopes: string[];
  granted_by?: string;
  granted_at: string;
  revoked_at?: string | null;
}

/**
 * What authorizing would involve — the consent screen's contents.
 *
 * Nothing is minted or stored to produce this. It is the READ that comes before
 * the decision, which is the order the confused-deputy mitigation depends on.
 */
export interface MCPOAuthProspect {
  server_id: string;
  alias: string;
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  resource_name?: string;
  resource: string;
  scopes: string[];
  client_id_metadata_document_supported: boolean;
  /**
   * Caged's own sentence for the screen: what is about to happen, in the order
   * it happens. Show it to the human. Recording a consent from a discovered
   * value nobody read is not a consent.
   */
  consent_statement: string;
}

/** The OAuth surface for one server: status, consents, and the prospect. */
export interface MCPOAuthState {
  status: MCPOAuthStatus;
  consents: MCPOAuthConsent[];
  prospect?: MCPOAuthProspect;
  /**
   * Set when discovery failed. Reported alongside a real `status` rather than
   * replacing it: what is authorized is still true when a third party's
   * metadata endpoint is down.
   */
  discovery_error?: string;
}

/** The URL to open, and how long it is live for. */
export interface MCPOAuthAuthorization {
  authorization_url: string;
  expires_in_seconds: number;
  note?: string;
}

/** One question a third-party server asked, sanitised by the API. */
export interface MCPInputQuestion {
  id?: string;
  /**
   * From a closed set: `elicitation`, `roots`, `url`, `unknown`. An
   * unrecognised upstream kind arrives as `unknown` rather than being defaulted
   * to `elicitation`.
   */
  kind: string;
  message: string;
  /** The requested JSON Schema, for rendering a form. */
  schema?: Record<string, unknown>;
}

/**
 * A question set waiting on a person.
 *
 * The call it belongs to has already returned to the agent with "a human has
 * been asked, retry later". Answering this makes the agent's next attempt at the
 * same call complete; Caged does not re-send the call itself, because a tool
 * call whose side effect may be half-done must not be repeated by
 * infrastructure.
 */
export interface MCPInputRequest {
  id: string;
  sandbox_id: string;
  server_id?: string;
  alias: string;
  /** The namespaced name the agent used. */
  tool: string;
  round: number;
  round_limit: number;
  state: string;
  questions: MCPInputQuestion[];
  approval_id?: string;
  created_at: string;
  expires_at: string;
}

/** Register a third-party MCP server. */
export interface MCPServerCreateParams {
  /** Register from Caged's reviewed catalogue. Mutually useful with `endpoint`. */
  catalogueId?: string;
  alias?: string;
  endpoint?: string;
  displayName?: string;
  description?: string;
  authKind?: MCPAuthKind | string;
  /** Sealed by the API immediately; never returned by any read. */
  credential?: string;
  headers?: Record<string, string>;
}

/** Bind a server to a subject. */
export interface MCPBindParams {
  /** Omit for an account-wide binding, which every persona sees. */
  personaId?: string;
  /** Upstream tool names. Empty means every approved tool on the server. */
  tools?: string[];
  deny?: string[];
  /** Never defer these tools behind the projection token budget. */
  pinned?: boolean;
  argumentCeilingBytes?: number;
  /**
   * Also write the policy rule that makes these tools callable.
   *
   * Defaults to `false` on purpose: binding a server and granting its tools are
   * two decisions, and folding them together by default would make "I bound it
   * to look at its catalogue" mean "I allowed it". What was wrong before was
   * not that the grant was separate — it was that it was invisible, which is
   * why {@link MCPBindResult} always carries the advice.
   */
  allowTools?: boolean;
}

/**
 * Whether one `allow` call would make a bound server's tools callable.
 *
 * A function rather than a field, because the API's response is data and a
 * derived boolean on it would be a second place for the rule to live.
 */
export function mcpNeedsAllowRule(advice: MCPPolicyAdvice): boolean {
  return advice.remedy === "allow_mcp_server" && !advice.granted_rule_exists;
}

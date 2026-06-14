/** Configuration for the Caged client. */
export interface CagedConfig {
  /** API key (starts with `caged_sk_`). */
  apiKey: string;
  /** Base URL override (default: https://api.caged.dev). */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000). */
  timeout?: number;
}

export type SandboxStatus =
  | "pending"
  | "running"
  | "paused"
  | "stopped"
  | "error"
  | "destroyed";

export interface Sandbox {
  id: string;
  status: SandboxStatus;
  template: string;
  cpus: number;
  memory_mb: number;
  disk_gb: number;
  network_mode: string;
  ip?: string;
  repo_url?: string;
  /** Budget cap in USD. */
  budget?: number;
  init_script?: string;
  /** Idle timeout in seconds. */
  timeout?: number;
  created_at: string;
}

/**
 * Result of executing a command in a sandbox.
 *
 * A non-zero `exit_code` means the command ran and failed; `error` is only
 * set for infrastructure failures (sandbox unreachable, etc.).
 */
export interface ExecResult {
  output: string;
  exit_code: number;
  error?: string;
}

export interface SandboxCreateParams {
  /** Template name: "node-20", "python-312", "go-122", "minimal". */
  template?: string;
  /** Number of vCPUs (default: 2). */
  cpus?: number;
  /** Memory in MB (default: 512; min 1024 when agents are installed). */
  memory_mb?: number;
  /** Disk in GB (default: 5). */
  disk_gb?: number;
  /** Network mode: "none", "allowlist", "full" (default: "full"). */
  network_mode?: string;
  /** Allowed outbound hosts when network_mode is "allowlist". */
  allowlist?: string[];
  /** Environment variables injected into the sandbox. */
  env?: Record<string, string>;
  /** Git repository URL to clone. */
  repo?: string;
  /** Branch to clone (default: main). */
  repo_branch?: string;
  /** Commit SHA to checkout. */
  repo_commit?: string;
  /** Subdirectory within monorepo. */
  repo_subdir?: string;
  /** PAT/OAuth token for private repos. */
  repo_token?: string;
  /** Init script to run after clone. */
  init_script?: string;
  /** Names of env vars to treat as secrets (not logged). */
  secrets?: string[];
  /** Budget cap in USD. */
  budget?: number;
  /** Idle timeout in seconds (default: 900). */
  timeout?: number;
  /** Packages to pre-install (npm, pip, etc.). */
  packages?: string[];
  /** AI agents to install: "claude", "aider", "codex". */
  agents?: string[];
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  modified?: string;
}

export interface Snapshot {
  id: string;
  sandbox_id: string;
  account_id: string;
  name: string;
  description?: string;
  trigger: string;
  status: "pending" | "completed" | "failed";
  size_bytes?: number;
  created_at: string;
  completed_at?: string;
}

export interface SnapshotCreateParams {
  name?: string;
  description?: string;
}

export interface APIKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at?: string;
}

export interface Session {
  id: string;
  user_agent: string;
  ip_address: string;
  created_at: string;
  last_active_at: string;
}

export interface TrustScore {
  session_id: string;
  sandbox_id: string;
  score: number;
  factors: Record<string, number>;
  updated_at: string;
}

export interface Port {
  port: number;
  protocol: string;
  state: string;
  url?: string;
}

// --- Logs ---

export interface LogEntry {
  timestamp: string;
  type: string;
  message: string;
}

// --- Agent Sessions ---

export interface AgentSession {
  id: string;
  sandbox_id: string;
  status: "active" | "completed" | "failed";
  agent_type?: string;
  model?: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  trust_score?: number;
  event_count: number;
  duration_ms?: number;
  started_at: string;
  ended_at?: string;
}

// --- Replay ---

export interface ReplayEvent {
  id: string;
  session_id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ReplaySummary {
  session_id: string;
  total_events: number;
  duration_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  trust_score?: number;
  tools_used: string[];
  files_modified: string[];
}

// --- Events ---

export interface EventPayload {
  id?: string;
  type: string;
  sandbox_id: string;
  session_id?: string;
  timestamp?: string;
  data: Record<string, unknown>;
}

export interface IngestResponse {
  accepted: number;
  errors: number;
}

// --- Alerts ---

export interface Alert {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  sandbox_id?: string;
  resolved: boolean;
  resolved_at?: string;
  created_at: string;
}

export interface AlertRule {
  id: string;
  type: string;
  enabled: boolean;
  threshold?: number;
  cooldown_minutes?: number;
  channels: string[];
}

// --- Notifications ---

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  alert_id?: string;
  created_at: string;
}

export interface NotificationConfig {
  email_enabled: boolean;
  slack_enabled: boolean;
  slack_webhook_url?: string;
  discord_enabled: boolean;
  discord_webhook_url?: string;
  channels: Record<string, boolean>;
}

// --- Billing ---

export interface Subscription {
  plan: string;
  status: "active" | "trialing" | "canceled" | "past_due" | "none";
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  trial_end?: string;
}

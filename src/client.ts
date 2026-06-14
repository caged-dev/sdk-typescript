import { CagedAPIError, CagedTimeoutError } from "./errors";
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
    return this.client.request<ExecResult>(
      "POST",
      `/sandboxes/${id}/exec`,
      { command },
      timeoutMs
    );
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

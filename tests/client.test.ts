import { describe, expect, it, vi } from "vitest";
import { harness, type StubResponse } from "./mockFetch";
import { Caged } from "../src/client";
import {
  CagedAPIError,
  CagedAuthError,
  CagedConnectionError,
  CagedError,
  CagedNotFoundError,
  CagedPlanLimitError,
  CagedRateLimitError,
  CagedServerError,
  CagedTimeoutError,
  CagedValidationError,
} from "../src/errors";
import { VERSION } from "../src/version";

// Response bodies copied from the Go response structs in internal/api.
const SANDBOX = {
  id: "sbx_1",
  status: "running",
  template: "node-20",
  cpus: 2,
  memory_mb: 1024,
  disk_gb: 5,
  network_mode: "full",
  created_at: "2026-09-20T00:00:00Z",
  // `cost` is accrued machine time alone. The budget is enforced against
  // the sum of both halves, which is `total_cost`.
  cost: 0,
  llm_cost: 0,
  total_cost: 0,
};
const SNAPSHOT = {
  id: "snap_1",
  sandbox_id: "sbx_1",
  name: "cp1",
  description: "",
  status: "completed",
  trigger: "manual",
  size_bytes: 123,
  created_at: "2026-09-20T00:00:00Z",
};
const API_KEY = {
  id: "key_1",
  name: "ci",
  prefix: "caged_sk_ab",
  scope: "full",
  last_used: null,
  expires_at: "2026-12-20T00:00:00Z",
  created_at: "2026-09-20T00:00:00Z",
};
const PORT = {
  port: 3000,
  preview_url: "https://p.caged.dev/3000",
  protocol: "http",
  protected: false,
  detected_at: "2026-09-20T00:00:00Z",
};
const FILE_ENTRY = {
  name: "a.js",
  path: "/workspace/a.js",
  type: "file",
  size: 10,
  mod_time: "2026-09-20T00:00:00Z",
};

function problem(status: number, title: string, detail: string): StubResponse {
  return {
    status,
    json: { type: `https://caged.dev/errors/${title}`, title, status, detail },
    contentType: "application/problem+json",
  };
}

describe("constructor", () => {
  it("rejects a missing API key with a Caged error", () => {
    expect(() => new Caged({ apiKey: "" })).toThrow(CagedError);
  });

  it("strips trailing slashes from baseUrl so paths never double up", async () => {
    const h = harness([{ json: [SANDBOX] }], { baseUrl: "https://api.example.test///" });
    await h.caged.sandboxes.list();
    expect(h.only().url).toBe("https://api.example.test/v1/sandboxes");
  });

  it("sends auth and user-agent headers on the very first request", async () => {
    const h = harness([{ json: [SANDBOX] }]);
    await h.caged.sandboxes.list();
    const req = h.only();
    expect(req.headers["authorization"]).toBe("Bearer caged_sk_test");
    expect(req.headers["user-agent"]).toBe(`@caged-dev/sdk/${VERSION}`);
  });

  it("does not set Content-Type on a request with no body", async () => {
    const h = harness([{ status: 204 }]);
    await h.caged.sandboxes.pause("sbx_1");
    expect(h.only().headers["content-type"]).toBeUndefined();
  });
});

describe("first call on a fresh client", () => {
  // Regression for the reported defect: every method must work when it is
  // the first thing the client does, with no prior call to warm any state.
  const cases: Array<[string, StubResponse[], (c: Caged) => Promise<unknown>]> = [
    ["sandboxes.create", [{ status: 201, json: SANDBOX }], (c) => c.sandboxes.create({ template: "node-20" })],
    ["sandboxes.list", [{ json: [SANDBOX] }], (c) => c.sandboxes.list()],
    ["sandboxes.get", [{ json: SANDBOX }], (c) => c.sandboxes.get("sbx_1")],
    ["sandboxes.exec", [{ json: { output: "hi", exit_code: 0 } }], (c) => c.sandboxes.exec("sbx_1", "echo hi")],
    ["sandboxes.pause", [{ status: 204 }], (c) => c.sandboxes.pause("sbx_1")],
    ["sandboxes.resume", [{ status: 204 }], (c) => c.sandboxes.resume("sbx_1")],
    ["sandboxes.destroy", [{ status: 204 }], (c) => c.sandboxes.destroy("sbx_1")],
    ["sandboxes.ports", [{ json: [PORT] }], (c) => c.sandboxes.ports("sbx_1")],
    ["sandboxes.logs", [{ json: [{ timestamp: "t", type: "lifecycle", message: "m" }] }], (c) => c.sandboxes.logs("sbx_1")],
    ["sandboxes.trustScores", [{ json: [{ session_id: "s1", score: 90, updated_at: "t" }] }], (c) => c.sandboxes.trustScores("sbx_1")],
    ["files.list", [{ json: [FILE_ENTRY] }], (c) => c.files.list("sbx_1")],
    ["files.read", [{ text: "console.log('hi')" }], (c) => c.files.read("sbx_1", "/workspace/a.js")],
    ["files.write", [{ json: { status: "ok", path: "/workspace/a.js" } }], (c) => c.files.write("sbx_1", "/workspace/a.js", "x")],
    ["files.gitDiff", [{ json: { files: [], diff: "", staged_diff: "" } }], (c) => c.files.gitDiff("sbx_1")],
    ["snapshots.list", [{ json: [SNAPSHOT] }], (c) => c.snapshots.list("sbx_1")],
    ["snapshots.create", [{ status: 201, json: SNAPSHOT }], (c) => c.snapshots.create("sbx_1", { name: "cp1" })],
    ["snapshots.get", [{ json: SNAPSHOT }], (c) => c.snapshots.get("snap_1")],
    ["snapshots.delete", [{ status: 204 }], (c) => c.snapshots.delete("snap_1")],
    ["snapshots.download", [{ json: { url: "https://s3/x", expires_in_seconds: 3600 } }], (c) => c.snapshots.download("snap_1")],
    ["snapshots.restore", [{ json: { status: "restored" } }], (c) => c.snapshots.restore("snap_1", "sbx_2")],
    ["account.get", [{ json: { id: "a", email: "e", name: "n", tier: "free", email_verified: true, created_at: "t" } }], (c) => c.account.get()],
    ["account.listKeys", [{ json: [API_KEY] }], (c) => c.account.listKeys()],
    ["account.createKey", [{ status: 201, json: { key: "caged_sk_secret", info: API_KEY } }], (c) => c.account.createKey("ci")],
    ["account.revokeKey", [{ status: 204 }], (c) => c.account.revokeKey("key_1")],
    ["account.listSessions", [{ json: [{ id: "s", user_agent: "ua", ip: "1.2.3.4", expires_at: "t", created_at: "t" }] }], (c) => c.account.listSessions()],
    ["account.revokeSession", [{ status: 204 }], (c) => c.account.revokeSession("s")],
  ];

  for (const [name, responses, call] of cases) {
    it(`${name} succeeds as the first call`, async () => {
      const h = harness(responses);
      await expect(call(h.caged)).resolves.not.toThrow();
      expect(h.requests).toHaveLength(1);
    });
  }
});

describe("request shapes the API actually requires", () => {
  it("files.write puts the path in the query string, not only the body", async () => {
    const h = harness([{ json: { status: "ok", path: "/workspace/a.js" } }]);
    await h.caged.files.write("sbx_1", "/workspace/a.js", "hello");
    const req = h.only();
    expect(req.method).toBe("PUT");
    expect(req.path).toBe("/v1/sandboxes/sbx_1/files/content");
    expect(req.query.get("path")).toBe("/workspace/a.js");
    expect(JSON.parse(req.body!)).toEqual({ content: "hello" });
  });

  it("files.read returns raw text rather than parsing it as JSON", async () => {
    const h = harness([{ text: "console.log('hi')\n" }]);
    await expect(h.caged.files.read("sbx_1", "/workspace/a.js")).resolves.toBe(
      "console.log('hi')\n"
    );
    expect(h.only().query.get("path")).toBe("/workspace/a.js");
  });

  it("files.list defaults to /workspace, matching the API default", async () => {
    const h = harness([{ json: [FILE_ENTRY] }]);
    await h.caged.files.list("sbx_1");
    expect(h.only().query.get("path")).toBe("/workspace");
  });

  it("snapshots.restore sends the required target_sandbox_id", async () => {
    const h = harness([{ json: { status: "restored" } }]);
    await h.caged.snapshots.restore("snap_1", "sbx_2");
    expect(JSON.parse(h.only().body!)).toEqual({ target_sandbox_id: "sbx_2" });
  });

  it("snapshots.restore refuses an empty target before hitting the network", async () => {
    const h = harness([{ json: {} }]);
    await expect(h.caged.snapshots.restore("snap_1", "")).rejects.toBeInstanceOf(CagedError);
    expect(h.requests).toHaveLength(0);
  });

  it("sandboxes.create refuses a missing template before hitting the network", async () => {
    const h = harness([{ json: SANDBOX }]);
    // @ts-expect-error template is required by the type; guard the runtime too.
    await expect(h.caged.sandboxes.create({})).rejects.toBeInstanceOf(CagedError);
    expect(h.requests).toHaveLength(0);
  });

  it("account.createKey defaults the scope the API validates", async () => {
    const h = harness([{ status: 201, json: { key: "k", info: API_KEY } }]);
    await h.caged.account.createKey("ci");
    expect(JSON.parse(h.only().body!)).toEqual({ name: "ci", scope: "full" });
  });

  it("encodes path segments so an odd ID cannot escape the route", async () => {
    const h = harness([{ json: SANDBOX }]);
    await h.caged.sandboxes.get("a/../b");
    expect(h.only().path).toBe("/v1/sandboxes/a%2F..%2Fb");
  });
});

describe("response shapes", () => {
  it("parses a port with the preview_url the API emits", async () => {
    const h = harness([{ json: [PORT] }]);
    const ports = await h.caged.sandboxes.ports("sbx_1");
    expect(ports[0]!.preview_url).toBe("https://p.caged.dev/3000");
    expect(ports[0]!.protected).toBe(false);
  });

  it("parses a file entry with mod_time and type=directory", async () => {
    const h = harness([{ json: [{ ...FILE_ENTRY, type: "directory" }] }]);
    const entries = await h.caged.files.list("sbx_1");
    expect(entries[0]!.type).toBe("directory");
    expect(entries[0]!.mod_time).toBe("2026-09-20T00:00:00Z");
  });

  it("returns the git diff object, not a bare string", async () => {
    const h = harness([
      { json: { files: [{ path: "a.js", status: "modified" }], diff: "d", staged_diff: "" } },
    ]);
    const diff = await h.caged.files.gitDiff("sbx_1");
    expect(diff.files[0]!.status).toBe("modified");
    expect(diff.diff).toBe("d");
  });

  it("separates the one-time secret from the key metadata", async () => {
    const h = harness([{ status: 201, json: { key: "caged_sk_secret", info: API_KEY } }]);
    const created = await h.caged.account.createKey("ci");
    expect(created.key).toBe("caged_sk_secret");
    expect(created.info.scope).toBe("full");
  });

  it("returns the download URL with its expiry", async () => {
    const h = harness([{ json: { url: "https://s3/x", expires_in_seconds: 3600 } }]);
    const dl = await h.caged.snapshots.download("snap_1");
    expect(dl.url).toBe("https://s3/x");
    expect(dl.expires_in_seconds).toBe(3600);
  });

  it("reports a JSON endpoint that answered non-JSON instead of throwing SyntaxError", async () => {
    const h = harness([{ text: "<html>502</html>", contentType: "text/html" }]);
    await expect(h.caged.sandboxes.list()).rejects.toThrowError(/not JSON/);
  });
});

describe("errors", () => {
  it("surfaces the problem+json detail rather than the bare status", async () => {
    const h = harness([problem(400, "Bad Request", "missing path parameter")]);
    await expect(h.caged.files.write("sbx_1", "/a", "x")).rejects.toThrowError(
      "missing path parameter"
    );
  });

  it("falls back to the title when there is no detail", async () => {
    const h = harness([
      { status: 400, json: { title: "Bad Request", status: 400 }, contentType: "application/problem+json" },
    ]);
    await expect(h.caged.sandboxes.list()).rejects.toThrowError("Bad Request (HTTP 400)");
  });

  it('understands the legacy {"error": ...} body some handlers still send', async () => {
    const h = harness([{ status: 400, json: { error: "target_sandbox_id required" } }]);
    await expect(h.caged.snapshots.restore("snap_1", "sbx_2")).rejects.toThrowError(
      "target_sandbox_id required"
    );
  });

  it("maps statuses onto specific error classes", async () => {
    const cases: Array<[number, unknown]> = [
      [400, CagedValidationError],
      [401, CagedAuthError],
      [403, CagedAuthError],
      [404, CagedNotFoundError],
      [429, CagedRateLimitError],
      [500, CagedServerError],
    ];
    for (const [status, cls] of cases) {
      const h = harness([problem(status, "x", "y")]);
      await expect(h.caged.sandboxes.get("sbx_1")).rejects.toBeInstanceOf(
        cls as new () => Error
      );
    }
  });

  it("keeps the raw body and status on the error for callers that need it", async () => {
    const h = harness([problem(404, "Not Found", "sandbox not found")]);
    const err = await h.caged.sandboxes.get("sbx_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CagedNotFoundError);
    const api = err as CagedNotFoundError;
    expect(api.status).toBe(404);
    expect(api.problem?.detail).toBe("sandbox not found");
    expect(api.body).toContain("sandbox not found");
  });

  it("raises a timeout error, not a raw AbortError", async () => {
    const fetchImpl: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const caged = new Caged({
      apiKey: "caged_sk_test",
      baseUrl: "https://api.example.test",
      timeout: 10,
      fetch: fetchImpl,
    });
    await expect(caged.sandboxes.list()).rejects.toBeInstanceOf(CagedTimeoutError);
  });

  it("wraps a transport failure as a connection error naming the call", async () => {
    const fetchImpl: typeof globalThis.fetch = () =>
      Promise.reject(new TypeError("fetch failed"));
    const caged = new Caged({
      apiKey: "caged_sk_test",
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    });
    const err = await caged.sandboxes.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CagedConnectionError);
    expect((err as Error).message).toContain("GET /sandboxes");
  });
});

describe("classified refusals", () => {
  // Body observed from a real locally booted API server: internal/api's
  // errRefused writes the RFC 7807 fields plus failure.Reason under "reason".
  const PLAN_LIMIT: StubResponse = {
    status: 403,
    contentType: "application/problem+json",
    json: {
      type: "https://caged.dev/errors/Forbidden",
      title: "Forbidden",
      status: 403,
      detail:
        "plan limit reached: you already have 1 API keys, which is your plan's limit — upgrade for more",
      reason: {
        code: "plan_limit_reached",
        message:
          "plan limit reached: you already have 1 API keys, which is your plan's limit — upgrade for more",
        action: "upgrade_plan",
      },
    },
  };

  it("does not report a plan limit as an auth failure", async () => {
    // Both arrive as 403. Telling a caller their key is invalid when the key
    // is fine and the plan is the problem sends them to the wrong fix.
    const h = harness([PLAN_LIMIT]);
    const err = await h.caged.account.createKey("second").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CagedPlanLimitError);
    const api = err as CagedPlanLimitError;
    expect(api.reason?.code).toBe("plan_limit_reached");
    expect(api.reason?.action).toBe("upgrade_plan");
    expect(api.message).toContain("upgrade for more");
  });

  it("keeps a plan limit catchable as CagedAPIError", async () => {
    const h = harness([PLAN_LIMIT]);
    await expect(h.caged.account.createKey("second")).rejects.toBeInstanceOf(CagedAPIError);
  });

  it("leaves a plain auth failure as an auth error with no reason", async () => {
    const h = harness([problem(403, "Forbidden", "this key is read-only")]);
    const err = await h.caged.sandboxes.create({ template: "node-20" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CagedAuthError);
    expect((err as CagedAuthError).reason).toBeNull();
  });

  it("reports a chi 404 with a plain-text body usefully", async () => {
    // A genuinely unregistered route answers chi's plain text, not JSON.
    const h = harness([{ status: 404, text: "404 page not found" }]);
    await expect(h.caged.sandboxes.get("sbx_1")).rejects.toThrowError("404 page not found");
  });
});

describe("deprecations", () => {
  it("keeps downloadUrl working but warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness([{ json: { url: "https://s3/x", expires_in_seconds: 3600 } }]);
    const dl = await h.caged.snapshots.downloadUrl("snap_1");
    expect(dl.url).toBe("https://s3/x");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("download()"));
    warn.mockRestore();
  });

  it("keeps trustScore working but warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness([{ json: [{ session_id: "s1", score: 90, updated_at: "t" }] }]);
    const scores = await h.caged.sandboxes.trustScore("sbx_1");
    expect(scores[0]!.score).toBe(90);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("trustScores"));
    warn.mockRestore();
  });
});

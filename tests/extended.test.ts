/**
 * The surface that exists only in this repository.
 *
 * These methods were never covered by the repairs made in `caged-api`'s
 * internal copy, because the internal copy does not have them. Each shape
 * here is copied from the Go handler that serves it.
 */
import { describe, expect, it } from "vitest";
import { harness, type StubResponse } from "./mockFetch";
import type { Caged } from "../src/client";
import { CagedError } from "../src/errors";

const SESSION = {
  id: "ses_1",
  sandbox_id: "sbx_1",
  persona_id: null,
  status: "completed",
  agent_type: "claude-code",
  model: "claude-4",
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.42,
  llm_cost: 0.3,
  compute_cost: 0.12,
  total_cost: 0.42,
  trust_score: 88,
  event_count: 12,
  duration_ms: 4000,
  started_at: "2026-09-20T00:00:00Z",
  ended_at: "2026-09-20T00:01:00Z",
};

const ALERT = {
  id: "alr_1",
  account_id: "acc_1",
  rule_id: "rul_1",
  rule_type: "budget_exceeded",
  severity: "warning",
  state: "open",
  title: "Budget 80% spent",
  message: "sbx_1 has spent $8 of $10",
  sandbox_id: "sbx_1",
  session_id: "",
  meta: {},
  created_at: "2026-09-20T00:00:00Z",
};

const RULE = {
  id: "rul_1",
  account_id: "acc_1",
  type: "budget_exceeded",
  enabled: true,
  config: { threshold_percent: 80 },
  created_at: "2026-09-20T00:00:00Z",
};

const NOTIFICATION = {
  id: "ntf_1",
  account_id: "acc_1",
  alert_id: "alr_1",
  channel: "in_app",
  title: "Budget 80% spent",
  message: "sbx_1 has spent $8 of $10",
  read: false,
  created_at: "2026-09-20T00:00:00Z",
};

const NOTIFICATION_CONFIG = {
  account_id: "acc_1",
  enabled_channels: ["in_app", "slack"],
  slack_channel_id: "C123",
  slack_webhook_configured: true,
  slack_webhook_hint: "https://hooks.slack.com/…abc",
  slack_bot_token_configured: false,
  discord_webhook_configured: false,
};

describe("first call on a fresh client — the shipping-only surface", () => {
  const cases: Array<[string, StubResponse[], (c: Caged) => Promise<unknown>]> = [
    [
      "sessions.list",
      [{ json: { data: [SESSION], pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 } } }],
      (c) => c.sessions.list(),
    ],
    ["sessions.listBySandbox", [{ json: [SESSION] }], (c) => c.sessions.listBySandbox("sbx_1")],
    ["sessions.get", [{ json: SESSION }], (c) => c.sessions.get("ses_1")],
    [
      "sessions.replay",
      [{ json: { events: [], has_more: false, next_seq: 0, total: 0 } }],
      (c) => c.sessions.replay("ses_1"),
    ],
    [
      "sessions.replaySummary",
      [{ json: { session_id: "ses_1", event_count: 3, start_time: "t", end_time: "t", duration_ms: 1, types: { command: 3 } } }],
      (c) => c.sessions.replaySummary("ses_1"),
    ],
    [
      "events.ingest",
      [{ json: { accepted: 1, errors: 0 } }],
      (c) => c.events.ingest([{ type: "llm_call", sandbox_id: "sbx_1", payload: {} }]),
    ],
    ["alerts.list", [{ json: { alerts: [ALERT], total: 1, limit: 50, offset: 0 } }], (c) => c.alerts.list()],
    ["alerts.get", [{ json: ALERT }], (c) => c.alerts.get("alr_1")],
    ["alerts.resolve", [{ status: 204 }], (c) => c.alerts.resolve("alr_1")],
    ["alerts.listRules", [{ json: [RULE] }], (c) => c.alerts.listRules()],
    ["alerts.updateRule", [{ json: RULE }], (c) => c.alerts.updateRule("rul_1", { enabled: false })],
    [
      "notifications.list",
      [{ json: { notifications: [NOTIFICATION], unread_count: 1 } }],
      (c) => c.notifications.list(),
    ],
    [
      "notifications.listUnread",
      [{ json: { notifications: [NOTIFICATION], unread_count: 1 } }],
      (c) => c.notifications.listUnread(),
    ],
    ["notifications.unreadCount", [{ json: { unread_count: 4 } }], (c) => c.notifications.unreadCount()],
    ["notifications.markRead", [{ status: 204 }], (c) => c.notifications.markRead("ntf_1")],
    ["notifications.markAllRead", [{ status: 204 }], (c) => c.notifications.markAllRead()],
    ["notifications.getConfig", [{ json: NOTIFICATION_CONFIG }], (c) => c.notifications.getConfig()],
    [
      "notifications.updateConfig",
      [{ json: NOTIFICATION_CONFIG }],
      (c) => c.notifications.updateConfig({ enabled_channels: ["in_app"] }),
    ],
    [
      "billing.getSubscription",
      [{ json: { tier: "pro", status: "active", cancel_at_period_end: false } }],
      (c) => c.billing.getSubscription(),
    ],
    [
      "billing.getUsage",
      [{ json: { compute_minutes: 12, reported_minutes: 12, pending_seconds: 30 } }],
      (c) => c.billing.getUsage(),
    ],
    ["billing.createCheckout", [{ json: { url: "https://checkout" } }], (c) => c.billing.createCheckout("pro")],
    ["billing.createPortal", [{ json: { url: "https://portal" } }], (c) => c.billing.createPortal()],
    ["billing.cancel", [{ status: 204 }], (c) => c.billing.cancel()],
    ["socketTicket", [{ json: { ticket: "caged_wst_a.b", expires_in: 60, expires_at: "t" } }], (c) => c.socketTicket()],
  ];

  for (const [name, responses, call] of cases) {
    it(`${name} succeeds as the first call`, async () => {
      const h = harness(responses);
      await expect(call(h.caged)).resolves.not.toThrow();
      expect(h.requests).toHaveLength(1);
    });
  }
});

describe("response shapes that are objects, not arrays", () => {
  it("reads the alerts out of the alert page", async () => {
    const h = harness([{ json: { alerts: [ALERT], total: 7, limit: 50, offset: 0 } }]);
    const page = await h.caged.alerts.list({ limit: 50 });
    expect(page.alerts[0]!.title).toBe("Budget 80% spent");
    expect(page.total).toBe(7);
    expect(h.only().query.get("limit")).toBe("50");
  });

  it("reads the notifications and the badge count out of the notification page", async () => {
    const h = harness([{ json: { notifications: [NOTIFICATION], unread_count: 1 } }]);
    const page = await h.caged.notifications.list();
    expect(page.notifications[0]!.message).toContain("$8 of $10");
    expect(page.unread_count).toBe(1);
  });

  it("asks for only the unread ones when told to", async () => {
    const h = harness([{ json: { notifications: [], unread_count: 0 } }]);
    await h.caged.notifications.listUnread(5);
    expect(h.only().query.get("unread")).toBe("true");
    expect(h.only().query.get("limit")).toBe("5");
  });

  it("reads unread_count, not count", async () => {
    const h = harness([{ json: { unread_count: 4 } }]);
    await expect(h.caged.notifications.unreadCount()).resolves.toBe(4);
  });

  it("refuses a body with no unread_count rather than returning NaN", async () => {
    const h = harness([{ json: { count: 4 } }]);
    await expect(h.caged.notifications.unreadCount()).rejects.toBeInstanceOf(CagedError);
  });

  it("pages the replay timeline by sequence", async () => {
    const h = harness([
      { json: { events: [{ id: "e1", session_id: "ses_1", sequence: 7, type: "command", timestamp: "t", duration_ms: 1, data: {} }], has_more: true, next_seq: 7, total: 9 } },
    ]);
    const page = await h.caged.sessions.replay("ses_1", { afterSeq: 3, limit: 10, type: "command" });
    expect(page.events[0]!.sequence).toBe(7);
    expect(page.has_more).toBe(true);
    const req = h.only();
    expect(req.query.get("after_seq")).toBe("3");
    expect(req.query.get("limit")).toBe("10");
    expect(req.query.get("type")).toBe("command");
  });

  it("reports a session's cost as two halves and their sum", async () => {
    const h = harness([{ json: SESSION }]);
    const session = await h.caged.sessions.get("ses_1");
    expect(session.llm_cost + session.compute_cost).toBeCloseTo(session.total_cost);
  });

  it("returns the checkout URL as a string, not a wrapper object", async () => {
    const h = harness([{ json: { url: "https://checkout" } }]);
    await expect(h.caged.billing.createCheckout("pro")).resolves.toBe("https://checkout");
  });

  it("refuses a checkout response with no url", async () => {
    const h = harness([{ json: {} }]);
    await expect(h.caged.billing.createCheckout("pro")).rejects.toBeInstanceOf(CagedError);
  });

  it("reads the plan name from tier, which is what the API calls it", async () => {
    const h = harness([{ json: { tier: "team", status: "active", cancel_at_period_end: false } }]);
    await expect(h.caged.billing.getSubscription()).resolves.toMatchObject({ tier: "team" });
  });

  it("keeps a rule's tunables nested under config", async () => {
    const h = harness([{ json: [RULE] }]);
    const rules = await h.caged.alerts.listRules();
    expect(rules[0]!.config.threshold_percent).toBe(80);
  });
});

describe("request shapes the API actually requires", () => {
  it("sends the checkout plan as plan_id", async () => {
    const h = harness([{ json: { url: "https://checkout" } }]);
    await h.caged.billing.createCheckout("pro");
    expect(JSON.parse(h.only().body!)).toEqual({ plan_id: "pro" });
  });

  it("refuses an empty checkout plan before hitting the network", async () => {
    const h = harness([{ json: { url: "x" } }]);
    await expect(h.caged.billing.createCheckout("")).rejects.toBeInstanceOf(CagedError);
    expect(h.requests).toHaveLength(0);
  });

  it("sends only the rule fields the endpoint accepts", async () => {
    const h = harness([{ json: RULE }]);
    await h.caged.alerts.updateRule("rul_1", { config: { threshold_percent: 90 } });
    expect(JSON.parse(h.only().body!)).toEqual({ config: { threshold_percent: 90 } });
  });

  it("refuses an empty rule update rather than sending a no-op PUT", async () => {
    const h = harness([{ json: RULE }]);
    await expect(h.caged.alerts.updateRule("rul_1", {})).rejects.toBeInstanceOf(CagedError);
    expect(h.requests).toHaveLength(0);
  });

  it("puts the event body under payload, which is the key the server reads", async () => {
    const h = harness([{ json: { accepted: 1, errors: 0 } }]);
    await h.caged.events.ingest([
      { type: "llm_call", sandbox_id: "sbx_1", payload: { model: "claude-4" } },
    ]);
    const body = JSON.parse(h.only().body!) as {
      events: { payload: unknown; timestamp: string }[];
    };
    expect(body.events[0]!.payload).toEqual({ model: "claude-4" });
    // The server decodes timestamp into a non-nullable time.Time and rejects
    // a batch without one, so an omitted timestamp is stamped here.
    expect(body.events[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps a timestamp the caller supplied", async () => {
    const h = harness([{ json: { accepted: 1, errors: 0 } }]);
    await h.caged.events.ingest([
      { type: "command", timestamp: "2026-01-01T00:00:00Z" },
    ]);
    const body = JSON.parse(h.only().body!) as { events: { timestamp: string }[] };
    expect(body.events[0]!.timestamp).toBe("2026-01-01T00:00:00Z");
  });

  it("refuses a batch over the API's 1000-event ceiling before sending it", async () => {
    const h = harness([{ json: { accepted: 0, errors: 0 } }]);
    const events = Array.from({ length: 1001 }, () => ({ type: "command" }));
    await expect(h.caged.events.ingest(events)).rejects.toBeInstanceOf(CagedError);
    expect(h.requests).toHaveLength(0);
  });

  it("sends the session page number the caller asked for", async () => {
    const h = harness([
      { json: { data: [], pagination: { page: 3, per_page: 50, total: 0, total_pages: 0 } } },
    ]);
    await h.caged.sessions.list(3, 50);
    expect(h.only().query.get("page")).toBe("3");
    expect(h.only().query.get("per_page")).toBe("50");
  });
});

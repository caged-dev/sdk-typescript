# @caged-dev/sdk

Official TypeScript SDK for the [Caged](https://caged.dev) AI Agent Sandbox
Platform. A thin, typed wrapper over the Caged REST API — no client-side
business logic, no hidden state, one HTTP call per method.

Node.js 18+ (native `fetch`). No runtime dependencies. ESM and CJS, with
type declarations for both.

## Installation

```bash
npm install @caged-dev/sdk
# or
pnpm add @caged-dev/sdk
```

> **0.3.0 repairs calls that failed for every user of 0.1.0 and 0.2.0.**
> `files.write`, `snapshots.restore`, `billing.createCheckout`,
> `notifications.unreadCount` and the alert, notification and replay listings
> could not succeed against the live API. 0.2.0 was a repackage of 0.1.0. See
> [CHANGELOG.md](CHANGELOG.md).

## Quick Start

```typescript
import { Caged } from "@caged-dev/sdk";

const caged = new Caged({ apiKey: process.env.CAGED_API_KEY! });

// Create a sandbox with Claude Code installed. `template` is required.
const sandbox = await caged.sandboxes.create({
  template: "node-20",
  agents: ["claude-code"],
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
});

// Run a command. A non-zero exit code is a result, not an exception.
const result = await caged.sandboxes.exec(sandbox.id, "echo hello");
console.log(result.output, result.exit_code);

// Write and read files
await caged.files.write(sandbox.id, "/workspace/hello.js", "console.log(1)");
const content = await caged.files.read(sandbox.id, "/workspace/hello.js");

await caged.sandboxes.destroy(sandbox.id);
```

## Configuration

```typescript
const caged = new Caged({
  apiKey: "caged_sk_...",              // Required
  baseUrl: "https://api.caged.dev",    // Optional (default)
  timeout: 30000,                      // Optional: request timeout in ms
  fetch: myFetch,                      // Optional: inject a fetch
  webSocket: (url, protocols) => ...,  // Optional: inject a WebSocket
});
```

Every request is bounded by a timeout. `sandboxes.create` and
`sandboxes.exec` use longer defaults (360s and 300s) because a create can
clone a repo and install agents, and an exec can be a long-running agent
prompt; `exec` takes a per-call timeout.

`webSocket` is only needed for the terminal, streaming exec and MCP clients.
It defaults to the global `WebSocket`, which browsers have and Node.js has
only from 22. On Node 18 or 20:

```typescript
import WebSocket from "ws";

const caged = new Caged({
  apiKey: process.env.CAGED_API_KEY!,
  webSocket: (url, protocols) => new WebSocket(url, protocols) as never,
});
```

## Templates

`minimal`, `node-22`, `node-20`, `python-312`, `python-311`, `desktop`. The
aliases `node`, `python`, `gui` and `computer` also resolve. An unknown
template is a 400 that names the valid set.

## Field naming

Response types carry the API's own JSON keys — `memory_mb`, `exit_code`,
`preview_url`, `mod_time` — rather than camel-cased equivalents. The SDK is a
thin wrapper and does not rename the wire.

## Sandboxes

```typescript
const sandboxes = await caged.sandboxes.list();
const sandbox = await caged.sandboxes.get("sbx_1");

await caged.sandboxes.pause(sandbox.id);
await caged.sandboxes.resume(sandbox.id);

// Lifecycle log lines, and the ports the guest opened
const logs = await caged.sandboxes.logs(sandbox.id, 100);
for (const port of await caged.sandboxes.ports(sandbox.id)) {
  console.log(port.port, port.preview_url);
}

// Trust scores, one row per agent session run in this sandbox
const scores = await caged.sandboxes.trustScores(sandbox.id);

await caged.sandboxes.destroy(sandbox.id);
```

A sandbox reports money in two halves: `cost` is accrued machine time and
`llm_cost` is what its sessions spent on model tokens. `total_cost` is their
sum and is the figure the `budget` is enforced against — show that one next
to the budget.

## Files

```typescript
const entries = await caged.files.list(sandbox.id);           // /workspace
const source = await caged.files.read(sandbox.id, "/workspace/a.js");
await caged.files.write(sandbox.id, "/workspace/a.js", source + "\n");

const diff = await caged.files.gitDiff(sandbox.id);
for (const file of diff.files) console.log(file.status, file.path);
console.log(diff.diff, diff.staged_diff);
```

`read` returns the file's text — the endpoint answers `text/plain` — and
files over 1MB are rejected by the API. `gitDiff` returns an object, not a
string.

## Snapshots

```typescript
const snapshot = await caged.snapshots.create(sandbox.id, { name: "cp1" });
const snapshots = await caged.snapshots.list(sandbox.id);

// A snapshot is restored into a sandbox you name, not back where it came from
const replica = await caged.sandboxes.create({ template: "node-20" });
await caged.snapshots.restore(snapshot.id, replica.id);

const { url, expires_in_seconds } = await caged.snapshots.download(snapshot.id);
await caged.snapshots.delete(snapshot.id);
```

## Streaming Exec

```typescript
const stream = await caged.sandboxes.execStream(sandbox.id, "npm test");
for await (const chunk of stream) process.stdout.write(chunk);

// null if the connection dropped before the command finished: the status is
// then unknown, not zero.
console.log("Exit code:", stream.exitCode);
```

There is no streaming exec endpoint. This drives the terminal WebSocket and
brackets the command with markers carrying a per-call nonce, so the login
banner, the shell's echo and the prompt are stripped and the exit code is
read back from the shell.

## Interactive Terminal (WebSocket)

```typescript
const terminal = await caged.sandboxes.terminal(sandbox.id, { rows: 40, cols: 120 });
terminal.onOutput((data) => process.stdout.write(data));
terminal.onClose(() => console.log("closed"));
terminal.send("ls -la\n");
terminal.resize(50, 160);
terminal.close();
```

A WebSocket handshake cannot carry an `Authorization` header, so the
credential rides in the URL — where every proxy that logs a request line sees
it. The SDK therefore mints a single-use ticket
(`POST /v1/auth/socket-ticket`, exposed as `caged.socketTicket()`) for each
socket and sends that instead of your API key, falling back to the key only
against an API too old to serve tickets.

## MCP (Model Context Protocol)

```typescript
const mcp = await caged.sandboxes.mcp(sandbox.id);   // initialises the session

for (const tool of await mcp.listTools()) {
  console.log(tool.name, tool.description);
}

const result = await mcp.callTool("filesystem_read", { path: "package.json" });
console.log(result.content[0]?.text);

mcp.close();
```

Also `listResources()`, `readResource(uri)`, `listPrompts()`,
`getPrompt(name, args)`, `ping()`, `onNotification(handler)` and
`onClose(handler)`. A JSON-RPC error surfaces as `MCPError` with the server's
`code`.

## Agent Sessions & Replay

```typescript
// Every session in the account, newest first (paginated)
const page = await caged.sessions.list(1);
for (const s of page.data) {
  console.log(
    `${s.id}: LLM $${s.llm_cost} + compute $${s.compute_cost} = $${s.total_cost}`
  );
}

// Or just one sandbox's sessions
const sessions = await caged.sessions.listBySandbox(sandbox.id);

// The replay endpoint answers an object, not a bare array.
let replay = await caged.sessions.replay(sessions[0]!.id, { limit: 500 });
for (const event of replay.events) console.log(event.sequence, event.type);
while (replay.has_more) {
  replay = await caged.sessions.replay(sessions[0]!.id, { afterSeq: replay.next_seq });
}

const summary = await caged.sessions.replaySummary(sessions[0]!.id);
console.log(summary.event_count, summary.duration_ms, summary.types);
```

A session's spend arrives as two halves and their sum: `llm_cost` (model
tokens) plus `compute_cost` (this session's share of its sandbox's machine
time) equals `total_cost`. `cost_usd` is the same blended total under the
older name.

## Events (Observability)

```typescript
const response = await caged.events.ingest([
  {
    type: "llm_call",
    sandbox_id: sandbox.id,
    // The server reads `payload`. Anything sent as `data` was discarded.
    payload: { model: "claude-4", tokens_in: 500, tokens_out: 200 },
  },
]);
console.log(response.accepted, response.errors);
```

Max 1000 events per batch — the SDK refuses a larger one rather than letting
the API reject the lot. `account_id` is taken from the API key, and an
omitted `timestamp` is stamped as now, because the server rejects an event
without one.

## Alerts & Notifications

```typescript
const page = await caged.alerts.list({ limit: 50 });   // an object, not an array
for (const alert of page.alerts) {
  console.log(`[${alert.severity}] ${alert.title}: ${alert.message}`);
}
await caged.alerts.resolve(page.alerts[0]!.id);

// Rules: the tunables live in `config`, and only what you pass is changed.
for (const rule of await caged.alerts.listRules()) {
  await caged.alerts.updateRule(rule.id, { config: { threshold_percent: 80 } });
}

console.log(await caged.notifications.unreadCount());
const inbox = await caged.notifications.list({ limit: 20 });
for (const note of inbox.notifications) console.log(note.channel, note.title);
await caged.notifications.markAllRead();
```

A notification config read never returns a credential — for a webhook the URL
*is* the credential — so each is reported as a `*_configured` boolean plus a
hint. Write them with `updateConfig`, where an omitted field is left alone
and `CLEAR_CREDENTIAL` removes one.

## Billing

```typescript
const sub = await caged.billing.getSubscription();
console.log(sub.tier, sub.status);          // the API calls the plan `tier`

const usage = await caged.billing.getUsage();
console.log(usage.compute_minutes);

const checkoutUrl = await caged.billing.createCheckout("pro");
const portalUrl = await caged.billing.createPortal();
await caged.billing.cancel();
```

## Account

```typescript
const account = await caged.account.get();

const created = await caged.account.createKey("ci", "read_only");
console.log(created.key);        // the secret, shown exactly once
console.log(created.info.id);    // the metadata listKeys() also returns

await caged.account.revokeKey(created.info.id);

const sessions = await caged.account.listSessions();
await caged.account.revokeSession(sessions[0]!.id);
```

## Error Handling

Every failure is a `CagedError`. API failures are `CagedAPIError` or one of
its subclasses, and carry the server's own RFC 7807 problem detail as the
message.

```typescript
import {
  CagedAPIError,
  CagedNotFoundError,
  CagedPlanLimitError,
  CagedTimeoutError,
  CagedValidationError,
} from "@caged-dev/sdk";

try {
  await caged.sandboxes.get("sbx_does_not_exist");
} catch (err) {
  if (err instanceof CagedNotFoundError) console.log("no such sandbox");
  else if (err instanceof CagedPlanLimitError) console.log(err.reason?.action);
  else if (err instanceof CagedValidationError) console.log(`rejected: ${err.message}`);
  else if (err instanceof CagedTimeoutError) console.log(err.timeoutMs);
  else if (err instanceof CagedAPIError) console.log(err.status, err.problem?.detail);
  else throw err;
}
```

| Class | Thrown for |
|-------|-----------|
| `CagedValidationError` | 400, 422 |
| `CagedAuthError` | 401, 403 |
| `CagedNotFoundError` | 404 |
| `CagedPlanLimitError` | 403 with `reason.code === "plan_limit_reached"` |
| `CagedRateLimitError` | 429 |
| `CagedServerError` | 5xx |
| `CagedAPIError` | any other non-2xx (base class of the above) |
| `CagedTimeoutError` | the request exceeded its timeout |
| `CagedConnectionError` | the transport failed before a response arrived |
| `MCPError` | a JSON-RPC error from the sandbox's MCP server |
| `CagedError` | base class of everything above |

Refusals the API classified also carry a machine-readable `reason` (`code`,
`message`, `action`, `subject_type`, `subject_id`). Branch on `reason.code` —
the prose message may be reworded, the code will not.

## Full Example: Run Claude Code in a Sandbox

```typescript
import { Caged } from "@caged-dev/sdk";

const caged = new Caged({ apiKey: process.env.CAGED_API_KEY! });

const sandbox = await caged.sandboxes.create({
  template: "node-20",
  memory_mb: 2048,
  agents: ["claude-code"],
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
  repo: "https://github.com/user/my-project",
  budget: 2.0,
});

// Stream the agent's output, and get its exit code when it finishes.
const stream = await caged.sandboxes.execStream(
  sandbox.id,
  'claude -p "add unit tests for the auth module"'
);
for await (const chunk of stream) process.stdout.write(chunk);
console.log("\nagent exited", stream.exitCode);

const diff = await caged.files.gitDiff(sandbox.id);
for (const file of diff.files) console.log(file.status, file.path);

const sessions = await caged.sessions.listBySandbox(sandbox.id);
console.log(`Cost: $${sessions[0]?.total_cost}`);

await caged.sandboxes.destroy(sandbox.id);
```

## Development

```bash
pnpm install
pnpm lint            # tsc --noEmit
pnpm test            # vitest
pnpm build           # tsup: ESM + CJS + .d.ts
pnpm verify-tarball  # inspect what `npm i` would unpack
```

Tests inject a `fetch` and a fake WebSocket; nothing in the suite touches the
network. `verify-tarball` exists because checking the source proves nothing
about what gets published — 0.2.0 was a repackage of 0.1.0 and every check in
CI passed.

## License

MIT

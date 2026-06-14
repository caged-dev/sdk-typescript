# @caged-dev/sdk

Official TypeScript SDK for the [Caged](https://caged.dev) AI Agent Sandbox Platform.

## Installation

```bash
npm install @caged-dev/sdk
# or
pnpm add @caged-dev/sdk
```

## Quick Start

```typescript
import { Caged } from "@caged-dev/sdk";

const caged = new Caged({ apiKey: "caged_sk_..." });

// Create a sandbox with Claude Code installed
const sandbox = await caged.sandboxes.create({
  template: "node-20",
  agents: ["claude-code"],
  env: { ANTHROPIC_API_KEY: "sk-ant-..." },
});

// Run a command
const result = await caged.sandboxes.exec(sandbox.id, "echo hello");
console.log(result.output); // "hello"

// Clean up
await caged.sandboxes.destroy(sandbox.id);
```

## Configuration

```typescript
const caged = new Caged({
  apiKey: "caged_sk_...",              // Required
  baseUrl: "https://api.caged.dev",    // Optional (default)
  timeout: 30000,                      // Optional: request timeout in ms
});
```

---

## Sandboxes

### Create & Manage

```typescript
// Create with full options
const sandbox = await caged.sandboxes.create({
  template: "python-312",
  cpus: 4,
  memory_mb: 2048,
  disk_gb: 10,
  network_mode: "allowlist",
  allowlist: ["*.github.com", "api.openai.com"],
  env: { API_KEY: "secret" },
  repo: "https://github.com/user/project",
  agents: ["claude-code", "aider"],
  budget: 5.0,
  timeout: 1800,
});

// List, get, pause, resume, destroy
const sandboxes = await caged.sandboxes.list();
const sb = await caged.sandboxes.get(sandbox.id);
await caged.sandboxes.pause(sandbox.id);
await caged.sandboxes.resume(sandbox.id);
await caged.sandboxes.destroy(sandbox.id);
```

### Execute Commands

```typescript
// Simple exec (returns when complete)
const result = await caged.sandboxes.exec(sandbox.id, "npm test");
console.log(result.output);
console.log(result.exit_code);

// Streaming exec (real-time output)
const stream = caged.sandboxes.execStream(sandbox.id, "npm run build");
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
console.log("Exit:", stream.exitCode);

// Or collect all output at once
const output = await stream.text();
```

### Interactive Terminal (WebSocket)

```typescript
const terminal = await caged.sandboxes.terminal(sandbox.id, {
  rows: 40,
  cols: 120,
});

terminal.onOutput((data) => process.stdout.write(data));
terminal.onClose(() => console.log("Terminal closed"));

// Send commands
terminal.send("cd /workspace && ls\n");
terminal.send("claude -p 'refactor the auth module'\n");

// Resize
terminal.resize(50, 160);

// Close when done
terminal.close();
```

### MCP Connection (AI Agent Tools)

Connect via Model Context Protocol to call sandbox tools programmatically:

```typescript
const mcp = await caged.sandboxes.mcp(sandbox.id);

// List available tools
const tools = await mcp.listTools();
// → filesystem_read, filesystem_write, terminal_exec, git_status, ...

// Read a file
const file = await mcp.callTool("filesystem_read", { path: "src/index.ts" });
console.log(file.content[0].text);

// Execute a command
const result = await mcp.callTool("terminal_exec", {
  command: "npm test",
  timeout_ms: 60000,
});

// Write a file
await mcp.callTool("filesystem_write", {
  path: "src/new-file.ts",
  content: 'export const hello = "world";',
});

// List resources and prompts
const resources = await mcp.listResources();
const prompts = await mcp.listPrompts();

// Listen for server notifications
mcp.onNotification((method, params) => {
  console.log("Notification:", method, params);
});

mcp.close();
```

### Logs & Ports

```typescript
// Get sandbox logs
const logs = await caged.sandboxes.logs(sandbox.id, 50);
for (const log of logs) {
  console.log(`[${log.timestamp}] ${log.type}: ${log.message}`);
}

// List open ports
const ports = await caged.sandboxes.ports(sandbox.id);
// → [{ port: 3000, protocol: "tcp", state: "open", url: "https://..." }]
```

---

## Files

```typescript
// List directory
const entries = await caged.files.list(sandbox.id, "/workspace/src");

// Read a file
const content = await caged.files.read(sandbox.id, "/workspace/package.json");

// Write a file
await caged.files.write(sandbox.id, "/workspace/hello.ts", 'console.log("hi")');

// Git diff
const diff = await caged.files.gitDiff(sandbox.id);
```

---

## Snapshots

```typescript
// Create a snapshot
const snapshot = await caged.snapshots.create(sandbox.id, {
  name: "before-refactor",
  description: "State before major refactoring",
});

// List snapshots
const snapshots = await caged.snapshots.list(sandbox.id);

// Restore from snapshot
await caged.snapshots.restore(snapshot.id);

// Get download URL
const { url } = await caged.snapshots.downloadUrl(snapshot.id);
```

---

## Agent Sessions & Replay

View past AI agent sessions and replay their activity:

```typescript
// List sessions for a sandbox
const sessions = await caged.sessions.listBySandbox(sandbox.id);

// Get session details
const session = await caged.sessions.get(sessionId);
console.log(`Cost: $${session.cost_usd}, Tokens: ${session.tokens_in + session.tokens_out}`);

// Get replay summary
const summary = await caged.sessions.replaySummary(sessionId);
console.log(`Duration: ${summary.duration_ms}ms, Tools: ${summary.tools_used.join(", ")}`);

// Get full replay timeline
const events = await caged.sessions.replay(sessionId);
for (const event of events) {
  console.log(`[${event.timestamp}] ${event.type}:`, event.data);
}
```

---

## Events (Observability)

Push structured observability events to the Caged pipeline:

```typescript
await caged.events.ingest([
  {
    type: "llm_call",
    sandbox_id: sandbox.id,
    data: {
      model: "claude-sonnet-4-20250514",
      tokens_in: 1500,
      tokens_out: 800,
      duration_ms: 2300,
    },
  },
  {
    type: "tool_call",
    sandbox_id: sandbox.id,
    data: {
      tool: "filesystem_write",
      path: "/workspace/src/app.ts",
    },
  },
]);
```

---

## Alerts & Notifications

```typescript
// List alerts
const alerts = await caged.alerts.list();
await caged.alerts.resolve(alerts[0].id);

// Manage alert rules
const rules = await caged.alerts.listRules();
await caged.alerts.updateRule(rules[0].id, { enabled: true, threshold: 10 });

// Notifications
const notifications = await caged.notifications.list();
const { count } = await caged.notifications.unreadCount();
await caged.notifications.markRead(notifications[0].id);
await caged.notifications.markAllRead();

// Configure notification channels
await caged.notifications.updateConfig({
  slack_enabled: true,
  slack_webhook_url: "https://hooks.slack.com/services/...",
});
```

---

## Billing

```typescript
// Check subscription
const sub = await caged.billing.getSubscription();
console.log(`Plan: ${sub.plan}, Status: ${sub.status}`);

// Upgrade
const { url } = await caged.billing.createCheckout("pro");
// → redirect user to url

// Manage billing
const { url: portalUrl } = await caged.billing.createPortal();

// Cancel
await caged.billing.cancel();
```

---

## Account

```typescript
// API keys
const keys = await caged.account.listKeys();
const newKey = await caged.account.createKey("ci-deploy");
console.log(newKey.key); // Only shown once!
await caged.account.revokeKey(newKey.id);

// Web sessions
const sessions = await caged.account.listSessions();
await caged.account.revokeSession(sessions[0].id);
```

---

## Error Handling

```typescript
import { CagedAPIError, CagedTimeoutError } from "@caged-dev/sdk";

try {
  await caged.sandboxes.create({ template: "invalid" });
} catch (err) {
  if (err instanceof CagedAPIError) {
    console.log(err.status); // 400, 401, 403, 404, 500
    console.log(err.message); // Human-readable error
  }
  if (err instanceof CagedTimeoutError) {
    console.log("Request timed out");
  }
}
```

---

## Full Example: Run Claude Code in a Sandbox

```typescript
import { Caged } from "@caged-dev/sdk";

const caged = new Caged({ apiKey: process.env.CAGED_API_KEY! });

// Create sandbox with Claude Code
const sandbox = await caged.sandboxes.create({
  template: "node-20",
  memory_mb: 2048,
  agents: ["claude-code"],
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
  repo: "https://github.com/user/my-project",
  budget: 2.0,
});

// Connect terminal and run Claude
const terminal = await caged.sandboxes.terminal(sandbox.id);

let output = "";
terminal.onOutput((data) => {
  output += data;
  process.stdout.write(data);
});

terminal.send('claude -p "add unit tests for the auth module"\n');

// Wait for completion (simplified — real usage would parse output)
await new Promise((r) => setTimeout(r, 60000));

// Check what changed
const diff = await caged.files.gitDiff(sandbox.id);
console.log("\nChanges made:\n", diff);

// Check cost
const sessions = await caged.sessions.listBySandbox(sandbox.id);
console.log(`Cost: $${sessions[0]?.cost_usd}`);

terminal.close();
await caged.sandboxes.destroy(sandbox.id);
```

---

## Requirements

- Node.js 18+ (uses native `fetch` and `WebSocket`)
- For older environments, polyfill `WebSocket` (e.g., `ws` package)

## License

MIT

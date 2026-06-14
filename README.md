# @caged-dev/sdk

Official TypeScript SDK for the [Caged](https://caged.dev) AI Agent Sandbox Platform.

## Installation

```bash
npm install @caged-dev/sdk
```

## Quick Start

```typescript
import { Caged } from "@caged-dev/sdk";

const caged = new Caged({ apiKey: "caged_sk_..." });

// Create a sandbox
const sandbox = await caged.sandboxes.create({
  template: "node-20",
  cpus: 2,
  memory_mb: 1024,
});

console.log(`Sandbox ${sandbox.id} is ${sandbox.status}`);

// Write and read files
await caged.files.write(sandbox.id, "/workspace/hello.js", 'console.log("hi")');
const content = await caged.files.read(sandbox.id, "/workspace/hello.js");

// Create a snapshot
const snapshot = await caged.snapshots.create(sandbox.id, { name: "checkpoint-1" });

// Clean up
await caged.sandboxes.destroy(sandbox.id);
```

## Configuration

```typescript
const caged = new Caged({
  apiKey: "caged_sk_...",       // Required
  baseUrl: "https://api.caged.dev", // Optional (default)
  timeout: 30000,                   // Optional: request timeout in ms
});
```

## API Reference

### Sandboxes

| Method | Description |
|--------|-------------|
| `caged.sandboxes.create(params)` | Create a new sandbox |
| `caged.sandboxes.list()` | List all sandboxes |
| `caged.sandboxes.get(id)` | Get sandbox by ID |
| `caged.sandboxes.destroy(id)` | Destroy a sandbox |
| `caged.sandboxes.pause(id)` | Pause a sandbox |
| `caged.sandboxes.resume(id)` | Resume a paused sandbox |
| `caged.sandboxes.ports(id)` | List open ports |

### Files

| Method | Description |
|--------|-------------|
| `caged.files.list(sandboxId, path)` | List directory contents |
| `caged.files.read(sandboxId, path)` | Read file content |
| `caged.files.write(sandboxId, path, content)` | Write file content |
| `caged.files.gitDiff(sandboxId)` | Get git diff |

### Snapshots

| Method | Description |
|--------|-------------|
| `caged.snapshots.list(sandboxId)` | List snapshots |
| `caged.snapshots.create(sandboxId, params)` | Create snapshot |
| `caged.snapshots.get(snapshotId)` | Get snapshot details |
| `caged.snapshots.delete(snapshotId)` | Delete snapshot |
| `caged.snapshots.downloadUrl(snapshotId)` | Get download URL |
| `caged.snapshots.restore(snapshotId)` | Restore snapshot |

### Account

| Method | Description |
|--------|-------------|
| `caged.account.listKeys()` | List API keys |
| `caged.account.createKey(name)` | Create new API key |
| `caged.account.revokeKey(id)` | Revoke an API key |
| `caged.account.listSessions()` | List active sessions |
| `caged.account.revokeSession(id)` | Revoke a session |

## Error Handling

```typescript
import { Caged, CagedAPIError, CagedTimeoutError } from "@caged-dev/sdk";

try {
  await caged.sandboxes.get("nonexistent");
} catch (err) {
  if (err instanceof CagedAPIError) {
    console.error(`API error ${err.status}: ${err.message}`);
  } else if (err instanceof CagedTimeoutError) {
    console.error("Request timed out");
  }
}
```

## License

MIT


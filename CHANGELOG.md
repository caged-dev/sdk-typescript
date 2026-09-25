# Changelog

All notable changes to `@caged-dev/sdk`.

## Unreleased

### Added — `client.mcp.*`, third-party MCP servers

The MCP section that already existed is the MCP server Caged *is*. This is
about the servers Caged *uses*: an agent in a sandbox reaching GitHub, Linear
or Postgres through Caged's broker, without the sandbox's egress widening by
one byte.

- `client.mcp.servers` — `add`, `list`, `get`, `refresh`, `remove`
- `client.mcp.bind` / `unbind` / `bindings` — who sees which server
- `client.mcp.tools`, `toolDiff`, `toolRevisions`, `approveTool`, `rejectTool`
  — the pinned catalogue and the rug-pull review
- `client.mcp.readiness`, `advice`, `allow`, `disallow` — whether policy will
  actually allow those tools, and the one rule that makes it
- `client.mcp.oauth` — `show`, `consent`, `authorize`, `forget`,
  `revokeConsent`
- `client.mcp.inputs` — `list`, `get`, `respond`: questions servers asked,
  waiting on a person
- `client.mcp.catalogue` — the servers Caged has reviewed
- `mcpNeedsAllowRule(advice)` — the predicate for "one `allow` call away"

Two of the new types exist because the API's happy path does not tell you what
you need to know, and a client returning only the happy path leaves you to find
out the expensive way:

- **`MCPPolicyAdvice`**, returned on every `bind` and by `readiness()`. A
  brokered tool name matches nothing in Caged's autonomy-tier table, so a bound
  external tool is denied at every tier — including `autonomous` — until a rule
  allows it.
- **`MCPToolDiff`**, which carries the definition a human approved beside the
  one the server is advertising now, with added and removed parameters named.
  Approving a change without reading it is the outcome digest pinning exists to
  prevent.

No type in this release has a field for a credential or a token, and a test
asserts it. `MCPServerTool` is named that rather than `MCPTool` because
`MCPTool` already means "a tool on the agent's own MCP connection" in this
package, and a shared name would make the wrong one importable.

`allow()` throws without a `personaId`, with the reason: Caged's account policy
layer is restriction-only, so a rule written there would be stored, displayed,
and have no effect whatsoever.


## 0.3.0 — unreleased

The 0.1.0 client was written against a description of the API rather than
against the API. 0.2.0 added the terminal, streaming exec and MCP clients on
top of it without fixing any of that, and the repairs that were eventually
written landed in an internal copy inside `caged-api`, which ships to nobody.
So **no user has ever had a working `files.write`**. This release brings the
repairs to the package `npm i @caged-dev/sdk` installs, and extends them to
the sockets, sessions, alerts, notifications and billing surfaces that exist
only here.

### Fixed — each failed on *every* call, not under some condition

- **`files.write`** — HTTP 400. The API reads the target path from the
  `?path=` query string and only the content from the body; the client sent
  both in the body.
- **`files.read`** — parsed a `text/plain` body as JSON.
- **`snapshots.restore`** — HTTP 400. The API requires `target_sandbox_id` in
  the body: a snapshot is restored into a sandbox the caller names.
- **`sandboxes.create`** — defaulted its params to `{}`, and the API rejects
  a create with no template.
- **`billing.createCheckout`** — sent `plan`; the endpoint reads `plan_id`.
- **`notifications.unreadCount`** — read `count`; the body is
  `{"unread_count": n}`.
- **`alerts.list` and `notifications.list`** — typed and used as bare arrays;
  both endpoints answer objects (`{alerts, total, limit, offset}` and
  `{notifications, unread_count}`).
- **`sessions.replay`** — same: the body is
  `{events, has_more, next_seq, total}`, so paging was impossible.
- **`alerts.updateRule`** — sent whatever `Partial<AlertRule>` it was handed.
  The endpoint accepts `enabled` and `config`; a rule's tunables are nested
  under `config`, and there is no top-level `threshold`, `cooldown_minutes`
  or `channels`.
- **`events.ingest`** — put the event body under `data`, which the server
  discards, and omitted the `timestamp` it requires (a non-nullable
  `time.Time`, so the batch 400'd).
- **Types that were untrue.** `gitDiff` was typed `string` where the endpoint
  returns an object; `Port.state`/`Port.url`, `FileEntry.modified`,
  `FileEntry.type: "dir"`, `Snapshot.account_id`, `Session.ip_address`,
  `Subscription.plan`, `ReplaySummary.cost_usd`/`total_events`,
  `Notification.body`, `Alert.severity: "low" | "medium" | "high"` and
  `AlertRule.channels` name fields and values no endpoint emits.
- **Every API error message was discarded.** The API answers RFC 7807
  problem details; the client looked for a non-existent `error` key and threw
  `"API error: 404"` instead of `"sandbox not found"`.
- **`CagedTimeoutError` reported the client default** rather than the
  per-call timeout actually used.
- **Every WebSocket asked for the `mcp` subprotocol**, including the
  terminal, leaving that handshake with no agreed subprotocol.
- **`execStream` could never report an exit code.** It waited for an `exit`
  message the terminal endpoint does not emit, so `exitCode` stayed `null`
  and the iterator ended only when the sandbox idled out; the output included
  the login banner, the shell's echo of the command and the prompt. A dropped
  socket also lost the tail of the output, and for a command whose whole
  output was short, all of it.
- **`new WebSocket` assumed a global Node.js has only from 22**, so the
  terminal, streaming exec and MCP clients threw `ReferenceError` on Node 18
  and 20 — the versions this package claims to support.
- **`MCPClient.listTools`/`listResources`/`listPrompts`** returned
  `result.tools` unchecked, handing back `undefined` typed as an array when
  the server omitted the key.

### Security

- **WebSockets no longer carry your API key in the URL.** A handshake cannot
  set an `Authorization` header, so the credential travels in the query
  string, where every proxy that logs a request line records it. The SDK now
  mints a single-use, one-minute ticket per socket
  (`POST /v1/auth/socket-ticket`, exposed as `caged.socketTicket()`), and
  falls back to the key only against an API too old to serve tickets.
- Path segments are URL-encoded, so an unusual ID cannot escape its route.

### Changed — breaking

- `snapshots.restore(id)` → `restore(id, targetSandboxId)`.
- `snapshots.downloadUrl()` is deprecated in favour of `download()`, and both
  now return `{url, expires_in_seconds}`.
- `alerts.list()` returns `AlertPage`; `notifications.list()` returns
  `NotificationPage`; `sessions.replay()` returns `ReplayPage`.
- `alerts.updateRule(id, update)` takes `{enabled?, config?}`.
- `notifications.updateConfig(update)` takes `NotificationConfigUpdate`.
- `notifications.unreadCount()` returns a `number`, not `{count}`.
- `billing.createCheckout()` and `createPortal()` return the URL string.
- `files.gitDiff()` returns `GitDiff`; `files.list()` defaults to
  `/workspace`, matching the API, instead of `/`.
- `account.createKey()` returns `CreatedAPIKey` (`.key`, `.info`).
- `sandboxes.create()` requires `template`.
- `sandboxes.terminal()`, `execStream()` and `mcp()` all return promises and
  resolve only once the socket is open. `execStream` was synchronous and
  handed back a stream attached to a socket that had not connected.
- `Session` → `AccountSession`, `TrustScore` → `TrustScoreSummary`.
- `new Caged({apiKey: ""})` throws `CagedError`, not `Error`.

### Deprecated

Warned once per process, not removed; both stay until at least 0.5.0.

- `snapshots.downloadUrl()` → `snapshots.download()`.
- `sandboxes.trustScore()` → `sandboxes.trustScores()` (it always returned a
  list, one row per session).

### Added

- `CagedPlanLimitError` and `CagedAPIError.reason` (a `Refusal` with `code`,
  `message`, `action`, `subject_type`, `subject_id`). A plan limit is a 403
  and used to arrive as an auth failure — telling a caller their key was
  wrong when the key was fine.
- Error hierarchy under `CagedError`: `CagedValidationError`,
  `CagedAuthError`, `CagedNotFoundError`, `CagedRateLimitError`,
  `CagedServerError`, `CagedConnectionError`, `CagedTimeoutError`. The API
  ones extend `CagedAPIError`, so an existing `instanceof CagedAPIError` still
  matches.
- `account.get()`, `sessions.list(page)`, `snapshots.download()`,
  `billing.getUsage()`, `notifications.listUnread()`, `caged.socketTicket()`,
  `sandboxes.logs()` with a `tail`.
- Session cost arrives split: `llm_cost` + `compute_cost` = `total_cost`.
- `fetch` and `webSocket` can be injected through the constructor; that is
  how the test suite avoids the network, and how Node 18 and 20 get a
  WebSocket.
- `VERSION` is exported, and is the single source of the User-Agent and the
  MCP `clientInfo`. The published 0.2.0 bundle hardcoded
  `@caged-dev/sdk/0.1.0`, which is how it was proved to be a repackage.
- `sideEffects: false`, so the package tree-shakes, and `engines.node >= 18`.
- 132 vitest cases where there were none, including one per public method
  that calls it as the first call on a fresh client, plus a fake WebSocket
  for the three socket clients. CI runs them without `|| true` — it
  previously ran `pnpm test || true` against a repository with no tests,
  which is how all of the above stayed invisible behind a green run.
- `scripts/verify-tarball.mjs`, run in CI against the packed tarball. Every
  previous check read the working tree, which is why 0.2.0 could be a
  repackage of 0.1.0 and pass.
- `any` is gone from the source; `tsc --noEmit` covers the tests too.

## 0.2.0

- Added the WebSocket terminal, the MCP client, streaming exec, and the
  session, event, alert, notification and billing methods — none of which
  fixed the 0.1.0 request and response shapes, and several of which repeated
  them. The published bundle announces itself as 0.1.0.

## 0.1.0

- Initial release.

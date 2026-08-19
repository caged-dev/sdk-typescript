# Caged TypeScript SDK — Claude Code Instructions

This is the published TypeScript client (`@caged/sdk` on npm) for **Caged** (caged.dev), an AI Agent Sandbox Platform by Bytangle Ltd. It corresponds to `apps/core/sdk/typescript/` when checked out inside the `caged-dev/workspace` workspace, but this repo also works standalone (e.g. Claude Code on the web opened directly here).

**Source of truth for shared conventions is `caged-dev/workspace`.** This repo's `.claude/skills/` and `.claude/agents/` are re-synced from there at the start of every Claude Code web session (see `.claude/hooks/session-start.sh`) — edit skills/agents in `workspace`, not here; local edits here are overwritten on the next session start.

## SDK Design Principles
1. **Thin wrapper** — 1:1 mapping to the REST API, no business logic
2. **Type-safe** — full TypeScript types, no `any`
3. **Promise/async-first**
4. **Streaming** — WebSocket support for events/terminal
5. **Zero deps (almost)** — only `fetch` + `ws`
6. **Tree-shakeable** — ESM exports, no side effects
7. **Error hierarchy** — specific error classes per failure mode

## Critical Rules
- NEVER hardcode API URLs — accept `baseUrl` in the client constructor
- NEVER store API keys in memory longer than needed
- ALWAYS provide TypeScript type definitions (`.d.ts`)
- ALWAYS support both ESM and CJS builds
- ALWAYS test against a mocked HTTP layer (no real API calls in tests)
- SDK version is INDEPENDENT from the backend (`caged-api`) version
- Deprecate with warnings before removing (minimum 2 minor versions)
- Types here must track `caged-api`'s API contract — verify against it before adding/changing a method
- Ship without tests for the changed code — never

## Quality Gate
Not done until: types match the current API spec; all methods have tests; README updated with examples; CHANGELOG updated; works on Node.js 18+; bundle size checked (no bloat); error messages are helpful to developers.

## Skills & Subagents
- `.claude/skills/<name>/SKILL.md` — auto-discovered by the Skill tool; most relevant here: `sdk-development`, `api-design`, `interface-contracts`, `testing`, `code-review`.
- `.claude/agents/<name>.md` — dispatch via the Agent tool: `sdk-engineer`, `qa-engineer`.
- Full workspace-level context (product specs, roadmap, branding): `caged-dev/workspace` repo.

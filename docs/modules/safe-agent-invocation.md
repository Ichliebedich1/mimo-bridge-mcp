# Safe Agent Invocation

## Module Goal

Make Codex, MiMo, and third-party agents call MiMo Bridge through one safe client wrapper instead of ad hoc PowerShell, inline Node, or hand-built JSON commands.

## Problem

Recent real runs exposed a repeated Windows compatibility issue:

- Chinese workspace paths can be corrupted when passed through a PowerShell pipeline or command-line string.
- Inline Node commands are fragile when JSON contains quotes, backslashes, greater-than signs, less-than signs, or newlines.
- Different machines may use different console code pages, PowerShell versions, Node versions, and PATH order.
- Some machines will not reproduce the issue, so a fix must adapt at runtime instead of assuming one shell behavior.

These failures happen before MiMo receives the task. They should not count as MiMo execution failures.

## Design

Add a first-class client wrapper, tentatively:

- scripts/mimo-bridge-client.mjs
- optional thin PowerShell launcher: scripts/mimo-bridge-client.ps1

The wrapper becomes the only documented way for agents to start, wait for, and review MiMo tasks from scripts.

## Input Rules

- Accept JSON from a UTF-8 file or stdin.
- Do not require large JSON payloads on the command line.
- Do not require the workspace path to be embedded in a shell string.
- Default workspace_path to process.cwd() when omitted.
- Allow explicit workspace_path in the JSON body for advanced callers.
- Treat all input and output as UTF-8.

## Runtime Adaptation

The wrapper should probe the current machine and choose the safest route:

1. Read base URL from MIMO_BRIDGE_URL, then fallback to http://127.0.0.1:3210.
2. Check /api/health.
3. Prefer REST JSON endpoints for start, list, and health checks because they avoid MCP SDK request-timeout defaults.
4. Use MCP SDK only for MCP-only operations such as mimo_wait_task, and always set request timeout greater than timeout_seconds.
5. If REST is unavailable, return an actionable error that says whether the daemon is down, the port is wrong, or the response is malformed.
6. Never fall back to inline JSON in PowerShell.

## Proposed Commands

- node scripts/mimo-bridge-client.mjs start --json .\\runtime\\client-requests\\task.json
- node scripts/mimo-bridge-client.mjs wait --task-id task_xxx --timeout-seconds 1800
- node scripts/mimo-bridge-client.mjs start-and-wait --json .\\runtime\\client-requests\\task.json --timeout-seconds 1800
- node scripts/mimo-bridge-client.mjs review --task-id task_xxx --detail-level review --max-chars 8000

The PowerShell wrapper should only locate Node and forward arguments. It should not build JSON strings.

## Output Rules

- Return one compact JSON object.
- Include ok, operation, task_id, status, and error when relevant.
- For wait/review operations, keep the same low-token defaults as MCP: bounded Review Package first, no full diff/log/source by default.
- Print human-readable errors only when explicitly requested, for example --format text.

## Safety Rules

- Do not expose arbitrary file reads.
- Do not bypass existing allowedRoots.
- Do not weaken Worktree isolation.
- Do not merge or finish tasks automatically.
- Do not treat launcher/client quoting failures as MiMo task failures.

## Tests

Add tests that cover:

- JSON payload containing Chinese path text.
- JSON payload containing greater-than signs, less-than signs, quotes, backslashes, and newlines.
- Missing daemon produces an actionable error.
- wait sets SDK request timeout longer than timeout_seconds.
- start-and-wait returns early when the task finishes before the timeout.
- Output stays bounded and does not include full diff/log/source by default.

## Current Status

Designed after repeated Windows shell quoting and encoding failures during real Codex-to-MiMo task delegation. Implementation is pending.


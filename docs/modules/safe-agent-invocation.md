# Safe Agent Invocation

## Module Goal

Make Codex, MiMo, and third-party agents call MiMo Bridge through one safe client wrapper instead of ad hoc PowerShell, inline Node, or hand-built JSON commands.

## Problem

Real delegation runs exposed a repeated Windows compatibility issue:

- Chinese workspace paths can be corrupted when passed through a PowerShell pipeline or command-line string.
- Inline Node commands are fragile when JSON contains quotes, backslashes, greater-than signs, less-than signs, or newlines.
- Different machines may use different console code pages, PowerShell versions, Node versions, and PATH order.
- Some machines will not reproduce the issue, so the fix must adapt at runtime instead of assuming one shell behavior.

These failures happen before MiMo receives the task. They should not count as MiMo execution failures.

## Implementation

P5.4 adds a first-class client wrapper:

- `scripts/mimo-bridge-client.mjs`: Node.js CLI client.
- `scripts/mimo-bridge-client.ps1`: thin PowerShell launcher.

The wrapper is the documented way for agents to start, wait for, and review MiMo tasks from scripts.

## Input Rules

- Accept JSON from a UTF-8 file with `--json <path>` or from stdin.
- Do not require large JSON payloads on the command line.
- Do not require the workspace path to be embedded in a shell string.
- Default `workspace_path` to `process.cwd()` when omitted.
- Allow explicit `workspace_path` in the JSON body for advanced callers.
- Treat all input and output as UTF-8.

The PowerShell wrapper locates Node, forwards arguments, and when stdin is piped without `--json`, writes that stdin to a temporary UTF-8 JSON file before forwarding `--json <temp>`. It does not construct task JSON or embed workspace paths in command strings.

## Runtime Behavior

1. Read base URL from `MIMO_BRIDGE_URL`, then fallback to `http://127.0.0.1:3210`.
2. Check `/api/health`.
3. Prefer REST JSON endpoints for `health`, `start`, and `review` because they avoid MCP SDK request-timeout defaults.
4. Use MCP SDK only for `mimo_wait_task`, and set request timeout greater than `timeout_seconds`.
5. Return actionable daemon-down, wrong-port, timeout, or malformed-response errors.
6. Never fall back to inline JSON in PowerShell.
7. CLI output is compact JSON and the process exits explicitly, avoiding stale one-off clients after wait completes.

## Commands

```powershell
node scripts/mimo-bridge-client.mjs health
node scripts/mimo-bridge-client.mjs start --json .\runtime\client-requests\task.json
node scripts/mimo-bridge-client.mjs wait --task-id task_xxx --timeout-seconds 1800
node scripts/mimo-bridge-client.mjs start-and-wait --json .\runtime\client-requests\task.json --timeout-seconds 1800
node scripts/mimo-bridge-client.mjs review --task-id task_xxx --detail-level review --max-chars 8000
```

## Output Rules

- Return one compact JSON object per invocation.
- Include `ok`, `operation`, `task_id`, `status`, and `error` when relevant.
- For wait/review operations, keep the same low-token defaults as MCP: bounded Review Package first, no full diff/log/source by default.

## Safety Rules

- Do not expose arbitrary file reads.
- Do not bypass existing `allowedRoots`.
- Do not weaken Worktree isolation.
- Do not merge or finish tasks automatically.
- Do not treat launcher/client quoting failures as MiMo task failures.

## Tests

`tests/mimo-bridge-client.test.mjs` covers:

- JSON payload containing Chinese path text.
- JSON payload containing greater-than signs, less-than signs, quotes, backslashes, and newlines.
- Missing daemon produces an actionable error.
- Structured JSON output always contains `ok` and `operation` fields.
- `wait` uses an SDK request timeout greater than `timeout_seconds`.
- `start-and-wait` returns as soon as the wait operation reports completion.
- `start-and-wait` returns a structured error when the daemon is unreachable.
- Output stays bounded and does not include full diff/log/source by default.
- The PowerShell wrapper does not use `ConvertTo-Json`, `JSON.stringify`, or hard-coded task fields.

## Current Status

Implemented and merged in P5.4. MiMo produced the first implementation through task `task_2de8918c60dd`; Codex reviewed it, fixed stale MCP client exit handling, strengthened tests, merged the Worktree, and accepted the task.

Run tests with:

```powershell
node --test tests/mimo-bridge-client.test.mjs
```

Additional verification:

```powershell
npm.cmd run build
node scripts/mimo-bridge-client.mjs health
node scripts/mimo-bridge-client.mjs review --task-id <task_id> --max-chars 3000
node scripts/mimo-bridge-client.mjs wait --task-id <completed_task_id> --timeout-seconds 5 --max-chars 3000
```

Important: do not go back to inline Node or PowerShell JSON construction for scripted delegation. Use this client wrapper so Chinese paths, quotes, newlines, and MCP wait timeouts are handled consistently.

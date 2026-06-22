# Low-Token Wait

## Module Goal

Replace repeated Codex task polling with one bounded daemon-side wait.

## Task Goal

Expose `mimo_wait_task(task_id, timeout_seconds, detail_level, max_chars)` over STDIO and shared HTTP MCP.

## Current Status

Implemented, committed in `522e7a7`, and deployed to the shared daemon. Root and daemon builds pass; normal regression is 228/228, excluding the tracked hanging Runner integration test.

## Entry Files

- `src/tools/wait-task.ts`
- `src/index.ts`
- `apps/local-daemon/src/tool-context.ts`
- `apps/local-daemon/src/mcp.ts`
- `tests/wait-task.test.mjs`
- `tests/stdio-protocol.test.mjs`

## Main Classes / Functions

- `createWaitTaskHandler`: waits while status is `queued` or `running`.
- `WaitTaskSchema`: limits timeout to 1-3600 seconds and detail to `summary` or `review`.

## Public Interfaces

- `mimo_wait_task`
- Default: wait 1800 seconds (30 minutes), then return a bounded Review Package when ready.
- Max: 3600 seconds (60 minutes) for long-running MiMo coding tasks.
- Early return: terminal or completed tasks return immediately within the wait window.
- Timeout: minimal task/status/timing response only; no full diff, logs, or source.

## Dependencies

TaskStore and the existing bounded `mimo_get_task` review handler.

## Collaboration Needed

Codex must call this after `mimo_start_task` or `mimo_reply_task` instead of repeatedly calling `mimo_get_task`.

When using the MCP TypeScript SDK directly, pass request options with a timeout longer than `timeout_seconds`. The SDK default request timeout is 60 seconds, so a long daemon-side wait can be cut off by the client even when `mimo_wait_task` is working correctly. For the default 1800-second wait, the SDK request timeout should be at least 1820 seconds; for 3600 seconds, at least 3620 seconds.

Example with default 1800-second daemon-side wait:

```ts
await client.callTool(
  {
    name: "mimo_wait_task",
    arguments: { task_id, timeout_seconds: 1800, detail_level: "review", max_chars: 8000 },
  },
  undefined,
  { timeout: 1820_000 },
);
```

## Required Changes

P4.6 increased `mimo_wait_task` default to 1800 seconds and max to 3600 seconds to match real MiMo coding task durations. Future callers must use this tool after start/reply instead of polling `mimo_get_task`, and SDK scripts must set a compatible client request timeout exceeding `timeout_seconds`.

## Implementation Approach

The daemon polls local persisted task state internally at one-second intervals. This consumes no Codex context and returns only once on readiness or timeout.

## Pending Work

Monitor real task usage while implementing P5.2; retain bounded responses and exponential backoff after a timeout. Ensure all MCP SDK callers pass a request timeout longer than `timeout_seconds`.

## Test Method

```powershell
npm.cmd run build
cd apps/local-daemon; npm.cmd run build; cd ../..
node --test tests/wait-task.test.mjs tests/stdio-protocol.test.mjs
```

HTTP smoke verified 11 tools, immediate terminal-task return, and the minimal timeout response. The 2026-06-22 real MiMo collaboration retest also verified that `mimo_wait_task` can return a bounded Review Package after a follow-up round when the MCP client timeout is explicitly extended.

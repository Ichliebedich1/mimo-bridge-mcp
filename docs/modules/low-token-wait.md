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
- `mimo_pending_reviews`
- Safe client: `node scripts\mimo-bridge-client.mjs recover --limit 10 --max-chars 8000`
- HTTP: `GET /api/pending-reviews?limit=10&max_chars=8000`
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

Monitor real task usage while implementing later phases; retain bounded responses and exponential backoff after a timeout. Ensure all MCP SDK callers pass a request timeout longer than `timeout_seconds`.

Known optimization point: Codex Desktop direct MCP tool calls can have a shorter host-side call limit than `mimo_wait_task`'s daemon-side wait window. In local testing, a direct tool call timed out at about 30 seconds while the MiMo task continued normally and later completed. This is a client/channel timeout, not a MiMo task failure.

Planned improvement:

1. Detect or document "direct MCP call" usage and avoid long blocking waits there.
2. Make direct MCP wait calls use a short default window, around 20-25 seconds, unless the caller is a safe long-wait client.
3. If the task is still running after that short window, return a bounded `still_running` response with the recommended `scripts/mimo-bridge-client.mjs wait --task-id ... --timeout-seconds ...` command.
4. Keep the safe client as the long-wait path because it sets a compatible SDK request timeout and exits cleanly.
5. Add admin UI/help text explaining that Codex's direct MCP tool entry is not reliable for hour-long blocking waits.

Related collaboration issue: if Codex has already stopped waiting, crashed, or been interrupted when MiMo finishes, the task can reach `review` state without Codex immediately resuming the review. This is now mitigated by a low-context recovery inbox:

1. `mimo_pending_reviews` lists tasks in `review` status without returning full diff, full logs, full source, or local runtime paths.
2. `/api/health` exposes `pending_reviews.count` and the recommended `recover` command.
3. `scripts/mimo-bridge-client.mjs recover` returns task IDs, small objective previews, risk flags, review recommendation, and the next bounded review command.
4. `scripts/mimo-review-wakeup.mjs` runs MiMo `recover` and Reasonix `agent-recover` once, deduplicates tasks, and prints a compact wakeup summary.
5. The current Codex thread has a 5-minute heartbeat automation named `mimo-bridge-review-wakeup` that calls the wakeup script and wakes the thread if a completed or failed task needs Codex review/intervention.

Operational rule: after any interruption, context compression, or suspiciously quiet wait, run `node scripts\mimo-bridge-client.mjs recover --limit 5 --max-chars 8000` before starting a new MiMo task. If the command returns 404, the daemon has not been restarted with the recovery-inbox code yet.

Important boundary: the local daemon cannot directly push into a stopped Codex turn by itself. The implemented wake behavior is a bounded inbox plus Codex App heartbeat. It avoids full-state polling and keeps token cost low, but its responsiveness depends on the heartbeat interval unless the user or Codex manually runs the recovery command.

## Test Method

```powershell
npm.cmd run build
cd apps/local-daemon; npm.cmd run build; cd ../..
node --test tests/wait-task.test.mjs tests/stdio-protocol.test.mjs tests/mimo-bridge-client.test.mjs tests/admin-api.test.mjs
```

HTTP smoke verified the recovery endpoint in tests. The live daemon must be restarted before `/api/pending-reviews` and `health.pending_reviews` appear on port 3210. The 2026-06-22 real MiMo collaboration retest also verified that `mimo_wait_task` can return a bounded Review Package after a follow-up round when the MCP client timeout is explicitly extended.

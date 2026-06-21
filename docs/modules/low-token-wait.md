# Low-Token Wait

## Module Goal

Replace repeated Codex task polling with one bounded daemon-side wait.

## Task Goal

Expose `mimo_wait_task(task_id, timeout_seconds, detail_level, max_chars)` over STDIO and shared HTTP MCP.

## Current Status

Implemented in the working tree, not committed or deployed. Root and daemon builds pass; directed tests are 9/9.

## Entry Files

- `src/tools/wait-task.ts`
- `src/index.ts`
- `apps/local-daemon/src/tool-context.ts`
- `apps/local-daemon/src/mcp.ts`
- `tests/wait-task.test.mjs`
- `tests/stdio-protocol.test.mjs`

## Main Classes / Functions

- `createWaitTaskHandler`: waits while status is `queued` or `running`.
- `WaitTaskSchema`: limits timeout to 1-600 seconds and detail to `summary` or `review`.

## Public Interfaces

- `mimo_wait_task`
- Default: wait 300 seconds, then return a bounded Review Package when ready.
- Timeout: minimal task/status/timing response only.

## Dependencies

TaskStore and the existing bounded `mimo_get_task` review handler.

## Collaboration Needed

Codex must call this after `mimo_start_task` or `mimo_reply_task` instead of repeatedly calling `mimo_get_task`.

## Required Changes

1. Run normal regression.
2. Commit P4.6.
3. Rebuild/restart the shared daemon.
4. Verify HTTP MCP lists 11 tools and exercise immediate, completed, and timeout behavior.

## Implementation Approach

The daemon polls local persisted task state internally at one-second intervals. This consumes no Codex context and returns only once on readiness or timeout.

## Pending Work

Deployment and real HTTP MCP smoke.

## Test Method

```powershell
npm.cmd run build
cd apps/local-daemon; npm.cmd run build; cd ../..
node --test tests/wait-task.test.mjs tests/stdio-protocol.test.mjs
```

Then run the normal regression excluding `tests/runner-integration.test.mjs`.

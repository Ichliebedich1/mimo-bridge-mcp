# Agent Instructions

## Stack And Commands

- Runtime: Node.js + TypeScript + MCP SDK. Production collaboration uses the shared local daemon over Streamable HTTP; STDIO remains a compatibility/test entry.
- Build: `npm.cmd run build`
- Admin UI build: `cd apps/admin-ui; npm.cmd run build`
- Local daemon build: `cd apps/local-daemon; npm.cmd run build`
- Normal regression: `node --test (rg --files tests -g '*.test.mjs' | Where-Object { $_ -notmatch 'runner-integration\.test\.mjs$' })`
- Do not run `tests/runner-integration.test.mjs` in the normal suite; it is a tracked hanging P2 test debt.

## Shared Collaboration Runtime

- Start the daemon with `powershell -ExecutionPolicy Bypass -File apps/local-daemon/start-local.ps1`.
- Codex `mimo_bridge` must point to `http://127.0.0.1:3210/mcp` so the UI and Codex share one queue, running-task registry, and token manager.
- Do not run the production STDIO bridge beside the daemon for task execution.
- Config transport changes take effect only after restarting Codex or opening a new Codex session.
- The UI handoff control copies a bounded review prompt and opens `codex://threads/new`; it does not silently submit a message.
- `mimo_delete_task` is permanent: only delete `accepted`, `failed`, `cancelled`, or `abandoned` tasks after confirming they have no Worktree. Browser actions require the UI confirmation dialog.

## Mandatory Low-Context Review

When reviewing a MiMo task, call `mimo_get_task` in this order:

1. Start with `detail_level="review"` and a small `max_chars` budget.
2. Check editable paths, changed files, out-of-bounds report, diff stat, test result, and risk flags.
3. If no risk is present, decide whether to merge without reading full files or logs.
4. If risk is present, request only the relevant `diff_paths`, `file_paths`, or log tail.
5. Use `detail_level="full"` only for explicit debugging and record why escalation was necessary.

Never read the whole repository, complete logs, complete diff, or unrelated files merely for convenience.

## Current Boundary

- P4.5 token-budget review is implemented and tested.
- P4 queue code still has a known blocker: a task returned as `queued` can start immediately. Do not treat P4 as accepted until that behavior is repaired and independently reproduced as fixed.

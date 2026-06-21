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
- P4 write tasks are serialized through `TaskQueue`; queue occupancy ends only on the real Runner completion, failure, or cancellation callback.
- Keep regression coverage for duplicate queued replies and queued Worktree cleanup when changing task lifecycle code.

## Planned Windows Launcher And Distribution

- `apps/local-daemon/start-local.ps1` is currently machine-specific and is not a production installer entrypoint.
- P5.2 must first move Node, MiMo, allowed roots, runtime directory, and port into persisted local configuration with first-run discovery.
- Production startup must use existing build artifacts and must not rebuild the UI or daemon on every launch.
- The launcher must reuse the existing localhost daemon, guard against duplicate instances and port conflicts, wait for `/api/health`, and then open the existing admin UI.
- P5.3 targets Windows 10/11 x64 first. Bundle the Node runtime and production artifacts, but do not migrate MiMo credentials, active tasks, or Worktrees between devices.

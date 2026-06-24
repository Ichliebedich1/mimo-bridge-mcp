# Local Daemon And Admin UI

## Module Goal

Give Codex and the browser one shared localhost runtime and a review-first management interface.

## Current Status

Implemented. The daemon serves Streamable HTTP MCP, fixed REST APIs, the built React UI, persisted configuration, safe-delete metadata, TokenBudget status from real MiMo token events, a bounded read-only live-run viewer, and backend-safe task/session folder opening at port 3210.

## Entry Files

- `apps/local-daemon/src/index.ts`
- `apps/local-daemon/src/admin-api.ts`
- `apps/local-daemon/src/live-task-view.ts`
- `apps/local-daemon/src/task-open-actions.ts`
- `apps/local-daemon/src/mcp.ts`
- `apps/admin-ui/src/App.tsx`

## Public Interfaces

- `/mcp`
- `/api/health`
- `/api/tasks`
- `/api/tasks/:id`
- `/api/tasks/:id/live`
- `/api/tasks/:id/open`
- `/api/queue`
- `/api/token-budget`
- `/` admin UI

`/api/tasks` and `/api/tasks/:id` include browser-safe delete metadata:

- `can_delete`
- `delete_blockers`
- `delete_label`

The admin UI uses these backend-derived fields for the safe-delete filter and delete button visibility. Do not reintroduce client-only deletion guessing.

`POST /api/tasks/:id/open` accepts only fixed actions:

- `task_folder`
- `session_folder`

The browser must not send raw local paths. The daemon resolves targets from stored task state, validates Worktree/workspace/Reasonix-home boundaries, opens the folder locally, and returns only target kind/name.

## Dependencies

P0-P4.5 runtime services and the built admin UI.

## Collaboration Needed

P5.2 must manage this daemon's lifecycle and open this UI. It must not introduce a parallel backend.

## Pending Work

- Direct Reasonix GUI-to-specific-session opening remains future work unless Reasonix exposes a stable command or deep link.
- Keep one-click launcher behavior aligned with the existing localhost daemon; do not add a second backend.

## Test Method

Build both apps, run admin/live-view/open-action API tests, verify `/api/health`, and list the deployed MCP tools. Current focused verification includes:

- `node --test tests/admin-api.test.mjs tests/task-open-actions.test.mjs`

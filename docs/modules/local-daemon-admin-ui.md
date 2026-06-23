# Local Daemon And Admin UI

## Module Goal

Give Codex and the browser one shared localhost runtime and a review-first management interface.

## Current Status

Implemented. The daemon serves Streamable HTTP MCP, fixed REST APIs, the built React UI, persisted configuration, safe-delete metadata, TokenBudget status from real MiMo token events, and a bounded read-only live-run viewer at port 3210. It is currently running and healthy.

## Entry Files

- `apps/local-daemon/src/index.ts`
- `apps/local-daemon/src/admin-api.ts`
- `apps/local-daemon/src/live-task-view.ts`
- `apps/local-daemon/src/mcp.ts`
- `apps/admin-ui/src/App.tsx`

## Public Interfaces

- `/mcp`
- `/api/health`, `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/live`, `/api/queue`, `/api/token-budget`
- `/` admin UI

`/api/tasks` and `/api/tasks/:id` include browser-safe delete metadata:

- `can_delete`
- `delete_blockers`
- `delete_label`

The admin UI uses these backend-derived fields for the `可安全删除` filter and delete button visibility. Do not reintroduce client-only deletion guessing.

## Dependencies

P0-P4.5 runtime services and the built admin UI.

## Collaboration Needed

P5.2 must manage this daemon's lifecycle and open this UI. It must not introduce a parallel backend.

## Pending Work

- Add backend-safe admin UI actions for opening a task folder and opening the current task session window.
- Use the external Mimo Code Session Manager design as reference: resolve stale Bridge Worktree paths back to original workspace metadata where possible, never expose arbitrary path-open endpoints, and keep the live viewer read-only.
- Keep one-click launcher behavior aligned with the existing localhost daemon; do not add a second backend.

## Test Method

Build both apps, run admin/live-view API tests, verify `/api/health`, and list the deployed MCP tools. Current focused verification includes `node --test tests/admin-api.test.mjs`.

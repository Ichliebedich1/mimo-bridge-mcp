# Local Daemon And Admin UI

## Module Goal

Give Codex and the browser one shared localhost runtime and a review-first management interface.

## Current Status

Implemented. The daemon serves Streamable HTTP MCP, fixed REST APIs, the built React UI, persisted configuration, and a bounded read-only live-run viewer at port 3210. It is currently running and healthy.

## Entry Files

- `apps/local-daemon/src/index.ts`
- `apps/local-daemon/src/admin-api.ts`
- `apps/local-daemon/src/live-task-view.ts`
- `apps/local-daemon/src/mcp.ts`
- `apps/admin-ui/src/App.tsx`

## Public Interfaces

- `/mcp`
- `/api/health`, `/api/tasks`, `/api/tasks/:id/live`, `/api/queue`, `/api/token-budget`
- `/` admin UI

## Dependencies

P0-P4.5 runtime services and the built admin UI.

## Collaboration Needed

P5.2 must manage this daemon's lifecycle and open this UI. It must not introduce a parallel backend.

## Pending Work

One-click launcher, real token events, and deployment of `mimo_wait_task`.

## Test Method

Build both apps, run admin/live-view API tests, verify `/api/health`, and list the deployed MCP tools.

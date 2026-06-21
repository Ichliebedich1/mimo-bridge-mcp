# Local Daemon And Admin UI

## Module Goal

Give Codex and the browser one shared localhost runtime and a review-first management interface.

## Current Status

Implemented. The daemon serves Streamable HTTP MCP, fixed REST APIs, and the built React UI at port 3210. It is currently running and healthy.

## Entry Files

- `apps/local-daemon/src/index.ts`
- `apps/local-daemon/src/admin-api.ts`
- `apps/local-daemon/src/mcp.ts`
- `apps/admin-ui/src/App.tsx`

## Public Interfaces

- `/mcp`
- `/api/health`, `/api/tasks`, `/api/queue`, `/api/token-budget`
- `/` admin UI

## Dependencies

P0-P4.5 runtime services and the built admin UI.

## Collaboration Needed

P5.2 must manage this daemon's lifecycle and open this UI. It must not introduce a parallel backend.

## Pending Work

Persistent one-click startup, real token events, and one supervised UI-to-merge workflow.

## Test Method

Build both apps, run admin API tests, verify `/api/health`, and list the 10 MCP tools.

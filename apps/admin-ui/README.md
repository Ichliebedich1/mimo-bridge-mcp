# MiMo Bridge Admin UI

React + Vite management console for the local MiMo Bridge daemon.

The UI follows the B+C direction selected during design review:

- B: friendly guided operation flow for non-professional developers.
- C: review-first task workbench for detail pages.

## Current capabilities

- Polls `/api/health`, `/api/tasks`, `/api/queue`, and `/api/token-budget`.
- Creates tasks through `POST /api/tasks`.
- Sends replies, cancels tasks, finishes tasks, merges/discards Worktrees, and resets token budget through fixed REST routes.
- Defaults task detail to `detail_level=review`.
- Loads focused diff and log tails only after explicit user action.
- Keeps `full` mode behind an advanced confirmation and a 20,000 character cap.
- Falls back to mock data when the local daemon is unavailable, with a visible degraded banner.

The browser never directly reads `runtime/tasks`, raw logs, or Worktree files, and it never sends arbitrary MCP tool names to the daemon.

## Run in development

    cd "C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\mimo-bridge-mcp\apps\admin-ui"
    npm.cmd install
    npm.cmd run dev

Open http://127.0.0.1:5173/.

The Vite dev server proxies `/api` to http://127.0.0.1:3210.

## Build

    npm.cmd run build

The local daemon serves the built `dist` directory from http://127.0.0.1:3210/.

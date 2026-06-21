# MiMo Bridge Local Daemon

Localhost-only daemon that shares one in-process MiMo Bridge tool context between:

- MCP Streamable HTTP at `/mcp`;
- fixed admin REST routes at `/api/*`;
- static serving of `apps/admin-ui/dist`.

It creates one shared `TaskStore`, task queue/running registry, and token-budget handler. The admin UI does not get an arbitrary MCP proxy.

## Run

On this workstation:

    cd "C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\mimo-bridge-mcp\apps\local-daemon"
    powershell -ExecutionPolicy Bypass -File .\start-local.ps1

Then open http://127.0.0.1:3210/.

## Launcher

After start-local.ps1 builds the daemon, use the launcher for lifecycle control:

    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 status
    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 start -Open
    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 stop
    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 restart -Open
    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 logs

The launcher writes its ownership state and bounded logs under %LOCALAPPDATA%\MiMoBridge. It only stops a daemon whose saved PID and command line match the built MiMo Bridge daemon entry. It will not kill an unrelated process merely because that process owns port 3210.

First-run setup:

    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 configure

Shortcut and opt-in logon startup:

    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 shortcut
    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 autostart status
    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 autostart enable
    powershell -ExecutionPolicy Bypass -File .\launcher.ps1 autostart disable

Autostart is disabled by default and is only enabled by the explicit command above.

Manual build/run:

    cd "C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\mimo-bridge-mcp\apps\admin-ui"
    npm.cmd run build
    cd "C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\mimo-bridge-mcp\apps\local-daemon"
    npm.cmd run build
    npm.cmd run start

## Environment

- `MIMO_NODE_PATH`
- `MIMO_ENTRY_PATH`
- `MIMO_ALLOWED_ROOTS`
- `MIMO_RUNTIME_DIR` optional
- `MIMO_DAEMON_PORT` optional, defaults to `3210`

If MiMo environment variables are missing, the daemon starts in degraded mode. Read-only health/task state remains visible, while mutating endpoints that need MiMo return a clear API error.

## Browser safety

Responses are sanitized before reaching the browser. Sensitive local fields such as raw log paths, Worktree paths, repository paths, runtime roots, and MiMo executable paths are removed from API output.

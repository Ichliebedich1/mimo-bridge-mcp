# Windows Launcher And Portability

## Module Goal

Start MiMo Bridge from a desktop interface and install or copy it to another Windows x64 computer without editing source paths.

## Task Goal

P5.2 delivers one-click lifecycle management. P5.3 delivers portable ZIP and installer artifacts.

## Current Status

Stage 1 is complete: persisted JSON configuration, environment overrides, and build-free `start-production.ps1`. The read-only live-run viewer is also complete.

Stage 2 lifecycle code is implemented: a thin launcher controller/CLI starts, stops, restarts, opens the UI, reports status, reads bounded logs, detects duplicate daemons and port conflicts, creates a desktop shortcut, offers an explicit first-run config wizard, and can register/unregister an opt-in per-user logon Scheduled Task. Portable ZIP and installer work remains P5.3.

## Entry Files

- `apps/local-daemon/start-local.ps1`
- `apps/local-daemon/launcher.ps1`
- `apps/local-daemon/src/launcher-controller.ts`
- `apps/local-daemon/src/launcher-cli.ts`
- `apps/local-daemon/src/daemon-config.ts`
- `apps/local-daemon/src/index.ts`
- `apps/admin-ui/`

## Public Interfaces

- Health: `GET /api/health`
- Admin UI: `http://127.0.0.1:3210/`
- MCP: `http://127.0.0.1:3210/mcp`

## Dependencies

Existing P5 daemon/UI, MiMo CLI, Node runtime, production dependencies, and Windows process/startup facilities.

## Collaboration Needed

- Daemon configuration must support persisted paths and first-run discovery.
- Launcher must manage only one daemon instance and surface missing MiMo, invalid paths, and port conflicts.
- Distribution tooling must package the correct Windows architecture for `node-pty`.

## Required Changes

1. Replace hardcoded startup values with a local config file and environment overrides.
2. Split development build/start from production start; production startup must not compile.
3. Add start, stop, restart, open UI, status, and log controls. Complete in the launcher controller and CLI.
4. Add desktop shortcut and optional per-user logon startup. Complete as explicit launcher commands; autostart remains off by default.
5. Add first-run setup for MiMo discovery, allowed roots, runtime directory, and Codex MCP endpoint. Complete as `launcher.ps1 configure`.
6. Produce Windows x64 portable ZIP and installer.
7. Add a read-only live-run viewer from the admin task page. It may display status, bounded recent events, and log tails, but must not attach to MiMo stdin, reuse an interactive CLI window, or provide stop/input controls.

Items 1, 2, 3, 4, 5, and 7 are complete.

## Implementation Approach

Keep the existing React UI and Node daemon. Build a thin Windows launcher around them. Store installed-mode data under `%LOCALAPPDATA%\MiMoBridge`; use a local `data` directory for portable mode. Bundle Node and built application artifacts, but require MiMo installation/authentication on the destination device.

## Pending Work

- Build the Windows 10 x64 portable ZIP and installer with bundled Node.
- Validate clean-machine install, Chinese/space paths, no system Node, port conflict, reboot, Codex MCP, shortcut, opt-in autostart, and uninstall.

## Test Method

- Launch twice and verify one daemon instance.
- Reboot/logon and verify optional startup.
- Test missing MiMo, occupied port, invalid allowed root, Chinese/space paths, and clear error messages.
- Validate install, real MiMo task, Codex MCP connection, uninstall, and portable ZIP on a clean Windows x64 environment.

Focused launcher regression:

```powershell
cd apps/local-daemon
npm.cmd run build
cd ../..
node --test tests/launcher-controller.test.mjs
```

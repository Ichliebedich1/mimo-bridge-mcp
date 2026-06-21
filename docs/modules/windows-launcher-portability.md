# Windows Launcher And Portability

## Module Goal

Start MiMo Bridge from a desktop interface and install or copy it to another Windows x64 computer without editing source paths.

## Task Goal

P5.2 delivers one-click lifecycle management. P5.3 delivers portable ZIP and installer artifacts.

## Current Status

Planned only. The existing daemon/UI are working, but `apps/local-daemon/start-local.ps1` is machine-specific and rebuilds on every start.

## Entry Files

- `apps/local-daemon/start-local.ps1`
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
3. Add start, stop, restart, open UI, status, and log controls.
4. Add desktop shortcut and optional per-user logon startup.
5. Add first-run setup for MiMo discovery, allowed roots, runtime directory, and Codex MCP endpoint.
6. Produce Windows x64 portable ZIP and installer.
7. Add a read-only live-run viewer from the admin task page. It may display status, bounded recent events, and log tails, but must not attach to MiMo stdin, reuse an interactive CLI window, or provide stop/input controls.

## Implementation Approach

Keep the existing React UI and Node daemon. Build a thin Windows launcher around them. Store installed-mode data under `%LOCALAPPDATA%\MiMoBridge`; use a local `data` directory for portable mode. Bundle Node and built application artifacts, but require MiMo installation/authentication on the destination device.

## Pending Work

- Target Windows 10 x64 only for the first release.
- Keep logon startup disabled by default and enable it only when the user checks the option.
- Bundle Node in portable/installable artifacts, but never bundle or migrate MiMo login information.
- Implement the read-only live-run viewer after the configuration/startup layer is merged.
- Decide the final launcher shell after the configuration/startup layer is tested.

## Test Method

- Launch twice and verify one daemon instance.
- Reboot/logon and verify optional startup.
- Test missing MiMo, occupied port, invalid allowed root, Chinese/space paths, and clear error messages.
- Validate install, real MiMo task, Codex MCP connection, uninstall, and portable ZIP on a clean Windows x64 environment.

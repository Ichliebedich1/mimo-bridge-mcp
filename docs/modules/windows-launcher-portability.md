# Windows Launcher And Portability

## Module Goal

Start MiMo Bridge from a desktop interface and install or copy it to another Windows x64 computer without editing source paths.

## Task Goal

P5.2 delivers one-click lifecycle management. P5.3 delivers portable ZIP and installer artifacts.

## Current Status

Stage 1 is complete: persisted JSON configuration, environment overrides, and build-free `start-production.ps1`. The read-only live-run viewer is also complete.

Stage 2 lifecycle code is implemented: a thin launcher controller/CLI starts, stops, restarts, opens the UI, reports status, reads bounded logs, detects duplicate daemons and port conflicts, creates a desktop shortcut, offers an explicit first-run config wizard, and can register/unregister an opt-in per-user logon Scheduled Task. Local smoke has verified launcher-owned daemon health, duplicate-start prevention, stop/start, shortcut creation, bounded logs, and autostart disabled by default.

P5.3 portable ZIP and EXE installer generation are implemented. `npm.cmd run package:portable` creates `artifacts/MiMoBridge-portable-win10-win11-x64.zip`; `npm.cmd run package:installer` creates `artifacts/MiMoBridgeSetup-win10-win11-x64.exe`. Both target Windows 10/11 x64 and bundle `node.exe`, built daemon/UI artifacts, and production dependencies without MiMo credentials/tasks/Worktrees.

Installer update hardening is implemented. The setup stub supports `-Help` and rejects unknown flags before installation begins. The PowerShell installer verifies the installed daemon is stopped before replacing app files, checks for locked native/runtime files, uses a staged payload plus rollback instead of deleting live directories first, writes setup logs under `%LOCALAPPDATA%\MiMoBridge\setup.log`, and leaves the previous install intact if shutdown or replacement cannot be proven safe.

Upgrade compatibility now covers older installs that are missing `%LOCALAPPDATA%\MiMoBridge\launcher-state.json`. During setup, the installer still calls the launcher first. If the launcher cannot prove ownership, setup checks the owner of the configured port and only stops it when the command line proves it is the old installed daemon from `%LOCALAPPDATA%\MiMoBridgeApp` (`node.exe`, `local-daemon`, and `index.js` under the install root). If ownership cannot be proven, setup keeps the old install intact and asks the user to close MiMo Bridge or reboot before retrying.

## Entry Files

- `apps/local-daemon/start-local.ps1`
- `apps/local-daemon/launcher.ps1`
- `apps/local-daemon/src/launcher-controller.ts`
- `apps/local-daemon/src/launcher-cli.ts`
- `apps/local-daemon/src/daemon-config.ts`
- `apps/local-daemon/src/index.ts`
- `scripts/build-portable.ps1`
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
6. Produce Windows 10/11 x64 portable ZIP and EXE installer.
7. Add a read-only live-run viewer from the admin task page. It may display status, bounded recent events, and log tails, but must not attach to MiMo stdin, reuse an interactive CLI window, or provide stop/input controls.

Items 1, 2, 3, 4, 5, and 7 are complete.

## Implementation Approach

Keep the existing React UI and Node daemon. Build a thin Windows launcher around them. Store installed-mode data under `%LOCALAPPDATA%\MiMoBridge`; use a local `data` directory for portable mode. Bundle Node and built application artifacts, but require MiMo installation/authentication on the destination device.

## Pending Work


- Validate clean-machine install, Chinese/space paths, no system Node, port conflict, reboot, Codex MCP, shortcut, opt-in autostart, and uninstall.
- Validate upgrade over a running old installed daemon on a clean machine; expected behavior is automatic stop when the daemon is proven to come from the install root, or a clean abort with the old install preserved if ownership cannot be proven.
- Re-run portable smoke from the generated ZIP on a clean machine.
- Verify whether direct start/restart stdout behaves normally in an interactive Windows console; the Codex shell harness can lose stdout capture after daemon spawn, while `status -Json` verifies the daemon is healthy.

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

Current local verification:

```powershell
npm.cmd run build
cd apps/local-daemon; npm.cmd run build; cd ../..
node --test tests/launcher-controller.test.mjs
$tests = Get-ChildItem -LiteralPath 'tests' -Filter '*.test.mjs' | Where-Object { $_.Name -ne 'runner-integration.test.mjs' } | ForEach-Object { $_.FullName }
node --test $tests
```

Expected current counts: launcher plus installer plus release-validation focused regression 20/20; normal regression count varies as new tests are added, but `tests/runner-integration.test.mjs` remains excluded from normal Windows regression.

Portable package generation:

```powershell
npm.cmd run package:portable
```

Installer package generation:

```powershell
npm.cmd run package:installer
```

Installer payload self-test:

```powershell
artifacts\MiMoBridgeSetup-win10-win11-x64.exe -SelfTest
```

`-SelfTest` now extracts the embedded payload to `%TEMP%`, checks required files and forbidden runtime data, starts a temporary daemon from the bundled `node.exe` on a self-test port, verifies `/api/health`, verifies `/` serves Admin UI HTML, then stops the temporary process.

Release validation:

```powershell
npm.cmd run validate:release
```

Generated outputs:

- `artifacts/portable/MiMoBridge`
- `artifacts/MiMoBridge-portable-win10-win11-x64.zip`
- `artifacts/MiMoBridgeSetup-win10-win11-x64.exe`

Latest generated portable ZIP and installer EXE are produced by `npm.cmd run package:installer`; generated artifacts are ignored by Git under `artifacts/`.

The package root contains `MiMo Bridge Launcher.cmd`, `Start MiMo Bridge.cmd`, `Stop MiMo Bridge.cmd`, `Configure MiMo Bridge.cmd`, `README_PORTABLE.md`, `package-manifest.json`, `node/node.exe`, `app/`, and `data/`.

# Troubleshooting

This guide focuses on the Windows-first local daemon, Admin UI, MCP endpoint, MiMo Code runner, and low-token review workflow.

## Daemon Does Not Start

Check basic prerequisites:

- Node.js is available for source checkout development, or bundled Node exists in the packaged build.
- Git is installed.
- MiMo Code is installed and logged in for real task execution.
- The repository path does not contain broken or missing build artifacts.

Useful commands:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 status
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 logs
```

For source checkout development, rebuild first:

```powershell
npm.cmd run build
cd apps/admin-ui; npm.cmd run build; cd ../..
cd apps/local-daemon; npm.cmd run build; cd ../..
```

## Port 3210 Is Already In Use

The daemon expects:

```text
http://127.0.0.1:3210/
http://127.0.0.1:3210/mcp
```

First check whether an existing MiMo Bridge daemon is already running:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 status
```

If it is a stale process, stop and restart:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 stop
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 start -Open
```

If another program owns the port, close that program or change the bridge configuration only if the project docs for your version support it.

## Codex Cannot See MCP Tools

Confirm the MCP endpoint is exactly:

```text
http://127.0.0.1:3210/mcp
```

Then:

1. Confirm daemon status is healthy.
2. Restart Codex or open a new Codex session.
3. Check that Codex is configured for streamable HTTP MCP, not the older STDIO path.
4. Avoid running a separate production STDIO bridge beside the daemon for task execution.

MCP config changes may not affect an already-open Codex session.

## MiMo Code Is Not Installed Or Not Logged In

MiMo Code is not bundled with this project. Install and log in to MiMo Code separately on each machine.

Symptoms can include:

- Task starts but runner fails immediately.
- Task hangs waiting for MiMo Code.
- Review package has runner or login-related errors.

After installing or logging in, restart the local daemon and retry a small bounded task.

## MiMo Task Is Stuck

Use the low-token workflow:

1. Call `mimo_wait_task` once with a bounded timeout.
2. If the wait times out, read minimal task status.
3. Read only the relevant log tail if needed.
4. Cancel or discard only when you understand the task state.

Avoid repeatedly polling full task details. Avoid reading full logs unless debugging truly requires it.

## Worktree Was Not Created Correctly

Check the task review package first. It should identify changed files, Worktree status, and risk flags when available.

Common causes:

- Git is not installed or not on PATH.
- The repository path is invalid.
- The task was started from the wrong repository root.
- Another task lifecycle operation is already running.
- Local permissions block Worktree creation.

Do not manually merge a suspicious Worktree. Inspect focused diff and task metadata before deciding.

## How To Review Before Merge

Recommended sequence:

1. Read `mimo_get_task(detail_level="review")`.
2. Check changed files, diff stat, risk flags, out-of-bounds changes, and test notes.
3. If low risk, decide from the review package.
4. If unclear, request focused diff or specific files.
5. Merge only after Codex or the user accepts the result.

MiMo Code should not merge its own Worktree.

## How To View Logs

Use:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 logs
```

When sharing logs in issues, include only the smallest useful excerpt and redact:

- Usernames.
- Private paths.
- API keys.
- Tokens.
- MiMo credentials.
- Project-private content.

## How To Stop The Daemon

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 stop
```

To restart and open the Admin UI:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 restart -Open
```

## Installer Stays At 0 Percent Or Text Keeps Flashing

This can happen during an upgrade when an older installed daemon is still running from `%LOCALAPPDATA%\MiMoBridgeApp`, but the old launcher state file is missing. The old launcher reports the daemon as unmanaged, so the installer must prove the process really belongs to the installed MiMo Bridge before stopping it.

Newer installers handle this automatically when the port owner command line clearly points to the installed daemon (`node.exe`, `local-daemon`, and `index.js` under `%LOCALAPPDATA%\MiMoBridgeApp`). If Windows policy prevents reading the command line, or if port 3210 belongs to another process, setup stops safely and keeps the old install.

Recovery:

```powershell
# Check who owns the daemon port.
Get-NetTCPConnection -LocalPort 3210 -State Listen | Select-Object -First 1

# If it is the old MiMo Bridge daemon and setup cannot stop it, reboot Windows,
# then run the installer again before opening MiMo Bridge.
```

The setup log is written to:

```text
%LOCALAPPDATA%\MiMoBridge\setup.log
```

## How To Reset Local State

Use caution. Local state can include task metadata and runtime data.

Recommended approach:

1. Stop the daemon.
2. Back up any data you need.
3. Inspect the configured data directory before deleting anything.
4. Restart the daemon and verify health.

Do not delete task Worktrees or runtime data if you still need to review or recover work.

## PowerShell Execution Policy Blocks Scripts

Run project scripts with:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/start-local.ps1
```

This bypass applies to the launched process and does not permanently change the machine policy.

## Antivirus Or SmartScreen Blocks EXE Installer

The project is early alpha and may not have reputation with Windows SmartScreen or antivirus tools.

Suggested steps:

- Prefer testing on a disposable clean Windows VM.
- Verify the artifact came from the expected GitHub release.
- Use the portable ZIP if you do not want to run the EXE installer.
- Report the antivirus product, detection name, Windows version, and artifact name in a GitHub issue.

Do not bypass endpoint security on a work machine without permission.

## Localhost-Only Safety

The daemon is intended for local use only:

```text
127.0.0.1:3210
```

Do not expose it to public networks, shared LANs, tunnels, or reverse proxies. The bridge can coordinate command execution, file changes, and Worktree operations, so it should stay behind the local user boundary.

# Architecture

## Runtime Flow

```text
Codex MCP client      ->  http://127.0.0.1:3210/mcp
Browser admin UI      ->  http://127.0.0.1:3210/api/*
Windows launcher      ->  local daemon lifecycle commands

All three share one localhost daemon:

Local daemon -> task queue/store -> MiMo PTY runner
             -> Git Worktree and Review Package services
             -> static admin UI
```

## Core Boundaries

- The daemon at `127.0.0.1:3210` owns the shared queue, running-task registry, token manager, REST API, MCP endpoint, and static admin UI.
- Codex and the browser must use the same daemon. Do not start a production STDIO bridge beside it.
- MiMo writes should normally use a task Worktree. Codex decides merge or discard.
- Review evidence escalates from `review` to focused diff/log/file reads; full repository reads are not the default.
- The browser never reads raw runtime files, raw Worktree paths, or arbitrary MCP tools directly.

## Configuration

The daemon loads `%LOCALAPPDATA%\MiMoBridge\config.json` by default. `MIMO_BRIDGE_CONFIG` selects another file, and per-field environment variables override persisted values.

`allowedRoots` remains a machine-level hard boundary. A task cannot expand it. New roots are added locally with `MiMo Bridge Launcher.cmd allow-root --path "<project>" --restart`, which validates the real directory before writing config. `/api/health` reports the config source, load time, redacted stable fingerprint, allowed-root count, disk-change flag, and restart command without returning root values or raw config.

- `start-local.ps1` builds and starts the development daemon.
- `start-production.ps1` starts existing artifacts through the launcher path.
- Portable packages set `MIMO_BRIDGE_CONFIG` and `MIMO_BRIDGE_DATA_DIR` to package-local `data`.
- Installer launchers set app files under `%LOCALAPPDATA%\MiMoBridgeApp` and user data under `%LOCALAPPDATA%\MiMoBridge`.

## Low-Token Execution Flow

```text
mimo_start_task
  -> mimo_wait_task with bounded timeout
  -> mimo_get_task(detail_level="review")
  -> focused diff/file/log reads only when risk requires them
  -> merge or discard Worktree
```

The read-only UI live viewer polls only while its modal is open. Codex should not repeatedly poll unchanged task status.

## Task Admission And Startup

```text
validate request and normalized paths
  -> resolve idempotency key
  -> persist placeholder (preparing_worktree + request_id)
  -> return to caller
  -> background queue (capacity 8, path-conflict aware)
  -> prepare attachments / Worktree / brief
  -> starting_agent
  -> running
```

Only the idempotency-key hash and normalized request fingerprint are persisted. Same-key/same-request retries replay the original task; same-key/different-request attempts fail with `IDEMPOTENCY_CONFLICT`. Every phase failure records a bounded `error_detail={code,message,phase,request_id,occurred_at,retryable}`. On daemon startup, orphaned non-terminal tasks become `DAEMON_RESTARTED` failures so they remain observable instead of appearing indefinitely active.

## Windows Startup And Distribution

```text
User shortcut / portable launcher / installer shortcut
  -> launcher.ps1 / launcher controller
  -> existing built daemon
  -> /api/health readiness check
  -> admin UI opens in the browser
```

The Windows release line targets Windows 10/11 x64. Packages include built UI/daemon artifacts, production dependencies, an architecture-matched Node runtime, and the versioned `use-mimo-bridge-mcp` Codex skill. Skill installation is an explicit command that backs up any existing copy; packages never silently overwrite `%CODEX_HOME%/skills` or the default user skill directory. MiMo authentication remains device-local and is never packaged.

The launcher starts Node detached with ignored stdin and file-backed stdout/stderr, so the launcher exits after health succeeds. Existing unmanaged instances may be adopted only when PID ownership of the localhost port, executable real path, daemon-entry path, and health fingerprints all match exactly; restart never terminates a mismatched process.

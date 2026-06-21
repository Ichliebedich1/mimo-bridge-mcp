# Architecture

## Runtime Flow

```text
Codex ── Streamable HTTP MCP ──┐
                               ├─ Local daemon ── Task queue/store ── MiMo PTY Runner
Browser admin UI ── REST API ──┘                         │
                                                        └─ Git Worktree and Review Package
```

## Core Boundaries

- The daemon at `127.0.0.1:3210` owns the shared queue, running-task registry, token manager, REST API, MCP endpoint, and static admin UI.
- Codex and the browser must use the same daemon. Do not start a production STDIO bridge beside it.
- MiMo writes should normally use a task Worktree. Codex decides merge or discard.
- Review evidence escalates from `review` to focused diff/log/file reads; full repository reads are not the default.

## Current Configuration

The daemon loads `%LOCALAPPDATA%\MiMoBridge\config.json` by default. `MIMO_BRIDGE_CONFIG` selects another file, and per-field environment variables override persisted values. `start-local.ps1` builds for development; `start-production.ps1` starts existing artifacts only.

## Low-Token Execution Flow

```text
mimo_start_task -> mimo_wait_task (single bounded wait) -> Review Package -> focused evidence only if needed
```

The read-only UI viewer polls only while its modal is open. Codex should not repeatedly poll task summaries.

## Planned Startup Architecture

```text
Windows launcher ── persisted config/first-run discovery
        │
        ├─ start/stop/restart existing daemon
        ├─ poll /api/health and expose clear errors
        ├─ open existing React admin UI
        └─ optional per-user logon startup
```

The portable/installable package should include built UI/daemon artifacts, production dependencies, and an architecture-matched Node runtime. MiMo authentication remains device-local.

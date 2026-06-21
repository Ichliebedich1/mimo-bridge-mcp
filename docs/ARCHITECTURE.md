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

The daemon currently receives `MIMO_NODE_PATH`, `MIMO_ENTRY_PATH`, `MIMO_ALLOWED_ROOTS`, `MIMO_RUNTIME_DIR`, and `MIMO_DAEMON_PORT` through environment variables. `start-local.ps1` hardcodes machine-specific values and rebuilds before every start.

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

# Project Brief

## Project Goal

Let Codex plan, constrain, review, and accept work while MiMo executes bounded coding tasks through one shared localhost MCP daemon.

## User Needs

- Give MiMo tasks from Codex or the local management UI.
- Keep coding changes isolated in Git Worktrees and review bounded evidence before merge.
- Avoid large Codex context reads through Review Packages.
- Start the management system without PowerShell commands.
- Move the system to another Windows computer with minimal manual setup.

## Current Completed Work

- P0-P5.1 task lifecycle, PTY Runner, Worktree isolation, write queue, low-context review, shared HTTP MCP, admin UI, Codex handoff, and safe task deletion.
- Runner terminal-event fix: intermediate `tool-calls` no longer terminate MiMo.
- Review guard: zero-change coding tasks without tests receive `needs_attention`.
- Normal regression: 176/176 passing, excluding the tracked hanging Runner integration test.

## Current Runtime

- UI: `http://127.0.0.1:3210/`
- MCP: `http://127.0.0.1:3210/mcp`
- Current health: daemon `ok`, MCP `ready`, MiMo configured, queue empty.
- Current Runner/review changes and handover updates are not committed.

## Next Goal

Implement P5.2 Windows one-click startup, then P5.3 portable/installable Windows x64 distribution. Reuse the current React UI and Node daemon.

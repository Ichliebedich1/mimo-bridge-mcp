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
- P5.2 persisted configuration, build-free production start, launcher lifecycle commands, first-run configuration, desktop shortcut command, and opt-in autostart command.
- Read-only live-run viewer with bounded event summaries.
- Follow-up rounds stay in the saved Worktree and are re-audited before review.
- Runner terminal-event fix: intermediate `tool-calls` no longer terminate MiMo.
- Review guard: zero-change coding tasks without tests receive `needs_attention`.
- P4.6 low-token waiting over STDIO and shared HTTP MCP.
- Normal regression: 242/242 passing, excluding the tracked hanging Runner integration test.

## Current Runtime

- UI: `http://127.0.0.1:3210/`
- MCP: `http://127.0.0.1:3210/mcp`
- Current health: daemon `ok`, MCP `ready`, MiMo configured, queue empty.
- HTTP MCP exposes 11 tools including deployed `mimo_wait_task`.

## Next Goal

Validate the P5.2 launcher on a clean Windows 10 x64 machine, then build the P5.3 Windows 10 x64 portable/installable distribution.

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
- P5.2 stage 1 persisted configuration and build-free production start.
- Read-only live-run viewer with bounded event summaries.
- Follow-up rounds stay in the saved Worktree and are re-audited before review.
- Runner terminal-event fix: intermediate `tool-calls` no longer terminate MiMo.
- Review guard: zero-change coding tasks without tests receive `needs_attention`.
- Normal regression: 223/223 passing, excluding the tracked hanging Runner integration test.

## Current Runtime

- UI: `http://127.0.0.1:3210/`
- MCP: `http://127.0.0.1:3210/mcp`
- Current health: daemon `ok`, MCP `ready`, MiMo configured, queue empty.
- P4.6 `mimo_wait_task` is implemented and directed tests pass, but it is not committed or deployed yet.

## Next Goal

Deploy P4.6 low-token waiting, finish the P5.2 Windows one-click launcher, then build the P5.3 Windows 10 x64 portable/installable distribution.

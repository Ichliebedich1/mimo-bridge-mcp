# Project Handover Status

## Scope

MiMo Bridge MCP framework after P4 queue repair, P5/P5.1 delivery, MiMo Runner terminal-event repair, and planning for Windows startup/portability.

## Task Goal

Allow Codex to plan and review while MiMo performs bounded coding tasks through a shared localhost MCP daemon.

## Current Progress

- P0-P5.1 core code is implemented.
- P4 actual write serialization is fixed and committed in `8a58d84`.
- P5/P5.1 UI, HTTP daemon, Codex handoff, and safe deletion are committed in `c909016`.
- Previous handoff status commit: `dc497cf`; this document records the later context-compression state.
- MiMo Runner no longer treats `step_finish(reason="tool-calls")` as task completion; it waits for a terminal reason such as `stop`.
- Coding tasks with zero changes and no reported tests now receive `NO_CHANGES_AND_NO_TESTS` and `needs_attention`.
- Normal regression: 176/176 passed, excluding the known hanging `tests/runner-integration.test.mjs`.
- A real MiMo smoke completed `read -> edit -> read -> stop` and changed the requested file.
- These 2026-06-21 Runner/review changes are currently in the working tree and have not yet been committed.
- The shared daemon is currently online at `http://127.0.0.1:3210/`; health is `ok`, MCP is `ready`, MiMo is configured, and the queue is empty.
- P5.2/P5.3 have been planned only; no launcher or portable package code exists yet.

## Completed

- Ten MCP tools over STDIO compatibility and shared Streamable HTTP.
- Runner-bound start/reply queue, duplicate reply rejection, cancellation release, and queued Worktree cleanup.
- Review Package with bounded `summary/review/diff/focused/logs/full` escalation.
- Local admin UI, fixed REST API, Codex handoff action, and permanent terminal-task deletion.
- A concrete next-stage plan: P5.2 Windows one-click launcher, followed by P5.3 portable/installable distribution.

## Collaboration Needed

- Codex: define task boundaries, review Review Packages, and decide merge/discard.
- MiMo: execute bounded coding tasks through the shared daemon; do not merge its own Worktree.
- UI/daemon maintainer: verify the supported startup script keeps the daemon resident across Codex turns.
- Launcher/distribution maintainer: remove machine-specific paths, separate development builds from production startup, and package a first-run configuration flow.

## Remaining Work

1. Commit the current Runner/review fix and documentation as a recoverable baseline.
2. Implement P5.2: portable configuration plus one-click Windows launcher and optional logon startup.
3. Add a read-only "view live run" action to the task UI after the configuration/startup work is merged. It must show bounded task events/log tails without attaching an interactive terminal or exposing controls that can interrupt MiMo.
4. Implement P5.3: Windows 10 x64 portable ZIP and installer with first-run setup.
5. Connect real MiMo token events.
6. Audit active Worktree cancellation cleanup.
7. Run one supervised UI -> MiMo -> Review Package -> Codex -> merge workflow.

## Risks / Blockers

- Current daemon health is `ok`, MCP is `ready`, MiMo is configured, and the queue is empty; cross-turn persistence is still unproven.
- `apps/local-daemon/start-local.ps1` hardcodes this computer's Node, MiMo, and allowed-root paths and rebuilds on every launch; it is not portable.
- Do not copy MiMo credentials, active tasks, or Worktrees to another computer. Re-authenticate MiMo and transfer source projects through Git.
- Windows PTY warnings and the excluded Runner integration hang remain accepted first-version debt.

## Recommended Next Action

Commit the current uncommitted Runner/review changes first. Then implement P5.2 from `docs/modules/windows-launcher-portability.md` without rewriting the existing React UI or Node daemon.

Read after context compression in this order: this file, `HANDOFF.md` sections 10-11, `docs/modules/windows-launcher-portability.md`, `docs/OPEN_TASKS.md`, then `AGENTS.md`.

# Decisions

## 2026-06-19: Review Is The Default Detail Level

- Decision: `mimo_get_task` defaults to `review`, not `full`.
- Reason: Codex should receive decision-ready evidence without complete logs, diff, or source files.

## 2026-06-19: Escalation Is Explicit And Bounded

- Decision: `diff`, `focused`, `logs`, and `full` require explicit selection and respect `max_chars`.
- Reason: deeper evidence should be proportional to an identified risk.

## 2026-06-19: Full Does Not Mean Full Repository

- Decision: `full` is a broad task-artifact debugging bundle, still budgeted; it never scans the repository.
- Reason: repository-wide reading conflicts with the token-saving objective and path boundaries.

## 2026-06-19: P4.5 Does Not Hide P4 Queue Risk

- Decision: keep the queue defect as an independent blocker and do not mix its repair into P4.5.
- Reason: the review protocol can ship independently, while queue scheduling needs its own behavior fix and tests.

## 2026-06-20: Queue Lifetime Follows Runner Lifetime

- Decision: every start/reply enters `TaskQueue`, and its queue Promise resolves only after Runner completion, failure, or cancellation.
- Reason: process spawn is not task completion; releasing at spawn allows concurrent writes despite a `queued` response.

## 2026-06-21: Tool-Call Step Finish Is Not Task Completion

- Decision: `step_finish` with `reason="tool-calls"` is an intermediate event; the Runner completes only on a terminal step such as `reason="stop"` or on process exit.
- Reason: MiMo emits a step-finish event between tool-call rounds. Treating every step-finish as terminal killed MiMo immediately after its first file-reading round.

## 2026-06-21: Windows 10/11 x64 Is The First Distribution Target

- Decision: first release supports Windows 10/11 x64; logon startup is disabled by default; packages bundle Node but not MiMo credentials.
- Reason: one target reduces native `node-pty` packaging risk and keeps authentication device-local.

## 2026-06-21: Live Viewing Is Read-Only

- Decision: the task UI displays bounded event summaries only and never attaches to MiMo stdin or exposes input/stop controls.
- Reason: users can observe progress without interrupting the Bridge-owned process.

## 2026-06-21: Wait Once Instead Of Polling Repeatedly

- Decision: Codex should use `mimo_wait_task` after start/reply and receive one bounded result on readiness or timeout.
- Reason: repeated status calls and narration waste context tokens without improving execution.

## 2026-06-22: P6 Is Multi-Agent Dispatch, Not Provider Replacement

- Decision: Reasonix support must add an Agent Registry and generic dispatch tools instead of replacing MiMo as the single configured provider.
- Reason: the user wants Codex to assign work to both MiMo and Reasonix at the same time. A single `agentProvider` switch would block concurrent delegation and force unnecessary reconfiguration.

## 2026-06-24: Reasonix TUI Is The First Reasonix Execution Path

- Decision: P6 should first adapt Reasonix TUI as `reasonix-tui` through executable probing, `reasonix run`, session mapping, and output parsing. Reasonix GUI should initially be treated as a shared-session viewer/manual companion, not as the core automation runner.
- Reason: the local Reasonix install exposes a stable TUI binary and `run` command, while GUI automation would be brittle and could steal focus. CLI and desktop share Reasonix home/session storage, so TUI-created sessions can be made visible to GUI without click automation.

## 2026-06-24: Reasonix Should Target MiMo-Level Bridge Capability

- Decision: Reasonix integration should aim for the same Bridge workflow as MiMo: start task, wait once, review package first, focused escalation, Codex-controlled merge/discard, live viewer output, safe deletion, and admin UI visibility.
- Reason: the user wants Reasonix to become a peer execution agent, not a limited side integration.

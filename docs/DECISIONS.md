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

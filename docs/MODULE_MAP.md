# Module Map

| Phase | Module | Responsibility | Depends On |
|------|--------|----------------|------------|
| P0 | Runner and parser | MiMo PTY execution and event parsing | Node PTY |
| P1 | Task lifecycle | Task state, start/get/reply/cancel/finish/list | P0 |
| P2 | Reliability tests | Protocol and lifecycle regression | P0-P1 |
| P3 | Git Worktree | Isolation, audit, merge/discard | P1 |
| P4 | Task queue | Serialize write tasks and expose queue state | P1; currently blocked |
| P4.5 | Token budget review | Review Package and bounded evidence escalation | P1, P3 |

P4.5 reads persisted task state and P3 Worktree metadata but does not change queue scheduling.

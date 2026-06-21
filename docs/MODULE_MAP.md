# Module Map

| Phase | Module | Responsibility | Depends On |
|------|--------|----------------|------------|
| P0 | Runner and parser | MiMo PTY execution and event parsing | Node PTY |
| P1 | Task lifecycle | Task state, start/get/reply/cancel/finish/list | P0 |
| P2 | Reliability tests | Protocol and lifecycle regression | P0-P1 |
| P3 | Git Worktree | Isolation, audit, merge/discard | P1 |
| P4 | Task queue | Serialize write tasks through real Runner completion/failure/cancellation | P1; accepted |
| P4.5 | Token budget review | Review Package and bounded evidence escalation | P1, P3 |
| P4.6 | Low-token wait | Block inside the daemon until task readiness or timeout; return bounded evidence once | P1, P4.5 |
| P5 | Local daemon and admin UI | Shared HTTP MCP, fixed REST API, review-first workbench | P1-P4.5 |
| P5.1 | Safe task deletion | Delete terminal tasks without Worktrees and clean runtime artifacts | P1, P5 |
| P5.2 | Windows launcher | Persisted config complete; one-click lifecycle controls, desktop shortcut, optional logon startup pending | P5 |
| P5.3 | Windows distribution | First-run setup, Windows x64 portable ZIP and installer | P5.2; planned |

P4.5 reads persisted task state and P3 Worktree metadata but does not change queue scheduling. P4.6 replaces repeated Codex polling with one bounded daemon-side wait. P5 hosts these services in one localhost-only daemon so Codex and the UI share runtime state. P5.2/P5.3 must reuse that daemon and UI rather than create a second task runtime.

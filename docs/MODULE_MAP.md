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
| P5.2 | Windows launcher | Persisted config, one-click lifecycle controls, first-run config, desktop shortcut, optional logon startup | P5 |
| P5.3 | Windows distribution | Windows 10/11 x64 portable ZIP and EXE installer with bundled Node | P5.2 |
| P5.4 | Safe agent invocation | Cross-machine-safe client wrapper for Codex/MiMo/third-party task calls without shell quoting or encoding hazards | P4.6, P5 |
| P5.5 | Dynamic task scope | Generate and persist per-task editable/read-only boundaries with strict/suggested/repo-wide modes and Review Package scope reporting | P3, P4.5, P5.4 |
| P6 | Multi-agent dispatch | Let Codex assign work to MiMo and Reasonix concurrently through an Agent Registry and shared review protocol | P3-P5 |
| P6.1 | Reasonix TUI adapter | Make Reasonix TUI a first-class execution agent through probe, one-shot run, session mapping, live output parsing, and later reply/resume support | P6 |

P4.5 reads persisted task state and P3 Worktree metadata but does not change queue scheduling. P4.6 replaces repeated Codex polling with one bounded daemon-side wait. P5 hosts these services in one localhost-only daemon so Codex and the UI share runtime state. P5.2/P5.3 must reuse that daemon and UI rather than create a second task runtime.

P6 must not replace MiMo with Reasonix. It adds a multi-agent dispatch layer so multiple agents can coexist: `mimo`, `reasonix-tui`, and eventually `reasonix-gui`. Existing `mimo_*` tools remain for compatibility; new generic `agent_*` tools should carry an explicit `agent_id`.

Reasonix parity target: `reasonix-tui` should eventually support the same Bridge workflow as MiMo: start, wait, review package, focused evidence escalation, Worktree merge/discard by Codex, live viewer output, safe deletion, and admin UI visibility. `reasonix-gui` is not the first execution runner; it should initially share/display TUI-created session records through Reasonix home/session JSONL.

P5.5 is intentionally before P6. Reasonix must reuse the same dynamic task scope model as MiMo instead of introducing a second safety-boundary system.

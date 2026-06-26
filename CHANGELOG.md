# Changelog

All notable user-facing changes to AgentBridge Local, formerly MiMo Bridge MCP, will be documented in this file.

## [0.1.0-alpha] - Unreleased

### Added

- Localhost-only MCP daemon for sharing one task runtime between Codex and the Admin UI.
- Review-oriented task workflow where Codex starts bounded local-agent tasks, waits with `mimo_wait_task` or `agent_wait_task`, and reads `detail_level="review"` before escalating to focused diff, file, or log reads.
- Git Worktree task isolation so MiMo Code or Reasonix can execute changes away from the main branch.
- React Admin UI served by the local daemon.
- Windows launcher lifecycle controls for status, start, stop, restart, and logs.
- Portable Windows ZIP package with bundled Node runtime.
- Windows EXE installer package and installer self-test flow.
- Release validation script and clean Windows validation checklist.

### Improved

- Windows launcher startup behavior and installed launcher environment handling.
- Documentation handoff structure for project memory, open tasks, release validation, and module references.
- Low-token review guidance for Codex-led task acceptance.

### Known Limitations

- Windows 10/11 x64 is the first supported release target.
- MiMo Code and Reasonix must be installed and configured separately when used.
- Clean Windows validation is still needed before broad release confidence.
- `tests/runner-integration.test.mjs` is a known hanging test on Windows and is excluded from normal regression.
- Token budget tracking depends on real usage/cost events emitted by each configured agent.

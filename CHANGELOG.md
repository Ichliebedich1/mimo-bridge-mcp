# Changelog

All notable user-facing changes to MiMo Bridge MCP will be documented in this file.

## [0.1.0-alpha] - Unreleased

### Added

- Localhost-only MCP daemon for sharing one task runtime between Codex and the Admin UI.
- Review-oriented task workflow where Codex starts bounded MiMo Code tasks, waits with `mimo_wait_task`, and reads `detail_level="review"` before escalating to focused diff, file, or log reads.
- Git Worktree task isolation so MiMo Code can execute changes away from the main branch.
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
- MiMo Code must be installed and logged in separately.
- Clean Windows validation is still needed before broad release confidence.
- `tests/runner-integration.test.mjs` is a known hanging test on Windows and is excluded from normal regression.
- Token budget tracking is not yet connected to real MiMo token events.

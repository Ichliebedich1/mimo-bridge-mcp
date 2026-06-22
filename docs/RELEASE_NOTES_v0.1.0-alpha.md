# v0.1.0-alpha: Codex -> MiMo Code MCP Bridge for Windows

MiMo Bridge MCP is a local MCP bridge that lets Codex delegate bounded coding tasks to MiMo Code while keeping Codex in charge of planning, review, and final acceptance.

## What It Does

- Lets Codex delegate bounded coding tasks to MiMo Code.
- Runs as a localhost-only daemon.
- Uses Git Worktrees for isolated task execution.
- Provides a review-oriented MCP workflow to reduce token usage.
- Lets Codex read review summaries first, then focused diffs, files, or logs only when needed.
- Includes a local Admin UI served by the same daemon.
- Includes Windows portable ZIP and EXE installer packaging workflow.

## Current Limitations

- Windows 10/11 x64 first.
- MiMo Code must be installed and logged in separately.
- Early alpha; expect bugs.
- Runner stability and clean Windows validation still need community testing.
- The daemon is designed for localhost use only, not public network exposure.
- Token budget tracking is not yet connected to real MiMo token events.

## Looking For Contributors

- Windows installer testing.
- Portable ZIP testing on clean Windows 10.
- Codex MCP integration testing.
- MiMo Code runner stability feedback.
- Documentation and examples.
- Admin UI improvements.
- Release validation.
- Demo GIF and screenshot contributions.

## Safety Note

- Do not expose the local daemon to public networks.
- Review all diffs before merging task Worktrees.
- Do not share API keys, MiMo credentials, tokens, full private logs, or local Worktrees in issues.
- MiMo Code should not merge its own task Worktree; Codex or the user should make the final decision.

## Quick Links

- English README: `README.md`
- Chinese README: `README_zh-CN.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Good First Issues: `docs/GOOD_FIRST_ISSUES.md`
- Release validation checklist: `docs/RELEASE_VALIDATION.md`

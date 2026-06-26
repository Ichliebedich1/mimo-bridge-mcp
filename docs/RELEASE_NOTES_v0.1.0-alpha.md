# v0.1.0-alpha: AgentBridge Local

AgentBridge Local is a local-first MCP orchestration console for Codex, MiMo Code, Reasonix TUI, and future local coding agents.

Former name: **MiMo Bridge MCP**.

## What It Does

- Lets Codex delegate bounded coding tasks to local execution agents.
- Supports MiMo Code through legacy `mimo_*` tools and the shared task queue.
- Supports Reasonix TUI through generic `agent_*` tools.
- Runs as a localhost-only daemon.
- Uses Git Worktrees for isolated task execution.
- Provides a compact Review Package workflow to reduce Codex token usage.
- Lets Codex read review summaries first, then focused diffs, files, or logs only when needed.
- Includes a browser-based Admin UI served by the same daemon.
- Supports task attachments, including pasted images and uploaded files.
- Includes model routing profiles for simple, normal, complex, high-risk, and multimodal tasks.
- Includes Windows portable ZIP and EXE installer packaging workflow.

## Current Limitations

- Windows 10/11 x64 first.
- MiMo Code and Reasonix must be installed and logged in/configured separately.
- Early alpha; expect rough edges.
- Clean Windows validation still needs more community testing.
- The daemon is designed for localhost use only, not public network exposure.
- Reasonix GUI opening is companion viewing only; direct deep-link to a specific Reasonix session is not guaranteed.
- Release artifact names still use `MiMoBridge...` for compatibility.

## Looking For Contributors

- Windows installer testing.
- Portable ZIP testing on clean Windows 10/11.
- Codex MCP integration examples.
- MiMo Code and Reasonix task-flow testing.
- Documentation and troubleshooting improvements.
- Admin UI screenshots and demo GIFs.
- Release validation reports.
- New local Agent adapters.

## Safety Note

- Do not expose the local daemon to public networks.
- Review all diffs before merging task Worktrees.
- Do not share API keys, credentials, tokens, full private logs, local Worktrees, or unredacted personal paths in issues.
- Execution agents should not merge their own task Worktrees; Codex or the user should make the final decision.

## Quick Links

- English README: `README.md`
- Chinese README: `README_zh-CN.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Good First Issues: `docs/GOOD_FIRST_ISSUES.md`
- Release validation checklist: `docs/RELEASE_VALIDATION.md`
- Demo script: `docs/DEMO_SCRIPT.md`

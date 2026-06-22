# Security Policy

MiMo Bridge MCP is a local-first MCP bridge. Its default security model assumes a trusted local user, a localhost-only daemon, and human review before accepting task Worktrees.

## Supported Versions

The project is currently early alpha. Security fixes should target the active `0.1.x` line unless a maintainer documents another release branch.

## Localhost-Only Boundary

The daemon is intended to listen only on localhost:

```text
http://127.0.0.1:3210
http://127.0.0.1:3210/mcp
```

Do not expose this daemon to public networks, shared LANs, reverse proxies, tunnels, or cloud hosting unless a future security review explicitly supports that deployment model.

## Sensitive Data

Never commit or post:

- API keys.
- Access tokens.
- MiMo credentials or login state.
- Full project logs containing private paths or prompts.
- Personal machine paths.
- Active task runtime data.
- Git Worktrees from local task execution.

When filing issues, include only the smallest relevant log excerpt and redact user names, private project names, paths, and secrets.

## High-Risk Areas

Please be especially careful around changes that can:

- Execute commands.
- Write or delete files.
- Create, merge, discard, or delete Git Worktrees.
- Change task allowed-path enforcement.
- Change daemon host binding or port behavior.
- Change installer, autostart, or bundled runtime behavior.
- Expand log collection or review package contents.

Open an issue before starting security-sensitive changes.

## Review Boundary

MiMo Code should execute bounded tasks, but it must not merge its own Worktree. Codex or the user should review the summary, risk flags, focused diff, and relevant logs before deciding whether to merge or discard.

## Reporting A Vulnerability

If the issue can be disclosed publicly without exposing secrets, open a GitHub issue with a minimal reproduction and redacted logs.

If the issue includes sensitive details, avoid posting secrets publicly. Use GitHub private vulnerability reporting if enabled for the repository, or contact the repository maintainer through the safest private channel listed on the GitHub profile.

Please include:

- Affected version or commit.
- Windows version.
- Whether you used source checkout, portable ZIP, or EXE installer.
- Minimal reproduction steps.
- Expected behavior.
- Actual behavior.
- Redacted logs or screenshots when necessary.

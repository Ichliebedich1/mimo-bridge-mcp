# Contributing to MiMo Bridge MCP

Thanks for helping improve MiMo Bridge MCP. This project is about a practical workflow: Codex plans and reviews; MiMo Code executes bounded tasks in isolated Git Worktrees.

## Local Setup

Prerequisites:

- Windows 10/11 x64 for the primary supported path.
- Node.js 18 or newer for source checkout development.
- Git.
- MiMo Code installed and logged in for real runner testing.
- Codex or another MCP-capable client for integration testing.

Install dependencies and build:

```powershell
npm.cmd install
npm.cmd run build
cd apps/admin-ui; npm.cmd install; npm.cmd run build; cd ../..
cd apps/local-daemon; npm.cmd install; npm.cmd run build; cd ../..
```

Start the local daemon:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/start-local.ps1
```

Admin UI:

```text
http://127.0.0.1:3210/
```

MCP endpoint:

```text
http://127.0.0.1:3210/mcp
```

## Pull Request Workflow

1. Open an issue first for behavior changes, security-sensitive changes, installer changes, task lifecycle changes, or anything that affects merge/discard behavior.
2. Keep pull requests focused. Documentation, tests, UI polish, launcher changes, and runner changes are easier to review when separated.
3. Preserve the core boundary: Codex reviews and accepts; MiMo Code executes bounded tasks; MiMo must not merge its own Worktree.
4. Update relevant docs when changing commands, paths, ports, packaging behavior, or safety assumptions.
5. Include screenshots or short notes for UI and installer changes when useful.

## PR Checklist

- [ ] I kept the change focused and explained the user-facing impact.
- [ ] I did not commit API keys, tokens, credentials, full private logs, or personal machine paths.
- [ ] I preserved localhost-only assumptions unless an issue explicitly discusses otherwise.
- [ ] I preserved Git Worktree isolation and Codex final-review ownership.
- [ ] I updated README / docs when commands or behavior changed.
- [ ] I ran focused checks where practical, or clearly explained why tests were not run.

## Good First Contributions

Good starter work usually includes:

- Improving troubleshooting docs.
- Adding screenshots or a demo GIF.
- Testing portable ZIP or installer flows on clean Windows machines.
- Adding Codex MCP configuration examples.
- Improving release validation report readability.
- Expanding examples for the low-token review workflow.
- Fixing typos or confusing language in docs.

See [docs/GOOD_FIRST_ISSUES.md](docs/GOOD_FIRST_ISSUES.md) for issue drafts.

## Changes That Need Discussion First

Please open an issue before working on:

- Any daemon network exposure beyond localhost.
- New task execution engines or runner architecture changes.
- Worktree merge, discard, cancellation, or deletion behavior.
- Installer, autostart, bundled runtime, or user-data migration changes.
- Security-sensitive command execution or file-write behavior.
- Public API or MCP tool schema changes.

## Windows Testing Notes

The main release target is Windows 10/11 x64. Useful validation includes:

- Portable ZIP on a clean Windows 10 machine.
- EXE installer on a clean Windows 11 machine.
- First run with no system Node installed.
- Port `3210` conflict behavior.
- Reboot/logon behavior when autostart is enabled by the user.
- MiMo Code not installed or not logged in.
- Antivirus or SmartScreen reactions to the installer.

## Test References

Normal regression excludes the known hanging runner integration test:

```powershell
$tests = Get-ChildItem -LiteralPath 'tests' -Filter '*.test.mjs' |
  Where-Object { $_.Name -ne 'runner-integration.test.mjs' } |
  ForEach-Object { $_.FullName }
node --test $tests
```

Focused release checks:

```powershell
node --test tests/release-validation.test.mjs tests/installer-package.test.mjs tests/launcher-controller.test.mjs
npm.cmd run validate:release
```

Documentation-only PRs may skip full regression when the PR states the reason, for example:

```text
Tests not run; documentation-only change.
```

## Privacy And Safety

Do not include:

- API keys.
- MiMo credentials or login state.
- Tokens.
- Full local logs that include private paths or user data.
- Active task runtime data.
- Git Worktrees from your machine.

When sharing logs, trim them to the smallest relevant excerpt and redact local usernames, project names, and secrets.

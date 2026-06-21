# MiMo Bridge MCP Long-Term Memory

This file is the project-local long-term memory. Update it after each meaningful phase so another agent can continue without relying on chat context.

## Current Release Target

- Target OS: Windows 10/11 x64.
- Distribution style: portable ZIP plus EXE installer.
- Runtime model: one localhost-only Node daemon shared by Codex MCP and the React admin UI.
- Internal MCP endpoint: http://127.0.0.1:3210/mcp.
- Autostart: off by default; only enable when the user explicitly opts in.
- Do not bundle MiMo credentials, MiMo login state, active tasks, runtime logs, or Git Worktrees.
- MiMo Code must be installed and logged in separately on each computer.

## Current Implementation State

- P0-P5.2 are implemented.
- P5.3 portable ZIP exists through npm.cmd run package:portable.
- P5.3 EXE installer is implemented through npm.cmd run package:installer.
- The installer is per-user: default app files go under LOCALAPPDATA\\MiMoBridgeApp; user data stays under LOCALAPPDATA\\MiMoBridge.
- Local package:installer build succeeds and produces the portable ZIP plus EXE installer. Clean Windows 10/11 x64 validation is still required.

## Must-Preserve Architecture

- Keep the existing React admin UI and Node local daemon.
- Do not introduce Electron, Tauri, cloud hosting, LAN exposure, or a second task runtime without a new explicit decision.
- Codex plans/reviews/accepts; MiMo executes bounded coding tasks.
- MiMo must not merge its own Worktree.
- Review uses bounded Review Packages first; only read focused diff/files/logs when risk requires it.
- Waiting uses mimo_wait_task instead of repeated polling.

## Known Technical Debt

- tests/runner-integration.test.mjs hangs on Windows and is excluded from normal regression.
- Windows PTY tests can print AttachConsole failed and TimeoutNaNWarning; treat as noise only when tests exit 0.
- TokenBudgetManager is not connected to real MiMo token events.
- Active Worktree cancellation cleanup needs a focused audit.
- Clean-machine double-click, reboot/logon, no-system-Node, port-conflict, and uninstall validation are pending.

## Next Handoff Checklist

1. Read this file first.
2. Run git status --short --branch.
3. Read docs/HANDOVER_STATUS.md, docs/OPEN_TASKS.md, and docs/modules/windows-launcher-portability.md.
4. Use npm.cmd run package:portable for the portable package.
5. Use npm.cmd run package:installer for the EXE installer.
6. Use npm.cmd run validate:release for automated local release validation, or npm.cmd run validate:release -- -SkipPackageBuild after artifacts already exist.
7. Use docs/RELEASE_VALIDATION.md for clean Windows 10/11 x64 manual validation.
8. Run focused tests before broad regression:
   - node --test tests/installer-package.test.mjs
   - node --test tests/launcher-controller.test.mjs
9. Normal regression must continue excluding tests/runner-integration.test.mjs.

## Active Documentation Set

- Primary entry points: README.md, PROJECT_MEMORY.md, AGENTS.md, docs/HANDOVER_STATUS.md, and docs/OPEN_TASKS.md.
- Architecture and module references: docs/ARCHITECTURE.md, docs/MODULE_MAP.md, docs/DECISIONS.md, docs/PROJECT_BRIEF.md, docs/RELEASE_VALIDATION.md, and docs/modules/*.md.
- Third-party takeover entry: docs/THIRD_PARTY_AGENT_HANDOFF.md is now a short index, not a duplicated long-form state dump.
- Removed from active docs during cleanup: root HANDOFF.md, root PROJECT.md, and docs/UI_DEVELOPMENT.md. Do not depend on those paths for current facts.
- Current release artifacts stay ignored under artifacts/. The portable staging directory artifacts/portable/MiMoBridge is kept because validate-release.ps1 -SkipPackageBuild reads it.

## Latest Notes

- Win11 support is treated as the same Windows x64 release line as Win10 because both are NT 10.x and the current stack is Node/PowerShell/localhost.
- The installer is a MinGW resource-stub EXE that embeds install.ps1 and the portable payload; it should not require system Node on the target computer.
- The installer-created launchers set MIMO_BRIDGE_NODE_PATH, MIMO_BRIDGE_DATA_DIR, and MIMO_BRIDGE_CONFIG explicitly.
- Latest local verification: npm.cmd run package:installer passed; npm.cmd run validate:release -- -SkipPackageBuild passed and wrote artifacts\release-validation.json; artifacts\MiMoBridgeSetup-win10-win11-x64.exe -SelfTest passed; node --test tests/release-validation.test.mjs tests/installer-package.test.mjs tests/launcher-controller.test.mjs passed 17/17; normal regression excluding runner-integration passed 248/248.
- Installer EXE supports -SelfTest. This extracts the embedded payload to TEMP, checks required app files, and rejects bundled runtime data or MiMo credential files without installing anything.
- Documentation cleanup consolidated stale handoff/design snapshots into the active docs listed above and removed obsolete ignored build artifacts that can be regenerated.

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
- MCP SDK callers must pass a request timeout longer than `mimo_wait_task.timeout_seconds`; otherwise the client can time out even though daemon-side low-token waiting is working. Documented in `docs/modules/low-token-wait.md` with 1800/3600s examples.
- Agent-to-bridge calls are still vulnerable to Windows shell quoting/encoding differences when agents hand-build PowerShell or inline Node commands. P5.4 should add a safe client wrapper; see `docs/modules/safe-agent-invocation.md`.

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

- Live viewer enhancement completed and locally verified: `/api/tasks/:id/live` now shows more MiMo-visible runtime text from `part.text`, `state.output`, `state.metadata.output`, and `state.error` in the existing `summary` field. Local paths/session/stdin/token/password values are sanitized; summary budget is raised from 200 to 1000 chars; admin UI live viewer is wider and preserves multiline text. Boundary: this cannot show hidden model chain-of-thought, only text already emitted into MiMo JSONL logs.

- Win11 support is treated as the same Windows x64 release line as Win10 because both are NT 10.x and the current stack is Node/PowerShell/localhost.
- The installer is a MinGW resource-stub EXE that embeds install.ps1 and the portable payload; it should not require system Node on the target computer.
- The installer-created launchers set MIMO_BRIDGE_NODE_PATH, MIMO_BRIDGE_DATA_DIR, and MIMO_BRIDGE_CONFIG explicitly.
- Latest local verification: npm.cmd run package:installer passed; npm.cmd run validate:release -- -SkipPackageBuild passed and wrote artifacts\release-validation.json; artifacts\MiMoBridgeSetup-win10-win11-x64.exe -SelfTest passed; node --test tests/release-validation.test.mjs tests/installer-package.test.mjs tests/launcher-controller.test.mjs passed 17/17; normal regression excluding runner-integration passed 248/248.
- Installer EXE supports -SelfTest. This extracts the embedded payload to TEMP, checks required app files, and rejects bundled runtime data or MiMo credential files without installing anything.
- Documentation cleanup consolidated stale handoff/design snapshots into the active docs listed above and removed obsolete ignored build artifacts that can be regenerated.
- Installer repair after local double-click test: the EXE had installed files but generated installed launcher environment variables across multiple lines, making the app look missing/broken. Fixed `scripts/installer/install.ps1` to write explicit one-line installed launcher variables and fixed the EXE stub to default plain double-click installs to `-Quiet`.
- Current local installed app path: `%LOCALAPPDATA%\MiMoBridgeApp`; current data path: `%LOCALAPPDATA%\MiMoBridge`. After repair install, installed daemon started from bundled `node.exe`, `/api/health` returned ok, MCP status ready, MiMo configured, queue empty.
- Planned P6 is multi-agent dispatch, not provider replacement. Codex should be able to assign work to MiMo and Reasonix concurrently by explicit `agent_id`. Keep existing `mimo_*` tools compatible while adding generic `agent_*` tools. Reasonix TUI is the likely first executable adapter; Reasonix GUI needs a capability probe before any automation commitment.
- P5.4 safe agent invocation is now designed but not implemented. It should provide a UTF-8 JSON-file/stdin client wrapper so Codex, MiMo, and third-party agents do not pass Chinese paths or large JSON through fragile shell command strings.
- Safe-delete visibility is implemented and merged via real Codex -> MCP -> MiMo -> Review Package -> focused diff -> merge flow. `/api/tasks` and `/api/tasks/:id` now return `can_delete`, `delete_blockers`, and `delete_label`; the admin UI has a `可安全删除` filter and only shows delete when backend-derived `can_delete` is true.
- Default Chinese display chain: `ReviewPackage` type has optional `objective_zh` and `mimo_summary_zh` fields. When objective or summary contains Chinese characters, the zh field is populated (same content); otherwise zh is omitted. Admin UI `detailToUiTask` prefers zh fields for title/objective/summary with English fallback. Task brief `prompt-builder.ts` adds a "语言要求" section requesting Chinese summaries. Codex handoff prompt also requests Chinese. No external translation API or dependency introduced.
- Latest safe-delete verification: `npm.cmd run build`, `cd apps/local-daemon; npm.cmd run build`, `cd apps/admin-ui; npm.cmd run build`, and `node --test tests/admin-api.test.mjs` passed. Daemon was restarted with `launcher.ps1 restart`; `/api/health` was ready and historical accepted/no-Worktree tasks returned `can_delete: true`, `delete_label: "可安全删除"`.

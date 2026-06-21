# Release Validation Checklist

This checklist is for validating MiMo Bridge on clean Windows 10/11 x64 machines.

## Scope

- Target OS: Windows 10/11 x64.
- Artifacts:
  - artifacts/MiMoBridge-portable-win10-win11-x64.zip
  - artifacts/MiMoBridgeSetup-win10-win11-x64.exe
- MiMo Code must be installed and logged in separately on the target machine.
- Do not copy MiMo credentials, active tasks, runtime logs, or Worktrees between machines.

## Local Build Gate

Run from the repository root before copying artifacts to a clean machine:

    npm.cmd run validate:release

Expected:

- Portable ZIP exists and is non-empty.
- Installer EXE exists and is non-empty.
- Manifests target windows-10-11-x64.
- Manifests report includes_mimo_credentials=false, includes_tasks=false, and includes_worktrees=false.
- Installer -SelfTest passes.
- artifacts/release-validation.json is written.

## Clean Machine Portable Validation

1. Copy MiMoBridge-portable-win10-win11-x64.zip to a Windows 10/11 x64 machine.
2. Extract it into a path with spaces and non-ASCII characters if possible.
3. Run: .\Configure MiMo Bridge.cmd
4. Configure MiMo paths, allowed project root, runtime directory, and port.
5. Run: .\Start MiMo Bridge.cmd
6. Confirm the browser opens the admin UI.
7. Confirm health:

    Invoke-RestMethod http://127.0.0.1:3210/api/health | ConvertTo-Json -Depth 6

Expected:

- status is ok.
- MCP is ready.
- MiMo is configured.
- Admin UI loads without requiring system Node.

## Clean Machine Installer Validation

1. Copy MiMoBridgeSetup-win10-win11-x64.exe to a Windows 10/11 x64 machine.
2. Run the self-test first:

    .\MiMoBridgeSetup-win10-win11-x64.exe -SelfTest

3. Double-click the installer or run: .\MiMoBridgeSetup-win10-win11-x64.exe
4. Keep autostart disabled unless explicitly testing it.
5. Confirm desktop and Start Menu shortcuts are created.
6. Start MiMo Bridge from the shortcut.
7. Confirm health:

    Invoke-RestMethod http://127.0.0.1:3210/api/health | ConvertTo-Json -Depth 6

Expected:

- Installed app files are under %LOCALAPPDATA%\MiMoBridgeApp.
- User/runtime data is under %LOCALAPPDATA%\MiMoBridge.
- The app starts without system Node.
- The admin UI opens.
- The MCP endpoint is http://127.0.0.1:3210/mcp.
- Autostart is disabled unless the user opted in.
- Windows Settings shows a current-user uninstall entry.

## Failure Scenarios To Check

- Port 3210 already occupied by another process: launcher must report a port conflict without killing unrelated processes.
- MiMo Code not installed or not configured: launcher/configuration should show a plain-language error.
- Invalid MiMo path: configuration should reject it.
- Invalid allowed root: configuration should reject it.
- Chinese/space path: installer and launcher should still run.

## Reboot And Autostart

1. Start MiMo Bridge normally with autostart disabled.
2. Reboot.
3. Confirm MiMo Bridge does not start automatically.
4. Enable autostart explicitly through the launcher.
5. Reboot again.
6. Confirm MiMo Bridge starts for the current user.
7. Disable autostart and confirm the Scheduled Task is removed.

## Uninstall

Run the Start Menu uninstall shortcut or:

    powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MiMoBridgeApp\installer-maintenance.ps1" -Uninstall

Expected:

- App files and shortcuts are removed.
- Autostart Scheduled Task is removed.
- User data under %LOCALAPPDATA%\MiMoBridge is preserved by default.
- Passing -DeleteUserData removes user data only after explicit request.

## Real Collaboration Smoke

After health is confirmed:

1. Configure Codex MCP to use http://127.0.0.1:3210/mcp.
2. Create a small MiMo task from the admin UI or MCP.
3. Use mimo_wait_task once instead of polling.
4. Review the bounded Review Package.
5. Merge or discard through the normal MCP workflow.

Expected:

- Codex and the admin UI see the same task queue.
- No full repository, full diff, or full logs are required for normal review.

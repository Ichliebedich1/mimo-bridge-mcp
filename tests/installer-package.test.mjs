import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

async function read(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf-8");
}

test("package scripts expose portable and installer builders", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["package:portable"], "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-portable.ps1");
  assert.equal(pkg.scripts["package:installer"], "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1");
});

test("portable package targets Windows 10 and Windows 11 x64", async () => {
  const script = await read("scripts/build-portable.ps1");
  assert.match(script, /MiMoBridge-portable-win10-win11-x64\.zip/);
  assert.match(script, /Windows 10\/11 x64/);
  assert.match(script, /windows-10-11-x64/);
});

test("installer build wraps the portable payload in a Windows 10/11 x64 exe", async () => {
  const script = await read("scripts/build-installer.ps1");
  const stub = await read("apps/windows-installer/setup-stub.c");
  assert.match(script, /MiMoBridgeSetup-win10-win11-x64\.exe/);
  assert.match(script, /build-portable\.ps1/);
  assert.match(script, /windres\.exe/);
  assert.match(script, /gcc\.exe/);
  assert.match(script, /MiMoBridge-payload\.zip/);
  assert.match(script, /builder = "mingw-resource-stub"/);
  assert.match(script, /includes_mimo_credentials = \$false/);
  assert.match(script, /includes_worktrees = \$false/);
  assert.match(stub, /IDR_INSTALL_PS1 101/);
  assert.match(stub, /IDR_PAYLOAD_ZIP 102/);
  assert.match(stub, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(stub, /has_mode_argument/);
  assert.match(stub, /L" -Quiet"/);
  assert.match(stub, /validate_arguments/);
  assert.match(stub, /Unknown setup option/);
  assert.match(stub, /is_help_argument/);
  assert.match(stub, /-SelfTestPort/);
});

test("installer preserves user data by default and leaves autostart opt-in", async () => {
  const installer = await read("scripts/installer/install.ps1");
  assert.match(installer, /Windows 10\/11 x64/);
  assert.match(installer, /Join-Path \$localAppData "MiMoBridge"/);
  assert.match(installer, /Start MiMo Bridge when Windows logs in\?" -Default \$false/);
  assert.match(installer, /User data is preserved/);
  assert.match(installer, /\[switch\]\$DeleteUserData/);
  assert.match(installer, /\[switch\]\$SelfTest/);
  assert.match(installer, /\[int\]\$SelfTestPort = 33210/);
  assert.match(installer, /MiMo Bridge installer self-test passed/);
  assert.match(installer, /MiMo credentials, task logs, active tasks, and Worktrees are not bundled/);
  assert.match(installer, /MIMO_BRIDGE_NODE_PATH/);
  assert.ok(installer.includes("$dataRoot = [string]$Paths.DataRoot"));
  assert.ok(installer.includes("$configPath = [string]$Paths.ConfigPath"));
  assert.ok(installer.includes("'set \"MIMO_BRIDGE_DATA_DIR={0}\"' -f $dataRoot"));
  assert.ok(installer.includes("'set \"MIMO_BRIDGE_CONFIG={0}\"' -f $configPath"));
  assert.match(installer, /\[Environment\]::UserInteractive/);
});

test("installer update path verifies stop before replacing app files", async () => {
  const installer = await read("scripts/installer/install.ps1");
  assert.match(installer, /Assert-InstalledDaemonStopped/);
  assert.match(installer, /Invoke-LauncherCommand/);
  assert.match(installer, /mimo-bridge-installer-launcher-/);
  assert.match(installer, /call "' \+ \$Paths\.LauncherCmd \+ '"/);
  assert.match(installer, /Test-HttpHealth/);
  assert.match(installer, /Get-PortOwner/);
  assert.match(installer, /Test-InstallFileLocked/);
  assert.match(installer, /Close MiMo Bridge, or reboot Windows, then run this installer again/);
  assert.match(installer, /No installed files were removed/);

  const installBody = installer.slice(installer.indexOf("function Install-App"));
  assert.match(installBody, /Assert-InstalledDaemonStopped -Paths \$paths/);
  assert.match(installBody, /Install-StagedPayload -Paths \$paths -StageRoot \$payloadRoot/);
  assert.doesNotMatch(installBody, /Remove-KnownChild -Parent \$paths\.InstallRoot -Name "app"/);
  assert.doesNotMatch(installBody, /Copy-Directory -Source \$payloadRoot -Destination \$paths\.InstallRoot/);
});

test("installer can safely stop an old installed daemon without launcher state", async () => {
  const installer = await read("scripts/installer/install.ps1");
  assert.match(installer, /function Test-InstalledDaemonOwner/);
  assert.match(installer, /function Stop-InstalledDaemonOwner/);
  assert.match(installer, /Cannot prove port owner is installed MiMo Bridge daemon because command line is unavailable/);
  assert.match(installer, /Port owner is not a proven installed MiMo Bridge daemon/);
  assert.match(installer, /Stopping installed MiMo Bridge daemon without launcher state/);
  assert.match(installer, /Stop-Process -Id \(\[int\]\$Owner\.Pid\) -Force/);
  assert.match(installer, /MiMo Bridge old daemon is running from the install folder/);

  const ownerCheckBody = installer.slice(
    installer.indexOf("function Test-InstalledDaemonOwner"),
    installer.indexOf("function Stop-InstalledDaemonOwner"),
  );
  assert.match(ownerCheckBody, /\$installRoot/);
  assert.match(ownerCheckBody, /"node\.exe"/);
  assert.match(ownerCheckBody, /"local-daemon"/);
  assert.match(ownerCheckBody, /"index\.js"/);

  const stopBody = installer.slice(
    installer.indexOf("function Assert-InstalledDaemonStopped"),
    installer.indexOf("function Test-StagedPayload"),
  );
  assert.match(stopBody, /if \(\$stop\.ExitCode -ne 0\)/);
  assert.match(stopBody, /Stop-InstalledDaemonOwner -Owner \$owner -Paths \$Paths/);
  assert.match(stopBody, /Stop launcher is missing; verifying port and file locks before upgrade/);
  assert.match(stopBody, /The installer will not stop an unrelated process/);
  assert.match(stopBody, /No installed files were removed/);
});

test("installer uses staging and rollback for replacement", async () => {
  const installer = await read("scripts/installer/install.ps1");
  assert.match(installer, /function Install-StagedPayload/);
  assert.match(installer, /Test-StagedPayload -StageRoot \$StageRoot/);
  assert.match(installer, /mimo-bridge-install-backup-/);
  assert.match(installer, /Move-ChildIfExists/);
  assert.match(installer, /Rollback failed/);
  assert.match(installer, /previous app backup is preserved/);
});

test("installer self-test starts temporary daemon and serves admin UI", async () => {
  const installer = await read("scripts/installer/install.ps1");
  assert.match(installer, /function Test-ExtractedPayloadSmoke/);
  assert.match(installer, /Invoke-LauncherCommand -Paths/);
  assert.match(installer, /Test-HttpHealth -Port \$Port/);
  assert.match(installer, /Invoke-WebRequest -UseBasicParsing -Uri \("http:\/\/127\.0\.0\.1:\{0\}\/" -f \$Port\)/);
  assert.match(installer, /Self-test Admin UI was not served as HTML/);
});

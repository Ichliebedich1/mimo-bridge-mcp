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
});

test("installer preserves user data by default and leaves autostart opt-in", async () => {
  const installer = await read("scripts/installer/install.ps1");
  assert.match(installer, /Windows 10\/11 x64/);
  assert.match(installer, /Join-Path \$localAppData "MiMoBridge"/);
  assert.match(installer, /Start MiMo Bridge when Windows logs in\?" -Default \$false/);
  assert.match(installer, /User data is preserved/);
  assert.match(installer, /\[switch\]\$DeleteUserData/);
  assert.match(installer, /\[switch\]\$SelfTest/);
  assert.match(installer, /MiMo Bridge installer self-test passed/);
  assert.match(installer, /MiMo credentials, task logs, active tasks, and Worktrees are not bundled/);
  assert.match(installer, /MIMO_BRIDGE_NODE_PATH/);
  assert.ok(installer.includes("$dataRoot = [string]$Paths.DataRoot"));
  assert.ok(installer.includes("$configPath = [string]$Paths.ConfigPath"));
  assert.ok(installer.includes("'set \"MIMO_BRIDGE_DATA_DIR={0}\"' -f $dataRoot"));
  assert.ok(installer.includes("'set \"MIMO_BRIDGE_CONFIG={0}\"' -f $configPath"));
  assert.match(installer, /\[Environment\]::UserInteractive/);
});

import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

async function read(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf-8");
}

test("release validation script is exposed and checks installer artifacts", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const script = await read("scripts/validate-release.ps1");
  assert.equal(pkg.scripts["validate:release"], "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-release.ps1");
  assert.match(script, /MiMoBridge-portable-win10-win11-x64\.zip/);
  assert.match(script, /MiMoBridgeSetup-win10-win11-x64\.exe/);
  assert.match(script, /windows-10-11-x64/);
  assert.match(script, /mingw-resource-stub/);
  assert.match(script, /-SelfTest/);
  assert.match(script, /includes_mimo_credentials/);
  assert.match(script, /auth\.json/);
  assert.match(script, /mimocode\.jsonc/);
  assert.match(script, /release-validation\.json/);
});

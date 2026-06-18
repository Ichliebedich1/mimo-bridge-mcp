import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-mimo-version");

describe("MiMo CLI version check", () => {
  let checkNodeVersion;
  let checkMimoCliVersion;
  let checkMimoVersion;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const configModule = await import("../dist/config.js");
    checkNodeVersion = configModule.checkNodeVersion;
    checkMimoCliVersion = configModule.checkMimoCliVersion;
    checkMimoVersion = configModule.checkMimoVersion;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should check Node.js version", () => {
    const nodePath = process.execPath;
    const version = checkNodeVersion(nodePath);

    assert.ok(version);
    assert.ok(version.startsWith("v"));
    assert.ok(version.length > 1);
  });

  it("should check MiMo CLI version with fake-mimo", () => {
    const nodePath = process.execPath;
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");

    const version = checkMimoCliVersion(nodePath, fakeMimoPath);

    assert.ok(version);
    assert.ok(version.length > 0);
  });

  it("should check both versions together", () => {
    const nodePath = process.execPath;
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");

    const version = checkMimoVersion(nodePath, fakeMimoPath);

    assert.ok(version);
    assert.ok(version.nodeVersion);
    assert.ok(version.cliVersion);
    assert.ok(version.nodeVersion.startsWith("v"));
    assert.ok(version.cliVersion.length > 0);
  });

  it("should throw error for invalid node path", () => {
    const invalidPath = "C:\\nonexistent\\node.exe";

    assert.throws(() => {
      checkNodeVersion(invalidPath);
    }, /无法获取 Node.js 版本/);
  });

  it("should throw error for invalid entry path", () => {
    const nodePath = process.execPath;
    const invalidEntry = "C:\\nonexistent\\mimo.js";

    assert.throws(() => {
      checkMimoCliVersion(nodePath, invalidEntry);
    }, /无法获取 MiMo CLI 版本/);
  });
});

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testDir = join(__dirname, "test-daemon-config");

const ENV_KEYS = [
  "MIMO_BRIDGE_CONFIG",
  "MIMO_NODE_PATH",
  "MIMO_ENTRY_PATH",
  "MIMO_ALLOWED_ROOTS",
  "MIMO_RUNTIME_DIR",
  "MIMO_DAEMON_PORT",
];

describe("daemon-config", () => {
  let loadDaemonConfig;
  let getDefaultConfigPath;
  let resolveConfigPath;
  let loadPersistentConfig;
  let savedEnv = {};

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const mod = await import("../apps/local-daemon/dist/apps/local-daemon/src/daemon-config.js");
    loadDaemonConfig = mod.loadDaemonConfig;
    getDefaultConfigPath = mod.getDefaultConfigPath;
    resolveConfigPath = mod.resolveConfigPath;
    loadPersistentConfig = mod.loadPersistentConfig;
  });

  beforeEach(() => {
    snapshotEnv();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function snapshotEnv() {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
  }

  describe("getDefaultConfigPath", () => {
    it("should return a path under LOCALAPPDATA", () => {
      const p = getDefaultConfigPath();
      assert.ok(p.includes("MiMoBridge"));
      assert.ok(p.includes("config.json"));
    });
  });

  describe("resolveConfigPath", () => {
    it("should use MIMO_BRIDGE_CONFIG when set", () => {
      snapshotEnv();
      const custom = join(testDir, "custom-config.json");
      process.env.MIMO_BRIDGE_CONFIG = custom;
      assert.strictEqual(resolveConfigPath(), custom);
    });

    it("should fall back to default path when MIMO_BRIDGE_CONFIG is unset", () => {
      snapshotEnv();
      delete process.env.MIMO_BRIDGE_CONFIG;
      const p = resolveConfigPath();
      assert.strictEqual(p, getDefaultConfigPath());
    });
  });

  describe("loadPersistentConfig", () => {
    it("should return null config for non-existent file", () => {
      const result = loadPersistentConfig(join(testDir, "no-such-file.json"));
      assert.strictEqual(result.config, null);
      assert.strictEqual(result.error, null);
    });

    it("should load valid JSON config", () => {
      const configPath = join(testDir, "valid.json");
      writeFileSync(configPath, JSON.stringify({ mimoNodePath: "/usr/bin/node", port: 4000 }));
      const result = loadPersistentConfig(configPath);
      assert.ok(result.config);
      assert.strictEqual(result.config.mimoNodePath, "/usr/bin/node");
      assert.strictEqual(result.config.port, 4000);
      assert.strictEqual(result.error, null);
    });

    it("should return error for invalid JSON", () => {
      const configPath = join(testDir, "bad.json");
      writeFileSync(configPath, "{ not valid json");
      const result = loadPersistentConfig(configPath);
      assert.strictEqual(result.config, null);
      assert.ok(result.error);
      assert.ok(result.error.includes("解析失败"));
    });

    it("should return error for JSON array instead of object", () => {
      const configPath = join(testDir, "array.json");
      writeFileSync(configPath, "[1, 2, 3]");
      const result = loadPersistentConfig(configPath);
      assert.strictEqual(result.config, null);
      assert.ok(result.error);
      assert.ok(result.error.includes("不是有效的 JSON 对象"));
    });
  });

  describe("loadDaemonConfig", () => {
    it("should load config from explicit config file", () => {
      snapshotEnv();
      const configPath = join(testDir, "daemon-explicit.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: process.execPath,
        mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
        allowedRoots: [testDir],
        runtimeDir: testDir,
        port: 3210,
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;
      delete process.env.MIMO_RUNTIME_DIR;
      delete process.env.MIMO_DAEMON_PORT;

      const config = loadDaemonConfig();
      assert.strictEqual(config.configError, null);
      assert.ok(config.mcpConfig);
      assert.strictEqual(config.port, 3210);
      assert.strictEqual(config.runtimeDir, testDir);
    });

    it("should let environment variables override persisted config", () => {
      snapshotEnv();
      const configPath = join(testDir, "daemon-override.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: "/should/be/overridden",
        mimoEntryPath: "/should/be/overridden",
        allowedRoots: ["/should/be/overridden"],
        runtimeDir: "/should/be/overridden",
        port: 9999,
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      process.env.MIMO_NODE_PATH = process.execPath;
      process.env.MIMO_ENTRY_PATH = join(__dirname, "fixtures", "fake-mimo.mjs");
      process.env.MIMO_ALLOWED_ROOTS = testDir;
      process.env.MIMO_RUNTIME_DIR = testDir;
      process.env.MIMO_DAEMON_PORT = "4321";

      const config = loadDaemonConfig();
      assert.strictEqual(config.configError, null);
      assert.ok(config.mcpConfig);
      assert.strictEqual(config.port, 4321);
      assert.strictEqual(config.runtimeDir, testDir);
    });

    it("should ignore an invalid persisted field when the environment overrides it", () => {
      snapshotEnv();
      const configPath = join(testDir, "daemon-invalid-overridden.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: 12345,
        mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
        allowedRoots: [testDir],
        runtimeDir: testDir,
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      process.env.MIMO_NODE_PATH = process.execPath;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;
      delete process.env.MIMO_RUNTIME_DIR;

      const config = loadDaemonConfig();
      assert.strictEqual(config.configError, null);
      assert.ok(config.mcpConfig);
      assert.strictEqual(config.mcpConfig.mimoNodePath, process.execPath);
    });

    it("should enter degraded mode with no config file and no env vars", () => {
      snapshotEnv();
      process.env.MIMO_BRIDGE_CONFIG = join(testDir, "nonexistent.json");
      delete process.env.MIMO_NODE_PATH;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;

      const config = loadDaemonConfig();
      assert.ok(config.configError);
      assert.strictEqual(config.mcpConfig, null);
    });

    it("should enter degraded mode for invalid JSON config file", () => {
      snapshotEnv();
      const configPath = join(testDir, "invalid.json");
      writeFileSync(configPath, "!!!not json!!!");
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;

      const config = loadDaemonConfig();
      assert.ok(config.configError);
      assert.ok(config.configError.includes("解析失败"));
      assert.strictEqual(config.mcpConfig, null);
    });

    it("should set configError and degrade for invalid persisted port", () => {
      snapshotEnv();
      const configPath = join(testDir, "bad-port.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: process.execPath,
        mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
        allowedRoots: [testDir],
        runtimeDir: testDir,
        port: 99999,
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;
      delete process.env.MIMO_DAEMON_PORT;

      const config = loadDaemonConfig();
      assert.ok(config.configError, "should have configError for invalid port");
      assert.ok(config.configError.includes("端口"), "error should mention port");
      assert.strictEqual(config.mcpConfig, null, "mcpConfig should be null (degraded)");
      assert.strictEqual(config.port, 3210, "should still bind to safe port 3210");
    });

    it("should set configError and degrade for invalid env port", () => {
      snapshotEnv();
      process.env.MIMO_BRIDGE_CONFIG = join(testDir, "nonexistent.json");
      process.env.MIMO_DAEMON_PORT = "not-a-number";
      delete process.env.MIMO_NODE_PATH;

      const config = loadDaemonConfig();
      assert.ok(config.configError, "should have configError for invalid env port");
      assert.ok(config.configError.includes("端口"));
      assert.strictEqual(config.mcpConfig, null);
      assert.strictEqual(config.port, 3210);
    });

    it("should handle paths with spaces", () => {
      snapshotEnv();
      const spaceDir = join(testDir, "path with spaces");
      mkdirSync(spaceDir, { recursive: true });
      const configPath = join(testDir, "spaces.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: process.execPath,
        mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
        allowedRoots: [spaceDir],
        runtimeDir: spaceDir,
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;
      delete process.env.MIMO_RUNTIME_DIR;

      const config = loadDaemonConfig();
      assert.strictEqual(config.configError, null);
      assert.ok(config.mcpConfig);
      assert.deepStrictEqual(config.mcpConfig.allowedRoots, [spaceDir]);
    });

    it("should handle non-ASCII paths", () => {
      snapshotEnv();
      const unicodeDir = join(testDir, "中文目录");
      mkdirSync(unicodeDir, { recursive: true });
      const configPath = join(testDir, "unicode.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: process.execPath,
        mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
        allowedRoots: [unicodeDir],
        runtimeDir: unicodeDir,
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;
      delete process.env.MIMO_RUNTIME_DIR;

      const config = loadDaemonConfig();
      assert.strictEqual(config.configError, null);
      assert.ok(config.mcpConfig);
      assert.deepStrictEqual(config.mcpConfig.allowedRoots, [unicodeDir]);
    });

    it("should set configError for non-string mimoNodePath without crashing", () => {
      snapshotEnv();
      const configPath = join(testDir, "bad-type-node.json");
      writeFileSync(configPath, JSON.stringify({ mimoNodePath: 12345 }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;

      const config = loadDaemonConfig();
      assert.ok(config.configError);
      assert.ok(config.configError.includes("mimoNodePath"));
      assert.strictEqual(config.mcpConfig, null);
    });

    it("should set configError for non-array allowedRoots without crashing", () => {
      snapshotEnv();
      const configPath = join(testDir, "bad-type-roots.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: process.execPath,
        mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
        allowedRoots: "not-an-array",
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;

      const config = loadDaemonConfig();
      assert.ok(config.configError);
      assert.ok(config.configError.includes("allowedRoots"));
      assert.strictEqual(config.mcpConfig, null);
    });

    it("should set configError for non-string runtimeDir without crashing", () => {
      snapshotEnv();
      const configPath = join(testDir, "bad-type-runtime.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: process.execPath,
        mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
        allowedRoots: [testDir],
        runtimeDir: 42,
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;
      delete process.env.MIMO_RUNTIME_DIR;

      const config = loadDaemonConfig();
      assert.ok(config.configError);
      assert.ok(config.configError.includes("runtimeDir"));
      assert.strictEqual(config.mcpConfig, null);
    });

    it("should set configError for non-integer port without crashing", () => {
      snapshotEnv();
      const configPath = join(testDir, "bad-type-port.json");
      writeFileSync(configPath, JSON.stringify({
        mimoNodePath: process.execPath,
        mimoEntryPath: join(__dirname, "fixtures", "fake-mimo.mjs"),
        allowedRoots: [testDir],
        runtimeDir: testDir,
        port: "not-a-number",
      }));
      process.env.MIMO_BRIDGE_CONFIG = configPath;
      delete process.env.MIMO_NODE_PATH;
      delete process.env.MIMO_ENTRY_PATH;
      delete process.env.MIMO_ALLOWED_ROOTS;
      delete process.env.MIMO_DAEMON_PORT;

      const config = loadDaemonConfig();
      assert.ok(config.configError);
      assert.ok(config.configError.includes("port"));
      assert.strictEqual(config.mcpConfig, null);
    });
  });
});

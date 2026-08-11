import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  LauncherController,
  getLauncherDataDir,
  readState,
  writeState,
  commandLineMatchesEntry,
  validatePersistentConfigForLauncher,
} from "../apps/local-daemon/dist/apps/local-daemon/src/launcher-controller.js";

const testDir = join(process.cwd(), "tests", "test-launcher-controller");

describe("launcher-controller", () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not spawn a second daemon when health is already OK", async () => {
    const paths = makePaths("already-running");
    let spawnCalls = 0;
    const controller = new LauncherController({
      paths,
      dependencies: {
        fetchHealth: async () => healthOk(3210, paths),
        getPortProcessInfo: async () => processInfo(paths, 777),
        isPortOpen: async () => false,
        spawnDaemon: () => {
          spawnCalls += 1;
          return { pid: 123, unref: () => undefined };
        },
        openUrl: async () => ({ status: 0, stdout: "", stderr: "" }),
      },
    });

    const result = await controller.start({ openUi: true });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, "already_running");
    assert.strictEqual(spawnCalls, 0);
  });

  it("adopts only an exact executable, daemon entry, port owner, and health identity match", async () => {
    const paths = makePaths("adopt-strict");
    const cases = [
      { name: "executable", owner: { ...processInfo(paths, 701), executablePath: join(testDir, "other-node.exe") }, health: healthOk(3210, paths) },
      { name: "entry", owner: { ...processInfo(paths, 702), commandLine: `"${process.execPath}" "C:\\other\\index.js"` }, health: healthOk(3210, paths) },
      { name: "identity", owner: processInfo(paths, 703), health: { ...healthOk(3210, paths), data: { ok: true, data: { daemon: { status: "ok", identity: "other" }, security: { localhost_only: true } } } } },
    ];
    for (const item of cases) {
      const controller = new LauncherController({
        paths,
        dependencies: { fetchHealth: async () => item.health, getPortProcessInfo: async () => item.owner },
      });
      const result = await controller.adopt();
      assert.strictEqual(result.ok, false, item.name);
      assert.strictEqual(result.status, "running_unmanaged", item.name);
      assert.strictEqual(existsSync(paths.statePath), false, item.name);
    }
  });

  it("adds and de-duplicates an explicit allowed root", async () => {
    const paths = makePaths("allow-root");
    const allowedRoot = join(testDir, "新设备 项目");
    mkdirSync(allowedRoot, { recursive: true });
    const controller = new LauncherController({ paths, dependencies: { env: {} } });
    const initial = {
      mimoNodePath: process.execPath,
      mimoEntryPath: paths.daemonEntryPath,
      allowedRoots: [paths.repoRoot],
      runtimeDir: join(paths.dataDir, "runtime"),
      port: 3210,
    };
    assert.strictEqual(controller.writeConfig(initial).ok, true);
    assert.strictEqual((await controller.allowRoot(allowedRoot)).ok, true);
    assert.strictEqual((await controller.allowRoot(allowedRoot)).ok, true);
    const saved = JSON.parse(readFileSync(paths.configPath, "utf8"));
    assert.strictEqual(saved.allowedRoots.length, 2);
    assert.strictEqual(saved.allowedRoots[1], allowedRoot);
  });

  it("reports a port conflict before spawning", async () => {
    const paths = makePaths("port-conflict");
    let spawnCalls = 0;
    const controller = new LauncherController({
      paths,
      dependencies: {
        fetchHealth: async () => healthDown(3210),
        isPortOpen: async () => true,
        getPortProcessInfo: async () => ({ pid: 999, name: "other.exe", commandLine: "other.exe" }),
        spawnDaemon: () => {
          spawnCalls += 1;
          return { pid: 123, unref: () => undefined };
        },
      },
    });

    const result = await controller.start();

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, "port_conflict");
    assert.strictEqual(spawnCalls, 0);
  });

  it("starts from built artifacts and writes launcher ownership state", async () => {
    const paths = makePaths("start");
    const health = [healthDown(3210), healthDown(3210), healthOk(3210)];
    let unrefCalled = false;
    const controller = new LauncherController({
      paths,
      dependencies: {
        now: () => new Date("2026-06-21T00:00:00.000Z"),
        sleep: async () => undefined,
        fetchHealth: async () => health.shift() ?? healthOk(3210),
        isPortOpen: async () => false,
        spawnDaemon: (nodePath, args, options) => {
          assert.strictEqual(args[0], paths.daemonEntryPath);
          assert.strictEqual(options.cwd, paths.repoRoot);
          assert.strictEqual(options.detached, true);
          assert.strictEqual(options.env.MIMO_BRIDGE_LAUNCHED_BY, "mimo-bridge-launcher");
          assert.ok(nodePath.length > 0);
          return {
            pid: 12345,
            unref: () => {
              unrefCalled = true;
            },
          };
        },
      },
    });

    const result = await controller.start();
    const state = readState(paths.statePath);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, "started");
    assert.strictEqual(unrefCalled, true);
    assert.ok(state);
    assert.strictEqual(state.pid, 12345);
    assert.strictEqual(state.daemonEntryPath, paths.daemonEntryPath);
  });

  it("starts on Windows with detached stdio and does not use PowerShell Start-Process", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const paths = makePaths("start-powershell path with spaces");
    const health = [healthDown(3210), healthOk(3210)];
    let spawnOptions;
    const controller = new LauncherController({
      paths,
      dependencies: {
        sleep: async () => undefined,
        fetchHealth: async () => health.shift() ?? healthOk(3210),
        isPortOpen: async () => false,
        spawnDaemon: (_nodePath, _args, options) => {
          spawnOptions = options;
          return { pid: 24680, unref: () => undefined };
        },
      },
    });

    const result = await controller.start();
    const state = readState(paths.statePath);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, "started");
    assert.strictEqual(spawnOptions.detached, true);
    assert.strictEqual(spawnOptions.stdio[0], "ignore");
    assert.strictEqual(spawnOptions.windowsHide, true);
    assert.ok(state);
    assert.strictEqual(state.pid, 24680);
  });

  it("real detached start returns after health while the daemon remains alive", async () => {
    const paths = makePaths("real-detached");
    const port = await reservePort();
    writeFileSync(paths.configPath, JSON.stringify({ port }));
    writeFileSync(paths.daemonEntryPath, `
      import { createServer } from "node:http";
      import { createHash } from "node:crypto";
      import { resolve } from "node:path";
      const fp = (v) => createHash("sha256").update(resolve(v).toLowerCase(), "utf8").digest("hex");
      const server = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: { daemon: { status: "ok", identity: "mimo-bridge-local-daemon/v1", executable_fingerprint: fp(process.execPath), entry_fingerprint: fp(process.argv[1]) }, security: { localhost_only: true } } }));
      });
      server.listen(${port}, "127.0.0.1");
      process.on("SIGTERM", () => server.close(() => process.exit(0)));
    `);
    let ownedPid = 0;
    const controller = new LauncherController({
      paths,
      dependencies: {
        env: { ...process.env, MIMO_BRIDGE_NODE_PATH: process.execPath },
        getPortProcessInfo: async () => processInfo(paths, ownedPid),
        readProcessCommandLine: async () => `"${process.execPath}" "${paths.daemonEntryPath}"`,
        killProcess: (pid) => { try { process.kill(pid); return true; } catch { return false; } },
      },
    });
    try {
      const startedAt = Date.now();
      const result = await controller.start({ waitMs: 5000 });
      const state = readState(paths.statePath);
      ownedPid = state?.pid ?? 0;
      assert.strictEqual(result.ok, true);
      assert.ok(Date.now() - startedAt < 7000);
      assert.strictEqual(await isListening(port), true);
      assert.strictEqual((await controller.stop({ waitMs: 5000 })).ok, true);
    } finally {
      if (ownedPid) { try { process.kill(ownedPid); } catch { /* already stopped */ } }
    }
  });

  it("refuses to stop a healthy daemon without launcher ownership state", async () => {
    const paths = makePaths("no-state");
    let killCalls = 0;
    const controller = new LauncherController({
      paths,
      dependencies: {
        fetchHealth: async () => healthOk(3210, paths),
        getPortProcessInfo: async () => processInfo(paths, 333),
        killProcess: () => {
          killCalls += 1;
          return true;
        },
      },
    });

    const result = await controller.stop();

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, "not_owned");
    assert.strictEqual(killCalls, 0);
  });

  it("refuses to stop when the stored PID command line does not match the daemon entry", async () => {
    const paths = makePaths("mismatch");
    writeLauncherState(paths, 222);
    let killCalls = 0;
    const controller = new LauncherController({
      paths,
      dependencies: {
        isProcessAlive: () => true,
        readProcessCommandLine: async () => "node C:\\other\\index.js",
        killProcess: () => {
          killCalls += 1;
          return true;
        },
      },
    });

    const result = await controller.stop();

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, "ownership_check_failed");
    assert.strictEqual(killCalls, 0);
    assert.ok(existsSync(paths.statePath));
  });

  it("stops only a launcher-owned daemon whose command line matches the entry path", async () => {
    const paths = makePaths("stop-owned");
    writeLauncherState(paths, 333);
    let alive = true;
    let killCalls = 0;
    const controller = new LauncherController({
      paths,
      dependencies: {
        sleep: async () => undefined,
        fetchHealth: async () => healthOk(3210, paths),
        getPortProcessInfo: async () => processInfo(paths, 333),
        isProcessAlive: () => alive,
        readProcessCommandLine: async () => "node \"" + paths.daemonEntryPath + "\"",
        killProcess: () => {
          killCalls += 1;
          alive = false;
          return true;
        },
      },
    });

    const result = await controller.stop();

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, "stopped");
    assert.strictEqual(killCalls, 1);
    assert.strictEqual(existsSync(paths.statePath), false);
  });

  it("returns bounded and redacted logs", () => {
    const paths = makePaths("logs");
    mkdirSync(dirname(paths.stdoutLogPath), { recursive: true });
    writeFileSync(paths.stdoutLogPath, "line1\nline2 token=secret-value\nline3\n");
    writeFileSync(paths.stderrLogPath, "err1\nMIMO_API_TOKEN=top-secret\nerr3\n");
    const controller = new LauncherController({ paths });

    const result = controller.readLogs({ maxLines: 2, maxChars: 2000 });

    assert.strictEqual(result.ok, true);
    assert.ok(result.data.stdout.includes("line3"));
    assert.ok(!result.data.stdout.includes("secret-value"));
    assert.ok(!result.data.stderr.includes("top-secret"));
    assert.ok(result.data.stderr.includes("MIMO_API_TOKEN=<redacted>"));
  });

  it("accepts config paths with spaces and non-ASCII characters", () => {
    const paths = makePaths("config");
    const unicodeRoot = join(testDir, "项目 root with spaces");
    const entryPath = join(testDir, "MiMo 入口", "mimo.mjs");
    mkdirSync(unicodeRoot, { recursive: true });
    mkdirSync(dirname(entryPath), { recursive: true });
    writeFileSync(entryPath, "");

    const error = validatePersistentConfigForLauncher({
      mimoNodePath: process.execPath,
      mimoEntryPath: entryPath,
      allowedRoots: [unicodeRoot],
      runtimeDir: join(testDir, "运行数据"),
      port: 3210,
    });
    assert.strictEqual(error, null);

    const controller = new LauncherController({ paths });
    const result = controller.writeConfig({
      mimoNodePath: process.execPath,
      mimoEntryPath: entryPath,
      allowedRoots: [unicodeRoot],
      runtimeDir: join(testDir, "运行数据"),
      port: 3210,
    });

    assert.strictEqual(result.ok, true);
    const saved = JSON.parse(readFileSync(paths.configPath, "utf-8"));
    assert.deepStrictEqual(saved.allowedRoots, [unicodeRoot]);
  });

  it("uses MIMO_BRIDGE_DATA_DIR for portable mode", () => {
    const dataDir = join(testDir, "portable data");
    assert.strictEqual(getLauncherDataDir({ MIMO_BRIDGE_DATA_DIR: dataDir }), dataDir);
  });

  it("matches command lines after quote and slash normalization", () => {
    const entry = "C:\\Users\\me\\MiMo Bridge\\apps\\local-daemon\\dist\\apps\\local-daemon\\src\\index.js";
    const command = "node \"C:/Users/me/MiMo Bridge/apps/local-daemon/dist/apps/local-daemon/src/index.js\"";
    assert.strictEqual(commandLineMatchesEntry(command, entry), true);
    assert.strictEqual(commandLineMatchesEntry("node C:/other/index.js", entry), false);
  });

  it("matches command lines when a non-ASCII parent path is mojibake but the daemon tail is intact", () => {
    const entry = "C:\\Users\\me\\Agent 协作项目\\mimo-bridge-mcp\\apps\\local-daemon\\dist\\apps\\local-daemon\\src\\index.js";
    const command = "node \"C:/Users/me/Agent Э����Ŀ/mimo-bridge-mcp/apps/local-daemon/dist/apps/local-daemon/src/index.js\"";
    assert.strictEqual(commandLineMatchesEntry(command, entry), true);
  });
});

function makePaths(name) {
  const base = join(testDir, name);
  const repoRoot = join(base, "repo");
  const daemonEntryPath = join(repoRoot, "apps", "local-daemon", "dist", "apps", "local-daemon", "src", "index.js");
  mkdirSync(dirname(daemonEntryPath), { recursive: true });
  writeFileSync(daemonEntryPath, "");
  const dataDir = join(base, "data");
  return {
    repoRoot,
    daemonEntryPath,
    launcherCliPath: join(repoRoot, "apps", "local-daemon", "dist", "apps", "local-daemon", "src", "launcher-cli.js"),
    launcherScriptPath: join(repoRoot, "apps", "local-daemon", "launcher.ps1"),
    dataDir,
    configPath: join(base, "config.json"),
    statePath: join(dataDir, "launcher-state.json"),
    stdoutLogPath: join(dataDir, "daemon.out.log"),
    stderrLogPath: join(dataDir, "daemon.err.log"),
  };
}

function writeLauncherState(paths, pid) {
  writeState(paths.statePath, {
    owner: "mimo-bridge-launcher",
    version: 1,
    pid,
    port: 3210,
    nodePath: process.execPath,
    daemonEntryPath: paths.daemonEntryPath,
    repoRoot: paths.repoRoot,
    stdoutLogPath: paths.stdoutLogPath,
    stderrLogPath: paths.stderrLogPath,
    configPath: paths.configPath,
    startedAt: "2026-06-21T00:00:00.000Z",
  });
}

function healthOk(port, paths) {
  return {
    ok: true,
    url: "http://127.0.0.1:" + port + "/api/health",
    data: {
      ok: true,
      data: {
        daemon: {
          status: "ok",
          identity: "mimo-bridge-local-daemon/v1",
          executable_fingerprint: paths ? fingerprint(process.execPath) : undefined,
          entry_fingerprint: paths ? fingerprint(paths.daemonEntryPath) : undefined,
        },
        security: { localhost_only: true },
      },
    },
  };
}

function fingerprint(value) {
  return createHash("sha256").update(resolve(value).toLowerCase(), "utf8").digest("hex");
}

function processInfo(paths, pid) {
  return {
    pid,
    name: "node.exe",
    executablePath: process.execPath,
    commandLine: `"${process.execPath}" "${paths.daemonEntryPath}"`,
  };
}

function healthDown(port) {
  return {
    ok: false,
    url: "http://127.0.0.1:" + port + "/api/health",
    error: "ECONNREFUSED",
  };
}

function reservePort() {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

function isListening(port) {
  return fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.ok).catch(() => false);
}

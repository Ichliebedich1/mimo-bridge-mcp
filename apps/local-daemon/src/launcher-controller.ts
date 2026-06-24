import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, normalize, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { getDefaultConfigPath, loadPersistentConfig, type PersistentConfig } from "./daemon-config.js";

const DEFAULT_PORT = 3210;
const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const WINDOWS_DAEMON_SPAWN_TIMEOUT_MS = 60_000;
const STATE_OWNER = "mimo-bridge-launcher";
const AUTOSTART_TASK_NAME = "MiMoBridge-Launcher";

export interface LauncherPaths {
  repoRoot: string;
  daemonEntryPath: string;
  launcherCliPath: string;
  launcherScriptPath: string;
  dataDir: string;
  configPath: string;
  statePath: string;
  stdoutLogPath: string;
  stderrLogPath: string;
}

export interface LauncherState {
  owner: typeof STATE_OWNER;
  version: 1;
  pid: number;
  port: number;
  nodePath: string;
  daemonEntryPath: string;
  repoRoot: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  configPath: string;
  startedAt: string;
}

export interface HealthCheck {
  ok: boolean;
  url: string;
  data?: unknown;
  statusCode?: number;
  error?: string;
}

export interface ProcessInfo {
  pid: number;
  name?: string | null;
  commandLine?: string | null;
}

export interface LauncherResult<T = unknown> {
  ok: boolean;
  status: string;
  message: string;
  data?: T;
  details?: unknown;
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface SpawnedDaemon {
  pid?: number;
  unref: () => void;
}

export interface LauncherDependencies {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  fetchHealth?: (url: string, timeoutMs: number) => Promise<HealthCheck>;
  isPortOpen?: (port: number, timeoutMs?: number) => Promise<boolean>;
  getPortProcessInfo?: (port: number) => Promise<ProcessInfo | null>;
  spawnDaemon?: (nodePath: string, args: string[], options: SpawnOptions) => SpawnedDaemon;
  isProcessAlive?: (pid: number) => boolean;
  killProcess?: (pid: number) => boolean;
  readProcessCommandLine?: (pid: number) => Promise<string | null>;
  openUrl?: (url: string) => Promise<CommandResult>;
  runPowerShell?: (script: string, timeoutMs?: number) => CommandResult;
}

export interface LauncherControllerOptions {
  paths?: Partial<LauncherPaths>;
  dependencies?: LauncherDependencies;
}

export interface StartOptions {
  openUi?: boolean;
  waitMs?: number;
}

export interface StopOptions {
  waitMs?: number;
}

export interface LogOptions {
  maxLines?: number;
  maxChars?: number;
}

export interface LauncherStatus {
  state: "running" | "running_unmanaged" | "stopped" | "starting_or_unhealthy" | "port_conflict";
  port: number;
  health: HealthCheck;
  launcherState: LauncherState | null;
  processAlive: boolean;
  processCommandLine?: string | null;
  portOwner?: ProcessInfo | null;
  codexMcpEndpoint: string;
  adminUrl: string;
}

export interface LauncherLogs {
  stdoutLogPath: string;
  stderrLogPath: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

interface ResolvedDependencies {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  fetchHealth: (url: string, timeoutMs: number) => Promise<HealthCheck>;
  isPortOpen: (port: number, timeoutMs?: number) => Promise<boolean>;
  getPortProcessInfo: (port: number) => Promise<ProcessInfo | null>;
  spawnDaemon: (nodePath: string, args: string[], options: SpawnOptions) => SpawnedDaemon;
  usesCustomSpawnDaemon: boolean;
  isProcessAlive: (pid: number) => boolean;
  killProcess: (pid: number) => boolean;
  readProcessCommandLine: (pid: number) => Promise<string | null>;
  openUrl: (url: string) => Promise<CommandResult>;
  runPowerShell: (script: string, timeoutMs?: number) => CommandResult;
}

interface PortResolution {
  port: number;
  error: string | null;
}

export class LauncherController {
  private readonly pathOverrides?: Partial<LauncherPaths>;
  private readonly deps: ResolvedDependencies;

  constructor(options: LauncherControllerOptions = {}) {
    this.pathOverrides = options.paths;
    this.deps = resolveDependencies(options.dependencies ?? {});
  }

  getPaths(): LauncherPaths {
    return getLauncherPaths(this.pathOverrides, this.deps.env);
  }

  async start(options: StartOptions = {}): Promise<LauncherResult> {
    const paths = this.getPaths();
    const portResolution = resolveLauncherPort(this.deps.env, paths.configPath);
    if (portResolution.error) {
      return failResult("config_error", portResolution.error);
    }

    if (!existsSync(paths.daemonEntryPath)) {
      return failResult(
        "missing_build",
        "找不到已编译的本地 daemon 入口，请先运行 apps/local-daemon/start-local.ps1 完成构建。",
        { daemonEntryPath: paths.daemonEntryPath }
      );
    }

    ensureLauncherDirs(paths);
    const health = await this.checkHealth(portResolution.port);
    if (health.ok) {
      if (options.openUi) {
        await this.openUi();
      }
      return {
        ok: true,
        status: "already_running",
        message: "MiMo Bridge daemon 已在运行，没有启动第二个实例。",
        data: { port: portResolution.port, health, adminUrl: getAdminUrl(portResolution.port) },
      };
    }

    if (await this.deps.isPortOpen(portResolution.port, 500)) {
      const owner = await this.deps.getPortProcessInfo(portResolution.port);
      return failResult(
        "port_conflict",
        "端口 " + portResolution.port + " 已被其他程序占用，未启动 MiMo Bridge daemon。",
        { port: portResolution.port, owner }
      );
    }

    const nodePath = resolveNodePath(this.deps.env);
    let child: SpawnedDaemon;
    if (process.platform === "win32" && !this.deps.usesCustomSpawnDaemon) {
      const launched = startDaemonWithPowerShell(paths, nodePath, this.deps.runPowerShell);
      if (!launched.ok) {
        return failResult("spawn_failed", "启动 daemon 进程失败：" + launched.error, launched.details);
      }
      child = { pid: launched.pid, unref: () => undefined };
    } else {
      const stdoutFd = openSync(paths.stdoutLogPath, "a");
      const stderrFd = openSync(paths.stderrLogPath, "a");
      try {
        child = this.deps.spawnDaemon(nodePath, [paths.daemonEntryPath], {
          cwd: paths.repoRoot,
          detached: true,
          stdio: ["ignore", stdoutFd, stderrFd],
          env: {
            ...this.deps.env,
            MIMO_BRIDGE_LAUNCHED_BY: STATE_OWNER,
          },
          windowsHide: true,
        });
      } catch (error) {
        closeIfNotStandardStream(stdoutFd);
        closeIfNotStandardStream(stderrFd);
        return failResult("spawn_failed", "启动 daemon 进程失败：" + stringifyError(error));
      }
      closeIfNotStandardStream(stdoutFd);
      closeIfNotStandardStream(stderrFd);
    }

    if (!child.pid || child.pid <= 0) {
      return failResult("spawn_failed", "启动 daemon 后没有拿到有效 PID。");
    }

    child.unref();
    const state = createState(paths, child.pid, nodePath, portResolution.port, this.deps.now());
    writeState(paths.statePath, state);

    const ready = await this.waitForHealth(portResolution.port, options.waitMs ?? DEFAULT_HEALTH_TIMEOUT_MS);
    if (!ready.ok) {
      const logs = this.readLogs({ maxLines: 40, maxChars: 6000 }).data;
      return failResult(
        "health_timeout",
        "daemon 进程已启动，但健康检查没有在限定时间内通过：" + (ready.error ?? "未知错误"),
        { pid: child.pid, health: ready, logs }
      );
    }

    if (options.openUi) {
      await this.openUi();
    }

    return {
      ok: true,
      status: "started",
      message: "MiMo Bridge daemon 已启动。",
      data: {
        pid: child.pid,
        port: portResolution.port,
        health: ready,
        adminUrl: getAdminUrl(portResolution.port),
        codexMcpEndpoint: getCodexMcpEndpoint(portResolution.port),
      },
    };
  }

  async stop(options: StopOptions = {}): Promise<LauncherResult> {
    const paths = this.getPaths();
    const state = readState(paths.statePath);
    const port = state?.port ?? resolveLauncherPort(this.deps.env, paths.configPath).port;

    if (!state) {
      const health = await this.checkHealth(port);
      if (health.ok) {
        return failResult(
          "not_owned",
          "检测到 daemon 正在运行，但没有 launcher 所有权记录。为避免误杀进程，本次不停止它。",
          { health }
        );
      }
      return { ok: true, status: "not_running", message: "MiMo Bridge daemon 当前未运行。" };
    }

    const processAlive = this.deps.isProcessAlive(state.pid);
    if (!processAlive) {
      removeState(paths.statePath);
      return { ok: true, status: "not_running", message: "launcher 记录的 daemon 进程已不存在，已清理状态文件。" };
    }

    const commandLine = await this.deps.readProcessCommandLine(state.pid);
    if (!commandLine || !commandLineMatchesEntry(commandLine, state.daemonEntryPath)) {
      return failResult(
        "ownership_check_failed",
        "PID " + state.pid + " 的命令行无法证明它是 MiMo Bridge daemon。为避免误杀进程，本次不停止它。",
        { pid: state.pid, commandLine }
      );
    }

    if (!this.deps.killProcess(state.pid)) {
      return failResult("stop_failed", "已确认进程归属，但发送停止信号失败。", { pid: state.pid });
    }

    const stopped = await this.waitForStop(state, options.waitMs ?? DEFAULT_STOP_TIMEOUT_MS);
    if (!stopped) {
      return failResult("stop_timeout", "已发送停止信号，但 daemon 没有在限定时间内退出。", { pid: state.pid });
    }

    removeState(paths.statePath);
    return { ok: true, status: "stopped", message: "MiMo Bridge daemon 已停止。" };
  }

  async restart(options: StartOptions = {}): Promise<LauncherResult> {
    const stopped = await this.stop({ waitMs: DEFAULT_STOP_TIMEOUT_MS });
    if (!stopped.ok && stopped.status !== "not_running") {
      return stopped;
    }
    return this.start(options);
  }

  async status(): Promise<LauncherResult<LauncherStatus>> {
    const paths = this.getPaths();
    const portResolution = resolveLauncherPort(this.deps.env, paths.configPath);
    const port = portResolution.port;
    const state = readState(paths.statePath);
    const health = await this.checkHealth(port);
    const processAlive = state ? this.deps.isProcessAlive(state.pid) : false;
    const commandLine = state && processAlive ? await this.deps.readProcessCommandLine(state.pid) : null;
    const ownerMatches = Boolean(state && commandLine && commandLineMatchesEntry(commandLine, state.daemonEntryPath));
    let portOwner: ProcessInfo | null = null;
    let status: LauncherStatus["state"];

    if (health.ok) {
      status = state && ownerMatches ? "running" : "running_unmanaged";
    } else if (state && processAlive) {
      status = "starting_or_unhealthy";
    } else if (await this.deps.isPortOpen(port, 500)) {
      portOwner = await this.deps.getPortProcessInfo(port);
      status = "port_conflict";
    } else {
      status = "stopped";
    }

    const data: LauncherStatus = {
      state: status,
      port,
      health,
      launcherState: state,
      processAlive,
      processCommandLine: commandLine,
      portOwner,
      codexMcpEndpoint: getCodexMcpEndpoint(port),
      adminUrl: getAdminUrl(port),
    };

    return {
      ok: status !== "port_conflict" && portResolution.error === null,
      status,
      message: statusMessage(status, portResolution.error),
      data,
    };
  }

  readLogs(options: LogOptions = {}): LauncherResult<LauncherLogs> {
    const paths = this.getPaths();
    const maxLines = clampInteger(options.maxLines ?? 80, 1, 500);
    const maxChars = clampInteger(options.maxChars ?? 20_000, 1000, 100_000);
    const stdout = readTail(paths.stdoutLogPath, maxLines, Math.floor(maxChars / 2));
    const stderr = readTail(paths.stderrLogPath, maxLines, Math.floor(maxChars / 2));
    return {
      ok: true,
      status: "logs",
      message: "已读取最近 daemon 日志。",
      data: {
        stdoutLogPath: paths.stdoutLogPath,
        stderrLogPath: paths.stderrLogPath,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
      },
    };
  }

  async openUi(): Promise<LauncherResult> {
    const port = resolveLauncherPort(this.deps.env, this.getPaths().configPath).port;
    const health = await this.checkHealth(port);
    if (!health.ok) {
      return failResult("not_running", "daemon 健康检查未通过，未打开 UI：" + (health.error ?? "未知错误"), { health });
    }
    const url = getAdminUrl(port);
    const opened = await this.deps.openUrl(url);
    if (opened.status !== 0) {
      return failResult("open_failed", "打开浏览器失败：" + (opened.stderr || opened.error || "未知错误"));
    }
    return { ok: true, status: "opened", message: "已打开管理界面。", data: { url } };
  }

  createDesktopShortcut(): LauncherResult {
    const paths = this.getPaths();
    const shortcutPath = join(getDesktopDir(this.deps.env, paths.dataDir), "MiMo Bridge Launcher.lnk");
    const script =
      "$shortcutPath = " + psQuote(shortcutPath) + "\n" +
      "$launcherPath = " + psQuote(paths.launcherScriptPath) + "\n" +
      "$repoRoot = " + psQuote(paths.repoRoot) + "\n" +
      "$wsh = New-Object -ComObject WScript.Shell\n" +
      "$shortcut = $wsh.CreateShortcut($shortcutPath)\n" +
      "$shortcut.TargetPath = 'powershell.exe'\n" +
      "$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File \"' + $launcherPath + '\"'\n" +
      "$shortcut.WorkingDirectory = $repoRoot\n" +
      "$shortcut.IconLocation = 'powershell.exe,0'\n" +
      "$shortcut.Description = 'MiMo Bridge launcher'\n" +
      "$shortcut.Save()\n";
    const result = this.deps.runPowerShell(script, 15_000);
    if (result.status !== 0) {
      return failResult("shortcut_failed", "创建桌面快捷方式失败：" + (result.stderr || result.error || "未知错误"));
    }
    return { ok: true, status: "shortcut_created", message: "已创建桌面快捷方式。", data: { shortcutPath } };
  }

  setAutostart(enabled: boolean): LauncherResult {
    const paths = this.getPaths();
    const script = enabled ? createAutostartEnableScript(paths.launcherScriptPath) : createAutostartDisableScript();
    const result = this.deps.runPowerShell(script, 20_000);
    if (result.status !== 0) {
      return failResult(
        enabled ? "autostart_enable_failed" : "autostart_disable_failed",
        (enabled ? "启用" : "关闭") + "开机自启动失败：" + (result.stderr || result.error || "未知错误")
      );
    }
    return {
      ok: true,
      status: enabled ? "autostart_enabled" : "autostart_disabled",
      message: enabled ? "已启用当前用户登录时自动启动。" : "已关闭当前用户登录时自动启动。",
    };
  }

  getAutostartStatus(): LauncherResult {
    const result = this.deps.runPowerShell(createAutostartStatusScript(), 10_000);
    if (result.status === 0 && result.stdout.trim().length > 0) {
      return { ok: true, status: "autostart_enabled", message: "当前用户登录自启动已启用。", data: result.stdout.trim() };
    }
    return { ok: true, status: "autostart_disabled", message: "当前用户登录自启动未启用。" };
  }

  writeConfig(config: PersistentConfig): LauncherResult {
    const paths = this.getPaths();
    const validation = validatePersistentConfigForLauncher(config);
    if (validation) {
      return failResult("config_invalid", validation);
    }
    mkdirSync(dirname(paths.configPath), { recursive: true });
    writeFileSync(paths.configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return {
      ok: true,
      status: "config_written",
      message: "配置已保存。Codex MCP 地址：" + getCodexMcpEndpoint(config.port ?? DEFAULT_PORT),
      data: { configPath: paths.configPath, codexMcpEndpoint: getCodexMcpEndpoint(config.port ?? DEFAULT_PORT) },
    };
  }

  readConfig(): { config: PersistentConfig | null; error: string | null; configPath: string } {
    const configPath = this.getPaths().configPath;
    const loaded = loadPersistentConfig(configPath);
    return { ...loaded, configPath };
  }

  private async checkHealth(port: number): Promise<HealthCheck> {
    return this.deps.fetchHealth(getHealthUrl(port), 1500);
  }

  private async waitForHealth(port: number, timeoutMs: number): Promise<HealthCheck> {
    const deadline = Date.now() + timeoutMs;
    let last = await this.checkHealth(port);
    while (!last.ok && Date.now() < deadline) {
      await this.deps.sleep(500);
      last = await this.checkHealth(port);
    }
    return last;
  }

  private async waitForStop(state: LauncherState, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.deps.isProcessAlive(state.pid)) {
        return true;
      }
      const health = await this.checkHealth(state.port);
      if (!health.ok) {
        return true;
      }
      await this.deps.sleep(300);
    }
    return !this.deps.isProcessAlive(state.pid);
  }
}

export function getLauncherPaths(overrides: Partial<LauncherPaths> | undefined = undefined, env: NodeJS.ProcessEnv = process.env): LauncherPaths {
  const repoRoot = overrides?.repoRoot ?? findLauncherRepoRoot();
  const dataDir = overrides?.dataDir ?? getLauncherDataDir(env);
  const configPath = overrides?.configPath ?? env.MIMO_BRIDGE_CONFIG ?? getDefaultConfigPath();
  return {
    repoRoot,
    daemonEntryPath: overrides?.daemonEntryPath ?? join(repoRoot, "apps", "local-daemon", "dist", "apps", "local-daemon", "src", "index.js"),
    launcherCliPath: overrides?.launcherCliPath ?? join(repoRoot, "apps", "local-daemon", "dist", "apps", "local-daemon", "src", "launcher-cli.js"),
    launcherScriptPath: overrides?.launcherScriptPath ?? join(repoRoot, "apps", "local-daemon", "launcher.ps1"),
    dataDir,
    configPath,
    statePath: overrides?.statePath ?? join(dataDir, "launcher-state.json"),
    stdoutLogPath: overrides?.stdoutLogPath ?? join(dataDir, "daemon.out.log"),
    stderrLogPath: overrides?.stderrLogPath ?? join(dataDir, "daemon.err.log"),
  };
}

export function getLauncherDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MIMO_BRIDGE_DATA_DIR) {
    return resolve(env.MIMO_BRIDGE_DATA_DIR);
  }
  const base = env.LOCALAPPDATA || resolve(env.HOME || env.USERPROFILE || ".", "AppData", "Local");
  return join(base, "MiMoBridge");
}

export function findLauncherRepoRoot(startDir: string = process.cwd()): string {
  const starts = [resolve(startDir), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let current = start;
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(current, "package.json")) && existsSync(join(current, "apps", "local-daemon", "src", "index.ts"))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return resolve(startDir);
}

export function resolveLauncherPort(env: NodeJS.ProcessEnv = process.env, configPath: string = getDefaultConfigPath()): PortResolution {
  if (env.MIMO_DAEMON_PORT !== undefined) {
    return parsePortForLauncher(env.MIMO_DAEMON_PORT, "MIMO_DAEMON_PORT");
  }
  const loaded = loadPersistentConfig(configPath);
  if (loaded.config?.port !== undefined) {
    if (typeof loaded.config.port !== "number" || !Number.isInteger(loaded.config.port)) {
      return { port: DEFAULT_PORT, error: "配置文件 port 必须是 1-65535 之间的整数。" };
    }
    return parsePortForLauncher(String(loaded.config.port), "配置文件 port");
  }
  return { port: DEFAULT_PORT, error: null };
}

export function getHealthUrl(port: number): string {
  return "http://127.0.0.1:" + port + "/api/health";
}

export function getAdminUrl(port: number): string {
  return "http://127.0.0.1:" + port + "/";
}

export function getCodexMcpEndpoint(port: number): string {
  return "http://127.0.0.1:" + port + "/mcp";
}

export function commandLineMatchesEntry(commandLine: string, entryPath: string): boolean {
  const normalizedCommand = normalizeForCompare(commandLine);
  const normalizedEntry = normalizeForCompare(entryPath);
  if (normalizedCommand.includes(normalizedEntry)) {
    return true;
  }
  const entryParts = normalizedEntry.split(/\\+/).filter(Boolean);
  const stableEntryTail = entryParts.slice(-7).join("\\");
  return stableEntryTail.length > 0 && normalizedCommand.includes(stableEntryTail);
}

export function readState(statePath: string): LauncherState | null {
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8"));
    if (!isRecord(parsed) || parsed.owner !== STATE_OWNER || parsed.version !== 1 || typeof parsed.pid !== "number") {
      return null;
    }
    return parsed as unknown as LauncherState;
  } catch {
    return null;
  }
}

export function writeState(statePath: string, state: LauncherState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function validatePersistentConfigForLauncher(config: PersistentConfig): string | null {
  if (!config.mimoNodePath || typeof config.mimoNodePath !== "string") {
    return "MiMo Node 路径不能为空。";
  }
  if (!existsSync(config.mimoNodePath)) {
    return "MiMo Node 路径不存在：" + config.mimoNodePath;
  }
  if (!config.mimoEntryPath || typeof config.mimoEntryPath !== "string") {
    return "MiMo 入口路径不能为空。";
  }
  if (!existsSync(config.mimoEntryPath)) {
    return "MiMo 入口路径不存在：" + config.mimoEntryPath;
  }
  if (!Array.isArray(config.allowedRoots) || config.allowedRoots.length === 0) {
    return "至少需要配置一个允许的项目根目录。";
  }
  for (const root of config.allowedRoots) {
    if (typeof root !== "string" || root.length === 0) {
      return "允许的项目根目录必须是非空字符串。";
    }
    if (!existsSync(root)) {
      return "允许的项目根目录不存在：" + root;
    }
  }
  if (config.runtimeDir !== undefined && typeof config.runtimeDir !== "string") {
    return "runtimeDir 必须是字符串。";
  }
  if (config.port !== undefined && (typeof config.port !== "number" || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535)) {
    return "port 必须是 1-65535 之间的整数。";
  }
  return null;
}

function resolveDependencies(deps: LauncherDependencies): ResolvedDependencies {
  const env = deps.env ?? process.env;
  const runPowerShell = deps.runPowerShell ?? defaultRunPowerShell;
  return {
    env,
    now: deps.now ?? (() => new Date()),
    sleep: deps.sleep ?? sleep,
    fetchHealth: deps.fetchHealth ?? defaultFetchHealth,
    isPortOpen: deps.isPortOpen ?? defaultIsPortOpen,
    getPortProcessInfo: deps.getPortProcessInfo ?? ((port) => defaultGetPortProcessInfo(port, runPowerShell)),
    spawnDaemon: deps.spawnDaemon ?? defaultSpawnDaemon,
    usesCustomSpawnDaemon: Boolean(deps.spawnDaemon),
    isProcessAlive: deps.isProcessAlive ?? defaultIsProcessAlive,
    killProcess: deps.killProcess ?? defaultKillProcess,
    readProcessCommandLine: deps.readProcessCommandLine ?? ((pid) => defaultReadProcessCommandLine(pid, runPowerShell)),
    openUrl: deps.openUrl ?? ((url) => defaultOpenUrl(url, runPowerShell)),
    runPowerShell,
  };
}

async function defaultFetchHealth(url: string, timeoutMs: number): Promise<HealthCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok && isMimoBridgeHealth(data),
      url,
      statusCode: response.status,
      data,
      error: response.ok ? undefined : "HTTP " + response.status,
    };
  } catch (error) {
    return { ok: false, url, error: stringifyError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function defaultIsPortOpen(port: number, timeoutMs: number = 500): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let done = false;
    const finish = (value: boolean) => {
      if (done) {
        return;
      }
      done = true;
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function defaultSpawnDaemon(nodePath: string, args: string[], options: SpawnOptions): SpawnedDaemon {
  const child: ChildProcess = spawn(nodePath, args, options);
  return {
    pid: child.pid,
    unref: () => child.unref(),
  };
}

function startDaemonWithPowerShell(paths: LauncherPaths, nodePath: string, runPowerShell: (script: string, timeoutMs?: number) => CommandResult): { ok: true; pid: number } | { ok: false; error: string; details?: unknown } {
  const script =
    "$env:MIMO_BRIDGE_LAUNCHED_BY = " + psQuote(STATE_OWNER) + "\n" +
    "$nodePath = " + psQuote(nodePath) + "\n" +
    "$entryPath = " + psQuote(paths.daemonEntryPath) + "\n" +
    "$entryArg = '\"' + $entryPath + '\"'\n" +
    "$repoRoot = " + psQuote(paths.repoRoot) + "\n" +
    "$stdoutPath = " + psQuote(paths.stdoutLogPath) + "\n" +
    "$stderrPath = " + psQuote(paths.stderrLogPath) + "\n" +
    "$process = Start-Process -FilePath $nodePath -ArgumentList $entryArg -WorkingDirectory $repoRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru\n" +
    "$process.Id\n";
  const result = runPowerShell(script, WINDOWS_DAEMON_SPAWN_TIMEOUT_MS);
  const pid = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isInteger(pid) || pid <= 0) {
    return { ok: false, error: result.stderr || result.error || "无法取得 daemon PID。", details: result };
  }
  return { ok: true, pid };
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultKillProcess(pid: number): boolean {
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Stop-Process -Id " + String(pid) + " -Force -ErrorAction Stop",
    ], { encoding: "utf-8", windowsHide: true });
    return result.status === 0;
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function closeIfNotStandardStream(fd: number): void {
  if (fd > 2) {
    closeSync(fd);
  }
}

async function defaultReadProcessCommandLine(pid: number, runPowerShell: (script: string, timeoutMs?: number) => CommandResult): Promise<string | null> {
  if (process.platform === "win32") {
    const script =
      "$p = Get-CimInstance Win32_Process -Filter " + psQuote("ProcessId=" + pid) + "\n" +
      "if ($null -ne $p) { $p.CommandLine }\n";
    const result = runPowerShell(script, 10_000);
    return result.status === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : null;
  }
  const procPath = "/proc/" + pid + "/cmdline";
  if (!existsSync(procPath)) {
    return null;
  }
  return readFileSync(procPath, "utf-8").replace(/\0/g, " ").trim();
}

async function defaultGetPortProcessInfo(port: number, runPowerShell: (script: string, timeoutMs?: number) => CommandResult): Promise<ProcessInfo | null> {
  if (process.platform !== "win32") {
    return null;
  }
  const script =
    "$port = " + port + "\n" +
    "$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1\n" +
    "if ($null -eq $c) { exit 0 }\n" +
    "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess)\n" +
    "[pscustomobject]@{ pid = [int]$c.OwningProcess; name = $p.Name; commandLine = $p.CommandLine } | ConvertTo-Json -Compress\n";
  const result = runPowerShell(script, 10_000);
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout.trim());
    if (isRecord(parsed) && typeof parsed.pid === "number") {
      return {
        pid: parsed.pid,
        name: typeof parsed.name === "string" ? parsed.name : null,
        commandLine: typeof parsed.commandLine === "string" ? parsed.commandLine : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function defaultOpenUrl(url: string, runPowerShell: (script: string, timeoutMs?: number) => CommandResult): Promise<CommandResult> {
  return runPowerShell("Start-Process -FilePath " + psQuote(url), 10_000);
}

function defaultRunPowerShell(script: string, timeoutMs: number = 10_000): CommandResult {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    encoding: "utf-8",
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? result.error.message : undefined,
  };
}

function createState(paths: LauncherPaths, pid: number, nodePath: string, port: number, now: Date): LauncherState {
  return {
    owner: STATE_OWNER,
    version: 1,
    pid,
    port,
    nodePath,
    daemonEntryPath: paths.daemonEntryPath,
    repoRoot: paths.repoRoot,
    stdoutLogPath: paths.stdoutLogPath,
    stderrLogPath: paths.stderrLogPath,
    configPath: paths.configPath,
    startedAt: now.toISOString(),
  };
}

function ensureLauncherDirs(paths: LauncherPaths): void {
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(dirname(paths.stdoutLogPath), { recursive: true });
  mkdirSync(dirname(paths.stderrLogPath), { recursive: true });
}

function removeState(statePath: string): void {
  if (existsSync(statePath)) {
    rmSync(statePath, { force: true });
  }
}

function parsePortForLauncher(value: string, label: string): PortResolution {
  const port = Number(value);
  if (value.trim().length === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { port: DEFAULT_PORT, error: label + " 必须是 1-65535 之间的整数。" };
  }
  return { port, error: null };
}

function resolveNodePath(env: NodeJS.ProcessEnv): string {
  return env.MIMO_BRIDGE_NODE_PATH || process.execPath || "node";
}

function readTail(filePath: string, maxLines: number, maxChars: number): { text: string; truncated: boolean } {
  if (!existsSync(filePath)) {
    return { text: "", truncated: false };
  }
  const stat = statSync(filePath);
  const bytesToRead = Math.min(stat.size, Math.max(maxChars * 4, 8192));
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
    const raw = buffer.toString("utf-8");
    const lines = raw.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    const byLines = lines.slice(-maxLines).join("\n");
    const bounded = byLines.length > maxChars ? byLines.slice(byLines.length - maxChars) : byLines;
    return { text: redactSensitiveText(bounded), truncated: stat.size > bytesToRead || byLines.length > maxChars };
  } finally {
    closeSync(fd);
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization|cookie|token|secret|password)\s*[:=]\s*[^\s]+/gi, "$1=<redacted>")
    .replace(/(MIMO_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=([^\s]+)/g, "$1=<redacted>");
}

function normalizeForCompare(value: string): string {
  return normalize(value).replace(/\//g, "\\").replace(/"/g, "").toLowerCase();
}

function isMimoBridgeHealth(data: unknown): boolean {
  if (!isRecord(data) || data.ok !== true || !isRecord(data.data)) {
    return false;
  }
  const daemon = data.data.daemon;
  const security = data.data.security;
  return isRecord(daemon) && daemon.status === "ok" && isRecord(security) && security.localhost_only === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function failResult(status: string, message: string, details?: unknown): LauncherResult {
  return { ok: false, status, message, details };
}

function statusMessage(status: LauncherStatus["state"], configError: string | null): string {
  if (configError) {
    return configError;
  }
  if (status === "running") {
    return "MiMo Bridge daemon 正在运行，并由 launcher 管理。";
  }
  if (status === "running_unmanaged") {
    return "MiMo Bridge daemon 正在运行，但不是由当前 launcher 状态文件管理。";
  }
  if (status === "starting_or_unhealthy") {
    return "launcher 记录的 daemon 进程存在，但健康检查未通过。";
  }
  if (status === "port_conflict") {
    return "端口被占用，但不是健康的 MiMo Bridge daemon。";
  }
  return "MiMo Bridge daemon 当前未运行。";
}

function getDesktopDir(env: NodeJS.ProcessEnv, fallbackDataDir: string): string {
  if (env.USERPROFILE) {
    return join(env.USERPROFILE, "Desktop");
  }
  return fallbackDataDir;
}

function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function createAutostartEnableScript(launcherScriptPath: string): string {
  return (
    "$taskName = " + psQuote(AUTOSTART_TASK_NAME) + "\n" +
    "$launcherPath = " + psQuote(launcherScriptPath) + "\n" +
    "$argument = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"' + $launcherPath + '\" start'\n" +
    "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument\n" +
    "$trigger = New-ScheduledTaskTrigger -AtLogOn\n" +
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries\n" +
    "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Start MiMo Bridge for the current user at logon' -Force | Out-Null\n"
  );
}

function createAutostartDisableScript(): string {
  return (
    "$taskName = " + psQuote(AUTOSTART_TASK_NAME) + "\n" +
    "$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue\n" +
    "if ($null -ne $task) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }\n"
  );
}

function createAutostartStatusScript(): string {
  return (
    "$taskName = " + psQuote(AUTOSTART_TASK_NAME) + "\n" +
    "$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue\n" +
    "if ($null -ne $task) { $task.State }\n"
  );
}

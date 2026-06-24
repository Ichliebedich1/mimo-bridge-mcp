import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkMimoVersion, type Config, type MimoVersion } from "../../../src/config.js";
import type { AgentConfig } from "../../../src/types.js";

export interface DaemonConfig {
  host: "127.0.0.1";
  port: number;
  runtimeDir: string;
  mcpConfig: Config | null;
  mimoVersion: MimoVersion | null;
  agents: AgentConfig[];
  configError: string | null;
}

export interface PersistentConfig {
  mimoNodePath?: string;
  mimoEntryPath?: string;
  allowedRoots?: string[];
  runtimeDir?: string;
  port?: number;
  agents?: AgentConfig[];
}

export function getDefaultConfigPath(): string {
  const localAppData = process.env.LOCALAPPDATA || resolve(process.env.HOME || process.env.USERPROFILE || ".", "AppData", "Local");
  return join(localAppData, "MiMoBridge", "config.json");
}

export function resolveConfigPath(): string {
  return process.env.MIMO_BRIDGE_CONFIG || getDefaultConfigPath();
}

export function loadPersistentConfig(configPath: string): { config: PersistentConfig | null; error: string | null } {
  if (!existsSync(configPath)) {
    return { config: null, error: null };
  }
  try {
    const raw = stripUtf8Bom(readFileSync(configPath, "utf-8"));
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { config: null, error: `配置文件不是有效的 JSON 对象: ${configPath}` };
    }
    return { config: parsed as PersistentConfig, error: null };
  } catch (err) {
    return { config: null, error: `配置文件读取或解析失败: ${configPath} — ${err instanceof Error ? err.message : String(err)}` };
  }
}

function resolveArrayField(envValue: string | undefined, persisted: string[] | undefined): string[] {
  if (envValue !== undefined) {
    return envValue.split(";").filter(Boolean);
  }
  if (Array.isArray(persisted)) {
    return persisted.filter((item) => typeof item === "string" && item.length > 0);
  }
  return [];
}

function validatePersistentFields(config: PersistentConfig): string | null {
  if (process.env.MIMO_NODE_PATH === undefined && config.mimoNodePath !== undefined && typeof config.mimoNodePath !== "string") {
    return "配置文件 mimoNodePath 必须是字符串";
  }
  if (process.env.MIMO_ENTRY_PATH === undefined && config.mimoEntryPath !== undefined && typeof config.mimoEntryPath !== "string") {
    return "配置文件 mimoEntryPath 必须是字符串";
  }
  if (process.env.MIMO_RUNTIME_DIR === undefined && config.runtimeDir !== undefined && typeof config.runtimeDir !== "string") {
    return "配置文件 runtimeDir 必须是字符串";
  }
  if (process.env.MIMO_ALLOWED_ROOTS === undefined && config.allowedRoots !== undefined) {
    if (!Array.isArray(config.allowedRoots)) {
      return "配置文件 allowedRoots 必须是数组";
    }
    for (const item of config.allowedRoots) {
      if (typeof item !== "string") {
        return "配置文件 allowedRoots 的每个元素必须是字符串";
      }
    }
  }
  if (process.env.MIMO_DAEMON_PORT === undefined && config.port !== undefined && (typeof config.port !== "number" || !Number.isInteger(config.port))) {
    return "配置文件 port 必须是整数";
  }
  if (config.agents !== undefined) {
    if (!Array.isArray(config.agents)) {
      return "配置文件 agents 必须是数组";
    }
    for (const agent of config.agents) {
      if (typeof agent !== "object" || agent === null || Array.isArray(agent)) {
        return "配置文件 agents 的每一项必须是对象";
      }
      const item = agent as unknown as Record<string, unknown>;
      if (typeof item.id !== "string" || item.id.length === 0) {
        return "配置文件 agents 每一项必须有字符串 id";
      }
      if (typeof item.kind !== "string" || item.kind.length === 0) {
        return "配置文件 agents 每一项必须有字符串 kind";
      }
      if (item.display_name !== undefined && typeof item.display_name !== "string") {
        return "配置文件 agents.display_name 必须是字符串";
      }
      if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
        return "配置文件 agents.enabled 必须是布尔值";
      }
      if (item.command !== undefined && typeof item.command !== "string") {
        return "配置文件 agents.command 必须是字符串";
      }
      if (item.command_args !== undefined) {
        if (!Array.isArray(item.command_args) || item.command_args.some((arg) => typeof arg !== "string")) {
          return "配置文件 agents.command_args 必须是字符串数组";
        }
      }
      if (item.home_dir !== undefined && typeof item.home_dir !== "string") {
        return "配置文件 agents.home_dir 必须是字符串";
      }
      if (item.models !== undefined) {
        if (!Array.isArray(item.models) || item.models.some((model) => typeof model !== "string")) {
          return "配置文件 agents.models 必须是字符串数组";
        }
      }
    }
  }
  return null;
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

export function loadDaemonConfig(): DaemonConfig {
  const host = "127.0.0.1" as const;
  const configPath = resolveConfigPath();
  const { config: persistent, error: loadError } = loadPersistentConfig(configPath);

  let configError: string | null = loadError;

  if (!configError && persistent) {
    configError = validatePersistentFields(persistent);
  }

  const portSource = process.env.MIMO_DAEMON_PORT ?? (persistent?.port !== undefined ? String(persistent.port) : undefined);
  const port = parsePort(portSource, 3210);
  if (!configError && portSource !== undefined && !isValidPort(portSource)) {
    configError = `无效的端口值: ${portSource}，端口必须是 1-65535 之间的整数`;
  }

  const runtimeDir =
    process.env.MIMO_RUNTIME_DIR ||
    persistent?.runtimeDir ||
    resolve(findRepoRoot(), "runtime");

  const mimoNodePath = process.env.MIMO_NODE_PATH || persistent?.mimoNodePath;
  const mimoEntryPath = process.env.MIMO_ENTRY_PATH || persistent?.mimoEntryPath;
  const allowedRoots = resolveArrayField(process.env.MIMO_ALLOWED_ROOTS, persistent?.allowedRoots);
  const agents = resolveAgentConfigs(persistent?.agents);

  let mcpConfig: Config | null = null;
  let mimoVersion: MimoVersion | null = null;

  if (!configError) {
    if (!mimoNodePath) {
      configError = "MiMo Node 路径未配置 (MIMO_NODE_PATH 或配置文件 mimoNodePath)";
    } else if (!mimoEntryPath) {
      configError = "MiMo 入口路径未配置 (MIMO_ENTRY_PATH 或配置文件 mimoEntryPath)";
    } else if (allowedRoots.length === 0) {
      configError = "允许的根目录未配置 (MIMO_ALLOWED_ROOTS 或配置文件 allowedRoots)";
    } else if (!existsSync(mimoNodePath)) {
      configError = `MiMo Node 路径不存在: ${mimoNodePath}`;
    } else if (!existsSync(mimoEntryPath)) {
      configError = `MiMo 入口路径不存在: ${mimoEntryPath}`;
    } else {
      try {
        mimoVersion = checkMimoVersion(mimoNodePath, mimoEntryPath);
        mcpConfig = {
          mimoNodePath,
          mimoEntryPath,
          allowedRoots,
          runtimeDir,
          agents,
        };
      } catch {
        configError = "MiMo 版本检查失败";
      }
    }
  }

  return {
    host,
    port,
    runtimeDir,
    mcpConfig,
    mimoVersion,
    agents,
    configError,
  };
}

function resolveAgentConfigs(persisted: AgentConfig[] | undefined): AgentConfig[] {
  const agents = Array.isArray(persisted) ? persisted.map(normalizeAgentConfig).filter((agent): agent is AgentConfig => agent !== null) : [];
  if (!agents.some((agent) => agent.id === "mimo")) {
    agents.unshift({
      id: "mimo",
      kind: "mimo",
      display_name: "MiMo Code",
      enabled: true,
    });
  }
  return agents;
}

function normalizeAgentConfig(input: AgentConfig): AgentConfig | null {
  if (!input || typeof input.id !== "string" || typeof input.kind !== "string") {
    return null;
  }
  return {
    id: input.id,
    kind: input.kind,
    display_name: input.display_name || input.id,
    enabled: input.enabled !== false,
    command: input.command,
    command_args: Array.isArray(input.command_args) ? input.command_args.filter((arg) => typeof arg === "string") : undefined,
    home_dir: input.home_dir,
    default_model: input.default_model,
    models: Array.isArray(input.models) ? input.models.filter((model) => typeof model === "string") : undefined,
    max_steps: typeof input.max_steps === "number" && Number.isInteger(input.max_steps) ? input.max_steps : undefined,
  };
}

export function findRepoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "src", "index.ts"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || !isValidPort(value)) {
    return fallback;
  }
  return Number(value);
}

function isValidPort(value: string): boolean {
  const port = Number(value);
  return value.trim().length > 0 && Number.isInteger(port) && port >= 1 && port <= 65535;
}

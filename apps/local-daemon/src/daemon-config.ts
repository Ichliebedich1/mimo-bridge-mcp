import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkMimoVersion, type Config, type MimoVersion } from "../../../src/config.js";

export interface DaemonConfig {
  host: "127.0.0.1";
  port: number;
  runtimeDir: string;
  mcpConfig: Config | null;
  mimoVersion: MimoVersion | null;
  configError: string | null;
}

export function loadDaemonConfig(): DaemonConfig {
  const host = "127.0.0.1" as const;
  const port = parsePort(process.env.MIMO_DAEMON_PORT, 3210);
  const runtimeDir = process.env.MIMO_RUNTIME_DIR || resolve(findRepoRoot(), "runtime");
  const mimoNodePath = process.env.MIMO_NODE_PATH;
  const mimoEntryPath = process.env.MIMO_ENTRY_PATH;
  const allowedRoots = process.env.MIMO_ALLOWED_ROOTS?.split(";").filter(Boolean) || [];

  let mcpConfig: Config | null = null;
  let mimoVersion: MimoVersion | null = null;
  let configError: string | null = null;

  if (!mimoNodePath) {
    configError = "MIMO_NODE_PATH 环境变量未设置";
  } else if (!mimoEntryPath) {
    configError = "MIMO_ENTRY_PATH 环境变量未设置";
  } else if (allowedRoots.length === 0) {
    configError = "MIMO_ALLOWED_ROOTS 环境变量未设置";
  } else if (!existsSync(mimoNodePath)) {
    configError = "MIMO_NODE_PATH 指向的文件不存在";
  } else if (!existsSync(mimoEntryPath)) {
    configError = "MIMO_ENTRY_PATH 指向的文件不存在";
  } else {
    try {
      mimoVersion = checkMimoVersion(mimoNodePath, mimoEntryPath);
      mcpConfig = {
        mimoNodePath,
        mimoEntryPath,
        allowedRoots,
        runtimeDir,
      };
    } catch {
      configError = "MiMo 版本检查失败";
    }
  }

  return {
    host,
    port,
    runtimeDir,
    mcpConfig,
    mimoVersion,
    configError,
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
  if (!value) {
    return fallback;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }
  return port;
}

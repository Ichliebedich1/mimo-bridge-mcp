import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { AgentConfig } from "./types.js";

export interface Config {
  mimoNodePath: string;
  mimoEntryPath: string;
  allowedRoots: string[];
  runtimeDir: string;
  agents: AgentConfig[];
}

export interface MimoVersion {
  nodeVersion: string;
  cliVersion: string;
}

export function checkNodeVersion(nodePath: string): string {
  try {
    const version = execFileSync(nodePath, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    return version;
  } catch (err) {
    throw new Error(`无法获取 Node.js 版本: ${err}`);
  }
}

export function checkMimoCliVersion(nodePath: string, entryPath: string): string {
  try {
    const version = execFileSync(nodePath, [entryPath, "--version"], {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    return version;
  } catch (err) {
    throw new Error(`无法获取 MiMo CLI 版本: ${err}`);
  }
}

export function checkMimoVersion(nodePath: string, entryPath: string): MimoVersion {
  const nodeVersion = checkNodeVersion(nodePath);
  const cliVersion = checkMimoCliVersion(nodePath, entryPath);
  return { nodeVersion, cliVersion };
}

export function loadConfig(): Config {
  const mimoNodePath = process.env.MIMO_NODE_PATH;
  const mimoEntryPath = process.env.MIMO_ENTRY_PATH;
  const allowedRoots = process.env.MIMO_ALLOWED_ROOTS?.split(";").filter(Boolean) || [];
  const runtimeDir = process.env.MIMO_RUNTIME_DIR || resolve(process.cwd(), "runtime");
  const agents = loadAgentConfigsFromEnv();

  if (!mimoNodePath) {
    throw new Error("MIMO_NODE_PATH 环境变量未设置");
  }
  if (!mimoEntryPath) {
    throw new Error("MIMO_ENTRY_PATH 环境变量未设置");
  }
  if (allowedRoots.length === 0) {
    throw new Error("MIMO_ALLOWED_ROOTS 环境变量未设置");
  }

  if (!existsSync(mimoNodePath)) {
    throw new Error(`MIMO_NODE_PATH 指向的文件不存在: ${mimoNodePath}`);
  }
  if (!existsSync(mimoEntryPath)) {
    throw new Error(`MIMO_ENTRY_PATH 指向的文件不存在: ${mimoEntryPath}`);
  }

  try {
    const version = checkMimoVersion(mimoNodePath, mimoEntryPath);
    process.stderr.write(`MiMo Node.js 版本: ${version.nodeVersion}\n`);
    process.stderr.write(`MiMo CLI 版本: ${version.cliVersion}\n`);
  } catch (err) {
    throw new Error(`版本检查失败: ${err}`);
  }

  return {
    mimoNodePath,
    mimoEntryPath,
    allowedRoots,
    runtimeDir,
    agents,
  };
}

function loadAgentConfigsFromEnv(): AgentConfig[] {
  const agents: AgentConfig[] = [
    {
      id: "mimo",
      kind: "mimo",
      display_name: "MiMo Code",
      enabled: true,
    },
  ];
  const reasonixCommand = process.env.REASONIX_COMMAND;
  if (reasonixCommand) {
    agents.push({
      id: "reasonix-tui",
      kind: "reasonix-tui",
      display_name: "Reasonix TUI",
      enabled: process.env.REASONIX_ENABLED !== "false",
      command: reasonixCommand,
      home_dir: process.env.REASONIX_HOME,
      default_model: process.env.REASONIX_DEFAULT_MODEL,
      models: process.env.REASONIX_MODELS?.split(";").filter(Boolean),
      max_steps: parseOptionalInt(process.env.REASONIX_MAX_STEPS),
    });
  }
  const reasonixGuiCommand = process.env.REASONIX_GUI_COMMAND;
  if (reasonixGuiCommand) {
    agents.push({
      id: "reasonix-gui",
      kind: "reasonix-gui",
      display_name: "Reasonix GUI",
      enabled: process.env.REASONIX_GUI_ENABLED !== "false",
      command: reasonixGuiCommand,
      home_dir: process.env.REASONIX_HOME,
    });
  }
  return agents;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

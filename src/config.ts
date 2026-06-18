import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

export interface Config {
  mimoNodePath: string;
  mimoEntryPath: string;
  allowedRoots: string[];
  runtimeDir: string;
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
  };
}

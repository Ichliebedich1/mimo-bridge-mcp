import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Config {
  mimoNodePath: string;
  mimoEntryPath: string;
  allowedRoots: string[];
  runtimeDir: string;
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

  return {
    mimoNodePath,
    mimoEntryPath,
    allowedRoots,
    runtimeDir,
  };
}

import { resolve, normalize, isAbsolute } from "node:path";
import { existsSync, lstatSync } from "node:fs";

export interface PathGuardResult {
  allowed: boolean;
  reason?: string;
}

export function validateWorkspacePath(
  workspacePath: string,
  allowedRoots: string[]
): PathGuardResult {
  if (!isAbsolute(workspacePath)) {
    return { allowed: false, reason: "workspace_path 必须是绝对路径" };
  }

  const normalized = normalize(resolve(workspacePath));

  if (!existsSync(normalized)) {
    return { allowed: false, reason: `路径不存在: ${normalized}` };
  }

  try {
    const stat = lstatSync(normalized);
    if (!stat.isDirectory()) {
      return { allowed: false, reason: `路径不是目录: ${normalized}` };
    }
  } catch {
    return { allowed: false, reason: `无法读取路径信息: ${normalized}` };
  }

  const isAllowed = allowedRoots.some((root) => {
    const normalizedRoot = normalize(resolve(root));
    return normalized.startsWith(normalizedRoot);
  });

  if (!isAllowed) {
    return {
      allowed: false,
      reason: `路径不在允许的根目录范围内: ${normalized}`,
    };
  }

  return { allowed: true };
}

export function validateEditablePaths(
  editablePaths: string[],
  workspacePath: string
): PathGuardResult {
  for (const relPath of editablePaths) {
    if (relPath.includes("..")) {
      return { allowed: false, reason: `路径不允许包含 .. : ${relPath}` };
    }

    const fullPath = normalize(resolve(workspacePath, relPath));

    if (!fullPath.startsWith(normalize(resolve(workspacePath)))) {
      return { allowed: false, reason: `路径超出工作区范围: ${relPath}` };
    }
  }

  return { allowed: true };
}

export function validateSessionId(sessionId: string): PathGuardResult {
  const pattern = /^ses_[a-zA-Z0-9]+$/;
  if (!pattern.test(sessionId)) {
    return { allowed: false, reason: `session_id 格式无效: ${sessionId}` };
  }
  return { allowed: true };
}

export function validateMaxRounds(maxRounds: number): PathGuardResult {
  if (maxRounds < 1 || maxRounds > 10) {
    return { allowed: false, reason: `max_rounds 必须在 1-10 之间: ${maxRounds}` };
  }
  return { allowed: true };
}

export function validateTimeout(timeout: number): PathGuardResult {
  if (timeout < 60 || timeout > 3600) {
    return { allowed: false, reason: `runtime_timeout_seconds 必须在 60-3600 之间: ${timeout}` };
  }
  return { allowed: true };
}

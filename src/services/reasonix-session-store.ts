import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

export interface ReasonixSessionCandidate {
  path: string;
  modified_at: string;
  size_bytes: number;
  score: number;
}

export interface FindReasonixSessionOptions {
  homeDir?: string;
  workspacePath: string;
  taskId: string;
  startedAtMs: number;
  finishedAtMs?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_FILES = 500;
const FINISH_GRACE_MS = 10 * 60 * 1000;

export function findReasonixSessionPath(options: FindReasonixSessionOptions): ReasonixSessionCandidate | null {
  const candidates = findReasonixSessionCandidates(options);
  return candidates[0] ?? null;
}

export function findReasonixSessionCandidates(options: FindReasonixSessionOptions): ReasonixSessionCandidate[] {
  if (!options.homeDir) {
    return [];
  }

  const home = resolve(options.homeDir);
  const projectsDir = resolve(home, "projects");
  if (!existsSync(projectsDir)) {
    return [];
  }

  const finishedAtMs = options.finishedAtMs ?? Date.now();
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const workspaceHints = buildWorkspaceHints(options.workspacePath);
  const taskId = options.taskId.toLowerCase();
  const files = collectJsonlFiles(projectsDir, maxFiles);
  const candidates: ReasonixSessionCandidate[] = [];

  for (const filePath of files) {
    if (!isInside(projectsDir, filePath)) {
      continue;
    }
    const normalized = filePath.toLowerCase();
    if (normalized.includes(`${separatorToken()}.trash${separatorToken()}`) || normalized.includes("/.trash/") || normalized.includes("\\.trash\\")) {
      continue;
    }

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }

    const modifiedMs = stat.mtimeMs;
    if (modifiedMs < options.startedAtMs - 2000 || modifiedMs > finishedAtMs + FINISH_GRACE_MS) {
      continue;
    }

    let score = Math.max(0, 1_000_000 - Math.abs(finishedAtMs - modifiedMs));
    if (normalized.includes(taskId)) {
      score += 10_000_000;
    }
    for (const hint of workspaceHints) {
      if (hint && normalized.includes(hint)) {
        score += 1_000_000;
      }
    }
    if (basename(filePath).toLowerCase().endsWith(".jsonl")) {
      score += 100_000;
    }

    candidates.push({
      path: filePath,
      modified_at: new Date(modifiedMs).toISOString(),
      size_bytes: stat.size,
      score,
    });
  }

  return candidates.sort((a, b) => b.score - a.score || b.size_bytes - a.size_bytes || b.modified_at.localeCompare(a.modified_at));
}

function collectJsonlFiles(root: string, maxFiles: number): string[] {
  const result: string[] = [];
  const stack = [root];

  while (stack.length > 0 && result.length < maxFiles) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (result.length >= maxFiles) {
        break;
      }
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".trash" || entry.name.endsWith(".ckpt")) {
          continue;
        }
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

function buildWorkspaceHints(workspacePath: string): string[] {
  const normalized = workspacePath.toLowerCase().replace(/[\\/:\s]+/g, "-");
  const compact = normalized.replace(/-+/g, "-").replace(/^-|-$/g, "");
  const taskMatch = /task_[a-f0-9]{12}/i.exec(workspacePath);
  return [
    compact,
    basename(workspacePath).toLowerCase(),
    taskMatch?.[0].toLowerCase() ?? "",
  ].filter(Boolean);
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, resolve(candidate));
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}

function separatorToken(): string {
  return process.platform === "win32" ? "\\" : "/";
}

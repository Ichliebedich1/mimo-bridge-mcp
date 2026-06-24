import { resolve, normalize, relative, isAbsolute } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import type {
  ScopeMode,
  IncludeTestsMode,
  TaskScopeSnapshot,
  TaskConfig,
} from "../types.js";

export interface TaskScopeInput {
  scope_mode?: ScopeMode;
  include_tests?: IncludeTestsMode;
  repo_wide_confirmed?: boolean;
  editable_paths?: string[];
  readonly_paths?: string[];
  workspace_path: string;
  objective?: string;
}

export interface TaskScopeResult {
  ok: true;
  snapshot: TaskScopeSnapshot;
  effective_config: Pick<TaskConfig, "editable_paths" | "readonly_paths">;
}

export interface TaskScopeError {
  ok: false;
  error: string;
}

export type TaskScopeOutput = TaskScopeResult | TaskScopeError;

function normalizePath(p: string): string {
  return normalize(p).replace(/\\/g, "/");
}

function resolveWorkspacePath(workspacePath: string): string {
  try {
    return realpathSync(workspacePath);
  } catch {
    return normalize(resolve(workspacePath));
  }
}

function filterTestPaths(paths: string[]): string[] {
  const testPatterns = [
    /test/i,
    /spec/i,
    /__tests__/i,
    /\.test\.\w+$/i,
    /\.spec\.\w+$/i,
    /tests?\//i,
  ];
  return paths.filter((p) => testPatterns.some((pattern) => pattern.test(p)));
}

function inferTestPathsFromEditable(editPaths: string[]): string[] {
  const testPaths: string[] = [];
  for (const p of editPaths) {
    const normalized = normalizePath(p);
    if (normalized.includes("/src/")) {
      const testCandidate = normalized.replace(/\/src\//, "/tests/");
      testPaths.push(testCandidate);
    }
    if (normalized.endsWith(".ts") || normalized.endsWith(".tsx") || normalized.endsWith(".js") || normalized.endsWith(".jsx")) {
      const dir = normalized.replace(/\/[^/]+$/, "");
      const base = normalized.split("/").pop()!;
      const ext = base.match(/\.(ts|tsx|js|jsx)$/)?.[0] ?? "";
      const name = base.replace(/\.(ts|tsx|js|jsx)$/, "");
      testPaths.push(`${dir}/__tests__/${name}.test${ext}`);
    }
  }
  return [...new Set(testPaths)];
}

export function shouldAutoIncludeTests(objective: string): boolean {
  const nonTestKeywords = [
    /文档/i,
    /documentation/i,
    /调查/i,
    /research/i,
    /分析/i,
    /analysis/i,
    /调研/i,
    /readme/i,
    /changelog/i,
    /设计/i,
    /design/i,
    /报告/i,
    /report/i,
  ];
  return !nonTestKeywords.some((pattern) => pattern.test(objective));
}

export function computeTaskScope(input: TaskScopeInput): TaskScopeOutput {
  const mode: ScopeMode = input.scope_mode ?? "strict";
  const includeTests: IncludeTestsMode = input.include_tests ?? "auto";
  const repoWideConfirmed = input.repo_wide_confirmed ?? false;
  const requestedEditable = input.editable_paths ?? [];
  const requestedReadonly = input.readonly_paths ?? [];

  if (mode === "repo-wide" && !repoWideConfirmed) {
    return {
      ok: false,
      error: "repo-wide 模式需要显式确认，请设置 repo_wide_confirmed=true",
    };
  }

  const workspaceResolved = resolveWorkspacePath(input.workspace_path);

  const normalizedEditable = requestedEditable.map(normalizePath);
  const normalizedReadonly = requestedReadonly.map(normalizePath);

  for (const p of [...normalizedEditable, ...normalizedReadonly]) {
    if (p.includes("..")) {
      return { ok: false, error: `路径不允许包含 .. : ${p}` };
    }
    const fullPath = resolve(input.workspace_path, p);
    let resolved: string;
    try {
      resolved = realpathSync(fullPath);
    } catch {
      resolved = normalize(resolve(fullPath));
    }
    const rel = relative(workspaceResolved, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return { ok: false, error: `路径超出工作区范围: ${p}` };
    }
  }

  let effectiveEditable = [...normalizedEditable];
  let effectiveReadonly = [...normalizedReadonly];
  let snapshotEditable = [...normalizedEditable];
  let snapshotReadonly = [...normalizedReadonly];

  if (mode === "repo-wide") {
    snapshotEditable = ["**"];
    snapshotReadonly = [];
    effectiveEditable = [];
    effectiveReadonly = [];
  }

  if (includeTests === "always") {
    const testPaths = inferTestPathsFromEditable(effectiveEditable);
    effectiveEditable = [...new Set([...effectiveEditable, ...testPaths])];
    snapshotEditable = [...new Set([...snapshotEditable, ...testPaths])];
  } else if (includeTests === "auto") {
    if (shouldAutoIncludeTests(input.objective ?? "")) {
      const testPaths = inferTestPathsFromEditable(effectiveEditable);
      effectiveEditable = [...new Set([...effectiveEditable, ...testPaths])];
      snapshotEditable = [...new Set([...snapshotEditable, ...testPaths])];
    }
  }

  const snapshot: TaskScopeSnapshot = {
    mode,
    source: requestedEditable.length > 0 ? "user" : "auto",
    workspace_path: input.workspace_path,
    effective_editable_paths: snapshotEditable,
    effective_readonly_paths: snapshotReadonly,
    requested_editable_paths: normalizedEditable,
    requested_readonly_paths: normalizedReadonly,
    include_tests: includeTests,
    repo_wide_confirmed: repoWideConfirmed,
    generated_at: new Date().toISOString(),
  };

  return {
    ok: true,
    snapshot,
    effective_config: {
      editable_paths: effectiveEditable,
      readonly_paths: effectiveReadonly,
    },
  };
}

export function isPathInsideScope(
  filePath: string,
  effectiveEditablePaths: string[],
  workspacePath: string
): boolean {
  if (effectiveEditablePaths.includes("**")) {
    return true;
  }

  const normalizedFile = normalizePath(filePath);
  const normalizedWorkspace = normalizePath(workspacePath);

  for (const scopePath of effectiveEditablePaths) {
    const normalizedScope = normalizePath(scopePath);

    if (normalizedFile === normalizedScope) return true;

    if (normalizedFile.startsWith(normalizedScope + "/")) return true;

    if (normalizedScope.includes("*")) {
      const regex = new RegExp(
        "^" +
          normalizedScope
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, "___GLOBSTAR___")
            .replace(/\*/g, "[^/]*")
            .replace(/___GLOBSTAR___/g, ".*") +
          "$"
      );
      if (regex.test(normalizedFile)) return true;
    }
  }

  return false;
}

export function checkScopeCompliance(
  changedFiles: string[],
  effectiveEditablePaths: string[],
  workspacePath: string
): { inside: string[]; outside: string[]; hasOutOfScope: boolean } {
  if (effectiveEditablePaths.length === 0) {
    return {
      inside: [...changedFiles],
      outside: [],
      hasOutOfScope: false,
    };
  }

  const inside: string[] = [];
  const outside: string[] = [];

  for (const file of changedFiles) {
    if (isPathInsideScope(file, effectiveEditablePaths, workspacePath)) {
      inside.push(file);
    } else {
      outside.push(file);
    }
  }

  return {
    inside,
    outside,
    hasOutOfScope: outside.length > 0,
  };
}

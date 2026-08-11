import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskState, TaskConfig, TaskStatus, WorktreeState, ReviewPackage, TaskCreateOptions, TaskErrorDetail, TaskQueueState } from "../types.js";

const TASK_ID_PATTERN = /^task_[a-f0-9]{12}$/;

interface TombstoneEntry {
  task_id: string;
  session_id: string | null;
  deleted_at: string;
}

interface TombstoneFile {
  version: 1;
  sessions: TombstoneEntry[];
}

const MAX_TOMBSTONES = 1000;

export class TaskStore {
  private tasksDir: string;
  private briefsDir: string;
  private logsDir: string;
  private runtimeDir: string;
  private idempotencyIndex = new Map<string, { taskId: string; requestFingerprint: string }>();

  constructor(runtimeDir: string) {
    this.runtimeDir = resolve(runtimeDir);
    this.tasksDir = resolve(runtimeDir, "tasks");
    this.briefsDir = resolve(runtimeDir, "briefs");
    this.logsDir = resolve(runtimeDir, "logs");

    this.ensureDir(this.tasksDir);
    this.ensureDir(this.briefsDir);
    this.ensureDir(this.logsDir);
    this.rebuildIdempotencyIndex();
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private validateTaskId(taskId: string): boolean {
    return TASK_ID_PATTERN.test(taskId);
  }

  private getTaskFilePath(taskId: string): string | null {
    if (!this.validateTaskId(taskId)) {
      return null;
    }
    const filePath = resolve(this.tasksDir, `${taskId}.json`);
    const normalizedTasksDir = normalize(this.tasksDir) + (this.tasksDir.endsWith("/") || this.tasksDir.endsWith("\\") ? "" : "/");
    if (!filePath.startsWith(normalizedTasksDir) && !filePath.startsWith(normalize(this.tasksDir))) {
      return null;
    }
    return filePath;
  }

  createTask(config: TaskConfig, options: TaskCreateOptions = {}): TaskState {
    const taskId = `task_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const now = new Date().toISOString();

    const task: TaskState = {
      task_id: taskId,
      status: options.status ?? "queued",
      request_id: options.request_id,
      queue_state: options.queue_state ?? "none",
      phase_started_at: now,
      idempotency_key_hash: options.idempotency_key_hash,
      request_fingerprint: options.request_fingerprint,
      agent: options.agent ?? "mimo",
      session_id: options.session_id ?? null,
      agent_session_path: null,
      config,
      current_round: 1,
      created_at: now,
      updated_at: now,
      summary: "",
      modified_files: [],
      test_results: "",
      questions: [],
      issues: [],
      raw_log_path: "",
      stderr_log_path: "",
      error: null,
      error_detail: null,
      exit_code: null,
      worktree: null,
      review_package: null,
    };

    this.saveTask(task);
    return task;
  }

  getTask(taskId: string): TaskState | null {
    const filePath = this.getTaskFilePath(taskId);
    if (!filePath) return null;

    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const data = readFileSync(filePath, "utf-8");
      return JSON.parse(data) as TaskState;
    } catch {
      return null;
    }
  }

  saveTask(task: TaskState): void {
    const filePath = this.getTaskFilePath(task.task_id);
    if (!filePath) {
      throw new Error(`Invalid task_id: ${task.task_id}`);
    }

    const tmpPath = `${filePath}.tmp`;

    task.updated_at = new Date().toISOString();

    const content = JSON.stringify(task, null, 2);

    writeFileSync(tmpPath, content, "utf-8");

    try {
      renameSync(tmpPath, filePath);
    } catch {
      try {
        writeFileSync(filePath, content, "utf-8");
      } finally {
        try {
          if (existsSync(tmpPath)) {
            unlinkSync(tmpPath);
          }
        } catch {
          // ignore cleanup errors
        }
      }
    }
    if (task.idempotency_key_hash && task.request_fingerprint) {
      this.idempotencyIndex.set(task.idempotency_key_hash, {
        taskId: task.task_id,
        requestFingerprint: task.request_fingerprint,
      });
    }
  }

  updateTaskStatus(taskId: string, status: TaskStatus, error?: string, errorDetail?: TaskErrorDetail): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.status = status;
    task.phase_started_at = new Date().toISOString();
    if (["accepted", "failed", "cancelled", "abandoned", "review", "waiting"].includes(status)) {
      task.queue_state = "none";
    }
    if (error) {
      task.error = error;
    }
    if (errorDetail) task.error_detail = errorDetail;
    this.saveTask(task);
    return task;
  }

  updateTaskQueueState(taskId: string, queueState: TaskQueueState): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    task.queue_state = queueState;
    this.saveTask(task);
    return task;
  }

  updateTaskSession(taskId: string, sessionId: string): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.session_id = sessionId;
    task.current_round += 1;
    this.saveTask(task);
    return task;
  }

  findByIdempotencyHash(hash: string): TaskState | null {
    const indexed = this.idempotencyIndex.get(hash);
    return indexed ? this.getTask(indexed.taskId) : null;
  }

  reconcileInterruptedTasks(): number {
    let updated = 0;
    for (const task of this.listTasks(Number.MAX_SAFE_INTEGER)) {
      if (!["queued", "preparing_worktree", "starting_agent", "running"].includes(task.status)) continue;
      const requestId = task.request_id ?? `req_recovered_${task.task_id.slice(5)}`;
      const message = "守护进程在任务执行期间重启";
      this.updateTaskStatus(task.task_id, "failed", message, {
        code: "DAEMON_RESTARTED",
        message,
        phase: "daemon",
        request_id: requestId,
        occurred_at: new Date().toISOString(),
        retryable: false,
      });
      updated++;
    }
    return updated;
  }

  updateTaskAgentSession(taskId: string, sessionPath: string): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.agent_session_path = sessionPath;
    task.current_round += 1;
    this.saveTask(task);
    return task;
  }

  updateTaskResult(taskId: string, result: Partial<TaskState>): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    if (result.summary !== undefined) task.summary = result.summary;
    if (result.agent_session_path !== undefined) task.agent_session_path = result.agent_session_path;
    if (result.modified_files !== undefined) task.modified_files = result.modified_files;
    if (result.test_results !== undefined) task.test_results = result.test_results;
    if (result.questions !== undefined) task.questions = result.questions;
    if (result.issues !== undefined) task.issues = result.issues;
    if (result.raw_log_path !== undefined) task.raw_log_path = result.raw_log_path;
    if (result.stderr_log_path !== undefined) task.stderr_log_path = result.stderr_log_path;
    if (result.error !== undefined) task.error = result.error;
    if (result.exit_code !== undefined) task.exit_code = result.exit_code;

    this.saveTask(task);
    return task;
  }

  updateTaskWorktree(taskId: string, worktree: WorktreeState | null): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.worktree = worktree;
    this.saveTask(task);
    return task;
  }

  updateReviewPackage(taskId: string, reviewPackage: ReviewPackage): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.review_package = reviewPackage;
    this.saveTask(task);
    return task;
  }

  clearTaskWorktree(taskId: string): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.worktree = null;
    this.saveTask(task);
    return task;
  }

  listTasks(limit: number = 20): TaskState[] {
    try {
      const files = readdirSync(this.tasksDir)
        .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
        .sort()
        .reverse()
        .slice(0, limit);

      return files
        .map((f) => {
          try {
            const data = readFileSync(join(this.tasksDir, f), "utf-8");
            return JSON.parse(data) as TaskState;
          } catch {
            return null;
          }
        })
        .filter((t): t is TaskState => t !== null);
    } catch {
      return [];
    }
  }

  deleteTask(taskId: string): boolean {
    const taskFilePath = this.getTaskFilePath(taskId);
    if (!taskFilePath || !existsSync(taskFilePath)) {
      return false;
    }

    const task = this.getTask(taskId);

    const roundPrefix = `${taskId}-round-`;
    for (const file of readdirSync(this.briefsDir)) {
      if (file.startsWith(roundPrefix) && file.endsWith(".md")) {
        unlinkSync(join(this.briefsDir, file));
      }
    }
    for (const file of readdirSync(this.logsDir)) {
      if (file.startsWith(roundPrefix) && (file.endsWith(".jsonl") || file.endsWith(".stderr.log"))) {
        unlinkSync(join(this.logsDir, file));
      }
    }

    const tmpPath = `${taskFilePath}.tmp`;
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
    unlinkSync(taskFilePath);

    if (task?.idempotency_key_hash) {
      this.idempotencyIndex.delete(task.idempotency_key_hash);
    }

    if (task) {
      this.recordTombstone(task.task_id, task.session_id);
    }

    return true;
  }

  private rebuildIdempotencyIndex(): void {
    this.idempotencyIndex.clear();
    for (const task of this.listTasks(Number.MAX_SAFE_INTEGER).reverse()) {
      if (task.idempotency_key_hash && task.request_fingerprint) {
        this.idempotencyIndex.set(task.idempotency_key_hash, {
          taskId: task.task_id,
          requestFingerprint: task.request_fingerprint,
        });
      }
    }
  }

  private recordTombstone(taskId: string, sessionId: string | null): void {
    const tombstonePath = join(this.runtimeDir, "deleted-mimo-sessions.json");
    let tombstoneFile: TombstoneFile = { version: 1, sessions: [] };

    if (existsSync(tombstonePath)) {
      try {
        tombstoneFile = JSON.parse(readFileSync(tombstonePath, "utf-8")) as TombstoneFile;
      } catch {
        tombstoneFile = { version: 1, sessions: [] };
      }
    }

    tombstoneFile.sessions = tombstoneFile.sessions.filter((s) => s.task_id !== taskId);
    tombstoneFile.sessions.push({
      task_id: taskId,
      session_id: sessionId,
      deleted_at: new Date().toISOString(),
    });

    if (tombstoneFile.sessions.length > MAX_TOMBSTONES) {
      tombstoneFile.sessions = tombstoneFile.sessions.slice(-MAX_TOMBSTONES);
    }

    const tmpPath = `${tombstonePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(tombstoneFile, null, 2), "utf-8");
    try {
      renameSync(tmpPath, tombstonePath);
    } catch {
      try {
        writeFileSync(tombstonePath, JSON.stringify(tombstoneFile, null, 2), "utf-8");
      } finally {
        try {
          if (existsSync(tmpPath)) {
            unlinkSync(tmpPath);
          }
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  getBriefPath(taskId: string, round: number): string {
    return join(this.briefsDir, `${taskId}-round-${round}.md`);
  }

  getLogPath(taskId: string, round: number): string {
    return join(this.logsDir, `${taskId}-round-${round}.jsonl`);
  }

  getStderrLogPath(taskId: string, round: number): string {
    return join(this.logsDir, `${taskId}-round-${round}.stderr.log`);
  }
}

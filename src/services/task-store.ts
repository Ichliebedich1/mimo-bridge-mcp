import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskState, TaskConfig, TaskStatus } from "../types.js";

const TASK_ID_PATTERN = /^task_[a-f0-9]{12}$/;

export class TaskStore {
  private tasksDir: string;
  private briefsDir: string;
  private logsDir: string;

  constructor(runtimeDir: string) {
    this.tasksDir = resolve(runtimeDir, "tasks");
    this.briefsDir = resolve(runtimeDir, "briefs");
    this.logsDir = resolve(runtimeDir, "logs");

    this.ensureDir(this.tasksDir);
    this.ensureDir(this.briefsDir);
    this.ensureDir(this.logsDir);
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

  createTask(config: TaskConfig): TaskState {
    const taskId = `task_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const now = new Date().toISOString();

    const task: TaskState = {
      task_id: taskId,
      status: "queued",
      agent: "mimo",
      session_id: null,
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
  }

  updateTaskStatus(taskId: string, status: TaskStatus, error?: string): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.status = status;
    if (error) {
      task.error = error;
    }
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

  updateTaskResult(taskId: string, result: Partial<TaskState>): TaskState | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    if (result.summary !== undefined) task.summary = result.summary;
    if (result.modified_files !== undefined) task.modified_files = result.modified_files;
    if (result.test_results !== undefined) task.test_results = result.test_results;
    if (result.questions !== undefined) task.questions = result.questions;
    if (result.issues !== undefined) task.issues = result.issues;
    if (result.raw_log_path !== undefined) task.raw_log_path = result.raw_log_path;
    if (result.error !== undefined) task.error = result.error;

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

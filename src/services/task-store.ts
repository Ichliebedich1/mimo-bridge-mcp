import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskState, TaskConfig, TaskStatus } from "../types.js";

export class TaskStore {
  private tasksDir: string;
  private briefsDir: string;
  private logsDir: string;

  constructor(runtimeDir: string) {
    this.tasksDir = join(runtimeDir, "tasks");
    this.briefsDir = join(runtimeDir, "briefs");
    this.logsDir = join(runtimeDir, "logs");

    this.ensureDir(this.tasksDir);
    this.ensureDir(this.briefsDir);
    this.ensureDir(this.logsDir);
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
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
      current_round: 0,
      created_at: now,
      updated_at: now,
      summary: "",
      modified_files: [],
      test_results: "",
      questions: [],
      issues: [],
      raw_log_path: "",
      error: null,
    };

    this.saveTask(task);
    return task;
  }

  getTask(taskId: string): TaskState | null {
    const filePath = join(this.tasksDir, `${taskId}.json`);
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
    const filePath = join(this.tasksDir, `${task.task_id}.json`);
    const tmpPath = `${filePath}.tmp`;

    task.updated_at = new Date().toISOString();

    writeFileSync(tmpPath, JSON.stringify(task, null, 2), "utf-8");
    writeFileSync(filePath, JSON.stringify(task, null, 2), "utf-8");

    try {
      const { unlinkSync } = require("node:fs");
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
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

    this.saveTask(task);
    return task;
  }

  listTasks(limit: number = 20): TaskState[] {
    try {
      const files = readdirSync(this.tasksDir)
        .filter((f) => f.endsWith(".json"))
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

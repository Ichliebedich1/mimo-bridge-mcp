export interface QueuedTask {
  taskId: string;
  agentId?: string;
  workspacePath?: string;
  editablePaths?: string[];
  priority: number;
  enqueuedAt: number;
  execute: () => Promise<void>;
  cancel: () => void;
}

export class TaskQueue {
  private queue: QueuedTask[] = [];
  private runningTasks: QueuedTask[] = [];
  private maxConcurrent: number;
  private runningCount: number = 0;

  constructor(maxConcurrent: number = 1) {
    this.maxConcurrent = maxConcurrent;
  }

  get size(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.runningCount;
  }

  get isIdle(): boolean {
    return this.runningCount === 0 && this.queue.length === 0;
  }

  enqueue(task: QueuedTask): boolean {
    const startsImmediately = this.canStart(task) && !this.hasEarlierRunnableBlocker(task);
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.processNext();
    return startsImmediately;
  }

  hasQueued(taskId: string): boolean {
    return this.queue.some((task) => task.taskId === taskId);
  }

  cancel(taskId: string): boolean {
    const index = this.queue.findIndex((t) => t.taskId === taskId);
    if (index >= 0) {
      const task = this.queue[index];
      task.cancel();
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const task of this.queue) {
      task.cancel();
    }
    this.queue = [];
  }

  getQueuedTasks(): Array<{ taskId: string; agentId?: string; priority: number; enqueuedAt: number }> {
    return this.queue.map((t) => ({
      taskId: t.taskId,
      agentId: t.agentId,
      priority: t.priority,
      enqueuedAt: t.enqueuedAt,
    }));
  }

  onTaskComplete(taskId: string): void {
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.runningTasks = this.runningTasks.filter((task) => task.taskId !== taskId);
    this.processNext();
  }

  private processNext(): void {
    while (this.runningCount < this.maxConcurrent && this.queue.length > 0) {
      const index = this.queue.findIndex((task) => this.canStart(task));
      if (index < 0) {
        return;
      }

      const [task] = this.queue.splice(index, 1);
      this.runningCount++;
      this.runningTasks.push(task);

      let execution: Promise<void>;
      try {
        execution = task.execute();
      } catch {
        this.onTaskComplete(task.taskId);
        continue;
      }

      void execution
        .catch(() => undefined)
        .finally(() => {
          this.onTaskComplete(task.taskId);
        });
    }
  }

  private canStart(task: QueuedTask): boolean {
    if (this.runningCount >= this.maxConcurrent) {
      return false;
    }
    return !this.runningTasks.some((running) => tasksConflict(running, task));
  }

  private hasEarlierRunnableBlocker(task: QueuedTask): boolean {
    if (this.queue.length === 0) {
      return false;
    }
    return this.queue.some((queued) => this.canStart(queued) && queued.priority >= task.priority);
  }
}

export function tasksConflict(a: QueuedTask, b: QueuedTask): boolean {
  if (a.taskId === b.taskId) {
    return true;
  }
  if (!a.agentId || !b.agentId) {
    return true;
  }
  if (a.agentId && b.agentId && a.agentId === b.agentId) {
    return true;
  }
  if (!a.workspacePath || !b.workspacePath) {
    return true;
  }
  if (normalizePath(a.workspacePath) !== normalizePath(b.workspacePath)) {
    return false;
  }

  const aPaths = normalizeEditablePaths(a.editablePaths);
  const bPaths = normalizeEditablePaths(b.editablePaths);
  if (aPaths.length === 0 || bPaths.length === 0) {
    return true;
  }
  return aPaths.some((left) => bPaths.some((right) => pathsOverlap(left, right)));
}

function normalizeEditablePaths(paths: string[] | undefined): string[] {
  return (paths ?? []).map(normalizePath).filter(Boolean);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
}

function pathsOverlap(left: string, right: string): boolean {
  if (left === "**" || right === "**") {
    return true;
  }
  return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
}

export const globalTaskQueue = new TaskQueue(2);

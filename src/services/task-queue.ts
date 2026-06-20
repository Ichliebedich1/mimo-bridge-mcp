export interface QueuedTask {
  taskId: string;
  priority: number;
  enqueuedAt: number;
  execute: () => Promise<void>;
  cancel: () => void;
}

export class TaskQueue {
  private queue: QueuedTask[] = [];
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
    const startsImmediately = this.runningCount < this.maxConcurrent && this.queue.length === 0;
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

  getQueuedTasks(): Array<{ taskId: string; priority: number; enqueuedAt: number }> {
    return this.queue.map((t) => ({
      taskId: t.taskId,
      priority: t.priority,
      enqueuedAt: t.enqueuedAt,
    }));
  }

  onTaskComplete(taskId: string): void {
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.processNext();
  }

  private processNext(): void {
    if (this.runningCount >= this.maxConcurrent) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift()!;
    this.runningCount++;

    let execution: Promise<void>;
    try {
      execution = task.execute();
    } catch {
      this.onTaskComplete(task.taskId);
      return;
    }

    void execution
      .catch(() => undefined)
      .finally(() => {
        this.onTaskComplete(task.taskId);
      });
  }
}

export const globalTaskQueue = new TaskQueue(1);

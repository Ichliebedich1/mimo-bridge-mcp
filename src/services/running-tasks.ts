import type { ChildProcess } from "node:child_process";

export interface RunningTask {
  taskId: string;
  cancel: () => void;
}

export class RunningTaskRegistry {
  private tasks = new Map<string, RunningTask>();

  get size(): number {
    return this.tasks.size;
  }

  has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }

  hasAny(): boolean {
    return this.tasks.size > 0;
  }

  register(taskId: string, cancel: () => void): void {
    this.tasks.set(taskId, { taskId, cancel });
  }

  unregister(taskId: string): void {
    this.tasks.delete(taskId);
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task) {
      task.cancel();
      this.tasks.delete(taskId);
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) {
      task.cancel();
    }
    this.tasks.clear();
  }
}

export const globalRunningTasks = new RunningTaskRegistry();

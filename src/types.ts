export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "review"
  | "accepted"
  | "failed"
  | "cancelled"
  | "abandoned";

export interface TaskConfig {
  objective: string;
  workspace_path: string;
  editable_paths: string[];
  readonly_paths: string[];
  acceptance_criteria: string[];
  max_rounds: number;
  runtime_timeout_seconds: number;
}

export interface WorktreeState {
  repo_path: string;
  worktrees_root: string;
  worktree_path: string;
  branch_name: string;
  base_commit: string;
  base_branch: string;
  diff_summary: string | null;
  out_of_bounds_files: string[];
  has_out_of_bounds_changes: boolean;
}

export interface TaskState {
  task_id: string;
  status: TaskStatus;
  agent: string;
  session_id: string | null;
  config: TaskConfig;
  current_round: number;
  created_at: string;
  updated_at: string;
  summary: string;
  modified_files: string[];
  test_results: string;
  questions: string[];
  issues: string[];
  raw_log_path: string;
  stderr_log_path: string;
  error: string | null;
  worktree: WorktreeState | null;
}

export interface MimoEvent {
  type: string;
  timestamp: number;
  sessionID?: string;
  part?: {
    id: string;
    messageID: string;
    sessionID: string;
    type: string;
    text?: string;
    reason?: string;
    tokens?: {
      total: number;
      input: number;
      output: number;
      reasoning: number;
      cache: {
        write: number;
        read: number;
      };
    };
    cost?: number;
  };
}

export interface TaskResult {
  task_id: string;
  agent: string;
  session_id: string | null;
  status: TaskStatus;
  summary: string;
  modified_files: string[];
  test_results: string;
  questions: string[];
  issues: string[];
  raw_log_path: string;
  stderr_log_path: string;
  error: string | null;
}

export interface StartTaskInput {
  objective: string;
  workspace_path: string;
  editable_paths?: string[];
  readonly_paths?: string[];
  acceptance_criteria?: string[];
  max_rounds?: number;
  runtime_timeout_seconds?: number;
}

export interface GetTaskInput {
  task_id: string;
}

export interface ReplyTaskInput {
  task_id: string;
  message: string;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "review"
  | "accepted"
  | "failed"
  | "cancelled"
  | "abandoned";

export type ScopeMode = "strict" | "suggested" | "repo-wide";
export type IncludeTestsMode = "auto" | "always" | "never";

export interface TaskScopeSnapshot {
  mode: ScopeMode;
  source: "user" | "auto";
  workspace_path: string;
  effective_editable_paths: string[];
  effective_readonly_paths: string[];
  requested_editable_paths: string[];
  requested_readonly_paths: string[];
  include_tests: IncludeTestsMode;
  repo_wide_confirmed: boolean;
  generated_at: string;
}

export interface TaskConfig {
  objective: string;
  workspace_path: string;
  editable_paths: string[];
  readonly_paths: string[];
  acceptance_criteria: string[];
  max_rounds: number;
  runtime_timeout_seconds: number;
  scope?: TaskScopeSnapshot;
  origin_codex_thread_id?: string;
  origin_codex_thread_url?: string;
  origin_source?: string;
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

export interface ChangedLinesSummary {
  path: string;
  additions: number | null;
  deletions: number | null;
}

export interface OutOfBoundsReport {
  has_changes: boolean;
  files: string[];
}

export type ReviewRecommendation = "approve" | "needs_attention" | "reject" | "wait";

export interface ScopeReport {
  mode: ScopeMode;
  source: "user" | "auto";
  effective_editable_paths: string[];
  effective_readonly_paths: string[];
  changed_files_inside_scope: string[];
  changed_files_outside_scope: string[];
  has_out_of_scope_changes: boolean;
  repo_wide_confirmed: boolean;
}

export interface ReviewPackage {
  task_id: string;
  status: TaskStatus;
  objective: string;
  objective_zh?: string;
  editable_paths: string[];
  changed_files: string[];
  changed_files_count: number;
  diff_stat: string;
  changed_lines_summary: ChangedLinesSummary[];
  out_of_bounds_report: OutOfBoundsReport;
  scope_report?: ScopeReport;
  test_commands: string[];
  test_result: string;
  exit_code: number | null;
  log_tail: string;
  mimo_summary: string;
  mimo_summary_zh?: string;
  risk_flags: string[];
  generated_at: string;
  review_recommendation: ReviewRecommendation;
  truncated: boolean;
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
  exit_code: number | null;
  worktree: WorktreeState | null;
  review_package: ReviewPackage | null;
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
  exit_code?: number | null;
}

export interface StartTaskInput {
  objective: string;
  workspace_path: string;
  editable_paths?: string[];
  readonly_paths?: string[];
  acceptance_criteria?: string[];
  max_rounds?: number;
  runtime_timeout_seconds?: number;
  scope_mode?: ScopeMode;
  include_tests?: IncludeTestsMode;
  repo_wide_confirmed?: boolean;
  origin_codex_thread_id?: string;
  origin_codex_thread_url?: string;
  origin_source?: string;
}

export interface GetTaskInput {
  task_id: string;
}

export interface ReplyTaskInput {
  task_id: string;
  message: string;
}

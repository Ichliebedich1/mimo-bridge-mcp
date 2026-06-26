export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'review'
  | 'accepted'
  | 'failed'
  | 'cancelled'
  | 'abandoned';

export type ScopeMode = 'strict' | 'suggested' | 'repo-wide';
export type IncludeTestsMode = 'auto' | 'always' | 'never';
export type TaskScenario = 'multimodal' | 'simple' | 'normal' | 'complex' | 'high_risk';
export type RoutingMode = 'auto' | 'manual';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export type RoutingAgentId = 'mimo' | 'reasonix-tui';

export type RoutingSelection = {
  agent_id: RoutingAgentId;
  model: string;
  reasoning_effort: ReasoningEffort;
};

export type RoutingProfiles = {
  default_scenario: TaskScenario;
  scenarios: Record<TaskScenario, {
    description: string;
    supports_multimodal: boolean;
    recommended: Record<RoutingAgentId, { model: string; reasoning_effort: ReasoningEffort; reason: string }>;
    current: RoutingSelection;
  }>;
  allowed_models: Record<RoutingAgentId, string[]>;
  reasoning_efforts: ReasoningEffort[];
  enable_mimo_pro_ultra_speed?: boolean;
  pricing_per_1m_cny: {
    flash: { input: number; output: number; cache_hit: number };
    pro: { input: number; output: number; cache_hit: number };
    ultra_speed?: { input: number; output: number; cache_hit: number };
  };
};

export type CreateTaskAttachment = {
  name: string;
  mime_type: string;
  size_bytes: number;
  base64: string;
  kind: 'image' | 'file';
};

export type RiskFlag =
  | 'OUT_OF_BOUNDS_CHANGES'
  | 'OUT_OF_SCOPE_CHANGES'
  | 'TESTS_FAILED'
  | 'TASK_FAILED'
  | 'NON_ZERO_EXIT'
  | 'REVIEW_DATA_UNAVAILABLE'
  | 'TASK_ERROR'
  | 'ISSUES_REPORTED';

export type ChangedFile = {
  path: string;
  additions: number;
  deletions: number;
  risk?: RiskFlag;
  note: string;
};

export type Task = {
  id: string;
  agent: string;
  status: TaskStatus;
  title: string;
  summary: string;
  objective: string;
  createdAt?: string;
  updatedAt: string;
  round: number;
  priority: number;
  riskFlags: RiskFlag[];
  changedFiles: ChangedFile[];
  diffStat: string;
  testResult: 'passed' | 'failed' | 'not_run' | 'unknown';
  recommendation: string;
  workspaceLabel: string;
  hasWorktree: boolean;
  canReply: boolean;
  replyBlockers: string[];
  replyLabel: string;
  canDelete: boolean;
  deleteBlockers: string[];
  deleteLabel: string;
  source?: 'mock' | 'api';
  originCodexThreadId?: string | null;
  originCodexThreadUrl?: string | null;
  originSource?: string | null;
};

export type QueueItem = {
  taskId: string;
  title: string;
  status: 'running' | 'queued';
  position?: number;
  startedAt?: string;
  note: string;
};

export type CreateTaskInput = {
  agent_id: string;
  objective: string;
  workspace_path: string;
  editable_paths: string[];
  readonly_paths: string[];
  acceptance_criteria: string[];
  max_rounds: number;
  runtime_timeout_seconds: number;
  use_worktree: boolean;
  priority: number;
  scope_mode: ScopeMode;
  include_tests: IncludeTestsMode;
  repo_wide_confirmed: boolean;
  routing_mode?: RoutingMode;
  task_scenario?: TaskScenario;
  model?: string;
  reasoning_effort?: ReasoningEffort;
  has_images?: boolean;
  attachments?: CreateTaskAttachment[];
};

export type TaskActionResult = {
  task_id?: string;
  status?: string;
  action?: string;
  message?: string;
  opened?: boolean;
  target_kind?: string;
  target_name?: string;
  queue_position?: number;
  [key: string]: unknown;
};

export type FocusedTaskResult = {
  taskId: string;
  filePath: string;
  diff?: string;
  diffTruncated?: boolean;
  diffTotalChars?: number;
  files: Array<{
    path: string;
    content: string;
    returnedChars: number;
    totalChars: number;
    truncated: boolean;
  }>;
};

export type TaskLogsResult = {
  taskId: string;
  stdout: string;
  stderr: string;
  returnedChars?: number;
  lineCount: number;
};

export type FullTaskResult = {
  taskId: string;
  diff?: string;
  logs?: {
    stdout?: string;
    stderr?: string;
  };
  returnedChars?: number;
  maxChars?: number;
  truncated?: boolean;
  raw: unknown;
};

export type LiveEvent = {
  timestamp: string;
  event_type: string;
  kind: 'message' | 'tool' | 'event';
  tool?: string;
  status?: string;
  summary: string;
};

export type LiveTaskView = {
  task_id: string;
  status: TaskStatus;
  current_round: number;
  updated_at: string;
  is_live: boolean;
  events: LiveEvent[];
  truncated: boolean;
};

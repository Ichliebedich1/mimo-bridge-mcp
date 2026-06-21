import type {
  CreateTaskInput,
  FocusedTaskResult,
  FullTaskResult,
  LiveTaskView,
  RiskFlag,
  Task,
  TaskActionResult,
  TaskLogsResult,
  TaskStatus,
} from './types';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown };

export type HealthResponse = {
  daemon: {
    status: string;
    host?: string;
    port?: number;
    degraded: boolean;
    config_error: string | null;
  };
  mcp: {
    transport: string;
    endpoint: string;
    status: string;
  };
  mimo: {
    status: string;
    version: unknown;
  };
  queue: QueueStatusResponse;
  security: {
    localhost_only: boolean;
    arbitrary_tool_proxy: boolean;
    raw_paths_exposed: boolean;
  };
};

export type QueueStatusResponse = {
  running: number;
  queued: number;
  queue: Array<{ taskId: string; priority: number; enqueuedAt: number }>;
};

type ListTasksResponse = {
  tasks: Array<{
    task_id: string;
    status: TaskStatus;
    summary?: string;
    modified_files?: string[];
    test_results?: string;
    questions?: string[];
    issues?: string[];
    error?: string | null;
    exit_code?: number | null;
    created_at?: string;
    updated_at?: string;
    objective?: string;
    has_worktree?: boolean;
    current_round?: number;
    priority?: number;
  }>;
};

type ReviewPackageResponse = {
  task_id: string;
  status: TaskStatus;
  objective: string;
  editable_paths?: string[];
  changed_files: string[];
  changed_files_count: number;
  diff_stat: string;
  changed_lines_summary: Array<{ path: string; additions: number | null; deletions: number | null }>;
  out_of_bounds_report: { has_changes: boolean; files: string[] };
  test_result: string;
  exit_code: number | null;
  log_tail?: string;
  mimo_summary: string;
  risk_flags: string[];
  generated_at?: string;
  review_recommendation: string;
  truncated: boolean;
};

type GetTaskResponse = {
  task_id: string;
  detail_level?: 'summary' | 'review' | 'diff' | 'focused' | 'logs' | 'full';
  status: TaskStatus;
  created_at?: string;
  updated_at?: string;
  current_round?: number;
  has_worktree?: boolean;
  review_package?: ReviewPackageResponse;
  summary?: string;
  completed?: boolean;
  diff?: string;
  diff_meta?: {
    content?: string;
    total_chars?: number;
    returned_chars?: number;
    truncated?: boolean;
  };
  diff_truncated?: boolean;
  diff_total_chars?: number;
  total_chars?: number;
  returned_chars?: number;
  truncated?: boolean;
  max_chars?: number;
  log_tail_lines?: number;
  logs?: { stdout?: string; stderr?: string };
  files?: Array<{
    path: string;
    content?: string;
    text?: string;
    returned_chars?: number;
    total_chars?: number;
    truncated?: boolean;
    error?: string;
  }>;
  task?: unknown;
};

type TokenStatusResponse = unknown;

export async function fetchHealth(): Promise<HealthResponse> {
  return unwrap(await getJson<HealthResponse>('/api/health'));
}

export async function fetchTasks(limit = 20): Promise<Task[]> {
  const response = unwrap(await getJson<ListTasksResponse>('/api/tasks?limit=' + encodeURIComponent(String(limit))));
  return response.tasks.map(toUiTask);
}

export async function fetchTask(taskId: string): Promise<Task> {
  const response = unwrap(
    await getJson<GetTaskResponse>('/api/tasks/' + encodeURIComponent(taskId) + '?detail_level=review&max_chars=8000'),
  );
  return detailToUiTask(response);
}

export async function fetchFocusedTask(taskId: string, filePath: string): Promise<FocusedTaskResult> {
  const params = new URLSearchParams({
    detail_level: 'focused',
    max_chars: '20000',
  });
  params.append('diff_paths', filePath);

  const response = unwrap(await getJson<GetTaskResponse>('/api/tasks/' + encodeURIComponent(taskId) + '?' + params));
  return {
    taskId: response.task_id,
    filePath,
    diff: response.diff,
    diffTruncated: Boolean(response.diff_truncated),
    diffTotalChars: response.diff_total_chars,
    files: (response.files ?? []).map((file) => ({
      path: file.path,
      content: file.content ?? file.text ?? file.error ?? '',
      returnedChars: file.returned_chars ?? 0,
      totalChars: file.total_chars ?? 0,
      truncated: Boolean(file.truncated),
    })),
  };
}

export async function fetchTaskDiff(taskId: string, filePath: string): Promise<FocusedTaskResult> {
  const params = new URLSearchParams({
    detail_level: 'diff',
    max_chars: '20000',
  });
  params.append('diff_paths', filePath);
  const response = unwrap(await getJson<GetTaskResponse>('/api/tasks/' + encodeURIComponent(taskId) + '?' + params));
  return {
    taskId: response.task_id,
    filePath,
    diff: response.diff,
    diffTruncated: Boolean(response.truncated),
    diffTotalChars: response.total_chars,
    files: [],
  };
}

export async function fetchTaskLogs(taskId: string, lineCount = 20): Promise<TaskLogsResult> {
  const params = new URLSearchParams({
    detail_level: 'logs',
    log_tail_lines: String(lineCount),
    max_chars: '8000',
  });
  const response = unwrap(await getJson<GetTaskResponse>('/api/tasks/' + encodeURIComponent(taskId) + '?' + params));
  return {
    taskId: response.task_id,
    stdout: response.logs?.stdout ?? '',
    stderr: response.logs?.stderr ?? '',
    returnedChars: response.returned_chars,
    lineCount: response.log_tail_lines ?? lineCount,
  };
}

export async function fetchFullTask(taskId: string): Promise<FullTaskResult> {
  const params = new URLSearchParams({
    detail_level: 'full',
    max_chars: '20000',
    log_tail_lines: '50',
  });
  const response = unwrap(await getJson<GetTaskResponse>('/api/tasks/' + encodeURIComponent(taskId) + '?' + params));
  return {
    taskId: response.task_id,
    diff: response.diff,
    logs: response.logs,
    returnedChars: response.returned_chars,
    maxChars: response.max_chars,
    truncated: response.truncated,
    raw: response,
  };
}

export async function fetchLiveTask(taskId: string, maxEvents = 40, maxChars = 8000): Promise<LiveTaskView> {
  const params = new URLSearchParams({
    max_events: String(maxEvents),
    max_chars: String(maxChars),
  });
  return unwrap(await getJson<LiveTaskView>('/api/tasks/' + encodeURIComponent(taskId) + '/live?' + params));
}

export async function fetchQueue(): Promise<QueueStatusResponse> {
  return unwrap(await getJson<QueueStatusResponse>('/api/queue'));
}

export async function fetchTokenBudget(): Promise<TokenStatusResponse> {
  return unwrap(await getJson<TokenStatusResponse>('/api/token-budget'));
}

export async function createTask(input: CreateTaskInput): Promise<TaskActionResult> {
  return unwrap(await postJson<TaskActionResult>('/api/tasks', input));
}

export async function replyTask(taskId: string, message: string, priority = 5): Promise<TaskActionResult> {
  return unwrap(await postJson<TaskActionResult>('/api/tasks/' + encodeURIComponent(taskId) + '/replies', { message, priority }));
}

export async function cancelTask(taskId: string): Promise<TaskActionResult> {
  return unwrap(await postJson<TaskActionResult>('/api/tasks/' + encodeURIComponent(taskId) + '/cancel', {}));
}

export async function deleteTask(taskId: string): Promise<TaskActionResult> {
  return unwrap(await deleteJson<TaskActionResult>('/api/tasks/' + encodeURIComponent(taskId)));
}

export async function finishTask(taskId: string, status: 'accepted' | 'abandoned'): Promise<TaskActionResult> {
  return unwrap(await postJson<TaskActionResult>('/api/tasks/' + encodeURIComponent(taskId) + '/finish', { status }));
}

export async function worktreeTask(taskId: string, action: 'merge' | 'discard'): Promise<TaskActionResult> {
  return unwrap(await postJson<TaskActionResult>('/api/tasks/' + encodeURIComponent(taskId) + '/worktree', { action }));
}

export async function resetTokenBudget(): Promise<TaskActionResult> {
  return unwrap(await postJson<TaskActionResult>('/api/token-budget/reset', {}));
}

async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
  });
  return parseApiResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return parseApiResponse<T>(response);
}

async function deleteJson<T>(path: string): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method: 'DELETE',
    headers: { accept: 'application/json' },
  });
  return parseApiResponse<T>(response);
}

async function parseApiResponse<T>(response: Response): Promise<ApiResult<T>> {
  let data: ApiResult<T>;
  try {
    data = (await response.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: 'API 返回的不是 JSON：HTTP ' + response.status };
  }

  if (!response.ok && data.ok) {
    return { ok: false, error: '请求失败：HTTP ' + response.status };
  }
  return data;
}

function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(formatApiError(result.error, result.details));
  }
  return result.data;
}

function formatApiError(error: string, details?: unknown): string {
  if (details === undefined) {
    return error;
  }
  if (Array.isArray(details)) {
    const issueText = details
      .map((issue) => {
        if (isRecord(issue)) {
          const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
          const message = typeof issue.message === 'string' ? issue.message : JSON.stringify(issue);
          return path ? path + ': ' + message : message;
        }
        return String(issue);
      })
      .join('；');
    return issueText ? error + '：' + issueText : error;
  }
  if (isRecord(details) && typeof details.error === 'string') {
    return error + '：' + details.error;
  }
  return error;
}

function toUiTask(task: ListTasksResponse['tasks'][number]): Task {
  const riskFlags = deriveRiskFlags(task);
  const objective = task.objective || firstLine(task.summary) || task.task_id;
  return {
    id: task.task_id,
    status: task.status,
    title: objective,
    summary: task.summary || task.error || '暂无摘要；打开详情页查看 Review Package。',
    objective,
    createdAt: formatDateTime(task.created_at),
    updatedAt: formatDateTime(task.updated_at) || '来自 API',
    round: task.current_round ?? 0,
    priority: task.priority ?? 5,
    riskFlags,
    changedFiles: (task.modified_files ?? []).map((path) => ({
      path,
      additions: 0,
      deletions: 0,
      note: '列表接口未提供行数；详情页可查看 Review Package。',
    })),
    diffStat: '列表接口未提供 diff stat',
    testResult: testResultFromText(task.test_results),
    recommendation: '打开详情后按低上下文协议审查。',
    workspaceLabel: '来自 API',
    hasWorktree: Boolean(task.has_worktree),
    source: 'api',
  };
}

function detailToUiTask(response: GetTaskResponse): Task {
  const review = response.review_package;
  if (!review) {
    return {
      id: response.task_id,
      status: response.status,
      title: response.task_id,
      summary: response.summary || '该任务暂未生成 Review Package。',
      objective: 'Review Package unavailable',
      createdAt: formatDateTime(response.created_at),
      updatedAt: '来自 API',
      round: response.current_round ?? 0,
      priority: 5,
      riskFlags: response.status === 'failed' ? ['TASK_FAILED'] : [],
      changedFiles: [],
      diffStat: '无',
      testResult: 'unknown',
      recommendation: '可稍后刷新，或查看任务状态。',
      workspaceLabel: '来自 API',
      hasWorktree: Boolean(response.has_worktree),
      source: 'api',
    };
  }

  const changedFileRows = review.changed_lines_summary.length > 0
    ? review.changed_lines_summary
    : review.changed_files.map((path) => ({ path, additions: 0, deletions: 0 }));

  return {
    id: response.task_id,
    status: response.status,
    title: review.objective || response.task_id,
    summary: review.mimo_summary || 'Review Package 已生成。',
    objective: review.objective,
    createdAt: formatDateTime(response.created_at),
    updatedAt: formatDateTime(response.updated_at) || formatDateTime(review.generated_at) || '来自 API',
    round: response.current_round ?? 0,
    priority: 5,
    riskFlags: sanitizeRiskFlags(review.risk_flags),
    changedFiles: changedFileRows.map((file) => ({
      path: file.path,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      risk: review.out_of_bounds_report.files.includes(file.path) ? 'OUT_OF_BOUNDS_CHANGES' : undefined,
      note: '来自 Review Package。',
    })),
    diffStat: review.diff_stat || String(review.changed_files_count) + ' files changed',
    testResult: testResultFromText(review.test_result),
    recommendation: recommendationLabel(review.review_recommendation),
    workspaceLabel: review.editable_paths?.length ? review.editable_paths.join('，') : '来自 API',
    hasWorktree: Boolean(response.has_worktree),
    source: 'api',
  };
}

function deriveRiskFlags(task: ListTasksResponse['tasks'][number]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (task.status === 'failed') {
    flags.push('TASK_FAILED');
  }
  if ((task.issues ?? []).length > 0) {
    flags.push('ISSUES_REPORTED');
  }
  if (task.error) {
    flags.push('TASK_ERROR');
  }
  if (typeof task.exit_code === 'number' && task.exit_code !== 0) {
    flags.push('NON_ZERO_EXIT');
  }
  return Array.from(new Set(flags));
}

function sanitizeRiskFlags(flags: string[]): RiskFlag[] {
  const known = new Set<RiskFlag>([
    'OUT_OF_BOUNDS_CHANGES',
    'TESTS_FAILED',
    'TASK_FAILED',
    'NON_ZERO_EXIT',
    'REVIEW_DATA_UNAVAILABLE',
    'TASK_ERROR',
    'ISSUES_REPORTED',
  ]);
  return flags.filter((flag): flag is RiskFlag => known.has(flag as RiskFlag));
}

function testResultFromText(text?: string): Task['testResult'] {
  if (!text) {
    return 'unknown';
  }
  const lower = text.toLowerCase();
  if (lower.includes('fail') || text.includes('失败')) {
    return 'failed';
  }
  if (lower.includes('pass') || text.includes('通过')) {
    return 'passed';
  }
  if (lower.includes('not run') || text.includes('未运行')) {
    return 'not_run';
  }
  return 'unknown';
}

function recommendationLabel(value: string): string {
  const labels: Record<string, string> = {
    approve: '建议验收。仍需由用户确认，不会自动合并。',
    needs_attention: '需要人工关注后再决定。',
    reject: '建议拒绝或要求 MiMo 继续修复。',
    wait: '等待任务继续运行或补充信息。',
  };
  return labels[value] ?? value;
}

function firstLine(text?: string): string {
  return (text ?? '').split(/\r?\n/)[0]?.trim() ?? '';
}

export function formatDateTime(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

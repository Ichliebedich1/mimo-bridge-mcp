import { useEffect, useMemo, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import {
  cancelTask,
  createTask,
  deleteTask,
  fetchAgents,
  fetchFocusedTask,
  fetchFullTask,
  fetchHealth,
  fetchLiveTask,
  fetchQueue,
  fetchRoutingProfiles,
  fetchTask,
  fetchTaskDiff,
  fetchTaskLogs,
  fetchTasks,
  fetchTokenBudget,
  finishTask,
  formatDateTime,
  openTaskTarget,
  replyTask,
  resetTokenBudget,
  saveRoutingProfiles,
  selectWorkspaceFolder,
  worktreeTask,
  type AgentStatusResponse,
  type HealthResponse,
  type QueueStatusResponse,
  type TaskOpenAction,
} from './api';
import { CODEX_NEW_THREAD_URL, copyCodexReviewPrompt, resolveCodexHandoffUrl } from './codex-handoff.mjs';
import { groupLiveEvents, liveToolGroupPreview } from './live-viewer-events';
import { shouldSyncRoutingDraftFromServer } from './routing-draft';
import { canAbandonTaskStatus, canAcceptTaskStatus, canCancelTaskStatus, canDiscardWorktreeStatus, canReplyTaskStatus } from './task-actions';
import type {
  ChangedFile,
  CreateTaskAttachment,
  CreateTaskInput,
  FocusedTaskResult,
  FullTaskResult,
  IncludeTestsMode,
  LiveEvent,
  LiveTaskView,
  QueueItem,
  ReasoningEffort,
  ReplyTaskOptions,
  RiskFlag,
  RoutingAgentId,
  RoutingMode,
  RoutingProfiles,
  ScopeMode,
  Task,
  TaskScenario,
  TaskLogsResult,
  TaskStatus,
} from './types';

type Page = 'overview' | 'tasks' | 'create' | 'queue' | 'token' | 'routing' | 'system' | 'detail';

type ConfirmAction = {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'normal' | 'danger';
  onConfirm: () => Promise<unknown> | unknown;
};

type Notice = {
  tone: 'success' | 'error' | 'info';
  message: string;
};

const navItems: Array<{ key: Page; label: string; icon: string }> = [
  { key: 'overview', label: '总览', icon: '⌂' },
  { key: 'tasks', label: '任务', icon: '□' },
  { key: 'create', label: '新建任务', icon: '+' },
  { key: 'queue', label: '队列', icon: '↻' },
  { key: 'token', label: 'Token', icon: '◌' },
  { key: 'routing', label: '模型路由', icon: '◎' },
  { key: 'system', label: '系统状态', icon: '●' },
];

const statusMeta: Record<TaskStatus, { label: string; tone: string; helper: string }> = {
  queued: { label: '排队中', tone: 'neutral', helper: '可查看、取消' },
  running: { label: '运行中', tone: 'blue', helper: '可查看摘要、取消' },
  waiting: { label: '等待回复', tone: 'amber', helper: '可回复、取消' },
  review: { label: '待审查', tone: 'purple', helper: '可审查、回复、合并、验收或放弃' },
  accepted: { label: '已验收', tone: 'green', helper: '只读查看；存在 Worktree 时可合并' },
  failed: { label: '失败', tone: 'red', helper: '查看失败原因；如仍有 Worktree，可丢弃后删除' },
  cancelled: { label: '已取消', tone: 'neutral', helper: '如仍有 Worktree，可丢弃后删除' },
  abandoned: { label: '已放弃', tone: 'neutral', helper: '如仍有 Worktree，可丢弃后删除' },
};

const riskMeta: Record<RiskFlag, { label: string; severity: 'blocker' | 'attention' }> = {
  OUT_OF_BOUNDS_CHANGES: { label: '越界修改', severity: 'blocker' },
  OUT_OF_SCOPE_CHANGES: { label: '越界修改(Scope)', severity: 'blocker' },
  TESTS_FAILED: { label: '测试失败', severity: 'blocker' },
  TASK_FAILED: { label: '任务失败', severity: 'blocker' },
  NON_ZERO_EXIT: { label: '非零退出', severity: 'blocker' },
  REVIEW_DATA_UNAVAILABLE: { label: '审查数据不完整', severity: 'attention' },
  TASK_ERROR: { label: '任务错误', severity: 'attention' },
  ISSUES_REPORTED: { label: 'MiMo 报告问题', severity: 'attention' },
};

const testLabels: Record<Task['testResult'], string> = {
  passed: '测试通过',
  failed: '测试失败',
  not_run: '未运行测试',
  unknown: '暂无结果',
};

const scenarioLabels: Record<TaskScenario, string> = {
  multimodal: '多模态/图片',
  simple: '简单任务',
  normal: '普通代码',
  complex: '复杂任务',
  high_risk: '高风险任务',
};

const effortLabels: Record<ReasoningEffort, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const DEFAULT_ULTRA_SPEED_PRICING = { input: 9, output: 18, cache_hit: 0.075 };

const DEFAULT_ROUTING_PROFILES: RoutingProfiles = {
  default_scenario: 'normal',
  scenarios: {
    multimodal: {
      description: '多模态/图片任务',
      supports_multimodal: true,
      recommended: {
        mimo: { model: 'mimo-v2.5-flash', reasoning_effort: 'medium', reason: '只有 MiMo flash 支持多模态输入' },
        'reasonix-tui': { model: 'deepseek-v4-flash', reasoning_effort: 'medium', reason: 'Reasonix 当前不支持多模态，仅作为文本任务参考' },
      },
      current: { agent_id: 'mimo', model: 'mimo-v2.5-flash', reasoning_effort: 'medium' },
    },
    simple: {
      description: '简单文本、文档、小 UI 调整',
      supports_multimodal: false,
      recommended: {
        mimo: { model: 'mimo-v2.5-flash', reasoning_effort: 'low', reason: '简单任务优先用 flash 降低成本' },
        'reasonix-tui': { model: 'deepseek-v4-flash', reasoning_effort: 'low', reason: '简单任务优先用 flash 降低成本' },
      },
      current: { agent_id: 'mimo', model: 'mimo-v2.5-flash', reasoning_effort: 'low' },
    },
    normal: {
      description: '普通代码任务',
      supports_multimodal: false,
      recommended: {
        mimo: { model: 'mimo-v2.5-flash', reasoning_effort: 'medium', reason: '普通任务默认用 flash，中等强度' },
        'reasonix-tui': { model: 'deepseek-v4-flash', reasoning_effort: 'medium', reason: '普通任务默认用 flash，中等强度' },
      },
      current: { agent_id: 'mimo', model: 'mimo-v2.5-flash', reasoning_effort: 'medium' },
    },
    complex: {
      description: '复杂运行时、Git、安装包、安全边界任务',
      supports_multimodal: false,
      recommended: {
        mimo: { model: 'mimo-v2.5-pro', reasoning_effort: 'high', reason: '复杂任务用 pro 和高强度更稳' },
        'reasonix-tui': { model: 'deepseek-v4-pro', reasoning_effort: 'high', reason: '复杂任务用 pro 和高强度更稳' },
      },
      current: { agent_id: 'mimo', model: 'mimo-v2.5-pro', reasoning_effort: 'high' },
    },
    high_risk: {
      description: '高风险修改、迁移、删除、权限和发布相关任务',
      supports_multimodal: false,
      recommended: {
        mimo: { model: 'mimo-v2.5-pro', reasoning_effort: 'high', reason: '高风险任务默认使用 pro 和高强度' },
        'reasonix-tui': { model: 'deepseek-v4-pro', reasoning_effort: 'high', reason: '高风险任务默认使用 pro 和高强度' },
      },
      current: { agent_id: 'mimo', model: 'mimo-v2.5-pro', reasoning_effort: 'high' },
    },
  },
  allowed_models: {
    mimo: ['mimo-v2.5-flash', 'mimo-v2.5-pro'],
    'reasonix-tui': ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  reasoning_efforts: ['low', 'medium', 'high'],
  enable_mimo_pro_ultra_speed: false,
  pricing_per_1m_cny: {
    flash: { input: 1, output: 3, cache_hit: 0.02 },
    pro: { input: 3, output: 6, cache_hit: 0.025 },
    ultra_speed: DEFAULT_ULTRA_SPEED_PRICING,
  },
};

function agentDisplayName(agent: string) {
  if (agent === 'mimo') return 'MiMo';
  if (agent === 'reasonix-tui') return 'Reasonix TUI';
  return agent;
}

function ActionGroup({ title, helper, children }: { title: string; helper: string; children: ReactNode }) {
  return (
    <div className="action-group">
      <div className="action-group-header">
        <strong>{title}</strong>
        <span>{helper}</span>
      </div>
      <div className="action-group-controls">{children}</div>
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>('overview');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [lastRefresh, setLastRefresh] = useState('刚刚');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [agents, setAgents] = useState<AgentStatusResponse[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<unknown>(null);
  const [routingProfiles, setRoutingProfiles] = useState<RoutingProfiles | null>(null);
  const [routingProfilesFallback, setRoutingProfilesFallback] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [selectedForBatch, setSelectedForBatch] = useState<string[]>([]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const runningCount = Math.max(health?.queue.running ?? 0, tasks.filter((task) => task.status === 'running').length);
  const pendingInterventionCount = health?.pending_reviews?.count ?? tasks.filter((task) => task.status === 'review' || task.status === 'failed').length;
  const apiReachable = health !== null;
  const apiReady = apiReachable && !health.daemon.degraded;

  async function loadLiveData() {
    setIsRefreshing(true);
    try {
      const [nextHealth, nextTasks, nextQueue, nextToken] = await Promise.all([
        fetchHealth(),
        fetchTasks(20),
        fetchQueue(),
        fetchTokenBudget().catch(() => null),
      ]);
      const nextAgents = await fetchAgents().catch(() => []);
      const nextRouting = await fetchRoutingProfiles().catch(() => null);

      setHealth(nextHealth);
      setAgents(nextAgents);
      setTasks((current) => mergeTaskListPreservingDetail(current, nextTasks));
      setQueueItems(toQueueItems(nextQueue, nextTasks));
      setTokenStatus(nextToken);
      if (nextRouting) {
        setRoutingProfiles(nextRouting);
        setRoutingProfilesFallback(false);
      } else {
        setRoutingProfiles((current) => current ?? DEFAULT_ROUTING_PROFILES);
        setRoutingProfilesFallback(true);
      }
      setApiError(nextHealth.daemon.degraded ? nextHealth.daemon.config_error ?? '本地守护进程处于降级模式。' : null);
      setLastRefresh(formatClock());

      setSelectedTaskId((current) => (nextTasks.length > 0 && !nextTasks.some((task) => task.id === current) ? nextTasks[0].id : current));
    } catch (error) {
      setHealth(null);
      setTasks([]);
      setQueueItems([]);
      setSelectedTaskId('');
      setApiError(error instanceof Error ? error.message : String(error));
      setLastRefresh(formatClock());
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadLiveData();
    const timer = window.setInterval(() => {
      void loadLiveData();
    }, 3000);
    return () => window.clearInterval(timer);
    // Polling intentionally does not restart for every selected task change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshTaskDetail(taskId: string, agentOverride?: string) {
    if (!apiReachable) {
      return;
    }
    try {
      const agent = agentOverride ?? tasks.find((candidate) => candidate.id === taskId)?.agent ?? 'mimo';
      const task = await fetchTask(taskId, agent);
      setTasks((current) => mergeTask(current, task));
      setApiError(null);
    } catch (error) {
      setNotice({ tone: 'error', message: '详情刷新失败：' + errorMessage(error) });
    }
  }

  function openTask(taskId: string) {
    setSelectedTaskId(taskId);
    setPage('detail');
    void refreshTaskDetail(taskId);
  }

  function refreshData() {
    void loadLiveData();
    if (selectedTaskId) {
      void refreshTaskDetail(selectedTaskId);
    }
  }

  async function runAction<T>(
    busyLabel: string,
    successMessage: string,
    action: () => Promise<T>,
    options: { refreshTaskId?: string; refreshToken?: boolean } = {},
  ): Promise<T | null> {
    setActionBusy(busyLabel);
    setNotice({ tone: 'info', message: busyLabel });
    try {
      const result = await action();
      setNotice({ tone: 'success', message: successMessage });
      await loadLiveData();
      if (options.refreshTaskId) {
        await refreshTaskDetail(options.refreshTaskId);
      }
      if (options.refreshToken) {
        setTokenStatus(await fetchTokenBudget().catch(() => null));
      }
      return result;
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) });
      return null;
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCreateTask(input: CreateTaskInput) {
    const agentName = input.agent_id === 'reasonix-tui' ? 'Reasonix TUI' : 'MiMo';
    const result = await runAction(`正在创建 ${agentName} 任务…`, '任务已提交给本地守护进程。', () => createTask(input));
    const taskId = typeof result?.task_id === 'string' ? result.task_id : '';
    if (taskId) {
      setSelectedTaskId(taskId);
      setPage('detail');
      await refreshTaskDetail(taskId, input.agent_id || 'mimo');
    }
  }

  async function handleReply(taskId: string, message: string, priority: number, agent: string, attachments: CreateTaskAttachment[] = [], options: ReplyTaskOptions = {}) {
    await runAction('正在发送回复…', '回复已发送，执行 Agent 将继续处理。', () => replyTask(taskId, message, priority, agent, attachments, options), {
      refreshTaskId: taskId,
    });
  }

  async function handleSaveRoutingProfiles(next: RoutingProfiles) {
    const result = await runAction('正在保存模型路由设置…', '模型路由设置已保存。', () => saveRoutingProfiles({ scenarios: next.scenarios, enable_mimo_pro_ultra_speed: next.enable_mimo_pro_ultra_speed }));
    if (result) {
      setRoutingProfiles(result);
    }
  }

  async function handleOpenTaskTarget(taskId: string, action: TaskOpenAction) {
    const label =
      action === 'reasonix_gui'
        ? 'Reasonix GUI'
        : action === 'session_folder'
          ? '会话文件夹'
          : action === 'mimo_session_terminal'
            ? 'MiMo CMD 会话'
            : action === 'reasonix_session_terminal'
              ? 'Reasonix CMD 会话'
              : '任务文件夹';
    const agent = tasks.find((candidate) => candidate.id === taskId)?.agent ?? 'mimo';
    await runAction('正在打开' + label + '…', label + '已请求打开。', () => openTaskTarget(taskId, action, agent));
  }

  function confirmCancel(taskId: string) {
    const agent = tasks.find((candidate) => candidate.id === taskId)?.agent ?? 'mimo';
    setConfirmAction({
      title: '确认取消任务？',
      body: '会按任务所属 Agent 调用固定管理 API。已运行的任务会尽量终止，队列中的任务会被移除。',
      confirmLabel: '确认取消',
      tone: 'danger',
      onConfirm: () =>
        runAction('正在取消任务…', '任务已取消。', () => cancelTask(taskId, agent), {
          refreshTaskId: taskId,
        }),
    });
  }

  function confirmDeleteTask(taskId: string) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task || !task.canDelete) {
      const blockers = task?.deleteBlockers?.length ? task.deleteBlockers.join('，') : '只能删除已结束且没有 Worktree 的任务。';
      setNotice({ tone: 'error', message: blockers });
      return;
    }
    setConfirmAction({
      title: '永久删除任务？',
      body: `将永久删除 ${taskId} 的任务记录、brief 和日志，删除后无法恢复。`,
      confirmLabel: '永久删除',
      tone: 'danger',
      onConfirm: async () => {
        const result = await runAction('正在删除任务…', '任务及运行时文件已删除。', () => deleteTask(taskId, task.agent));
        if (result) {
          setSelectedTaskId('');
          setPage('tasks');
        }
      },
    });
  }

  function confirmBatchDeleteTasks(taskIds: string[]) {
    const uniqueIds = Array.from(new Set(taskIds));
    const selectedTasks = uniqueIds.map((id) => tasks.find((task) => task.id === id)).filter((task): task is Task => Boolean(task));
    const blocked = selectedTasks.filter((task) => !task.canDelete);
    if (selectedTasks.length === 0) {
      setNotice({ tone: 'error', message: '请先选择要删除的任务。' });
      return;
    }
    if (blocked.length > 0) {
      setNotice({ tone: 'error', message: '选中的任务里有不可安全删除项：' + blocked.map((task) => task.id).join('，') });
      return;
    }
    setConfirmAction({
      title: '批量删除任务？',
      body: `将永久删除 ${selectedTasks.length} 个已结束且无 Worktree 的任务记录、brief 和日志，删除后无法恢复。`,
      confirmLabel: '批量删除',
      tone: 'danger',
      onConfirm: async () => {
        const result = await runAction('正在批量删除任务…', '选中的任务已删除。', async () => {
          for (const task of selectedTasks) {
            await deleteTask(task.id, task.agent);
          }
          return { deleted: selectedTasks.length };
        });
        if (result) {
          setSelectedForBatch([]);
          if (selectedTasks.some((task) => task.id === selectedTaskId)) {
            setSelectedTaskId('');
            setPage('tasks');
          }
        }
      },
    });
  }

  function confirmFinish(taskId: string, status: 'accepted' | 'abandoned') {
    const agent = tasks.find((candidate) => candidate.id === taskId)?.agent ?? 'mimo';
    const accepted = status === 'accepted';
    setConfirmAction({
      title: accepted ? '确认验收任务？' : '确认放弃任务？',
      body: accepted
        ? '会按任务所属 Agent 调用固定验收 API，状态改为 accepted。请确认你已经看过 Review Package；界面不会自动替你判断。'
        : '会按任务所属 Agent 调用固定验收 API，状态改为 abandoned。此操作只标记任务结果，不会自动丢弃 Worktree。',
      confirmLabel: accepted ? '确认验收' : '确认放弃',
      tone: accepted ? 'normal' : 'danger',
      onConfirm: () =>
        runAction(accepted ? '正在验收任务…' : '正在放弃任务…', accepted ? '任务已验收。' : '任务已放弃。', () => finishTask(taskId, status, agent), {
          refreshTaskId: taskId,
        }),
    });
  }

  function confirmMergeAndAccept(taskId: string) {
    const agent = tasks.find((candidate) => candidate.id === taskId)?.agent ?? 'mimo';
    setConfirmAction({
      title: '确认合并 Worktree 并验收？',
      body: '会按任务所属 Agent 先合并 Worktree，成功后再标记为 accepted。如果任一步失败，界面会停止并展示错误。',
      confirmLabel: '合并并验收',
      onConfirm: () =>
        runAction(
          '正在合并 Worktree…',
          'Worktree 已合并，任务已验收。',
          async () => {
            await worktreeTask(taskId, 'merge', agent);
            return finishTask(taskId, 'accepted', agent);
          },
          { refreshTaskId: taskId },
        ),
    });
  }

  function confirmDiscardAndAbandon(taskId: string) {
    const agent = tasks.find((candidate) => candidate.id === taskId)?.agent ?? 'mimo';
    setConfirmAction({
      title: '确认丢弃 Worktree 并放弃？',
      body: '会按任务所属 Agent 先丢弃 Worktree，成功后把任务标记为 abandoned。失败任务和已取消任务也可以用这个动作清理残留 Worktree。',
      confirmLabel: '丢弃并放弃',
      tone: 'danger',
      onConfirm: () =>
        runAction(
          '正在丢弃 Worktree…',
          'Worktree 已丢弃，任务已放弃。',
          async () => {
            await worktreeTask(taskId, 'discard', agent);
            return finishTask(taskId, 'abandoned', agent);
          },
          { refreshTaskId: taskId },
        ),
    });
  }

  function confirmTokenReset() {
    setConfirmAction({
      title: '确认重置 Token 预算？',
      body: '会调用 POST /api/token-budget/reset。重置后会从 0 重新累计后续完成的 MiMo 任务 token。',
      confirmLabel: '确认重置',
      tone: 'danger',
      onConfirm: () =>
        runAction('正在重置 Token 预算…', 'Token 预算已重置。', () => resetTokenBudget(), {
          refreshToken: true,
        }),
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>MiMo 任务助手</strong>
            <span>本地管理台 · B+C</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button className={page === item.key ? 'nav-item active' : 'nav-item'} key={item.key} onClick={() => setPage(item.key)} type="button">
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className={apiReachable ? 'dot safe' : 'dot warning'} />
          {apiReachable
            ? '已连接本地守护进程；UI 与 MCP 共用同一进程状态。'
            : '未连接守护进程，正在显示可交互的降级演示数据。'}
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">localhost-only admin</span>
            <h1>{pageTitle(page)}</h1>
          </div>
          <div className="topbar-actions">
            <Pill tone={apiReady ? 'green' : 'amber'}>{apiReady ? '服务已连接 · API' : apiReachable ? '守护进程降级 · API' : '降级模式 · Mock'}</Pill>
            <Pill tone={runningCount > 0 ? 'blue' : 'neutral'}>运行中 {runningCount}</Pill>
            <Pill tone={pendingInterventionCount > 0 ? 'red' : 'neutral'}>待介入 {pendingInterventionCount}</Pill>
            <button className="button ghost" disabled={isRefreshing} onClick={refreshData} type="button">
              {isRefreshing ? '刷新中…' : '刷新'}
            </button>
          </div>
        </header>

        {notice && (
          <section className={'notice-banner ' + notice.tone} aria-live="polite">
            <span>{notice.tone === 'success' ? '✓' : notice.tone === 'error' ? '!' : '…'}</span>
            <p>{notice.message}</p>
            <button className="link-button" onClick={() => setNotice(null)} type="button">
              关闭
            </button>
          </section>
        )}

        {apiError && (
          <section className="connection-banner" aria-label="本地守护进程连接状态">
            <strong>{apiReachable ? '守护进程处于降级模式' : '当前使用静态降级数据'}</strong>
            <p>{apiError}</p>
          </section>
        )}

        <main>
          {page === 'overview' && <Overview tasks={tasks} pendingInterventionCount={pendingInterventionCount} queueItems={queueItems} onOpenTask={openTask} onDeleteTask={confirmDeleteTask} />}
          {page === 'tasks' && (
            <TasksPage
              tasks={tasks}
              filter={statusFilter}
              onFilterChange={setStatusFilter}
              onOpenTask={openTask}
              onDeleteTask={confirmDeleteTask}
              selectedTaskIds={selectedForBatch}
              onSelectedTaskIdsChange={setSelectedForBatch}
              onBatchDelete={confirmBatchDeleteTasks}
              onCreate={() => setPage('create')}
            />
          )}
          {page === 'create' && <CreateTaskPage actionBusy={Boolean(actionBusy)} agents={agents} routingProfiles={routingProfiles} routingProfilesFallback={routingProfilesFallback} onCreate={handleCreateTask} />}
          {page === 'queue' && <QueuePage queueItems={queueItems} onOpenTask={openTask} />}
          {page === 'token' && <TokenPage tokenStatus={tokenStatus} onReset={confirmTokenReset} actionBusy={Boolean(actionBusy)} />}
          {page === 'routing' && <RoutingSettingsPage actionBusy={Boolean(actionBusy)} routingProfiles={routingProfiles} routingProfilesFallback={routingProfilesFallback} onSave={handleSaveRoutingProfiles} />}
          {page === 'system' && <SystemPage agents={agents} health={health} apiError={apiError} />}
          {page === 'detail' &&
            (selectedTask ? (
	              <TaskDetailPage
	                actionBusy={actionBusy}
	                task={selectedTask}
	                tasks={tasks}
	                routingProfiles={routingProfiles}
	                onOpenTask={openTask}
                onCancel={confirmCancel}
                onDiscardAndAbandon={confirmDiscardAndAbandon}
                onDeleteTask={confirmDeleteTask}
                onFinish={confirmFinish}
                onLoadDiff={(taskId, filePath, agent) => fetchTaskDiff(taskId, filePath, agent)}
                onLoadFocused={(taskId, filePath, agent) => fetchFocusedTask(taskId, filePath, agent)}
                onLoadFull={(taskId, agent) => fetchFullTask(taskId, agent)}
                onLoadLogs={(taskId, agent) => fetchTaskLogs(taskId, 20, agent)}
                onMergeAndAccept={confirmMergeAndAccept}
                onOpenTaskTarget={handleOpenTaskTarget}
                onRefresh={() => refreshTaskDetail(selectedTask.id)}
                onReply={handleReply}
              />
            ) : (
              <EmptyTaskDetail onCreate={() => setPage('create')} />
            ))}
        </main>
      </div>

      {confirmAction && <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />}
    </div>
  );
}

function pageTitle(page: Page) {
  const titles: Record<Page, string> = {
    overview: '总览',
    tasks: '任务列表',
    create: '新建任务',
    detail: '任务审查工作台',
    queue: '队列',
    token: 'Token 预算',
    routing: '模型路由',
    system: '系统状态',
  };
  return titles[page];
}

function Overview({
  tasks,
  pendingInterventionCount,
  queueItems,
  onOpenTask,
  onDeleteTask,
}: {
  tasks: Task[];
  pendingInterventionCount: number;
  queueItems: QueueItem[];
  onOpenTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
}) {
  const counts = useMemo(
    () => ({
      running: tasks.filter((task) => task.status === 'running').length,
      queued: tasks.filter((task) => task.status === 'queued').length,
      review: tasks.filter((task) => task.status === 'review').length,
      failed: tasks.filter((task) => task.status === 'failed').length,
    }),
    [tasks],
  );
  const reviewTask = tasks.find((task) => task.status === 'review') ?? tasks.find((task) => task.status === 'failed') ?? tasks[0] ?? null;

  return (
    <div className="page-grid overview-grid">
      <section className="hero-card wide">
        <span className="eyebrow">review-first workbench</span>
        <h2>用低上下文方式管理 MiMo 编码任务：先看结论，再按文件升级细节。</h2>
        <p>默认只加载 Review Package；点击文件才读取 focused diff，点击日志才拉取尾部日志。危险操作全部需要二次确认。</p>
        <div className="hero-actions">
          {reviewTask ? (
            <button className="button primary" onClick={() => onOpenTask(reviewTask.id)} type="button">
              打开待审查任务
            </button>
          ) : (
            <button className="button primary" disabled type="button">
              暂无任务
            </button>
          )}
          <span className="muted-text">P4 写任务队列已启用实际串行保护。</span>
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="任务概况" helper="来自 /api/tasks，断线时显示降级演示数据。" />
        <div className="metric-grid">
          <MetricCard label="运行中" value={counts.running} tone="blue" helper="当前执行中的写任务" />
          <MetricCard label="排队中" value={counts.queued} tone="neutral" helper="等待当前 Runner 完成" />
          <MetricCard label="待介入" value={pendingInterventionCount} tone="red" helper="待审查或失败后需要处理" />
          <MetricCard label="失败" value={counts.failed} tone="red" helper="可回复继续，或丢弃 Worktree" />
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="队列前线" helper="running 与 queued 摘要。" />
        <div className="queue-stack">
          {queueItems.length === 0 && <div className="lane-empty">当前没有运行或排队任务。</div>}
          {queueItems.slice(0, 4).map((item) => (
            <button className="queue-card" key={item.taskId} onClick={() => onOpenTask(item.taskId)} type="button">
              <Pill tone={item.status === 'running' ? 'blue' : 'neutral'}>{item.status}</Pill>
              <strong>{item.title}</strong>
              <span>{item.note}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <PanelHeader title="最近任务" helper="点击查看进入低上下文审查页。" />
        {tasks.length === 0 ? <EmptyState title="还没有任务" body="连接 daemon 后创建第一个 MiMo 任务即可在这里看到。" /> : <TaskTable tasks={tasks.slice(0, 6)} onOpenTask={onOpenTask} onDeleteTask={onDeleteTask} />}
      </section>
    </div>
  );
}

function TasksPage({
  tasks,
  filter,
  onFilterChange,
  onOpenTask,
  onDeleteTask,
  selectedTaskIds,
  onSelectedTaskIdsChange,
  onBatchDelete,
  onCreate,
}: {
  tasks: Task[];
  filter: 'all' | TaskStatus;
  onFilterChange: (status: 'all' | TaskStatus) => void;
  onOpenTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  selectedTaskIds: string[];
  onSelectedTaskIdsChange: (taskIds: string[]) => void;
  onBatchDelete: (taskIds: string[]) => void;
  onCreate: () => void;
}) {
  const [showSafeDeleteOnly, setShowSafeDeleteOnly] = useState(false);
  const [showSummaries, setShowSummaries] = useState(false);
  const statusFiltered = filter === 'all' ? tasks : tasks.filter((task) => task.status === filter);
  const filtered = showSafeDeleteOnly ? statusFiltered.filter((task) => task.canDelete) : statusFiltered;
  const safeDeleteCount = statusFiltered.filter((task) => task.canDelete).length;
  const batchDeleteCount = filtered.filter((task) => selectedTaskIds.includes(task.id) && task.canDelete).length;
  const statuses: Array<'all' | TaskStatus> = ['all', 'queued', 'running', 'waiting', 'review', 'accepted', 'failed', 'cancelled', 'abandoned'];

  function toggleSelect(taskId: string, checked: boolean) {
    onSelectedTaskIdsChange(checked
      ? Array.from(new Set([...selectedTaskIds, taskId]))
      : selectedTaskIds.filter((id) => id !== taskId));
  }

  function toggleSelectAll(checked: boolean) {
    const visibleIds = filtered.map((task) => task.id);
    onSelectedTaskIdsChange(checked
      ? Array.from(new Set([...selectedTaskIds, ...visibleIds]))
      : selectedTaskIds.filter((id) => !visibleIds.includes(id)));
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((task) => selectedTaskIds.includes(task.id));

  return (
    <section className="panel wide page-panel">
      <div className="section-title">
        <PanelHeader title="任务列表" helper="支持状态筛选、安全删除筛选、批量删除和摘要折叠。" />
        <button className="button primary" onClick={onCreate} type="button">
          新建任务
        </button>
      </div>
      <div className="filter-row">
        {statuses.map((status) => (
          <button className={filter === status ? 'chip active' : 'chip'} key={status} onClick={() => onFilterChange(status)} type="button">
            {filterLabel(status)}
          </button>
        ))}
        <button className={showSafeDeleteOnly ? 'chip active' : 'chip'} onClick={() => setShowSafeDeleteOnly(!showSafeDeleteOnly)} type="button">
          可安全删除{safeDeleteCount > 0 ? ' (' + safeDeleteCount + ')' : ''}
        </button>
        <button className={showSummaries ? 'chip active' : 'chip'} onClick={() => setShowSummaries(!showSummaries)} type="button">
          {showSummaries ? '折叠摘要' : '展开摘要'}
        </button>
      </div>
      <div className="batch-toolbar">
        <label className="select-row">
          <input checked={allVisibleSelected} disabled={filtered.length === 0} onChange={(event) => toggleSelectAll(event.target.checked)} type="checkbox" />
          <span>选择当前列表</span>
        </label>
        <span className="muted-text">已选 {selectedTaskIds.length} 个，可删除 {batchDeleteCount} 个</span>
        <button className="button danger" disabled={batchDeleteCount === 0} onClick={() => onBatchDelete(selectedTaskIds)} type="button">
          批量删除
        </button>
      </div>
      {filtered.length === 0 ? <EmptyState title="没有匹配任务" body="换一个筛选条件，或创建一个新的 Agent 任务。" /> : (
        <TaskTable
          tasks={filtered}
          onOpenTask={onOpenTask}
          onDeleteTask={onDeleteTask}
          selectedTaskIds={selectedTaskIds}
          onToggleTask={toggleSelect}
          showSummaries={showSummaries}
        />
      )}
    </section>
  );
}

function CreateTaskPage({
  actionBusy,
  agents,
  routingProfiles,
  routingProfilesFallback,
  onCreate,
}: {
  actionBusy: boolean;
  agents: AgentStatusResponse[];
  routingProfiles: RoutingProfiles | null;
  routingProfilesFallback: boolean;
  onCreate: (input: CreateTaskInput) => Promise<void>;
}) {
  const runnableAgents = agents.filter((agent) => agent.enabled !== false && agent.capabilities?.start_task !== false);
  const agentOptions = runnableAgents.length > 0 ? runnableAgents : [{ id: 'mimo', display_name: 'MiMo Code', status: 'ready' } as AgentStatusResponse];
  const [agentId, setAgentId] = useState(agentOptions[0]?.id ?? 'mimo');
  const [objective, setObjective] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [editablePaths, setEditablePaths] = useState('');
  const [readonlyPaths, setReadonlyPaths] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [maxRounds, setMaxRounds] = useState(5);
  const [timeoutSeconds, setTimeoutSeconds] = useState(900);
  const [priority, setPriority] = useState(5);
  const [useWorktree, setUseWorktree] = useState(false);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('strict');
  const [includeTests, setIncludeTests] = useState<IncludeTestsMode>('auto');
  const [repoWideConfirmed, setRepoWideConfirmed] = useState(false);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('auto');
  const [taskScenario, setTaskScenario] = useState<TaskScenario>('normal');
  const [model, setModel] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const [hasImages, setHasImages] = useState(false);
  const [attachments, setAttachments] = useState<CreateTaskAttachment[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const currentScenario = routingProfiles?.scenarios[taskScenario] ?? null;
  const selectedRoutingAgent = agentId === 'reasonix-tui' ? 'reasonix-tui' : 'mimo';
  const allowedModels = routingProfiles?.allowed_models[selectedRoutingAgent] ?? (selectedRoutingAgent === 'mimo' ? ['mimo-v2.5-flash', 'mimo-v2.5-pro'] : ['deepseek-v4-flash', 'deepseek-v4-pro']);
  const autoSelection = currentScenario?.current;
  const effectiveAgentId = routingMode === 'auto' ? autoSelection?.agent_id ?? 'mimo' : selectedRoutingAgent;
  const effectiveModel = routingMode === 'auto' ? autoSelection?.model ?? 'mimo-v2.5-flash' : (model || allowedModels[0] || '');
  const effectiveEffort = routingMode === 'auto' ? autoSelection?.reasoning_effort ?? 'medium' : reasoningEffort;

  useEffect(() => {
    if (!agentOptions.some((agent) => agent.id === agentId)) {
      setAgentId(agentOptions[0]?.id ?? 'mimo');
    }
  }, [agentId, agentOptions]);

  useEffect(() => {
    if (hasImages || attachments.some((attachment) => attachment.kind === 'image')) {
      setTaskScenario('multimodal');
      setRoutingMode('auto');
      setHasImages(true);
    }
  }, [attachments, hasImages]);

  useEffect(() => {
    if (routingMode === 'manual' && (!model || !allowedModels.includes(model))) {
      setModel(allowedModels[0] ?? '');
    }
  }, [allowedModels, model, routingMode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!objective.trim()) {
      setFormError('请填写任务目标。');
      return;
    }
    if (!workspacePath.trim()) {
      setFormError('请填写 Windows 绝对工作区路径。');
      return;
    }
    if (maxRounds < 1 || maxRounds > 10) {
      setFormError('最大轮数必须在 1-10 之间。');
      return;
    }
    if (timeoutSeconds < 60 || timeoutSeconds > 3600) {
      setFormError('运行超时时间必须在 60-3600 秒之间。');
      return;
    }
    if (scopeMode === 'repo-wide' && !repoWideConfirmed) {
      setFormError('repo-wide 模式需要勾选确认复选框。');
      return;
    }
    const attachmentHasImages = attachments.some((attachment) => attachment.kind === 'image');
    if ((hasImages || attachmentHasImages) && routingMode === 'manual') {
      setFormError('多模态任务请使用 Auto 模式，系统会强制选择 MiMo flash。');
      return;
    }
    if (routingMode === 'manual' && taskScenario === 'multimodal' && (selectedRoutingAgent !== 'mimo' || effectiveModel !== 'mimo-v2.5-flash')) {
      setFormError('多模态任务只能使用 MiMo 的 mimo-v2.5-flash。');
      return;
    }

    const input: CreateTaskInput = {
      agent_id: routingMode === 'auto' ? effectiveAgentId : agentId,
      objective: objective.trim(),
      workspace_path: workspacePath.trim(),
      editable_paths: splitLines(editablePaths),
      readonly_paths: splitLines(readonlyPaths),
      acceptance_criteria: splitLines(acceptanceCriteria),
      max_rounds: maxRounds,
      runtime_timeout_seconds: timeoutSeconds,
      use_worktree: useWorktree,
      priority,
      scope_mode: scopeMode,
      include_tests: includeTests,
      repo_wide_confirmed: repoWideConfirmed,
      routing_mode: routingMode,
      task_scenario: hasImages ? 'multimodal' : taskScenario,
      model: effectiveModel,
      reasoning_effort: effectiveEffort,
      has_images: hasImages || attachmentHasImages,
      attachments,
    };

    setSubmitting(true);
    try {
      await onCreate(input);
    } finally {
      setSubmitting(false);
    }
  }

  async function addFiles(files: FileList | File[]) {
    setFormError(null);
    try {
      const next = await Promise.all(Array.from(files).map(readFileAttachment));
      setAttachments((current) => [...current, ...next].slice(0, 10));
      if (next.some((attachment) => attachment.kind === 'image')) {
        setHasImages(true);
      }
    } catch (error) {
      setFormError('读取附件失败：' + errorMessage(error));
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData.files;
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      if (!next.some((attachment) => attachment.kind === 'image')) {
        setHasImages(false);
      }
      return next;
    });
  }

  async function chooseWorkspaceFolder() {
    setFormError(null);
    setSelectingWorkspace(true);
    try {
      const result = await selectWorkspaceFolder();
      if (result.selected && result.path) {
        setWorkspacePath(result.path);
      }
    } catch (error) {
      setFormError('打开文件夹选择器失败：' + errorMessage(error));
    } finally {
      setSelectingWorkspace(false);
    }
  }

  return (
    <div className="create-layout">
      <section className="panel">
        <PanelHeader title="新建 Agent 任务" helper="先选场景和模型路由；Auto 模式会按后台默认策略选择 Agent、模型和思考强度。" />
        <form className="task-form" onSubmit={handleSubmit}>
          {formError && <div className="form-error">{formError}</div>}
          {routingProfilesFallback && (
            <div className="warning-card compact">
              当前后台暂未返回路由配置，页面正在使用内置默认策略预览。请刷新或重启后台后再保存自定义路由设置。
            </div>
          )}
          <div className="split-fields">
            <label>
              <span>任务场景</span>
              <select disabled={hasImages} value={taskScenario} onChange={(event) => setTaskScenario(event.target.value as TaskScenario)}>
                {Object.entries(scenarioLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <small className="field-help">{currentScenario?.description ?? '选择场景后，Auto 模式会套用后台默认策略。'}</small>
            </label>
            <label>
              <span>路由模式</span>
              <select disabled={hasImages} value={routingMode} onChange={(event) => setRoutingMode(event.target.value as RoutingMode)}>
                <option value="auto">Auto（按规则自动判断）</option>
                <option value="manual">Manual（手动选择）</option>
              </select>
              <small className="field-help">Auto 适合省心省 token；Manual 适合你明确要指定模型时使用。</small>
            </label>
          </div>
          <label className="toggle-row">
            <input checked={hasImages} onChange={(event) => setHasImages(event.target.checked)} type="checkbox" />
            <span>包含图片/多模态输入（自动使用 MiMo flash）</span>
          </label>
          <div className="routing-preview">
            <strong>本次将使用</strong>
            <span>Agent：{agentDisplayName(effectiveAgentId)}</span>
            <span>模型：{effectiveModel}</span>
            <span>思考强度：{effortLabels[effectiveEffort]}</span>
          </div>
          {routingMode === 'manual' && (
            <>
              <label>
                <span>执行 Agent *</span>
                <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  {agentOptions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.display_name || agent.id} ({agent.status})
                    </option>
                  ))}
                </select>
                <small className="field-help">MiMo 支持多模态 flash；Reasonix TUI 当前只支持文本任务。</small>
              </label>
              <div className="split-fields">
                <label>
                  <span>模型</span>
                  <select value={model || allowedModels[0] || ''} onChange={(event) => setModel(event.target.value)}>
                    {allowedModels.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>思考强度</span>
                  <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                  </select>
                </label>
              </div>
            </>
          )}
          <label>
            <span>任务目标 *</span>
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              onPaste={handlePaste}
              placeholder="例如：为管理页面接入真实取消/验收 API，并补充错误提示。也可以直接在这里粘贴截图。"
              rows={5}
            />
          </label>
          <div className="attachment-box">
            <div className="attachment-head">
              <div>
                <strong>任务附件</strong>
                <p>可粘贴截图，或选择图片/文件。附件会保存到任务运行目录，不上传原始本地路径。</p>
              </div>
              <label className="button soft file-picker">
                选择附件/图片
                <input
                  multiple
                  onChange={(event) => {
                    if (event.target.files?.length) {
                      void addFiles(event.target.files);
                      event.target.value = '';
                    }
                  }}
                  type="file"
                />
              </label>
            </div>
            {attachments.length === 0 ? (
              <div className="attachment-empty">暂无附件。截图可以直接 Ctrl+V 粘贴到任务目标框。</div>
            ) : (
              <div className="attachment-list">
                {attachments.map((attachment, index) => (
                  <div className="attachment-item" key={attachment.name + index}>
                    <span>{attachment.kind === 'image' ? '图片' : '文件'}</span>
                    <strong>{attachment.name}</strong>
                    <small>{attachment.mime_type} · {formatBytes(attachment.size_bytes)}</small>
                    <button className="link-button danger-link" onClick={() => removeAttachment(index)} type="button">
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label>
            <span>工作区路径 *</span>
            <div className="path-picker-row">
              <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="C:\Users\...\mimo-bridge-mcp" />
              <button className="button soft" disabled={selectingWorkspace || actionBusy || submitting} onClick={() => void chooseWorkspaceFolder()} type="button">
                {selectingWorkspace ? '选择中…' : '选择文件夹'}
              </button>
            </div>
            <small className="field-help">必须是允许根目录下的 Windows 绝对路径。</small>
          </label>
          <div className="split-fields">
            <label>
              <span>可编辑路径</span>
              <textarea value={editablePaths} onChange={(event) => setEditablePaths(event.target.value)} placeholder="每行一个路径，例如 apps/admin-ui/src" rows={4} />
            </label>
            <label>
              <span>只读路径</span>
              <textarea value={readonlyPaths} onChange={(event) => setReadonlyPaths(event.target.value)} placeholder="每行一个路径，例如 docs/RELEASE_VALIDATION.md" rows={4} />
            </label>
          </div>
          <label>
            <span>验收标准</span>
            <textarea value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} placeholder="每行一个验收条件" rows={4} />
          </label>
          <div className="split-fields three">
            <label>
              <span>最大轮数</span>
              <input max={10} min={1} type="number" value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))} />
            </label>
            <label>
              <span>超时秒数</span>
              <input max={3600} min={60} type="number" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} />
            </label>
            <label>
              <span>优先级</span>
              <input max={10} min={0} type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} />
            </label>
          </div>
          <label className="toggle-row">
            <input checked={useWorktree} onChange={(event) => setUseWorktree(event.target.checked)} type="checkbox" />
            <span>使用 Git Worktree（Git 项目建议开启）</span>
          </label>
          <div className="split-fields">
            <label>
              <span>Scope Mode</span>
              <select value={scopeMode} onChange={(event) => setScopeMode(event.target.value as ScopeMode)}>
                <option value="strict">strict（默认）</option>
                <option value="suggested">suggested</option>
                <option value="repo-wide">repo-wide</option>
              </select>
            </label>
            <label>
              <span>Include Tests</span>
              <select value={includeTests} onChange={(event) => setIncludeTests(event.target.value as IncludeTestsMode)}>
                <option value="auto">auto（默认）</option>
                <option value="always">always</option>
                <option value="never">never</option>
              </select>
            </label>
          </div>
          {scopeMode === 'repo-wide' && (
            <label className="toggle-row">
              <input checked={repoWideConfirmed} onChange={(event) => setRepoWideConfirmed(event.target.checked)} type="checkbox" />
              <span>我确认需要 repo-wide 模式，任务可以修改整个仓库</span>
            </label>
          )}
          {scopeMode === 'strict' && editablePaths.trim() && (
            <div className="scope-preview">
              <strong>本次可修改范围预览:</strong>
              <span>{splitLines(editablePaths).join('，') || '(由系统自动推断)'}</span>
            </div>
          )}
          <button className="button primary large" disabled={actionBusy || submitting} type="submit">
            {submitting ? '提交中…' : '开始任务'}
          </button>
        </form>
      </section>

      <aside className="panel guidance-panel">
        <PanelHeader title="安全边界" helper="这里故意保守一点，像给操作台装护栏。" />
        <SafetyItem title="只走固定 API" body="浏览器不会传任意 MCP 工具名，也不会直接读 runtime/tasks、原始日志或 Worktree 文件。" />
        <SafetyItem title="默认低上下文" body="详情页默认只读 review。文件 diff、日志、full 模式都需要用户点击后才加载。" />
        <SafetyItem title="危险操作二次确认" body="取消、验收、放弃、合并、丢弃和 Token reset 都必须明确确认。" />
      </aside>
    </div>
  );
}

function TaskDetailPage({
  task,
  tasks,
  routingProfiles,
  actionBusy,
  onOpenTask,
  onReply,
  onCancel,
  onFinish,
  onMergeAndAccept,
  onDiscardAndAbandon,
  onDeleteTask,
  onLoadFocused,
  onLoadDiff,
  onLoadLogs,
  onLoadFull,
  onOpenTaskTarget,
  onRefresh,
}: {
	task: Task;
	tasks: Task[];
  routingProfiles: RoutingProfiles | null;
	actionBusy: string | null;
	onOpenTask: (taskId: string) => void;
	onReply: (taskId: string, message: string, priority: number, agent: string, attachments?: CreateTaskAttachment[], options?: ReplyTaskOptions) => Promise<void>;
  onCancel: (taskId: string) => void;
  onFinish: (taskId: string, status: 'accepted' | 'abandoned') => void;
  onMergeAndAccept: (taskId: string) => void;
  onDiscardAndAbandon: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onLoadFocused: (taskId: string, filePath: string, agent: string) => Promise<FocusedTaskResult>;
  onLoadDiff: (taskId: string, filePath: string, agent: string) => Promise<FocusedTaskResult>;
  onLoadLogs: (taskId: string, agent: string) => Promise<TaskLogsResult>;
  onLoadFull: (taskId: string, agent: string) => Promise<FullTaskResult>;
  onOpenTaskTarget: (taskId: string, action: TaskOpenAction) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(task.changedFiles[0] ?? null);
  const [focusedDiff, setFocusedDiff] = useState<FocusedTaskResult | null>(null);
  const [logs, setLogs] = useState<TaskLogsResult | null>(null);
  const [fullResult, setFullResult] = useState<FullTaskResult | null>(null);
  const [loadingPanel, setLoadingPanel] = useState<'diff' | 'logs' | 'full' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<CreateTaskAttachment[]>([]);
  const [replyModel, setReplyModel] = useState('');
  const [replyEffort, setReplyEffort] = useState<ReasoningEffort>('medium');
  const [replyRoutingDirty, setReplyRoutingDirty] = useState(false);
  const [replying, setReplying] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const [handoffPrompt, setHandoffPrompt] = useState<string | null>(null);
  const [showLiveViewer, setShowLiveViewer] = useState(false);

  useEffect(() => {
    setSelectedFile(task.changedFiles[0] ?? null);
    setFocusedDiff(null);
    setLogs(null);
    setFullResult(null);
    setLocalError(null);
    setReplyMessage('');
    setReplyAttachments([]);
    setReplyModel('');
    setReplyEffort('medium');
    setReplyRoutingDirty(false);
    setHandoffMessage(null);
    setHandoffPrompt(null);
    setShowLiveViewer(false);
  }, [task.id]);

  const canReply = task.canReply && canReplyTaskStatus(task.status);
  const canAccept = canAcceptTaskStatus(task.status);
  const canAbandon = canAbandonTaskStatus(task.status);
  const canDiscardWorktree = canDiscardWorktreeStatus(task.status) && task.hasWorktree;
  const canCancel = canCancelTaskStatus(task.status);
  const hasBlocker = task.riskFlags.some((risk) => riskMeta[risk].severity === 'blocker');
  const hasAttention = task.riskFlags.length > 0 && !hasBlocker;
  const canDelete = task.canDelete;
  const replyAgentId = task.agent === 'reasonix-tui' ? 'reasonix-tui' : 'mimo';
  const fallbackModels = replyAgentId === 'mimo' ? ['mimo-v2.5-flash', 'mimo-v2.5-pro'] : ['deepseek-v4-flash', 'deepseek-v4-pro'];
  const replyAllowedModels = routingProfiles?.allowed_models[replyAgentId] ?? fallbackModels;
  const replyEffectiveModel = replyAllowedModels.includes(replyModel) ? replyModel : replyAllowedModels[0] ?? '';
  const replyHasImageAttachment = replyAttachments.some((attachment) => attachment.kind === 'image');
  const replyScenario = replyHasImageAttachment ? 'multimodal' : task.routing?.task_scenario ?? 'normal';
  const replyModelForSubmit = replyHasImageAttachment && replyAgentId === 'mimo' ? 'mimo-v2.5-flash' : replyEffectiveModel;

  useEffect(() => {
    if (replyRoutingDirty) {
      return;
    }
    const agentId = task.agent === 'reasonix-tui' ? 'reasonix-tui' : 'mimo';
    const models = routingProfiles?.allowed_models[agentId] ?? (agentId === 'mimo' ? ['mimo-v2.5-flash', 'mimo-v2.5-pro'] : ['deepseek-v4-flash', 'deepseek-v4-pro']);
    const preferredModel = task.routing?.model && models.includes(task.routing.model) ? task.routing.model : models[0] ?? '';
    setReplyModel(preferredModel);
    setReplyEffort(task.routing?.reasoning_effort ?? 'medium');
  }, [replyRoutingDirty, routingProfiles, task.agent, task.id, task.routing?.model, task.routing?.reasoning_effort]);

  async function loadFocused() {
    if (!selectedFile) {
      return;
    }
    setLocalError(null);
    setLoadingPanel('diff');
    try {
      const result = await onLoadFocused(task.id, selectedFile.path, task.agent).catch(() => onLoadDiff(task.id, selectedFile.path, task.agent));
      setFocusedDiff(result);
    } catch (error) {
      setLocalError('加载 focused diff 失败：' + errorMessage(error));
    } finally {
      setLoadingPanel(null);
    }
  }

  async function loadLogs() {
    setLocalError(null);
    setLoadingPanel('logs');
    try {
      setLogs(await onLoadLogs(task.id, task.agent));
    } catch (error) {
      setLocalError('加载日志失败：' + errorMessage(error));
    } finally {
      setLoadingPanel(null);
    }
  }

  async function loadFull() {
    setLocalError(null);
    setLoadingPanel('full');
    try {
      setFullResult(await onLoadFull(task.id, task.agent));
    } catch (error) {
      setLocalError('加载 full 模式失败：' + errorMessage(error));
    } finally {
      setLoadingPanel(null);
    }
  }

	  async function submitReply() {
	    const message = replyMessage.trim();
	    if (!message) {
	      setLocalError('请先填写要发送给执行 Agent 的回复。');
	      return;
	    }
    if (replyHasImageAttachment && replyAgentId !== 'mimo') {
      setLocalError('Reasonix TUI 当前不支持图片/多模态回复附件，请改用文本说明或交给 MiMo。');
      return;
    }
    if (!replyModelForSubmit) {
      setLocalError('当前 Agent 没有可用模型，无法发送回复。');
      return;
    }
	    setLocalError(null);
	    setReplying(true);
	    try {
      await onReply(task.id, message, task.priority, task.agent, replyAttachments, {
        routing_mode: 'manual',
        task_scenario: replyScenario,
        model: replyModelForSubmit,
        reasoning_effort: replyEffort,
        has_images: replyHasImageAttachment,
      });
	      setReplyMessage('');
	      setReplyAttachments([]);
	    } finally {
      setReplying(false);
    }
  }

  async function addReplyFiles(files: FileList | File[]) {
    setLocalError(null);
    try {
      const next = await Promise.all(Array.from(files).map(readFileAttachment));
      setReplyAttachments((current) => [...current, ...next].slice(0, 10));
    } catch (error) {
      setLocalError('读取回复附件失败：' + errorMessage(error));
    }
  }

  function handleReplyPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData.files;
    if (files.length > 0) {
      event.preventDefault();
      void addReplyFiles(files);
    }
  }

  async function handoffToCodex() {
    setLocalError(null);
    setHandoffMessage(null);
    const result = await copyCodexReviewPrompt(task, writeClipboardText);
    setHandoffPrompt(result.prompt);
    const returningToThread = result.url !== CODEX_NEW_THREAD_URL;
    if (result.copied) {
      setHandoffMessage(returningToThread
        ? '交接指令已复制，并已请求回到原 Codex 线程。请在 Codex 中粘贴并发送。'
        : '交接指令已复制，并已请求打开 Codex 新会话。请在 Codex 中粘贴并发送。');
      return;
    }
    setLocalError('无法自动复制交接指令。Codex 仍会尝试打开，请在下方手动复制指令。');
  }

  return (
    <div className="detail-page">
      <section className="panel detail-header">
        <div>
          <span className="eyebrow">review package first</span>
          <h2>{task.title}</h2>
          <div className="agent-line">
            <AgentBadge agent={task.agent} />
            <span>{task.agent === 'reasonix-tui' ? 'Reasonix TUI 执行任务' : 'MiMo Code 执行任务'}</span>
          </div>
          <p>{task.summary}</p>
        </div>
        <div className="detail-meta">
          <Pill tone={statusMeta[task.status].tone}>{statusMeta[task.status].label}</Pill>
          <span>task_id: {task.id}</span>
          <span>更新：{task.updatedAt}</span>
          <button className="button ghost" onClick={() => void onRefresh()} type="button">
            刷新详情
          </button>
        </div>
      </section>

      {localError && <div className="notice-banner error"><span>!</span><p>{localError}</p></div>}

      <div className="workbench">
        <section className="panel file-rail">
          <div className="task-switcher">
            <PanelHeader title="任务切换" helper="在当前列表内快速切换任务详情。" />
            <div className="task-switcher-list">
              {tasks.slice(0, 30).map((item) => (
                <button
                  className={item.id === task.id ? 'task-switcher-item active' : 'task-switcher-item'}
                  key={item.id}
                  onClick={() => onOpenTask(item.id)}
                  type="button"
                >
                  <span>{item.title || item.id}</span>
                  <small>{item.id}</small>
                </button>
              ))}
            </div>
          </div>
          <PanelHeader title="修改文件" helper="点击文件只切换选择；加载按钮才请求 focused diff。" />
          <div className="file-list">
            {task.changedFiles.length === 0 && <div className="lane-empty">Review Package 暂无 changed_files。</div>}
            {task.changedFiles.map((file) => (
              <button
                className={selectedFile?.path === file.path ? 'file-item active' : 'file-item'}
                key={file.path}
                onClick={() => {
                  setSelectedFile(file);
                  setFocusedDiff(null);
                }}
                type="button"
              >
                <strong>{file.path}</strong>
                <span>
                  +{file.additions} / -{file.deletions}
                </span>
                {file.risk && <RiskBadge risk={file.risk} />}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelHeader title="Review Package" helper="初次打开只请求 detail_level=review，不默认拉完整 diff 或日志。" />
          <div className="review-summary">
            <InfoBlock label="目标" value={task.objective} />
            <InfoBlock label="Diff Stat" value={task.diffStat} />
            <InfoBlock label="测试结果" value={testLabels[task.testResult]} tone={task.testResult === 'failed' ? 'danger' : 'normal'} />
            <InfoBlock label="建议" value={task.recommendation} tone={hasBlocker ? 'danger' : 'normal'} />
          </div>

          <div className="risk-section">
            <h3>风险标记</h3>
            {task.riskFlags.length === 0 ? (
              <div className="success-note">暂无阻塞风险。仍建议先看改动文件列表，再决定是否验收。</div>
            ) : (
              <>
                <div className="risk-list">
                  {task.riskFlags.map((risk) => (
                    <RiskBadge key={risk} risk={risk} />
                  ))}
                </div>
                <p>{hasBlocker ? '存在阻塞风险，合并和验收按钮已保守禁用。' : '存在需要关注的风险，建议按文件加载 focused diff。'}</p>
              </>
            )}
          </div>

          <div className="risk-section">
            <h3>删除状态</h3>
            {task.canDelete ? (
              <div className="success-note">此任务可安全删除：状态已结束且无 Worktree。</div>
            ) : (
              <div className="warning-card compact">
                <p>不可删除：{task.deleteBlockers.length > 0 ? task.deleteBlockers.join('；') : '任务未结束或存在 Worktree。'}</p>
              </div>
            )}
          </div>

          <div className="focused-diff">
            <div className="section-title">
              <div>
                <h3>按文件加载 focused diff</h3>
                <p>{selectedFile ? selectedFile.path : '请先选择一个文件。'}</p>
              </div>
              <button className="button soft" disabled={!selectedFile || loadingPanel === 'diff'} onClick={() => void loadFocused()} type="button">
                {loadingPanel === 'diff' ? '加载中…' : '加载选中文件'}
              </button>
            </div>
            {!focusedDiff ? (
              <div className="lazy-placeholder">尚未加载。这里遵守低上下文协议：只有点击后才请求 diff_paths，max_chars 不超过 20000。</div>
            ) : (
              <>
                {focusedDiff.diffTruncated && <div className="warning-card compact">返回内容已截断；如需更多信息，请缩小文件范围或进入高级调试。</div>}
                <pre className="code-preview">{focusedDiff.diff || focusedDiff.files.map((file) => file.content).join('\n\n') || '该文件没有可显示的 focused 内容。'}</pre>
              </>
            )}
          </div>

          <div className="log-tail">
            <div className="section-title">
              <div>
                <h3>日志尾部</h3>
                <p>默认只加载最近 20 行，不读取完整日志。</p>
              </div>
              <button className="button ghost" disabled={loadingPanel === 'logs'} onClick={() => void loadLogs()} type="button">
                {loadingPanel === 'logs' ? '加载中…' : '加载最近 20 行'}
              </button>
            </div>
            {logs && (
              <pre className="code-preview muted">
                {['# stdout', logs.stdout || '(empty)', '', '# stderr', logs.stderr || '(empty)'].join('\n')}
              </pre>
            )}
          </div>

          <div className="reply-box">
            <h3>回复 {agentDisplayName(task.agent)}</h3>
            <div className={canReply ? 'success-note compact' : 'warning-card compact'}>
              {canReply
                ? `${task.replyLabel}。失败任务也可以在保留会话时继续修复。`
                : `暂不可回复：${task.replyBlockers.length > 0 ? task.replyBlockers.join('；') : '当前任务没有可恢复会话或状态不允许。'}`}
            </div>
	            <textarea
	              disabled={!canReply || Boolean(actionBusy) || replying}
	              onChange={(event) => setReplyMessage(event.target.value)}
	              onPaste={handleReplyPaste}
	              placeholder={'说明需要 ' + agentDisplayName(task.agent) + ' 继续修复的问题，或给出下一步要求。'}
	              rows={5}
	              value={replyMessage}
	            />
            <div className="reply-routing-grid">
              <label>
                本轮模型
                <select
                  disabled={!canReply || Boolean(actionBusy) || replying || replyHasImageAttachment}
                  value={replyModelForSubmit}
                  onChange={(event) => {
                    setReplyRoutingDirty(true);
                    setReplyModel(event.target.value);
                  }}
                >
                  {replyAllowedModels.map((modelName) => (
                    <option key={modelName} value={modelName}>{modelName}</option>
                  ))}
                </select>
              </label>
              <label>
                思考强度
                <select
                  disabled={!canReply || Boolean(actionBusy) || replying}
                  value={replyEffort}
                  onChange={(event) => {
                    setReplyRoutingDirty(true);
                    setReplyEffort(event.target.value as ReasoningEffort);
                  }}
                >
                  {(routingProfiles?.reasoning_efforts ?? (['low', 'medium', 'high'] as ReasoningEffort[])).map((effort) => (
                    <option key={effort} value={effort}>{effortLabels[effort]}</option>
                  ))}
                </select>
              </label>
              <div className="reply-routing-note">
                {replyHasImageAttachment && replyAgentId === 'mimo'
                  ? '检测到图片附件，本轮会自动使用 mimo-v2.5-flash。'
                  : `继续使用 ${agentDisplayName(task.agent)} 会话，只切换该 Agent 的模型/强度。`}
              </div>
            </div>
	            <div className="attachment-box reply-attachments">
              <div className="attachment-head">
                <div>
                  <strong>回复附件</strong>
                  <p>可粘贴截图，或选择图片/文件补充给执行 Agent。</p>
                </div>
                <label className="button soft file-picker">
                  选择附件/图片
                  <input
                    multiple
                    onChange={(event) => {
                      if (event.target.files?.length) {
                        void addReplyFiles(event.target.files);
                        event.target.value = '';
                      }
                    }}
                    type="file"
                  />
                </label>
              </div>
              {replyAttachments.length === 0 ? (
                <div className="attachment-empty">暂无附件。截图可直接 Ctrl+V 粘贴到回复框。</div>
              ) : (
                <div className="attachment-list">
                  {replyAttachments.map((attachment, index) => (
                    <div className="attachment-item" key={attachment.name + index}>
                      <span>{attachment.kind === 'image' ? '图片' : '文件'}</span>
                      <strong>{attachment.name}</strong>
                      <small>{attachment.mime_type} · {formatBytes(attachment.size_bytes)}</small>
                      <button className="link-button danger-link" onClick={() => setReplyAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="button soft" disabled={!canReply || Boolean(actionBusy) || replying} onClick={() => void submitReply()} type="button">
              {replying ? '发送中…' : '发送回复'}
            </button>
          </div>

        </section>

        <aside className="panel action-panel">
          <PanelHeader title="操作区" helper={statusMeta[task.status].helper} />
          <div className="action-stack">
            <a
              className="button soft codex-handoff"
              href={resolveCodexHandoffUrl(task.originCodexThreadId, task.originCodexThreadUrl)}
              onClick={() => void handoffToCodex()}
              role="button"
            >
              {task.originCodexThreadId ? '回到原 Codex 线程审查' : '交给 Codex 审查'}
            </a>
            <span className="action-helper">{task.originCodexThreadId ? '复制低上下文审查指令，并回到发起任务的 Codex 线程。' : '复制低上下文审查指令，并打开 Codex 新会话。'}</span>
            <button className="button soft live-viewer-btn" onClick={() => setShowLiveViewer(true)} type="button">
              实时运行查看
            </button>
            <span className="action-helper">只读查看任务运行事件，不提供输入或控制。</span>
            <button className="button soft" disabled={Boolean(actionBusy)} onClick={() => void onOpenTaskTarget(task.id, 'task_folder')} type="button">
              打开任务文件夹
            </button>
            {task.agent === 'mimo' && (
              <button className="button soft" disabled={Boolean(actionBusy)} onClick={() => void onOpenTaskTarget(task.id, 'mimo_session_terminal')} type="button">
                在 CMD 打开 MiMo 会话
              </button>
            )}
            {task.agent === 'reasonix-tui' && (
              <>
                <button className="button soft" disabled={Boolean(actionBusy)} onClick={() => void onOpenTaskTarget(task.id, 'session_folder')} type="button">
                  打开会话文件夹
                </button>
                <button className="button soft" disabled={Boolean(actionBusy)} onClick={() => void onOpenTaskTarget(task.id, 'reasonix_session_terminal')} type="button">
                  在 CMD 打开 Reasonix 会话
                </button>
                <button className="button soft" disabled={Boolean(actionBusy)} onClick={() => void onOpenTaskTarget(task.id, 'reasonix_gui')} type="button">
                  打开 Reasonix GUI
                </button>
              </>
            )}
            <span className="action-helper">由本地 daemon 按任务记录解析路径或会话命令；浏览器不会传任意本地路径或任意命令。</span>
            <ActionGroup title="审查结论" helper="只对待审查任务开放；存在阻塞风险时保守禁用。">
              <button className="button primary" disabled={!canAccept || hasBlocker || !task.hasWorktree || Boolean(actionBusy)} onClick={() => onMergeAndAccept(task.id)} type="button">
                合并 Worktree 并验收
              </button>
              <button className="button primary" disabled={!canAccept || hasBlocker || Boolean(actionBusy)} onClick={() => onFinish(task.id, 'accepted')} type="button">
                验收任务
              </button>
            </ActionGroup>
            <ActionGroup title="清理 Worktree" helper="失败、取消或放弃后，如果仍有 Worktree，可以先丢弃再安全删除任务。">
              <button className="button danger" disabled={!canDiscardWorktree || Boolean(actionBusy)} onClick={() => onDiscardAndAbandon(task.id)} type="button">
                丢弃 Worktree 并放弃
              </button>
              <button className="button danger" disabled={!canAbandon || Boolean(actionBusy)} onClick={() => onFinish(task.id, 'abandoned')} type="button">
                放弃任务
              </button>
            </ActionGroup>
            <ActionGroup title="队列与删除" helper={canDelete ? '此任务已无 Worktree，可安全删除。' : '删除前必须是结束状态，并且没有 Worktree。'}>
              <button className="button ghost" disabled={!canCancel || Boolean(actionBusy)} onClick={() => onCancel(task.id)} type="button">
                取消任务
              </button>
              <button className="button danger" disabled={!canDelete || Boolean(actionBusy)} onClick={() => onDeleteTask(task.id)} type="button">
                删除任务
              </button>
            </ActionGroup>
          </div>

          {handoffMessage && <div className="success-note handoff-note">{handoffMessage}</div>}
          {handoffPrompt && localError && (
            <div className="handoff-fallback">
              <label htmlFor="codex-handoff-prompt">Codex 交接指令</label>
              <textarea id="codex-handoff-prompt" readOnly rows={9} value={handoffPrompt} />
            </div>
          )}

          <div className="advanced-box">
            <h3>高级调试</h3>
            <p>full 模式会拉取更多任务快照、diff 和日志，只用于明确需要深挖时。</p>
            <button
              className="button ghost"
              disabled={loadingPanel === 'full'}
              onClick={() => {
                const ok = window.confirm('full 模式最多请求 20000 字符。确认要升级上下文吗？');
                if (ok) {
                  void loadFull();
                }
              }}
              type="button"
            >
              {loadingPanel === 'full' ? '加载中…' : '请求 full 模式'}
            </button>
            {fullResult && (
              <div className="full-debug">
                <span>
                  returned {fullResult.returnedChars ?? '—'} / {fullResult.maxChars ?? '—'} chars
                  {fullResult.truncated ? ' · truncated' : ''}
                </span>
                <pre className="code-preview muted">{JSON.stringify(fullResult.raw, null, 2)}</pre>
              </div>
            )}
          </div>

          {hasAttention && <div className="small-note">建议先按相关文件加载 focused diff，再决定是否回复或验收。</div>}
        </aside>
      </div>

      {showLiveViewer && (
        <LiveViewerPanel taskId={task.id} onClose={() => setShowLiveViewer(false)} />
      )}
    </div>
  );
}

function EmptyTaskDetail({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="panel wide page-panel">
      <EmptyState title="还没有可查看的任务" body="连接本地 daemon 后，可以先创建一个 MiMo 任务。" />
      <button className="button primary" onClick={onCreate} type="button">
        新建任务
      </button>
    </section>
  );
}

function QueuePage({ queueItems, onOpenTask }: { queueItems: QueueItem[]; onOpenTask: (taskId: string) => void }) {
  const runningItems = queueItems.filter((item) => item.status === 'running');
  const queuedItems = queueItems.filter((item) => item.status === 'queued');

  return (
    <div className="page-grid">
      <section className="panel wide">
        <PanelHeader title="队列状态" helper="显示 running、queued 和队列项。" />
        <div className="warning-card">
          <strong>P4 串行队列已启用</strong>
          <p>返回 queued 表示任务尚未启动，会等待当前 Runner 完成、失败或取消后再执行。</p>
        </div>
        <div className="queue-lanes">
          <div>
            <h3>Running</h3>
            {runningItems.length === 0 && <div className="lane-empty">当前没有运行中的任务。</div>}
            {runningItems.map((item) => (
              <button className="lane-card running" key={item.taskId} onClick={() => onOpenTask(item.taskId)} type="button">
                <span>{item.startedAt}</span>
                <strong>{item.title}</strong>
                <p>{item.note}</p>
              </button>
            ))}
          </div>
          <div>
            <h3>Queued</h3>
            {queuedItems.length === 0 && <div className="lane-empty">当前没有排队任务。</div>}
            {queuedItems.map((item) => (
              <button className="lane-card" key={item.taskId} onClick={() => onOpenTask(item.taskId)} type="button">
                <span>#{item.position}</span>
                <strong>{item.title}</strong>
                <p>{item.note}</p>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function TokenPage({ tokenStatus, onReset, actionBusy }: { tokenStatus: unknown; onReset: () => void; actionBusy: boolean }) {
  const token = readTokenStatus(tokenStatus);
  const [timeRange, setTimeRange] = useState<TokenTimeRange>('24h');
  const [modelFilter, setModelFilter] = useState('all');
  const usage = token.usageFor(timeRange, modelFilter);

  return (
    <div className="page-grid">
      <section className="panel wide token-panel">
        <div className="token-dashboard-head">
          <PanelHeader title="Token 预算" helper="按时间、模型和 Agent 查看真实 token/cost；命中率 = 缓存命中输入 / 总输入。" />
          <div className="token-filters">
            <label>
              时间
              <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as TokenTimeRange)}>
                {TOKEN_RANGE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
            <label>
              模型
              <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
                <option value="all">全部模型</option>
                {token.models.map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>)}
              </select>
            </label>
          </div>
        </div>

        {!token.connected ? (
          <div className="token-empty">
            <div className="orb">◌</div>
            <h2>统计暂不可用</h2>
            <p>暂时无法读取本地守护进程的 token-budget 状态。</p>
          </div>
        ) : (
          <>
            <div className="token-hero">
              <div className="token-primary-card">
                <span>真实消耗 Tokens</span>
                <strong>{formatCompactToken(usage.raw.total_tokens)}</strong>
                <small>筛选范围：{TOKEN_RANGE_LABELS[timeRange]} / {modelFilter === 'all' ? '全部模型' : modelFilter}</small>
              </div>
              <div className="token-side-card">
                <span>总请求数</span>
                <strong>{token.historyCount}</strong>
                <small>当前 daemon 运行期记录</small>
              </div>
              <div className="token-side-card">
                <span>总成本</span>
                <strong>{usage.cost}</strong>
                <small>人民币预估</small>
              </div>
            </div>

            <div className="token-grid">
              <MetricCard label="新增输入" value={usage.input} tone="neutral" helper="不含缓存命中输入" />
              <MetricCard label="Output" value={usage.output} tone="neutral" helper="含 Reasoning 输出时按输出计" />
              <MetricCard label="缓存创建" value={usage.cacheWrite} tone="neutral" helper="写入缓存 token" />
              <MetricCard label="缓存命中" value={usage.cacheRead} tone="neutral" helper="命中输入 token" />
              <MetricCard label="缓存命中率" value={usage.hitRate} tone="neutral" helper="缓存命中输入 / 总输入" />
            </div>

            <div className="token-breakdown">
              <TokenUsageTable title="按时间窗口" rows={token.timeRanges} />
              <TokenUsageTable title="按模型" rows={token.modelRows} emptyText="暂无模型用量记录" />
              <TokenUsageTable title="按 Agent" rows={token.agents} emptyText="暂无 Agent 用量记录" />
            </div>

            <button className="button danger" disabled={actionBusy} onClick={onReset} type="button">
              重置预算（需确认）
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function TokenUsageTable({ title, rows, emptyText = '暂无用量记录' }: { title: string; rows: TokenUsageRow[]; emptyText?: string }) {
  return (
    <div className="token-table-card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <table className="token-table">
          <thead>
            <tr>
              <th>范围</th>
              <th>输入</th>
              <th>输出</th>
              <th>总量</th>
              <th>缓存</th>
              <th>命中率</th>
              <th>成本</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.input}</td>
                <td>{row.output}</td>
                <td>{row.total}</td>
                <td>{row.cache}</td>
                <td>{row.hitRate}</td>
                <td>{row.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SystemPage({ agents, health, apiError }: { agents: AgentStatusResponse[]; health: HealthResponse | null; apiError: string | null }) {
  return (
    <div className="page-grid">
      <section className="panel wide">
        <PanelHeader title="系统状态" helper="/api/health 提供守护进程、MCP、MiMo 和安全边界状态。" />
        <div className="system-grid">
          <SystemRow
            label="本地守护进程"
            status={health ? (health.daemon.degraded ? '降级运行' : '在线') : '未连接'}
            detail={health ? '监听 ' + (health.daemon.host ?? '127.0.0.1') + ':' + (health.daemon.port ?? 3210) : apiError ?? '尚未连接 /api/health'}
          />
          <SystemRow label="MCP 入口" status={health ? health.mcp.status : '未连接'} detail={health ? health.mcp.transport + ' · ' + health.mcp.endpoint : '等待本地守护进程'} />
          <SystemRow label="管理 API" status={health ? '在线' : '降级'} detail="固定 REST 路由映射；不允许浏览器传任意 MCP 工具名。" />
          <SystemRow
            label="敏感路径暴露"
            status={health?.security.raw_paths_exposed ? '需检查' : '已规避'}
            detail="界面不展示原始日志绝对路径、Worktree 路径和环境变量。"
          />
          <SystemRow
            label="安全约束"
            status={health?.security.localhost_only && !health.security.arbitrary_tool_proxy ? '已规避' : '需检查'}
            detail="只监听 localhost；不提供任意工具代理。"
          />
        </div>
      </section>
      <section className="panel wide">
        <PanelHeader title="执行 Agent" helper="来自 /api/agents；创建任务时可选择 ready 且支持 start_task 的 Agent。" />
        <div className="agent-grid">
          {agents.length === 0 && <div className="lane-empty">暂未读取到 Agent 状态。</div>}
          {agents.map((agent) => (
            <div className="agent-card" key={agent.id}>
              <AgentBadge agent={agent.id} />
              <strong>{agent.display_name || agent.id}</strong>
              <span>{agent.status}</span>
              <p>{agent.error || (agent.capabilities?.start_task ? '可创建任务' : '暂不可创建任务')}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function RoutingSettingsPage({
  actionBusy,
  routingProfiles,
  routingProfilesFallback,
  onSave,
}: {
  actionBusy: boolean;
  routingProfiles: RoutingProfiles | null;
  routingProfilesFallback: boolean;
  onSave: (next: RoutingProfiles) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RoutingProfiles | null>(routingProfiles);
  const [routingDirty, setRoutingDirty] = useState(false);

  useEffect(() => {
    if (shouldSyncRoutingDraftFromServer({ isDirty: routingDirty, serverProfiles: routingProfiles, draft })) {
      setDraft(routingProfiles);
      setRoutingDirty(false);
    }
  }, [draft, routingDirty, routingProfiles]);

  async function saveDraft() {
    if (!draft) return;
    await onSave(draft);
    setRoutingDirty(false);
  }

  if (!draft) {
    return (
      <section className="panel wide page-panel">
        <PanelHeader title="模型路由" helper="等待 /api/routing-profiles 返回配置。" />
        <EmptyState title="还没有路由配置" body="请确认后台 daemon 已启动，或点击刷新重新读取。" />
      </section>
    );
  }

  function updateScenario(scenario: TaskScenario, patch: Partial<{ agent_id: RoutingAgentId; model: string; reasoning_effort: ReasoningEffort }>) {
    setRoutingDirty(true);
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const currentSelection = next.scenarios[scenario].current;
      const agentId = patch.agent_id ?? currentSelection.agent_id;
      const allowedModels = next.allowed_models[agentId];
      let model = patch.model ?? currentSelection.model;
      if (patch.agent_id && !allowedModels.includes(model)) {
        model = allowedModels[0] ?? model;
      }
      if (scenario === 'multimodal') {
        next.scenarios[scenario].current = {
          agent_id: 'mimo',
          model: 'mimo-v2.5-flash',
          reasoning_effort: patch.reasoning_effort ?? currentSelection.reasoning_effort,
        };
        return next;
      }
      next.scenarios[scenario].current = {
        agent_id: agentId,
        model,
        reasoning_effort: patch.reasoning_effort ?? currentSelection.reasoning_effort,
      };
      return next;
    });
  }

  function toggleUltraSpeed(enabled: boolean) {
    setRoutingDirty(true);
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const ultraSpeedModel = 'mimo-v2.5-pro-ultraspeed';
      next.enable_mimo_pro_ultra_speed = enabled;
      if (enabled) {
        if (!next.allowed_models.mimo.includes(ultraSpeedModel)) {
          next.allowed_models.mimo = [...next.allowed_models.mimo, ultraSpeedModel];
        }
      } else {
        next.allowed_models.mimo = next.allowed_models.mimo.filter((model) => model !== ultraSpeedModel);
        for (const scenario of Object.keys(next.scenarios) as TaskScenario[]) {
          const selection = next.scenarios[scenario].current;
          if (selection.agent_id === 'mimo' && selection.model === ultraSpeedModel) {
            next.scenarios[scenario].current = { ...selection, model: scenario === 'simple' || scenario === 'normal' ? 'mimo-v2.5-flash' : 'mimo-v2.5-pro' };
          }
        }
      }
      return next;
    });
  }

  const ultraSpeedEnabled = draft.enable_mimo_pro_ultra_speed === true;
  const ultraSpeedPricing = draft.pricing_per_1m_cny.ultra_speed ?? DEFAULT_ULTRA_SPEED_PRICING;

  return (
    <div className="page-grid">
      <section className="panel wide">
        <div className="section-title">
          <PanelHeader title="模型路由设置" helper="配置每种场景默认使用哪个 Agent、模型和思考强度；新建任务 Auto 模式会读取这里。" />
          <button className="button primary" disabled={actionBusy} onClick={() => void saveDraft()} type="button">
            保存路由设置
          </button>
        </div>
        {routingDirty && (
          <div className="warning-card compact">
            当前有未保存的路由设置。后台自动刷新不会覆盖你正在编辑的 Ultra Speed 开关或模型选择。
          </div>
        )}
        {routingProfilesFallback && (
          <div className="warning-card compact">
            当前显示的是内置默认策略，因为后台还没有返回 `/api/routing-profiles`。如果保存失败，请先重启 MiMo Bridge 后台再刷新页面。
          </div>
        )}
        <div className="ultra-speed-toggle">
          <label className="toggle-row">
            <input checked={ultraSpeedEnabled} onChange={(event) => toggleUltraSpeed(event.target.checked)} type="checkbox" />
            <span>启用 MiMo V2.5 Pro Ultra Speed（内测，高速高价）</span>
          </label>
          <p className="field-help">默认关闭。约为 Pro 3 倍价格，不支持多模态，适合很急的复杂任务或大输出任务。开启后可在模型下拉中选择。</p>
        </div>
        <div className="routing-grid">
          {(Object.keys(scenarioLabels) as TaskScenario[]).map((scenario) => {
            const item = draft.scenarios[scenario];
            const selection = item.current;
            const allowedModels = draft.allowed_models[selection.agent_id];
            const lockedMultimodal = scenario === 'multimodal';
            return (
              <div className="routing-card" key={scenario}>
                <div className="routing-card-head">
                  <div>
                    <strong>{scenarioLabels[scenario]}</strong>
                    <p>{item.description}</p>
                  </div>
                  {lockedMultimodal && <Pill tone="blue">MiMo flash only</Pill>}
                </div>
                <label>
                  <span>默认 Agent</span>
                  <select
                    disabled={lockedMultimodal}
                    value={selection.agent_id}
                    onChange={(event) => updateScenario(scenario, { agent_id: event.target.value as RoutingAgentId })}
                  >
                    <option value="mimo">MiMo</option>
                    <option value="reasonix-tui">Reasonix TUI</option>
                  </select>
                </label>
                <label>
                  <span>默认模型</span>
                  <select
                    disabled={lockedMultimodal}
                    value={selection.model}
                    onChange={(event) => updateScenario(scenario, { model: event.target.value })}
                  >
                    {allowedModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>思考强度</span>
                  <select value={selection.reasoning_effort} onChange={(event) => updateScenario(scenario, { reasoning_effort: event.target.value as ReasoningEffort })}>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                  </select>
                </label>
                <div className="routing-recommendation">
                  <strong>推荐参考</strong>
                  <span>MiMo：{item.recommended.mimo.model} / {effortLabels[item.recommended.mimo.reasoning_effort]}</span>
                  <span>Reasonix：{item.recommended['reasonix-tui'].model} / {effortLabels[item.recommended['reasonix-tui'].reasoning_effort]}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel wide">
        <PanelHeader title="价格和模型限制" helper="用于理解 Auto 模式的成本取向。" />
        <div className="model-whitelist-grid">
          <div className="model-card">
            <AgentBadge agent="mimo" />
            <ul>
              <li><code>mimo-v2.5-flash</code>：支持多模态；flash 价格，适合简单/普通任务。</li>
              <li><code>mimo-v2.5-pro</code>：不支持多模态；pro 价格，适合复杂/高风险任务。</li>
              {ultraSpeedEnabled && <li><code>mimo-v2.5-pro-ultraspeed</code>：不支持多模态；ultra_speed 价格（约 Pro 3 倍），适合很急的复杂/大输出任务。</li>}
            </ul>
          </div>
          <div className="model-card">
            <AgentBadge agent="reasonix-tui" />
            <ul>
              <li><code>deepseek-v4-flash</code>：文本任务；flash 价格。</li>
              <li><code>deepseek-v4-pro</code>：文本任务；pro 价格。</li>
            </ul>
          </div>
          <div className="model-card">
            <strong>价格 / 1M token</strong>
            <ul>
              <li>flash：输入 ¥{draft.pricing_per_1m_cny.flash.input}，输出 ¥{draft.pricing_per_1m_cny.flash.output}，缓存命中 ¥{draft.pricing_per_1m_cny.flash.cache_hit}</li>
              <li>pro：输入 ¥{draft.pricing_per_1m_cny.pro.input}，输出 ¥{draft.pricing_per_1m_cny.pro.output}，缓存命中 ¥{draft.pricing_per_1m_cny.pro.cache_hit}</li>
              {ultraSpeedEnabled && <li>ultra_speed：输入 ¥{ultraSpeedPricing.input}，输出 ¥{ultraSpeedPricing.output}，缓存命中 ¥{ultraSpeedPricing.cache_hit}</li>}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function TaskTable({
  tasks,
  onOpenTask,
  onDeleteTask,
  selectedTaskIds = [],
  onToggleTask,
  showSummaries = false,
}: {
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  selectedTaskIds?: string[];
  onToggleTask?: (taskId: string, checked: boolean) => void;
  showSummaries?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {onToggleTask && <th className="select-col">选择</th>}
            <th>task_id</th>
            <th>Agent</th>
            <th>状态</th>
            <th>任务摘要</th>
            <th>风险</th>
            <th>更新</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              {onToggleTask && (
                <td className="select-col">
                  <input checked={selectedTaskIds.includes(task.id)} onChange={(event) => onToggleTask(task.id, event.target.checked)} type="checkbox" />
                </td>
              )}
              <td>
                <code>{task.id}</code>
              </td>
              <td>
                <AgentBadge agent={task.agent} />
              </td>
              <td>
                <Pill tone={statusMeta[task.status].tone}>{statusMeta[task.status].label}</Pill>
              </td>
              <td className="task-summary-cell">
                <strong>{task.title}</strong>
                {showSummaries ? <span>{task.summary}</span> : <span className="muted-text one-line">摘要已折叠</span>}
              </td>
              <td>
                {task.riskFlags.length === 0 ? <span className="muted-text">无</span> : <span className="risk-count">{task.riskFlags.length}</span>}
              </td>
              <td>{task.updatedAt}</td>
              <td>
                <div className="table-actions">
                  <button className="link-button" onClick={() => onOpenTask(task.id)} type="button">
                    查看
                  </button>
                  {task.canDelete && (
                    <button className="link-button danger-link" onClick={() => onDeleteTask(task.id)} type="button">
                      删除
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({ label, value, tone, helper }: { label: string; value: number | string; tone: string; helper: string }) {
  return (
    <div className={'metric-card tone-' + tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </div>
  );
}

function PanelHeader({ title, helper }: { title: string; helper: string }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <p>{helper}</p>
    </div>
  );
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={'pill tone-' + tone}>{children}</span>;
}

function AgentBadge({ agent }: { agent: string }) {
  const label = agent === 'reasonix-tui' ? 'Reasonix TUI' : agent === 'mimo' ? 'MiMo' : agent;
  const tone = agent === 'reasonix-tui' ? 'agent-reasonix' : 'agent-mimo';
  return <span className={'agent-badge ' + tone}>{label}</span>;
}

function RiskBadge({ risk }: { risk: RiskFlag }) {
  const meta = riskMeta[risk];
  return <span className={'risk-badge ' + meta.severity}>{meta.label}</span>;
}

function InfoBlock({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'danger' }) {
  return (
    <div className={'info-block ' + tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SafetyItem({ title, body }: { title: string; body: string }) {
  return (
    <div className="safety-item">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <div>
        <div className="empty-icon">∅</div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

function SystemRow({ label, status, detail }: { label: string; status: string; detail: string }) {
  const goodStatuses = new Set(['模拟在线', '已规避', '在线', 'ready']);
  return (
    <div className="system-row">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <Pill tone={goodStatuses.has(status) ? 'green' : status.includes('降级') || status.includes('需检查') ? 'amber' : 'neutral'}>{status}</Pill>
    </div>
  );
}

function ConfirmDialog({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setSubmitting(true);
    try {
      await action.onConfirm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" aria-modal="true" role="dialog" aria-labelledby="confirm-title">
        <span className="eyebrow">二次确认</span>
        <h2 id="confirm-title">{action.title}</h2>
        <p>{action.body}</p>
        <div className="dialog-actions">
          <button className="button ghost" disabled={submitting} onClick={onClose} type="button">
            取消
          </button>
          <button className={action.tone === 'danger' ? 'button danger' : 'button primary'} disabled={submitting} onClick={() => void confirm()} type="button">
            {submitting ? '处理中…' : action.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function LiveViewerPanel({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [data, setData] = useState<LiveTaskView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const liveStats = useMemo(() => {
    const events = data?.events ?? [];
    return {
      messages: events.filter((event) => event.kind === 'message').length,
      tools: events.filter((event) => event.kind === 'tool').length,
      system: events.filter((event) => event.kind === 'event').length,
    };
  }, [data]);
  const liveItems = useMemo(() => groupLiveEvents(data?.events ?? []), [data]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const result = await fetchLiveTask(taskId);
        if (!cancelled) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }

    void poll();
    timer = setInterval(() => void poll(), 1500);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [taskId]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className={'live-viewer-dialog ' + (expanded ? 'expanded' : '')} aria-modal="true" role="dialog" aria-labelledby="live-viewer-title" onClick={(e) => e.stopPropagation()}>
        <div className="live-viewer-header">
          <div>
            <span className="eyebrow">只读实时查看</span>
            <h2 id="live-viewer-title">运行事件 · {taskId}</h2>
          </div>
          <div className="live-viewer-actions">
            <button className="button ghost" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)} type="button">
              {expanded ? '还原' : '放大'}
            </button>
            <button className="button ghost" onClick={onClose} type="button">
              关闭
            </button>
          </div>
        </div>

        {data && (
          <div className="live-viewer-meta">
            <Pill tone={data.is_live ? 'blue' : 'neutral'}>{data.is_live ? '运行中' : data.status}</Pill>
            <span>轮次 {data.current_round}</span>
            <span>更新：{formatDateTime(data.updated_at) ?? data.updated_at}</span>
            {data.truncated && <span className="muted-text">（事件已截断）</span>}
          </div>
        )}

        {data && (
          <div className="live-viewer-summary" aria-label="运行事件统计">
            <span><strong>{liveStats.messages}</strong> 条回复</span>
            <span><strong>{liveStats.tools}</strong> 个工具调用</span>
            <span><strong>{liveStats.system}</strong> 条系统事件</span>
            <span className="muted-text">优先展示 Agent 可见回复，工具调用默认折叠。</span>
          </div>
        )}

        <div className="live-viewer-events">
          {loading && <div className="lane-empty">加载中…</div>}
          {error && <div className="notice-banner error"><span>!</span><p>{error}</p></div>}
          {!loading && !error && data && data.events.length === 0 && (
            <div className="lane-empty">暂无运行事件。</div>
          )}
          {!loading && !error && data && liveItems.map((item) => (
            item.type === 'tool_group' ? (
              <details className="live-tool-group" key={item.key}>
                <summary className="live-tool-group-summary">
                  <span className={'live-event-kind tool'}>工具调用组</span>
                  <span className="live-event-time">
                    {formatEventTime(item.events[0].event.timestamp)} - {formatEventTime(item.events[item.events.length - 1].event.timestamp)}
                  </span>
                  <span className="live-event-status">{item.events.length} 次</span>
                  <span className="live-event-preview">{liveToolGroupPreview(item.events.map((entry) => entry.event))}</span>
                </summary>
                <div className="live-tool-group-body">
                  {item.events.map((entry) => (
                    <LiveCollapsedEvent event={entry.event} key={entry.index} />
                  ))}
                </div>
              </details>
            ) : item.event.kind === 'message' ? (
              <article className="live-message-card" key={item.key}>
                <div className="live-message-avatar" aria-hidden="true">AI</div>
                <div className="live-message-body">
                  <div className="live-message-meta">
                    <span className={'live-event-kind ' + item.event.kind}>{liveEventLabel(item.event, data.agent)}</span>
                    <span className="live-event-time">{formatEventTime(item.event.timestamp)}</span>
                  </div>
                  <pre className="live-message-text">{item.event.summary}</pre>
                </div>
              </article>
            ) : (
              <LiveCollapsedEvent event={item.event} key={item.key} />
            )
          ))}
        </div>

        <div className="live-viewer-footer">
          <span className="muted-text">每 1.5 秒自动刷新；关闭面板停止轮询。只读模式，不提供输入或控制。</span>
        </div>
      </section>
    </div>
  );
}

function LiveCollapsedEvent({ event }: { event: LiveEvent }) {
  return (
    <details className={'live-event-card collapsed ' + event.kind}>
      <summary className="live-event-collapsed-summary">
        <span className="live-event-time">{formatEventTime(event.timestamp)}</span>
        <span className={'live-event-kind ' + event.kind}>{liveEventLabel(event)}</span>
        {event.tool && <span className="live-event-tool">{event.tool}</span>}
        {event.status && <span className="live-event-status">{event.status}</span>}
        <span className="live-event-preview">{liveEventPreview(event)}</span>
      </summary>
      <pre className="live-event-summary">{event.summary}</pre>
    </details>
  );
}

function filterLabel(status: 'all' | TaskStatus) {
  if (status === 'all') {
    return '全部';
  }
  return statusMeta[status].label;
}

function toQueueItems(queue: QueueStatusResponse, tasks: Task[]): QueueItem[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const running = tasks
    .filter((task) => task.status === 'running')
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      status: 'running' as const,
      startedAt: task.updatedAt,
      note: '来自 /api/tasks；后续写任务由 P4 队列串行执行。',
    }));

  const queued = queue.queue.map((item, index) => {
    const task = taskById.get(item.taskId);
    return {
      taskId: item.taskId,
      title: task?.title ?? item.taskId,
      status: 'queued' as const,
      position: index + 1,
      note: '优先级 ' + item.priority + '；排队时间 ' + new Date(item.enqueuedAt).toLocaleTimeString('zh-CN'),
    };
  });

  const fallbackQueued =
    queue.queued > 0 && queued.length === 0
      ? [
          {
            taskId: 'queue_placeholder',
            title: '队列中任务',
            status: 'queued' as const,
            position: 1,
            note: '队列 API 暂未返回具体任务项。',
          },
        ]
      : [];

  return [...running, ...queued, ...fallbackQueued];
}

function mergeTask(tasks: Task[], task: Task): Task[] {
  const exists = tasks.some((current) => current.id === task.id);
  if (!exists) {
    return [task, ...tasks];
  }
  return tasks.map((current) => (current.id === task.id ? task : current));
}

function mergeTaskListPreservingDetail(current: Task[], incoming: Task[]): Task[] {
  if (incoming.length === 0) {
    return [];
  }
  const currentById = new Map(current.map((task) => [task.id, task]));
  return incoming.map((task) => {
    const previous = currentById.get(task.id);
    if (!previous || previous.source === 'mock') {
      return task;
    }
    const previousLooksDetailed = previous.changedFiles.length > task.changedFiles.length || !previous.diffStat.includes('列表接口未提供');
    if (!previousLooksDetailed) {
      return task;
    }
    return {
      ...previous,
      agent: task.agent,
      status: task.status,
      summary: task.summary || previous.summary,
      updatedAt: task.updatedAt,
      riskFlags: task.riskFlags.length > 0 ? task.riskFlags : previous.riskFlags,
      canReply: task.canReply,
      replyBlockers: task.replyBlockers,
      replyLabel: task.replyLabel,
      canDelete: task.canDelete,
      deleteBlockers: task.deleteBlockers,
      deleteLabel: task.deleteLabel,
      routing: task.routing ?? previous.routing,
    };
  });
}

type TokenUsageRow = {
  label: string;
  input: string;
  output: string;
  total: string;
  cache: string;
  cacheRead: string;
  cacheWrite: string;
  hitRate: string;
  cost: string;
  raw: TokenRawUsage;
};

type TokenRawUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

type TokenTimeRange = '1h' | '24h' | '7d' | '30d' | 'all';

const TOKEN_RANGE_OPTIONS: Array<{ key: TokenTimeRange; label: string }> = [
  { key: '1h', label: '近 1 小时' },
  { key: '24h', label: '近 24 小时' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'all', label: '全部' },
];

const TOKEN_RANGE_LABELS = Object.fromEntries(TOKEN_RANGE_OPTIONS.map((item) => [item.key, item.label])) as Record<TokenTimeRange, string>;

function readTokenStatus(tokenStatus: unknown): {
  connected: boolean;
  input: string;
  output: string;
  total: string;
  cacheRead: string;
  cacheWrite: string;
  cost: string;
  helper: string;
  costHelper: string;
  historyCount: number;
  timeRanges: TokenUsageRow[];
  agents: TokenUsageRow[];
  modelRows: TokenUsageRow[];
  models: string[];
  usageFor: (range: TokenTimeRange, model: string) => TokenUsageRow;
} {
  const emptyRow = makeTokenUsageRow('全部', null);
  if (!isRecord(tokenStatus)) {
    return {
      connected: false,
      input: '—',
      output: '—',
      total: '—',
      cacheRead: '—',
      cacheWrite: '—',
      cost: '—',
      helper: '等待真实数据',
      costHelper: '等待 API 数据',
      historyCount: 0,
      timeRanges: [],
      agents: [],
      modelRows: [],
      models: [],
      usageFor: () => emptyRow,
    };
  }
  const used = isRecord(tokenStatus.used) ? tokenStatus.used : null;
  const analytics = isRecord(tokenStatus.analytics) ? tokenStatus.analytics : null;
  const input = formatTokenNumber(readUsageNumber(used, 'input_tokens'));
  const output = formatTokenNumber(readUsageNumber(used, 'output_tokens'));
  const total = formatTokenNumber(readUsageNumber(used, 'total_tokens'));
  const cacheRead = formatTokenNumber(readUsageNumber(used, 'cache_read_tokens'));
  const cacheWrite = formatTokenNumber(readUsageNumber(used, 'cache_write_tokens'));
  const costNumber = readUsageNumber(used, 'estimated_cost');
  const cost = formatCny(costNumber);
  const timeRanges = readTimeRangeRows(analytics);
  const agents = readAgentRows(analytics);
  const modelRows = readModelRows(analytics);
  const models = modelRows.map((row) => row.label);
  const historyCount = typeof analytics?.history_count === 'number' ? analytics.history_count : 0;
  return {
    connected: true,
    input,
    output,
    total,
    cacheRead,
    cacheWrite,
    cost,
    helper: total === '0' ? 'API 已连接；暂无完成任务 token' : '来自真实 Agent 事件',
    costHelper: cost === '¥0.0000' ? 'API 已连接；暂无完成任务成本' : '来自真实 Agent 事件',
    historyCount,
    timeRanges,
    agents,
    modelRows,
    models,
    usageFor: (range, modelName) => {
      if (modelName === 'all') {
        return makeTokenUsageRow(TOKEN_RANGE_LABELS[range], isRecord(analytics?.time_ranges) ? analytics.time_ranges[range] : null);
      }
      const byRange = isRecord(analytics?.time_ranges_by_model) ? analytics.time_ranges_by_model : null;
      const rangeRecord = isRecord(byRange?.[range]) ? byRange[range] : null;
      return makeTokenUsageRow(modelName, rangeRecord?.[modelName]);
    },
  };
}

function readTimeRangeRows(analytics: Record<string, unknown> | null): TokenUsageRow[] {
  const ranges = isRecord(analytics?.time_ranges) ? analytics.time_ranges : null;
  const labels = [
    ['1h', '近 1 小时'],
    ['24h', '近 24 小时'],
    ['7d', '近 7 天'],
    ['30d', '近 30 天'],
    ['all', '全部'],
  ] as const;
  return labels.map(([key, label]) => makeTokenUsageRow(label, ranges?.[key]));
}

function readAgentRows(analytics: Record<string, unknown> | null): TokenUsageRow[] {
  const byAgent = isRecord(analytics?.by_agent) ? analytics.by_agent : null;
  if (!byAgent) return [];
  return Object.entries(byAgent)
    .sort(([agentA], [agentB]) => agentA.localeCompare(agentB))
    .map(([agent, usage]) => makeTokenUsageRow(agent, usage));
}

function readModelRows(analytics: Record<string, unknown> | null): TokenUsageRow[] {
  const byModel = isRecord(analytics?.by_model) ? analytics.by_model : null;
  if (!byModel) return [];
  return Object.entries(byModel)
    .sort(([modelA], [modelB]) => modelA.localeCompare(modelB))
    .map(([model, usage]) => makeTokenUsageRow(model, usage));
}

function makeTokenUsageRow(label: string, usage: unknown): TokenUsageRow {
  const record = isRecord(usage) ? usage : null;
  const cacheRead = readUsageNumber(record, 'cache_read_tokens');
  const cacheWrite = readUsageNumber(record, 'cache_write_tokens');
  const input = readUsageNumber(record, 'input_tokens');
  const totalInput = input + cacheRead;
  const raw = {
    input_tokens: input,
    output_tokens: readUsageNumber(record, 'output_tokens'),
    total_tokens: readUsageNumber(record, 'total_tokens'),
    estimated_cost: readUsageNumber(record, 'estimated_cost'),
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
  };
  return {
    label,
    input: formatTokenNumber(raw.input_tokens),
    output: formatTokenNumber(raw.output_tokens),
    total: formatTokenNumber(raw.total_tokens),
    cache: formatTokenNumber(cacheRead + cacheWrite),
    cacheRead: formatTokenNumber(cacheRead),
    cacheWrite: formatTokenNumber(cacheWrite),
    hitRate: totalInput > 0 ? ((cacheRead / totalInput) * 100).toFixed(1) + '%' : '0.0%',
    cost: formatCny(raw.estimated_cost),
    raw,
  };
}

function readUsageNumber(record: Record<string, unknown> | null, field: string): number {
  const value = record?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatTokenNumber(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString();
}

function formatCompactToken(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  if (safe >= 10000) {
    return (safe / 10000).toFixed(safe >= 1000000 ? 1 : 2) + ' 万';
  }
  return safe.toLocaleString();
}

function formatCny(value: number): string {
  return '¥' + Math.max(0, value).toFixed(4);
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readFileAttachment(file: File): Promise<CreateTaskAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      const mimeType = file.type || 'application/octet-stream';
      resolve({
        name: file.name || (mimeType.startsWith('image/') ? 'pasted-image.png' : 'attachment.bin'),
        mime_type: mimeType,
        size_bytes: file.size,
        base64,
        kind: mimeType.startsWith('image/') ? 'image' : 'file',
      });
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '未知大小';
  }
  if (bytes < 1024) {
    return bytes + ' B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatClock(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatEventTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function liveEventLabel(event: LiveEvent, agent?: string): string {
  if (event.kind === 'message') return agentDisplayName(agent ?? 'mimo') + ' 回复';
  if (event.kind === 'tool') return '工具调用';
  return '事件';
}

function liveEventPreview(event: LiveEvent): string {
  const firstLine = event.summary.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? event.event_type;
  const maxLength = 120;
  return firstLine.length > maxLength ? firstLine.slice(0, maxLength) + '…' : firstLine;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('浏览器不允许访问剪贴板');
  }
}

export default App;

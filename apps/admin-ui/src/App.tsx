import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
  worktreeTask,
  type AgentStatusResponse,
  type HealthResponse,
  type QueueStatusResponse,
  type TaskOpenAction,
} from './api';
import { CODEX_NEW_THREAD_URL, copyCodexReviewPrompt, resolveCodexHandoffUrl } from './codex-handoff.mjs';
import { canAbandonTaskStatus, canAcceptTaskStatus, canCancelTaskStatus, canDiscardWorktreeStatus, canReplyTaskStatus } from './task-actions';
import type {
  ChangedFile,
  CreateTaskInput,
  FocusedTaskResult,
  FullTaskResult,
  IncludeTestsMode,
  LiveEvent,
  LiveTaskView,
  QueueItem,
  RiskFlag,
  ScopeMode,
  Task,
  TaskLogsResult,
  TaskStatus,
} from './types';

type Page = 'overview' | 'tasks' | 'create' | 'queue' | 'token' | 'system' | 'detail';

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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

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

      setHealth(nextHealth);
      setAgents(nextAgents);
      setTasks((current) => mergeTaskListPreservingDetail(current, nextTasks));
      setQueueItems(toQueueItems(nextQueue, nextTasks));
      setTokenStatus(nextToken);
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

  async function refreshTaskDetail(taskId: string) {
    if (!apiReachable) {
      return;
    }
    try {
      const agent = tasks.find((candidate) => candidate.id === taskId)?.agent ?? 'mimo';
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
      await refreshTaskDetail(taskId);
    }
  }

  async function handleReply(taskId: string, message: string, priority: number, agent: string) {
    await runAction('正在发送回复…', '回复已发送，执行 Agent 将继续处理。', () => replyTask(taskId, message, priority, agent), {
      refreshTaskId: taskId,
    });
  }

  async function handleOpenTaskTarget(taskId: string, action: TaskOpenAction) {
    const label = action === 'reasonix_gui' ? 'Reasonix GUI' : action === 'session_folder' ? '会话文件夹' : '任务文件夹';
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
              onCreate={() => setPage('create')}
            />
          )}
          {page === 'create' && <CreateTaskPage actionBusy={Boolean(actionBusy)} agents={agents} onCreate={handleCreateTask} />}
          {page === 'queue' && <QueuePage queueItems={queueItems} onOpenTask={openTask} />}
          {page === 'token' && <TokenPage tokenStatus={tokenStatus} onReset={confirmTokenReset} actionBusy={Boolean(actionBusy)} />}
          {page === 'system' && <SystemPage agents={agents} health={health} apiError={apiError} />}
          {page === 'detail' &&
            (selectedTask ? (
              <TaskDetailPage
                actionBusy={actionBusy}
                task={selectedTask}
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
  onCreate,
}: {
  tasks: Task[];
  filter: 'all' | TaskStatus;
  onFilterChange: (status: 'all' | TaskStatus) => void;
  onOpenTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onCreate: () => void;
}) {
  const [showSafeDeleteOnly, setShowSafeDeleteOnly] = useState(false);
  const statusFiltered = filter === 'all' ? tasks : tasks.filter((task) => task.status === filter);
  const filtered = showSafeDeleteOnly ? statusFiltered.filter((task) => task.canDelete) : statusFiltered;
  const safeDeleteCount = statusFiltered.filter((task) => task.canDelete).length;
  const statuses: Array<'all' | TaskStatus> = ['all', 'queued', 'running', 'waiting', 'review', 'accepted', 'failed', 'cancelled', 'abandoned'];

  return (
    <section className="panel wide page-panel">
      <div className="section-title">
        <PanelHeader title="任务列表" helper="第一版只做状态筛选和手动刷新，不做服务端全文搜索。" />
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
      </div>
      {filtered.length === 0 ? <EmptyState title="没有匹配任务" body="换一个状态筛选，或创建一个新的 MiMo 任务。" /> : <TaskTable tasks={filtered} onOpenTask={onOpenTask} onDeleteTask={onDeleteTask} />}
    </section>
  );
}

function CreateTaskPage({
  actionBusy,
  agents,
  onCreate,
}: {
  actionBusy: boolean;
  agents: AgentStatusResponse[];
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
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!agentOptions.some((agent) => agent.id === agentId)) {
      setAgentId(agentOptions[0]?.id ?? 'mimo');
    }
  }, [agentId, agentOptions]);

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

    const input: CreateTaskInput = {
      agent_id: agentId,
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
    };

    setSubmitting(true);
    try {
      await onCreate(input);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="create-layout">
      <section className="panel">
        <PanelHeader title="新建 Agent 任务" helper="选择 MiMo 或 Reasonix TUI；已有写任务时新任务会安全排队。" />
        <form className="task-form" onSubmit={handleSubmit}>
          {formError && <div className="form-error">{formError}</div>}
          <label>
            <span>执行 Agent *</span>
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.display_name || agent.id} ({agent.status})
                </option>
              ))}
            </select>
            <small className="field-help">MiMo 是稳定路径；Reasonix TUI 当前支持 one-shot 任务、低上下文审查和会话映射。</small>
          </label>
          <label>
            <span>任务目标 *</span>
            <textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="例如：为管理页面接入真实取消/验收 API，并补充错误提示。" rows={5} />
          </label>
          <label>
            <span>工作区路径 *</span>
            <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="C:\Users\...\mimo-bridge-mcp" />
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
  actionBusy,
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
  actionBusy: string | null;
  onReply: (taskId: string, message: string, priority: number, agent: string) => Promise<void>;
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
    setLocalError(null);
    setReplying(true);
    try {
      await onReply(task.id, message, task.priority, task.agent);
      setReplyMessage('');
    } finally {
      setReplying(false);
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
            {task.agent === 'reasonix-tui' && (
              <>
                <button className="button soft" disabled={Boolean(actionBusy)} onClick={() => void onOpenTaskTarget(task.id, 'session_folder')} type="button">
                  打开会话文件夹
                </button>
                <button className="button soft" disabled={Boolean(actionBusy)} onClick={() => void onOpenTaskTarget(task.id, 'reasonix_gui')} type="button">
                  打开 Reasonix GUI
                </button>
              </>
            )}
            <span className="action-helper">由本地 daemon 按任务记录解析路径；浏览器不会传任意本地路径。</span>
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
              placeholder={'说明需要 ' + agentDisplayName(task.agent) + ' 继续修复的问题，或给出下一步要求。'}
              rows={5}
              value={replyMessage}
            />
            <button className="button soft" disabled={!canReply || Boolean(actionBusy) || replying} onClick={() => void submitReply()} type="button">
              {replying ? '发送中…' : '发送回复'}
            </button>
          </div>

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

  return (
    <div className="page-grid">
      <section className="panel wide token-panel">
        <PanelHeader title="Token 预算" helper="来自 MiMo 事件和 Reasonix 会话 JSONL 中的真实 tokens/cost，按当前守护进程运行期累计。" />
        <div className="token-empty">
          <div className="orb">◌</div>
          <h2>{token.connected ? 'Token API 已连接' : '统计暂不可用'}</h2>
          <p>
            {token.connected
              ? '当前显示来自本地守护进程的 token-budget 状态；完成新的 MiMo 或 Reasonix 任务后，会自动累计日志中明确提供的真实 token 和 cost。'
              : '暂时无法读取本地守护进程的 token-budget 状态。'}
          </p>
          <div className="token-grid">
            <MetricCard label="输入 Token" value={token.input} tone="neutral" helper={token.helper} />
            <MetricCard label="输出 Token" value={token.output} tone="neutral" helper={token.helper} />
            <MetricCard label="预估成本" value={token.cost} tone="neutral" helper={token.costHelper} />
          </div>
          <button className="button danger" disabled={actionBusy} onClick={onReset} type="button">
            重置预算（需确认）
          </button>
        </div>
      </section>
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

function TaskTable({
  tasks,
  onOpenTask,
  onDeleteTask,
}: {
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
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
              <td>
                <code>{task.id}</code>
              </td>
              <td>
                <AgentBadge agent={task.agent} />
              </td>
              <td>
                <Pill tone={statusMeta[task.status].tone}>{statusMeta[task.status].label}</Pill>
              </td>
              <td>
                <strong>{task.title}</strong>
                <span>{task.summary}</span>
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

        <div className="live-viewer-events">
          {loading && <div className="lane-empty">加载中…</div>}
          {error && <div className="notice-banner error"><span>!</span><p>{error}</p></div>}
          {!loading && !error && data && data.events.length === 0 && (
            <div className="lane-empty">暂无运行事件。</div>
          )}
          {!loading && !error && data && data.events.map((event, index) => (
            event.kind === 'message' ? (
              <article className={'live-event-card ' + event.kind} key={index}>
                <div className="live-event-card-header">
                  <span className="live-event-time">{formatEventTime(event.timestamp)}</span>
                  <span className={'live-event-kind ' + event.kind}>{liveEventLabel(event)}</span>
                </div>
                <pre className="live-event-summary">{event.summary}</pre>
              </article>
            ) : (
              <details className={'live-event-card collapsed ' + event.kind} key={index}>
                <summary className="live-event-collapsed-summary">
                  <span className="live-event-time">{formatEventTime(event.timestamp)}</span>
                  <span className={'live-event-kind ' + event.kind}>{liveEventLabel(event)}</span>
                  {event.tool && <span className="live-event-tool">{event.tool}</span>}
                  {event.status && <span className="live-event-status">{event.status}</span>}
                  <span className="live-event-preview">{liveEventPreview(event)}</span>
                </summary>
                <pre className="live-event-summary">{event.summary}</pre>
              </details>
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
      status: task.status,
      summary: task.summary || previous.summary,
      updatedAt: task.updatedAt,
      riskFlags: task.riskFlags.length > 0 ? task.riskFlags : previous.riskFlags,
    };
  });
}

function readTokenStatus(tokenStatus: unknown): {
  connected: boolean;
  input: string;
  output: string;
  cost: string;
  helper: string;
  costHelper: string;
} {
  if (!isRecord(tokenStatus)) {
    return {
      connected: false,
      input: '—',
      output: '—',
      cost: '—',
      helper: '等待真实数据',
      costHelper: '等待 API 数据',
    };
  }
  const used = isRecord(tokenStatus.used) ? tokenStatus.used : null;
  const input = typeof used?.input_tokens === 'number' ? used.input_tokens.toLocaleString() : '—';
  const output = typeof used?.output_tokens === 'number' ? used.output_tokens.toLocaleString() : '—';
  const cost = typeof used?.estimated_cost === 'number' ? '$' + used.estimated_cost.toFixed(4) : '—';
  return {
    connected: true,
    input,
    output,
    cost,
    helper: input === '0' || output === '0' ? 'API 已连接；暂无完成任务 token' : '来自真实 Agent 事件',
    costHelper: cost === '$0.0000' ? 'API 已连接；暂无完成任务成本' : '来自真实 Agent 事件',
  };
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatClock(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatEventTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function liveEventLabel(event: LiveEvent): string {
  if (event.kind === 'message') return 'MiMo 回复';
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

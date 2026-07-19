import '@phosphor-icons/web/regular';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import {
  add,
  agentTree,
  clearAttention,
  focus,
  focused,
  list,
  markClaude,
  markInput,
  markOutput,
  remove,
  reorder,
  setLabel,
  setModel,
  setName,
  subscribe,
  type WorkflowLabel,
} from './agents';
import { AgentTerminal } from './terminal';
import { syncTiles } from './tiles';
import { renderSidebar } from './sidebar';
import { renderTopbar, renderProjectTabs } from './topbar';
import { renderTree, revealInTree } from './tree';
import { mountBroadcast, updateBroadcast, openComposer } from './broadcast';
import { openPalette, type Command } from './palette';
import { mountBoard, openBoard, closeBoard, isBoardOpen } from './board';
import { mountViewer, openViewer, closeViewer, isViewerOpen } from './viewer';
import { mountGit, openGit, closeGit, isGitOpen } from './git';
import { mountTaskStrip, renderTaskStrip } from './taskstrip';
import {
  subscribeProjects,
  current as currentProject,
  listProjects,
  selectProject,
} from './projects';
import {
  sessionAgents, activeSession, subscribeOrchestrators,
  addOrchestrator, setOrchestratorRoot, selectSession, orchestratorPrompt,
  openNewOrchestrator, removeOrchestrator,
} from './orchestrators';
import {
  addTask,
  updateTask,
  loadTasks,
  allTasks,
  snapshotFor,
  subscribeTasks,
  type Task,
} from './tasks';
import { getSettings, openSettings, defaultModel, defaultEffort } from './settings';
import { openTemplates, type Template } from './templates';
import { chime } from './sound';
import { showInstallHelp } from './installs';
import { randomName } from './naming';
import { visibleProviders, subscribeProviders, spawnModelArgs, providerModels } from './providers';
import { renderWelcome } from './welcome';
import './styles.css';

const terms = new Map<string, AgentTerminal>();
// Output that arrives before its AgentTerminal is registered is buffered and flushed on create.
const pending = new Map<string, Uint8Array[]>();
// When each agent was spawned — a near-immediate exit means the CLI failed to start.
const spawnTimes = new Map<string, number>();
// Block persistence until restoreAgents() has read the saved list, so the empty
// startup store can never overwrite it before restore runs.
let restoring = true;

const tbLeftEl = document.getElementById('tb-left')!;
const tbRightEl = document.getElementById('tb-right')!;
const projtabsEl = document.getElementById('projtabs')!;
const sidebarEl = document.getElementById('sidebar')!;
const stageEl = document.getElementById('stage')!;
const treeEl = document.getElementById('tree')!;
const broadcastEl = document.getElementById('broadcast')!;
const boardMountEl = document.getElementById('board')!;
const viewerEl = document.getElementById('viewer')!;
const gitEl = document.getElementById('git')!;
const statuslineEl = document.getElementById('statusline')!;
const taskstripEl = document.getElementById('taskstrip')!;
const welcomeEl = document.getElementById('welcome')!;

function fitAll() {
  for (const t of terms.values()) t.fitNow();
}

function toggleFocus(id: string) {
  clearAttention(id); // you're looking at it now
  focus(focused() === id ? null : id);
}

// Native notification when an agent finishes a turn (unless you're watching it).
let notifOk = false;
isPermissionGranted().then((g) => {
  if (g) notifOk = true;
  else void requestPermission().then((p) => (notifOk = p === 'granted'));
});
const notified = new Set<string>();
function syncNotifications() {
  const cur = focused();
  for (const a of list()) {
    if (a.attention && !notified.has(a.id)) {
      notified.add(a.id);
      if (a.id !== cur) {
        if (getSettings().sound) chime();
        if (notifOk && getSettings().notifications) {
          sendNotification({ title: `${a.name} needs you`, body: a.title ?? a.dir });
        }
      }
    } else if (!a.attention) {
      notified.delete(a.id);
    }
  }
}

function closeAgent(id: string) {
  void invoke('kill_agent', { id }).catch(() => {});
  terms.get(id)?.dispose();
  terms.delete(id);
  pending.delete(id);
  spawnTimes.delete(id);
  remove(id);
}

// Change an agent's model/effort from its header. claude switches both in place
// via /model and /effort (keeps context). Providers with no live command just
// record the value — it applies on the next spawn / a manual Restart.
function setAgentModel(id: string, model?: string, effort?: string) {
  const a = list().find((x) => x.id === id);
  if (!a) return;
  const cat = providerModels(a.agentId);
  if (model && cat?.live) broadcast([id], cat.live(model), false);
  if (effort && cat?.liveEffort) broadcast([id], cat.liveEffort(effort), false);
  setModel(id, model, effort);
}

// Relaunch an agent with its recorded model/effort — the way effort/non-claude
// model changes take effect. Loses the session (fresh CLI), same dir/name.
function restartAgent(id: string) {
  const a = list().find((x) => x.id === id);
  if (!a) return;
  const { agentId, dir, name, model, effort, label } = a;
  closeAgent(id);
  void spawn(agentId, dir, label, { name, model, effort });
}

// Agents belonging to the current project tab — each tab is its own panel.
function curProjPath(): string | null {
  return currentProject()?.path ?? null;
}
function visibleAgents() {
  return sessionAgents(list(), activeSession(), curProjPath());
}
function agentCounts(): { working: number; idle: number } {
  let working = 0, idle = 0;
  for (const a of visibleAgents()) {
    if (a.status === 'working') working++;
    else if (a.status === 'idle') idle++;
  }
  return { working, idle };
}

// Broadcast: write the text + Enter to every selected agent's PTY.
function broadcast(ids: string[], text: string, numbered: boolean) {
  const vis = visibleAgents();
  const total = vis.length;
  const labels = new Map(agentTree(vis).map((n) => [n.agent.id, n.label]));
  for (const id of ids) {
    markInput(id);
    const num = labels.get(id) ?? '?'; // hierarchical number shown on the tile/rail
    const msg = numbered ? `You are agent ${num} of ${total}. ${text}` : text;
    void invoke('write_agent', { id, data: msg });
    // Send Enter as a SEPARATE write a beat later so TUIs (claude/codex) submit
    // instead of treating the \r as a newline inside the input box.
    setTimeout(() => void invoke('write_agent', { id, data: '\r' }), 90);
  }
}

function globalZoom(delta: number) {
  for (const t of terms.values()) (delta > 0 ? t.zoomIn() : t.zoomOut());
}

// Combine a slot's standing role prompt with the run-time task: {task} placeholder
// if present, otherwise append. Either side may be empty.
function slotMessage(prompt: string | undefined, task: string): string {
  const p = (prompt ?? '').trim();
  if (p.includes('{task}')) return p.replace(/\{task\}/g, task).trim();
  return [p, task].filter(Boolean).join('\n\n');
}
async function runTemplate(t: Template, task: string) {
  const p = currentProject();
  if (!p) {
    alert('Open a project first — a fleet template spawns its agents in the current project.');
    return;
  }
  for (const s of t.slots) {
    const msg = slotMessage(s.prompt, task);
    await spawn(s.provider, p.path, undefined, { name: s.role, prompt: msg || undefined, model: s.model, effort: s.effort });
  }
}
function showTemplates() {
  openTemplates({
    onRun: (t, task) => void runTemplate(t, task),
    providers: visibleProviders,
    currentAgents: () => visibleAgents().map((a) => ({ provider: a.agentId, role: a.name })),
  });
}

function showGit() {
  closeBoard();
  closeViewer();
  openGit();
}

function buildCommands(): Command[] {
  const cmds: Command[] = [];
  const p = currentProject();
  if (p) {
    for (const ag of visibleProviders()) {
      cmds.push({ label: `Spawn ${ag}`, hint: p.name, run: () => void spawn(ag, p.path) });
    }
  }
  const STATUSES: { key: WorkflowLabel | undefined; text: string }[] = [
    { key: 'planning', text: 'Planning' },
    { key: 'in-progress', text: 'In progress' },
    { key: 'in-review', text: 'In review' },
    { key: 'done', text: 'Done' },
    { key: undefined, text: 'Clear status' },
  ];
  for (const a of visibleAgents()) {
    cmds.push({
      label: `Focus ${a.name}`,
      hint: a.agentId,
      run: () => {
        clearAttention(a.id);
        focus(a.id);
      },
    });
    cmds.push({ label: `Kill ${a.name}`, hint: a.agentId, run: () => closeAgent(a.id) });
    for (const st of STATUSES) {
      cmds.push({
        label: `Set ${a.name} → ${st.text}`,
        hint: a.agentId,
        run: () => setLabel(a.id, st.key),
      });
    }
  }
  for (const pr of listProjects()) {
    if (pr.path !== p?.path)
      cmds.push({ label: `Switch to ${pr.name}`, hint: pr.path, run: () => selectProject(pr.path) });
  }
  cmds.push({ label: 'Show grid', run: () => focus(null) });
  cmds.push({ label: 'Zoom in (all terminals)', run: () => globalZoom(1) });
  cmds.push({ label: 'Zoom out (all terminals)', run: () => globalZoom(-1) });
  cmds.push({ label: 'Toggle agents panel', run: () => toggleSide('tt.left') });
  cmds.push({ label: 'Toggle tree panel', run: () => toggleSide('tt.right') });
  cmds.push({ label: 'Toggle OLED / dim mode', run: toggleOled });
  cmds.push({ label: 'Fleet templates…', run: showTemplates });
  cmds.push({ label: 'Open task board', run: () => { closeViewer(); closeGit(); openBoard(); } });
  cmds.push({ label: 'Open git', run: showGit });
  return cmds;
}

function applyCollapse() {
  document.body.classList.toggle('left-collapsed', localStorage.getItem('tt.left') === '0');
  document.body.classList.toggle('right-collapsed', localStorage.getItem('tt.right') === '0');
}
function toggleSide(key: 'tt.left' | 'tt.right') {
  const collapsed = localStorage.getItem(key) === '0';
  localStorage.setItem(key, collapsed ? '1' : '0');
  applyCollapse();
  requestAnimationFrame(fitAll);
}

function applyOled() {
  document.body.classList.toggle('oled', localStorage.getItem('tt.oled') === '1');
  document.body.classList.toggle('hide-btn-kbd', localStorage.getItem('tt.hideBtnKbd') === '1');
}
function toggleOled() {
  localStorage.setItem('tt.oled', localStorage.getItem('tt.oled') === '1' ? '0' : '1');
  applyOled();
}

// Agent-driven UI — re-renders on every agent store change.
function renderAgents() {
  const vis = visibleAgents();
  renderSidebar(sidebarEl, vis, {
    onFocusToggle: toggleFocus,
    onClose: closeAgent,
    onSetLabel: setLabel,
    onReorder: reorder,
    onGrid: () => focus(null),
  });
  syncTiles(stageEl, vis, focused(), terms, {
    onToggleFocus: toggleFocus,
    onClose: closeAgent,
    onSetLabel: setLabel,
    onRename: setName,
    onReorder: reorder,
    onSetModel: setAgentModel,
    onRestart: restartAgent,
  });
  updateBroadcast(vis);
  syncNotifications();
  persistAgents();
  // Push a snapshot for the MCP server's list_agents tool (hierarchical numbers).
  const mcpLabels = new Map(agentTree(list()).map((n) => [n.agent.id, n.label]));
  void invoke('mcp_set_agents', {
    json: JSON.stringify(
      list().map((a) => ({
        number: mcpLabels.get(a.id) ?? '',
        name: a.name,
        kind: a.agentId,
        dir: a.dir,
        status: a.status,
        session: a.key ? `tt-${a.key}` : '', // tmux session, for read_agent capture
      })),
    ),
  }).catch(() => {});
  renderTaskStrip();
}

function treeHandlers() {
  return {
    onOpenAgent: (folder: string, agentId: string) => void spawn(agentId, folder),
    onOpenFile: (p: string) => {
      closeBoard();
      closeGit();
      void openViewer(p);
    },
  };
}

// ⌘K fzf: search the active project's files+folders; open a file, or reveal a folder.
async function fileSearchProvider(q: string): Promise<Command[]> {
  const p = currentProject();
  if (!p) return [];
  let entries: { name: string; path: string; dir: boolean }[] = [];
  try {
    entries = await invoke('search_paths', { root: p.path, query: q, limit: 60 });
  } catch {
    entries = [];
  }
  const base = p.path.replace(/\/$/, '');
  return entries.map((e) => ({
    label: e.name,
    hint: e.path.startsWith(base + '/') ? e.path.slice(base.length + 1) : e.path,
    run: () => {
      if (e.dir) void revealInTree(treeEl, p.path, treeHandlers(), e.path);
      else {
        closeBoard();
        closeGit();
        void openViewer(e.path);
      }
    },
  }));
}

// Project-driven UI — topbar + tree, only re-renders on project change.
function renderProject() {
  // No projects yet → show the centered welcome/onboarding screen.
  document.body.classList.toggle('no-project', listProjects().length === 0);
  renderProjectTabs(projtabsEl, {
    onZoomIn: () => globalZoom(1),
    onZoomOut: () => globalZoom(-1),
    onNewOrchestrator: () => openNewOrchestrator(handleCreateOrchestrator),
    onCloseOrchestrator: closeOrchestrator,
  });
  renderTopbar(tbLeftEl, tbRightEl, {
    onSpawn: (agentId) => {
      const p = currentProject();
      if (p) void spawn(agentId, p.path);
    },
    onToggleLeft: () => toggleSide('tt.left'),
    onToggleRight: () => toggleSide('tt.right'),
    onTemplates: showTemplates,
    onBoard: () => { closeViewer(); closeGit(); openBoard(); },
    onGit: showGit,
  });
  void renderTree(treeEl, currentProject()?.path ?? null, treeHandlers());
  pushTasks();
}

// Typed into every freshly spawned agent so it self-orients: it's one of a
// fleet sharing the tt MCP + task board. Full tool docs come from the MCP's
// own initialize instructions — this is just the nudge to go look.
// ponytail: assumes the CLI has the tt MCP configured (see docs/MCP.md).
const ORIENT =
  "[tt] You're one agent in a tt fleet sharing a task board and the tt MCP. " +
  'Use its tools to coordinate — list_tasks/add_task/update_task (board), ' +
  'list_agents/send/broadcast/spawn_agent (agents). Check list_tasks first for your work.';

async function spawn(
  agentId: string,
  dir: string,
  label?: WorkflowLabel,
  opts?: { spawned?: boolean; parentId?: string; prompt?: string; name?: string; model?: string; effort?: string; session?: string },
) {
  const st = getSettings();
  const key = crypto.randomUUID();
  // Template slot > provider default > CLI's own default.
  const model = opts?.model || defaultModel(agentId);
  const effort = agentId === 'claude' ? opts?.effort || defaultEffort() : undefined;
  try {
    const id = await invoke<string>('spawn_agent', {
      projectDir: dir,
      agentId,
      permMode: agentId === 'claude' ? st.claudeMode : undefined,
      sessionKey: key,
      extraArgs: spawnModelArgs(agentId, model, effort),
    });
    const t = new AgentTerminal(id);
    terms.set(id, t);
    spawnTimes.set(id, Date.now());
    const q = pending.get(id);
    if (q) {
      pending.delete(id);
      for (const b of q) t.write(b);
    }
    add({
      id,
      agentId,
      name: opts?.name || randomName(),
      dir,
      status: 'working',
      key,
      project: curProjPath() ?? undefined,
      spawned: opts?.spawned,
      parentId: opts?.parentId,
      session: opts?.session,
      label: label ?? (st.autoPlanning ? 'planning' : undefined),
      model: model || undefined,
      effort,
    });
    if (st.autoFocus) focus(id);
    // ponytail: fixed 2.5s delay to let the CLI boot before typing the first
    // prompt — TUIs eat input sent before they're ready. Swap for a readiness
    // signal (claude jsonl / prompt-detected) if this proves flaky.
    // Orient only fleet-spawned agents (via the tt MCP). A human spawning an
    // agent themselves doesn't need the nudge — just send their prompt, if any.
    const msg = opts?.spawned
      ? (opts.prompt ? `${ORIENT}\n\n${opts.prompt}` : ORIENT)
      : opts?.prompt;
    if (msg) setTimeout(() => broadcast([id], msg, false), 2500);
    return id;
  } catch (e) {
    alert(`spawn failed: ${e}`);
    return undefined;
  }
}

// Create a live orchestrator: a claude lead in its own session, handed the lead
// role prompt + goal. It spawns its own workers into this session via MCP.
async function handleCreateOrchestrator(dir: string, goal: string) {
  const id = crypto.randomUUID();
  const name = goal.split('\n')[0].slice(0, 32) || 'Orchestrator';
  addOrchestrator({ id, name, dir, goal });
  selectSession(id); // switch the view to the new session before the tile appears
  const agentId = await spawn('claude', dir, undefined, { prompt: orchestratorPrompt(goal), session: id });
  if (agentId) setOrchestratorRoot(id, agentId);
}

// Close an orchestrator: kill its whole fleet (root + workers), drop the record,
// and fall back to General if it was the active session.
function closeOrchestrator(id: string) {
  for (const a of list()) if (a.session === id) closeAgent(a.id);
  removeOrchestrator(id); // clears activeId if it was active (see store)
}

// Tasks: persist to localStorage and keep the MCP snapshot (active project) fresh.
function persistTasks() {
  localStorage.setItem('tt.tasks', JSON.stringify(allTasks()));
}
function pushTasks() {
  void invoke('mcp_set_tasks', { json: snapshotFor(curProjPath() ?? '') }).catch(() => {});
}
function restoreTasks() {
  try {
    const raw = JSON.parse(localStorage.getItem('tt.tasks') ?? '[]');
    if (Array.isArray(raw)) loadTasks(raw as Task[]);
  } catch {
    /* ignore corrupt store */
  }
}

// Persist agent metadata so we can reattach live tmux sessions on next launch.
function persistAgents() {
  if (restoring) return; // don't clobber the saved list before restoreAgents() reads it
  const data = list()
    .filter((a) => a.key)
    .map((a) => ({ agentId: a.agentId, name: a.name, dir: a.dir, label: a.label, key: a.key, project: a.project, model: a.model, effort: a.effort }));
  localStorage.setItem('tt.agents', JSON.stringify(data));
}

async function restoreAgents() {
  try {
    let saved: Array<{ agentId?: string; name?: string; dir?: string; label?: string; key?: string; project?: string }> = [];
    try {
      const raw = JSON.parse(localStorage.getItem('tt.agents') ?? '[]');
      if (Array.isArray(raw)) saved = raw;
    } catch {
      /* ignore */
    }
    await reattachAll(saved);
  } finally {
    restoring = false;
    persistAgents(); // now safe to sync localStorage to what actually reattached
  }
}

async function reattachAll(
  saved: Array<{ agentId?: string; name?: string; dir?: string; label?: string; key?: string; project?: string; model?: string; effort?: string }>,
) {
  for (const rec of saved) {
    if (!rec?.key || !rec?.agentId || !rec?.dir) continue;
    const alive = await invoke<boolean>('session_alive', { sessionKey: rec.key }).catch(() => false);
    if (!alive) continue; // tmux session gone (reboot etc.) -> drop it
    try {
      const id = await invoke<string>('spawn_agent', {
        projectDir: rec.dir,
        agentId: rec.agentId,
        permMode: rec.agentId === 'claude' ? getSettings().claudeMode : undefined,
        sessionKey: rec.key,
      });
      const t = new AgentTerminal(id);
      terms.set(id, t);
      const q = pending.get(id);
      if (q) {
        pending.delete(id);
        for (const b of q) t.write(b);
      }
      add({
        id,
        agentId: rec.agentId,
        name: rec.name ?? rec.agentId,
        dir: rec.dir,
        status: 'working',
        key: rec.key,
        project: rec.project,
        label: rec.label as WorkflowLabel | undefined,
        model: rec.model,
        effort: rec.effort,
      });
    } catch {
      /* skip */
    }
  }
}

listen<{ id: string; data: number[] }>('agent-output', (e) => {
  const { id, data } = e.payload;
  markOutput(id);
  const bytes = new Uint8Array(data);
  const t = terms.get(id);
  if (t) {
    t.write(bytes);
  } else {
    const q = pending.get(id) ?? [];
    q.push(bytes);
    pending.set(id, q);
  }
});
listen<{ id: string }>('agent-exit', (e) => {
  const id = e.payload.id;
  const a = list().find((x) => x.id === id);
  const born = spawnTimes.get(id);
  spawnTimes.delete(id);
  // Died within a few seconds while still in the store (not user-closed) -> failed to start.
  if (a && a.agentId !== 'terminal' && born && Date.now() - born < 4000) {
    showInstallHelp(a.agentId);
  }
  // Agent exited (Ctrl+C, /exit, crash) -> drop the tile and clean up its tmux
  // session, rather than leaving a dead "exited" tile behind.
  closeAgent(id);
});
listen<{ id: string; title?: string; tokens: number }>('agent-claude', (e) =>
  markClaude(e.payload.id, e.payload.title, e.payload.tokens),
);

// OS file drop -> type the path(s) into the PTY of the agent tile under the
// cursor, so dragging an image onto an agent hands it the path (claude reads
// image paths from its prompt). Needs dragDropEnabled:true in tauri.conf — a
// webview never exposes real filesystem paths to a plain DOM drop.
void getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type !== 'drop') return;
  const r = window.devicePixelRatio || 1; // drop position is physical px
  const el = document.elementFromPoint(e.payload.position.x / r, e.payload.position.y / r);
  const id = el?.closest<HTMLElement>('.tile')?.dataset.agentId;
  if (!id || !terms.has(id)) return;
  const quote = (p: string) => (/\s/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p);
  markInput(id);
  void invoke('write_agent', { id, data: e.payload.paths.map(quote).join(' ') + ' ' });
});

// MCP server -> UI: an agent (via the tt MCP tools) asked to spawn/send/broadcast/close.
// Numbers are 1-based positions in list() (matches the list_agents snapshot).
listen<{ agent: string; dir: string; prompt?: string }>('mcp-spawn', (e) =>
  void spawn(e.payload.agent, e.payload.dir, undefined, {
    spawned: true,
    parentId: focused() ?? undefined, // best-effort: the agent you're watching spawned it
    prompt: e.payload.prompt || undefined,
  }),
);
listen<{ number: string; text: string }>('mcp-send', (e) => {
  const byLabel = new Map(agentTree(list()).map((n) => [n.label, n.agent.id]));
  const id = byLabel.get(String(e.payload.number));
  if (id) broadcast([id], e.payload.text, false);
});
listen<{ text: string; numbered: boolean }>('mcp-broadcast', (e) =>
  broadcast(
    list().map((a) => a.id),
    e.payload.text,
    e.payload.numbered,
  ),
);
listen<{ number: string }>('mcp-close', (e) => {
  const byLabel = new Map(agentTree(list()).map((n) => [n.label, n.agent.id]));
  const id = byLabel.get(String(e.payload.number));
  if (id) closeAgent(id);
});
// An agent set its own workflow status pill via MCP. Rust already validated the enum.
listen<{ number: string; status: WorkflowLabel }>('mcp-set-status', (e) => {
  const byLabel = new Map(agentTree(list()).map((n) => [n.label, n.agent.id]));
  const id = byLabel.get(String(e.payload.number));
  if (id) setLabel(id, e.payload.status);
});

subscribeTasks(() => {
  persistTasks();
  pushTasks();
});

listen<{ id: string; title: string; description: string }>('mcp-task-add', (e) => {
  const p = curProjPath();
  if (p) addTask(p, e.payload.title, e.payload.description || undefined, e.payload.id);
});
const TASK_STATUSES: WorkflowLabel[] = ['planning', 'in-progress', 'in-review', 'needs-human', 'done'];
listen<{ id: string; status?: string; assignee?: string; result?: string }>('mcp-task-update', (e) => {
  const { id, ...patch } = e.payload;
  // Drop an out-of-enum status from an agent (e.g. "in progress") — an invalid
  // status matches no column and would orphan the card off the board.
  if (patch.status && !TASK_STATUSES.includes(patch.status as WorkflowLabel)) delete patch.status;
  updateTask(id, patch as Partial<Task>);
});

subscribe(renderAgents);
subscribeProjects(() => {
  renderProject();
  renderAgents(); // switching tabs changes which agents are visible
});
subscribeOrchestrators(() => {
  renderProject();
  renderAgents(); // switching sessions changes which agents are visible
});
subscribeProviders(renderProject); // hiding/showing providers re-renders the toolbar
window.addEventListener('resize', fitAll);

// Keyboard shortcuts (⌘): 1-9 focus agent, 0 grid, +/- zoom all, B/\ panels.
window.addEventListener('keydown', (e) => {
  // ⌘⌥B toggles the right (agents) panel — VS Code's secondary-sidebar shortcut.
  if (e.metaKey && e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'b') {
    toggleSide('tt.left'); // agents rail (right panel)
    e.preventDefault();
    return;
  }
  if (!e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '9') {
    const pr = listProjects()[Number(e.key) - 1];
    if (pr) {
      selectProject(pr.path);
      e.preventDefault();
    }
  } else if (e.key === '0') {
    focus(null);
    e.preventDefault();
  } else if (e.key === '=' || e.key === '+') {
    globalZoom(1);
    e.preventDefault();
  } else if (e.key === '-' || e.key === '_') {
    globalZoom(-1);
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'b') {
    toggleSide('tt.right'); // folder tree
    e.preventDefault();
  } else if (e.key === '\\') {
    toggleSide('tt.left'); // agents rail
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'j') {
    if (isBoardOpen()) closeBoard();
    else { closeViewer(); closeGit(); openBoard(); }
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'g') {
    if (isGitOpen()) closeGit();
    else showGit();
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'k') {
    openPalette(buildCommands(), fileSearchProvider);
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'l') {
    openComposer();
    e.preventDefault();
  } else if (e.key === ',') {
    openSettings();
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'f') {
    showTemplates();
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'w') {
    const f = focused();
    if (f) closeAgent(f);
    e.preventDefault(); // don't let Cmd-W close the window
  } else if (e.key.toLowerCase() === 'n') {
    const p = currentProject();
    if (p) void spawn(getSettings().defaultAgent, p.path);
    e.preventDefault();
  } else if (e.key.toLowerCase() === 't') {
    const p = currentProject();
    if (p) void spawn('terminal', p.path);
    e.preventDefault();
  }
});

applyCollapse();
applyOled();
mountBroadcast(broadcastEl, { onSend: broadcast });
mountBoard(boardMountEl, () => curProjPath());
mountViewer(viewerEl, () => curProjPath(), {
  agents: () => agentTree(visibleAgents()).map((n) => ({ id: n.agent.id, label: n.label, name: n.agent.name })),
  to: (id, text) => broadcast([id], text, false),
});
mountGit(gitEl, () => curProjPath(), {
  getAgents: () => visibleAgents().map((a) => ({ id: a.id, name: a.name, dir: a.dir, status: a.status })),
  revealFolder: (p) => {
    closeGit();
    const proj = currentProject();
    if (proj) void revealInTree(treeEl, proj.path, treeHandlers(), p);
  },
  openFile: (p) => {
    closeGit();
    void openViewer(p);
  },
});
// Escape closes the code viewer (matches settings/palette/etc.).
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isViewerOpen()) closeViewer();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isGitOpen()) closeGit();
});
mountTaskStrip(taskstripEl, statuslineEl, { getProject: () => curProjPath(), getAgents: agentCounts });
renderWelcome(welcomeEl, () => openNewOrchestrator(handleCreateOrchestrator));
renderProject();
renderAgents();
restoreTasks();
void restoreAgents();

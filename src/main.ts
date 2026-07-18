import '@phosphor-icons/web/regular';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
  markExit,
  markInput,
  markOutput,
  remove,
  reorder,
  setLabel,
  setName,
  subscribe,
  type WorkflowLabel,
} from './agents';
import { AgentTerminal } from './terminal';
import { syncTiles } from './tiles';
import { renderSidebar } from './sidebar';
import { renderTopbar, renderProjectTabs } from './topbar';
import { renderTree } from './tree';
import { mountBroadcast, updateBroadcast } from './broadcast';
import { openPalette, type Command } from './palette';
import { subscribeProjects, current as currentProject } from './projects';
import { getSettings, openSettings } from './settings';
import { openTemplates, type Template } from './templates';
import { chime } from './sound';
import { showInstallHelp } from './installs';
import { randomName } from './naming';
import './styles.css';

const terms = new Map<string, AgentTerminal>();
// Output that arrives before its AgentTerminal is registered is buffered and flushed on create.
const pending = new Map<string, Uint8Array[]>();
// When each agent was spawned — a near-immediate exit means the CLI failed to start.
const spawnTimes = new Map<string, number>();
// Block persistence until restoreAgents() has read the saved list, so the empty
// startup store can never overwrite it before restore runs.
let restoring = true;

const topbarEl = document.getElementById('topbar')!;
const projtabsEl = document.getElementById('projtabs')!;
const sidebarEl = document.getElementById('sidebar')!;
const stageEl = document.getElementById('stage')!;
const treeEl = document.getElementById('tree')!;
const broadcastEl = document.getElementById('broadcast')!;

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

// Agents belonging to the current project tab — each tab is its own panel.
function curProjPath(): string | null {
  return currentProject()?.path ?? null;
}
function visibleAgents() {
  const p = curProjPath();
  return list().filter((a) => a.project === p);
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

async function runTemplate(t: Template) {
  for (const a of t.agents) await spawn(a.agentId, a.dir, a.label);
}
function showTemplates() {
  openTemplates({
    onRun: (t) => void runTemplate(t),
    currentAgents: () => visibleAgents().map((a) => ({ agentId: a.agentId, dir: a.dir, label: a.label })),
  });
}

function buildCommands(): Command[] {
  const cmds: Command[] = [];
  const p = currentProject();
  if (p) {
    for (const ag of ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'terminal']) {
      cmds.push({ label: `Spawn ${ag}`, hint: p.name, run: () => void spawn(ag, p.path) });
    }
  }
  for (const a of visibleAgents()) {
    cmds.push({
      label: `Focus ${a.name}`,
      hint: a.agentId,
      run: () => {
        clearAttention(a.id);
        focus(a.id);
      },
    });
  }
  cmds.push({ label: 'Show grid', run: () => focus(null) });
  cmds.push({ label: 'Zoom in (all terminals)', run: () => globalZoom(1) });
  cmds.push({ label: 'Zoom out (all terminals)', run: () => globalZoom(-1) });
  cmds.push({ label: 'Toggle agents panel', run: () => toggleSide('tt.left') });
  cmds.push({ label: 'Toggle tree panel', run: () => toggleSide('tt.right') });
  cmds.push({ label: 'Toggle OLED / dim mode', run: toggleOled });
  cmds.push({ label: 'Fleet templates…', run: showTemplates });
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
      })),
    ),
  }).catch(() => {});
}

// Project-driven UI — topbar + tree, only re-renders on project change.
function renderProject() {
  renderProjectTabs(projtabsEl);
  renderTopbar(topbarEl, {
    onSpawn: (agentId) => {
      const p = currentProject();
      if (p) void spawn(agentId, p.path);
    },
    onToggleLeft: () => toggleSide('tt.left'),
    onToggleRight: () => toggleSide('tt.right'),
    onZoomIn: () => globalZoom(1),
    onZoomOut: () => globalZoom(-1),
    onSettings: openSettings,
    onTemplates: showTemplates,
  });
  void renderTree(treeEl, currentProject()?.path ?? null, {
    onOpenAgent: (folder, agentId) => void spawn(agentId, folder),
  });
}

async function spawn(
  agentId: string,
  dir: string,
  label?: WorkflowLabel,
  opts?: { spawned?: boolean; parentId?: string },
) {
  const st = getSettings();
  const key = crypto.randomUUID();
  try {
    const id = await invoke<string>('spawn_agent', {
      projectDir: dir,
      agentId,
      permMode: agentId === 'claude' ? st.claudeMode : undefined,
      sessionKey: key,
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
      name: randomName(),
      dir,
      status: 'working',
      key,
      project: curProjPath() ?? undefined,
      spawned: opts?.spawned,
      parentId: opts?.parentId,
      label: label ?? (st.autoPlanning ? 'planning' : undefined),
    });
    if (st.autoFocus) focus(id);
  } catch (e) {
    alert(`spawn failed: ${e}`);
  }
}

// Persist agent metadata so we can reattach live tmux sessions on next launch.
function persistAgents() {
  if (restoring) return; // don't clobber the saved list before restoreAgents() reads it
  const data = list()
    .filter((a) => a.key)
    .map((a) => ({ agentId: a.agentId, name: a.name, dir: a.dir, label: a.label, key: a.key, project: a.project }));
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
  saved: Array<{ agentId?: string; name?: string; dir?: string; label?: string; key?: string; project?: string }>,
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
    closeAgent(id);
  } else {
    markExit(id);
  }
});
listen<{ id: string; title?: string; tokens: number }>('agent-claude', (e) =>
  markClaude(e.payload.id, e.payload.title, e.payload.tokens),
);

// MCP server -> UI: an agent (via the tt MCP tools) asked to spawn/send/broadcast/close.
// Numbers are 1-based positions in list() (matches the list_agents snapshot).
listen<{ agent: string; dir: string }>('mcp-spawn', (e) =>
  void spawn(e.payload.agent, e.payload.dir, undefined, {
    spawned: true,
    parentId: focused() ?? undefined, // best-effort: the agent you're watching spawned it
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

subscribe(renderAgents);
subscribeProjects(() => {
  renderProject();
  renderAgents(); // switching tabs changes which agents are visible
});
window.addEventListener('resize', fitAll);

// Keyboard shortcuts (⌘): 1-9 focus agent, 0 grid, +/- zoom all, B/\ panels.
window.addEventListener('keydown', (e) => {
  if (!e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '9') {
    const a = visibleAgents()[Number(e.key) - 1];
    if (a) {
      clearAttention(a.id);
      focus(a.id);
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
  } else if (e.key.toLowerCase() === 'k') {
    openPalette(buildCommands());
    e.preventDefault();
  } else if (e.key === ',') {
    openSettings();
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
renderProject();
renderAgents();
void restoreAgents();

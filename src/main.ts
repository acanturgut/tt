import '@phosphor-icons/web/regular';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  add,
  focus,
  focused,
  list,
  markClaude,
  markExit,
  markOutput,
  remove,
  reorder,
  setLabel,
  setName,
  subscribe,
} from './agents';
import { AgentTerminal } from './terminal';
import { syncTiles } from './tiles';
import { renderSidebar } from './sidebar';
import { renderTopbar } from './topbar';
import { renderTree } from './tree';
import { mountBroadcast, updateBroadcast } from './broadcast';
import { subscribeProjects, current as currentProject } from './projects';
import './styles.css';

const terms = new Map<string, AgentTerminal>();
// Output that arrives before its AgentTerminal is registered is buffered and flushed on create.
const pending = new Map<string, Uint8Array[]>();

const topbarEl = document.getElementById('topbar')!;
const sidebarEl = document.getElementById('sidebar')!;
const stageEl = document.getElementById('stage')!;
const treeEl = document.getElementById('tree')!;
const broadcastEl = document.getElementById('broadcast')!;

function fitAll() {
  for (const t of terms.values()) t.fitNow();
}

function toggleFocus(id: string) {
  focus(focused() === id ? null : id);
}

function closeAgent(id: string) {
  void invoke('kill_agent', { id }).catch(() => {});
  terms.get(id)?.dispose();
  terms.delete(id);
  pending.delete(id);
  remove(id);
}

// Broadcast: write the text + Enter to every selected agent's PTY.
function broadcast(ids: string[], text: string) {
  for (const id of ids) void invoke('write_agent', { id, data: `${text}\r` });
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

// Agent-driven UI — re-renders on every agent store change.
function renderAgents() {
  renderSidebar(sidebarEl, {
    onFocusToggle: toggleFocus,
    onClose: closeAgent,
    onSetLabel: setLabel,
    onReorder: reorder,
    onGrid: () => focus(null),
  });
  syncTiles(stageEl, list(), focused(), terms, {
    onToggleFocus: toggleFocus,
    onClose: closeAgent,
    onSetLabel: setLabel,
    onRename: setName,
    onReorder: reorder,
  });
  updateBroadcast(list());
}

// Project-driven UI — topbar + tree, only re-renders on project change.
function renderProject() {
  renderTopbar(topbarEl, {
    onSpawn: (agentId) => {
      const p = currentProject();
      if (p) void spawn(agentId, p.path);
    },
    onToggleLeft: () => toggleSide('tt.left'),
    onToggleRight: () => toggleSide('tt.right'),
  });
  void renderTree(treeEl, currentProject()?.path ?? null, {
    onOpenAgent: (folder, agentId) => void spawn(agentId, folder),
  });
}

async function spawn(agentId: string, dir: string) {
  try {
    const id = await invoke<string>('spawn_agent', { projectDir: dir, agentId });
    const t = new AgentTerminal(id);
    terms.set(id, t);
    const q = pending.get(id);
    if (q) {
      pending.delete(id);
      for (const b of q) t.write(b);
    }
    add({ id, agentId, name: agentId, dir, status: 'working' });
  } catch (e) {
    alert(`spawn failed: ${e}`);
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
listen<{ id: string }>('agent-exit', (e) => markExit(e.payload.id));
listen<{ id: string; title?: string; tokens: number }>('agent-claude', (e) =>
  markClaude(e.payload.id, e.payload.title, e.payload.tokens),
);

subscribe(renderAgents);
subscribeProjects(renderProject);
window.addEventListener('resize', fitAll);

applyCollapse();
mountBroadcast(broadcastEl, { onSend: broadcast });
renderProject();
renderAgents();

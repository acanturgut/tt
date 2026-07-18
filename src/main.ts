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
      if (a.id !== cur && notifOk) {
        sendNotification({ title: `${a.name} needs you`, body: a.title ?? a.dir });
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
  remove(id);
}

// Broadcast: write the text + Enter to every selected agent's PTY.
function broadcast(ids: string[], text: string) {
  for (const id of ids) {
    markInput(id);
    void invoke('write_agent', { id, data: `${text}\r` });
  }
}

function globalZoom(delta: number) {
  for (const t of terms.values()) (delta > 0 ? t.zoomIn() : t.zoomOut());
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
  syncNotifications();
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
    onZoomIn: () => globalZoom(1),
    onZoomOut: () => globalZoom(-1),
    onToggleOled: toggleOled,
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

// Keyboard shortcuts (⌘): 1-9 focus agent, 0 grid, +/- zoom all, B/\ panels.
window.addEventListener('keydown', (e) => {
  if (!e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '9') {
    const a = list()[Number(e.key) - 1];
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
    toggleSide('tt.left');
    e.preventDefault();
  } else if (e.key === '\\') {
    toggleSide('tt.right');
    e.preventDefault();
  }
});

applyCollapse();
applyOled();
mountBroadcast(broadcastEl, { onSend: broadcast });
renderProject();
renderAgents();

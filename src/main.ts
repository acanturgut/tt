import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { homeDir } from '@tauri-apps/api/path';
import {
  add,
  focus,
  focused,
  list,
  markClaude,
  markExit,
  markOutput,
  remove,
  subscribe,
} from './agents';
import { AgentTerminal } from './terminal';
import { syncTiles } from './tiles';
import { mountSidebar, updateSidebar, setDefaultDir } from './sidebar';
import './styles.css';

const COLORS = ['#e3b341', '#3fb950', '#58a6ff', '#bc8cff', '#f778ba', '#39c5cf'];
const terms = new Map<string, AgentTerminal>();
// Output that arrives before its AgentTerminal is registered (the reader thread
// can emit before spawn's invoke resolves) is buffered here and flushed on create.
const pending = new Map<string, Uint8Array[]>();
const sidebarEl = document.getElementById('sidebar')!;
const stageEl = document.getElementById('stage')!;

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

function render() {
  updateSidebar();
  syncTiles(stageEl, list(), focused(), terms, {
    onToggleFocus: toggleFocus,
    onClose: closeAgent,
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
    const color = COLORS[list().length % COLORS.length];
    add({ id, agentId, dir, color, status: 'working' });
  } catch (e) {
    alert(`spawn failed: ${e}`);
  }
}

// Fire-and-forget: we never need the unlisten handles, so no top-level await
// (Tauri's Vite build target predates top-level await).
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

mountSidebar(sidebarEl, {
  onNew: (agentId, dir) => void spawn(agentId, dir),
  onFocusToggle: toggleFocus,
  onGrid: () => focus(null),
});
subscribe(render);
window.addEventListener('resize', () => {
  for (const t of terms.values()) t.fitNow();
});
render();
homeDir().then((h) => {
  (window as any).__HOME__ = h;
  setDefaultDir(h);
  render();
});

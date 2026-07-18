import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { homeDir } from '@tauri-apps/api/path';
import { add, focus, focused, list, markClaude, markExit, markOutput, subscribe } from './agents';
import { AgentTerminal } from './terminal';
import { syncTiles } from './tiles';
import { renderSidebar } from './sidebar';
import './styles.css';

const COLORS = ['#e3b341', '#3fb950', '#58a6ff', '#bc8cff', '#f778ba', '#39c5cf'];
const terms = new Map<string, AgentTerminal>();
const sidebarEl = document.getElementById('sidebar')!;
const stageEl = document.getElementById('stage')!;

function toggleFocus(id: string) {
  focus(focused() === id ? null : id);
}

function render() {
  renderSidebar(sidebarEl, {
    onNew: (agentId, dir) => void spawn(agentId, dir),
    onFocusToggle: toggleFocus,
    onGrid: () => focus(null),
  });
  syncTiles(stageEl, list(), focused(), terms, { onToggleFocus: toggleFocus });
}

async function spawn(agentId: string, dir: string) {
  try {
    const id = await invoke<string>('spawn_agent', { projectDir: dir, agentId });
    terms.set(id, new AgentTerminal(id));
    const color = COLORS[list().length % COLORS.length];
    add({ id, agentId, dir, color, status: 'working' });
  } catch (e) {
    alert(`spawn failed: ${e}`);
  }
}

// Fire-and-forget: we never need the unlisten handles, so no top-level await
// (Tauri's Vite target predates top-level await).
listen<{ id: string; data: number[] }>('agent-output', (e) => {
  markOutput(e.payload.id);
  terms.get(e.payload.id)?.write(new Uint8Array(e.payload.data));
});
listen<{ id: string }>('agent-exit', (e) => markExit(e.payload.id));
listen<{ id: string; title?: string; tokens: number }>('agent-claude', (e) =>
  markClaude(e.payload.id, e.payload.title, e.payload.tokens),
);

subscribe(render);
window.addEventListener('resize', () => {
  for (const t of terms.values()) t.fitNow();
});
render(); // initial paint (folder input falls back to '~' until home resolves)
homeDir().then((h) => {
  (window as any).__HOME__ = h;
  render();
});

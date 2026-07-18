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
  setLabel,
  subscribe,
  type WorkflowLabel,
} from './agents';
import { AgentTerminal } from './terminal';
import { syncTiles } from './tiles';
import { renderSidebar } from './sidebar';
import { renderTopbar } from './topbar';
import { renderTree } from './tree';
import { subscribeProjects, current as currentProject } from './projects';
import './styles.css';

// Blue/cyan family so per-agent identity colors sit with the blue accent theme.
const COLORS = ['#2f81f7', '#58a6ff', '#39c5cf', '#56d4dd', '#79c0ff', '#a5d6ff'];
const terms = new Map<string, AgentTerminal>();
// Output that arrives before its AgentTerminal is registered is buffered and flushed on create.
const pending = new Map<string, Uint8Array[]>();

const topbarEl = document.getElementById('topbar')!;
const sidebarEl = document.getElementById('sidebar')!;
const stageEl = document.getElementById('stage')!;
const treeEl = document.getElementById('tree')!;

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

function setAgentLabel(id: string, label: WorkflowLabel | undefined) {
  setLabel(id, label);
}

// Agent-driven UI — re-renders on every agent store change.
function renderAgents() {
  renderSidebar(sidebarEl, {
    onFocusToggle: toggleFocus,
    onClose: closeAgent,
    onSetLabel: setAgentLabel,
    onGrid: () => focus(null),
  });
  syncTiles(stageEl, list(), focused(), terms, {
    onToggleFocus: toggleFocus,
    onClose: closeAgent,
    onSetLabel: setAgentLabel,
  });
}

// Project-driven UI — topbar + tree, only re-renders on project change.
function renderProject() {
  renderTopbar(topbarEl, { onChange: renderProject });
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
    const color = COLORS[list().length % COLORS.length];
    add({ id, agentId, dir, color, status: 'working' });
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
window.addEventListener('resize', () => {
  for (const t of terms.values()) t.fitNow();
});

renderProject();
renderAgents();

import { list, focused, type Agent, type WorkflowLabel } from './agents';
import { statusPill } from './statuspill';

const DOT: Record<Agent['status'], string> = {
  working: '#3fb950',
  idle: '#8b949e',
  exited: '#f85149',
};

export interface SidebarHandlers {
  onFocusToggle: (id: string) => void;
  onClose: (id: string) => void;
  onSetLabel: (id: string, label: WorkflowLabel | undefined) => void;
  onGrid: () => void;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

// The rail is just live agent rows — no persistent form to preserve, so a full
// rebuild per store change is fine (rows are meant to reflect live state).
export function renderSidebar(root: HTMLElement, h: SidebarHandlers) {
  root.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'rail-head';
  const title = document.createElement('span');
  title.textContent = 'Agents';
  const grid = document.createElement('button');
  grid.className = 'gridbtn';
  grid.textContent = focused() ? '▦ All' : '▦ Grid';
  grid.disabled = !focused();
  grid.onclick = () => h.onGrid();
  head.append(title, grid);
  root.appendChild(head);

  const cur = focused();
  const agents = list();
  if (agents.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'rail-empty';
    empty.textContent = 'Open an agent from the tree →';
    root.appendChild(empty);
    return;
  }

  for (const a of agents) {
    const row = document.createElement('div');
    row.className = 'agentrow' + (a.id === cur ? ' active' : '');
    row.onclick = () => h.onFocusToggle(a.id);

    const top = document.createElement('div');
    top.className = 'agentrow-top';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = DOT[a.status];
    const label = document.createElement('span');
    label.className = 'label';
    label.style.color = a.color;
    label.textContent = a.agentId;
    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '×';
    close.title = 'close agent';
    close.onclick = (ev) => {
      ev.stopPropagation();
      h.onClose(a.id);
    };
    top.append(dot, label, close);

    const pill = statusPill(a, (l) => h.onSetLabel(a.id, l));
    row.append(top, pill);

    if (a.title) {
      const meta = document.createElement('div');
      meta.className = 'rail-meta';
      meta.textContent = a.title + (a.tokens ? ` · ${fmtTokens(a.tokens)}` : '');
      row.appendChild(meta);
    }
    root.appendChild(row);
  }
}

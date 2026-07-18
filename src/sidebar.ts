import { list, focused, type Agent } from './agents';

const DOT: Record<Agent['status'], string> = {
  working: '#3fb950',
  idle: '#8b949e',
  exited: '#f85149',
};

export interface SidebarHandlers {
  onNew: (agentId: string, dir: string) => void;
  onFocusToggle: (id: string) => void;
  onGrid: () => void;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

function homeDir(): string {
  return (window as any).__HOME__ ?? '~';
}

export function renderSidebar(root: HTMLElement, h: SidebarHandlers) {
  root.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'newagent';
  const dir = document.createElement('input');
  dir.type = 'text';
  dir.value = `${homeDir()}/Documents/personal/cc`;
  dir.placeholder = 'project folder';
  const pick = document.createElement('select');
  for (const a of ['claude', 'codex']) {
    const o = document.createElement('option');
    o.value = a;
    o.textContent = a;
    pick.appendChild(o);
  }
  const btn = document.createElement('button');
  btn.textContent = '+ New agent';
  btn.onclick = () => h.onNew(pick.value, dir.value.trim());
  form.append(dir, pick, btn);
  root.appendChild(form);

  const grid = document.createElement('button');
  grid.className = 'gridbtn';
  grid.textContent = focused() ? '▦ Show all' : '▦ Grid';
  grid.disabled = !focused();
  grid.onclick = () => h.onGrid();
  root.appendChild(grid);

  const cur = focused();
  for (const a of list()) {
    const row = document.createElement('div');
    row.className = 'agentrow' + (a.id === cur ? ' active' : '');
    row.onclick = () => h.onFocusToggle(a.id);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = DOT[a.status];
    const label = document.createElement('span');
    label.className = 'label';
    label.style.color = a.color;
    label.textContent = a.agentId;
    row.append(dot, label);
    if (a.title) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = a.title + (a.tokens ? ` · ${fmtTokens(a.tokens)}` : '');
      row.appendChild(meta);
    }
    root.appendChild(row);
  }
}

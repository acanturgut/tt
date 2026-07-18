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

// Persistent elements — built once so typing / selection / focus survive re-renders.
let rowsEl: HTMLElement | null = null;
let gridBtn: HTMLButtonElement | null = null;
let dirInput: HTMLInputElement | null = null;
let handlers: SidebarHandlers | null = null;

export function mountSidebar(root: HTMLElement, h: SidebarHandlers) {
  handlers = h;
  root.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'newagent';
  const dir = document.createElement('input');
  dir.type = 'text';
  dir.value = `${homeDir()}/Documents/personal/cc`;
  dir.placeholder = 'project folder';
  dirInput = dir;
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
  grid.onclick = () => h.onGrid();
  gridBtn = grid;
  root.appendChild(grid);

  const rows = document.createElement('div');
  rows.className = 'rows';
  rowsEl = rows;
  root.appendChild(rows);

  updateSidebar();
}

// Update only the volatile parts (grid button + agent rows) on each store change.
export function updateSidebar() {
  if (!rowsEl || !gridBtn || !handlers) return;
  const h = handlers;
  const cur = focused();

  gridBtn.textContent = cur ? '▦ Show all' : '▦ Grid';
  gridBtn.disabled = !cur;

  rowsEl.innerHTML = '';
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
    rowsEl.appendChild(row);
  }
}

// Once home resolves, update the folder default — but only if the user hasn't
// started editing it (still holds the '~' placeholder path).
export function setDefaultDir(home: string) {
  if (dirInput && dirInput.value.startsWith('~')) {
    dirInput.value = `${home}/Documents/personal/cc`;
  }
}

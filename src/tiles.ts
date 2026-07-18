import { gridDims } from './grid';
import type { Agent, WorkflowLabel } from './agents';
import type { AgentTerminal } from './terminal';
import { statusPill, updatePill, labelColor } from './statuspill';
import { editableName } from './naming';
import { icon } from './icon';

const DOT: Record<Agent['status'], string> = {
  working: '#3fb950',
  idle: '#8b949e',
  exited: '#f85149',
};

export interface TilesHandlers {
  onToggleFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSetLabel: (id: string, label: WorkflowLabel | undefined) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (draggedId: string, targetId: string) => void;
}

interface TileEls {
  root: HTMLElement;
  header: HTMLElement;
  name: HTMLElement;
  dot: HTMLElement;
  meta: HTMLElement;
  pill: HTMLElement;
  term: AgentTerminal;
}

const tiles = new Map<string, TileEls>();

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function syncTiles(
  stage: HTMLElement,
  agents: Agent[],
  focusedId: string | null,
  terms: Map<string, AgentTerminal>,
  h: TilesHandlers,
) {
  for (const a of agents) {
    if (tiles.has(a.id)) continue;
    const term = terms.get(a.id);
    if (!term) continue;

    const root = document.createElement('div');
    root.className = 'tile';

    const header = document.createElement('div');
    header.className = 'tile-header';
    header.onclick = () => h.onToggleFocus(a.id);

    // Drag a tile by its header to reorder the grid.
    header.draggable = true;
    header.ondragstart = (ev) => {
      ev.dataTransfer?.setData('text/plain', a.id);
      root.classList.add('dragging');
    };
    header.ondragend = () => root.classList.remove('dragging');
    root.ondragover = (ev) => {
      ev.preventDefault();
      root.classList.add('drop-target');
    };
    root.ondragleave = () => root.classList.remove('drop-target');
    root.ondrop = (ev) => {
      ev.preventDefault();
      root.classList.remove('drop-target');
      const from = ev.dataTransfer?.getData('text/plain');
      if (from) h.onReorder(from, a.id);
    };

    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = editableName(a, (nm) => h.onRename(a.id, nm));
    const pill = statusPill(a, (l) => h.onSetLabel(a.id, l));
    const meta = document.createElement('span');
    meta.className = 'meta';
    const zoomOut = document.createElement('span');
    zoomOut.className = 'zoombtn';
    zoomOut.title = 'zoom out';
    zoomOut.appendChild(icon('minus'));
    zoomOut.onclick = (ev) => {
      ev.stopPropagation();
      term.zoomOut();
    };
    const zoomIn = document.createElement('span');
    zoomIn.className = 'zoombtn';
    zoomIn.title = 'zoom in';
    zoomIn.appendChild(icon('plus'));
    zoomIn.onclick = (ev) => {
      ev.stopPropagation();
      term.zoomIn();
    };
    const close = document.createElement('span');
    close.className = 'close';
    close.title = 'close agent';
    close.appendChild(icon('x'));
    close.onclick = (ev) => {
      ev.stopPropagation();
      h.onClose(a.id);
    };
    header.append(dot, name, pill, meta, zoomOut, zoomIn, close);

    const body = document.createElement('div');
    body.className = 'tile-body';
    body.appendChild(term.el);

    root.append(header, body);
    stage.appendChild(root);
    tiles.set(a.id, { root, header, name, dot, meta, pill, term });
    term.open();
  }

  const ids = new Set(agents.map((a) => a.id));
  for (const [id, t] of tiles) {
    if (!ids.has(id)) {
      t.root.remove();
      tiles.delete(id);
    }
  }

  // Keep tile DOM order in sync with agent order (drag-reorder in the rail).
  // appendChild on an existing node just moves it, so this re-sequences cheaply.
  for (const a of agents) {
    const t = tiles.get(a.id);
    if (t) stage.appendChild(t.root);
  }

  const focusMode = !!focusedId;
  const { cols, rows } = gridDims(agents.length);
  stage.style.gridTemplateColumns = focusMode ? '1fr' : `repeat(${cols || 1}, 1fr)`;
  stage.style.gridTemplateRows = focusMode ? '1fr' : `repeat(${rows || 1}, 1fr)`;

  for (const a of agents) {
    const t = tiles.get(a.id);
    if (!t) continue;
    const visible = !focusMode || a.id === focusedId;
    t.root.style.display = visible ? 'flex' : 'none';
    t.dot.style.background = DOT[a.status];
    if (t.name.isConnected) t.name.textContent = a.name;

    // Workflow status drives the title color + a subtle banner tint (no per-agent rainbow).
    const col = labelColor(a.label);
    t.name.style.color = col ?? '';
    t.header.style.borderTopColor = col ?? '';
    t.header.style.background = col ? tint(col, 0.16) : '';

    t.meta.textContent = a.title
      ? a.title + (a.tokens ? ` · ${fmtTokens(a.tokens)}` : '')
      : '';
    updatePill(t.pill, a);
  }

  requestAnimationFrame(() => {
    for (const a of agents) {
      const t = tiles.get(a.id);
      if (t && (!focusMode || a.id === focusedId)) t.term.fitNow();
    }
  });
}

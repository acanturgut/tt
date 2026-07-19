import { gridDims } from './grid';
import { agentTree, type Agent, type WorkflowLabel } from './agents';
import type { AgentTerminal } from './terminal';
import { statusPill, updatePill, labelColor } from './statuspill';
import { modelPill, paintModelPill } from './modelpill';
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
  onSetModel: (id: string, model?: string, effort?: string) => void;
  onRestart: (id: string) => void;
}

interface TileEls {
  root: HTMLElement;
  header: HTMLElement;
  num: HTMLElement;
  name: HTMLElement;
  dot: HTMLElement;
  star: HTMLElement;
  meta: HTMLElement;
  pill: HTMLElement;
  modelChip: HTMLElement | null;
  term: AgentTerminal;
}

const tiles = new Map<string, TileEls>();
let lastOrder = '';
let lastGeo = '';

// Terminal geometry is a function of which tiles exist, their order, and whether
// one is focused (single-pane) — nothing else. Status/token/label ticks don't move
// pixels, so refitting on them is pure forced-layout waste (the old code fit every
// terminal on every render, which is what made a fleet of agents crawl).
export function layoutKey(agents: Agent[], focusedId: string | null): string {
  return `${focusedId ?? ''}|${agents.map((a) => a.id).join(',')}`;
}

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
    root.dataset.agentId = a.id; // used to route OS file-drops to this agent's PTY

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

    const num = document.createElement('span');
    num.className = 'tnum';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const star = document.createElement('span');
    star.className = 'attn';
    star.title = 'waiting for you';
    star.appendChild(icon('bell-ringing'));
    const name = editableName(a, (nm) => h.onRename(a.id, nm));
    const pill = statusPill(a, (l) => h.onSetLabel(a.id, l));
    const modelChip = modelPill(a, (m, e) => h.onSetModel(a.id, m, e), () => h.onRestart(a.id));
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
    header.append(num, dot, star, name, pill, ...(modelChip ? [modelChip] : []), meta, zoomOut, zoomIn, close);

    const body = document.createElement('div');
    body.className = 'tile-body';
    body.appendChild(term.el);

    root.append(header, body);
    stage.appendChild(root);
    tiles.set(a.id, { root, header, num, name, dot, star, meta, pill, modelChip, term });
    term.open();
  }

  const ids = new Set(agents.map((a) => a.id));
  for (const [id, t] of tiles) {
    if (!ids.has(id)) {
      t.root.remove();
      tiles.delete(id);
    }
  }

  // Re-sequence tile DOM to match agent order — ONLY when the order actually
  // changed. appendChild moves the node, and moving a tile that contains the
  // focused xterm textarea BLURS it; doing that on every output/status tick made
  // the terminals impossible to type in.
  const order = agents.map((a) => a.id).join(',');
  if (order !== lastOrder) {
    lastOrder = order;
    for (const a of agents) {
      const t = tiles.get(a.id);
      if (t) stage.appendChild(t.root);
    }
  }

  const focusMode = !!focusedId;
  document.body.classList.toggle('focus', focusMode);
  const { cols, rows } = gridDims(agents.length);
  stage.style.gridTemplateColumns = focusMode ? '1fr' : `repeat(${cols || 1}, 1fr)`;
  stage.style.gridTemplateRows = focusMode ? '1fr' : `repeat(${rows || 1}, 1fr)`;

  const labels = new Map(agentTree(agents).map((n) => [n.agent.id, n.label]));
  for (const a of agents) {
    const t = tiles.get(a.id);
    if (!t) continue;
    const lbl = labels.get(a.id) ?? '';
    t.num.textContent = lbl;
    t.num.title = `Agent ${lbl}. Type #${lbl} in the broadcast bar to message only this agent`;
    const visible = !focusMode || a.id === focusedId;
    t.root.style.display = visible ? 'flex' : 'none';
    t.dot.style.background = DOT[a.status];
    t.root.classList.toggle('attention', !!a.attention);
    t.dot.style.display = a.attention ? 'none' : ''; // alert: bell replaces the dot
    t.star.style.display = a.attention ? 'inline-flex' : 'none';
    if (t.name.isConnected) t.name.textContent = a.name;

    // Workflow status drives the title color + a subtle banner tint (no per-agent rainbow).
    const col = labelColor(a.label);
    t.name.style.color = col ?? '';
    t.header.style.background = col ? tint(col, 0.16) : '';

    t.meta.textContent = a.tokens ? `${fmtTokens(a.tokens)} tok` : '';
    updatePill(t.pill, a);
    if (t.modelChip) paintModelPill(t.modelChip, a);
  }

  // Refit only when geometry actually changed. Window-resize / panel-toggle /
  // view-return refits are driven separately (a ResizeObserver on the stage).
  const geo = layoutKey(agents, focusedId);
  if (geo !== lastGeo) {
    lastGeo = geo;
    requestAnimationFrame(() => {
      for (const a of agents) {
        const t = tiles.get(a.id);
        if (t && (!focusMode || a.id === focusedId)) t.term.fitNow();
      }
    });
  }
}

import { gridDims } from './grid';
import type { Agent } from './agents';
import type { AgentTerminal } from './terminal';

const DOT: Record<Agent['status'], string> = {
  working: '#3fb950',
  idle: '#8b949e',
  exited: '#f85149',
};

export interface TilesHandlers {
  onToggleFocus: (id: string) => void;
  onClose: (id: string) => void;
}

interface TileEls {
  root: HTMLElement;
  dot: HTMLElement;
  meta: HTMLElement;
  term: AgentTerminal;
}

const tiles = new Map<string, TileEls>();

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

export function syncTiles(
  stage: HTMLElement,
  agents: Agent[],
  focusedId: string | null,
  terms: Map<string, AgentTerminal>,
  h: TilesHandlers,
) {
  // 1. create a tile for each new agent (append once, open once)
  for (const a of agents) {
    if (tiles.has(a.id)) continue;
    const term = terms.get(a.id);
    if (!term) continue;

    const root = document.createElement('div');
    root.className = 'tile';

    const header = document.createElement('div');
    header.className = 'tile-header';
    header.style.borderTopColor = a.color;
    header.onclick = () => h.onToggleFocus(a.id);

    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.className = 'name';
    name.style.color = a.color;
    name.textContent = a.agentId;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '×';
    close.title = 'close agent';
    close.onclick = (ev) => {
      ev.stopPropagation(); // don't also toggle focus
      h.onClose(a.id);
    };
    header.append(dot, name, meta, close);

    const body = document.createElement('div');
    body.className = 'tile-body';
    body.appendChild(term.el);

    root.append(header, body);
    stage.appendChild(root);
    tiles.set(a.id, { root, dot, meta, term });
    term.open(); // el is now in the DOM
  }

  // 2. drop tiles whose agent is gone
  const ids = new Set(agents.map((a) => a.id));
  for (const [id, t] of tiles) {
    if (!ids.has(id)) {
      t.root.remove();
      tiles.delete(id);
    }
  }

  // 3. grid template (or single cell when focused)
  const focusMode = !!focusedId;
  const { cols, rows } = gridDims(agents.length);
  stage.style.gridTemplateColumns = focusMode ? '1fr' : `repeat(${cols || 1}, 1fr)`;
  stage.style.gridTemplateRows = focusMode ? '1fr' : `repeat(${rows || 1}, 1fr)`;

  // 4. per-tile visibility + header content
  for (const a of agents) {
    const t = tiles.get(a.id);
    if (!t) continue;
    const visible = !focusMode || a.id === focusedId;
    t.root.style.display = visible ? 'flex' : 'none';
    t.dot.style.background = DOT[a.status];
    t.meta.textContent = a.title
      ? a.title + (a.tokens ? ` · ${fmtTokens(a.tokens)}` : '')
      : '';
  }

  // 5. re-fit visible terminals once the layout has applied
  requestAnimationFrame(() => {
    for (const a of agents) {
      const t = tiles.get(a.id);
      if (t && (!focusMode || a.id === focusedId)) t.term.fitNow();
    }
  });
}

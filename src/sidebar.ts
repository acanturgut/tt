import { list, focused, attentionCount, type Agent, type WorkflowLabel } from './agents';
import { statusPill, labelColor } from './statuspill';
import { icon } from './icon';

const DOT: Record<Agent['status'], string> = {
  working: '#3fb950',
  idle: '#8b949e',
  exited: '#f85149',
};

export interface SidebarHandlers {
  onFocusToggle: (id: string) => void;
  onClose: (id: string) => void;
  onSetLabel: (id: string, label: WorkflowLabel | undefined) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onGrid: () => void;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

export function renderSidebar(root: HTMLElement, h: SidebarHandlers) {
  root.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'rail-head';
  const title = document.createElement('span');
  title.className = 'rail-title';
  const attn = attentionCount();
  title.textContent = attn ? `Agents · ${attn} need you` : 'Agents';
  if (attn) title.classList.add('has-attn');
  const grid = document.createElement('button');
  grid.className = 'gridbtn';
  grid.append(icon(focused() ? 'arrows-out' : 'squares-four'));
  grid.append(document.createTextNode(focused() ? ' All' : ' Grid'));
  grid.disabled = !focused();
  grid.onclick = () => h.onGrid();
  head.append(title, grid);
  root.appendChild(head);

  const cur = focused();
  const agents = list();
  if (!agents.length) {
    const empty = document.createElement('div');
    empty.className = 'rail-empty';
    empty.textContent = 'Open an agent from the tree →';
    root.appendChild(empty);
    return;
  }

  for (const a of agents) {
    const row = document.createElement('div');
    row.className =
      'agentrow' + (a.id === cur ? ' active' : '') + (a.attention ? ' attention' : '');
    row.onclick = () => h.onFocusToggle(a.id);

    row.draggable = true;
    row.ondragstart = (ev) => {
      ev.dataTransfer?.setData('text/plain', a.id);
      row.classList.add('dragging');
    };
    row.ondragend = () => row.classList.remove('dragging');
    row.ondragover = (ev) => {
      ev.preventDefault();
      row.classList.add('drop-target');
    };
    row.ondragleave = () => row.classList.remove('drop-target');
    row.ondrop = (ev) => {
      ev.preventDefault();
      row.classList.remove('drop-target');
      const from = ev.dataTransfer?.getData('text/plain');
      if (from) h.onReorder(from, a.id);
    };

    const top = document.createElement('div');
    top.className = 'agentrow-top';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = DOT[a.status];
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = a.name;
    label.style.color = labelColor(a.label) ?? '';
    const close = document.createElement('span');
    close.className = 'close';
    close.title = 'close agent';
    close.appendChild(icon('x'));
    close.onclick = (ev) => {
      ev.stopPropagation();
      h.onClose(a.id);
    };
    if (a.attention) {
      const star = document.createElement('span');
      star.className = 'attn';
      star.appendChild(icon('star'));
      top.append(dot, star, label, close);
    } else {
      top.append(dot, label, close);
    }

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

import { focused, agentTree, type Agent, type WorkflowLabel } from './agents';
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

export function renderSidebar(root: HTMLElement, agents: Agent[], h: SidebarHandlers) {
  root.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'rail-head';
  const title = document.createElement('span');
  title.className = 'rail-title';
  const attn = agents.filter((a) => a.attention).length;
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

  const listWrap = document.createElement('div');
  listWrap.className = 'rail-list';

  const cur = focused();
  if (!agents.length) {
    const empty = document.createElement('div');
    empty.className = 'rail-empty';
    const ic = icon('brain');
    ic.classList.add('rail-empty-ic');
    const t1 = document.createElement('div');
    t1.className = 'rail-empty-title';
    t1.textContent = 'No agents running';
    const t2 = document.createElement('div');
    t2.className = 'rail-empty-hint';
    t2.textContent = 'Spawn one from a folder in the tree, or the top bar';
    empty.append(ic, t1, t2);
    listWrap.appendChild(empty);
    root.appendChild(listWrap);
    return;
  }

  for (const node of agentTree(agents)) {
    const a = node.agent;
    const row = document.createElement('div');
    row.className =
      'agentrow' +
      (a.id === cur ? ' active' : '') +
      (a.attention ? ' attention' : '') +
      (node.depth > 0 ? ' sub' : '');
    if (node.depth > 0) {
      row.style.setProperty('--depth', String(node.depth));
      row.style.paddingLeft = `${node.depth * 18 + 8}px`;
    }
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

    // Task-first: the current task is the headline; when there's no task yet,
    // the agent's own name stands in for it.
    const hasTitle = !!a.title;

    const top = document.createElement('div');
    top.className = 'agentrow-top';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = DOT[a.status];
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = a.title || a.name;
    // color by workflow only when the headline is the name (task titles stay neutral)
    if (!hasTitle) label.style.color = labelColor(a.label) ?? '';
    const close = document.createElement('span');
    close.className = 'close';
    close.title = 'close agent';
    close.appendChild(icon('x'));
    close.onclick = (ev) => {
      ev.stopPropagation();
      h.onClose(a.id);
    };
    const lead: HTMLElement[] = [];
    if (node.depth > 0) {
      const arrow = icon('arrow-bend-down-right');
      arrow.classList.add('sub-arrow');
      lead.push(arrow);
    }
    if (a.attention) {
      const star = document.createElement('span');
      star.className = 'attn';
      star.appendChild(icon('bell-ringing'));
      lead.push(star); // alert: the bell stands in for the status dot
    } else {
      lead.push(dot);
    }
    top.append(...lead, label, close);
    row.append(top);

    // meta footer: identity + live status, dot-separated
    const meta = document.createElement('div');
    meta.className = 'rail-meta';
    const sep = () => {
      const s = document.createElement('span');
      s.className = 'meta-sep';
      s.textContent = '·';
      return s;
    };
    const part = (text: string, cls?: string) => {
      const s = document.createElement('span');
      s.textContent = text;
      if (cls) s.className = cls;
      return s;
    };
    const num = part(`#${node.label}`, 'rnum');
    num.title = `Agent ${node.label}. Type #${node.label} in the broadcast bar to message only this agent`;
    meta.append(num);
    // agent name — shown here only when the headline is the task instead
    if (hasTitle) {
      const nm = part(a.name, 'meta-name');
      nm.style.color = labelColor(a.label) ?? '';
      meta.append(sep(), nm);
    }
    const folder = a.dir.split('/').filter(Boolean).pop();
    if (folder) meta.append(sep(), part(folder));
    meta.append(sep(), part(a.status));
    if (a.tokens) meta.append(sep(), part(`${fmtTokens(a.tokens)} tok`));
    row.append(meta);

    row.append(statusPill(a, (l) => h.onSetLabel(a.id, l)));
    listWrap.appendChild(row);
  }
  root.appendChild(listWrap);
}

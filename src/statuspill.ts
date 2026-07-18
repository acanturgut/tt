import type { Agent, WorkflowLabel } from './agents';

const LABELS: { key: WorkflowLabel; text: string; color: string }[] = [
  { key: 'planning', text: 'Planning', color: '#bc8cff' },
  { key: 'in-progress', text: 'In progress', color: '#e3b341' },
  { key: 'in-review', text: 'In review', color: '#58a6ff' },
  { key: 'done', text: 'Done', color: '#3fb950' },
];

export function labelColor(label?: WorkflowLabel): string | null {
  return LABELS.find((l) => l.key === label)?.color ?? null;
}

export function updatePill(pill: HTMLElement, agent: Agent) {
  const cur = LABELS.find((l) => l.key === agent.label);
  pill.classList.toggle('pill-empty', !cur);
  if (cur) {
    pill.textContent = cur.text;
    pill.style.color = cur.color;
    pill.style.borderColor = cur.color;
  } else {
    pill.textContent = 'status';
    pill.style.color = '';
    pill.style.borderColor = '';
  }
}

export function statusPill(
  agent: Agent,
  onSet: (l: WorkflowLabel | undefined) => void,
): HTMLElement {
  const pill = document.createElement('span');
  pill.className = 'pill';
  updatePill(pill, agent);
  pill.onclick = (ev) => {
    ev.stopPropagation();
    openMenu(pill, onSet);
  };
  return pill;
}

function openMenu(anchor: HTMLElement, onSet: (l: WorkflowLabel | undefined) => void) {
  const menu = document.createElement('div');
  menu.className = 'popmenu';
  for (const l of LABELS) {
    const item = document.createElement('div');
    item.className = 'popmenu-item';
    item.textContent = l.text;
    item.style.color = l.color;
    item.onclick = (ev) => {
      ev.stopPropagation();
      onSet(l.key);
      cleanup();
    };
    menu.appendChild(item);
  }
  const clear = document.createElement('div');
  clear.className = 'popmenu-item popmenu-clear';
  clear.textContent = 'Clear';
  clear.onclick = (ev) => {
    ev.stopPropagation();
    onSet(undefined);
    cleanup();
  };
  menu.appendChild(clear);

  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 4)}px`;

  function onDown(ev: MouseEvent) {
    if (!menu.contains(ev.target as Node)) cleanup();
  }
  function cleanup() {
    menu.remove();
    document.removeEventListener('mousedown', onDown);
  }
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

import { listTasks, taskStats, subscribeTasks } from './tasks';
import { labelColor } from './statuspill';
import { openBoard } from './board';

let stripEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let getProj: () => string | null = () => null;
let getAgents: () => { working: number; idle: number } = () => ({ working: 0, idle: 0 });

export function mountTaskStrip(
  strip: HTMLElement,
  status: HTMLElement,
  opts: { getProject: () => string | null; getAgents: () => { working: number; idle: number } },
): void {
  stripEl = strip;
  statusEl = status;
  getProj = opts.getProject;
  getAgents = opts.getAgents;
  strip.onclick = openBoard;
  subscribeTasks(renderTaskStrip);
  renderTaskStrip();
}

export function renderTaskStrip(): void {
  if (!stripEl || !statusEl) return;
  const project = getProj();
  const tasks = project ? listTasks(project) : [];
  const s = taskStats(tasks);
  const { working, idle } = getAgents();

  // Merged bar: agents + tasks count + segmented progress bar in one strip.
  stripEl.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'strip-label';
  label.textContent = `${working} working · ${idle} idle · Tasks ${s.done}/${s.total}`;
  const bar = document.createElement('span');
  bar.className = 'strip-bar';
  const seg = (n: number, status: 'done' | 'in-review' | 'needs-human' | 'in-progress' | 'planning') => {
    if (!s.total || !n) return;
    const i = document.createElement('i');
    i.style.width = `${(n / s.total) * 100}%`;
    i.style.background = labelColor(status) ?? '#333';
    bar.appendChild(i);
  };
  seg(s.done, 'done');
  seg(s['in-review'], 'in-review');
  seg(s['needs-human'], 'needs-human');
  seg(s['in-progress'], 'in-progress');
  seg(s.planning, 'planning');
  stripEl.append(label, bar);

  // Legacy statusline: superseded by the merged strip; kept empty so :empty hides it.
  statusEl.textContent = '';
}

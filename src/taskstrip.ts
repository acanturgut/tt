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

  // Progress strip: count + segmented bar (done | in-review | in-progress | planning-as-todo).
  stripEl.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'strip-label';
  label.textContent = `Tasks ${s.done}/${s.total}`;
  const bar = document.createElement('span');
  bar.className = 'strip-bar';
  const seg = (n: number, status: 'done' | 'in-review' | 'in-progress' | 'planning') => {
    if (!s.total || !n) return;
    const i = document.createElement('i');
    i.style.width = `${(n / s.total) * 100}%`;
    i.style.background = labelColor(status) ?? '#333';
    bar.appendChild(i);
  };
  seg(s.done, 'done');
  seg(s['in-review'], 'in-review');
  seg(s['in-progress'], 'in-progress');
  seg(s.planning, 'planning');
  const openHint = document.createElement('span');
  openHint.className = 'strip-open';
  openHint.textContent = '▸ open board';
  stripEl.append(label, bar, openHint);

  // Status line: agents + task count, compact.
  statusEl.textContent = `${working} working · ${idle} idle — ${s.done}/${s.total} tasks`;
}

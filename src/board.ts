import { listTasks, removeTask, subscribeTasks, type TaskStatus } from './tasks';
import { subscribeProjects } from './projects';
import { labelColor } from './statuspill';
import { icon } from './icon';

// "Needs you" sits right after "In progress" — it's the board's highest-priority state.
const COLUMNS: { key: TaskStatus; text: string }[] = [
  { key: 'planning', text: 'Planning' },
  { key: 'in-progress', text: 'In progress' },
  { key: 'needs-human', text: 'Needs you' },
  { key: 'in-review', text: 'In review' },
  { key: 'done', text: 'Done' },
];

let boardEl: HTMLElement | null = null;
let getProj: () => string | null = () => null;
let open = false;

export function isBoardOpen(): boolean {
  return open;
}
export function openBoard(): void {
  open = true;
  document.body.classList.add('board-open');
  render();
}
export function closeBoard(): void {
  open = false;
  document.body.classList.remove('board-open');
}

export function mountBoard(root: HTMLElement, getProject: () => string | null): void {
  boardEl = root;
  getProj = getProject;
  subscribeTasks(() => {
    if (open) render();
  });
  subscribeProjects(() => { if (open) render(); });
}

// Read-only: agents own this board (they add/claim/complete via the MCP tools).
// Humans watch — no add, drag, edit, or delete here.
function render(): void {
  if (!boardEl) return;
  const project = getProj();
  boardEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'board-header';
  const back = document.createElement('button');
  back.className = 'board-back';
  back.textContent = '← Back';
  back.onclick = closeBoard;
  const title = document.createElement('span');
  title.className = 'board-title';
  title.textContent = 'Task Board';
  header.append(back, title);
  boardEl.appendChild(header);

  const cols = document.createElement('div');
  cols.className = 'board-cols';
  const tasks = project ? listTasks(project) : [];

  for (const col of COLUMNS) {
    const c = document.createElement('div');
    c.className = 'board-col';
    c.style.setProperty('--col', labelColor(col.key) ?? '#888');

    const colTasks = tasks.filter((t) => t.status === col.key);
    const head = document.createElement('div');
    head.className = 'board-col-head';
    const lbl = document.createElement('span');
    lbl.append(document.createTextNode(col.text + ' '));
    const cnt = document.createElement('span');
    cnt.className = 'col-count';
    cnt.textContent = String(colTasks.length);
    lbl.appendChild(cnt);
    head.appendChild(lbl);
    if (colTasks.length) {
      const del = document.createElement('button');
      del.className = 'board-col-del';
      del.title = `Delete all ${colTasks.length} task(s) in ${col.text}`;
      del.appendChild(icon('trash'));
      del.onclick = () => {
        if (confirm(`Delete all ${colTasks.length} task(s) in "${col.text}"?`)) {
          colTasks.forEach((t) => removeTask(t.id));
        }
      };
      head.appendChild(del);
    }
    c.appendChild(head);

    for (const t of colTasks) {
      const card = document.createElement('div');
      card.className = 'board-card';

      const ttl = document.createElement('div');
      ttl.className = 'board-card-title';
      ttl.textContent = t.title;
      card.appendChild(ttl);

      if (t.assignee) {
        const who = document.createElement('span');
        who.className = 'board-card-who';
        who.textContent = `agent ${t.assignee}`;
        card.appendChild(who);
      }
      if (t.result) {
        const res = document.createElement('div');
        res.className = 'board-card-result';
        res.textContent = t.result;
        card.appendChild(res);
      }

      c.appendChild(card);
    }

    if (!colTasks.length) {
      const empty = document.createElement('div');
      empty.className = 'board-empty';
      empty.textContent = 'No tasks';
      c.appendChild(empty);
    }

    cols.appendChild(c);
  }
  boardEl.appendChild(cols);
}

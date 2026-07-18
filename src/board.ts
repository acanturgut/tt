import { listTasks, addTask, updateTask, removeTask, subscribeTasks, type TaskStatus } from './tasks';
import { subscribeProjects } from './projects';
import { labelColor } from './statuspill';

const COLUMNS: { key: TaskStatus; text: string }[] = [
  { key: 'planning', text: 'Planning' },
  { key: 'in-progress', text: 'In progress' },
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

    const head = document.createElement('div');
    head.className = 'board-col-head';
    const n = tasks.filter((t) => t.status === col.key).length;
    head.textContent = `${col.text} (${n})`;
    c.appendChild(head);

    // Drop target: dropping a card sets its status to this column.
    c.ondragover = (e) => {
      e.preventDefault();
      c.classList.add('drag-over');
    };
    c.ondragleave = () => c.classList.remove('drag-over');
    c.ondrop = (e) => {
      e.preventDefault();
      c.classList.remove('drag-over');
      const id = e.dataTransfer?.getData('text/plain');
      if (id) updateTask(id, { status: col.key });
    };

    for (const t of tasks.filter((x) => x.status === col.key)) {
      const card = document.createElement('div');
      card.className = 'board-card';
      card.draggable = true;
      card.ondragstart = (e) => e.dataTransfer?.setData('text/plain', t.id);

      const ttl = document.createElement('div');
      ttl.className = 'board-card-title';
      ttl.textContent = t.title;
      ttl.title = 'double-click to edit';
      ttl.ondblclick = () => editTitle(ttl, t.id, t.title);
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

      const del = document.createElement('button');
      del.className = 'board-card-del';
      del.textContent = '×';
      del.title = 'delete task';
      del.onclick = () => removeTask(t.id);
      card.appendChild(del);

      c.appendChild(card);
    }

    if (col.key === 'planning') {
      const add = document.createElement('input');
      add.className = 'board-add';
      add.placeholder = '+ add task…';
      add.onkeydown = (e) => {
        if (e.key === 'Enter' && add.value.trim() && project) {
          addTask(project, add.value.trim());
          add.value = '';
        }
      };
      c.appendChild(add);
    }

    cols.appendChild(c);
  }
  boardEl.appendChild(cols);
}

function editTitle(el: HTMLElement, id: string, cur: string): void {
  let settled = false;
  const inp = document.createElement('input');
  inp.className = 'board-add';
  inp.value = cur;
  el.replaceWith(inp);
  inp.focus();
  const done = (save: boolean) => {
    if (settled) return;
    settled = true;
    if (save && inp.value.trim() && inp.value.trim() !== cur) updateTask(id, { title: inp.value.trim() });
    else render(); // re-render to restore the label
  };
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') done(true);
    else if (e.key === 'Escape') done(false);
  };
  inp.onblur = () => done(true);
}

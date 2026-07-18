import type { WorkflowLabel } from './agents';

export type TaskStatus = WorkflowLabel;

export interface Task {
  id: string;
  project: string; // project path this task belongs to
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string; // agent number or name; free-form, unvalidated
  result?: string;
  createdAt: number;
}

export interface TaskStats {
  planning: number;
  'in-progress': number;
  'in-review': number;
  done: number;
  total: number;
}

let tasks: Task[] = [];
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}

export function subscribeTasks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function allTasks(): Task[] {
  return tasks.slice();
}

export function listTasks(project: string): Task[] {
  return tasks.filter((t) => t.project === project);
}

export function addTask(project: string, title: string, description?: string, id?: string): Task {
  const t: Task = {
    id: id ?? crypto.randomUUID(),
    project,
    title,
    description,
    status: 'planning',
    createdAt: Date.now(),
  };
  tasks.push(t);
  notify();
  return t;
}

export function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'status' | 'assignee' | 'result' | 'title' | 'description'>>,
): Task | null {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  notify();
  return t;
}

export function removeTask(id: string): void {
  const n = tasks.length;
  tasks = tasks.filter((t) => t.id !== id);
  if (tasks.length !== n) notify();
}

export function loadTasks(saved: Task[]): void {
  tasks = saved.slice();
  notify();
}

export function taskStats(input: Task[]): TaskStats {
  const s: TaskStats = { planning: 0, 'in-progress': 0, 'in-review': 0, done: 0, total: input.length };
  for (const t of input) s[t.status]++;
  return s;
}

// Compact JSON the MCP `list_tasks` tool returns — only what an agent needs.
export function snapshotFor(project: string): string {
  return JSON.stringify(
    listTasks(project).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assignee,
      result: t.result,
    })),
  );
}

export function __resetForTest(): void {
  tasks = [];
  listeners.clear();
}

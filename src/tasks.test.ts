import { describe, it, expect, beforeEach } from 'vitest';
import * as store from './tasks';

beforeEach(() => store.__resetForTest());

describe('tasks store', () => {
  it('adds a task and lists it under its project', () => {
    const t = store.addTask('/p', 'Write spec');
    expect(t.title).toBe('Write spec');
    expect(t.status).toBe('planning');
    expect(t.project).toBe('/p');
    expect(store.listTasks('/p').map((x) => x.id)).toEqual([t.id]);
  });

  it('isolates tasks per project', () => {
    store.addTask('/a', 'A-task');
    store.addTask('/b', 'B-task');
    expect(store.listTasks('/a').map((t) => t.title)).toEqual(['A-task']);
    expect(store.listTasks('/b').map((t) => t.title)).toEqual(['B-task']);
  });

  it('honors a supplied id (MCP-added task)', () => {
    const t = store.addTask('/p', 'From agent', undefined, 't7');
    expect(t.id).toBe('t7');
  });

  it('updateTask changes status/assignee/result and returns the task', () => {
    const t = store.addTask('/p', 'Fix grid');
    const u = store.updateTask(t.id, { status: 'in-progress', assignee: '2' });
    expect(u?.status).toBe('in-progress');
    expect(u?.assignee).toBe('2');
    const d = store.updateTask(t.id, { status: 'done', result: 'shipped' });
    expect(d?.status).toBe('done');
    expect(d?.result).toBe('shipped');
  });

  it('updateTask returns null for an unknown id', () => {
    expect(store.updateTask('nope', { status: 'done' })).toBeNull();
  });

  it('removeTask drops it', () => {
    const t = store.addTask('/p', 'gone');
    store.removeTask(t.id);
    expect(store.listTasks('/p')).toEqual([]);
  });

  it('taskStats counts by status', () => {
    store.addTask('/p', 'a'); // planning
    const b = store.addTask('/p', 'b');
    store.updateTask(b.id, { status: 'in-progress' });
    const c = store.addTask('/p', 'c');
    store.updateTask(c.id, { status: 'done' });
    const s = store.taskStats(store.listTasks('/p'));
    expect(s).toEqual({ planning: 1, 'in-progress': 1, 'in-review': 0, done: 1, total: 3 });
  });

  it('snapshotFor emits a compact JSON array for the project', () => {
    const t = store.addTask('/p', 'snap');
    store.updateTask(t.id, { status: 'in-review', assignee: '1' });
    const arr = JSON.parse(store.snapshotFor('/p'));
    expect(arr).toEqual([{ id: t.id, title: 'snap', status: 'in-review', assignee: '1', result: undefined }]);
  });

  it('subscribeTasks fires on change and unsubscribes', () => {
    let n = 0;
    const off = store.subscribeTasks(() => n++);
    store.addTask('/p', 'x');
    expect(n).toBe(1);
    off();
    store.addTask('/p', 'y');
    expect(n).toBe(1);
  });

  it('loadTasks replaces the whole list', () => {
    store.addTask('/p', 'old');
    store.loadTasks([{ id: 'z', project: '/p', title: 'new', status: 'done', createdAt: 1 }]);
    expect(store.listTasks('/p').map((t) => t.id)).toEqual(['z']);
  });
});

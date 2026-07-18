export type Status = 'working' | 'idle' | 'exited';

export interface Agent {
  id: string;
  agentId: string;
  dir: string;
  color: string;
  status: Status;
  title?: string;
  tokens?: number;
}

const agents = new Map<string, Agent>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let focusedId: string | null = null;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function list(): Agent[] {
  return [...agents.values()];
}

export function focused(): string | null {
  return focusedId;
}

export function focus(id: string | null) {
  focusedId = id;
  emit();
}

export function add(a: Agent) {
  agents.set(a.id, a);
  emit();
}

export function markOutput(id: string) {
  const a = agents.get(id);
  if (!a || a.status === 'exited') return;
  const changed = a.status !== 'working'; // only notify on transition — avoids a UI render per output chunk
  a.status = 'working';
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  timers.set(
    id,
    setTimeout(() => {
      const cur = agents.get(id);
      if (cur && cur.status !== 'exited') {
        cur.status = 'idle';
        emit();
      }
    }, 2000),
  );
  if (changed) emit();
}

export function markExit(id: string) {
  const a = agents.get(id);
  if (!a) return;
  a.status = 'exited';
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  emit();
}

export function markClaude(id: string, title?: string, tokens?: number) {
  const a = agents.get(id);
  if (!a) return;
  a.title = title;
  a.tokens = tokens;
  emit();
}

export function remove(id: string) {
  agents.delete(id);
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  if (focusedId === id) focusedId = null;
  emit();
}

// test-only reset
export function __resetForTest() {
  agents.clear();
  timers.clear();
  listeners.clear();
  focusedId = null;
}

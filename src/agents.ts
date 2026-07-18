export type Status = 'working' | 'idle' | 'exited';
export type WorkflowLabel = 'planning' | 'in-progress' | 'in-review' | 'needs-human' | 'done';

export interface Agent {
  id: string;
  agentId: string;
  name: string;
  dir: string;
  status: Status;
  label?: WorkflowLabel;
  attention?: boolean; // finished a turn, waiting on the user
  awaited?: boolean; // you sent input -> a later quiet means it's your turn
  title?: string;
  tokens?: number;
  key?: string; // persistence key; tmux session = tt-<key>
  project?: string; // project path this agent belongs to (its tab/panel)
  spawned?: boolean; // created by another agent via MCP (a sub-agent)
  parentId?: string; // best-effort: the agent focused when this one was spawned
}

const agents = new Map<string, Agent>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const attnTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ATTENTION_MS = 8000; // quiet this long after working -> "needs you" (avoids brief-pause false positives)
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
  const changed = a.status !== 'working' || a.attention === true;
  a.status = 'working';
  a.attention = false; // actively working — nothing to attend to
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
  // Separate, longer timer for "needs you" so a brief thinking pause doesn't flag it.
  const prevA = attnTimers.get(id);
  if (prevA) clearTimeout(prevA);
  attnTimers.set(
    id,
    setTimeout(() => {
      const cur = agents.get(id);
      // only "needs you" if you sent it something and you're not already watching it
      if (cur && cur.status !== 'exited' && !cur.attention && cur.awaited && focusedId !== id) {
        cur.attention = true;
        cur.awaited = false;
        emit();
      }
    }, ATTENTION_MS),
  );
  if (changed) emit();
}

export function markExit(id: string) {
  const a = agents.get(id);
  if (!a) return;
  a.status = 'exited';
  a.attention = false;
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  const prevA = attnTimers.get(id);
  if (prevA) clearTimeout(prevA);
  emit();
}

export function clearAttention(id: string) {
  const prevA = attnTimers.get(id);
  if (prevA) clearTimeout(prevA); // cancel a pending flag so it can't fire while you're looking
  const a = agents.get(id);
  if (!a || !a.attention) return;
  a.attention = false;
  emit();
}

export function attentionCount(): number {
  let n = 0;
  for (const a of agents.values()) if (a.attention) n++;
  return n;
}

export interface AgentNode {
  agent: Agent;
  depth: number;
  label: string; // hierarchical: roots "1","2"…; children of #1 -> "1-1","1-2"…
}

// Order agents as a tree (each spawned sub-agent nested under its parent) and
// assign hierarchical display numbers.
export function agentTree(input: Agent[]): AgentNode[] {
  const has = new Set(input.map((a) => a.id));
  const kids = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  for (const a of input) {
    if (a.parentId && has.has(a.parentId) && a.parentId !== a.id) {
      const arr = kids.get(a.parentId) ?? [];
      arr.push(a);
      kids.set(a.parentId, arr);
    } else {
      roots.push(a);
    }
  }
  const out: AgentNode[] = [];
  const walk = (a: Agent, depth: number, label: string) => {
    out.push({ agent: a, depth, label });
    (kids.get(a.id) ?? []).forEach((c, i) => walk(c, depth + 1, `${label}-${i + 1}`));
  };
  roots.forEach((r, i) => walk(r, 0, `${i + 1}`));
  return out;
}

export function markClaude(id: string, title?: string, tokens?: number) {
  const a = agents.get(id);
  if (!a) return;
  a.title = title;
  a.tokens = tokens;
  emit();
}

export function setLabel(id: string, label: WorkflowLabel | undefined) {
  const a = agents.get(id);
  if (!a) return;
  a.label = label;
  emit();
}

// Called when you send keystrokes/prompts to an agent — arms "needs you" for
// when it next goes quiet. Cheap: only emits if it was already flagged.
export function markInput(id: string) {
  const a = agents.get(id);
  if (!a) return;
  a.awaited = true;
  if (a.attention) {
    a.attention = false;
    emit();
  }
}

export function setName(id: string, name: string) {
  const a = agents.get(id);
  if (!a) return;
  a.name = name;
  emit();
}

export function reorder(draggedId: string, targetId: string) {
  if (draggedId === targetId) return;
  const arr = [...agents.values()];
  const from = arr.findIndex((a) => a.id === draggedId);
  const to = arr.findIndex((a) => a.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  agents.clear();
  for (const a of arr) agents.set(a.id, a);
  emit();
}

export function remove(id: string) {
  agents.delete(id);
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  const ta = attnTimers.get(id);
  if (ta) clearTimeout(ta);
  attnTimers.delete(id);
  if (focusedId === id) focusedId = null;
  emit();
}

// test-only reset
export function __resetForTest() {
  agents.clear();
  timers.clear();
  attnTimers.clear();
  listeners.clear();
  focusedId = null;
}

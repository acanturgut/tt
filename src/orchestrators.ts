import type { Agent } from './agents';

export interface Orchestrator {
  id: string; // crypto.randomUUID(); this value is the agents' `session` tag
  name: string; // short label for the chip (derived from the goal)
  dir: string; // working directory the lead runs in
  goal: string; // the front-loaded task
  rootAgentId?: string; // backend PTY id of the live claude lead once spawned
}

const KEY = 'tt.orchestrators';
const listeners = new Set<() => void>();
let orchestrators: Orchestrator[] = load();
let activeId: string | null = null; // null = General; not persisted (always start on General)

function load(): Orchestrator[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(orchestrators));
}
function emit() {
  listeners.forEach((l) => l());
}

export function subscribeOrchestrators(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function listOrchestrators(): Orchestrator[] {
  return orchestrators;
}
export function getOrchestrator(id: string): Orchestrator | undefined {
  return orchestrators.find((o) => o.id === id);
}
export function addOrchestrator(o: Orchestrator) {
  orchestrators.push(o);
  save();
  emit();
}
export function removeOrchestrator(id: string) {
  orchestrators = orchestrators.filter((o) => o.id !== id);
  if (activeId === id) activeId = null;
  save();
  emit();
}
export function setOrchestratorRoot(id: string, agentId: string) {
  const o = getOrchestrator(id);
  if (!o) return;
  o.rootAgentId = agentId;
  save();
  emit();
}
export function activeSession(): string | null {
  return activeId;
}
export function selectSession(id: string | null) {
  activeId = id;
  emit();
}

// The single filter behind every render path. Orchestrator view = only that
// session's agents. General view = the current project's agents that are NOT in
// any orchestrator session (so orchestrator tiles never leak into General).
export function sessionAgents(agents: Agent[], active: string | null, project: string | null): Agent[] {
  if (active) return agents.filter((a) => a.session === active);
  return agents.filter((a) => a.project === project && !a.session);
}

// Decide which session/parent a newly MCP-spawned child belongs to. Prefer the
// resolved caller's session; else the orchestrator the human is currently
// viewing (the common create-and-watch case). Returns empty for General — the
// caller then keeps today's focused()-based parentId.
export function childAttribution(
  parent: Agent | undefined,
  active: { session: string; rootId?: string } | null,
): { session?: string; parentId?: string } {
  const session = parent?.session ?? active?.session;
  const parentId = parent?.id ?? (session ? active?.rootId : undefined);
  return { session, parentId };
}

// The lead role prompt, front-loaded into the orchestrator on spawn. Full MCP
// tool docs already arrive via the MCP `initialize` instructions — this is the
// lead-specific layer + the goal.
export function orchestratorPrompt(goal: string): string {
  return (
    '[tt orchestrator] You are the LEAD orchestrator for this session. Workers you ' +
    'spawn automatically join your session. Break the goal into board tasks (add_task), ' +
    'spawn the right workers with spawn_agent, dispatch work with send, watch progress ' +
    'with list_tasks / read_agent, and synthesize when they finish. Keep your status pill ' +
    'current with set_status.\n\nGoal: ' +
    goal
  );
}

export function __resetOrchestratorsForTest() {
  orchestrators = [];
  activeId = null;
  listeners.clear();
}

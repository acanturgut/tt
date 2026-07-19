import { icon } from './icon';
import type { Agent } from './agents';

export interface Orchestrator {
  id: string;
  name: string;
  dir: string;
  project: string; // owning project path — the chip shows only when this project is active
  goal: string;
  rootAgentId?: string;
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
    '[tt orchestrator] You are the LEAD orchestrator for this session. Break the goal into ' +
    'board tasks (add_task), then spawn the right workers with spawn_agent — pass ' +
    'parent=<your own agent number> so each worker joins your session. Dispatch work with ' +
    'send, watch progress with list_tasks / read_agent, and synthesize when they finish. ' +
    'Keep your status pill current with set_status.\n\nGoal: ' +
    goal
  );
}

export function __resetOrchestratorsForTest() {
  orchestrators = [];
  activeId = null;
  listeners.clear();
}

// Modal: type a goal → onCreate(goal). Runs in `dir` (the current project's folder,
// shown for context — no picker; orchestrators are created from a project).
export function openNewOrchestrator(dir: string, onCreate: (goal: string) => void): void {
  const back = document.createElement('div');
  back.className = 'modal-back';

  const card = document.createElement('div');
  card.className = 'orch-modal';

  const title = document.createElement('div');
  title.className = 'orch-modal-title';
  title.textContent = 'New orchestrator';

  // Static context row: which project folder the orchestrator will run in.
  const dirRow = document.createElement('div');
  dirRow.className = 'orch-dir';
  const dirLabel = document.createElement('span');
  dirLabel.textContent = dir;
  dirRow.append(icon('folder'), dirLabel);

  const goal = document.createElement('textarea');
  goal.className = 'orch-goal';
  goal.placeholder = 'What should this orchestrator accomplish?';
  goal.rows = 4;

  const actions = document.createElement('div');
  actions.className = 'orch-actions';
  const cancel = document.createElement('button');
  cancel.className = 'orch-btn';
  cancel.textContent = 'Cancel';
  const create = document.createElement('button');
  create.className = 'orch-btn primary';
  create.textContent = 'Create';

  const close = () => back.remove();
  cancel.onclick = close;
  back.onclick = (e) => {
    if (e.target === back) close();
  };
  create.onclick = () => {
    const g = goal.value.trim();
    if (!g) {
      alert('Describe the goal.');
      return;
    }
    close();
    onCreate(g);
  };

  actions.append(cancel, create);
  card.append(title, dirRow, goal, actions);
  back.append(card);
  document.body.append(back);
  goal.focus();
}

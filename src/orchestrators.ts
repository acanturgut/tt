import { icon } from './icon';
import { scSelect } from './select';
import { visibleProviders, providerModels, isLocalRuntime } from './providers';
import { defaultModel, defaultEffort } from './settings';
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
//
// The shape block matters more than it looks: a flat "spawn workers" line makes
// the lead fan out on an unreproduced bug and get four confident wrong fixes.
// Only feature/refactor genuinely parallelize; bugs are serial, research is
// read-only. Kept provider-agnostic (no Claude Code skill names) so codex /
// cursor / gemini leads get the same guidance.
export function orchestratorPrompt(goal: string): string {
  return (
    '[tt orchestrator] You are the LEAD orchestrator for this session. Break the goal into ' +
    'board tasks (add_task), then spawn the right workers with spawn_agent — pass ' +
    'parent=<your own agent number> so each worker joins your session. Dispatch work with ' +
    'send, watch progress with list_tasks / read_agent, and synthesize when they finish. ' +
    'Keep your status pill current with set_status.\n\n' +
    'Pick the shape from the operation, then work it:\n' +
    '  bug / test failure / regression → one worker reproduces it first; only when the repro ' +
    'is confirmed, one worker fixes. Do not fan out.\n' +
    '  feature / new behavior → split it yourself first, then one builder per independent ' +
    'piece, running in parallel.\n' +
    '  refactor / migration / rename → one worker per independent site, same instructions to each.\n' +
    '  research / audit / "how does X work" → fan out read-only workers on different angles, ' +
    'you synthesize. Nobody edits.\n\n' +
    'Delegate by default: your job is to split, dispatch, and synthesize — not to edit files ' +
    'yourself. Spawn a worker even for a small piece; answer directly only when the goal is a ' +
    'question about the plan itself.\n\nGoal: ' +
    goal
  );
}

export function __resetOrchestratorsForTest() {
  orchestrators = [];
  activeId = null;
  listeners.clear();
}

export interface OrchestratorConfig {
  goal: string;
  agentId: string;
  model?: string;
  effort?: string;
}

// Modal: pick the lead agent (provider / model / effort) + type a goal → onCreate(cfg).
// Runs in `dir` (the current project's folder, shown for context — no picker).
export function openNewOrchestrator(dir: string, onCreate: (cfg: OrchestratorConfig) => void): void {
  const projName = dir.split('/').filter(Boolean).pop() || dir;

  const back = document.createElement('div');
  back.className = 'modal-back';

  const card = document.createElement('div');
  card.className = 'orch-modal';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'orch-modal-title');

  // Header: accent badge + title + one-line description + close.
  const head = document.createElement('div');
  head.className = 'orch-head';
  const badge = document.createElement('div');
  badge.className = 'orch-badge';
  badge.append(icon('tree-structure'));
  const headText = document.createElement('div');
  headText.className = 'orch-head-text';
  const title = document.createElement('div');
  title.className = 'orch-modal-title';
  title.id = 'orch-modal-title';
  title.textContent = 'New orchestrator';
  const sub = document.createElement('div');
  sub.className = 'orch-modal-sub';
  sub.textContent = `A lead agent that plans the work and runs a fleet in ${projName}.`;
  headText.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'orch-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.append(icon('x'));
  head.append(badge, headText, closeBtn);

  const body = document.createElement('div');
  body.className = 'orch-body';

  // Where it runs (context, not editable).
  const dirRow = document.createElement('div');
  dirRow.className = 'orch-dir';
  const dirTag = document.createElement('span');
  dirTag.className = 'orch-dir-tag';
  dirTag.textContent = 'Runs in';
  const dirPath = document.createElement('span');
  dirPath.className = 'path';
  dirPath.textContent = dir;
  dirRow.append(icon('folder'), dirTag, dirPath);

  // Lead-agent config: provider, then model + effort (rebuilt on provider change;
  // a terminal and a local chat REPL can't orchestrate, so they're excluded).
  const providers = visibleProviders().filter((p) => p !== 'terminal' && !isLocalRuntime(p));
  if (!providers.length) providers.push('claude');
  let agentId = providers.includes('claude') ? 'claude' : providers[0];
  let model = '';
  let effort = '';

  const field = (label: string, el: HTMLElement): HTMLElement => {
    const f = document.createElement('div');
    f.className = 'orch-cfg-field';
    const l = document.createElement('div');
    l.className = 'orch-cfg-label';
    l.textContent = label;
    f.append(l, el);
    return f;
  };
  const modelHost = document.createElement('div');
  const effortHost = document.createElement('div');
  const modelField = field('Model', modelHost);
  const effortField = field('Effort', effortHost);

  const rebuild = () => {
    const cat = providerModels(agentId);
    const models = cat?.models ?? [];
    modelHost.innerHTML = '';
    modelField.style.display = models.length ? '' : 'none';
    if (models.length) {
      model = defaultModel(agentId) || models[0];
      modelHost.append(scSelect(models, model, (v) => { model = v; }));
    } else {
      model = '';
    }
    const efforts = cat?.effort ?? [];
    effortHost.innerHTML = '';
    effortField.style.display = efforts.length ? '' : 'none';
    if (efforts.length) {
      effort = efforts.includes(defaultEffort()) ? defaultEffort() : efforts[0];
      effortHost.append(scSelect(efforts, effort, (v) => { effort = v; }));
    } else {
      effort = '';
    }
  };
  const providerSel = scSelect(providers, agentId, (v) => { agentId = v; rebuild(); });
  rebuild();

  const cfgRow = document.createElement('div');
  cfgRow.className = 'orch-cfg';
  cfgRow.append(field('Agent', providerSel), modelField, effortField);

  // Goal (hero input).
  const goalField = document.createElement('div');
  goalField.className = 'orch-goal-field';
  const goalLabel = document.createElement('div');
  goalLabel.className = 'orch-cfg-label';
  goalLabel.textContent = 'Goal';
  const goal = document.createElement('textarea');
  goal.className = 'orch-goal';
  goal.placeholder = 'e.g. Ship the auth flow end-to-end — plan it, split the work across agents, and run the fleet.';
  goal.rows = 4;
  goalField.append(goalLabel, goal);

  body.append(dirRow, cfgRow, goalField);

  // Footer: keyboard hint + actions.
  const actions = document.createElement('div');
  actions.className = 'orch-actions';
  const hint = document.createElement('div');
  hint.className = 'orch-hint';
  hint.innerHTML = '<kbd>⌘ ↵</kbd> to create';
  const cancel = document.createElement('button');
  cancel.className = 'orch-btn';
  cancel.textContent = 'Cancel';
  const create = document.createElement('button');
  create.className = 'orch-btn primary';
  create.textContent = 'Create orchestrator';
  create.disabled = true; // enabled once a goal is typed
  actions.append(hint, cancel, create);

  const close = () => back.remove();
  const submit = () => {
    const g = goal.value.trim();
    if (!g) { goal.focus(); return; }
    close();
    onCreate({ goal: g, agentId, model: model || undefined, effort: effort || undefined });
  };
  goal.addEventListener('input', () => { create.disabled = !goal.value.trim(); });
  closeBtn.onclick = close;
  cancel.onclick = close;
  create.onclick = submit;
  back.onclick = (e) => { if (e.target === back) close(); };
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  card.append(head, body, actions);
  back.append(card);
  document.body.append(back);
  goal.focus();
}

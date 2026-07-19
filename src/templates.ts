import { icon } from './icon';
import { providerIcon } from './providers';

// A slot = one agent on the fleet: which CLI, an optional human-readable role
// (becomes the agent's name), and an optional starter prompt sent after spawn.
export interface TemplateSlot {
  provider: string;
  role?: string;
  prompt?: string;
}
export interface Template {
  name: string;
  slots: TemplateSlot[];
}

const KEY = 'tt.templates';
const SEEDED = 'tt.templates.seeded';

// Worked examples so the feature teaches itself on an empty install. Each slot's
// prompt is the agent's standing role; {task} is filled in with the run-time task.
const SEED: Template[] = [
  {
    name: 'Plan → Build → Review',
    slots: [
      { provider: 'claude', role: 'Planner', prompt: 'Read the codebase and write a short implementation plan for: {task}. Do not write code yet — hand the plan to the builder.' },
      { provider: 'claude', role: 'Builder', prompt: 'Wait for the planner, then implement the plan. Keep the diff small.' },
      { provider: 'codex', role: 'Reviewer', prompt: 'Once the builder is done, review the diff for bugs and over-engineering. Report findings concisely.' },
    ],
  },
  {
    name: 'Bug hunt',
    slots: [
      { provider: 'claude', role: 'Investigator', prompt: 'Reproduce and find the root cause of: {task}. Do not fix yet — report where it breaks and why.' },
      { provider: 'claude', role: 'Fixer', prompt: 'Wait for the investigator, then fix the root cause with the smallest change that works.' },
      { provider: 'codex', role: 'Verifier', prompt: 'After the fix lands, confirm the bug is gone and nothing else broke. Run the relevant tests.' },
    ],
  },
  {
    name: 'Parallel build',
    slots: [
      { provider: 'claude', role: 'Lead', prompt: 'Break this into independent parts and coordinate the builders: {task}. Assign each builder a part, then integrate their work.' },
      { provider: 'claude', role: 'Builder A', prompt: 'Wait for the lead to assign you a part, then implement just that part.' },
      { provider: 'claude', role: 'Builder B', prompt: 'Wait for the lead to assign you a part, then implement just that part.' },
    ],
  },
  {
    name: 'Review panel',
    slots: [
      { provider: 'claude', role: 'Correctness', prompt: 'Review the current changes for correctness bugs and missed edge cases. Focus: {task}.' },
      { provider: 'codex', role: 'Security', prompt: 'Review the current changes for security issues — injection, auth, secrets, unsafe input. Focus: {task}.' },
      { provider: 'claude', role: 'Simplicity', prompt: 'Review the current changes for over-engineering: what can be deleted or simplified. Focus: {task}.' },
    ],
  },
  {
    name: 'Research → Spec',
    slots: [
      { provider: 'claude', role: 'Researcher', prompt: 'Investigate how to approach: {task}. Explore the codebase and relevant docs; summarize options and tradeoffs.' },
      { provider: 'claude', role: 'Spec writer', prompt: 'Wait for the researcher, then write a concise spec and implementation plan from their findings.' },
    ],
  },
  {
    name: 'Test coverage',
    slots: [
      { provider: 'claude', role: 'Test writer', prompt: 'Write tests for: {task}. Cover the main paths and the edge cases.' },
      { provider: 'codex', role: 'Runner', prompt: 'Run the test suite, report failures and coverage gaps, and call out what is still untested.' },
    ],
  },
  {
    name: 'Solo agent',
    slots: [
      { provider: 'claude', role: 'Agent', prompt: '{task}' },
    ],
  },
  {
    name: 'Debate → Judge',
    slots: [
      { provider: 'claude', role: 'Approach A', prompt: 'Propose and implement your best solution to: {task}. Optimize for simplicity.' },
      { provider: 'codex', role: 'Approach B', prompt: 'Independently propose and implement a different solution to: {task}. Optimize for robustness.' },
      { provider: 'claude', role: 'Judge', prompt: 'Compare the two approaches to {task} once ready, pick the stronger one, and explain why.' },
    ],
  },
  {
    name: 'Refactor',
    slots: [
      { provider: 'claude', role: 'Auditor', prompt: 'Audit the code for: {task}. List duplication, dead code, and over-engineering to remove — do not change anything yet.' },
      { provider: 'claude', role: 'Refactorer', prompt: 'Wait for the auditor, then apply the simplifications without changing behavior.' },
      { provider: 'codex', role: 'Verifier', prompt: 'After the refactor, confirm behavior is unchanged and tests still pass.' },
    ],
  },
  {
    name: 'Migration',
    slots: [
      { provider: 'claude', role: 'Migrator', prompt: 'Perform this migration across the whole codebase: {task}. Update every call site consistently.' },
      { provider: 'codex', role: 'Verifier', prompt: 'Once the migration is done, find any missed sites and confirm the build and tests pass.' },
    ],
  },
  {
    name: 'Perf tuning',
    slots: [
      { provider: 'claude', role: 'Profiler', prompt: 'Find the performance hotspots for: {task}. Report where time/memory goes — do not optimize yet.' },
      { provider: 'claude', role: 'Optimizer', prompt: 'Wait for the profiler, then optimize the top hotspots without changing behavior.' },
      { provider: 'codex', role: 'Verifier', prompt: 'Confirm the optimization is faster and behavior is unchanged.' },
    ],
  },
  {
    name: 'Frontend feature',
    slots: [
      { provider: 'claude', role: 'Designer', prompt: 'Propose the UI/UX approach for: {task}. Describe layout, states, and interactions — do not build yet.' },
      { provider: 'claude', role: 'Builder', prompt: 'Wait for the designer, then implement the UI to match, matching the existing style.' },
      { provider: 'codex', role: 'Reviewer', prompt: 'Review the result for accessibility, responsiveness, and visual polish.' },
    ],
  },
  {
    name: 'Docs',
    slots: [
      { provider: 'claude', role: 'Writer', prompt: 'Write clear documentation for: {task}.' },
      { provider: 'claude', role: 'Editor', prompt: 'Wait for the writer, then edit for clarity, accuracy, and concision.' },
    ],
  },
];

// Names shipped before seeding became additive — users with the legacy '1' flag
// already had (or dismissed) these, so don't re-add them.
const LEGACY_SEED = [
  'Plan → Build → Review', 'Bug hunt', 'Parallel build',
  'Review panel', 'Research → Spec', 'Test coverage',
];

interface OldSlot { agentId: string; }
interface OldTemplate { name: string; agents: OldSlot[]; }
export function migrate(t: Template | OldTemplate): Template {
  // Old templates stored { agents: [{ agentId, dir, label }] }; drop dir/label.
  if ('agents' in t && Array.isArray((t as OldTemplate).agents)) {
    return { name: t.name, slots: (t as OldTemplate).agents.map((a) => ({ provider: a.agentId })) };
  }
  const nt = t as Template;
  return { name: nt.name, slots: Array.isArray(nt.slots) ? nt.slots : [] };
}

// Which built-in names have already been offered (so we don't re-add a deleted one).
function seededNames(): string[] {
  const raw = localStorage.getItem(SEEDED);
  if (!raw) return [];
  if (raw === '1') return LEGACY_SEED; // legacy flag = the original six
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function load(): Template[] {
  let arr: Template[] = [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(v)) arr = v.map(migrate);
  } catch {
    /* fall through to empty */
  }
  // Top up any built-in the user hasn't been offered yet (new since last launch).
  const offered = new Set(seededNames());
  const have = new Set(arr.map((t) => t.name));
  const fresh = SEED.filter((s) => !offered.has(s.name) && !have.has(s.name));
  if (fresh.length) {
    arr = arr.concat(fresh);
    store(arr);
  }
  localStorage.setItem(SEEDED, JSON.stringify(SEED.map((s) => s.name)));
  return arr;
}
function store(t: Template[]) {
  localStorage.setItem(KEY, JSON.stringify(t));
}

export function listTemplates(): Template[] {
  return load();
}
export function saveTemplate(name: string, slots: TemplateSlot[]) {
  const all = load().filter((t) => t.name !== name);
  all.push({ name, slots });
  store(all);
}
export function removeTemplate(name: string) {
  store(load().filter((t) => t.name !== name));
}

function summarize(slots: TemplateSlot[]): string {
  if (!slots.length) return 'empty';
  return slots.map((s) => s.role?.trim() || s.provider).join(' · ');
}

export interface TemplateHandlers {
  onRun: (t: Template, task: string) => void;
  providers: () => string[];
  currentAgents: () => TemplateSlot[]; // to pre-fill "save current agents"
}

let overlay: HTMLElement | null = null;
export function closeTemplates() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', escClose);
}
function escClose(e: KeyboardEvent) {
  if (e.key === 'Escape') closeTemplates();
}

export function openTemplates(h: TemplateHandlers) {
  closeTemplates();
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  const box = document.createElement('div');
  box.className = 'tmpl';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.onmousedown = (e) => {
    if (e.target === overlay) closeTemplates();
  };
  document.addEventListener('keydown', escClose);

  renderList(box, h);
}

// ---- list view -------------------------------------------------------------
function renderList(box: HTMLElement, h: TemplateHandlers) {
  box.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'tmpl-head';
  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Fleet templates';
  const newBtn = document.createElement('button');
  newBtn.className = 'tmpl-savebtn';
  newBtn.append(icon('plus'), document.createTextNode(' New'));
  newBtn.onclick = () => renderEditor(box, h, null);
  head.append(title, newBtn);
  box.appendChild(head);

  const listEl = document.createElement('div');
  listEl.className = 'tmpl-list';
  const ts = listTemplates();
  if (!ts.length) {
    const e = document.createElement('div');
    e.className = 'tmpl-empty';
    e.textContent = 'No templates yet — hit New to build a fleet.';
    listEl.appendChild(e);
  }
  for (const t of ts) {
    const row = document.createElement('div');
    row.className = 'tmpl-row';
    const info = document.createElement('div');
    info.className = 'tmpl-info';
    const nm = document.createElement('div');
    nm.className = 'tmpl-name';
    nm.textContent = t.name;
    const sub = document.createElement('div');
    sub.className = 'tmpl-sub';
    sub.textContent = summarize(t.slots);
    info.append(nm, sub);

    const run = document.createElement('button');
    run.className = 'tmpl-run';
    run.textContent = 'Run';
    run.onclick = () => renderRun(box, h, t);
    const edit = document.createElement('span');
    edit.className = 'tmpl-del tmpl-edit';
    edit.title = 'edit template';
    edit.appendChild(icon('pencil-simple'));
    edit.onclick = () => renderEditor(box, h, t);
    const del = document.createElement('span');
    del.className = 'tmpl-del';
    del.title = 'delete template';
    del.appendChild(icon('trash'));
    del.onclick = () => {
      removeTemplate(t.name);
      renderList(box, h);
    };
    row.append(info, run, edit, del);
    listEl.appendChild(row);
  }
  box.appendChild(listEl);

  // Shortcut: pre-fill the editor from the agents open right now.
  const saveCur = document.createElement('button');
  saveCur.className = 'tmpl-savebtn tmpl-full';
  saveCur.textContent = 'New from open agents';
  saveCur.onclick = () => {
    const slots = h.currentAgents();
    if (!slots.length) return;
    renderEditor(box, h, { name: '', slots });
  };
  box.appendChild(saveCur);
}

// ---- run view: ask for the task, then spawn --------------------------------
function renderRun(box: HTMLElement, h: TemplateHandlers, t: Template) {
  box.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = `Run ${t.name}`;
  box.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'tmpl-sub tmpl-run-team';
  sub.textContent = summarize(t.slots);
  box.appendChild(sub);

  const task = document.createElement('textarea');
  task.className = 'tmpl-prompt tmpl-full';
  task.rows = 4;
  task.placeholder = 'What should this fleet work on? Sent to each agent alongside its role prompt. Use {task} in a role prompt to place it. Optional.';
  box.appendChild(task);

  const foot = document.createElement('div');
  foot.className = 'tmpl-save';
  const back = document.createElement('button');
  back.className = 'tmpl-savebtn';
  back.textContent = 'Back';
  back.onclick = () => renderList(box, h);
  const go = document.createElement('button');
  go.className = 'tmpl-run';
  go.textContent = 'Run fleet';
  go.onclick = () => {
    h.onRun(t, task.value.trim());
    closeTemplates();
  };
  foot.append(back, go);
  box.appendChild(foot);
  task.focus();
}

// ---- editor view -----------------------------------------------------------
// `orig` null = brand new; otherwise editing (name preserved for rename delete).
function renderEditor(box: HTMLElement, h: TemplateHandlers, orig: Template | null) {
  box.innerHTML = '';
  const slots: TemplateSlot[] = orig ? orig.slots.map((s) => ({ ...s })) : [{ provider: h.providers()[0] ?? 'claude' }];
  const origName = orig?.name ?? null;

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = origName ? 'Edit template' : 'New template';
  box.appendChild(title);

  const nameIn = document.createElement('input');
  nameIn.className = 'tmpl-input tmpl-full';
  nameIn.placeholder = 'Template name';
  nameIn.value = orig?.name ?? '';
  box.appendChild(nameIn);

  const slotsEl = document.createElement('div');
  slotsEl.className = 'tmpl-slots';
  box.appendChild(slotsEl);

  const renderSlots = () => {
    slotsEl.innerHTML = '';
    slots.forEach((slot, i) => {
      const card = document.createElement('div');
      card.className = 'tmpl-slot';

      const top = document.createElement('div');
      top.className = 'tmpl-slot-top';
      const ic = providerIcon(slot.provider);
      ic.classList.add('agent-ico');
      const sel = document.createElement('select');
      sel.className = 'tmpl-select';
      for (const p of h.providers()) {
        const o = document.createElement('option');
        o.value = p;
        o.textContent = p;
        if (p === slot.provider) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => {
        slot.provider = sel.value;
        renderSlots();
      };
      const role = document.createElement('input');
      role.className = 'tmpl-input';
      role.placeholder = 'Role (e.g. Reviewer) — optional';
      role.value = slot.role ?? '';
      role.oninput = () => (slot.role = role.value);
      const del = document.createElement('span');
      del.className = 'tmpl-del';
      del.title = 'remove slot';
      del.appendChild(icon('trash'));
      del.onclick = () => {
        slots.splice(i, 1);
        renderSlots();
      };
      top.append(ic, sel, role, del);

      const prompt = document.createElement('textarea');
      prompt.className = 'tmpl-prompt';
      prompt.rows = 2;
      prompt.placeholder = 'Starter prompt — sent to this agent after it spawns (optional)';
      prompt.value = slot.prompt ?? '';
      prompt.oninput = () => (slot.prompt = prompt.value);

      card.append(top, prompt);
      slotsEl.appendChild(card);
    });
  };
  renderSlots();

  const addBtn = document.createElement('button');
  addBtn.className = 'tmpl-savebtn tmpl-full';
  addBtn.append(icon('plus'), document.createTextNode(' Add agent'));
  addBtn.onclick = () => {
    slots.push({ provider: h.providers()[0] ?? 'claude' });
    renderSlots();
  };
  box.appendChild(addBtn);

  const foot = document.createElement('div');
  foot.className = 'tmpl-save';
  const cancel = document.createElement('button');
  cancel.className = 'tmpl-savebtn';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => renderList(box, h);
  const save = document.createElement('button');
  save.className = 'tmpl-run';
  save.textContent = 'Save';
  save.onclick = () => {
    const name = nameIn.value.trim();
    if (!name || !slots.length) {
      nameIn.focus();
      return;
    }
    // Drop empty role/prompt so summaries stay clean.
    const clean = slots.map((s) => ({
      provider: s.provider,
      ...(s.role?.trim() ? { role: s.role.trim() } : {}),
      ...(s.prompt?.trim() ? { prompt: s.prompt.trim() } : {}),
    }));
    if (origName && origName !== name) removeTemplate(origName);
    saveTemplate(name, clean);
    renderList(box, h);
  };
  foot.append(cancel, save);
  box.appendChild(foot);

  nameIn.focus();
}

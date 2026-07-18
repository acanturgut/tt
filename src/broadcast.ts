import { agentTree, type Agent } from './agents';
import { icon } from './icon';

export interface BroadcastHandlers {
  onSend: (ids: string[], text: string, numbered: boolean) => void;
}

// Agents explicitly turned OFF as targets (via the dropdown). New agents default ON.
const excluded = new Set<string>();
// When on, each agent is prefixed with "You are agent N of M".
let numbered = localStorage.getItem('tt.bcNumbered') === '1';

let handlers: BroadcastHandlers | null = null;
let currentAgents: Agent[] = [];

let rootEl: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let targetBtn: HTMLButtonElement | null = null;
let numBtn: HTMLButtonElement | null = null;
let pop: HTMLElement | null = null; // target multi-select popover
let slash: HTMLElement | null = null; // slash-command menu

function selectedIds(): string[] {
  return currentAgents.filter((a) => !excluded.has(a.id)).map((a) => a.id);
}

function setNumbered(v: boolean) {
  numbered = v;
  localStorage.setItem('tt.bcNumbered', v ? '1' : '0');
  numBtn?.classList.toggle('on', numbered);
}

// ---- slash commands -------------------------------------------------------
interface Slash {
  cmd: string;
  desc: string;
  run: () => void;
}
function slashCommands(): Slash[] {
  return [
    { cmd: '/all', desc: 'target every agent', run: () => { excluded.clear(); syncTargetBtn(); } },
    {
      cmd: '/none',
      desc: 'clear target selection',
      run: () => { currentAgents.forEach((a) => excluded.add(a.id)); syncTargetBtn(); },
    },
    {
      cmd: '/number',
      desc: `${numbered ? 'disable' : 'enable'} "You are agent N of M" prefix`,
      run: () => setNumbered(!numbered),
    },
    { cmd: '/clear', desc: 'clear the message box', run: () => { if (input) input.value = ''; } },
  ];
}

// #N tokens target agents by their number (1-based position). Returns targets + stripped text.
function parseTargets(text: string): { ids: string[]; clean: string } | null {
  const tokens = new Set<string>();
  const re = /(?:^|\s)#([0-9]+(?:-[0-9]+)*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tokens.add(m[1]);
  if (!tokens.size) return null;
  const byLabel = new Map(agentTree(currentAgents).map((n) => [n.label, n.agent.id]));
  const ids: string[] = [];
  for (const tok of tokens) {
    const id = byLabel.get(tok);
    if (id) ids.push(id);
  }
  const clean = text.replace(/(?:^|\s)#[0-9]+(?:-[0-9]+)*\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { ids, clean };
}

function doSend() {
  if (!input || !handlers) return;
  let text = input.value.trim();
  if (!text) return;
  // A leading tt slash command runs its effect and is stripped — never sent to
  // agents. An unrecognized "/…" is left as-is (it may be the agent's own command).
  const m = text.match(/^\/(\S+)/);
  if (m) {
    const cmd = slashCommands().find((c) => c.cmd === `/${m[1]}`);
    if (cmd) {
      cmd.run();
      text = text.slice(m[0].length).trim();
      input.value = '';
      closeSlash();
      if (!text) return; // command only — nothing left to send
    }
  }
  const parsed = parseTargets(text);
  const ids = parsed ? parsed.ids : selectedIds();
  const msg = parsed ? parsed.clean : text;
  if (!ids.length || !msg) return;
  handlers.onSend(ids, msg, numbered);
  input.value = '';
  input.focus();
  closeSlash();
}

function positionBelow(menu: HTMLElement, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 6}px`;
}

function closeSlash() {
  slash?.remove();
  slash = null;
}
function openSlash(prefix: string) {
  closeSlash();
  const cmds = slashCommands().filter((c) => c.cmd.startsWith(prefix));
  if (!cmds.length || !input) return;
  slash = document.createElement('div');
  slash.className = 'bc-slash';
  for (const c of cmds) {
    const it = document.createElement('div');
    it.className = 'bc-slash-item';
    const name = document.createElement('span');
    name.className = 'bc-slash-cmd';
    name.textContent = c.cmd;
    const desc = document.createElement('span');
    desc.className = 'bc-slash-desc';
    desc.textContent = c.desc;
    it.append(name, desc);
    it.onmousedown = (e) => {
      e.preventDefault();
      c.run();
      if (input) input.value = '';
      closeSlash();
      input?.focus();
    };
    slash.appendChild(it);
  }
  document.body.appendChild(slash);
  positionBelow(slash, input);
}

// ---- target multi-select popover -----------------------------------------
function onPopDown(e: MouseEvent) {
  if (pop && !pop.contains(e.target as Node) && !targetBtn?.contains(e.target as Node)) closePop();
}
function closePop() {
  pop?.remove();
  pop = null;
  document.removeEventListener('mousedown', onPopDown);
}
function togglePop() {
  if (pop) {
    closePop();
    return;
  }
  pop = document.createElement('div');
  pop.className = 'bc-pop';
  renderPop();
  document.body.appendChild(pop);
  if (targetBtn) positionBelow(pop, targetBtn);
  setTimeout(() => document.addEventListener('mousedown', onPopDown), 0);
}
function renderPop() {
  if (!pop) return;
  pop.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'bc-pop-head';
  const t = document.createElement('span');
  t.textContent = 'Broadcast to';
  const all = document.createElement('button');
  all.className = 'bc-pop-mini';
  all.textContent = 'All';
  all.onmousedown = (e) => { e.preventDefault(); excluded.clear(); renderPop(); syncTargetBtn(); };
  const none = document.createElement('button');
  none.className = 'bc-pop-mini';
  none.textContent = 'None';
  none.onmousedown = (e) => {
    e.preventDefault();
    currentAgents.forEach((a) => excluded.add(a.id));
    renderPop();
    syncTargetBtn();
  };
  head.append(t, all, none);
  pop.appendChild(head);

  const list = document.createElement('div');
  list.className = 'bc-pop-list';
  currentAgents.forEach((a, i) => {
    const on = !excluded.has(a.id);
    const row = document.createElement('div');
    row.className = 'bc-pop-item' + (on ? ' on' : '');
    const check = document.createElement('span');
    check.className = 'bc-pop-check';
    check.appendChild(icon(on ? 'check-square' : 'square'));
    const num = document.createElement('span');
    num.className = 'bc-pop-num';
    num.textContent = String(i + 1);
    const nm = document.createElement('span');
    nm.className = 'bc-pop-name';
    nm.textContent = a.name;
    row.append(check, num, nm);
    row.onmousedown = (e) => {
      e.preventDefault();
      if (on) excluded.add(a.id);
      else excluded.delete(a.id);
      renderPop();
      syncTargetBtn();
    };
    list.appendChild(row);
  });
  pop.appendChild(list);
}

function syncTargetBtn() {
  if (!targetBtn) return;
  const total = currentAgents.length;
  const sel = selectedIds().length;
  const label = targetBtn.querySelector('.bc-target-label');
  if (label) label.textContent = sel === total ? `All ${total}` : `${sel} of ${total}`;
}

// Built once so the input keeps its value/focus across store re-renders.
export function mountBroadcast(root: HTMLElement, h: BroadcastHandlers) {
  handlers = h;
  rootEl = root;
  root.innerHTML = '';

  targetBtn = document.createElement('button');
  targetBtn.className = 'bc-target';
  targetBtn.title = 'choose which agents receive the broadcast';
  targetBtn.append(icon('broadcast'));
  const tl = document.createElement('span');
  tl.className = 'bc-target-label';
  tl.textContent = '0 of 0';
  targetBtn.append(tl, icon('caret-up'));
  targetBtn.onclick = (e) => {
    e.stopPropagation();
    togglePop();
  };

  const inputWrap = document.createElement('div');
  inputWrap.className = 'bc-input';
  input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Message selected agents…   ( / commands · #2 targets agent 2 · Enter )';
  input.oninput = () => {
    const v = input!.value;
    if (v.startsWith('/')) openSlash(v.trim().split(/\s+/)[0]);
    else closeSlash();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSend();
    } else if (e.key === 'Escape') {
      closeSlash();
    }
  };
  input.onblur = () => setTimeout(closeSlash, 120);
  inputWrap.append(input);

  numBtn = document.createElement('button');
  numBtn.className = 'bc-num' + (numbered ? ' on' : '');
  numBtn.title = 'prefix each agent with "You are agent N of M" — one message can address each differently';
  numBtn.append(icon('hash'), document.createTextNode(' number'));
  numBtn.onclick = () => setNumbered(!numbered);

  root.append(targetBtn, inputWrap, numBtn);
}

// Refresh only the target button + open popover on agent changes (never the input).
export function updateBroadcast(agents: Agent[]) {
  currentAgents = agents;
  if (!rootEl) return;
  rootEl.style.display = agents.length ? 'flex' : 'none';
  if (!agents.length) {
    closePop();
    closeSlash();
    return;
  }
  syncTargetBtn();
  if (pop) renderPop();
}

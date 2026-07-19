import gsap from 'gsap';
import { agentTree, type Agent } from './agents';
import { icon } from './icon';
import { tip } from './tooltip';

export interface BroadcastHandlers {
  onSend: (ids: string[], text: string, numbered: boolean) => void;
}

// Agents explicitly turned OFF as targets (via the dropdown). New agents default ON.
const excluded = new Set<string>();
// When on, each agent is prefixed with "You are agent N of M".
let numbered = localStorage.getItem('tt.bcNumbered') === '1';
// Draft survives closing the composer, so a half-written message isn't lost.
let draft = '';

// Shell-style history: past sends walk back with ↑, forward with ↓.
const HIST_KEY = 'tt.bcHistory';
const HIST_MAX = 50;
let history: string[] = loadHistory(); // oldest → newest
let histIdx = -1; // -1 = live draft; otherwise an index into `history`
let histStash = ''; // the live draft, saved while browsing history

function loadHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function pushHistory(text: string) {
  if (!text || history[history.length - 1] === text) return; // skip blanks + consecutive dups
  history.push(text);
  if (history.length > HIST_MAX) history = history.slice(-HIST_MAX);
  localStorage.setItem(HIST_KEY, JSON.stringify(history));
}

let handlers: BroadcastHandlers | null = null;
let currentAgents: Agent[] = [];

let rootEl: HTMLElement | null = null;
let triggerText: HTMLElement | null = null; // collapsed bar: draft/placeholder
let triggerCount: HTMLElement | null = null; // collapsed bar: "All N"

// composer overlay (the expanded editor)
let composer: HTMLElement | null = null;
let scrim: HTMLElement | null = null;
let field: HTMLTextAreaElement | null = null; // the editing surface (only exists while open)
let targetBtn: HTMLButtonElement | null = null; // target anchor inside the open composer
let numBtn: HTMLButtonElement | null = null;
let pop: HTMLElement | null = null; // target multi-select popover
let slash: HTMLElement | null = null; // slash-command menu
let slashCmds: Slash[] = [];
let slashIdx = 0;

const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    { cmd: '/clear', desc: 'clear the message box', run: () => { if (field) field.value = ''; autoGrow(); } },
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
  // No token matched a live agent -> this wasn't addressing anyone, it was prose
  // ("fix issue #42"). Fall back to the selected targets instead of sending nowhere.
  if (!ids.length) return null;
  const clean = text.replace(/(?:^|\s)#[0-9]+(?:-[0-9]+)*\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { ids, clean };
}

function doSend() {
  if (!field || !handlers) return;
  let text = field.value.trim();
  if (!text) return;
  // A leading tt slash command runs its effect and is stripped — never sent to
  // agents. An unrecognized "/…" is left as-is (it may be the agent's own command).
  const m = text.match(/^\/(\S+)/);
  if (m) {
    const cmd = slashCommands().find((c) => c.cmd === `/${m[1]}`);
    if (cmd) {
      cmd.run();
      text = text.slice(m[0].length).trim();
      field.value = '';
      closeSlash();
      autoGrow();
      if (!text) return; // command only — nothing left to send
    }
  }
  const parsed = parseTargets(text);
  const ids = parsed ? parsed.ids : selectedIds();
  const msg = parsed ? parsed.clean : text;
  if (!ids.length || !msg) return;
  handlers.onSend(ids, msg, numbered);
  pushHistory(text);
  histIdx = -1;
  field.value = '';
  autoGrow();
  field.focus();
  closeSlash();
}

// ---- history recall -------------------------------------------------------
// ↑ recalls only when the caret is on the first line, ↓ only on the last line,
// so normal multi-line editing keeps the arrows.
function caretOnFirstLine(f: HTMLTextAreaElement): boolean {
  return f.value.lastIndexOf('\n', f.selectionStart - 1) === -1;
}
function caretOnLastLine(f: HTMLTextAreaElement): boolean {
  return f.value.indexOf('\n', f.selectionStart) === -1;
}
function applyRecall() {
  if (!field) return;
  autoGrow();
  const end = field.value.length;
  field.setSelectionRange(end, end); // caret to end, like a shell
  closeSlash();
}
function recall(step: -1 | 1) {
  if (!field || !history.length) return;
  if (histIdx === -1) {
    if (step > 0) return; // already at the live draft — nothing newer
    histStash = field.value; // stash it so ↓ can bring it back
    histIdx = history.length - 1;
  } else {
    const next = histIdx + step;
    if (next < 0) return; // oldest — stay put
    if (next >= history.length) {
      histIdx = -1; // stepped past the newest → restore the live draft
      field.value = histStash;
      applyRecall();
      return;
    }
    histIdx = next;
  }
  field.value = history[histIdx];
  applyRecall();
}

function autoGrow() {
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${Math.min(field.scrollHeight, 220)}px`;
}

function positionBelow(menu: HTMLElement, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 6}px`;
}

// ---- slash menu -----------------------------------------------------------
function closeSlash() {
  slash?.remove();
  slash = null;
  slashCmds = [];
}
function highlightSlash() {
  if (!slash) return;
  Array.from(slash.children).forEach((el, i) =>
    (el as HTMLElement).classList.toggle('sel', i === slashIdx),
  );
}
function runSlash(i: number) {
  const c = slashCmds[i];
  if (!c) return;
  c.run();
  if (field) field.value = '';
  closeSlash();
  autoGrow();
  field?.focus();
}
function openSlash(prefix: string) {
  closeSlash();
  const cmds = slashCommands().filter((c) => c.cmd.startsWith(prefix));
  if (!cmds.length || !field) return;
  slashCmds = cmds;
  slashIdx = 0;
  slash = document.createElement('div');
  slash.className = 'bc-slash';
  cmds.forEach((c, i) => {
    const it = document.createElement('div');
    it.className = 'bc-slash-item';
    const name = document.createElement('span');
    name.className = 'bc-slash-cmd';
    name.textContent = c.cmd;
    const desc = document.createElement('span');
    desc.className = 'bc-slash-desc';
    desc.textContent = c.desc;
    it.append(name, desc);
    it.onmouseenter = () => { slashIdx = i; highlightSlash(); };
    it.onmousedown = (e) => { e.preventDefault(); runSlash(i); };
    slash!.appendChild(it);
  });
  document.body.appendChild(slash);
  positionBelow(slash, field);
  highlightSlash();
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
  if (pop) { closePop(); return; }
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

function targetSummary(): string {
  const total = currentAgents.length;
  const sel = selectedIds().length;
  return sel === total ? `All ${total}` : `${sel} of ${total}`;
}
function syncTargetBtn() {
  const label = targetBtn?.querySelector('.bc-target-label');
  if (label) label.textContent = targetSummary();
  if (triggerCount) triggerCount.textContent = currentAgents.length ? targetSummary() : '';
}

// ---- key handling on the composer field ----------------------------------
function onFieldKey(e: KeyboardEvent) {
  if (slash && slashCmds.length) {
    if (e.key === 'ArrowDown') { slashIdx = Math.min(slashCmds.length - 1, slashIdx + 1); highlightSlash(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { slashIdx = Math.max(0, slashIdx - 1); highlightSlash(); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runSlash(slashIdx); return; }
    if (e.key === 'Escape') { closeSlash(); return; }
  }
  // Recall previous sends (only reachable when the slash menu isn't open).
  if (!e.shiftKey && field) {
    if (e.key === 'ArrowUp' && caretOnFirstLine(field)) { e.preventDefault(); recall(-1); return; }
    if (e.key === 'ArrowDown' && caretOnLastLine(field)) { e.preventDefault(); recall(1); return; }
  }
  // Enter sends; Shift+Enter inserts a newline (default textarea behaviour).
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  else if (e.key === 'Escape') { if (pop) closePop(); else closeComposer(); }
}

// ---- composer open / close -----------------------------------------------
function hint(keys: string[], label: string): HTMLElement {
  const h = document.createElement('span');
  h.className = 'bc-hint';
  for (const k of keys) {
    const kb = document.createElement('kbd');
    kb.textContent = k;
    h.appendChild(kb);
  }
  h.appendChild(document.createTextNode(label));
  return h;
}

export function openComposer() {
  if (!currentAgents.length) return;
  if (composer) { field?.focus(); return; }

  scrim = document.createElement('div');
  scrim.className = 'bc-scrim';
  scrim.onmousedown = (e) => { if (e.target === scrim) closeComposer(); };

  composer = document.createElement('div');
  composer.className = 'bc-composer';
  composer.setAttribute('role', 'dialog');
  composer.setAttribute('aria-label', 'Broadcast to agents');

  // head: target selector · number toggle · close
  const head = document.createElement('div');
  head.className = 'bc-comp-head';
  targetBtn = document.createElement('button');
  targetBtn.className = 'bc-target';
  targetBtn.append(icon('broadcast'));
  const tl = document.createElement('span');
  tl.className = 'bc-target-label';
  tl.textContent = targetSummary();
  targetBtn.append(tl, icon('caret-down'));
  targetBtn.onclick = (e) => { e.stopPropagation(); togglePop(); };
  tip(targetBtn, 'Choose which agents receive this');

  numBtn = document.createElement('button');
  numBtn.className = 'bc-num' + (numbered ? ' on' : '');
  numBtn.append(icon('hash'), document.createTextNode(' number'));
  numBtn.onclick = () => setNumbered(!numbered);
  tip(numBtn, 'Prefix each agent with "You are agent N of M"');

  const spacer = document.createElement('div');
  spacer.className = 'bc-comp-spacer';
  const closeB = document.createElement('button');
  closeB.className = 'bc-comp-close';
  closeB.append(icon('x'));
  closeB.onclick = closeComposer;
  tip(closeB, 'Close', 'esc');
  head.append(targetBtn, spacer, numBtn, closeB);

  // body: the textarea
  const body = document.createElement('div');
  body.className = 'bc-comp-body';
  field = document.createElement('textarea');
  field.className = 'bc-field';
  field.rows = 1;
  field.value = draft;
  histIdx = -1; // fresh open — ↑ starts from the newest send again
  field.placeholder = 'Message agents…';
  field.oninput = () => {
    histIdx = -1; // typing diverges from history; re-stash on the next ↑
    autoGrow();
    const v = field!.value;
    if (/^\/\S*$/.test(v)) openSlash(v);
    else closeSlash();
  };
  field.onkeydown = onFieldKey;
  body.appendChild(field);

  // foot: kbd hints + syntax legend + Send
  const foot = document.createElement('div');
  foot.className = 'bc-comp-foot';
  const hints = document.createElement('div');
  hints.className = 'bc-comp-hints';
  hints.append(
    hint(['↵'], 'Send'),
    hint(['⇧', '↵'], 'New line'),
    hint(['↑'], 'History'),
    hint(['/'], 'Commands'),
    hint(['#'], 'Target one'),
  );
  const foSpacer = document.createElement('div');
  foSpacer.className = 'bc-comp-spacer';
  const sendB = document.createElement('button');
  sendB.className = 'bc-send';
  sendB.append(document.createTextNode('Send'));
  const sendKbd = document.createElement('kbd');
  sendKbd.textContent = '↵';
  sendB.appendChild(sendKbd);
  sendB.onclick = doSend;
  foot.append(hints, foSpacer, sendB);

  composer.append(head, body, foot);
  document.body.append(scrim, composer);
  autoGrow(); // settle the field height before measuring the target rect
  syncTargetBtn();

  // The omnibox hands off to the composer: hide the bar, fade the panel in, and let
  // the content rise into place. The glass panel never scales/translates — only its
  // opacity changes — because transforming a backdrop-filter element flashes white.
  if (rootEl) rootEl.style.opacity = '0';
  if (reduceMotion() || !rootEl) {
    if (scrim) scrim.style.opacity = '1';
  } else {
    gsap.to(scrim, { opacity: 1, duration: 0.25, ease: 'power2.out' });
    gsap.fromTo(composer, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: 'power2.out' });
    gsap.fromTo(
      Array.from(composer.children),
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.34, ease: 'power3.out', delay: 0.05, stagger: 0.04, clearProps: 'transform' },
    );
  }

  field.focus();
  const end = field.value.length;
  field.setSelectionRange(end, end);
}

export function closeComposer() {
  if (!composer) return;
  draft = field?.value ?? draft;
  updateTrigger();
  closeSlash();
  closePop();
  const c = composer;
  const s = scrim;
  composer = null;
  scrim = null;
  field = null;
  targetBtn = null;
  numBtn = null;
  // fade the composer out, then reveal the real omnibox again as it vanishes
  const done = () => { c.remove(); s?.remove(); if (rootEl) rootEl.style.opacity = ''; };
  if (reduceMotion() || !rootEl) { done(); return; }
  if (s) gsap.to(s, { opacity: 0, duration: 0.2, ease: 'power2.in' });
  gsap.to(Array.from(c.children), { opacity: 0, y: 8, duration: 0.16, ease: 'power2.in' });
  gsap.to(c, { opacity: 0, duration: 0.22, ease: 'power2.in', onComplete: done });
}

function updateTrigger() {
  if (!triggerText) return;
  triggerText.textContent = draft.trim() || 'Message agents…';
  triggerText.classList.toggle('has-draft', !!draft.trim());
}

// ---- collapsed bar (the trigger) ------------------------------------------
export function mountBroadcast(root: HTMLElement, h: BroadcastHandlers) {
  handlers = h;
  rootEl = root;
  root.innerHTML = '';

  const trigger = document.createElement('button');
  trigger.className = 'bc-trigger';
  trigger.append(icon('broadcast'));
  triggerText = document.createElement('span');
  triggerText.className = 'bc-trigger-text';
  triggerCount = document.createElement('span');
  triggerCount.className = 'bc-trigger-count';
  trigger.append(triggerText, triggerCount);
  trigger.onclick = openComposer;
  tip(trigger, 'Broadcast to agents', '⌘ L');
  updateTrigger();

  root.appendChild(trigger);
}

// Refresh target counts on agent changes (never disturbs an open composer's text).
export function updateBroadcast(agents: Agent[]) {
  currentAgents = agents;
  if (!rootEl) return;
  // stay in flow (visibility, not display) so #tb-right keeps its right-edge position
  rootEl.style.visibility = agents.length ? 'visible' : 'hidden';
  if (!agents.length) {
    closePop();
    closeSlash();
    if (composer) closeComposer();
  }
  syncTargetBtn();
  if (pop) renderPop();
}

import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './agents';
import { renderDiffBody } from './git';
import {
  deriveTreeCards,
  detectFinished,
  type TreeCard,
  type Worktree,
  type RunningAgent,
  type ShipReason,
  type GitStatus,
  type FileEntry,
} from './gitgraph';

export interface DockDeps {
  getAgents: () => RunningAgent[];
  revealFolder: (path: string) => void;
  openFile?: (path: string) => void;
}

// One color per reason, matching git.ts's palette style. Colors the strip badge + chips.
const REASON_COLOR: Record<ShipReason, string> = {
  review: '#bc8cff',
  finished: '#3fb950',
  changes: '#e3b341',
  ahead: '#5b8cff',
};

let dockEl: HTMLElement | null = null;
let getRoot: () => string | null = () => null;
let deps: DockDeps = { getAgents: () => [], revealFolder: () => {} };

let worktrees: Worktree[] = [];
let cards: TreeCard[] = [];
let expanded = false;
let selectedPath: string | null = null;
const finishedIds = new Set<string>();
let prevStatus = new Map<string, string>();
let pollTimer: number | null = null;
// Stable child regions so a poll repaints only what changed — and never yanks focus
// from the commit textarea (mirrors the git page's region-swap + focus guard).
let stripRegion: HTMLElement | null = null;
let detailRegion: HTMLElement | null = null;
let detailHash = ''; // last-painted detail signature; skip repaint when unchanged

let detailStatus: GitStatus | null = null;
let detailRoot: string | null = null; // the tree path detailStatus was fetched for (refetch guard)
let selFile: { path: string; staged: boolean } | null = null;
let selDiff = '';
let commitMsg = '';
let statusReq = 0; // supersession counter: a newer loadStatus voids an in-flight older one
let diffReq = 0;   // same, for loadDiff (a newer file click voids an older diff fetch)

export function isDockOpen(): boolean {
  return expanded;
}

export function mountShipDock(el: HTMLElement, getProjectRoot: () => string | null, d: DockDeps): void {
  dockEl = el;
  getRoot = getProjectRoot;
  deps = d;
  // Re-derive on any agent change (status/label move without git refs moving).
  subscribe(() => onAgents());
  // Poll git_worktrees for dirty/ahead while a project is open.
  if (pollTimer === null) pollTimer = window.setInterval(() => { if (!document.hidden) void poll(); }, 1500);
  void poll();
}

// Agent store changed: detect working→idle finishes, drop re-activated agents, re-render.
function onAgents(): void {
  const agents = deps.getAgents();
  const { transitioned, next } = detectFinished(prevStatus, agents);
  transitioned.forEach((id) => finishedIds.add(id));
  // A re-activated agent (now working again) is no longer "finished".
  for (const a of agents) if (a.status === 'working') finishedIds.delete(a.id);
  prevStatus = next;
  render();
}

async function poll(): Promise<void> {
  const root = getRoot();
  if (!root) { worktrees = []; render(); return; }
  try {
    worktrees = await invoke<Worktree[]>('git_worktrees', { root });
  } catch {
    worktrees = [];
  }
  render();
}

// True while the commit textarea holds focus — a poll must not repaint under it (loses the cursor).
function commitFocused(): boolean {
  const el = document.activeElement;
  return !!el && el.classList.contains('dock-msg');
}

function render(): void {
  if (!dockEl) return;
  cards = deriveTreeCards(worktrees, deps.getAgents(), finishedIds);
  // If the selected tree fell off the list, drop the selection (and collapse if it's gone).
  if (selectedPath && !cards.some((c) => c.path === selectedPath)) {
    selectedPath = null;
    expanded = false;
    document.body.classList.remove('dock-open');
  }
  if (!cards.length) { dockEl.replaceChildren(); stripRegion = detailRegion = null; detailHash = ''; return; }

  // Ensure the two stable regions exist. The detail wrapper only takes space when expanded
  // (CSS hides it otherwise) so an empty wrapper never pushes the strip up.
  if (!stripRegion) {
    stripRegion = document.createElement('div');
    detailRegion = document.createElement('div');
    detailRegion.className = 'dock-detailwrap';
    dockEl.replaceChildren(stripRegion, detailRegion);
  }

  // Strip is cheap and stateless (chips) — always repaint.
  stripRegion!.replaceChildren(renderStrip());

  // Detail: only when expanded, only when its inputs changed, and never under a focused commit box.
  if (expanded && selectedPath) {
    const dh = detailSignature();
    if (dh !== detailHash && !commitFocused()) {
      detailHash = dh;
      detailRegion!.replaceChildren(renderDetail(selectedPath));
    }
  } else {
    detailRegion!.replaceChildren();
    detailHash = '';
  }
}

// Signature of everything the detail renders from.
function detailSignature(): string {
  // Repaint the detail whenever the tree's status, the selected file, or its diff changes.
  // commitMsg is deliberately excluded — the textarea owns it via oninput; including it would
  // repaint (and drop focus) on every keystroke.
  return JSON.stringify([
    selectedPath,
    detailStatus?.branch, detailStatus?.ahead,
    detailStatus?.files.map((f) => [f.path, f.staged, f.unstaged, f.x, f.y]),
    selFile, selDiff.length,
  ]);
}

// Two columns: dock-owned Source Control (changes + commit + push) left, shared diff right.
// The dock owns its changes list rather than reusing git.ts's fileGroup: that helper is bound to
// git.ts's module-global selection/root. ponytail: ~40 lines vs. threading git.ts's state out.
function renderDetail(path: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dock-detail';
  wrap.append(renderSourceControl(path), renderDiffPane());
  // Fetch status for this tree if we haven't already (async → re-render on arrival).
  // Guard on detailRoot, not detailStatus.toplevel — git's toplevel can differ from the
  // worktree path by normalization, which would refetch every render (a loop).
  if (detailRoot !== path) void loadStatus(path);
  return wrap;
}

function renderSourceControl(root: string): HTMLElement {
  const sc = document.createElement('div');
  sc.className = 'dock-sc';

  // Push header
  const head = document.createElement('div');
  head.className = 'dock-sc-head';
  const branch = document.createElement('span');
  branch.textContent = detailStatus?.branch ?? '';
  const push = document.createElement('button');
  push.className = 'dock-push';
  const ahead = detailStatus?.ahead ?? 0;
  push.textContent = ahead ? `Push ↑${ahead}` : 'Push';
  push.disabled = !ahead;
  push.onclick = () => act(() => invoke('git_push', { root }), root);
  head.append(branch, push);
  sc.appendChild(head);

  const files = detailStatus?.files ?? [];
  sc.appendChild(fileGroup('Staged', files.filter((f) => f.staged), true, root));
  sc.appendChild(fileGroup('Changes', files.filter((f) => f.unstaged), false, root));

  // Commit box
  const box = document.createElement('div');
  box.className = 'dock-commitbox';
  const ta = document.createElement('textarea');
  ta.className = 'dock-msg';
  ta.placeholder = 'Commit message';
  ta.value = commitMsg;
  const staged = files.filter((f) => f.staged);
  const commit = document.createElement('button');
  commit.className = 'dock-commit-btn';
  commit.textContent = `Commit ${staged.length ? '(' + staged.length + ')' : ''}`.trim();
  commit.disabled = !staged.length || !commitMsg.trim();
  ta.oninput = () => {
    commitMsg = ta.value;
    commit.disabled = !staged.length || !commitMsg.trim();
  };
  commit.onclick = () =>
    act(async () => {
      await invoke('git_commit', { root, message: commitMsg.trim() });
      commitMsg = '';
    }, root);
  box.append(ta, commit);
  sc.appendChild(box);
  return sc;
}

function fileGroup(label: string, files: FileEntry[], staged: boolean, root: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'dock-group';
  const head = document.createElement('div');
  head.className = 'dock-group-head';
  head.textContent = `${label} ${files.length}`;
  g.appendChild(head);
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'dock-file' + (selFile?.path === f.path && selFile.staged === staged ? ' on' : '');
    const st = document.createElement('span');
    st.className = 'dock-x';
    st.textContent = staged ? f.x : f.y;
    const name = document.createElement('span');
    name.className = 'dock-fname';
    name.textContent = f.path;
    name.title = f.path;
    const btn = document.createElement('button');
    btn.className = 'dock-stage';
    btn.textContent = staged ? '−' : '+';
    btn.title = staged ? 'Unstage' : 'Stage';
    btn.onclick = (e) => {
      e.stopPropagation();
      act(() => invoke(staged ? 'git_unstage' : 'git_stage', { root, path: f.path }), root);
    };
    row.append(st, name, btn);
    row.onclick = () => { selFile = { path: f.path, staged }; void loadDiff(root, f.path, staged); };
    g.appendChild(row);
  }
  return g;
}

function renderDiffPane(): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'dock-diffpane';
  if (!selFile) {
    const e = document.createElement('div');
    e.className = 'dock-diff-empty';
    e.textContent = 'Select a file to see the diff.';
    pane.appendChild(e);
    return pane;
  }
  pane.appendChild(renderDiffBody(selDiff, selFile.path));
  return pane;
}

async function loadStatus(root: string): Promise<void> {
  const my = ++statusReq;
  let next: GitStatus | null;
  try {
    next = await invoke<GitStatus>('git_status', { root });
  } catch {
    next = null;
  }
  if (my !== statusReq) return; // superseded by a newer loadStatus (tree switched) — don't clobber
  detailStatus = next;
  detailRoot = root; // mark as fetched (even on failure) so renderDetail doesn't refetch every render
  render();
}

async function loadDiff(root: string, path: string, staged: boolean): Promise<void> {
  const my = ++diffReq;
  let next: string;
  try {
    next = await invoke<string>('git_diff', { root, path, staged });
  } catch {
    next = '';
  }
  if (my !== diffReq) return; // superseded by a newer loadDiff (different file clicked)
  selDiff = next;
  render();
}

// Run a git mutation, then refresh this tree's status (and the worktree poll for dirty/ahead).
function act(fn: () => Promise<unknown>, root: string): void {
  void (async () => {
    try {
      await fn();
    } catch (err) {
      console.error('[shipdock]', err);
    }
    await loadStatus(root);
    void poll();
  })();
}

function renderStrip(): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'dock-strip';

  const badge = document.createElement('span');
  badge.className = 'dock-badge';
  const top = cards[0].reasons[0];
  badge.style.setProperty('--reason', REASON_COLOR[top]);
  badge.append(document.createTextNode(`● ${cards.length} to review`));
  badge.onclick = () => (expanded ? closeDock() : openDock(cards[0].path));
  strip.appendChild(badge);

  for (const card of cards) {
    const chip = document.createElement('button');
    chip.className = 'dock-chip' + (card.path === selectedPath ? ' on' : '');
    chip.style.setProperty('--reason', REASON_COLOR[card.reasons[0]]);
    const name = document.createElement('span');
    name.className = 'dock-chip-name';
    name.textContent = card.branch || card.path.split('/').pop() || card.path;
    chip.appendChild(name);
    const meta = document.createElement('span');
    meta.className = 'dock-chip-meta';
    const bits: string[] = [];
    if (card.dirty) bits.push(`·${card.dirty}`);
    if (card.ahead) bits.push(`↑${card.ahead}`);
    const who = card.agents[0];
    if (who) bits.push(`${who.name} ${who.status}`);
    meta.textContent = bits.join(' ');
    chip.appendChild(meta);
    chip.onclick = () => openDock(card.path);
    strip.appendChild(chip);
  }
  return strip;
}

export function openDock(path?: string): void {
  const target = path ?? selectedPath ?? cards[0]?.path ?? null;
  if (!target) return;
  selectTree(target);
  expanded = true;
  document.body.classList.add('dock-open');
  render();
}

export function closeDock(): void {
  expanded = false;
  document.body.classList.remove('dock-open');
  render();
}

export function toggleDock(): void {
  if (expanded) closeDock();
  else openDock();
}

// Selecting a tree clears its `finished` reason (you're now looking at it).
export function selectTree(path: string): void {
  if (path !== selectedPath) { detailStatus = null; detailRoot = null; selFile = null; selDiff = ''; commitMsg = ''; }
  selectedPath = path;
  const card = cards.find((c) => c.path === path);
  if (card) card.agents.forEach((a) => finishedIds.delete(a.id));
}

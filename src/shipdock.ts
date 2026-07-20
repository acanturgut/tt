import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './agents';
import {
  deriveTreeCards,
  detectFinished,
  type TreeCard,
  type Worktree,
  type RunningAgent,
  type ShipReason,
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
  // renderDetail / detailStatus / selFile / selDiff are added in Task 4; in Task 3 the detail is
  // the stub, so this simply paints an empty region.
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

// Signature of everything the detail renders from. In Task 3 (stub) it depends only on the
// selection; Task 4 replaces this to include detailStatus / selFile / selDiff.
function detailSignature(): string {
  return String(selectedPath);
}

// Placeholder detail — replaced in Task 4. Keeps the strip shippable and testable on its own.
function renderDetail(_path: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'dock-detail';
  return d;
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
  selectedPath = path;
  const card = cards.find((c) => c.path === path);
  if (card) card.agents.forEach((a) => finishedIds.delete(a.id));
}

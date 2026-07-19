import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { icon } from './icon';
import {
  layoutGraph,
  agentForWorktree,
  type GitStatus,
  type FileEntry,
  type Commit,
  type Worktree,
  type RunningAgent,
} from './gitgraph';
import { highlight, escapeHtml } from './viewer';

export interface GitDeps {
  getAgents: () => RunningAgent[];
  revealFolder: (path: string) => void;
  openFile?: (path: string) => void;
}

let gitEl: HTMLElement | null = null;
let getRoot: () => string | null = () => null;
let deps: GitDeps = { getAgents: () => [], revealFolder: () => {} };
let open = false;
let timer: number | null = null;

// Live snapshot + change hashes (re-render only when something actually changed).
let status: GitStatus | null = null;
let commits: Commit[] = [];
let worktrees: Worktree[] = [];
let hStatus = '', hLog = '', hWt = '';

let commitMsg = ''; // preserved across re-renders
let wtOpen = true; // worktrees section expanded
// Current selection shown in the diff pane.
type Sel = { kind: 'file'; path: string; staged: boolean } | { kind: 'commit'; hash: string } | null;
let sel: Sel = null;
let diffText = '';
// Stable region containers so a poll repaints only the region that changed, not the whole page.
let railEl: HTMLElement | null = null;
let treeEl: HTMLElement | null = null;
let diffEl: HTMLElement | null = null;
let railPending = false; // a rail change deferred while the commit textarea holds focus
let treePending = false; // a graph change deferred while the user is actively scrolling the graph
let treeBusyUntil = 0;   // performance.now() until which the graph counts as "being scrolled"

export function isGitOpen(): boolean {
  return open;
}

export function mountGit(root: HTMLElement, getProjectRoot: () => string | null, d: GitDeps): void {
  gitEl = root;
  getRoot = getProjectRoot;
  deps = d;
}

export function openGit(): void {
  open = true;
  document.body.classList.add('git-open');
  hStatus = hLog = hWt = ''; // force a fresh paint
  render(); // build the shell now; refresh() fills each region granularly
  void refresh();
  if (timer === null) timer = window.setInterval(() => void refresh(), 1500);
}

export function closeGit(): void {
  open = false;
  document.body.classList.remove('git-open');
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

async function refresh(): Promise<void> {
  if (!open) return;
  const root = getRoot();
  if (!root) {
    status = { repo: false, toplevel: '', branch: '', ahead: 0, behind: 0, files: [] };
    render();
    return;
  }
  try {
    const [st, lg, wt] = await Promise.all([
      invoke<GitStatus>('git_status', { root }),
      invoke<Commit[]>('git_log_graph', { root, limit: 200 }),
      invoke<Worktree[]>('git_worktrees', { root }),
    ]);
    const a = JSON.stringify(st);
    const b = JSON.stringify(lg);
    const w = JSON.stringify(wt) + JSON.stringify(deps.getAgents().map((x) => [x.dir, x.status]));
    let sChanged = false, lChanged = false, wChanged = false;
    if (a !== hStatus) { status = st; hStatus = a; sChanged = true; }
    if (b !== hLog) { commits = lg; hLog = b; lChanged = true; }
    if (w !== hWt) { worktrees = wt; hWt = w; wChanged = true; }
    // Repaint ONLY the region that changed, not the whole page. The rail holds the commit
    // textarea, so defer its repaint while the user is typing (in tt the repo changes
    // constantly — a poll mustn't wipe what they're typing).
    if (sChanged || wChanged) railPending = true;
    if (railPending && !typingCommitMsg()) { railPending = false; paintRail(); }
    // The graph rebuilds only when commits change — AND never while the user is actively
    // scrolling it (a mid-scroll 200-row DOM rebuild drops frames; agents commit constantly in
    // tt). A deferred rebuild lands the instant scrolling settles (re-checked every poll).
    if (lChanged) treePending = true;
    if (treePending && performance.now() >= treeBusyUntil) { treePending = false; paintTree(); }
  } catch {
    // e.g. not a git repo → git_log_graph rejects; show the empty state.
    status = { repo: false, toplevel: '', branch: '', ahead: 0, behind: 0, files: [] };
    render();
  }
}

// True while the commit-message textarea holds focus (so a poll won't re-render under it).
function typingCommitMsg(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.classList.contains('git-msg');
}

// git_status returns repo-toplevel-relative paths, so path/diff/mutation commands must run
// against the repo toplevel — not the project dir, which may be a subdirectory of the repo.
// (Falls back to the project dir before the first status resolves the toplevel.)
function repoRoot(): string | null {
  return status?.toplevel || getRoot();
}

async function act(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    toast(String(e));
  }
  hStatus = hLog = hWt = ''; // force re-render after a mutation
  await refresh();
}

function render(): void {
  if (!gitEl) return;
  gitEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'git-wrap';
  railEl = renderRail();
  treeEl = renderTree();
  diffEl = renderDiff();
  const main = document.createElement('div');
  main.className = 'git-main';
  main.append(treeEl, diffEl);
  wrap.append(railEl, main);
  gitEl.appendChild(wrap);
}

// Swap one region in place, keeping scroll — a poll touches only the changed region instead
// of tearing down the whole page. Falls back to a full render if the shell isn't built yet.
function paintRail(): void {
  if (!railEl) { render(); return; }
  const top = railEl.scrollTop;
  const fresh = renderRail();
  railEl.replaceWith(fresh);
  railEl = fresh;
  railEl.scrollTop = top;
}
function paintTree(): void {
  if (!treeEl) { render(); return; }
  const top = treeEl.scrollTop;
  const fresh = renderTree();
  treeEl.replaceWith(fresh);
  treeEl = fresh;
  treeEl.scrollTop = top;
}
function paintDiff(): void {
  if (!diffEl) { render(); return; }
  const fresh = renderDiff(); // new selection → starts at the top, no scroll to preserve
  diffEl.replaceWith(fresh);
  diffEl = fresh;
}

// ---- left rail: branch, worktrees, changes, commit box ----
function renderRail(): HTMLElement {
  const rail = document.createElement('div');
  rail.className = 'git-rail';

  // header
  const head = document.createElement('div');
  head.className = 'git-head';
  const back = document.createElement('button');
  back.className = 'git-back';
  back.textContent = '✕';
  back.title = 'Close (Esc)';
  back.onclick = closeGit;
  const title = document.createElement('span');
  title.className = 'git-title';
  title.textContent = 'Git';
  head.append(back, title);
  rail.appendChild(head);

  if (!status || !status.repo) {
    const empty = document.createElement('div');
    empty.className = 'git-empty';
    empty.textContent = 'Not a git repository.';
    rail.appendChild(empty);
    return rail;
  }

  // branch + ahead/behind + push
  const br = document.createElement('div');
  br.className = 'git-branch';
  const bicon = icon('git-branch');
  const bname = document.createElement('span');
  bname.className = 'git-branch-name';
  bname.textContent = status.branch || '(detached)';
  br.append(bicon, bname);
  if (status.ahead || status.behind) {
    const ab = document.createElement('span');
    ab.className = 'git-ab';
    ab.textContent = `${status.ahead ? '↑' + status.ahead : ''}${status.behind ? ' ↓' + status.behind : ''}`.trim();
    br.appendChild(ab);
  }
  const push = document.createElement('button');
  push.className = 'git-push';
  push.textContent = 'Push';
  push.disabled = !status.ahead;
  push.onclick = () =>
    act(async () => {
      const out = await invoke<string>('git_push', { root: repoRoot() });
      toast(out || 'Pushed');
    });
  br.appendChild(push);
  rail.appendChild(br);

  rail.appendChild(renderWorktrees()); // Task 8 fills this in

  // changes
  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => f.unstaged);
  rail.appendChild(
    fileGroup('Staged', staged, true, () =>
      act(async () => { for (const f of staged) await invoke('git_unstage', { root: repoRoot(), path: f.path }); }),
    ),
  );
  rail.appendChild(
    fileGroup('Changes', unstaged, false, () =>
      act(async () => { for (const f of unstaged) await invoke('git_stage', { root: repoRoot(), path: f.path }); }),
    ),
  );

  // commit box
  const box = document.createElement('div');
  box.className = 'git-commitbox';
  const ta = document.createElement('textarea');
  ta.className = 'git-msg';
  ta.placeholder = 'Commit message';
  ta.value = commitMsg;
  const commit = document.createElement('button');
  commit.className = 'git-commit-btn';
  commit.textContent = `Commit ${staged.length ? '(' + staged.length + ')' : ''}`.trim();
  commit.disabled = !staged.length || !commitMsg.trim();
  ta.oninput = () => {
    commitMsg = ta.value;
    commit.disabled = !staged.length || !commitMsg.trim();
  };
  commit.onclick = () =>
    act(async () => {
      await invoke('git_commit', { root: repoRoot(), message: commitMsg.trim() });
      commitMsg = '';
      toast('Committed');
    });
  box.append(ta, commit);
  rail.appendChild(box);
  return rail;
}

function fileGroup(label: string, files: FileEntry[], staged: boolean, onAll: () => void): HTMLElement {
  const g = document.createElement('div');
  g.className = 'git-group';
  const head = document.createElement('div');
  head.className = 'git-group-head';
  head.append(document.createTextNode(`${label} `));
  const cnt = document.createElement('span');
  cnt.className = 'git-count';
  cnt.textContent = String(files.length);
  head.appendChild(cnt);
  if (files.length) {
    const all = document.createElement('button');
    all.className = 'git-all';
    all.textContent = staged ? 'Unstage all' : 'Stage all';
    all.onclick = onAll;
    head.appendChild(all);
  }
  g.appendChild(head);
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'git-file' + (sel?.kind === 'file' && sel.path === f.path && sel.staged === staged ? ' on' : '');
    const st = document.createElement('span');
    st.className = 'git-x x-' + (staged ? f.x : f.y);
    st.textContent = staged ? f.x : f.y;
    const name = document.createElement('span');
    name.className = 'git-fname';
    name.textContent = f.path;
    name.title = f.path;
    const btn = document.createElement('button');
    btn.className = 'git-stage';
    btn.textContent = staged ? '−' : '+';
    btn.title = staged ? 'Unstage' : 'Stage';
    btn.onclick = (e) => {
      e.stopPropagation();
      act(() => invoke(staged ? 'git_unstage' : 'git_stage', { root: repoRoot(), path: f.path }));
    };
    row.append(st, name, btn);
    row.onclick = () => selectFile(f.path, staged);
    g.appendChild(row);
  }
  return g;
}

// ---- right main: tree (top) + diff (bottom), each painted independently ----
const LANE_PALETTE =['#5b8cff', '#3fb950', '#e3b341', '#bc8cff', '#f85149', '#39c5cf', '#f0883e', '#db61a2'];
const LANE_W = 16; // px per lane column
const ROW_H = 28; // px per commit row

const SVGNS = 'http://www.w3.org/2000/svg';

function renderTree(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'git-tree';
  // While the user scrolls the graph, hold off rebuilding its DOM (see refresh()).
  wrap.addEventListener('scroll', () => { treeBusyUntil = performance.now() + 400; }, { passive: true });
  if (!commits.length) return wrap;

  const rows = layoutGraph(commits);
  const maxCols = rows.reduce((m, r) => Math.max(m, r.cols), 1);
  const gw = maxCols * LANE_W + LANE_W / 2;
  const x = (lane: number) => LANE_W / 2 + lane * LANE_W;

  const list = document.createElement('div');
  list.className = 'git-tree-list';

  // Per-row self-contained SVG cell. CSS `.git-tree-row { content-visibility: auto }` then lets
  // the browser skip rendering rows that are off-screen — so scrolling only ever paints the ~30
  // visible rows, however long the history is. (A single tall SVG for all rows still re-rasters
  // its whole column tile-by-tile on scroll; per-row + content-visibility avoids that.)
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'git-tree-row' + (sel?.kind === 'commit' && sel.hash === r.commit.hash ? ' on' : '');
    row.style.height = `${ROW_H}px`;
    row.onclick = () => void selectCommit(r.commit.hash);

    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'git-tree-svg');
    svg.setAttribute('width', String(gw));
    svg.setAttribute('height', String(ROW_H));
    for (const e of r.edges) {
      const p = document.createElementNS(SVGNS, 'path');
      const x1 = x(e.from), x2 = x(e.to);
      p.setAttribute('d', `M ${x1} 0 C ${x1} ${ROW_H / 2}, ${x2} ${ROW_H / 2}, ${x2} ${ROW_H}`);
      p.setAttribute('stroke', LANE_PALETTE[e.color % LANE_PALETTE.length]);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-width', '2');
      svg.appendChild(p);
    }
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', String(x(r.lane)));
    dot.setAttribute('cy', String(ROW_H / 2));
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', LANE_PALETTE[r.color % LANE_PALETTE.length]);
    dot.style.stroke = 'var(--bg)'; // .style, not setAttribute — so var() resolves in WebKit
    dot.setAttribute('stroke-width', '1.5');
    svg.appendChild(dot);

    const graphCell = document.createElement('div');
    graphCell.className = 'git-tree-graph';
    graphCell.style.width = `${gw}px`;
    graphCell.appendChild(svg);

    const meta = document.createElement('div');
    meta.className = 'git-tree-meta';
    for (const ref of r.commit.refs) {
      const chip = document.createElement('span');
      chip.className = 'git-ref' + (ref.includes('/') ? ' remote' : '');
      chip.textContent = ref;
      meta.appendChild(chip);
    }
    const subj = document.createElement('span');
    subj.className = 'git-tree-subj';
    subj.textContent = r.commit.subject;
    const info = document.createElement('span');
    info.className = 'git-tree-info';
    info.textContent = `${r.commit.author} · ${r.commit.relDate}`;
    meta.append(subj, info);

    row.append(graphCell, meta);
    list.appendChild(row);
  });

  wrap.appendChild(list);
  return wrap;
}

function renderDiff(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'git-diff';
  if (!sel) {
    const e = document.createElement('div');
    e.className = 'git-diff-empty';
    e.textContent = 'Select a file or commit to see the diff.';
    wrap.appendChild(e);
    return wrap;
  }

  // header: what we're showing + (for files) a staged/unstaged toggle
  const head = document.createElement('div');
  head.className = 'git-diff-head';
  const label = document.createElement('span');
  label.className = 'git-diff-label';
  label.textContent = sel.kind === 'file' ? sel.path : sel.hash.slice(0, 8);
  head.appendChild(label);
  if (sel.kind === 'file') {
    const selPath = sel.path; // capture in the narrowed block; drops the fragile `sel as` cast
    const seg = document.createElement('div');
    seg.className = 'git-seg';
    for (const s of [false, true]) {
      const b = document.createElement('button');
      b.className = 'git-seg-btn' + (sel.staged === s ? ' on' : '');
      b.textContent = s ? 'Staged' : 'Working';
      b.onclick = () => selectFile(selPath, s);
      seg.appendChild(b);
    }
    head.appendChild(seg);
  }
  wrap.appendChild(head);

  const langPath = sel.kind === 'file' ? sel.path : '.txt';
  const body = document.createElement('div');
  body.className = 'git-diff-body';
  let oldLn = 0, newLn = 0;
  for (const raw of diffText.split('\n')) {
    if (raw === '') continue; // trailing split artifact (git diff ends with a newline)
    const line = document.createElement('div');
    let cls = 'dl';
    let text = raw;
    if (raw.startsWith('@@')) {
      cls = 'dl hunk';
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) { oldLn = parseInt(m[1], 10); newLn = parseInt(m[2], 10); }
    } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
      cls = 'dl add'; text = raw.slice(1);
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      cls = 'dl del'; text = raw.slice(1);
    } else if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('new file') || raw.startsWith('deleted file') || raw.startsWith('rename ') || raw.startsWith('similarity ')) {
      cls = 'dl meta';
    }
    line.className = cls;

    const gutO = document.createElement('span');
    gutO.className = 'dl-no';
    const gutN = document.createElement('span');
    gutN.className = 'dl-no';
    if (cls === 'dl' || cls === 'dl del') gutO.textContent = String(oldLn++);
    if (cls === 'dl' || cls === 'dl add') gutN.textContent = String(newLn++);

    const code = document.createElement('span');
    code.className = 'dl-code';
    // ponytail: per-line highlight loses multi-line string/comment context — fine for a diff.
    code.innerHTML = cls === 'dl hunk' || cls === 'dl meta' ? escapeHtml(text) : highlight(langPath, text);

    line.append(gutO, gutN, code);
    body.appendChild(line);
  }
  wrap.appendChild(body);
  return wrap;
}

async function selectFile(path: string, staged: boolean): Promise<void> {
  sel = { kind: 'file', path, staged };
  treeEl?.querySelectorAll('.git-tree-row.on').forEach((e) => e.classList.remove('on'));
  paintRail(); // instant file-row highlight; don't rebuild the graph for a file click
  try {
    diffText = await invoke<string>('git_diff', { root: repoRoot(), path, staged });
  } catch (e) {
    diffText = String(e);
  }
  paintDiff();
}

async function selectCommit(hash: string): Promise<void> {
  sel = { kind: 'commit', hash };
  railEl?.querySelectorAll('.git-file.on').forEach((e) => e.classList.remove('on'));
  paintTree(); // instant commit-row highlight
  try {
    diffText = await invoke<string>('git_show', { root: repoRoot(), hash });
  } catch (e) {
    diffText = String(e);
  }
  paintDiff();
}

let toastEl: HTMLElement | null = null;
function toast(msg: string): void {
  toastEl?.remove();
  toastEl = document.createElement('div');
  toastEl.className = 'git-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.textContent = msg;
  document.body.appendChild(toastEl);
  const t = toastEl;
  setTimeout(() => t.remove(), 2200);
}

function renderWorktrees(): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'git-worktrees';
  if (worktrees.length <= 1) return sec; // nothing interesting for a single checkout

  const head = document.createElement('div');
  head.className = 'git-group-head git-wt-head';
  head.append(document.createTextNode('Worktrees '));
  const cnt = document.createElement('span');
  cnt.className = 'git-count';
  cnt.textContent = String(worktrees.length);
  head.appendChild(cnt);
  const toggle = document.createElement('button');
  toggle.className = 'git-all';
  toggle.textContent = wtOpen ? 'Hide' : 'Show';
  toggle.onclick = () => { wtOpen = !wtOpen; paintRail(); };
  head.appendChild(toggle);
  sec.appendChild(head);
  if (!wtOpen) return sec;

  const agents = deps.getAgents();
  const subjectOf = (headHash: string) =>
    commits.find((c) => c.hash === headHash)?.subject ?? '';

  for (const w of worktrees) {
    const card = document.createElement('div');
    card.className = 'git-wt';
    const top = document.createElement('div');
    top.className = 'git-wt-top';
    const br = document.createElement('span');
    br.className = 'git-wt-branch';
    br.textContent = w.bare ? '(bare)' : w.detached ? '(detached)' : w.branch || '(no branch)';
    top.appendChild(br);
    if (w.dirty) {
      const d = document.createElement('span');
      d.className = 'git-wt-dirty';
      d.textContent = `●${w.dirty}`;
      d.title = `${w.dirty} uncommitted change(s)`;
      top.appendChild(d);
    }
    if (w.ahead || w.behind) {
      const ab = document.createElement('span');
      ab.className = 'git-wt-ab';
      ab.textContent = `${w.ahead ? '↑' + w.ahead : ''}${w.behind ? ' ↓' + w.behind : ''}`.trim();
      top.appendChild(ab);
    }
    card.appendChild(top);

    const sub = document.createElement('div');
    sub.className = 'git-wt-sub';
    sub.textContent = `${w.head.slice(0, 7)} ${subjectOf(w.head)}`.trim();
    sub.title = w.path;
    card.appendChild(sub);

    const agent = agentForWorktree(agents, w.path);
    if (agent) {
      const a = document.createElement('div');
      a.className = 'git-wt-agent';
      const dot = document.createElement('span');
      dot.className = 'git-wt-agentdot ' + (agent.status === 'working' ? 'working' : '');
      a.append(dot, document.createTextNode(`${agent.name} · ${agent.status}`));
      card.appendChild(a);
    }

    if (!w.bare) {
      const acts = document.createElement('div');
      acts.className = 'git-wt-acts';
      const tree = document.createElement('button');
      tree.className = 'git-wt-btn';
      tree.append(icon('folders'), document.createTextNode(' tree'));
      tree.onclick = () => deps.revealFolder(w.path);
      const finder = document.createElement('button');
      finder.className = 'git-wt-btn';
      finder.textContent = 'Finder';
      finder.onclick = () => void revealItemInDir(w.path).catch(() => {});
      acts.append(tree, finder);
      card.appendChild(acts);
    }
    sec.appendChild(card);
  }
  return sec;
}

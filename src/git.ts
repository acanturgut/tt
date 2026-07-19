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
import { highlight, escapeHtml, langForPath } from './viewer';

// Phosphor icon per ref kind: local branch vs the checked-out HEAD vs a remote
// (origin/*) vs a tag — so head and origin read as different things at a glance.
const REF_ICON: Record<string, string> = {
  head: 'git-commit',
  branch: 'git-branch',
  remote: 'cloud',
  tag: 'tag',
};

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
let hStatus = '', hLog = '', hWt = '', hSig = '';

let commitMsg = ''; // preserved across re-renders
let wtOpen = false; // worktrees section starts collapsed
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
  hStatus = hLog = hWt = hSig = ''; // force a fresh paint
  // Drop the previous repo's data — the project may have changed while we were closed,
  // and stale `sel`/`status` would paint another repo's diff (and route staging at its root).
  sel = null; diffText = ''; status = null; commits = []; worktrees = []; diffReq++;
  render(); // build the shell now; refresh() fills each region granularly
  const root = getRoot();
  // Warm git's commit-graph once (fire-and-forget) — makes `git log` ~17x faster on deep
  // histories. Incremental after the first write; never blocks the UI.
  if (root) void invoke('git_ensure_graph', { root }).catch(() => {});
  void refresh();
  // Skip the poll while the window is backgrounded — no point spawning git
  // subprocesses nobody's looking at; the next visible tick catches up in ≤1.5s.
  if (timer === null) timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 1500);
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
    // Cheap probes every tick: working-tree status + a ref fingerprint (did any branch move?).
    // Both are milliseconds even on huge repos; the full graph (`git log --all`) and the
    // per-worktree fan-out are the expensive part, so we run those ONLY when refs actually moved.
    const [st, sig] = await Promise.all([
      invoke<GitStatus>('git_status', { root }),
      invoke<string>('git_refs_sig', { root }),
    ]);
    const a = JSON.stringify(st);
    if (a !== hStatus) { status = st; hStatus = a; railPending = true; }

    if (sig !== hSig) {
      hSig = sig;
      const [lg, wt] = await Promise.all([
        invoke<Commit[]>('git_log_graph', { root }), // full history — the list is virtualized
        invoke<Worktree[]>('git_worktrees', { root }),
      ]);
      const b = JSON.stringify(lg);
      if (b !== hLog) { commits = lg; hLog = b; treePending = true; }
      worktrees = wt; // ponytail: other worktrees' dirty counts refresh on ref movement, not on
                      // every keystroke there — fine in tt where agents commit constantly.
    }
    // The rail's worktree cards show live agent status, which changes without refs moving — so
    // fold agents into the rail hash and repaint on either. Defer while the commit textarea holds
    // focus (in tt the repo changes constantly — a poll mustn't wipe what they're typing).
    const w = JSON.stringify(worktrees) + JSON.stringify(deps.getAgents().map((x) => [x.dir, x.status]));
    if (w !== hWt) { hWt = w; railPending = true; }
    if (railPending && !typingCommitMsg()) { railPending = false; paintRail(); }
    // The graph never rebuilds while the user is actively scrolling it (a mid-scroll 200-row DOM
    // rebuild drops frames). A deferred rebuild lands the instant scrolling settles.
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
  const remote = (
    cls: string,
    ico: string,
    label: string,
    cmd: string,
    disabled: boolean,
    done: string,
  ) => {
    const b = document.createElement('button');
    b.className = cls;
    b.append(icon(ico), document.createTextNode(label));
    b.disabled = disabled;
    b.onclick = () => {
      // Remote ops hit the network: spin the icon so the click doesn't look ignored.
      b.classList.add('git-busy');
      b.disabled = true;
      act(async () => {
        const out = await invoke<string>(cmd, { root: repoRoot() });
        toast(out || done);
      }).finally(() => {
        b.classList.remove('git-busy');
        b.disabled = disabled;
      });
    };
    br.appendChild(b);
  };
  remote('git-fetch', 'arrows-clockwise', 'Fetch', 'git_fetch', false, 'Fetched');
  remote('git-pull', 'arrow-down', 'Pull', 'git_pull', !status.behind, 'Pulled');
  remote('git-push', 'arrow-up', 'Push', 'git_push', !status.ahead, 'Pushed');
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

function renderTree(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'git-tree';
  // While the user scrolls the graph, hold off rebuilding its DOM (see refresh()).
  wrap.addEventListener('scroll', () => { treeBusyUntil = performance.now() + 400; }, { passive: true });
  if (!commits.length) return wrap;

  const rows = layoutGraph(commits);
  const x = (lane: number) => LANE_W / 2 + lane * LANE_W;
  // Text gutter widens as branches open (top→down) and never shrinks back, so the text column
  // stays put instead of snapping far left when many lanes merge at once (the ragged jump).
  let runMax = 1;
  const gutters = rows.map((r) => { runMax = Math.max(runMax, r.cols); return runMax * LANE_W + LANE_W; });

  const graphW = runMax * LANE_W + LANE_W; // monotonic gutter → its final value is the widest
  const H = rows.length * ROW_H;

  const list = document.createElement('div');
  list.className = 'git-tree-list';
  list.style.position = 'relative';
  list.style.height = `${H}px`;

  // Only the visible band of rows exists in the DOM, and the canvas is only as tall as
  // that band. Drawing the whole history onto one canvas silently broke on real repos:
  // canvas area is capped (~16.7M px² in WKWebView), so past roughly 1500 commits the
  // allocation fails and the graph draws NOTHING — lanes and dots vanish, text stays.
  // Windowing also drops the rebuild-on-every-commit cost from O(all) to O(~70 rows).
  // ponytail: the full log still crosses IPC on each refresh; git_log_graph already
  // takes a `limit` if that ever becomes the bottleneck.
  const buildRow = (r: (typeof rows)[number], i: number) => {
    const row = document.createElement('div');
    row.className = 'git-tree-row' + (sel?.kind === 'commit' && sel.hash === r.commit.hash ? ' on' : '');
    row.style.position = 'absolute';
    row.style.top = `${i * ROW_H}px`;
    row.style.left = '0';
    row.style.right = '0';
    row.style.height = `${ROW_H}px`;
    row.style.paddingLeft = `${gutters[i]}px`;
    row.onclick = () => void selectCommit(r.commit.hash);

    const meta = document.createElement('div');
    meta.className = 'git-tree-meta';
    const laneColor = LANE_PALETTE[r.color % LANE_PALETTE.length];
    for (const ref of r.commit.refs) {
      const chip = document.createElement('span');
      chip.className = 'git-ref git-ref-' + ref.kind;
      chip.style.setProperty('--c', laneColor); // colored per branch, like the reference
      chip.append(icon(REF_ICON[ref.kind]), document.createTextNode(ref.name));
      meta.appendChild(chip);
    }
    const subj = document.createElement('span');
    subj.className = 'git-tree-subj';
    // Bold the conventional-commit prefix (e.g. "feat(chat)!:") like the reference graph.
    const cc = /^(\w+(?:\([^)]*\))?!?:)(.*)$/.exec(r.commit.subject);
    if (cc) {
      const type = document.createElement('span');
      type.className = 'git-tree-type';
      type.textContent = cc[1];
      subj.append(type, document.createTextNode(cc[2]));
    } else {
      subj.textContent = r.commit.subject;
    }
    const info = document.createElement('span');
    info.className = 'git-tree-info';
    info.textContent = `${r.commit.author} · ${r.commit.relDate}`;
    meta.append(subj, info);

    row.appendChild(meta);
    return row;
  };

  // The canvas covers only the drawn band and is repositioned as it scrolls
  // (pointer-events: none, transparent except the lanes — row clicks pass through).
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.className = 'git-tree-canvas';
  canvas.style.width = `${graphW}px`;
  const ctx = canvas.getContext('2d');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0a0b0d';

  const BUF = 15; // rows drawn beyond each edge, so a fast flick doesn't show a blank band
  let raf = 0;
  const drawWindow = () => {
    raf = 0;
    const vis = Math.ceil((wrap.clientHeight || 800) / ROW_H); // 0 before attach — assume a screenful
    const start = Math.max(0, Math.floor(wrap.scrollTop / ROW_H) - BUF);
    const end = Math.min(rows.length, start + vis + 2 * BUF);
    const bandH = (end - start) * ROW_H;
    canvas.width = Math.ceil(graphW * dpr);
    canvas.height = Math.ceil(bandH * dpr);
    canvas.style.height = `${bandH}px`;
    canvas.style.top = `${start * ROW_H}px`;
    list.replaceChildren(canvas, ...rows.slice(start, end).map((r, k) => buildRow(r, start + k)));
    if (!ctx) return;
    // Shift the origin so the per-row draw code below keeps using absolute row offsets.
    ctx.setTransform(dpr, 0, 0, dpr, 0, -start * ROW_H * dpr);
    ctx.lineWidth = 2;
    for (let i = start; i < end; i++) {
      const r = rows[i];
      const y0 = i * ROW_H, ny = i * ROW_H + ROW_H / 2, y1 = (i + 1) * ROW_H;
      for (const e of r.edges) {
        const x1 = x(e.from), x2 = x(e.to);
        ctx.strokeStyle = LANE_PALETTE[e.color % LANE_PALETTE.length];
        ctx.beginPath();
        if (e.from === e.to) {
          ctx.moveTo(x1, y0); ctx.lineTo(x1, y1);                                              // straight lane
        } else if (e.to === r.lane) {
          ctx.moveTo(x1, y0); ctx.bezierCurveTo(x1, ny - ROW_H / 4, x2, ny - ROW_H / 4, x2, ny); // into node
        } else if (e.from === r.lane) {
          ctx.moveTo(x1, ny); ctx.bezierCurveTo(x1, ny + ROW_H / 4, x2, ny + ROW_H / 4, x2, y1); // out of node
        } else {
          ctx.moveTo(x1, y0); ctx.bezierCurveTo(x1, ny, x2, ny, x2, y1);                        // passing by
        }
        ctx.stroke();
      }
    }
    for (let i = start; i < end; i++) {
      const r = rows[i];
      const ny = i * ROW_H + ROW_H / 2, nx = x(r.lane);
      const isMerge = r.commit.parents.length > 1;
      ctx.beginPath();
      ctx.arc(nx, ny, isMerge ? 6.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = LANE_PALETTE[r.color % LANE_PALETTE.length];
      ctx.fill();
      ctx.lineWidth = isMerge ? 2 : 1.5;
      ctx.strokeStyle = bg;
      ctx.stroke();
      if (isMerge) {
        ctx.beginPath();
        ctx.moveTo(nx - 2.6, ny - 1.1); ctx.lineTo(nx, ny + 1.6); ctx.lineTo(nx + 2.6, ny - 1.1);
        ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = bg;
        ctx.stroke();
      }
    }
  };

  wrap.addEventListener(
    'scroll',
    () => { if (!raf) raf = requestAnimationFrame(drawWindow); },
    { passive: true },
  );
  drawWindow(); // pre-attach: clientHeight is 0, so this uses the fallback height
  requestAnimationFrame(drawWindow); // attached now — redraw against the real viewport

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

  // Resolve the language ONCE, not per line. Commit diffs (and unknown file types) resolve to null
  // → plain escaped text, which skips hljs.highlightAuto entirely (its per-line, all-languages cost
  // is what froze the view on any real diff). Known file types still get real syntax highlighting.
  const langPath = sel.kind === 'file' ? sel.path : '.txt';
  const lang = langForPath(langPath);
  const body = document.createElement('div');
  body.className = 'git-diff-body';
  for (const d of parseDiff(diffText)) {
    const { cls, text } = d;
    const line = document.createElement('div');
    line.className = cls;

    const gutO = document.createElement('span');
    gutO.className = 'dl-no';
    const gutN = document.createElement('span');
    gutN.className = 'dl-no';
    if (d.oldNo !== null) gutO.textContent = String(d.oldNo);
    if (d.newNo !== null) gutN.textContent = String(d.newNo);

    const code = document.createElement('span');
    code.className = 'dl-code';
    // ponytail: per-line highlight loses multi-line string/comment context — fine for a diff.
    // No known language (commit diffs, unknown types) → plain text; never fall back to highlightAuto.
    code.innerHTML =
      cls === 'dl hunk' || cls === 'dl meta' || !lang ? escapeHtml(text) : highlight(langPath, text);

    line.append(gutO, gutN, code);
    body.appendChild(line);
  }
  wrap.appendChild(body);
  return wrap;
}

// Guards against a slow diff landing after a newer selection and painting the wrong
// content under the current header. Same pattern as the viewer's reqId.
let diffReq = 0;

export interface DiffLine {
  cls: string;
  text: string;
  oldNo: number | null; // gutter numbers; null = no number on that side
  newNo: number | null;
}

// Split a unified diff into renderable lines.
//
// Inside a hunk a line's TYPE IS ITS FIRST CHARACTER — never a prefix like `---`/`+++`,
// which only mean anything in the header. Matching on those prefixes misread real
// content: deleting a `---` markdown rule classified as metadata, which also skipped
// the oldLn++ and desynced every line number below it in that hunk.
export function parseDiff(diffText: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldLn = 0, newLn = 0, inHunk = false;
  // Width of the marker column(s). 1 for an ordinary diff; a COMBINED diff (`git show`
  // on a merge → `diff --cc`, `@@@ -a -b +c @@@`) carries one column per parent, so its
  // rows look like " -old" / "+ new" and reading only char 0 renders every change as
  // context. The @-run in the hunk header tells us how many.
  let cols = 1;
  for (const raw of diffText.split('\n')) {
    if (raw === '') continue; // trailing split artifact (git diff ends with a newline)
    let cls = 'dl';
    let text = raw;
    const hm = /^(@{2,}) (.*?) \1/.exec(raw);
    if (hm) {
      cls = 'dl hunk';
      inHunk = true;
      cols = hm[1].length - 1;
      // Ranges are "-old [-old2 …] +new"; take the first minus and the plus.
      const parts = hm[2].split(' ');
      const minus = parts.find((p) => p.startsWith('-'));
      const plus = parts.find((p) => p.startsWith('+'));
      oldLn = minus ? parseInt(minus.slice(1), 10) : 0;
      newLn = plus ? parseInt(plus.slice(1), 10) : 0;
    } else if (raw.startsWith('diff ')) {
      cls = 'dl meta'; inHunk = false; cols = 1; // next file in a multi-file diff — header mode
    } else if (!inHunk) {
      cls = 'dl meta'; // everything before the first @@ is header (index/+++/---/new file/…)
    } else if (raw.startsWith('\\')) {
      cls = 'dl meta'; // "\ No newline at end of file" — counts for neither side
    } else {
      // Any marker column holding +/- decides the line; the rest is content.
      const mark = raw.slice(0, cols);
      text = raw.slice(cols);
      if (mark.includes('+')) cls = 'dl add';
      else if (mark.includes('-')) cls = 'dl del';
    }
    // A combined diff carries one old-side numbering PER PARENT, and there are only two
    // gutter columns — any single number there would be wrong for at least one parent.
    // Show the (unambiguous) new side only rather than print a confident lie.
    const combined = cols > 1;
    out.push({
      cls,
      text,
      oldNo: !combined && (cls === 'dl' || cls === 'dl del') ? oldLn++ : null,
      newNo: cls === 'dl' || cls === 'dl add' ? newLn++ : null,
    });
  }
  return out;
}

async function selectFile(path: string, staged: boolean): Promise<void> {
  sel = { kind: 'file', path, staged };
  treeEl?.querySelectorAll('.git-tree-row.on').forEach((e) => e.classList.remove('on'));
  paintRail(); // instant file-row highlight; don't rebuild the graph for a file click
  const my = ++diffReq;
  let next: string;
  try {
    next = await invoke<string>('git_diff', { root: repoRoot(), path, staged });
  } catch (e) {
    next = String(e);
  }
  if (my !== diffReq) return; // superseded by a later click
  diffText = next;
  paintDiff();
}

async function selectCommit(hash: string): Promise<void> {
  sel = { kind: 'commit', hash };
  railEl?.querySelectorAll('.git-file.on').forEach((e) => e.classList.remove('on'));
  paintTree(); // instant commit-row highlight
  const my = ++diffReq;
  let next: string;
  try {
    next = await invoke<string>('git_show', { root: repoRoot(), hash });
  } catch (e) {
    next = String(e);
  }
  if (my !== diffReq) return;
  diffText = next;
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

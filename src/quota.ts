import { invoke } from '@tauri-apps/api/core';
import { providerIcon } from './providers';
import { icon } from './icon';
import { placeMenu } from './menu';

// Account-level plan quota per provider ("how much have I got left"), as opposed
// to Agent.tokens, which is per-agent context size. Fed by the Rust `quota-changed`
// event; see src-tauri/src/quota.rs for the two parsers.
export interface QuotaWindow {
  provider: string; // "claude" | "codex"
  key: string; // "session" | "weekly_all" | "weekly_scoped:Fable"
  label: string; // "Session" | "Weekly · Fable"
  percent_used: number;
  resets_at: number; // epoch seconds
  fetched_at: number; // epoch seconds — claude's can be HOURS old, codex's is seconds
}

let windows: QuotaWindow[] = [];
const listeners = new Set<() => void>();

export function subscribeQuota(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setQuota(w: QuotaWindow[]) {
  windows = w;
  listeners.forEach((l) => l());
}
export function quotaWindows(): QuotaWindow[] {
  return windows;
}

// Claude's quota is a cache we cannot force to refresh (no usage subcommand, and
// headless `claude -p` doesn't refresh it), so a reading can be hours old. That
// makes staleness a permanent design constraint rather than a tuning problem.
//
// The rule: within a window, percent-used only ever RISES. So a stale reading is
// not noise — it's a guaranteed bound, and "at least 26% used" stays true. Once
// the window rolls over (now >= resets_at) usage restarted near zero and the
// cached number bounds nothing at all, so we must say we don't know.
//
// Never render 0% from stale data: "0%" reads as "I checked, you've used nothing",
// which is a fresh-data claim. Erring high costs you throttled work; erring low
// starts a long run that dies mid-way. Fail toward "you have less than you think".
export type QuotaState =
  | { kind: 'exact'; remaining: number }
  | { kind: 'atMost'; remaining: number } // stale but window hasn't rolled: a true upper bound
  | { kind: 'unknown' };

// Only a near-instant reading earns an exact claim. 15min was too generous: a
// fleet running hard can burn real quota in that time, so "74%" could already be
// "0%" — the dangerous direction. Strictly, anything older than *now* is only an
// upper bound; this threshold just keeps the ≤ glyph meaningful instead of
// decorating every pill forever.
export const STALE_AFTER = 120; // seconds

export function displayState(w: QuotaWindow, now: number): QuotaState {
  if (!w.resets_at || now >= w.resets_at) return { kind: 'unknown' };
  const remaining = Math.max(0, 100 - w.percent_used);
  const age = now - w.fetched_at;
  if (!w.fetched_at || age > STALE_AFTER) return { kind: 'atMost', remaining };
  return { kind: 'exact', remaining };
}

export function fmtState(s: QuotaState): string {
  if (s.kind === 'unknown') return '—';
  return `${s.kind === 'atMost' ? '≤' : ''}${Math.round(s.remaining)}%`;
}

export function fmtAge(seconds: number): string {
  if (seconds < 60) return 'just now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m ago` : `${h}h ago`;
}

function fmtReset(w: QuotaWindow, now: number): string {
  if (!w.resets_at) return '';
  if (now >= w.resets_at) return 'expired';
  const d = new Date(w.resets_at * 1000);
  const mins = Math.round((w.resets_at - now) / 60);
  const when =
    mins < 60
      ? `in ${mins}m`
      : mins < 24 * 60
        ? `in ${Math.round(mins / 60)}h`
        : d.toLocaleDateString([], { weekday: 'short' });
  return `resets ${when}`;
}

// The window that will bite you first = the most-used one. Not `is_active`: a
// per-model weekly cap was observed higher than the active session window, and
// the tighter one is what deserves the chrome.
//
// Rolled-over windows are excluded rather than allowed to win. Observed live: the
// session window was the most-used (26%) AND expired, while both weekly windows
// were perfectly readable — letting the expired one bind would render "—" and hide
// the quota we actually know. Unknown beats a wrong number, but it must not beat a
// right one. If every window has rolled, there's genuinely nothing to say.
export function bindingWindow(ws: QuotaWindow[], now: number): QuotaWindow | undefined {
  return ws
    .filter((w) => displayState(w, now).kind !== 'unknown')
    .reduce<QuotaWindow | undefined>(
      (a, b) => (!a || b.percent_used > a.percent_used ? b : a),
      undefined,
    );
}

export function byProvider(ws: QuotaWindow[]): Map<string, QuotaWindow[]> {
  const m = new Map<string, QuotaWindow[]>();
  for (const w of ws) m.set(w.provider, [...(m.get(w.provider) ?? []), w]);
  return m;
}

// One pill per provider that has data. When nothing has arrived yet, show a
// single fetch button so the user can force a read instead of waiting for the
// backend's first emit (which needs a claude/codex session to have run).
export function quotaPills(): HTMLElement | null {
  const groups = byProvider(windows);
  const now = Math.floor(Date.now() / 1000);

  const wrap = document.createElement('div');
  wrap.className = 'quota-wrap';

  if (!groups.size) {
    wrap.append(makeFetchPill());
    return wrap;
  }
  for (const [provider, ws] of groups) {
    const bind = bindingWindow(ws, now);
    // Every window rolled over with no fresh read -> show the provider as unknown
    // rather than dropping the pill (it exists, we just can't speak for it).
    const st: QuotaState = bind ? displayState(bind, now) : { kind: 'unknown' };

    const pill = document.createElement('button');
    pill.className = 'quota-pill';
    // Dim when we can't vouch for the number, so a stale claude pill never reads
    // as current next to a per-turn-fresh codex one.
    if (st.kind !== 'exact') pill.classList.add('quota-stale');
    if (st.kind === 'exact' && st.remaining <= 10) pill.classList.add('quota-low');
    pill.append(providerIcon(provider));
    const val = document.createElement('span');
    val.className = 'quota-val';
    val.textContent = fmtState(st);
    pill.append(val);
    pill.setAttribute('aria-label', `${provider} quota remaining: ${fmtState(st)}`);
    pill.onclick = (ev) => {
      ev.stopPropagation();
      openQuotaMenu(pill, provider, ws, now);
    };
    wrap.append(pill);
  }
  return wrap.children.length ? wrap : null;
}

function makeFetchPill(): HTMLElement {
  const pill = document.createElement('button');
  pill.className = 'quota-pill quota-stale';
  pill.setAttribute('aria-label', 'Fetch usage now');
  pill.title = 'Fetch usage now';
  pill.append(icon('arrows-clockwise'));
  const val = document.createElement('span');
  val.className = 'quota-val';
  val.textContent = 'usage';
  pill.append(val);
  pill.onclick = (ev) => {
    ev.stopPropagation();
    pill.classList.add('git-busy');
    void invoke<QuotaWindow[]>('quota_now')
      .then(setQuota)
      .catch(() => {})
      .finally(() => pill.classList.remove('git-busy'));
  };
  return pill;
}

function openQuotaMenu(anchor: HTMLElement, provider: string, ws: QuotaWindow[], now: number) {
  const menu = document.createElement('div');
  menu.className = 'popmenu quota-menu';

  const head = document.createElement('div');
  head.className = 'quota-head';
  head.append(providerIcon(provider));
  const htitle = document.createElement('span');
  htitle.className = 'quota-head-title';
  htitle.textContent = `${provider} · usage`;
  head.append(htitle);
  menu.append(head);

  for (const w of ws) {
    const st = displayState(w, now);
    const used = Math.max(0, Math.min(100, Math.round(w.percent_used)));
    const row = document.createElement('div');
    row.className = 'quota-row';
    const line = document.createElement('div');
    line.className = 'quota-row-line';
    const name = document.createElement('span');
    name.className = 'quota-row-name';
    name.textContent = w.label;
    const reset = document.createElement('span');
    reset.className = 'quota-row-reset';
    reset.textContent = fmtReset(w, now);
    const val = document.createElement('span');
    val.className = 'quota-row-val';
    val.textContent = fmtState(st);
    line.append(name, reset, val);
    const bar = document.createElement('div');
    bar.className = 'quota-bar' + (used >= 90 ? ' quota-bar-danger' : used >= 70 ? ' quota-bar-warn' : '');
    if (st.kind === 'unknown') bar.classList.add('quota-bar-unknown');
    const fill = document.createElement('i');
    fill.style.width = st.kind === 'unknown' ? '0%' : `${used}%`;
    bar.append(fill);
    row.append(line, bar);
    menu.append(row);
  }

  // The age line is the only honest way to present claude's cache — and the only
  // place we can tell the user how to refresh it, since tt cannot.
  const fetched = Math.max(...ws.map((w) => w.fetched_at || 0));
  if (fetched) {
    const age = document.createElement('div');
    age.className = 'quota-age';
    age.textContent = `as of ${fmtAge(now - fetched)}`;
    if (provider === 'claude' && now - fetched > STALE_AFTER) {
      age.textContent += ' — run /usage in a Claude session to refresh';
    }
    menu.append(age);
  }

  // Re-read now rather than waiting out the 60s tick. Deliberately labelled
  // "Re-read", not "Refresh": it cannot make claude's cache newer (only Claude
  // Code does that), and a button implying otherwise would be a lie the moment
  // the number didn't move.
  const reread = document.createElement('div');
  reread.className = 'popmenu-item quota-reread';
  reread.append(icon('arrows-clockwise'), document.createTextNode(' Re-read now'));
  reread.onclick = (ev) => {
    ev.stopPropagation();
    reread.classList.add('git-busy'); // reuse the existing spinner rather than add a second one
    void invoke<QuotaWindow[]>('quota_now')
      .then(setQuota)
      .catch(() => {})
      .finally(cleanup);
  };
  menu.append(reread);

  document.body.appendChild(menu);
  placeMenu(menu, anchor.getBoundingClientRect());

  function onDown(ev: MouseEvent) {
    if (!menu.contains(ev.target as Node)) cleanup();
  }
  function cleanup() {
    menu.remove();
    document.removeEventListener('mousedown', onDown);
  }
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

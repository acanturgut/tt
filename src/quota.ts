import { providerIcon } from './providers';
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

export const STALE_AFTER = 15 * 60; // seconds; beyond this we stop claiming precision

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

// One pill per provider that has data. Providers with none (gemini/opencode ship
// no quota data at all) render nothing — no empty pill, no "N/A".
export function quotaPills(): HTMLElement | null {
  const groups = byProvider(windows);
  if (!groups.size) return null;
  const now = Math.floor(Date.now() / 1000);

  const wrap = document.createElement('div');
  wrap.className = 'quota-wrap';
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

function openQuotaMenu(anchor: HTMLElement, provider: string, ws: QuotaWindow[], now: number) {
  const menu = document.createElement('div');
  menu.className = 'popmenu quota-menu';

  const head = document.createElement('div');
  head.className = 'popmenu-head';
  head.textContent = `${provider} · remaining`;
  menu.append(head);

  for (const w of ws) {
    const row = document.createElement('div');
    row.className = 'popmenu-item quota-row';
    const name = document.createElement('span');
    name.textContent = w.label;
    const val = document.createElement('span');
    val.className = 'quota-row-val';
    val.textContent = fmtState(displayState(w, now));
    const reset = document.createElement('span');
    reset.className = 'quota-row-reset';
    reset.textContent = fmtReset(w, now);
    row.append(name, reset, val);
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

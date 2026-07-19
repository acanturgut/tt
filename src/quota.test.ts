import { describe, it, expect } from 'vitest';
import {
  displayState,
  fmtState,
  fmtAge,
  bindingWindow,
  byProvider,
  STALE_AFTER,
  type QuotaWindow,
} from './quota';

const NOW = 1_800_000_000;
const w = (over: Partial<QuotaWindow> = {}): QuotaWindow => ({
  provider: 'claude',
  key: 'session',
  label: 'Session',
  percent_used: 26,
  resets_at: NOW + 3600, // not yet rolled
  fetched_at: NOW - 60, // fresh
  ...over,
});

// The staleness machine is the part that can confidently show a wrong number,
// so it gets the test rather than the parsers.
describe('displayState', () => {
  it('fresh reading is exact', () => {
    expect(displayState(w(), NOW)).toEqual({ kind: 'exact', remaining: 74 });
  });

  it('stale but unrolled is an upper bound, not a fabricated exact', () => {
    // 5.6h old — the real observed case for claude's cache
    const s = displayState(w({ fetched_at: NOW - 20160 }), NOW);
    expect(s).toEqual({ kind: 'atMost', remaining: 74 });
    expect(fmtState(s)).toBe('≤74%');
  });

  it('rolled-over window is unknown, NEVER 0% or a stale number', () => {
    // the observed live bug case: cached 26% for a window that already expired
    const s = displayState(w({ resets_at: NOW - 1, fetched_at: NOW - 20160 }), NOW);
    expect(s).toEqual({ kind: 'unknown' });
    expect(fmtState(s)).toBe('—');
    // must not claim 100% remaining just because usage "restarted"
    expect(fmtState(s)).not.toContain('100');
  });

  it('treats the staleness boundary as inclusive-fresh', () => {
    expect(displayState(w({ fetched_at: NOW - STALE_AFTER }), NOW).kind).toBe('exact');
    expect(displayState(w({ fetched_at: NOW - STALE_AFTER - 1 }), NOW).kind).toBe('atMost');
  });

  // Review catch: a 15min grace let a hard-running fleet burn quota while the pill
  // still claimed an exact figure — overstating remaining, the dangerous direction.
  it('does not claim precision for a reading minutes old', () => {
    expect(displayState(w({ fetched_at: NOW - 899 }), NOW).kind).toBe('atMost');
    expect(displayState(w({ fetched_at: NOW - 300 }), NOW).kind).toBe('atMost');
  });

  it('missing resets_at is unknown rather than an epoch-0 comparison', () => {
    expect(displayState(w({ resets_at: 0 }), NOW)).toEqual({ kind: 'unknown' });
  });

  it('missing fetched_at never claims freshness', () => {
    expect(displayState(w({ fetched_at: 0 }), NOW).kind).toBe('atMost');
  });

  it('clamps over-100 usage to 0 remaining instead of going negative', () => {
    expect(displayState(w({ percent_used: 130 }), NOW)).toEqual({ kind: 'exact', remaining: 0 });
  });
});

describe('bindingWindow', () => {
  it('picks the most-used window, not the active one', () => {
    // real shape: session is_active but a per-model weekly cap is tighter
    const ws = [
      w({ key: 'session', percent_used: 26 }),
      w({ key: 'weekly_all', percent_used: 10 }),
      w({ key: 'weekly_scoped:Fable', label: 'Weekly · Fable', percent_used: 15 }),
    ];
    expect(bindingWindow(ws, NOW)?.key).toBe('session');
    // and when the scoped cap overtakes it, that one binds
    ws[2].percent_used = 90;
    expect(bindingWindow(ws, NOW)?.key).toBe('weekly_scoped:Fable');
  });

  // Caught by running against real files: the most-used window was ALSO the
  // expired one, so it won and the pill rendered "—" while two readable weekly
  // windows sat right there. Unknown must not outrank a number we actually have.
  it('skips rolled-over windows so a known one can still bind', () => {
    const ws = [
      w({ key: 'session', percent_used: 26, resets_at: NOW - 1 }), // expired, most-used
      w({ key: 'weekly_all', percent_used: 10 }),
      w({ key: 'weekly_scoped:Fable', percent_used: 15 }),
    ];
    expect(bindingWindow(ws, NOW)?.key).toBe('weekly_scoped:Fable');
  });

  it('is undefined when every window has rolled over', () => {
    expect(bindingWindow([w({ resets_at: NOW - 1 })], NOW)).toBeUndefined();
  });

  it('is undefined for no windows', () => {
    expect(bindingWindow([], NOW)).toBeUndefined();
  });
});

describe('byProvider', () => {
  it('groups windows and keeps providers separate', () => {
    const g = byProvider([w(), w({ provider: 'codex', key: 'weekly_all' })]);
    expect([...g.keys()]).toEqual(['claude', 'codex']);
    expect(g.get('claude')).toHaveLength(1);
  });
});

describe('fmtAge', () => {
  it('reads naturally across scales', () => {
    expect(fmtAge(30)).toBe('just now');
    expect(fmtAge(5 * 60)).toBe('5m ago');
    expect(fmtAge(20160)).toBe('5h 36m ago'); // the observed claude staleness
    expect(fmtAge(7200)).toBe('2h ago');
  });
});

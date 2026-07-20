import { describe, it, expect } from 'vitest';
import { layoutGraph, agentForWorktree, type Commit } from './gitgraph';
import { parseDiff } from './git';

const c = (hash: string, parents: string[]): Commit => ({
  hash, parents, refs: [], author: 'x', relDate: 'now', subject: hash,
});

describe('layoutGraph', () => {
  it('keeps linear history in lane 0', () => {
    const rows = layoutGraph([c('A', ['B']), c('B', ['C']), c('C', [])]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.cols === 1)).toBe(true);
  });

  it('lays a branch + merge across two lanes', () => {
    const rows = layoutGraph([c('M', ['A', 'B']), c('A', ['P']), c('B', ['P']), c('P', [])]);
    const by = Object.fromEntries(rows.map((r) => [r.commit.hash, r]));
    expect(by['M'].lane).toBe(0);
    expect(by['A'].lane).toBe(0);
    expect(by['B'].lane).toBe(1);
    expect(by['P'].lane).toBe(0);
    expect(rows.every((r) => r.cols === 2)).toBe(true);
    expect(by['M'].edges.some((e) => e.from === 0 && e.to === 1)).toBe(true); // branch out to B
    expect(by['P'].edges.some((e) => e.from === 1 && e.to === 0)).toBe(true); // merge in from B's lane
    // No zigzag: B continues straight down in its own lane; it must NOT jump to lane 0.
    expect(by['B'].edges.some((e) => e.from === 1 && e.to === 0)).toBe(false);
    // The B→P convergence is drawn exactly once, at P's row.
    expect(by['P'].edges.filter((e) => e.from === 1 && e.to === 0).length).toBe(1);
  });
});

describe('parseDiff', () => {
  // The regression: `---`/`+++` are metadata in the HEADER only. Inside a hunk they're
  // an ordinary deleted/added line (a markdown rule, a YAML fence), and treating them
  // as metadata also skipped the line-number increment, desyncing the rest of the hunk.
  it('treats ---/+++ inside a hunk as content, keeping line numbers in sync', () => {
    const lines = parseDiff(
      [
        'diff --git a/r.md b/r.md',
        'index 111..222 100644',
        '--- a/r.md',
        '+++ b/r.md',
        '@@ -1,4 +1,4 @@',
        ' title',
        '---',
        '+++added',
        ' tail',
      ].join('\n'),
    );
    const inHunk = lines.slice(5); // past the header + @@
    expect(inHunk.map((l) => l.cls)).toEqual(['dl', 'dl del', 'dl add', 'dl']);
    expect(inHunk.map((l) => l.text)).toEqual(['title', '--', '++added', 'tail']);
    // ' tail' is old line 3 (1:title, 2:the deleted rule) and new line 3 (1:title, 2:the addition).
    expect(inHunk[3].oldNo).toBe(3);
    expect(inHunk[3].newNo).toBe(3);
  });

  it('counts "\\ No newline at end of file" against neither side', () => {
    const lines = parseDiff(['@@ -1,1 +1,1 @@', '-a', '\\ No newline at end of file', '+b'].join('\n'));
    expect(lines[2].cls).toBe('dl meta');
    expect(lines[2].oldNo).toBeNull();
    expect(lines[2].newNo).toBeNull();
    expect(lines[3].newNo).toBe(1); // the addition still gets new line 1
  });

  // `git show` on a merge emits a COMBINED diff: one marker column per parent, so a
  // changed line is " -old" / "+ new". Reading only column 0 rendered every one of
  // those as unchanged context.
  it('handles combined (merge) diffs with two marker columns', () => {
    const lines = parseDiff(
      [
        'diff --cc src/main.ts',
        'index c22b0f5,d708351..c899689',
        '@@@ -713,10 -683,11 +716,11 @@@',
        '  unchanged',
        ' -renderAgents();',
        ' +scheduleRenderAgents();',
        '+ addedInBoth();',
      ].join('\n'),
    );
    const hunk = lines.slice(3);
    expect(hunk.map((l) => l.cls)).toEqual(['dl', 'dl del', 'dl add', 'dl add']);
    expect(hunk.map((l) => l.text)).toEqual([
      'unchanged',
      'renderAgents();',
      'scheduleRenderAgents();',
      'addedInBoth();',
    ]);
    expect(lines[2].cls).toBe('dl hunk'); // @@@ … @@@ still reads as a hunk header
    expect(hunk[0].newNo).toBe(716); // new-side numbering comes from the +716 range
    // One old numbering per parent, one gutter — so no old number rather than a wrong one.
    expect(hunk.every((l) => l.oldNo === null)).toBe(true);
  });

  it('returns to header mode at the next file in a multi-file diff', () => {
    const lines = parseDiff(
      ['@@ -1,1 +1,1 @@', '+x', 'diff --git a/b b/b', 'index 3..4 100644', '--- a/b'].join('\n'),
    );
    expect(lines.map((l) => l.cls)).toEqual(['dl hunk', 'dl add', 'dl meta', 'dl meta', 'dl meta']);
  });
});

describe('agentForWorktree', () => {
  const agents = [{ id: '1', name: 'foo', dir: '/a/wt/sub', status: 'working' }];
  it('links an agent whose dir is inside the worktree', () => {
    expect(agentForWorktree(agents, '/a/wt')?.name).toBe('foo');
  });
  it('does not link a sibling path', () => {
    expect(agentForWorktree(agents, '/a/wt2')).toBeUndefined();
  });
});

import {
  agentsForWorktree,
  deriveTreeCards,
  detectFinished,
  type Worktree,
  type RunningAgent,
} from './gitgraph';

const wt = (path: string, over: Partial<Worktree> = {}): Worktree => ({
  path, branch: 'main', head: 'abc1234', detached: false, bare: false,
  dirty: 0, ahead: 0, behind: 0, ...over,
});
const ag = (id: string, dir: string, over: Partial<RunningAgent> = {}): RunningAgent => ({
  id, name: 'a' + id, dir, status: 'idle', ...over,
});

describe('agentsForWorktree', () => {
  it('returns all agents nested in the worktree, none outside', () => {
    const agents = [ag('1', '/a/wt'), ag('2', '/a/wt/sub'), ag('3', '/a/other')];
    expect(agentsForWorktree(agents, '/a/wt').map((a) => a.id)).toEqual(['1', '2']);
  });
});

describe('deriveTreeCards', () => {
  it('excludes clean trees with no agent reasons', () => {
    expect(deriveTreeCards([wt('/a')], [], new Set())).toEqual([]);
  });

  it('cards a dirty tree on `changes`', () => {
    const cards = deriveTreeCards([wt('/a', { dirty: 4 })], [], new Set());
    expect(cards.map((c) => c.reasons)).toEqual([['changes']]);
    expect(cards[0].dirty).toBe(4);
  });

  it('cards an unpushed-but-clean tree on `ahead` (the commit→push walk)', () => {
    const cards = deriveTreeCards([wt('/a', { dirty: 0, ahead: 2 })], [], new Set());
    expect(cards.map((c) => c.reasons)).toEqual([['ahead']]);
  });

  it('cards on `review` when an attached agent is in-review or done', () => {
    const agents = [ag('1', '/a/wt', { label: 'in-review' })];
    const cards = deriveTreeCards([wt('/a/wt')], agents, new Set());
    expect(cards[0].reasons).toContain('review');
    expect(cards[0].agents.map((a) => a.id)).toEqual(['1']);
  });

  it('cards on `finished` when an attached agent id is in finishedIds', () => {
    const agents = [ag('1', '/a/wt')];
    const cards = deriveTreeCards([wt('/a/wt')], agents, new Set(['1']));
    expect(cards[0].reasons).toContain('finished');
  });

  it('sorts reasons and cards by priority review > finished > changes > ahead', () => {
    const agents = [ag('1', '/a/wt', { label: 'done' })];
    const dirtyReviewed = wt('/a/wt', { dirty: 3, ahead: 1 });
    const aheadOnly = wt('/b', { ahead: 1 });
    const cards = deriveTreeCards([aheadOnly, dirtyReviewed], agents, new Set(['1']));
    // reviewed tree ranks first; its own reasons are ordered by priority
    expect(cards[0].path).toBe('/a/wt');
    expect(cards[0].reasons).toEqual(['review', 'finished', 'changes', 'ahead']);
    expect(cards[1].path).toBe('/b');
  });

  it('skips bare worktrees', () => {
    expect(deriveTreeCards([wt('/a', { bare: true, dirty: 9 })], [], new Set())).toEqual([]);
  });
});

describe('detectFinished', () => {
  it('flags a working→idle transition and updates the snapshot', () => {
    const prev = new Map([['1', 'working'], ['2', 'idle']]);
    const now = [ag('1', '/a', { status: 'idle' }), ag('2', '/a', { status: 'idle' })];
    const { transitioned, next } = detectFinished(prev, now);
    expect(transitioned).toEqual(['1']);
    expect(next.get('1')).toBe('idle');
  });

  it('does not flag idle→idle, working→working, or a new agent', () => {
    const prev = new Map([['1', 'idle'], ['2', 'working']]);
    const now = [ag('1', '/a', { status: 'idle' }), ag('2', '/a', { status: 'working' }), ag('3', '/a', { status: 'idle' })];
    expect(detectFinished(prev, now).transitioned).toEqual([]);
  });
});

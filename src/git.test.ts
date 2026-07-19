import { describe, it, expect } from 'vitest';
import { layoutGraph, agentForWorktree, type Commit } from './gitgraph';

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

describe('agentForWorktree', () => {
  const agents = [{ id: '1', name: 'foo', dir: '/a/wt/sub', status: 'working' }];
  it('links an agent whose dir is inside the worktree', () => {
    expect(agentForWorktree(agents, '/a/wt')?.name).toBe('foo');
  });
  it('does not link a sibling path', () => {
    expect(agentForWorktree(agents, '/a/wt2')).toBeUndefined();
  });
});

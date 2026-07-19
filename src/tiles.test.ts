import { describe, it, expect } from 'vitest';
import { layoutKey } from './tiles';
import type { Agent } from './agents';

const mk = (id: string): Agent => ({
  id,
  agentId: 'claude',
  name: id,
  dir: '/',
  status: 'working',
});

// Terminals must refit only when geometry moves. If layoutKey ever starts tracking
// status/tokens/labels, the per-output-burst fit() storm comes back.
describe('layoutKey', () => {
  it('is stable across status/token/label changes (no refit)', () => {
    const a = mk('1');
    const k = layoutKey([a], null);
    a.status = 'idle';
    a.tokens = 12345;
    a.label = 'done';
    a.attention = true;
    expect(layoutKey([a], null)).toBe(k);
  });

  it('changes when a tile is added or removed (refit)', () => {
    expect(layoutKey([mk('1')], null)).not.toBe(layoutKey([mk('1'), mk('2')], null));
  });

  it('changes when entering/leaving focus (single-pane) mode (refit)', () => {
    const ags = [mk('1'), mk('2')];
    expect(layoutKey(ags, null)).not.toBe(layoutKey(ags, '1'));
  });
});

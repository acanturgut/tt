import { describe, it, expect } from 'vitest';
import { visibleRange } from './gitgraph';

// rowH=28, overscan=8 mirrors git.ts.
describe('visibleRange', () => {
  it('at the top, starts at 0 (overscan clamps) and covers the viewport', () => {
    const [first, last] = visibleRange(0, 560, 28, 10000, 8);
    expect(first).toBe(0);
    // 560/28 = 20 visible rows, + 8 overscan.
    expect(last).toBe(28);
  });

  it('scrolled deep, windows around the offset', () => {
    const [first, last] = visibleRange(28000, 560, 28, 10000, 8);
    expect(first).toBe(1000 - 8); // floor(28000/28)=1000, -overscan
    expect(last).toBe(Math.ceil((28000 + 560) / 28) + 8);
  });

  it('never exceeds n at the bottom', () => {
    const n = 100;
    const [first, last] = visibleRange(100 * 28, 560, 28, n, 8);
    expect(last).toBe(n);
    expect(first).toBeLessThanOrEqual(n);
    expect(last).toBeGreaterThanOrEqual(first);
  });

  it('handles an empty list', () => {
    expect(visibleRange(0, 560, 28, 0, 8)).toEqual([0, 0]);
  });
});

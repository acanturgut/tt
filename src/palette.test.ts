import { describe, it, expect } from 'vitest';
import { fuzzyScore } from './palette';

describe('fuzzyScore', () => {
  it('empty query matches everything with score 0', () => {
    expect(fuzzyScore('Open task board', '')).toBe(0);
  });
  it('subsequence matches; non-subsequence returns null', () => {
    expect(fuzzyScore('Open task board', 'otb')).not.toBeNull();
    expect(fuzzyScore('Open task board', 'zzz')).toBeNull();
  });
  it('ranks a closer match higher', () => {
    const board = fuzzyScore('Open task board', 'board')!;
    const scattered = fuzzyScore('Open task board', 'otb')!;
    expect(board).toBeGreaterThan(scattered);
  });
  it('is case-insensitive', () => {
    expect(fuzzyScore('Toggle OLED', 'oled')).not.toBeNull();
  });
});

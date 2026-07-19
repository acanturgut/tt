import { expect, test } from 'vitest';
import { spawnModelArgs } from './providers';

test('claude gets --model and --effort', () => {
  expect(spawnModelArgs('claude', 'opus', 'high')).toEqual(['--model', 'opus', '--effort', 'high']);
});

test('unset model/effort → no flags', () => {
  expect(spawnModelArgs('claude', '', '')).toEqual([]);
});

test('gemini uses -m, ignores effort (no effort catalog)', () => {
  expect(spawnModelArgs('gemini', 'gemini-2.5-pro', 'high')).toEqual(['-m', 'gemini-2.5-pro']);
});

test('provider without a catalog → no flags', () => {
  expect(spawnModelArgs('terminal', 'x', 'high')).toEqual([]);
});

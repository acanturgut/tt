import { expect, test } from 'vitest';
import { spawnModelArgs, fallbackModel, usesMcp, MODEL_CATALOG } from './providers';

// The fleet-orientation text is typed into a freshly spawned agent. A `terminal`
// agent is a bare login shell, which EXECUTES it — the apostrophe in "You're" parks
// zsh at a `quote>` prompt and the pane is wedged. Only real agent CLIs get oriented.
test('usesMcp: only real agent CLIs, not the shell or local chat REPLs', () => {
  for (const id of ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity']) {
    expect(usesMcp(id), `${id} should be oriented`).toBe(true);
  }
  expect(usesMcp('terminal')).toBe(false);
  expect(usesMcp('ollama')).toBe(false);
  expect(usesMcp('lmstudio')).toBe(false);
});

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

test('local runtimes take the model positionally (ollama run <model>)', () => {
  expect(spawnModelArgs('ollama', 'llama3.2', 'high')).toEqual(['llama3.2']);
  expect(spawnModelArgs('lmstudio', 'qwen3-8b')).toEqual(['qwen3-8b']);
});

test('fallbackModel only fires for local runtimes, and only once models are known', () => {
  expect(fallbackModel('ollama')).toBe(''); // no Tauri in tests → nothing discovered
  expect(fallbackModel('claude')).toBe(''); // never override a CLI's own default
  MODEL_CATALOG.ollama.models = ['llama3.2', 'qwen3'];
  expect(fallbackModel('ollama')).toBe('llama3.2');
});

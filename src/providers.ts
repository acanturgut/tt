import { invoke } from '@tauri-apps/api/core';
import { icon } from './icon';

export const PROVIDERS = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'ollama', 'lmstudio', 'terminal'];

// Real brand marks (white PNG) for the ones with an official icon; the rest use
// a Phosphor glyph.
const PROVIDER_PNG: Record<string, string> = {
  claude: '/agents/claude.png',
  cursor: '/agents/cursor.png',
  gemini: '/agents/gemini.png',
  opencode: '/agents/opencode.png',
};
const PROVIDER_PHOSPHOR: Record<string, string> = {
  codex: 'code',
  antigravity: 'planet',
  ollama: 'cube',
  lmstudio: 'flask',
  terminal: 'terminal-window',
};

export function providerIcon(id: string): HTMLElement {
  const png = PROVIDER_PNG[id];
  if (png) {
    const img = document.createElement('img');
    img.src = png;
    img.alt = id;
    img.className = 'agent-ico';
    return img;
  }
  return icon(PROVIDER_PHOSPHOR[id] ?? 'terminal-window');
}

// Which providers the user has hidden from the spawn buttons / menus.
const HIDE_KEY = 'tt.hiddenProviders';
const listeners = new Set<() => void>();
export function subscribeProviders(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((l) => l());
}

export function hiddenProviders(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDE_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function isProviderHidden(id: string): boolean {
  return hiddenProviders().includes(id);
}
export function setProviderHidden(id: string, hidden: boolean) {
  const set = new Set(hiddenProviders());
  if (hidden) set.add(id);
  else set.delete(id);
  localStorage.setItem(HIDE_KEY, JSON.stringify([...set]));
  emit();
}
export function visibleProviders(): string[] {
  return PROVIDERS.filter((p) => !isProviderHidden(p));
}

// Which provider CLIs are on the user's PATH. Unknown until the first check
// resolves, so `undefined` means "don't know yet" and only an explicit false is
// reported as missing — a slow shell must never flash "not installed" at someone
// who has everything.
let installed: Record<string, boolean> = {};
export async function refreshCliCheck(): Promise<void> {
  try {
    installed = await invoke<Record<string, boolean>>('check_clis', { agentIds: PROVIDERS });
    emit();
    void refreshLocalModels(); // you may have pulled a model since launch
  } catch {
    // Non-Tauri (tests/browser): leave everything unknown rather than claim missing.
  }
}
export function isCliMissing(id: string): boolean {
  return installed[id] === false;
}

// Which models each provider can run and how its CLI takes them. Effort + a live
// (no-restart) switch are claude-only. ponytail: hardcoded — edit here when a
// provider ships a new model; not fetched from any API.
export interface ProviderModels {
  flag: string; // spawn flag that sets the model, e.g. '--model' or '-m'; '' = positional
  local?: boolean; // models come from the machine (see refreshLocalModels), not this file
  models: string[]; // selectable aliases
  effort?: string[]; // claude only
  live?: (model: string) => string; // runtime model switch typed into the PTY (claude: /model)
  liveEffort?: (effort: string) => string; // runtime effort switch (claude: /effort)
}
export const MODEL_CATALOG: Record<string, ProviderModels> = {
  claude: {
    flag: '--model',
    models: ['opus', 'sonnet', 'haiku', 'fable'],
    effort: ['low', 'medium', 'high', 'xhigh', 'max'],
    live: (m) => `/model ${m}`,
    liveEffort: (e) => `/effort ${e}`,
  },
  codex: { flag: '--model', models: ['gpt-5', 'gpt-5-codex', 'o3'] },
  gemini: { flag: '-m', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  // Local runtimes take the model positionally (`ollama run X`, `lms chat X`) and
  // the list is whatever is pulled on this machine, so it's filled in at runtime.
  ollama: { flag: '', models: [], local: true },
  lmstudio: { flag: '', models: [], local: true },
};

// Ask the machine which local models exist and swap them into the catalog. Best
// effort: no Tauri (tests/browser) or no CLI just leaves the list empty, and an
// empty list means "spawn with no model" — fine for lmstudio (uses the loaded
// model), visibly wrong for ollama, which is better than guessing a model name.
export async function refreshLocalModels(): Promise<void> {
  try {
    const found = await invoke<Record<string, string[]>>('local_models');
    for (const [id, models] of Object.entries(found)) {
      const cat = MODEL_CATALOG[id];
      if (cat?.local) cat.models = models;
    }
    emit();
  } catch {
    // no Tauri — leave the lists empty
  }
}
// Kicked off at import, but awaitable: it shells out through a login shell, which can
// take seconds. Spawning a local runtime before it lands picks no model, so `ollama run`
// dies bare and the UI then blames the user's PATH. Await this before reading the
// catalog for a local provider.
export const localModelsReady: Promise<void> = refreshLocalModels();
export function providerModels(id: string): ProviderModels | undefined {
  return MODEL_CATALOG[id];
}

// A plain local chat REPL — no tools, no MCP, so it can't lead a fleet.
export function isLocalRuntime(id: string): boolean {
  return MODEL_CATALOG[id]?.local === true;
}

// Whether this provider can act on the tt MCP — i.e. it's a real agent CLI.
// `terminal` is a bare login shell and the local runtimes are plain chat REPLs:
// neither has tools to coordinate with, so fleet orientation is meaningless to
// them. For the shell it's worse than useless — typed prose is EXECUTED, and the
// apostrophe in "You're" alone parks zsh at a `quote>` continuation prompt.
export function usesMcp(id: string): boolean {
  return id !== 'terminal' && !isLocalRuntime(id);
}

// A local runtime has no "the CLI picks for you" default: `ollama run` with no
// model just errors. So when nothing is configured, spawn the first model the
// machine actually has. Empty for every other provider — they have their own
// defaults and we must not override them.
export function fallbackModel(id: string): string {
  const c = MODEL_CATALOG[id];
  return c?.local ? (c.models[0] ?? '') : '';
}

// The CLI flags that pin an agent to a model/effort at spawn. Empty when the
// provider has no catalog or nothing is set (→ the CLI uses its own default).
export function spawnModelArgs(agentId: string, model?: string, effort?: string): string[] {
  const c = MODEL_CATALOG[agentId];
  if (!c) return [];
  const out: string[] = [];
  if (model) {
    if (c.flag) out.push(c.flag);
    out.push(model); // positional for the local runtimes (`ollama run <model>`)
  }
  if (effort && c.effort?.includes(effort)) out.push('--effort', effort);
  return out;
}

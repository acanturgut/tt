import { icon } from './icon';

export const PROVIDERS = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'terminal'];

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

// Which models each provider can run and how its CLI takes them. Effort + a live
// (no-restart) switch are claude-only. ponytail: hardcoded — edit here when a
// provider ships a new model; not fetched from any API.
export interface ProviderModels {
  flag: string; // spawn flag that sets the model, e.g. '--model' or '-m'
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
};
export function providerModels(id: string): ProviderModels | undefined {
  return MODEL_CATALOG[id];
}

// The CLI flags that pin an agent to a model/effort at spawn. Empty when the
// provider has no catalog or nothing is set (→ the CLI uses its own default).
export function spawnModelArgs(agentId: string, model?: string, effort?: string): string[] {
  const c = MODEL_CATALOG[agentId];
  if (!c) return [];
  const out: string[] = [];
  if (model) out.push(c.flag, model);
  if (effort && c.effort?.includes(effort)) out.push('--effort', effort);
  return out;
}

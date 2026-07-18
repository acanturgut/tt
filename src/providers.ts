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

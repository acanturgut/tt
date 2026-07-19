import { open } from '@tauri-apps/plugin-dialog';
import { addProject } from './projects';
import { icon } from './icon';

// The tt mark: a 2x2 tile grid glyph — "tiled agents", matches the app icon.
const LOGO = `<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
  <rect x="6" y="6" width="8" height="8" rx="2.5"/>
  <rect x="18" y="6" width="8" height="8" rx="2.5"/>
  <rect x="6" y="18" width="8" height="8" rx="2.5"/>
  <rect x="18" y="18" width="8" height="8" rx="2.5"/>
</svg>`;

interface Feature { icon: string; title: string; body: string; }
const FEATURES: Feature[] = [
  { icon: 'terminal-window', title: 'Spawn agents',
    body: 'Launch claude, codex, cursor, gemini, opencode, antigravity or a plain terminal, each in the folder you pick.' },
  { icon: 'squares-four', title: 'Tile & focus',
    body: 'Agents auto-tile so you see them all at once. Click a tile to zoom, ⌘1-9 to focus one, ⌘0 for the grid.' },
  { icon: 'broadcast', title: 'Broadcast',
    body: 'Message many agents at once. Type #2 to target one, or /all and /none to pick who receives it.' },
  { icon: 'brain', title: 'Agents spawn agents',
    body: "Point any agent at tt's MCP server and it can create and coordinate more agents that appear here." },
  { icon: 'magnifying-glass', title: 'Command palette',
    body: '⌘K jumps to any file, agent, or action. ⌘N spawns an agent, ⌘T a terminal, ⌘L broadcasts.' },
  { icon: 'stack', title: 'Fleet templates',
    body: 'Define a reusable team — each agent with a role and starter prompt — and spawn the whole fleet into any project in one click.' },
];

function el(cls: string, text?: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  return d;
}

export function renderWelcome(root: HTMLElement, onNewOrchestrator: () => void) {
  root.innerHTML = '';
  const card = el('welcome-card');

  const mark = el('welcome-mark');
  mark.innerHTML = LOGO;

  const btn = document.createElement('button');
  btn.className = 'welcome-btn';
  btn.append(icon('folder-plus'), document.createTextNode(' Add a project folder'));
  btn.onclick = async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string') addProject(picked);
    } catch (e) {
      alert(`add project failed: ${e}`);
    }
  };

  const orchBtn = document.createElement('button');
  orchBtn.className = 'welcome-btn welcome-btn-ghost';
  orchBtn.append(icon('brain'), document.createTextNode(' Start an orchestrator'));
  orchBtn.onclick = () => onNewOrchestrator();

  const feats = el('welcome-features');
  for (const f of FEATURES) {
    const item = el('welcome-feat');
    const ic = icon(f.icon);
    ic.classList.add('welcome-feat-ic');
    const txt = el('welcome-feat-text');
    txt.append(el('welcome-feat-title', f.title), el('welcome-feat-body', f.body));
    item.append(ic, txt);
    feats.append(item);
  }

  card.append(
    mark,
    el('welcome-title', 'Welcome to tt'),
    el('welcome-sub', 'Run and coordinate many coding agents side by side.'),
    btn,
    orchBtn,
    feats,
  );
  root.append(card);
}

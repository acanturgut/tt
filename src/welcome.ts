import { open } from '@tauri-apps/plugin-dialog';
import { addProject } from './projects';
import { icon } from './icon';

interface Tip {
  icon: string;
  title: string;
  body: string;
}

const TIPS: Tip[] = [
  {
    icon: 'terminal-window',
    title: 'Spawn agents',
    body: 'Launch claude, codex, cursor, gemini, opencode, antigravity or a plain terminal from the toolbar — each runs in the folder you pick.',
  },
  {
    icon: 'squares-four',
    title: 'Tile & focus',
    body: 'Agents auto-tile so you see them all at once. Click a tile to zoom it; ⌘1–9 to focus one, ⌘0 for the grid.',
  },
  {
    icon: 'broadcast',
    title: 'Broadcast',
    body: 'Message many agents at once from the omnibox. Type #2 to target just agent 2, or /all, /none to pick targets.',
  },
  {
    icon: 'brain',
    title: 'Agents spawn agents',
    body: "Point any agent at tt's MCP server (127.0.0.1:4127/mcp) and it can create and coordinate more agents that appear here.",
  },
  {
    icon: 'keyboard',
    title: 'Shortcuts',
    body: '⌘N new default agent · ⌘T terminal · ⌘K command palette · ⌘B / ⌘\\ toggle panels · ⌘, settings.',
  },
  {
    icon: 'stack',
    title: 'Fleet templates',
    body: 'Save a team of agents as a template and re-spawn the whole fleet in one click.',
  },
];

export function renderWelcome(root: HTMLElement) {
  root.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'welcome-card';

  const mark = document.createElement('div');
  mark.className = 'welcome-mark';
  mark.appendChild(icon('terminal-window'));

  const h = document.createElement('div');
  h.className = 'welcome-title';
  h.textContent = 'Welcome to tt';

  const sub = document.createElement('div');
  sub.className = 'welcome-sub';
  sub.textContent =
    'Run and coordinate many coding agents side by side. Start by adding a project folder.';

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

  const tips = document.createElement('div');
  tips.className = 'welcome-tips';
  for (const t of TIPS) {
    const c = document.createElement('div');
    c.className = 'welcome-tip';
    const ic = icon(t.icon);
    ic.classList.add('welcome-tip-ic');
    const ti = document.createElement('div');
    ti.className = 'welcome-tip-title';
    ti.textContent = t.title;
    const bo = document.createElement('div');
    bo.className = 'welcome-tip-body';
    bo.textContent = t.body;
    const txt = document.createElement('div');
    txt.append(ti, bo);
    c.append(ic, txt);
    tips.appendChild(c);
  }

  card.append(mark, h, sub, btn, tips);
  root.appendChild(card);
}

import { open } from '@tauri-apps/plugin-dialog';
import { listProjects, current, addProject, selectProject } from './projects';
import { icon } from './icon';

export interface TopbarHandlers {
  onSpawn: (agentId: string) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSettings: () => void;
  onTemplates: () => void;
}

function iconBtn(name: string, title: string, onClick: () => void, extra = ''): HTMLElement {
  const b = document.createElement('button');
  b.className = 'icobtn';
  b.title = title;
  b.appendChild(icon(name, extra));
  b.onclick = onClick;
  return b;
}

// Project tabs live on their own row above the nav; each tab is its own panel.
export function renderProjectTabs(root: HTMLElement) {
  root.innerHTML = '';
  const projs = listProjects();
  const cur = current();
  for (const p of projs) {
    const tab = document.createElement('button');
    tab.className = 'proj-tab' + (cur && p.path === cur.path ? ' active' : '');
    tab.textContent = p.name;
    tab.title = p.path;
    tab.onclick = () => selectProject(p.path);
    root.appendChild(tab);
  }
  const add = document.createElement('button');
  add.className = 'addproj-tab';
  add.append(icon('plus'), document.createTextNode(' Add project'));
  add.onclick = async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string') addProject(picked);
    } catch (e) {
      alert(`add project failed: ${e}`);
    }
  };
  root.appendChild(add);
}

export function renderTopbar(root: HTMLElement, h: TopbarHandlers) {
  root.innerHTML = '';

  const treeToggle = iconBtn('folders', 'toggle folder tree (⌘B)', () => h.onToggleRight());
  const agentsToggle = iconBtn('brain', 'toggle agents (⌘\\)', () => h.onToggleLeft());

  const wrap = document.createElement('div');
  wrap.className = 'proj-wrap';

  const cur = current();
  const hasProj = !!cur;
  for (const agent of ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'terminal']) {
    const b = document.createElement('button');
    b.className = 'spawnbtn';
    b.disabled = !hasProj;
    b.append(icon('terminal-window'), document.createTextNode(` ${agent}`));
    b.title = hasProj ? `spawn ${agent} in ${cur!.name}` : 'add a project first';
    b.onclick = () => h.onSpawn(agent);
    wrap.append(b);
  }

  const spacer = document.createElement('div');
  spacer.className = 'topbar-spacer';

  const zoomOut = iconBtn('minus', 'zoom all terminals out', () => h.onZoomOut());
  const zoomIn = iconBtn('plus', 'zoom all terminals in', () => h.onZoomIn());
  const tmplBtn = iconBtn('stack', 'Fleet templates', () => h.onTemplates());
  const settingsBtn = iconBtn('gear-six', 'Settings (⌘,)', () => h.onSettings());
  root.append(treeToggle, wrap, spacer, zoomOut, zoomIn, tmplBtn, settingsBtn, agentsToggle);
}

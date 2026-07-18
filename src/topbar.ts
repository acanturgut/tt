import { open } from '@tauri-apps/plugin-dialog';
import { listProjects, current, addProject, selectProject, setProjectIcon } from './projects';
import { icon } from './icon';
import { placeMenu } from './menu';

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

const PROJECT_ICONS = [
  'folder', 'code', 'terminal-window', 'rocket', 'cube', 'globe',
  'database', 'package', 'git-branch', 'lightning', 'flask', 'palette',
  'book-open', 'robot', 'brain', 'gear-six', 'browser', 'device-mobile',
];

let iconPicker: HTMLElement | null = null;
function closeIconPicker() {
  iconPicker?.remove();
  iconPicker = null;
  document.removeEventListener('mousedown', onPickerDown);
}
function onPickerDown(e: MouseEvent) {
  if (iconPicker && !iconPicker.contains(e.target as Node)) closeIconPicker();
}
function openIconPicker(path: string, anchor: HTMLElement) {
  closeIconPicker();
  iconPicker = document.createElement('div');
  iconPicker.className = 'icon-picker';
  for (const name of PROJECT_ICONS) {
    const b = document.createElement('button');
    b.className = 'icon-picker-item';
    b.title = name;
    b.appendChild(icon(name));
    b.onmousedown = (e) => {
      e.preventDefault();
      setProjectIcon(path, name);
      closeIconPicker();
    };
    iconPicker.appendChild(b);
  }
  document.body.appendChild(iconPicker);
  placeMenu(iconPicker, anchor.getBoundingClientRect());
  setTimeout(() => document.addEventListener('mousedown', onPickerDown), 0);
}

// Project tabs live on their own row above the nav; each tab is its own panel.
export function renderProjectTabs(root: HTMLElement) {
  root.innerHTML = '';
  const projs = listProjects();
  const cur = current();
  for (const p of projs) {
    const tab = document.createElement('button');
    tab.className = 'proj-tab' + (cur && p.path === cur.path ? ' active' : '');
    tab.title = p.path;
    const ic = icon(p.icon ?? 'folder');
    ic.classList.add('proj-tab-ic');
    ic.title = 'change project icon';
    ic.onclick = (e) => {
      e.stopPropagation();
      openIconPicker(p.path, tab);
    };
    const nm = document.createElement('span');
    nm.className = 'proj-tab-name';
    nm.textContent = p.name;
    tab.append(ic, nm);
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

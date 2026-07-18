import { open } from '@tauri-apps/plugin-dialog';
import {
  listProjects,
  current,
  addProject,
  selectProject,
  setProjectIcon,
  setProjectColor,
} from './projects';
import { icon } from './icon';
import { placeMenu } from './menu';
import { visibleProviders, providerIcon } from './providers';

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

// Muted "pastel" presets that read well as a dark toolbar. First is the default.
const TAB_COLORS = [
  '#122a4a', '#1e3a5f', '#2f2a5e', '#3d2a52', '#14423d',
  '#1d4a2e', '#47341a', '#4d2837', '#2a3340', '#3a1620',
];
const DEFAULT_COLOR = '#122a4a';

let stylePicker: HTMLElement | null = null;
function closeStylePicker() {
  stylePicker?.remove();
  stylePicker = null;
  document.removeEventListener('mousedown', onPickerDown);
}
function onPickerDown(e: MouseEvent) {
  if (stylePicker && !stylePicker.contains(e.target as Node)) closeStylePicker();
}
function openStylePicker(path: string, anchor: HTMLElement) {
  closeStylePicker();
  const proj = listProjects().find((x) => x.path === path);
  const selColor = proj?.color ?? DEFAULT_COLOR;

  stylePicker = document.createElement('div');
  stylePicker.className = 'style-picker';

  const colors = document.createElement('div');
  colors.className = 'style-colors';
  for (const c of TAB_COLORS) {
    const sw = document.createElement('button');
    sw.className = 'style-swatch' + (selColor === c ? ' on' : '');
    sw.style.background = c;
    sw.title = c;
    sw.onmousedown = (e) => {
      e.preventDefault();
      setProjectColor(path, c); // live preview; keep the picker open
      colors.querySelectorAll('.style-swatch').forEach((el) => el.classList.remove('on'));
      sw.classList.add('on');
    };
    colors.appendChild(sw);
  }

  const grid = document.createElement('div');
  grid.className = 'icon-grid';
  for (const name of PROJECT_ICONS) {
    const b = document.createElement('button');
    b.className = 'icon-picker-item';
    b.title = name;
    b.appendChild(icon(name));
    b.onmousedown = (e) => {
      e.preventDefault();
      setProjectIcon(path, name);
      closeStylePicker();
    };
    grid.appendChild(b);
  }

  stylePicker.append(colors, grid);
  document.body.appendChild(stylePicker);
  placeMenu(stylePicker, anchor.getBoundingClientRect());
  setTimeout(() => document.addEventListener('mousedown', onPickerDown), 0);
}

// Project tabs live on their own row above the nav; each tab is its own panel.
export function renderProjectTabs(root: HTMLElement) {
  root.innerHTML = '';
  const projs = listProjects();
  const cur = current();
  // Current project's color drives the selected tab + toolbar (via a CSS var).
  document.documentElement.style.setProperty('--tab-accent', cur?.color ?? DEFAULT_COLOR);
  for (const p of projs) {
    const tab = document.createElement('button');
    tab.className = 'proj-tab' + (cur && p.path === cur.path ? ' active' : '');
    tab.title = p.path;
    const ic = icon(p.icon ?? 'folder');
    ic.classList.add('proj-tab-ic');
    ic.title = 'change project icon & color';
    ic.onclick = (e) => {
      e.stopPropagation();
      openStylePicker(p.path, tab);
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
  for (const agent of visibleProviders()) {
    const b = document.createElement('button');
    b.className = 'spawnbtn';
    b.disabled = !hasProj;
    b.append(providerIcon(agent), document.createTextNode(` ${agent}`));
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

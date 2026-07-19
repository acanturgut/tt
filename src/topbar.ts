import { open } from '@tauri-apps/plugin-dialog';
import {
  listProjects,
  current,
  addProject,
  selectProject,
  setProjectIcon,
  setProjectColor,
  removeProject,
} from './projects';
import { icon } from './icon';
import { placeMenu } from './menu';
import { visibleProviders, providerIcon } from './providers';
import { openSettings, getSettings } from './settings';
import { openShortcuts } from './shortcuts';
import { tip } from './tooltip';

export interface TopbarHandlers {
  onSpawn: (agentId: string) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onBoard: () => void;
}

// Inline shortcut chip (always visible, not just in the hover tooltip). `keys`
// like "⌘ B" collapses to a single "⌘B" chip.
function kbdChip(keys: string, cls = 'ico-kbd'): HTMLElement {
  const kb = document.createElement('kbd');
  kb.className = cls;
  kb.textContent = keys.replace(/\s+/g, '');
  return kb;
}

function iconBtn(name: string, label: string, onClick: () => void, keys?: string, extra = ''): HTMLElement {
  const b = document.createElement('button');
  b.className = 'icobtn';
  b.appendChild(icon(name, extra));
  if (keys) b.appendChild(kbdChip(keys));
  b.onclick = onClick;
  tip(b, label, keys);
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

  const remove = document.createElement('button');
  remove.className = 'style-remove';
  remove.append(icon('trash'), document.createTextNode(' Remove project'));
  remove.onmousedown = (e) => {
    e.preventDefault();
    if (confirm(`Remove "${proj?.name ?? path}" from tt? Its running agents keep running.`)) {
      removeProject(path);
      closeStylePicker();
    }
  };

  stylePicker.append(colors, grid, remove);
  document.body.appendChild(stylePicker);
  placeMenu(stylePicker, anchor.getBoundingClientRect());
  setTimeout(() => document.addEventListener('mousedown', onPickerDown), 0);
}

function toolBtn(name: string, label: string, onClick: () => void, keys?: string): HTMLElement {
  const b = document.createElement('button');
  b.className = 'proj-tool';
  b.appendChild(icon(name));
  if (keys) b.appendChild(kbdChip(keys));
  b.onclick = onClick;
  tip(b, label, keys);
  return b;
}

// Project tabs live on their own row above the nav; each tab is its own panel.
export function renderProjectTabs(
  root: HTMLElement,
  h: { onZoomIn: () => void; onZoomOut: () => void; onTemplates: () => void },
) {
  root.innerHTML = '';
  const projs = listProjects();
  const cur = current();
  // Current project's color drives the selected tab + toolbar (via a CSS var).
  document.documentElement.style.setProperty('--tab-accent', cur?.color ?? DEFAULT_COLOR);
  projs.forEach((p, i) => {
    const tab = document.createElement('button');
    tab.className = 'proj-tab' + (cur && p.path === cur.path ? ' active' : '');
    tab.title = p.path;
    const ic = icon(p.icon ?? 'folder');
    ic.classList.add('proj-tab-ic');
    tip(ic, 'Project icon & color');
    ic.onclick = (e) => {
      e.stopPropagation();
      openStylePicker(p.path, tab);
    };
    const nm = document.createElement('span');
    nm.className = 'proj-tab-name';
    nm.textContent = p.name;
    tab.append(ic, nm);
    if (i < 9) tab.append(kbdChip(`⌘${i + 1}`, 'proj-tab-kbd')); // ⌘1–9 switch projects
    tab.onclick = () => selectProject(p.path);
    root.appendChild(tab);
  });
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

  const tools = document.createElement('div');
  tools.className = 'proj-tools';
  tools.append(
    toolBtn('keyboard', 'Keyboard shortcuts', () => openShortcuts()),
    toolBtn('minus', 'Zoom out', h.onZoomOut, '⌘ -'),
    toolBtn('plus', 'Zoom in', h.onZoomIn, '⌘ +'),
    toolBtn('gear-six', 'Settings', () => openSettings(), '⌘ ,'),
    toolBtn('stack', 'Fleet templates', () => h.onTemplates(), '⌘ F'),
  );
  root.appendChild(tools);
}

export function renderTopbar(left: HTMLElement, right: HTMLElement, h: TopbarHandlers) {
  left.innerHTML = '';
  right.innerHTML = '';

  const treeToggle = iconBtn('folders', 'Toggle file tree', () => h.onToggleRight(), '⌘ B');
  const agentsToggle = iconBtn('brain', 'Toggle agents', () => h.onToggleLeft(), '⌘ \\');

  const wrap = document.createElement('div');
  wrap.className = 'proj-wrap';

  const cur = current();
  const hasProj = !!cur;
  const def = getSettings().defaultAgent;
  for (const agent of visibleProviders()) {
    const b = document.createElement('button');
    b.className = 'spawnbtn';
    b.disabled = !hasProj;
    b.append(providerIcon(agent)); // icon; shortcut chip added inline when one exists
    const keys = agent === 'terminal' ? '⌘ T' : agent === def ? '⌘ N' : undefined;
    if (keys) b.appendChild(kbdChip(keys));
    tip(b, hasProj ? `New ${agent}` : `New ${agent} (add a project first)`, keys);
    b.onclick = () => h.onSpawn(agent);
    wrap.append(b);
  }

  const boardBtn = iconBtn('kanban', 'Task board', () => h.onBoard(), '⌘ J');

  left.append(treeToggle, wrap);
  right.append(boardBtn, agentsToggle);
}

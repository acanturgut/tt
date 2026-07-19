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
import { closeGit, isGitOpen } from './git';
import { quotaPills } from './quota';
import { openComposer } from './broadcast';
import { listOrchestrators, activeSession, selectSession } from './orchestrators';
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
  onGit: () => void;
  onTemplates: () => void;
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
  h: {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onNewOrchestrator: () => void;
    onCloseOrchestrator: (id: string) => void;
    onTemplates: () => void;
    onBoard: () => void;
    onGit: () => void;
  },
) {
  root.innerHTML = '';
  const projs = listProjects();
  const cur = current();
  // Current project's color drives the selected tab + toolbar (via a CSS var).
  document.documentElement.style.setProperty('--tab-accent', cur?.color ?? DEFAULT_COLOR);
  const active = activeSession();
  // "Add project" sits at the far left of the rail, before the project tabs.
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
  projs.forEach((p, i) => {
    const tab = document.createElement('button');
    tab.className = 'proj-tab' + (cur && p.path === cur.path ? ' active' : '');
    tab.title = p.path;
    const ic = icon(p.icon ?? 'folder');
    ic.classList.add('proj-tab-ic');
    const nm = document.createElement('span');
    nm.className = 'proj-tab-name';
    nm.textContent = p.name;
    tab.append(ic, nm);
    if (i < 9) tab.append(kbdChip(`⌘${i + 1}`, 'proj-tab-kbd')); // ⌘1–9 switch projects

    // Hover-only action buttons: gear (style/color/icon) + pencil (rename).
    const actions = document.createElement('span');
    actions.className = 'proj-tab-actions';
    const gear = document.createElement('span');
    gear.className = 'proj-tab-act';
    gear.append(icon('gear'));
    tip(gear, 'Project icon & color');
    gear.onclick = (e) => { e.stopPropagation(); openStylePicker(p.path, tab); };
    const del = document.createElement('span');
    del.className = 'proj-tab-act';
    del.append(icon('x'));
    tip(del, 'Remove project');
    del.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Remove "${p.name}" from tt? Its running agents keep running.`)) removeProject(p.path);
    };
    actions.append(gear, del);
    tab.append(actions);

    tab.onclick = () => { if (isGitOpen()) closeGit(); selectSession(null); selectProject(p.path); };
    root.appendChild(tab);

    // Orchestrators belong to a project and live inline, right after it — but only
    // the selected project shows its fleet (chips) + the new-orchestrator button.
    if (!cur || p.path !== cur.path) return;
    const orchs = listOrchestrators().filter((o) => o.project === p.path);
    const newOrch = document.createElement('button');
    newOrch.className = 'addproj-tab orch-new';
    // Collapse to a bare "+" once this project has orchestrators — the chips make
    // the affordance obvious; the "Orchestrator" label is only a first-time hint.
    if (orchs.length) {
      newOrch.className = 'addproj-tab orch-new icon-only';
      newOrch.append(icon('plus'));
      tip(newOrch, 'New orchestrator');
    } else {
      newOrch.append(icon('plus'), document.createTextNode(' Orchestrator'));
    }
    newOrch.onclick = () => h.onNewOrchestrator();
    root.appendChild(newOrch);

    for (const o of orchs) {
      const chip = document.createElement('button');
      chip.className = 'orch-chip' + (o.id === active ? ' active' : '');
      chip.title = o.goal;
      const dot = document.createElement('span');
      dot.className = 'orch-chip-dot';
      const onm = document.createElement('span');
      onm.className = 'orch-chip-name';
      onm.textContent = o.name;
      const x = document.createElement('span');
      x.className = 'orch-chip-x';
      x.append(icon('x'));
      x.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Close orchestrator "${o.name}" and kill its agents?`)) h.onCloseOrchestrator(o.id);
      };
      chip.append(dot, onm, x);
      chip.onclick = () => selectSession(o.id);
      root.appendChild(chip);
    }
  });

  const tools = document.createElement('div');
  tools.className = 'proj-tools';
  // In focus mode the topbar is hidden, so the toolbar buttons that live there
  // (templates/board/git + broadcast) piggyback here to stay reachable.
  if (document.body.classList.contains('focus-mode')) {
    tools.append(
      toolBtn('broadcast', 'Broadcast', () => openComposer(), '⌘ L'),
      toolBtn('stack', 'Fleet templates', h.onTemplates, '⌘ F'),
      toolBtn('kanban', 'Task board', h.onBoard, '⌘ J'),
      toolBtn('git-branch', 'Git', h.onGit, '⌘ G'),
    );
  }
  tools.append(
    toolBtn('keyboard', 'Keyboard shortcuts', () => openShortcuts()),
    toolBtn('minus', 'Zoom out', h.onZoomOut, '⌘ -'),
    toolBtn('plus', 'Zoom in', h.onZoomIn, '⌘ +'),
    toolBtn('gear-six', 'Settings', () => openSettings(), '⌘ ,'),
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
  const gitBtn = iconBtn('git-branch', 'Git', () => h.onGit(), '⌘ G');
  const templatesBtn = iconBtn('stack', 'Fleet templates', () => h.onTemplates(), '⌘ F');

  const sep = document.createElement('span');
  sep.className = 'tb-sep';
  const sep2 = document.createElement('span');
  sep2.className = 'tb-sep';

  left.append(treeToggle, sep, wrap);
  // Account quota sits with the tools, not on tiles: it's a per-provider fact, and
  // repeating it on every tile would read as a per-agent number.
  const quota = quotaPills();
  if (quota) right.append(quota);
  right.append(templatesBtn, boardBtn, gitBtn, sep2, agentsToggle);
}

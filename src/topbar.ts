import { open } from '@tauri-apps/plugin-dialog';
import { listProjects, current, addProject, selectProject, type Project } from './projects';
import { icon } from './icon';

export interface TopbarHandlers {
  onSpawn: (agentId: string) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

// shadcn-style Select: a trigger button + a popover list (accent hover, check on
// the selected item). Native <select> can't be styled this way, so it's custom.
function projectSelect(): HTMLElement {
  const projs = listProjects();
  const cur = current();

  const trigger = document.createElement('button');
  trigger.className = 'sc-trigger';
  trigger.disabled = projs.length === 0;
  const value = document.createElement('span');
  value.className = 'sc-value' + (cur ? '' : ' sc-placeholder');
  value.textContent = cur ? cur.name : 'No projects';
  trigger.append(value, icon('caret-down', 'sc-caret'));
  trigger.onclick = (ev) => {
    ev.stopPropagation();
    openContent(trigger, projs, cur?.path ?? null);
  };
  return trigger;
}

function openContent(trigger: HTMLElement, projs: Project[], curPath: string | null) {
  const content = document.createElement('div');
  content.className = 'sc-content';
  for (const p of projs) {
    const item = document.createElement('div');
    item.className = 'sc-item' + (p.path === curPath ? ' sc-selected' : '');
    const label = document.createElement('span');
    label.className = 'sc-item-label';
    label.textContent = p.name;
    label.title = p.path;
    item.append(icon('check', 'sc-check'), label);
    item.onclick = (ev) => {
      ev.stopPropagation();
      selectProject(p.path); // store emit -> topbar re-renders
      cleanup();
    };
    content.appendChild(item);
  }
  document.body.appendChild(content);
  const r = trigger.getBoundingClientRect();
  content.style.left = `${Math.round(r.left)}px`;
  content.style.top = `${Math.round(r.bottom + 6)}px`;
  content.style.minWidth = `${Math.round(r.width)}px`;

  function onDown(ev: MouseEvent) {
    if (!content.contains(ev.target as Node) && ev.target !== trigger) cleanup();
  }
  function cleanup() {
    content.remove();
    document.removeEventListener('mousedown', onDown);
  }
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

export function renderTopbar(root: HTMLElement, h: TopbarHandlers) {
  root.innerHTML = '';

  const left = document.createElement('button');
  left.className = 'icobtn';
  left.title = 'toggle agents panel';
  left.appendChild(icon('sidebar-simple'));
  left.onclick = () => h.onToggleLeft();

  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = 'tt';

  const wrap = document.createElement('div');
  wrap.className = 'proj-wrap';
  const lbl = document.createElement('span');
  lbl.className = 'proj-label';
  lbl.textContent = 'Projects';

  const add = document.createElement('button');
  add.className = 'addproj';
  add.append(icon('folder-plus'), document.createTextNode(' Add project'));
  add.onclick = async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string') addProject(picked);
    } catch (e) {
      alert(`add project failed: ${e}`);
    }
  };
  wrap.append(lbl, projectSelect(), add);

  // Quick-spawn in the selected project's root.
  const cur = current();
  const hasProj = !!cur;
  for (const agent of ['claude', 'codex', 'cursor', 'terminal']) {
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

  const right = document.createElement('button');
  right.className = 'icobtn';
  right.title = 'toggle tree panel';
  right.appendChild(icon('sidebar-simple', 'flip'));
  right.onclick = () => h.onToggleRight();

  root.append(left, brand, wrap, spacer, right);
}

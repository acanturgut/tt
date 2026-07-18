import { invoke } from '@tauri-apps/api/core';
import { icon } from './icon';

interface DirEntry {
  name: string;
  path: string;
}

export interface TreeHandlers {
  onOpenAgent: (folderPath: string, agentId: string) => void;
}

const expanded = new Set<string>();
let treeGen = 0;

export async function renderTree(container: HTMLElement, rootPath: string | null, h: TreeHandlers) {
  const gen = ++treeGen;
  if (!rootPath) {
    container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = 'No project yet — use “+ Add project” above.';
    container.appendChild(empty);
    return;
  }
  const rootName = rootPath.split('/').filter(Boolean).pop() ?? rootPath;
  expanded.add(rootPath); // root is always open
  const node = await buildNode(rootPath, rootName, 0, h);
  if (gen !== treeGen) return; // superseded by a newer render — don't append (avoids duplicate trees)
  container.innerHTML = '';
  container.appendChild(node);
}

async function buildNode(
  path: string,
  name: string,
  depth: number,
  h: TreeHandlers,
): Promise<HTMLElement> {
  const wrap = document.createElement('div');

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${depth * 12 + 6}px`;

  const chev = document.createElement('i');
  const fico = document.createElement('i');
  const label = document.createElement('span');
  label.className = 'tree-name';
  label.textContent = name;
  const openBtn = document.createElement('span');
  openBtn.className = 'tree-act';
  openBtn.title = 'open agent here';
  openBtn.appendChild(icon('terminal-window'));
  const newBtn = document.createElement('span');
  newBtn.className = 'tree-act';
  newBtn.title = 'new folder';
  newBtn.appendChild(icon('folder-plus'));
  row.append(chev, fico, label, openBtn, newBtn);

  const children = document.createElement('div');
  children.className = 'tree-children';

  let loaded = false;
  const loadChildren = async () => {
    if (loaded) return;
    loaded = true;
    let entries: DirEntry[] = [];
    try {
      entries = await invoke<DirEntry[]>('list_dir', { path });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      children.appendChild(await buildNode(e.path, e.name, depth + 1, h));
    }
  };

  const setOpen = (isOpen: boolean) => {
    chev.className = `chev ph ph-caret-${isOpen ? 'down' : 'right'}`;
    fico.className = `fico ph ph-folder${isOpen ? '-open' : ''}`;
    children.style.display = isOpen ? '' : 'none';
  };

  const toggle = async () => {
    if (expanded.has(path)) {
      expanded.delete(path);
      setOpen(false);
    } else {
      expanded.add(path);
      await loadChildren();
      setOpen(true);
    }
  };
  chev.onclick = (ev) => {
    ev.stopPropagation();
    void toggle();
  };
  label.onclick = (ev) => {
    ev.stopPropagation();
    void toggle();
  };
  openBtn.onclick = (ev) => {
    ev.stopPropagation();
    openAgentMenu(path, h, openBtn);
  };

  const showNewInput = () => {
    const inp = document.createElement('input');
    inp.className = 'tree-newinput';
    inp.placeholder = 'new folder name';
    inp.onblur = () => inp.remove(); // click away = cancel
    inp.onkeydown = async (e) => {
      if (e.key === 'Enter') {
        const nm = inp.value.trim();
        inp.remove();
        if (!nm) return;
        if (nm.includes('/') || nm === '.' || nm === '..') {
          alert('folder name cannot contain "/" or be "." / ".."');
          return;
        }
        try {
          await invoke('make_dir', { path: `${path}/${nm}` });
        } catch (err) {
          alert(`${err}`);
          return;
        }
        loaded = false;
        children.innerHTML = '';
        await loadChildren();
      } else if (e.key === 'Escape') {
        inp.remove();
      }
    };
    children.prepend(inp);
    inp.focus();
  };

  newBtn.onclick = async (ev) => {
    ev.stopPropagation();
    if (!expanded.has(path)) {
      expanded.add(path);
      await loadChildren();
      setOpen(true);
    }
    showNewInput();
  };

  wrap.append(row, children);

  if (expanded.has(path)) {
    await loadChildren();
    setOpen(true);
  } else {
    setOpen(false);
  }
  return wrap;
}

function openAgentMenu(path: string, h: TreeHandlers, anchor: HTMLElement) {
  const menu = document.createElement('div');
  menu.className = 'popmenu';
  for (const a of ['claude', 'codex', 'cursor', 'terminal']) {
    const item = document.createElement('div');
    item.className = 'popmenu-item';
    item.textContent = `${a} here`;
    item.onclick = (ev) => {
      ev.stopPropagation();
      h.onOpenAgent(path, a);
      cleanup();
    };
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 4)}px`;
  function onDown(ev: MouseEvent) {
    if (!menu.contains(ev.target as Node)) cleanup();
  }
  function cleanup() {
    menu.remove();
    document.removeEventListener('mousedown', onDown);
  }
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

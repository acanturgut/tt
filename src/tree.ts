import { invoke } from '@tauri-apps/api/core';

interface DirEntry {
  name: string;
  path: string;
}

export interface TreeHandlers {
  onOpenAgent: (folderPath: string, agentId: string) => void;
}

// Expanded folder paths persist across re-renders (and project switches).
const expanded = new Set<string>();

export async function renderTree(container: HTMLElement, rootPath: string | null, h: TreeHandlers) {
  container.innerHTML = '';
  if (!rootPath) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = 'No project yet — use “+ Add project” above.';
    container.appendChild(empty);
    return;
  }
  const rootName = rootPath.split('/').filter(Boolean).pop() ?? rootPath;
  expanded.add(rootPath); // root is always open
  container.appendChild(await buildNode(rootPath, rootName, 0, h));
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

  const chev = document.createElement('span');
  chev.className = 'chev';
  const label = document.createElement('span');
  label.className = 'tree-name';
  label.textContent = name;
  const openBtn = document.createElement('span');
  openBtn.className = 'tree-act';
  openBtn.textContent = '⌗';
  openBtn.title = 'open agent here';
  const newBtn = document.createElement('span');
  newBtn.className = 'tree-act';
  newBtn.textContent = '＋';
  newBtn.title = 'new folder';
  row.append(chev, label, openBtn, newBtn);

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
    chev.textContent = isOpen ? '▾' : '▸';
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
    inp.onkeydown = async (e) => {
      if (e.key === 'Enter') {
        const nm = inp.value.trim();
        inp.remove();
        if (!nm) return;
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
  for (const a of ['claude', 'codex']) {
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

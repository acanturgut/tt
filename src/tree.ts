import { invoke } from '@tauri-apps/api/core';
import { icon } from './icon';
import { placeMenu } from './menu';

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

  const search = document.createElement('input');
  search.className = 'tree-search';
  search.placeholder = 'Search folders (deep)…';

  const scroll = document.createElement('div');
  scroll.className = 'tree-scroll';
  scroll.appendChild(node);

  const results = document.createElement('div');
  results.className = 'tree-results';
  results.style.display = 'none';

  let timer: ReturnType<typeof setTimeout> | undefined;
  const runSearch = async (q: string) => {
    if (!q) {
      results.style.display = 'none';
      results.innerHTML = '';
      scroll.style.display = '';
      return;
    }
    scroll.style.display = 'none';
    results.style.display = '';
    results.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'tree-searching';
    info.textContent = 'Searching…';
    results.appendChild(info);
    let entries: DirEntry[] = [];
    try {
      entries = await invoke<DirEntry[]>('search_dirs', { root: rootPath, query: q, limit: 300 });
    } catch {
      entries = [];
    }
    renderResults(results, rootPath!, entries, q, h);
  };
  search.oninput = () => {
    const q = search.value.trim();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runSearch(q), 180);
  };

  container.append(search, scroll, results);
}

// Deep-search results: a flat list of matching folders anywhere under the root.
function renderResults(root: HTMLElement, rootPath: string, entries: DirEntry[], q: string, h: TreeHandlers) {
  root.innerHTML = '';
  if (!entries.length) {
    const none = document.createElement('div');
    none.className = 'tree-searching';
    none.textContent = `No folders match “${q}”`;
    root.appendChild(none);
    return;
  }
  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'tree-row tree-result';
    const fico = document.createElement('i');
    fico.className = 'fico ph ph-folder';
    const label = document.createElement('span');
    label.className = 'tree-name tree-result-name';
    label.textContent = e.name;
    const rel = document.createElement('span');
    rel.className = 'tree-rel';
    rel.textContent = relParent(rootPath, e.path);
    const openBtn = document.createElement('span');
    openBtn.className = 'tree-act';
    openBtn.title = 'open agent here';
    openBtn.appendChild(icon('terminal-window'));
    openBtn.onclick = (ev) => {
      ev.stopPropagation();
      openAgentMenu(e.path, h, openBtn);
    };
    row.append(fico, label, rel, openBtn);
    row.onclick = () => openAgentMenu(e.path, h, openBtn);
    root.appendChild(row);
  }
}

// Path of the folder's parent, relative to the project root (shown for context).
function relParent(rootPath: string, path: string): string {
  const base = rootPath.replace(/\/$/, '');
  const parent = path.split('/').slice(0, -1).join('/');
  if (parent === base) return '';
  return parent.startsWith(base + '/') ? parent.slice(base.length + 1) : parent;
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
  for (const a of ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'terminal']) {
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
  placeMenu(menu, anchor.getBoundingClientRect());
  function onDown(ev: MouseEvent) {
    if (!menu.contains(ev.target as Node)) cleanup();
  }
  function cleanup() {
    menu.remove();
    document.removeEventListener('mousedown', onDown);
  }
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

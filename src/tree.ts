import { invoke } from '@tauri-apps/api/core';
import { icon } from './icon';
import { fileIconUrl, folderIconUrl, iconImg } from './fileicons';
import { placeMenu } from './menu';
import { visibleProviders, providerIcon } from './providers';

interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
}

export interface TreeHandlers {
  onOpenAgent: (folderPath: string, agentId: string) => void;
  onOpenFile: (path: string) => void;
}

const expanded = new Set<string>();
let treeGen = 0;

export async function renderTree(container: HTMLElement, rootPath: string | null, h: TreeHandlers) {
  const gen = ++treeGen;
  if (!rootPath) {
    container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = 'No project yet. Use “+ Add project” above.';
    container.appendChild(empty);
    return;
  }
  // Skip a background refresh while the user is deep-searching — the results view
  // is up and blowing it away mid-typing would be a mess.
  const prevSearch = container.querySelector<HTMLInputElement>('.tree-search');
  if (prevSearch && prevSearch.value.trim()) return;
  // Same reason, for anything focused inside the tree: the rebuild below replaces the
  // element under the caret, so an empty search box or a half-typed new-folder name
  // would silently lose focus and its content mid-keystroke.
  if (container.contains(document.activeElement)) return;
  // Preserve scroll position across the wipe/rebuild — otherwise polling
  // snaps every user back to the top every few seconds.
  const prevScroll = container.querySelector<HTMLElement>('.tree-scroll')?.scrollTop ?? 0;
  const rootName = rootPath.split('/').filter(Boolean).pop() ?? rootPath;
  expanded.add(rootPath); // root is always open
  const node = await buildNode(rootPath, rootName, 0, h);
  if (gen !== treeGen) return; // superseded by a newer render — don't append (avoids duplicate trees)
  container.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'tree-title';
  title.textContent = 'Files';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'tree-search-wrap';
  const searchIcon = icon('magnifying-glass');
  searchIcon.classList.add('tree-search-ic');
  const search = document.createElement('input');
  search.className = 'tree-search';
  search.placeholder = 'Search folders (deep)…';
  searchWrap.append(searchIcon, search);

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

  container.append(title, searchWrap, scroll, results);
  scroll.scrollTop = prevScroll;
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
    const fico = iconImg(folderIconUrl(e.name, false));
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
  row.dataset.path = path;
  row.style.paddingLeft = `${depth * 12 + 6}px`;

  const chev = document.createElement('i');
  const fico = iconImg(folderIconUrl(name, false));
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
      if (e.dir) {
        children.appendChild(await buildNode(e.path, e.name, depth + 1, h));
      } else {
        children.appendChild(fileRow(e.path, e.name, depth + 1, h));
      }
    }
  };

  const setOpen = (isOpen: boolean) => {
    chev.className = `chev ph ph-caret-${isOpen ? 'down' : 'right'}`;
    fico.src = folderIconUrl(name, isOpen);
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

// A file leaf: file icon + name, click opens the read-only viewer. No chevron,
// no folder actions.
// Expand every ancestor of `target` and scroll it into view (⌘K "go to file/folder").
export async function revealInTree(
  container: HTMLElement,
  rootPath: string,
  h: TreeHandlers,
  target: string,
): Promise<void> {
  const base = rootPath.replace(/\/$/, '');
  if (target !== base && !target.startsWith(base + '/')) return;
  const rest = target.slice(base.length + 1).split('/').filter(Boolean);
  let cur = base;
  for (let i = 0; i < rest.length - 1; i++) {
    cur += '/' + rest[i];
    expanded.add(cur);
  }
  expanded.add(target); // if it's a folder, open it too (harmless for a file)
  await renderTree(container, rootPath, h);
  const el = container.querySelector(`[data-path="${CSS.escape(target)}"]`) as HTMLElement | null;
  if (el) {
    el.scrollIntoView({ block: 'center' });
    el.classList.add('tree-flash');
    setTimeout(() => el.classList.remove('tree-flash'), 1200);
  }
}

function fileRow(path: string, name: string, depth: number, h: TreeHandlers): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tree-row tree-file';
  row.dataset.path = path;
  row.style.paddingLeft = `${depth * 12 + 6}px`;
  const fico = iconImg(fileIconUrl(name));
  const label = document.createElement('span');
  label.className = 'tree-name';
  label.textContent = name;
  row.append(fico, label);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.onclick = (ev) => {
    ev.stopPropagation();
    h.onOpenFile(path);
  };
  row.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      h.onOpenFile(path);
    }
  };
  return row;
}

function openAgentMenu(path: string, h: TreeHandlers, anchor: HTMLElement) {
  const menu = document.createElement('div');
  menu.className = 'popmenu';
  for (const a of visibleProviders()) {
    const item = document.createElement('div');
    item.className = 'popmenu-item';
    item.append(providerIcon(a), document.createTextNode(` ${a} here`));
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

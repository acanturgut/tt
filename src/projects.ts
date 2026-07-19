export interface Project {
  name: string;
  path: string;
  icon?: string; // Phosphor icon name shown on the tab
  color?: string; // accent color for the selected tab + toolbar
}

const KEY = 'tt.projects';
const SEL = 'tt.currentProject';
const listeners = new Set<() => void>();

let projects: Project[] = load();
let currentPath: string | null = localStorage.getItem(SEL);

function load(): Project[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(projects));
  if (currentPath) localStorage.setItem(SEL, currentPath);
}

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeProjects(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listProjects(): Project[] {
  return projects;
}

// Which open project a directory lives under. Longest match wins, so a project nested
// inside another claims its own agents. null when the dir is under no open project.
// Used to file a spawned agent by its OWN dir: an MCP spawn carries an arbitrary dir, so
// attributing it to the visible tab would drop a child into the wrong project's grid.
export function projectForDir(dir: string): string | null {
  // Compare on a normalized root but return the STORED path: that string is the key
  // Agent.project is matched against, so handing back a trimmed variant would file the
  // agent under a project no lookup can find.
  const norm = (p: string) => p.replace(/\/+$/, '') || '/';
  let best: Project | null = null;
  for (const p of projects) {
    const root = norm(p.path);
    const inside = dir === root || dir.startsWith(root === '/' ? '/' : root + '/');
    if (inside && (!best || root.length > norm(best.path).length)) best = p;
  }
  return best?.path ?? null;
}

export function current(): Project | null {
  return projects.find((p) => p.path === currentPath) ?? projects[0] ?? null;
}

export function addProject(path: string) {
  const name = path.split('/').filter(Boolean).pop() ?? path;
  if (!projects.some((p) => p.path === path)) projects.push({ name, path });
  currentPath = path;
  save();
  emit();
}

export function selectProject(path: string) {
  currentPath = path;
  save();
  emit();
}

export function setProjectIcon(path: string, icon: string) {
  const p = projects.find((x) => x.path === path);
  if (!p) return;
  p.icon = icon;
  save();
  emit();
}

export function setProjectColor(path: string, color: string) {
  const p = projects.find((x) => x.path === path);
  if (!p) return;
  p.color = color;
  save();
  emit();
}

export function removeProject(path: string) {
  projects = projects.filter((p) => p.path !== path);
  if (currentPath === path) currentPath = projects[0]?.path ?? null;
  save();
  emit();
}

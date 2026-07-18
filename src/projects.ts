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

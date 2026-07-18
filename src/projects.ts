export interface Project {
  name: string;
  path: string;
}

const KEY = 'tt.projects';
const SEL = 'tt.currentProject';
const listeners = new Set<() => void>();

let projects: Project[] = load();
let currentPath: string | null = localStorage.getItem(SEL);

function load(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
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

import type { WorkflowLabel } from './agents';
import { icon } from './icon';

export interface TemplateAgent {
  agentId: string;
  dir: string;
  label?: WorkflowLabel;
}
export interface Template {
  name: string;
  agents: TemplateAgent[];
}

const KEY = 'tt.templates';

function load(): Template[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function store(t: Template[]) {
  localStorage.setItem(KEY, JSON.stringify(t));
}

export function listTemplates(): Template[] {
  return load();
}
export function saveTemplate(name: string, agents: TemplateAgent[]) {
  const all = load().filter((t) => t.name !== name);
  all.push({ name, agents });
  store(all);
}
export function removeTemplate(name: string) {
  store(load().filter((t) => t.name !== name));
}

function summarize(agents: TemplateAgent[]): string {
  const counts: Record<string, number> = {};
  for (const a of agents) counts[a.agentId] = (counts[a.agentId] ?? 0) + 1;
  return Object.entries(counts)
    .map(([k, n]) => `${n} ${k}`)
    .join(' · ');
}

export interface TemplateHandlers {
  onRun: (t: Template) => void;
  currentAgents: () => TemplateAgent[];
}

let overlay: HTMLElement | null = null;
export function closeTemplates() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', escClose);
}
function escClose(e: KeyboardEvent) {
  if (e.key === 'Escape') closeTemplates();
}

export function openTemplates(h: TemplateHandlers) {
  closeTemplates();
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  const box = document.createElement('div');
  box.className = 'tmpl';

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Fleet templates';
  box.appendChild(title);

  const listEl = document.createElement('div');
  listEl.className = 'tmpl-list';
  const renderList = () => {
    listEl.innerHTML = '';
    const ts = listTemplates();
    if (!ts.length) {
      const e = document.createElement('div');
      e.className = 'tmpl-empty';
      e.textContent = 'No templates yet - save your current agents below.';
      listEl.appendChild(e);
    }
    for (const t of ts) {
      const row = document.createElement('div');
      row.className = 'tmpl-row';
      const info = document.createElement('div');
      info.className = 'tmpl-info';
      const nm = document.createElement('div');
      nm.className = 'tmpl-name';
      nm.textContent = t.name;
      const sub = document.createElement('div');
      sub.className = 'tmpl-sub';
      sub.textContent = summarize(t.agents) || 'empty';
      info.append(nm, sub);
      const run = document.createElement('button');
      run.className = 'tmpl-run';
      run.textContent = 'Run';
      run.onclick = () => {
        h.onRun(t);
        closeTemplates();
      };
      const del = document.createElement('span');
      del.className = 'tmpl-del';
      del.title = 'delete template';
      del.appendChild(icon('trash'));
      del.onclick = () => {
        removeTemplate(t.name);
        renderList();
      };
      row.append(info, run, del);
      listEl.appendChild(row);
    }
  };
  box.appendChild(listEl);

  const saveRow = document.createElement('div');
  saveRow.className = 'tmpl-save';
  const input = document.createElement('input');
  input.className = 'tmpl-input';
  input.placeholder = 'Save current agents as… (name)';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'tmpl-savebtn';
  saveBtn.textContent = 'Save';
  const doSave = () => {
    const name = input.value.trim();
    const agents = h.currentAgents();
    if (!name || !agents.length) return;
    saveTemplate(name, agents);
    input.value = '';
    renderList();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSave();
    }
  };
  saveBtn.onclick = doSave;
  saveRow.append(input, saveBtn);
  box.appendChild(saveRow);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.onmousedown = (e) => {
    if (e.target === overlay) closeTemplates();
  };
  document.addEventListener('keydown', escClose);
  renderList();
  input.focus();
}

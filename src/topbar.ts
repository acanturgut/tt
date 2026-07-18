import { open } from '@tauri-apps/plugin-dialog';
import { listProjects, current, addProject, selectProject } from './projects';

export interface TopbarHandlers {
  onChange: () => void;
}

export function renderTopbar(root: HTMLElement, h: TopbarHandlers) {
  root.innerHTML = '';

  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = 'tt';

  const wrap = document.createElement('div');
  wrap.className = 'proj-wrap';
  const lbl = document.createElement('span');
  lbl.className = 'proj-label';
  lbl.textContent = 'Projects';

  const sel = document.createElement('select');
  sel.className = 'proj-select';
  const projs = listProjects();
  const cur = current();
  if (projs.length === 0) {
    const o = document.createElement('option');
    o.textContent = '(no projects)';
    o.disabled = true;
    o.selected = true;
    sel.appendChild(o);
  }
  for (const p of projs) {
    const o = document.createElement('option');
    o.value = p.path;
    o.textContent = p.name;
    o.title = p.path;
    if (cur && p.path === cur.path) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    selectProject(sel.value);
    h.onChange();
  };

  const add = document.createElement('button');
  add.className = 'addproj';
  add.textContent = '+ Add project';
  add.onclick = async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string') {
        addProject(picked);
        h.onChange();
      }
    } catch (e) {
      alert(`add project failed: ${e}`);
    }
  };

  wrap.append(lbl, sel, add);
  root.append(brand, wrap);
}

export interface Command {
  label: string;
  hint?: string;
  run: () => void;
}

let overlay: HTMLElement | null = null;

export function closePalette() {
  overlay?.remove();
  overlay = null;
}

export function openPalette(commands: Command[]) {
  closePalette();
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  const box = document.createElement('div');
  box.className = 'palette';
  const input = document.createElement('input');
  input.className = 'palette-input';
  input.placeholder = 'Type a command…';
  const listEl = document.createElement('div');
  listEl.className = 'palette-list';
  box.append(input, listEl);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  let filtered = commands;
  let sel = 0;

  const render = () => {
    listEl.innerHTML = '';
    filtered.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'palette-item' + (i === sel ? ' sel' : '');
      const lab = document.createElement('span');
      lab.textContent = c.label;
      item.appendChild(lab);
      if (c.hint) {
        const hint = document.createElement('span');
        hint.className = 'palette-hint';
        hint.textContent = c.hint;
        item.appendChild(hint);
      }
      item.onmousedown = (e) => {
        e.preventDefault();
        run(i);
      };
      listEl.appendChild(item);
    });
  };

  const run = (i: number) => {
    const c = filtered[i];
    closePalette();
    c?.run();
  };

  input.oninput = () => {
    const q = input.value.toLowerCase();
    filtered = commands.filter((c) => c.label.toLowerCase().includes(q));
    sel = 0;
    render();
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') {
      sel = Math.min(sel + 1, filtered.length - 1);
      render();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      sel = Math.max(sel - 1, 0);
      render();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      run(sel);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closePalette();
      e.preventDefault();
    }
  };
  overlay.onmousedown = (e) => {
    if (e.target === overlay) closePalette();
  };

  render();
  input.focus();
}

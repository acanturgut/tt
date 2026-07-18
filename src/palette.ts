export interface Command {
  label: string;
  hint?: string;
  run: () => void;
}

// Subsequence fuzzy match: returns a score (higher = better) or null if q isn't
// a subsequence of text. Rewards matches at word starts and consecutive runs.
export function fuzzyScore(text: string, q: string): number | null {
  if (!q) return 0;
  const t = text.toLowerCase();
  q = q.toLowerCase();
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at === -1) return null;
    let bonus = 1;
    if (at === 0 || /[^a-z0-9]/.test(t[at - 1])) bonus += 3; // word boundary
    if (at === ti) {
      streak += 1;
      bonus += streak; // consecutive characters
    } else {
      streak = 0;
    }
    score += bonus;
    ti = at + 1;
  }
  return score;
}

let overlay: HTMLElement | null = null;

export function closePalette() {
  overlay?.remove();
  overlay = null;
}

export function openPalette(commands: Command[], provider?: (q: string) => Promise<Command[]>) {
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

  let token = 0;
  input.oninput = () => {
    const q = input.value.trim();
    const cmds = commands
      .map((c) => ({ c, s: fuzzyScore(`${c.label} ${c.hint ?? ''}`, q) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    filtered = cmds;
    sel = 0;
    render();
    // Async file/folder results (fzf), appended when they arrive if still current.
    if (provider && q) {
      const my = ++token;
      void provider(q).then((extra) => {
        if (my !== token) return;
        filtered = [...cmds, ...extra];
        render();
      });
    }
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

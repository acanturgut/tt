// Keyboard-shortcuts cheat sheet. Opened from the toolbar keyboard button.
// Keep in sync with the ⌘ handler in main.ts and the viewer selection keys.
const GROUPS: { title: string; items: [string, string[]][] }[] = [
  {
    title: 'Projects & panels',
    items: [
      ['Switch to project 1–9', ['⌘', '1–9']],
      ['Show agent grid', ['⌘', '0']],
      ['Toggle file tree', ['⌘', 'B']],
      ['Toggle agents rail', ['⌘', '\\']],
      ['Task board', ['⌘', 'J']],
      ['Settings', ['⌘', ',']],
    ],
  },
  {
    title: 'Agents',
    items: [
      ['New agent (default)', ['⌘', 'N']],
      ['New terminal', ['⌘', 'T']],
      ['Close focused agent', ['⌘', 'W']],
      ['Command palette / file search', ['⌘', 'K']],
      ['Broadcast to agents', ['⌘', 'L']],
      ['Zoom terminals in / out', ['⌘', '+ / −']],
    ],
  },
  {
    title: 'Code viewer',
    items: [
      ['Copy selection for agent', ['⌘', 'C']],
      ['Send selection to agent', ['⌘', '⏎']],
      ['Close viewer', ['Esc']],
    ],
  },
];

let overlay: HTMLElement | null = null;

export function closeShortcuts() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', escClose);
}
function escClose(e: KeyboardEvent) {
  if (e.key === 'Escape') closeShortcuts();
}

export function openShortcuts() {
  closeShortcuts();
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  const box = document.createElement('div');
  box.className = 'settings';

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Keyboard shortcuts';
  box.appendChild(title);

  for (const g of GROUPS) {
    const sec = document.createElement('div');
    sec.className = 'settings-section';
    const h = document.createElement('div');
    h.className = 'settings-section-title';
    h.textContent = g.title;
    sec.appendChild(h);
    for (const [label, keys] of g.items) {
      const row = document.createElement('div');
      row.className = 'sc-row';
      const t = document.createElement('span');
      t.textContent = label;
      const kwrap = document.createElement('span');
      kwrap.className = 'sc-keys';
      for (const k of keys) {
        const kb = document.createElement('kbd');
        kb.textContent = k;
        kwrap.appendChild(kb);
      }
      row.append(t, kwrap);
      sec.appendChild(row);
    }
    box.appendChild(sec);
  }

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.onmousedown = (e) => {
    if (e.target === overlay) closeShortcuts();
  };
  document.addEventListener('keydown', escClose);
}

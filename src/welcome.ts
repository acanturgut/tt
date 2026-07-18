import { open } from '@tauri-apps/plugin-dialog';
import { addProject } from './projects';
import { icon } from './icon';

// The tt mark: a 2x2 tile grid (white on blue) — "tiled agents", matches the app icon.
const LOGO = `<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
  <rect x="6" y="6" width="8" height="8" rx="2.5"/>
  <rect x="18" y="6" width="8" height="8" rx="2.5"/>
  <rect x="6" y="18" width="8" height="8" rx="2.5"/>
  <rect x="18" y="18" width="8" height="8" rx="2.5"/>
</svg>`;

const STEPS: { title: string; body: string }[] = [
  { title: 'Add a project folder', body: 'Pick a repo. Every agent you spawn lives under its own tab.' },
  { title: 'Spawn agents', body: 'Launch claude, codex, cursor, gemini and more from the toolbar.' },
  { title: 'Coordinate them', body: 'Broadcast to all at once, or type #2 to target one. ⌘K for commands.' },
];

export function renderWelcome(root: HTMLElement) {
  root.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'welcome-card';

  const mark = document.createElement('div');
  mark.className = 'welcome-mark';
  mark.innerHTML = LOGO;

  const h = document.createElement('div');
  h.className = 'welcome-title';
  h.textContent = 'Welcome to tt';

  const sub = document.createElement('div');
  sub.className = 'welcome-sub';
  sub.textContent = 'Run and coordinate many coding agents side by side.';

  const btn = document.createElement('button');
  btn.className = 'welcome-btn';
  btn.append(icon('folder-plus'), document.createTextNode(' Add a project folder'));
  btn.onclick = async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string') addProject(picked);
    } catch (e) {
      alert(`add project failed: ${e}`);
    }
  };

  const steps = document.createElement('div');
  steps.className = 'welcome-steps';
  STEPS.forEach((s, i) => {
    const step = document.createElement('div');
    step.className = 'welcome-step';
    const n = document.createElement('div');
    n.className = 'welcome-step-n';
    n.textContent = String(i + 1);
    const txt = document.createElement('div');
    const ti = document.createElement('div');
    ti.className = 'welcome-step-title';
    ti.textContent = s.title;
    const bo = document.createElement('div');
    bo.className = 'welcome-step-body';
    bo.textContent = s.body;
    txt.append(ti, bo);
    step.append(n, txt);
    steps.appendChild(step);
  });

  card.append(mark, h, sub, btn, steps);
  root.appendChild(card);
}

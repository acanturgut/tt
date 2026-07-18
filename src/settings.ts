import { PROVIDERS, isProviderHidden, setProviderHidden } from './providers';

export interface Settings {
  autoPlanning: boolean; // tag new agents with the Planning status
  autoFocus: boolean; // zoom the newest agent on spawn
  notifications: boolean; // desktop "needs you" notifications
  sound: boolean; // soft chime when an agent needs you
  claudeMode: 'auto' | 'plan' | 'default'; // claude --permission-mode
  defaultAgent: string; // agent spawned by ⌘N
}

const DEFAULTS: Settings = {
  autoPlanning: false,
  autoFocus: false,
  notifications: true,
  sound: true,
  claudeMode: 'auto',
  defaultAgent: 'claude',
};
const KEY = 'tt.settings';

let s: Settings = load();

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): Settings {
  return s;
}

function set<K extends keyof Settings>(k: K, v: Settings[K]) {
  s = { ...s, [k]: v };
  localStorage.setItem(KEY, JSON.stringify(s));
}

let overlay: HTMLElement | null = null;

export function closeSettings() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', escClose);
}
function escClose(e: KeyboardEvent) {
  if (e.key === 'Escape') closeSettings();
}

export function openSettings() {
  closeSettings();
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  const box = document.createElement('div');
  box.className = 'settings';

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Settings';
  box.appendChild(title);

  const general = section('General');
  general.appendChild(
    choice(
      'Default agent (⌘N)',
      ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'terminal'],
      s.defaultAgent,
      (v) => set('defaultAgent', v),
    ),
  );
  general.appendChild(toggle('Tag new agents as Planning', s.autoPlanning, (v) => set('autoPlanning', v)));
  general.appendChild(toggle('Auto-focus the newest agent', s.autoFocus, (v) => set('autoFocus', v)));
  general.appendChild(toggle('Desktop notifications', s.notifications, (v) => set('notifications', v)));
  general.appendChild(toggle('Attention sound', s.sound, (v) => set('sound', v)));
  general.appendChild(
    toggle('OLED / dim mono mode', localStorage.getItem('tt.oled') === '1', (v) => {
      localStorage.setItem('tt.oled', v ? '1' : '0');
      document.body.classList.toggle('oled', v);
    }),
  );
  box.appendChild(general);

  const claude = section('Claude');
  claude.appendChild(
    choice('Permission mode', ['auto', 'plan', 'default'], s.claudeMode, (v) =>
      set('claudeMode', v as Settings['claudeMode']),
    ),
  );
  box.appendChild(claude);

  const provs = section('Agent providers');
  for (const id of PROVIDERS) {
    provs.appendChild(toggle(id, !isProviderHidden(id), (v) => setProviderHidden(id, !v)));
  }
  const tm = document.createElement('div');
  tm.className = 'settings-note';
  tm.textContent =
    'Claude, Codex, Cursor, Gemini, opencode and Antigravity are trademarks of their respective owners. tt is an independent tool — not affiliated with, endorsed by, or sponsored by any of them.';
  provs.appendChild(tm);
  box.appendChild(provs);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.onmousedown = (e) => {
    if (e.target === overlay) closeSettings();
  };
  document.addEventListener('keydown', escClose);
}

function section(name: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'settings-section';
  const h = document.createElement('div');
  h.className = 'settings-section-title';
  h.textContent = name;
  el.appendChild(h);
  return el;
}

function toggle(label: string, val: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'settings-row';
  const t = document.createElement('span');
  t.textContent = label;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = val;
  cb.onchange = () => onChange(cb.checked);
  row.append(t, cb);
  return row;
}

function choice(
  label: string,
  opts: string[],
  val: string,
  onChange: (v: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const t = document.createElement('span');
  t.textContent = label;
  const sel = document.createElement('select');
  sel.className = 'settings-select';
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === val) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => onChange(sel.value);
  row.append(t, sel);
  return row;
}

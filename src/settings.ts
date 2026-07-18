import { PROVIDERS, isProviderHidden, setProviderHidden } from './providers';
import { icon } from './icon';
import { scSelect } from './select';

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

function el(cls: string, text?: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  return d;
}

export function openSettings() {
  closeSettings();
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  const box = el('settings');

  const header = el('settings-header');
  header.append(el('settings-title', 'Settings'));
  const close = document.createElement('button');
  close.className = 'settings-close';
  close.setAttribute('aria-label', 'Close settings');
  close.append(icon('x'));
  close.onclick = closeSettings;
  header.append(close);
  box.append(header);

  const body = el('settings-body');

  const general = section('General');
  general.append(
    choice('Default agent', 'Spawned by ⌘N and the New-agent button.',
      ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'terminal'],
      s.defaultAgent, (v) => set('defaultAgent', v)),
    toggle('Tag new agents as Planning', 'New agents start with a Planning status.', s.autoPlanning, (v) => set('autoPlanning', v)),
    toggle('Auto-focus the newest agent', 'Zoom to an agent the moment it spawns.', s.autoFocus, (v) => set('autoFocus', v)),
    toggle('Desktop notifications', 'Notify you when an agent needs attention.', s.notifications, (v) => set('notifications', v)),
    toggle('Attention sound', 'Play a soft chime when an agent needs you.', s.sound, (v) => set('sound', v)),
    toggle('Show shortcut keys on buttons', 'Display the ⌘-key chips on toolbar buttons.',
      localStorage.getItem('tt.hideBtnKbd') !== '1', (v) => {
        localStorage.setItem('tt.hideBtnKbd', v ? '0' : '1');
        document.body.classList.toggle('hide-btn-kbd', !v);
      }),
    toggle('OLED / dim mono mode', 'Desaturate and dim the whole app for OLED screens.',
      localStorage.getItem('tt.oled') === '1', (v) => {
        localStorage.setItem('tt.oled', v ? '1' : '0');
        document.body.classList.toggle('oled', v);
      }),
  );
  body.append(general);

  const claude = section('Claude');
  claude.append(
    choice('Permission mode', 'Passed as claude --permission-mode.',
      ['auto', 'plan', 'default'], s.claudeMode, (v) => set('claudeMode', v as Settings['claudeMode'])),
  );
  body.append(claude);

  const provs = section('Agent providers');
  provs.append(el('settings-section-desc', 'Show or hide agents in the spawn menu.'));
  for (const id of PROVIDERS) {
    provs.append(toggle(id, undefined, !isProviderHidden(id), (v) => setProviderHidden(id, !v)));
  }
  provs.append(el('settings-note',
    'Claude, Codex, Cursor, Gemini, opencode and Antigravity are trademarks of their respective owners. tt is an independent tool, not affiliated with, endorsed by, or sponsored by any of them.'));
  body.append(provs);

  box.append(body);
  overlay.append(box);
  document.body.append(overlay);
  overlay.onmousedown = (e) => {
    if (e.target === overlay) closeSettings();
  };
  document.addEventListener('keydown', escClose);
}

function section(name: string): HTMLElement {
  const sec = el('settings-section');
  sec.append(el('settings-section-title', name));
  return sec;
}

// Left text block (label + optional muted description) shared by rows.
function rowText(label: string, desc?: string): HTMLElement {
  const text = el('set-text');
  text.append(el('set-label', label));
  if (desc) text.append(el('set-desc', desc));
  return text;
}

function toggle(label: string, desc: string | undefined, val: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'set-row';
  const sw = el('switch' + (val ? ' on' : ''));
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = val;
  cb.onchange = () => {
    sw.classList.toggle('on', cb.checked);
    onChange(cb.checked);
  };
  sw.append(cb, el('switch-thumb'));
  row.append(rowText(label, desc), sw);
  return row;
}

function choice(
  label: string,
  desc: string | undefined,
  opts: string[],
  val: string,
  onChange: (v: string) => void,
): HTMLElement {
  const row = el('set-row');
  row.append(rowText(label, desc), scSelect(opts, val, onChange));
  return row;
}

import {
  PROVIDERS,
  isProviderHidden,
  setProviderHidden,
  MODEL_CATALOG,
  refreshCliCheck,
  isCliMissing,
} from './providers';
import { icon } from './icon';
import { scSelect } from './select';

export interface Settings {
  autoPlanning: boolean; // tag new agents with the Planning status
  autoFocus: boolean; // zoom the newest agent on spawn
  notifications: boolean; // desktop "needs you" notifications
  sound: boolean; // soft chime when an agent needs you
  claudeMode: 'auto' | 'plan' | 'default'; // claude --permission-mode
  claudeEffort: string; // claude --effort default for new agents
  models: Record<string, string>; // per-provider default model ('' = the CLI's own default)
  defaultAgent: string; // agent spawned by ⌘N
}

const DEFAULTS: Settings = {
  autoPlanning: false,
  autoFocus: false,
  notifications: true,
  sound: true,
  claudeMode: 'auto',
  claudeEffort: 'high',
  models: {},
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

// Default model for a provider's new agents ('' = the CLI's own default).
export function defaultModel(agentId: string): string {
  return s.models[agentId] ?? '';
}
export function setDefaultModel(agentId: string, model: string) {
  set('models', { ...s.models, [agentId]: model });
}
export function defaultEffort(): string {
  return s.claudeEffort;
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
  const box = el('settings settings-panel');

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
      PROVIDERS, s.defaultAgent, (v) => set('defaultAgent', v)),
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
    toggle('Focus mode', 'Hide the toolbar and bottom status/task bars.',
      localStorage.getItem('tt.focus') === '1', (v) => {
        localStorage.setItem('tt.focus', v ? '1' : '0');
        document.body.classList.toggle('focus-mode', v);
        window.dispatchEvent(new CustomEvent('tt-focus-changed'));
      }),
    toggle('Hide bottom bars', 'Hide the board status and task progress bars at the bottom.',
      localStorage.getItem('tt.hideBottom') === '1', (v) => {
        localStorage.setItem('tt.hideBottom', v ? '1' : '0');
        document.body.classList.toggle('hide-bottom', v);
      }),
  );
  body.append(general);

  const claude = section('Claude');
  claude.append(
    choice('Permission mode', 'Passed as claude --permission-mode.',
      ['auto', 'plan', 'default'], s.claudeMode, (v) => set('claudeMode', v as Settings['claudeMode'])),
    choice('Reasoning effort', 'Default --effort for new claude agents.',
      MODEL_CATALOG.claude.effort!, s.claudeEffort, (v) => set('claudeEffort', v)),
  );
  body.append(claude);

  const models = section('Default models');
  models.append(el('settings-section-desc', 'Model each provider spawns with. "default" leaves the CLI to pick.'));
  for (const [id, cat] of Object.entries(MODEL_CATALOG)) {
    models.append(
      choice(id, undefined, ['default', ...cat.models], defaultModel(id) || 'default',
        (v) => setDefaultModel(id, v === 'default' ? '' : v)),
    );
  }
  body.append(models);

  const provs = section('Agent providers');
  provs.append(el('settings-section-desc', 'Show or hide agents in the spawn menu.'));
  const provRows = new Map<string, HTMLElement>();
  for (const id of PROVIDERS) {
    const row = toggle(id, undefined, !isProviderHidden(id), (v) => setProviderHidden(id, !v));
    provRows.set(id, row);
    provs.append(row);
  }
  // Checked per open, not once per app life: you may have installed the CLI since
  // launch. Rows render immediately and only gain the warning if the check says so,
  // so a slow login shell costs nothing visible.
  void refreshCliCheck().then(() => {
    for (const [id, row] of provRows) {
      if (!isCliMissing(id)) continue;
      row.querySelector('.set-text')?.append(el('set-desc set-desc-warn', 'CLI not found on your PATH'));
    }
  });
  provs.append(el('settings-note',
    'Claude, Codex, Cursor, Gemini, opencode, Antigravity, Ollama and LM Studio are trademarks of their respective owners. tt is an independent tool, not affiliated with, endorsed by, or sponsored by any of them.'));
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

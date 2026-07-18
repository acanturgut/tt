import { icon } from './icon';
import { openUrl } from '@tauri-apps/plugin-opener';

interface Install {
  name: string;
  cmd?: string;
  url: string;
  note?: string;
}

// How to install each agent CLI. `terminal` is intentionally absent (always available).
const INSTALLS: Record<string, Install> = {
  claude: {
    name: 'Claude Code',
    cmd: 'npm install -g @anthropic-ai/claude-code',
    url: 'https://docs.anthropic.com/en/docs/claude-code/overview',
  },
  codex: {
    name: 'OpenAI Codex CLI',
    cmd: 'npm install -g @openai/codex',
    url: 'https://github.com/openai/codex',
  },
  cursor: {
    name: 'Cursor CLI',
    cmd: 'curl https://cursor.com/install -fsS | bash',
    url: 'https://docs.cursor.com/en/cli/overview',
  },
  gemini: {
    name: 'Gemini CLI',
    cmd: 'npm install -g @google/gemini-cli',
    url: 'https://github.com/google-gemini/gemini-cli',
  },
  opencode: {
    name: 'opencode',
    cmd: 'npm install -g opencode-ai',
    url: 'https://opencode.ai/docs/',
  },
  antigravity: {
    name: 'Antigravity',
    url: 'https://antigravity.google',
    note: 'Install the Antigravity app, then enable its `antigravity` command-line launcher from within the app.',
  },
};

let overlay: HTMLElement | null = null;
function close() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', esc);
}
function esc(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

// Shown when an agent CLI dies immediately after spawn — almost always "not installed".
export function showInstallHelp(agentId: string) {
  const info = INSTALLS[agentId];
  if (!info) return; // e.g. plain terminal — nothing to install
  close();

  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  const box = document.createElement('div');
  box.className = 'install';

  const title = document.createElement('div');
  title.className = 'install-title';
  title.append(icon('warning-circle'), document.createTextNode(` ${info.name} didn't start`));

  const sub = document.createElement('div');
  sub.className = 'install-sub';
  sub.textContent = `"${agentId}" isn't installed or isn't on your PATH. Install it, then spawn again.`;
  box.append(title, sub);

  if (info.cmd) {
    const cmdRow = document.createElement('div');
    cmdRow.className = 'install-cmd';
    const code = document.createElement('code');
    code.textContent = info.cmd;
    const copy = document.createElement('button');
    copy.className = 'install-copy';
    copy.title = 'copy';
    copy.appendChild(icon('copy'));
    copy.onclick = () => {
      void navigator.clipboard.writeText(info.cmd!);
      copy.classList.add('done');
      copy.title = 'copied';
    };
    cmdRow.append(code, copy);
    box.append(cmdRow);
  }

  if (info.note) {
    const note = document.createElement('div');
    note.className = 'install-note';
    note.textContent = info.note;
    box.append(note);
  }

  const actions = document.createElement('div');
  actions.className = 'install-actions';
  const docs = document.createElement('button');
  docs.className = 'install-docs';
  docs.append(icon('book-open'), document.createTextNode(' Open docs'));
  docs.onclick = () => void openUrl(info.url).catch(() => void navigator.clipboard.writeText(info.url));
  const ok = document.createElement('button');
  ok.className = 'install-ok';
  ok.textContent = 'Got it';
  ok.onclick = close;
  actions.append(docs, ok);
  box.append(actions);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', esc);
}

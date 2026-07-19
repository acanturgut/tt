import { invoke } from '@tauri-apps/api/core';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import { marked } from 'marked';

export interface AgentTarget { id: string; label: string; name: string; }
export interface ViewerSend {
  agents: () => AgentTarget[];
  to: (id: string, text: string) => void;
}

let viewerEl: HTMLElement | null = null;
let getRoot: () => string | null = () => null;
let sendCfg: ViewerSend | null = null;
let open = false;
let curRel = '';
let reqId = 0;

// Current file, kept so the markdown Raw/Rendered toggle can re-render.
let curPath = '';
let curContent = '';
let mdRaw = false;
// The highlighted <code> block in code mode — selection→line math reads from it.
let curCodeEl: HTMLElement | null = null;
// The rendered-markdown container — selections here copy/send as plain prose (no line numbers).
let curTextEl: HTMLElement | null = null;

export function isViewerOpen(): boolean {
  return open;
}
export function closeViewer(): void {
  open = false;
  reqId++; // invalidate any in-flight read
  document.body.classList.remove('viewer-open');
  hideCopyBtn();
}

// Project-relative path for the header + clipboard; full path if not under root.
export function relPathOf(root: string | null, abs: string): string {
  if (!root) return abs;
  const base = root.replace(/\/$/, '');
  return abs.startsWith(base + '/') ? abs.slice(base.length + 1) : abs;
}

// The exact clipboard payload pasted into an agent.
export function formatForAgent(
  relPath: string,
  startLine: number,
  endLine: number,
  code: string,
): string {
  const loc = startLine === endLine ? `${relPath}:L${startLine}` : `${relPath}:L${startLine}-L${endLine}`;
  return `${loc}\n\n\`\`\`\n${code}\n\`\`\``;
}

// Rendered prose has no line numbers — send the file + the selected text as a quote.
export function formatTextForAgent(relPath: string, text: string): string {
  return `${relPath}\n\n> ${text.trim().replace(/\n/g, '\n> ')}`;
}

export function mountViewer(
  root: HTMLElement,
  getProjectRoot: () => string | null,
  send?: ViewerSend,
): void {
  viewerEl = root;
  getRoot = getProjectRoot;
  sendCfg = send ?? null;
  document.addEventListener('selectionchange', () => {
    if (open) onSelect(curRel);
  });
  // Shortcuts for the selection toolbar (only while it's showing).
  document.addEventListener('keydown', (e) => {
    if (!selBar || !e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() === 'c') {
      copy(curPayload);
      hideCopyBtn();
      e.preventDefault();
    } else if (e.key === 'Enter' && sendCfg && sendBtnEl) {
      openAgentMenu(sendBtnEl, curPayload);
      e.preventDefault();
    }
  });
}

export async function openViewer(path: string): Promise<void> {
  open = true;
  mdRaw = false; // new file opens rendered (for markdown)
  document.body.classList.add('viewer-open');
  const myReq = ++reqId;
  const cmd = isImage(path) || isPdf(path) ? 'read_image_data_url' : 'read_file';
  let text: string;
  try {
    text = await invoke<string>(cmd, { path });
  } catch (e) {
    if (myReq !== reqId) return;
    render(path, String(e), true);
    return;
  }
  if (myReq !== reqId) return;
  render(path, text, false);
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}
function isPdf(path: string): boolean {
  return /\.pdf$/i.test(path);
}

// Extension → highlight.js language; unknown falls back to auto-detect.
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', less: 'less', html: 'xml', htm: 'xml',
  xml: 'xml', svg: 'xml', vue: 'xml', py: 'python', rs: 'rust', go: 'go',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', java: 'java', rb: 'ruby', php: 'php',
  sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini',
  ini: 'ini', sql: 'sql', md: 'markdown', markdown: 'markdown', swift: 'swift',
  kt: 'kotlin', dockerfile: 'dockerfile',
};
export function highlight(path: string, code: string): string {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : '';
  const lang = EXT_LANG[ext];
  try {
    return lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}
export function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function render(path: string, content: string, isError: boolean): void {
  if (!viewerEl) return;
  curPath = path;
  curContent = content;
  curCodeEl = null;
  curTextEl = null;
  const rel = relPathOf(getRoot(), path);
  curRel = rel;
  viewerEl.innerHTML = '';
  hideCopyBtn();

  const header = document.createElement('div');
  header.className = 'viewer-header';
  const back = document.createElement('button');
  back.className = 'viewer-back';
  back.textContent = '✕ Close';
  back.title = 'close viewer (Esc)';
  back.onclick = closeViewer;
  const title = document.createElement('span');
  title.className = 'viewer-path';
  title.textContent = rel;
  header.append(back, title);

  // Markdown files get a Rendered/Raw toggle.
  if (!isError && isMarkdown(path)) {
    const toggle = document.createElement('button');
    toggle.className = 'viewer-toggle';
    toggle.textContent = mdRaw ? 'Rendered' : 'Raw';
    toggle.title = mdRaw ? 'show rendered markdown' : 'show raw source';
    toggle.onclick = () => {
      mdRaw = !mdRaw;
      render(curPath, curContent, false);
    };
    header.appendChild(toggle);
  }

  const copyPath = document.createElement('button');
  copyPath.className = 'viewer-copypath';
  copyPath.textContent = 'Copy path';
  copyPath.onclick = () => copy(rel);
  header.appendChild(copyPath);
  viewerEl.appendChild(header);

  const body = document.createElement('div');
  body.className = 'viewer-body';
  if (isError) {
    const err = document.createElement('div');
    err.className = 'viewer-error';
    err.textContent = content;
    body.appendChild(err);
    viewerEl.appendChild(body);
    return;
  }

  if (isImage(path)) {
    body.classList.add('is-media'); // center the image in the panel
    const img = document.createElement('img');
    img.className = 'viewer-img';
    img.src = content; // data: URL from read_image_data_url
    img.alt = rel;
    body.appendChild(img);
  } else if (isPdf(path)) {
    body.classList.add('is-pdf');
    // ponytail: native WKWebView PDF viewer via a data: URL (CSP is off). No pdf.js
    // dependency; swap to pdf.js if we need annotations/text-selection over pages.
    const frame = document.createElement('iframe');
    frame.className = 'viewer-pdf';
    frame.src = content; // data:application/pdf;base64,... from read_image_data_url
    frame.title = rel;
    body.appendChild(frame);
  } else if (isMarkdown(path) && !mdRaw) {
    renderMarkdown(body, content);
  } else {
    renderCode(body, path, content);
  }
  viewerEl.appendChild(body);
}

function renderMarkdown(body: HTMLElement, content: string): void {
  const md = document.createElement('div');
  md.className = 'viewer-md';
  // ponytail: no HTML sanitization — the viewer only shows the user's own local
  // project files, which are trusted. Add DOMPurify if untrusted files ever load here.
  md.innerHTML = marked.parse(content, { async: false }) as string;
  md.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el as HTMLElement));
  body.appendChild(md);
  curTextEl = md; // selections in rendered prose copy/send as plain text
}

function renderCode(body: HTMLElement, path: string, content: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'viewer-code';

  const gutter = document.createElement('div');
  gutter.className = 'code-gutter';
  const nLines = content.split('\n').length;
  for (let i = 1; i <= nLines; i++) {
    const d = document.createElement('div');
    d.className = 'code-ln';
    d.textContent = String(i);
    gutter.appendChild(d);
  }

  const pre = document.createElement('pre');
  pre.className = 'code-pre';
  const codeEl = document.createElement('code');
  codeEl.className = 'hljs';
  codeEl.innerHTML = highlight(path, content);
  pre.appendChild(codeEl);
  curCodeEl = codeEl;

  wrap.append(gutter, pre);
  body.appendChild(wrap);
}

let selBar: HTMLElement | null = null;
let agentMenu: HTMLElement | null = null;
let sendBtnEl: HTMLElement | null = null;
let curPayload = ''; // formatted snippet for the current selection (⌘C / send)
function hideCopyBtn(): void {
  agentMenu?.remove();
  agentMenu = null;
  selBar?.remove();
  selBar = null;
  sendBtnEl = null;
  curPayload = '';
}

// A compact "⌘C" chip shown inline on a selection button.
function selKbd(keys: string): HTMLElement {
  const kb = document.createElement('kbd');
  kb.className = 'sel-kbd';
  kb.textContent = keys;
  return kb;
}

// Popover listing agents; picking one sends the (optional prompt +) snippet to its terminal.
function openAgentMenu(anchor: HTMLElement, payload: string): void {
  agentMenu?.remove();
  const agents = sendCfg?.agents() ?? [];
  agentMenu = document.createElement('div');
  agentMenu.className = 'viewer-agentmenu';

  // Optional prompt sent ahead of the selected snippet ("explain this", "add a test", …).
  const ask = document.createElement('textarea');
  ask.className = 'viewer-agentmenu-ask';
  ask.rows = 2;
  ask.placeholder = 'Ask about this selection… (optional)';
  ask.onkeydown = (e) => { e.stopPropagation(); };
  const withPrompt = () => (ask.value.trim() ? `${ask.value.trim()}\n\n${payload}` : payload);
  agentMenu.appendChild(ask);

  if (!agents.length) {
    const empty = document.createElement('div');
    empty.className = 'viewer-agentmenu-empty';
    empty.textContent = 'No agents running';
    agentMenu.appendChild(empty);
  } else {
    for (const a of agents) {
      const row = document.createElement('button');
      row.className = 'viewer-agentmenu-row';
      row.innerHTML = `<span class="am-num">${escapeHtml(a.label)}</span><span class="am-name">${escapeHtml(a.name)}</span>`;
      row.onclick = () => {
        sendCfg?.to(a.id, withPrompt());
        toast(`Sent to ${a.name}`);
        hideCopyBtn();
      };
      agentMenu.appendChild(row);
    }
  }
  const r = anchor.getBoundingClientRect();
  agentMenu.style.top = `${r.bottom + window.scrollY + 4}px`;
  agentMenu.style.left = `${r.left + window.scrollX}px`;
  document.body.appendChild(agentMenu);
  ask.focus();
}

// Character offset of (node, offset) within the highlighted code block's text.
function offsetInCode(node: Node, offset: number): number {
  if (!curCodeEl) return -1;
  const range = document.createRange();
  range.selectNodeContents(curCodeEl);
  range.setEnd(node, offset);
  return range.toString().length;
}
function lineAt(text: string, charOffset: number): number {
  let line = 1;
  for (let i = 0; i < charOffset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function onSelect(relPath: string): void {
  const sel = window.getSelection();
  const text = sel?.toString() ?? '';
  if (!sel || sel.isCollapsed || !text.trim() || !sel.anchorNode || !sel.focusNode) {
    hideCopyBtn();
    return;
  }
  // Code view formats with line numbers; rendered prose sends the selected text as a quote.
  let payload: string;
  if (curCodeEl && curCodeEl.contains(sel.anchorNode) && curCodeEl.contains(sel.focusNode)) {
    const oa = offsetInCode(sel.anchorNode, sel.anchorOffset);
    const ob = offsetInCode(sel.focusNode, sel.focusOffset);
    const start = lineAt(curContent, Math.min(oa, ob));
    const end = lineAt(curContent, Math.max(oa, ob));
    payload = formatForAgent(relPath, start, end, text);
  } else if (curTextEl && curTextEl.contains(sel.anchorNode) && curTextEl.contains(sel.focusNode)) {
    payload = formatTextForAgent(relPath, text);
  } else {
    hideCopyBtn();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();

  hideCopyBtn();
  curPayload = payload;
  selBar = document.createElement('div');
  selBar.className = 'viewer-selbar';
  selBar.style.top = `${rect.bottom + window.scrollY + 4}px`;
  selBar.style.left = `${rect.left + window.scrollX}px`;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'viewer-selbtn';
  copyBtn.append('Copy ⧉', selKbd('⌘C'));
  copyBtn.onclick = () => {
    copy(payload);
    hideCopyBtn();
  };
  selBar.appendChild(copyBtn);

  if (sendCfg) {
    const sendBtn = document.createElement('button');
    sendBtn.className = 'viewer-selbtn';
    sendBtn.append('Send to agent ➤', selKbd('⌘⏎'));
    sendBtn.onclick = () => {
      if (agentMenu) hideMenuOnly();
      else openAgentMenu(sendBtn, payload);
    };
    selBar.appendChild(sendBtn);
    sendBtnEl = sendBtn;
  }
  document.body.appendChild(selBar);
}

function hideMenuOnly(): void {
  agentMenu?.remove();
  agentMenu = null;
}

function copy(s: string): void {
  void navigator.clipboard.writeText(s).then(() => toast('Copied'), () => toast('Copy failed'));
}

let toastEl: HTMLElement | null = null;
function toast(msg: string): void {
  toastEl?.remove();
  toastEl = document.createElement('div');
  toastEl.className = 'viewer-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.textContent = msg;
  document.body.appendChild(toastEl);
  const t = toastEl;
  setTimeout(() => t.remove(), 1200);
}

import { invoke } from '@tauri-apps/api/core';

let viewerEl: HTMLElement | null = null;
let getRoot: () => string | null = () => null;
let open = false;
let curRel = '';
let reqId = 0;

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

export function mountViewer(root: HTMLElement, getProjectRoot: () => string | null): void {
  viewerEl = root;
  getRoot = getProjectRoot;
  document.addEventListener('selectionchange', () => {
    if (open) onSelect(curRel);
  });
}

export async function openViewer(path: string): Promise<void> {
  open = true;
  document.body.classList.add('viewer-open');
  const myReq = ++reqId;
  let text: string;
  try {
    text = await invoke<string>('read_file', { path });
  } catch (e) {
    if (myReq !== reqId) return;
    render(path, String(e), true);
    return;
  }
  if (myReq !== reqId) return;
  render(path, text, false);
}

function render(path: string, content: string, isError: boolean): void {
  if (!viewerEl) return;
  const rel = relPathOf(getRoot(), path);
  curRel = rel;
  viewerEl.innerHTML = '';
  hideCopyBtn();

  const header = document.createElement('div');
  header.className = 'viewer-header';
  const back = document.createElement('button');
  back.className = 'viewer-back';
  back.textContent = '← Back';
  back.onclick = closeViewer;
  const title = document.createElement('span');
  title.className = 'viewer-path';
  title.textContent = rel;
  const copyPath = document.createElement('button');
  copyPath.className = 'viewer-copypath';
  copyPath.textContent = 'Copy path';
  copyPath.onclick = () => copy(rel);
  header.append(back, title, copyPath);
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

  const code = document.createElement('div');
  code.className = 'viewer-code';
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const row = document.createElement('div');
    row.className = 'code-line';
    row.dataset.line = String(i + 1);
    const ln = document.createElement('span');
    ln.className = 'code-ln';
    ln.textContent = String(i + 1);
    const lc = document.createElement('span');
    lc.className = 'code-lc';
    lc.textContent = line;
    row.append(ln, lc);
    code.appendChild(row);
  });
  body.appendChild(code);
  viewerEl.appendChild(body);

  // Selection → floating copy button.
  body.addEventListener('mouseup', () => setTimeout(() => onSelect(rel), 0));
}

let copyBtn: HTMLButtonElement | null = null;
function hideCopyBtn(): void {
  copyBtn?.remove();
  copyBtn = null;
}

function lineOf(node: Node | null): number | null {
  let el = node instanceof Element ? node : node?.parentElement ?? null;
  el = el?.closest('.code-line') ?? null;
  const v = (el as HTMLElement | null)?.dataset.line;
  return v ? Number(v) : null;
}

function onSelect(relPath: string): void {
  const sel = window.getSelection();
  const text = sel?.toString() ?? '';
  if (!sel || sel.isCollapsed || !text.trim()) {
    hideCopyBtn();
    return;
  }
  if (viewerEl && !viewerEl.contains(sel.anchorNode)) {
    hideCopyBtn();
    return;
  }
  const a = lineOf(sel.anchorNode);
  const b = lineOf(sel.focusNode);
  if (a == null || b == null) {
    hideCopyBtn();
    return;
  }
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const rect = sel.getRangeAt(0).getBoundingClientRect();

  hideCopyBtn();
  copyBtn = document.createElement('button');
  copyBtn.className = 'viewer-copybtn';
  copyBtn.textContent = 'Copy for agent ⧉';
  copyBtn.style.top = `${rect.bottom + window.scrollY + 4}px`;
  copyBtn.style.left = `${rect.left + window.scrollX}px`;
  copyBtn.onclick = () => {
    copy(formatForAgent(relPath, start, end, text));
    hideCopyBtn();
  };
  document.body.appendChild(copyBtn);
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

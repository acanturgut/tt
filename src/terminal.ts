import { Terminal, FitAddon, init } from 'ghostty-web';
// ghostty's init(url) does a single fetch(url). In the notarized release webview, Tauri's
// custom protocol intercepts EVERY url a fetch can name — asset paths, data:, even blob: —
// and hands back index.html, so WebAssembly.compile chokes on HTML ("doesn't start with
// '\0asm'"). Confirmed at runtime: the inlined bytes compile fine directly, only the fetch
// is broken. So we never fetch anything real — Vite inlines the wasm bytes into this bundle
// (virtual:ghostty-wasm), and loadGhostty() intercepts ghostty's one fetch() call to answer
// it from memory with a Response built from those bytes. No protocol, no network, no CSP.
import ghosttyWasmB64 from 'virtual:ghostty-wasm';
import { invoke } from '@tauri-apps/api/core';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { markInput } from './agents';

// ghostty-web is a drop-in xterm replacement whose VT engine runs in WASM (Ghostty's
// native parser) and paints to a <canvas>. That canvas renderer is the whole point:
// xterm's DOM renderer reflows a <div>-per-row on every scroll tick, which is the one
// thing that's slow in this Tauri/WKWebView app — and xterm 6 removed the canvas
// renderer while its WebGL one is broken on macOS 26. Canvas 2D is fast on WebKit and
// avoids the WebGL wall entirely.
//
// The WASM must load once before any terminal opens. Cached so every caller awaits the
// single load; the app awaits it before creating any terminal.
let initPromise: Promise<void> | null = null;
export function initTerminals(): Promise<void> {
  return (initPromise ??= loadGhostty());
}

// Decode the inlined wasm (base64) to bytes.
export function wasmBytes(): Uint8Array {
  const bin = atob(ghosttyWasmB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Sentinel we hand ghostty; it never reaches the network — our fetch shim answers it.
const WASM_URL = 'ghostty:vt.wasm';

async function loadGhostty(): Promise<void> {
  const bytes = wasmBytes();
  // ponytail: patch the global fetch for the single init() call, then restore. loadGhostty
  // runs once (initPromise-cached); non-sentinel fetches pass straight through, so nothing
  // else is affected during the brief window.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, opts?: RequestInit) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (u === WASM_URL) {
      return Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }));
    }
    return realFetch(input, opts);
  }) as typeof fetch;
  try {
    // init() takes an optional wasm URL at runtime; its shipped .d.ts stalely omits it.
    await (init as (u?: string) => Promise<void>)(WASM_URL);
  } finally {
    globalThis.fetch = realFetch;
  }
}

export class AgentTerminal {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  private opened = false;
  private fontSize = 12;
  // ghostty throws on write() before open() (xterm buffered internally instead). Output
  // frequently arrives before the tile mounts, so hold it here and flush on open().
  private buf: Uint8Array[] = [];

  constructor(public id: string) {
    this.term = new Terminal({
      fontFamily: 'Menlo, monospace',
      fontSize: this.fontSize,
      cursorBlink: true,
      scrollback: 1000,
      // Pitch black to match .tile-body (#000) — otherwise the canvas reads a shade
      // lighter than the tile, and any sub-character gap around the grid shows through.
      theme: {
        background: '#000000',
        foreground: '#f2f4f7',
        cursor: '#f2f4f7',
        cursorAccent: '#000000',
        selectionBackground: '#2a3646',
      },
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.el = document.createElement('div');
    this.el.className = 'term';
    // Send ALL data to the PTY (including automatic replies to terminal query
    // sequences). But only real keystrokes (onKey) count as "input" for the attention
    // flag — a fresh TUI like claude auto-replies on startup, which would otherwise
    // falsely arm "needs you" with zero typing from the user.
    this.term.onData((d) => void invoke('write_agent', { id: this.id, data: d }));
    this.term.onKey(() => markInput(this.id));
    // ghostty's attachCustomKeyEventHandler convention is the OPPOSITE of xterm's:
    // returning TRUE = "handled, swallow it (send nothing)"; FALSE = "let ghostty type
    // it". (xterm: true = type normally.) So return FALSE for plain keys and TRUE only
    // for the ⌘ shortcuts we service — else EVERY keystroke is swallowed ("cannot type").
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key === 'c' && this.term.hasSelection()) {
        void writeText(this.term.getSelection());
        return true;
      }
      if (e.key === 'v') {
        void readText().then((t) => {
          if (t) this.term.paste(t);
        });
        return true;
      }
      // ⌘⌫ = delete to start of line, like macOS text fields → readline kill-line (Ctrl-U).
      if (e.key === 'Backspace') {
        void invoke('write_agent', { id: this.id, data: '\x15' });
        return true;
      }
      return true; // other ⌘-combos: swallow here so they don't hit the PTY; the
      // window-level keydown handler runs the app shortcut (⌘K, ⌘1-9, …).
    });
    this.term.onResize(({ cols, rows }) =>
      void invoke('resize_agent', { id: this.id, cols, rows }),
    );
    // ghostty's wheel handler only does alt-scroll (arrow keys); it never reports mouse
    // wheel events. Apps that turn on SGR mouse tracking (claude, vim, less) expect SGR
    // wheel events to scroll THEIR view — without them, the wheel navigates history like
    // Up/Down. When the app is in SGR mouse mode, encode + send the wheel ourselves and
    // suppress ghostty's default; otherwise return false so its viewport scroll runs.
    this.term.attachCustomWheelEventHandler((e) => {
      if (!this.term.getMode(1006)) return false; // not SGR mouse mode → ghostty default
      const rect = this.el.getBoundingClientRect();
      const cols = this.term.cols || 1;
      const rows = this.term.rows || 1;
      const col = Math.min(cols, Math.max(1, Math.floor((e.clientX - rect.left) / (rect.width / cols)) + 1));
      const row = Math.min(rows, Math.max(1, Math.floor((e.clientY - rect.top) / (rect.height / rows)) + 1));
      const btn = e.deltaY < 0 ? 64 : 65; // SGR: 64 = wheel up, 65 = wheel down
      void invoke('write_agent', { id: this.id, data: `\x1b[<${btn};${col};${row}M` });
      return true; // handled — suppress ghostty's arrow-key fallback
    });
  }

  // Call once, after this.el is attached to the DOM. initTerminals() must have resolved
  // first — the app awaits it before constructing any AgentTerminal, so the WASM engine
  // is ready by the time a tile mounts and calls open().
  open() {
    if (this.opened) return;
    this.opened = true;
    this.term.open(this.el);
    this.fitNow();
    for (const b of this.buf) this.term.write(b);
    this.buf = [];
    // ghostty binds its keydown listener to this.el (it makes the element tabindex/
    // contenteditable) and only routes keys when it holds focus. xterm auto-focused on
    // click; ghostty doesn't reliably, so focus the element directly on open and on any
    // click inside it. Focusing this.el (the listener target) beats term.focus() whose
    // internal target we can't depend on.
    this.el.addEventListener('mousedown', () => this.el.focus());
    this.el.focus();
  }

  focus() {
    this.el.focus();
  }

  write(data: Uint8Array) {
    if (!this.opened) {
      this.buf.push(data);
      return;
    }
    this.term.write(data);
  }

  fitNow() {
    // A terminal inside a hidden view (#workspace is display:none while the
    // git/board/viewer overlay is up) measures as zero. Fitting it there computes
    // garbage cols/rows and resizes the PTY to junk, so it comes back mis-rendered
    // on view switch. Only fit when the element actually has a layout box.
    if (!this.el.clientWidth || !this.el.clientHeight) return;
    try {
      this.fit.fit();
    } catch {
      /* not visible yet */
    }
  }

  setFontSize(px: number) {
    this.fontSize = Math.max(6, Math.min(32, px));
    this.term.options.fontSize = this.fontSize;
    // Defer the fit a frame so the char re-measure lands before we compute rows.
    requestAnimationFrame(() => this.fitNow());
  }
  zoomIn() {
    this.setFontSize(this.fontSize + 1);
  }
  zoomOut() {
    this.setFontSize(this.fontSize - 1);
  }

  dispose() {
    this.term.dispose();
  }
}

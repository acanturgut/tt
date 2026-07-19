import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { markInput } from './agents';

export class AgentTerminal {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  private opened = false;
  private fontSize = 12;

  constructor(public id: string) {
    this.term = new Terminal({
      fontFamily: 'Menlo, monospace',
      fontSize: this.fontSize,
      lineHeight: 1.0,
      cursorBlink: true,
      allowProposedApi: true,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.el = document.createElement('div');
    this.el.className = 'term';
    // Send ALL data to the PTY (including xterm's automatic replies to terminal
    // query sequences). But only real keystrokes (onKey) count as "input" for the
    // attention flag — a fresh TUI like claude auto-replies on startup, which would
    // otherwise falsely arm "needs you" with zero typing from the user.
    this.term.onData((d) => void invoke('write_agent', { id: this.id, data: d }));
    this.term.onKey(() => markInput(this.id));
    // ⌘C copies the selection, ⌘V pastes — otherwise the terminal swallows them.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.metaKey || e.ctrlKey || e.altKey) return true;
      if (e.key === 'c' && this.term.hasSelection()) {
        void writeText(this.term.getSelection());
        return false;
      }
      if (e.key === 'v') {
        void readText().then((t) => {
          if (t) this.term.paste(t);
        });
        return false;
      }
      // ⌘⌫ = delete to start of line, like macOS text fields → readline kill-line (Ctrl-U).
      if (e.key === 'Backspace') {
        void invoke('write_agent', { id: this.id, data: '\x15' });
        return false;
      }
      return true;
    });
    this.term.onResize(({ cols, rows }) =>
      void invoke('resize_agent', { id: this.id, cols, rows }),
    );
  }

  // Call once, after this.el is attached to the DOM.
  open() {
    if (this.opened) return;
    this.opened = true;
    this.term.open(this.el);
    // ponytail: DOM renderer only. xterm 6 removed the canvas renderer, and its WebGL
    // renderer is visually broken on macOS 26 / WKWebView (xtermjs/xterm.js#5816), so
    // WebGL isn't a usable option here. Scroll cost is the DOM renderer's weakness and
    // scales with cols — keep an eye on very wide terminals.
    this.fitNow();
  }

  write(data: Uint8Array) {
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

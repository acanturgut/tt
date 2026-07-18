import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
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
    this.term.onResize(({ cols, rows }) =>
      void invoke('resize_agent', { id: this.id, cols, rows }),
    );
  }

  // Call once, after this.el is attached to the DOM.
  open() {
    if (this.opened) return;
    this.opened = true;
    this.term.open(this.el);
    try {
      this.term.loadAddon(new WebglAddon());
    } catch {
      /* webgl unavailable — canvas fallback is fine */
    }
    this.fitNow();
  }

  write(data: Uint8Array) {
    this.term.write(data);
  }

  fitNow() {
    try {
      this.fit.fit();
    } catch {
      /* not visible yet */
    }
  }

  setFontSize(px: number) {
    this.fontSize = Math.max(6, Math.min(32, px));
    this.term.options.fontSize = this.fontSize;
    this.fitNow();
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

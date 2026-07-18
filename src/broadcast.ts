import type { Agent } from './agents';
import { icon } from './icon';

export interface BroadcastHandlers {
  onSend: (ids: string[], text: string, numbered: boolean) => void;
}

// Agents explicitly turned OFF as targets. New agents default ON.
const excluded = new Set<string>();
// When on, each agent is prefixed with "You are agent N of M" so one message can
// address each differently.
let numbered = localStorage.getItem('tt.bcNumbered') === '1';

let rootEl: HTMLElement | null = null;
let chipsEl: HTMLElement | null = null;
let currentAgents: Agent[] = [];

function selectedIds(): string[] {
  return currentAgents.filter((a) => !excluded.has(a.id)).map((a) => a.id);
}

// Built once so the text input keeps its value/focus across store re-renders.
export function mountBroadcast(root: HTMLElement, h: BroadcastHandlers) {
  rootEl = root;
  root.innerHTML = '';

  const tag = document.createElement('span');
  tag.className = 'bc-tag';
  tag.append(icon('broadcast'), document.createTextNode(' Broadcast'));

  const chips = document.createElement('div');
  chips.className = 'bc-chips';
  chipsEl = chips;

  const inputWrap = document.createElement('div');
  inputWrap.className = 'bc-input';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Send to selected agents…  (Enter)';
  const numBtn = document.createElement('button');
  numBtn.className = 'bc-num' + (numbered ? ' on' : '');
  numBtn.title = 'prefix each agent with "You are agent N of M" — one message can address each differently';
  numBtn.append(icon('hash'), document.createTextNode(' number'));
  numBtn.onclick = () => {
    numbered = !numbered;
    localStorage.setItem('tt.bcNumbered', numbered ? '1' : '0');
    numBtn.classList.toggle('on', numbered);
  };

  const send = document.createElement('button');
  send.className = 'bc-send';
  send.append(icon('paper-plane-tilt'), document.createTextNode(' Send'));

  const doSend = () => {
    const text = input.value;
    const ids = selectedIds();
    if (!text || ids.length === 0) return;
    h.onSend(ids, text, numbered);
    input.value = '';
    input.focus();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSend();
    }
  };
  send.onclick = doSend;
  inputWrap.append(numBtn, input, send);

  root.append(tag, chips, inputWrap);
}

// Rebuild only the target chips on agent changes (never the input).
export function updateBroadcast(agents: Agent[]) {
  currentAgents = agents;
  if (!rootEl || !chipsEl) return;
  rootEl.style.display = agents.length ? 'flex' : 'none';
  if (!agents.length) return;

  chipsEl.innerHTML = '';
  const allOn = agents.every((a) => !excluded.has(a.id));
  const all = document.createElement('button');
  all.className = 'bc-chip bc-all' + (allOn ? ' on' : '');
  all.textContent = allOn ? 'All' : 'None';
  all.onclick = () => {
    if (allOn) agents.forEach((a) => excluded.add(a.id));
    else excluded.clear();
    updateBroadcast(currentAgents);
  };
  chipsEl.appendChild(all);

  for (const a of agents) {
    const on = !excluded.has(a.id);
    const chip = document.createElement('button');
    chip.className = 'bc-chip' + (on ? ' on' : '');
    chip.textContent = a.name;
    chip.onclick = () => {
      if (on) excluded.add(a.id);
      else excluded.delete(a.id);
      updateBroadcast(currentAgents);
    };
    chipsEl.appendChild(chip);
  }
}

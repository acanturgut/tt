import type { Agent } from './agents';

const ADJ = ['swift', 'calm', 'bold', 'keen', 'wise', 'brave', 'quiet', 'sharp', 'lucky', 'nimble', 'clever', 'sunny', 'cosmic', 'rapid', 'witty', 'zen', 'fuzzy', 'mellow', 'plucky', 'stellar'];
const NOUN = ['otter', 'falcon', 'koala', 'panda', 'lynx', 'heron', 'marlin', 'tapir', 'ibex', 'raven', 'comet', 'maple', 'willow', 'ember', 'pixel', 'quartz', 'badger', 'sparrow', 'onyx', 'delta'];

// A friendly random codename for a freshly spawned agent (double-click to rename).
export function randomName(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}-${n}`;
}

// A name label that becomes an inline rename input on double-click. Use only
// where the element persists across re-renders (e.g. cached tile headers);
// callers that fully rebuild every tick should render a plain label instead.
export function editableName(agent: Agent, onRename: (name: string) => void): HTMLElement {
  const span = document.createElement('span');
  span.className = 'name';
  span.textContent = agent.name;
  span.title = 'double-click to rename';
  span.ondblclick = (ev) => {
    ev.stopPropagation();
    const inp = document.createElement('input');
    inp.className = 'name-edit';
    inp.value = agent.name;
    const done = (save: boolean) => {
      const v = inp.value.trim();
      if (inp.isConnected) inp.replaceWith(span);
      if (save && v && v !== agent.name) onRename(v);
    };
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    };
    inp.onblur = () => done(true);
    inp.onclick = (e) => e.stopPropagation();
    span.replaceWith(inp);
    inp.focus();
    inp.select();
  };
  return span;
}

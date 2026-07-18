import type { Agent } from './agents';

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

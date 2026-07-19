import type { Agent } from './agents';
import { providerModels } from './providers';
import { placeMenu } from './menu';

// The header chip that shows an agent's model (and, for claude, effort) and lets
// you change them. Returns null for providers with no model catalog. onSet is
// called with (model?, effort?) — one at a time; main.ts decides live-switch vs
// apply-on-restart. onRestart relaunches the agent with the stored model/effort.
export function modelPill(
  agent: Agent,
  onSet: (model?: string, effort?: string) => void,
  onRestart: () => void,
): HTMLElement | null {
  const cat = providerModels(agent.agentId);
  if (!cat) return null;

  const chip = document.createElement('span');
  chip.className = 'modelpill';
  paintModelPill(chip, agent);
  chip.onclick = (ev) => {
    ev.stopPropagation();
    openMenu(chip, agent, cat.models, cat.effort, onSet, onRestart);
  };
  return chip;
}

export function paintModelPill(chip: HTMLElement, agent: Agent) {
  const parts = [agent.model || 'default'];
  if (agent.effort) parts.push(agent.effort);
  chip.textContent = parts.join(' · ');
  chip.classList.toggle('modelpill-default', !agent.model);
}

function openMenu(
  anchor: HTMLElement,
  agent: Agent,
  models: string[],
  effort: string[] | undefined,
  onSet: (model?: string, effort?: string) => void,
  onRestart: () => void,
) {
  const menu = document.createElement('div');
  menu.className = 'popmenu';

  const group = (title: string, opts: string[], current: string | undefined, pick: (v: string) => void) => {
    const head = document.createElement('div');
    head.className = 'popmenu-head';
    head.textContent = title;
    menu.appendChild(head);
    for (const o of opts) {
      const item = document.createElement('div');
      item.className = 'popmenu-item' + (o === current ? ' popmenu-on' : '');
      item.textContent = o;
      item.onclick = (ev) => {
        ev.stopPropagation();
        pick(o);
        cleanup();
      };
      menu.appendChild(item);
    }
  };

  group('Model', models, agent.model, (m) => onSet(m, undefined));
  if (effort) group('Effort', effort, agent.effort, (e) => onSet(undefined, e));

  const restart = document.createElement('div');
  restart.className = 'popmenu-item popmenu-clear';
  restart.textContent = 'Restart to apply';
  restart.onclick = (ev) => {
    ev.stopPropagation();
    onRestart();
    cleanup();
  };
  menu.appendChild(restart);

  document.body.appendChild(menu);
  placeMenu(menu, anchor.getBoundingClientRect());

  function onDown(ev: MouseEvent) {
    if (!menu.contains(ev.target as Node)) cleanup();
  }
  function cleanup() {
    menu.remove();
    document.removeEventListener('mousedown', onDown);
  }
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

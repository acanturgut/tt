import { icon } from './icon';
import { placeMenu } from './menu';

export interface ScOption { value: string; label: string; }

// A shadcn-style Select: a trigger button + a floating listbox popover.
// Returns the trigger; it owns its own dropdown, keyboard nav, and outside-click close.
export function scSelect(
  options: (string | ScOption)[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const opts: ScOption[] = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  let cur = value;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'sc-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const val = document.createElement('span');
  val.className = 'sc-value';
  const caret = icon('caret-down');
  caret.classList.add('sc-caret');
  trigger.append(val, caret);

  const labelOf = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const paint = () => (val.textContent = labelOf(cur));
  paint();

  let content: HTMLElement | null = null;
  let activeIdx = 0;

  function close() {
    content?.remove();
    content = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function onDown(e: MouseEvent) {
    if (content && !content.contains(e.target as Node) && !trigger.contains(e.target as Node)) close();
  }
  function highlight() {
    if (!content) return;
    Array.from(content.children).forEach((c, i) =>
      (c as HTMLElement).classList.toggle('sc-active', i === activeIdx),
    );
    (content.children[activeIdx] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
  }
  function pick(v: string) {
    cur = v;
    paint();
    close();
    trigger.focus();
    onChange(v);
  }
  function onKey(e: KeyboardEvent) {
    if (!content) return;
    if (e.key === 'ArrowDown') { activeIdx = Math.min(opts.length - 1, activeIdx + 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { activeIdx = Math.max(0, activeIdx - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { pick(opts[activeIdx].value); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); trigger.focus(); e.preventDefault(); e.stopPropagation(); }
  }
  function open() {
    if (content) { close(); return; }
    content = document.createElement('div');
    content.className = 'sc-content';
    content.setAttribute('role', 'listbox');
    opts.forEach((o, i) => {
      const item = document.createElement('div');
      item.className = 'sc-item' + (o.value === cur ? ' sc-selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(o.value === cur));
      const check = icon('check');
      check.classList.add('sc-check');
      const lab = document.createElement('span');
      lab.className = 'sc-item-label';
      lab.textContent = o.label;
      item.append(check, lab);
      item.onmouseenter = () => { activeIdx = i; highlight(); };
      item.onclick = () => pick(o.value);
      content!.appendChild(item);
    });
    document.body.appendChild(content);
    content.style.minWidth = `${trigger.offsetWidth}px`;
    placeMenu(content, trigger.getBoundingClientRect());
    activeIdx = Math.max(0, opts.findIndex((o) => o.value === cur));
    highlight();
    trigger.setAttribute('aria-expanded', 'true');
    // capture phase so Escape closes the select, not the surrounding dialog
    setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }
  trigger.onclick = (e) => { e.preventDefault(); open(); };

  return trigger;
}

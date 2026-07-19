// Shared hover/focus tooltip with optional keyboard-shortcut chips.
// One floating node, reused. Also sets aria-label so icon-only controls stay named.
let tipEl: HTMLElement | null = null;
let showT: number | undefined;

function node(): HTMLElement {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function hide() {
  window.clearTimeout(showT);
  tipEl?.classList.remove('show');
}

function place(anchor: HTMLElement, label: string, keys?: string) {
  // The anchor can be destroyed during the 300ms hover delay (the topbar rebuilds on
  // every quota tick). A detached node measures all-zero, which would park the tooltip
  // in the screen corner with no mouseleave coming to dismiss it.
  if (!anchor.isConnected) { hide(); return; }
  const t = node();
  t.innerHTML = '';
  const lab = document.createElement('span');
  lab.className = 'tip-label';
  lab.textContent = label;
  t.appendChild(lab);
  if (keys) {
    const wrap = document.createElement('span');
    wrap.className = 'tip-keys';
    for (const k of keys.split(/\s+/)) {
      const kb = document.createElement('kbd');
      kb.textContent = k;
      wrap.appendChild(kb);
    }
    t.appendChild(wrap);
  }
  // measure hidden, then clamp on screen (prefer below the anchor, flip up if needed)
  t.style.visibility = 'hidden';
  t.classList.add('show');
  const r = anchor.getBoundingClientRect();
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
  let top = r.bottom + 6;
  if (top + th > window.innerHeight - 6) top = r.top - th - 6;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
  t.style.visibility = 'visible';
}

// Attach a tooltip to el. `keys` is space-separated (e.g. "⌘ B"); each token renders as a <kbd>.
export function tip(el: HTMLElement, label: string, keys?: string) {
  el.setAttribute('aria-label', keys ? `${label} (${keys.replace(/\s+/g, '')})` : label);
  el.removeAttribute('title');
  el.addEventListener('mouseenter', () => {
    window.clearTimeout(showT);
    showT = window.setTimeout(() => place(el, label, keys), 300);
  });
  el.addEventListener('mouseleave', hide);
  el.addEventListener('focus', () => place(el, label, keys));
  el.addEventListener('blur', hide);
  el.addEventListener('click', hide);
}

// Position a popover under an anchor rect, clamped to stay on-screen (flips up
// if it would overflow the bottom, shifts left if it would overflow the right).
export function placeMenu(menu: HTMLElement, r: DOMRect) {
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = r.left;
  let top = r.bottom + 4;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (left < 8) left = 8;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

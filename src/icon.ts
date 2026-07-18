// Phosphor icon element: <i class="ph ph-<name>">. Font weight is loaded once
// in main.ts (`@phosphor-icons/web/regular`).
export function icon(name: string, extra = ''): HTMLElement {
  const i = document.createElement('i');
  i.className = `ph ph-${name}${extra ? ' ' + extra : ''}`;
  return i;
}

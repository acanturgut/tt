// Seti-UI file icons (minimal, single-tone per language) via the `seti-icons`
// package, which ships the icons as SVG strings + a color keyword per icon.
import { themeIcons } from 'seti-icons';

// Seti-UI's own accent palette, tuned to read on the near-black app bg.
const getSeti = themeIcons({
  blue: '#519aba',
  grey: '#6d8086',
  'grey-light': '#8a9ba0',
  green: '#8dc149',
  orange: '#e37933',
  pink: '#f55385',
  purple: '#a074c4',
  red: '#cc3e44',
  white: '#d4d7d6',
  yellow: '#cbcb41',
  ignore: '#5b6b73',
});

// Seti svgs have no fill of their own — paint the whole glyph the accent color.
// They also ship without an xmlns, which is fine inline but leaves an <img src>
// data URI blank, so add the namespace too. Then inline as a same-origin data
// URI (CSP is disabled, so data: is fine).
function svgToUrl(svg: string, color: string): string {
  const filled = svg.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" fill="${color}" `);
  return `data:image/svg+xml,${encodeURIComponent(filled)}`;
}

export function fileIconUrl(name: string): string {
  const { svg, color } = getSeti(name);
  return svgToUrl(svg, color);
}

// seti-icons is file-only, so folders get a plain monochrome glyph in a muted
// Seti blue-grey — closed vs. open matches the tree's expand state.
const FOLDER = (open: boolean) =>
  open
    ? '<svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';

export function folderIconUrl(_name: string, open: boolean): string {
  return svgToUrl(FOLDER(open), '#6d8086');
}

export function iconImg(url: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'ficon';
  img.src = url;
  img.draggable = false;
  return img;
}

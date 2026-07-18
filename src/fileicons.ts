// VS Code-style file/folder icons via the Material Icon Theme manifest + SVGs.
import manifest from 'material-icon-theme/dist/material-icons.json';

// Bundle every icon SVG as an asset URL (same-origin → CSP-safe, loaded on demand).
const urls = import.meta.glob('/node_modules/material-icon-theme/icons/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const byName: Record<string, string> = {};
for (const [p, u] of Object.entries(urls)) {
  const base = p.split('/').pop()!.slice(0, -4); // strip ".svg"
  byName[base] = u;
}

const M = manifest as unknown as {
  file: string;
  folder: string;
  folderExpanded: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
};

// Icon names in the manifest match the SVG basenames (typescript → typescript.svg).
function urlFor(iconName: string): string {
  return byName[iconName] ?? byName[M.file] ?? '';
}

export function fileIconUrl(name: string): string {
  const lower = name.toLowerCase();
  const named = M.fileNames[lower];
  if (named) return urlFor(named);
  // Try the longest compound extension first (foo.test.ts → "test.ts" then "ts").
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ic = M.fileExtensions[parts.slice(i).join('.')];
    if (ic) return urlFor(ic);
  }
  return urlFor(M.file);
}

export function folderIconUrl(name: string, open: boolean): string {
  const lower = name.toLowerCase();
  const ic = (open ? M.folderNamesExpanded : M.folderNames)[lower];
  if (ic) return urlFor(ic);
  return urlFor(open ? M.folderExpanded : M.folder);
}

export function iconImg(url: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'ficon';
  img.src = url;
  img.draggable = false;
  return img;
}

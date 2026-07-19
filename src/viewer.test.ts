import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import { relPathOf, formatForAgent, langForPath } from './viewer';

// Importing ./viewer installs a marked renderer that escapes raw HTML. Repo files are
// untrusted (clones, node_modules, agent-written), and this innerHTML feeds a page that
// can reach the Tauri IPC — an <img onerror> here was arbitrary command execution.
describe('markdown raw HTML', () => {
  it('escapes an inline event-handler payload instead of emitting a tag', () => {
    const html = marked.parse('<img src=x onerror="alert(1)">', { async: false }) as string;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('escapes block-level raw HTML too', () => {
    const html = marked.parse('<script>alert(1)</script>', { async: false }) as string;
    expect(html).not.toContain('<script');
  });
  it('still renders ordinary markdown', () => {
    expect(marked.parse('# hi', { async: false })).toContain('<h1');
  });
});

// Guards the git-diff perf fix: commit diffs (.txt) and unknown types must resolve to null so the
// diff renders plain instead of calling hljs.highlightAuto per line (the freeze).
describe('langForPath', () => {
  it('returns null for commit diffs (.txt) and unknown extensions', () => {
    expect(langForPath('.txt')).toBeNull();
    expect(langForPath('some/file.unknownext')).toBeNull();
    expect(langForPath('noextension')).toBeNull();
  });
  it('returns a real language for known file types', () => {
    expect(langForPath('src/foo.ts')).toBe('typescript');
    expect(langForPath('main.rs')).toBe('rust');
  });
});

describe('viewer helpers', () => {
  it('relPathOf strips the project root', () => {
    expect(relPathOf('/home/me/proj', '/home/me/proj/src/foo.ts')).toBe('src/foo.ts');
  });
  it('relPathOf tolerates a trailing slash on root', () => {
    expect(relPathOf('/home/me/proj/', '/home/me/proj/src/foo.ts')).toBe('src/foo.ts');
  });
  it('relPathOf falls back to the full path when not under root', () => {
    expect(relPathOf('/home/me/proj', '/etc/hosts')).toBe('/etc/hosts');
    expect(relPathOf(null, '/etc/hosts')).toBe('/etc/hosts');
  });
  it('formatForAgent single line: no range', () => {
    expect(formatForAgent('src/foo.ts', 12, 12, 'const x = 1;')).toBe(
      'src/foo.ts:L12\n\n```\nconst x = 1;\n```',
    );
  });
  it('formatForAgent range', () => {
    expect(formatForAgent('src/foo.ts', 12, 20, 'a\nb')).toBe(
      'src/foo.ts:L12-L20\n\n```\na\nb\n```',
    );
  });
});

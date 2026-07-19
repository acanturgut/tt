import { describe, it, expect } from 'vitest';
import { relPathOf, formatForAgent, langForPath } from './viewer';

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

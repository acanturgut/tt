import { describe, it, expect, beforeEach } from 'vitest';
import { addProject, projectForDir, removeProject, listProjects } from './projects';

beforeEach(() => {
  for (const p of listProjects().slice()) removeProject(p.path);
});

describe('projectForDir', () => {
  it('matches a dir inside a project', () => {
    addProject('/work/alpha');
    expect(projectForDir('/work/alpha/src/deep')).toBe('/work/alpha');
    expect(projectForDir('/work/alpha')).toBe('/work/alpha');
  });

  it('returns null for a dir under no open project', () => {
    addProject('/work/alpha');
    expect(projectForDir('/elsewhere/beta')).toBeNull();
  });

  // A sibling must not win on a shared name prefix — /work/alpha2 is not inside /work/alpha.
  it('does not match a sibling sharing a path prefix', () => {
    addProject('/work/alpha');
    expect(projectForDir('/work/alpha2/src')).toBeNull();
  });

  // The nested project owns its own agents, not the outer one.
  it('picks the longest match when projects nest', () => {
    addProject('/work');
    addProject('/work/alpha');
    expect(projectForDir('/work/alpha/src')).toBe('/work/alpha');
    expect(projectForDir('/work/other/src')).toBe('/work');
  });

  // Must return the STORED path verbatim — that string is the key Agent.project is
  // matched against, so a trimmed variant would file the agent under an unfindable project.
  it('returns the stored path even when it has a trailing slash', () => {
    addProject('/work/alpha/');
    expect(projectForDir('/work/alpha/src')).toBe('/work/alpha/');
    expect(listProjects().map((p) => p.path)).toContain('/work/alpha/');
  });

  it('handles a project at the filesystem root', () => {
    addProject('/');
    expect(projectForDir('/anything/deep')).toBe('/');
  });
});

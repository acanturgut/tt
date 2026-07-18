import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as store from './agents';

const A = (over: Partial<store.Agent> = {}): store.Agent => ({
  id: 'a', agentId: 'codex', name: 'codex', dir: '/p', status: 'working', ...over,
});

beforeEach(() => store.__resetForTest());

describe('agents store', () => {
  it('adds an agent and lists it', () => {
    store.add(A({ id: 'claude-0', agentId: 'claude' }));
    expect(store.list().map((a) => a.id)).toEqual(['claude-0']);
    expect(store.list()[0].status).toBe('working');
  });

  it('markOutput -> working, then idle after 2s', () => {
    vi.useFakeTimers();
    store.add(A({ status: 'idle' }));
    store.markOutput('a');
    expect(store.list()[0].status).toBe('working');
    vi.advanceTimersByTime(2001);
    expect(store.list()[0].status).toBe('idle');
    vi.useRealTimers();
  });

  it('markExit wins over later output timer', () => {
    store.add(A());
    store.markExit('a');
    store.markOutput('a'); // must NOT resurrect an exited agent
    expect(store.list()[0].status).toBe('exited');
  });

  it('markClaude sets title and tokens', () => {
    store.add(A({ id: 'c', agentId: 'claude' }));
    store.markClaude('c', 'Fixing colors', 12000);
    expect(store.list()[0].title).toBe('Fixing colors');
    expect(store.list()[0].tokens).toBe(12000);
  });

  it('focus sets and clears the zoomed tile', () => {
    store.add(A({ id: 'x' }));
    expect(store.focused()).toBeNull();
    store.focus('x');
    expect(store.focused()).toBe('x');
    store.focus(null);
    expect(store.focused()).toBeNull();
  });
});

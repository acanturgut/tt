import { describe, it, expect } from 'vitest';
import { migrate } from './templates';

describe('template migration', () => {
  it('converts old { agents:[{agentId,dir,label}] } to slots, dropping dir/label', () => {
    const old = { name: 'Old', agents: [{ agentId: 'claude', dir: '/x', label: 'planning' }, { agentId: 'codex' }] };
    expect(migrate(old as never)).toEqual({
      name: 'Old',
      slots: [{ provider: 'claude' }, { provider: 'codex' }],
    });
  });

  it('passes a new-shape template through untouched', () => {
    const t = { name: 'New', slots: [{ provider: 'claude', role: 'Planner', prompt: 'go' }] };
    expect(migrate(t)).toEqual(t);
  });
});

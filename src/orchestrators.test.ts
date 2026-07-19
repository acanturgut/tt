import { expect, test, beforeEach } from 'vitest';
import type { Agent } from './agents';
import {
  addOrchestrator,
  listOrchestrators,
  getOrchestrator,
  removeOrchestrator,
  setOrchestratorRoot,
  activeSession,
  selectSession,
  sessionAgents,
  childAttribution,
  orchestratorPrompt,
  __resetOrchestratorsForTest,
} from './orchestrators';

beforeEach(() => __resetOrchestratorsForTest());

function ag(id: string, over: Partial<Agent> = {}): Agent {
  return { id, agentId: 'claude', name: id, dir: '/x', status: 'working', ...over };
}

test('store: add / get / list / setRoot / remove', () => {
  addOrchestrator({ id: 'o1', name: 'Ship auth', dir: '/x', project: '/x', goal: 'ship auth' });
  expect(listOrchestrators().map((o) => o.id)).toEqual(['o1']);
  setOrchestratorRoot('o1', 'claude-3');
  expect(getOrchestrator('o1')?.rootAgentId).toBe('claude-3');
  removeOrchestrator('o1');
  expect(listOrchestrators()).toEqual([]);
});

test('active session defaults to General (null) and can be selected', () => {
  expect(activeSession()).toBeNull();
  selectSession('o1');
  expect(activeSession()).toBe('o1');
  selectSession(null);
  expect(activeSession()).toBeNull();
});

test('sessionAgents: orchestrator view returns only that session', () => {
  const agents = [ag('a', { session: 'o1', project: '/p' }), ag('b', { project: '/p' }), ag('c', { session: 'o2' })];
  expect(sessionAgents(agents, 'o1', '/p').map((a) => a.id)).toEqual(['a']);
});

test('sessionAgents: General view excludes any session-tagged agent', () => {
  const agents = [ag('a', { session: 'o1', project: '/p' }), ag('b', { project: '/p' }), ag('c', { project: '/q' })];
  expect(sessionAgents(agents, null, '/p').map((a) => a.id)).toEqual(['b']);
});

test('childAttribution: parent in a session → inherit its session + parentId', () => {
  const parent = ag('root', { session: 'o1' });
  expect(childAttribution(parent, { session: 'o1', rootId: 'root' })).toEqual({ session: 'o1', parentId: 'root' });
});

test('childAttribution: no parent → fall back to active orchestrator session + its root', () => {
  expect(childAttribution(undefined, { session: 'o1', rootId: 'root' })).toEqual({ session: 'o1', parentId: 'root' });
});

test('childAttribution: no parent, General active → empty (caller decides parentId)', () => {
  expect(childAttribution(undefined, null)).toEqual({ session: undefined, parentId: undefined });
});

test('orchestratorPrompt embeds the goal and names the tt MCP tools', () => {
  const p = orchestratorPrompt('Ship the auth flow');
  expect(p).toContain('Ship the auth flow');
  expect(p).toContain('spawn_agent');
  expect(p).toContain('[tt orchestrator]');
});

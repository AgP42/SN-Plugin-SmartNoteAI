// The Library→context bridge: "add to CHAT / add to Agent" mutations.
// Pins the v0.88 concurrency contract — the agent mutation is computed
// INSIDE the settings write queue against the freshest state, so two
// quick adds can never lose each other — and the exact shapes written
// (sorted deduped docPages, idempotent docs, empty docPages dropped).

import type {Agent} from '../core/agents/agents';

// In-memory settings state; the mock applies the patch like the real
// queue does (merge into the full state, report success).
let state: {agents?: Agent[]};
const mockUpdateSettingsWith = jest.fn(
  async (fn: (s: typeof state) => Partial<typeof state>) => {
    const patch = fn(state);
    state = {...state, ...patch};
    return true;
  },
);
jest.mock('./settings', () => ({
  updateSettingsWith: (...a: unknown[]) =>
    mockUpdateSettingsWith(...(a as [never])),
}));

const mockAddChatCtxSeed = jest.fn();
jest.mock('./chatCtxSeed', () => ({
  addChatCtxSeed: (...a: unknown[]) => mockAddChatCtxSeed(...a),
}));

import {
  addPagesToChat,
  addPagesToAgent,
  addDocRefToAgent,
  removeFromAgent,
} from './contextActions';

const agent = (over: Partial<Agent> = {}): Agent =>
  ({
    id: 'a1',
    name: 'Recherche',
    icon: '🔎',
    docs: [],
    ...over,
  } as Agent);

beforeEach(() => {
  jest.clearAllMocks();
  state = {agents: [agent()]};
});

describe('addPagesToChat', () => {
  it('queues the refs through the chat seed, verbatim', () => {
    const refs = [
      {path: '/n/a.note', page: 2},
      {path: '/n/b.note', page: 0},
    ];
    addPagesToChat(refs);
    expect(mockAddChatCtxSeed).toHaveBeenCalledWith(refs);
  });
});

describe('addPagesToAgent', () => {
  it('adds pages sorted and deduped into docPages', async () => {
    state = {
      agents: [agent({docPages: {'/n/a.note': [5]}})],
    };
    const ok = await addPagesToAgent('a1', [
      {path: '/n/a.note', page: 2},
      {path: '/n/a.note', page: 5}, // already there — dedup
      {path: '/n/b.note', page: 1},
    ]);
    expect(ok).toBe(true);
    expect(state.agents![0].docPages).toEqual({
      '/n/a.note': [2, 5],
      '/n/b.note': [1],
    });
  });

  it('returns false for an unknown agent and writes nothing', async () => {
    const before = state.agents;
    expect(await addPagesToAgent('ghost', [{path: '/n/a.note', page: 0}])).toBe(
      false,
    );
    expect(state.agents).toBe(before);
  });

  it('computes the mutation inside the write queue (fresh state, not a stale read)', async () => {
    // Simulate a concurrent writer landing FIRST in the queue: by the time
    // our mutation runs, the agent already has a page. Both must survive.
    state = {agents: [agent({docPages: {'/n/a.note': [9]}})]};
    await addPagesToAgent('a1', [{path: '/n/a.note', page: 1}]);
    expect(state.agents![0].docPages).toEqual({'/n/a.note': [1, 9]});
    expect(mockUpdateSettingsWith).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the other agents', async () => {
    const other = agent({id: 'a2', name: 'Autre'});
    state = {agents: [agent(), other]};
    await addPagesToAgent('a1', [{path: '/n/a.note', page: 0}]);
    expect(state.agents![1]).toBe(other);
  });
});

describe('addDocRefToAgent', () => {
  it('appends a new doc/folder ref', async () => {
    expect(await addDocRefToAgent('a1', '/n/dossier/')).toBe(true);
    expect(state.agents![0].docs).toEqual(['/n/dossier/']);
  });

  it('is idempotent when the ref is already present', async () => {
    state = {agents: [agent({docs: ['/n/a.note']})]};
    expect(await addDocRefToAgent('a1', '/n/a.note')).toBe(true);
    expect(state.agents![0].docs).toEqual(['/n/a.note']);
  });
});

describe('removeFromAgent', () => {
  it("kind 'doc' removes only that ref", async () => {
    state = {agents: [agent({docs: ['/n/a.note', '/n/b.note']})]};
    expect(await removeFromAgent('a1', '/n/a.note', 'doc')).toBe(true);
    expect(state.agents![0].docs).toEqual(['/n/b.note']);
  });

  it("kind 'pages' drops the whole path and clears docPages when empty", async () => {
    state = {agents: [agent({docPages: {'/n/a.note': [0, 1]}})]};
    expect(await removeFromAgent('a1', '/n/a.note', 'pages')).toBe(true);
    expect(state.agents![0].docPages).toBeUndefined();
  });

  it("kind 'pages' keeps the other paths' page sets", async () => {
    state = {
      agents: [agent({docPages: {'/n/a.note': [0], '/n/b.note': [3]}})],
    };
    await removeFromAgent('a1', '/n/a.note', 'pages');
    expect(state.agents![0].docPages).toEqual({'/n/b.note': [3]});
  });
});

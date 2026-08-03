// Shared context mutations (v0.75, spec §4). One place for "add this to
// an Agent / to the CHAT" so the Library rows, note overview, page view
// and the floating-window search all behave identically.
//
// - CHAT target → the live path: pages are queued via chatCtxSeed and the
//   floating window folds them into the current conversation (§3b). In the
//   floating window itself the caller uses ChatPanel's own onToggleAdd
//   instead (no seed needed) — this module is the LIBRARY→chat bridge.
// - AGENT target → the stored path: whole notes/folders go to agent.docs
//   (live refs), specific pages go to agent.docPages (static). Persisted
//   through the settings singleton, which merges the patch into the full
//   in-memory state (so it never clobbers another field's writer).
import {updateSettingsWith} from './settings';
import {addChatCtxSeed} from './chatCtxSeed';
import type {Agent} from '../core/agents/agents';

export type CtxRef = {path: string; page: number};

const withAgents = async (
  agentId: string,
  mutate: (a: Agent) => Agent,
): Promise<boolean> => {
  // v0.88 (audit): the mutation is computed INSIDE the write queue against
  // the freshest state — the old read-then-updateSettings pattern could
  // overwrite a concurrent agents writer (two quick "+ Add to agent" taps
  // lost the first; the config screen's persist lost Library-side adds).
  let found = false;
  const ok = await updateSettingsWith(s => {
    const agents = s.agents ?? [];
    const idx = agents.findIndex(a => a.id === agentId);
    if (idx < 0) {
      return {};
    }
    found = true;
    const next = agents.map((a, i) => (i === idx ? mutate(a) : a));
    return {agents: next};
  });
  return found && ok;
};

// Queue pages into the live CHAT (library → floating window handoff).
export const addPagesToChat = (refs: CtxRef[]): void => addChatCtxSeed(refs);

// Add specific pages of a note to an agent's page-scoped context.
export const addPagesToAgent = (
  agentId: string,
  refs: CtxRef[],
): Promise<boolean> =>
  withAgents(agentId, a => {
    const dp: Record<string, number[]> = {...(a.docPages ?? {})};
    for (const r of refs) {
      const cur = new Set(dp[r.path] ?? []);
      cur.add(r.page);
      dp[r.path] = [...cur].sort((x, y) => x - y);
    }
    return {...a, docPages: dp};
  });

// Add a WHOLE note or a folder ref (live) to an agent's docs.
export const addDocRefToAgent = (
  agentId: string,
  ref: string,
): Promise<boolean> =>
  withAgents(agentId, a =>
    a.docs.includes(ref) ? a : {...a, docs: [...a.docs, ref]},
  );

// Remove an entry from an agent: a whole-doc/folder ref (kind 'doc') or a
// page-scoped note (kind 'pages', drops the whole path's page set).
export const removeFromAgent = (
  agentId: string,
  ref: string,
  kind: 'doc' | 'pages',
): Promise<boolean> =>
  withAgents(agentId, a => {
    if (kind === 'doc') {
      return {...a, docs: a.docs.filter(d => d !== ref)};
    }
    const dp = {...(a.docPages ?? {})};
    delete dp[ref];
    return {
      ...a,
      docPages: Object.keys(dp).length > 0 ? dp : undefined,
    };
  });

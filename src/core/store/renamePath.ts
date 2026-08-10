// Following a file RENAME through everything that is keyed by path.
//
// The store already rescues the transcripts themselves (PAGEID relocation
// for notes, byte-identity adoption for PDFs), but a document's path is
// also the key of everything the user ATTACHED to it: its sync mode, the
// agents that know it, its standing Sync order. None of that used to
// follow, so a rename silently revoked an explicit "Off" (the note could
// then be read and sent to the AI), dropped the note from its agents, and
// left a ghost row in the Library whose "Go to page" opened nothing
// (device report 2026-08-10).
//
// Everything here is PURE: the callers own the evidence that a rename
// actually happened, and the writes.
import type {AutoTarget} from './autoEngine';
import type {Agent} from '../agents/agents';

// A file rename never changes a FOLDER key, so only exact matches move.
// `to` wins when it already has its own value: an explicit decision the
// user made about the new path outranks anything inherited from the old.
export const migrateAutoTargets = (
  targets: Record<string, AutoTarget>,
  from: string,
  to: string,
): Record<string, AutoTarget> | null => {
  const own = targets[from];
  if (own === undefined) {
    return null; // nothing attached to the old path
  }
  const next = {...targets};
  delete next[from];
  if (next[to] === undefined) {
    next[to] = own;
  }
  return next;
};

// An agent knows documents by exact path (`docs`) and page sets by exact
// path (`docPages`). Folder refs in `docs` are left alone — a file rename
// does not move a folder, and a folder ref keeps matching by prefix.
export const migrateAgentPaths = (
  agents: Agent[],
  from: string,
  to: string,
): Agent[] | null => {
  let touched = false;
  const next = agents.map(a => {
    const hasDoc = a.docs.includes(from);
    const pages = a.docPages ?? {};
    const hasPages = Object.prototype.hasOwnProperty.call(pages, from);
    if (!hasDoc && !hasPages) {
      return a;
    }
    touched = true;
    const out: Agent = {...a};
    if (hasDoc) {
      // Rewrite in place, deduped: the agent may already know `to`.
      const seen = new Set<string>();
      out.docs = a.docs
        .map(d => (d === from ? to : d))
        .filter(d => (seen.has(d) ? false : (seen.add(d), true)));
    }
    if (hasPages) {
      const dp: Record<string, number[]> = {};
      for (const [k, v] of Object.entries(pages)) {
        if (k === from) {
          continue;
        }
        dp[k] = [...v];
      }
      // Union when the agent already had pages of the destination: both
      // page sets describe the same file now.
      const merged = new Set([...(dp[to] ?? []), ...(pages[from] ?? [])]);
      dp[to] = [...merged].sort((x, y) => x - y);
      out.docPages = dp;
    }
    return out;
  });
  return touched ? next : null;
};

// A standing "Sync now" order for a path that no longer exists never
// completes, and it is never pruned (absence of a file is deliberately
// NOT treated as proof by the engine). Left behind it also keeps the
// unattended spend cap bypassed for the whole session.
export const migrateWantedPaths = (
  wanted: readonly string[],
  from: string,
  to: string,
): string[] | null => {
  if (!wanted.includes(from)) {
    return null;
  }
  const out = new Set(wanted.filter(p => p !== from));
  out.add(to);
  return [...out];
};

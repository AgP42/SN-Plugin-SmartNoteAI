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
import type {AutoTarget, AutoMode} from './autoEngine';
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

// Release audit 2026-08-12 (critical, privacy): the rename follow-through
// above is inferred from PAID TRANSCRIPTS being relocated — so it can never
// fire for a document that was set to Off and never read, which is exactly
// the case it was written for. Renaming such a file left no entry at the new
// path, it inherited its folder's mode, and a private notebook the user had
// excluded could be read, billed and sent to the AI.
//
// This decides it from the SETTINGS alone: one explicit entry in the same
// folder whose file is proven gone, and no other candidate. The inference is
// deliberately FAIL-SAFE — it is applied only when the orphaned mode is MORE
// restrictive than what the path would inherit, so being wrong can only ever
// make the plugin read LESS, never more.
export const STRICTNESS: Record<AutoMode, number> = {off: 2, manual: 1, auto: 0};

export const orphanedModeFor = (
  targets: Record<string, AutoTarget>,
  path: string,
  // Explicit target paths in this folder whose file the caller has PROVEN
  // absent (an empty or failed directory listing proves nothing — see
  // provenGone).
  goneInFolder: readonly string[],
  inherited: AutoMode,
  // Paths in the SAME folder that exist but carry no explicit decision.
  // The inference needs exactly one of those as well: with two, we cannot
  // tell WHICH file the vanished one became, and protecting both would
  // quietly stop syncing a document the user never touched (verification
  // pass 2026-08-12 — the first version fanned out to every sibling).
  untrackedInFolder: readonly string[],
): {from: string; mode: AutoMode} | null => {
  if (targets[path] !== undefined) {
    return null; // the path speaks for itself
  }
  const cands = goneInFolder.filter(p => p !== path && targets[p] !== undefined);
  if (cands.length !== 1 || untrackedInFolder.length !== 1) {
    return null; // nothing to adopt, or an ambiguity we refuse to guess
  }
  const mode = targets[cands[0]].mode;
  return STRICTNESS[mode] > STRICTNESS[inherited]
    ? {from: cands[0], mode}
    : null;
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

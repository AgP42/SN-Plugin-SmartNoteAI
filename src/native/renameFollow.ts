// A file was RENAMED: carry everything attached to the old path over to
// the new one, then let the ghost go.
//
// The transcripts themselves are already rescued (PAGEID relocation for
// notes, byte-identity adoption for PDFs). What did NOT follow — and is
// what this module fixes — is everything the user ATTACHED to the file:
// its sync mode (an explicit "Off" was silently revoked, so a note the
// user had excluded could be read and sent to the AI), the agents that
// know it, its standing "Sync now" order, and its document lock. The
// leftover entry also showed the note twice in the Library, with a
// "Go to page" that opened a path that no longer exists (2026-08-10).
//
// EVIDENCE RULE: `listDirNative` returns [] both for an empty folder and
// for a FAILED listing (an unmounted SD card looks exactly like an empty
// one). So only a NON-EMPTY listing that lacks the file proves it is
// gone. Anything else and we conclude nothing and change nothing — the
// codebase's standing rule that absence is never proof.
import {listDirNative} from './fs';
import {mutateStore} from './transcriptStoreIo';
import {retireRenamedDoc} from '../core/store/transcriptStore';
import {updateSettingsWith, type Settings} from './settings';
import {
  migrateAutoTargets,
  migrateAgentPaths,
} from '../core/store/renamePath';

// Is this file PROVEN absent from its folder? Never a guess: see the
// evidence rule above.
export const provenGone = async (path: string): Promise<boolean> => {
  const cut = path.lastIndexOf('/');
  if (cut <= 0) {
    return false;
  }
  const dir = path.slice(0, cut);
  const base = path.slice(cut + 1);
  const entries = await listDirNative(dir);
  if (entries.length === 0) {
    return false; // empty folder OR failed listing — indistinguishable
  }
  return !entries.some(e => !e.isDir && e.name === base);
};

// The whole follow-through for a CONFIRMED rename. Callers own the proof
// that `from` is gone and that `to` now carries its content.
export const followRename = async (
  from: string,
  to: string,
): Promise<void> => {
  // Settings first: one queued read-modify-write for both fields, so a
  // concurrent writer can never overwrite this with a stale copy.
  await updateSettingsWith(s => {
    const patch: Partial<Settings> = {};
    const targets = migrateAutoTargets(s.autoTargets ?? {}, from, to);
    if (targets !== null) {
      patch.autoTargets = targets;
    }
    const agents = migrateAgentPaths(s.agents ?? [], from, to);
    if (agents !== null) {
      patch.agents = agents;
    }
    return patch;
  }).catch(() => undefined);
  // The standing Sync order has ONE writer (autoTranscript) — go through
  // it. Required LAZILY: reading.ts imports this module and autoTranscript
  // imports reading.ts, so a top-level import would close a cycle and the
  // binding would be undefined at module-init time.
  (
    require('./autoTranscript') as {
      renameManualWanted: (a: string, b: string) => void;
    }
  ).renameManualWanted(from, to);
  await mutateStore(st => retireRenamedDoc(st, from, to));
  console.log(
    '[SmartNoteAI.store]',
    `renamed: ${from.split('/').pop()} → ${to.split('/').pop()} ` +
      '(sync mode, agents and lock followed; ghost entry removed)',
  );
};

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

// THE ONE evidence primitive (lot 4b, 2026-08-16). This rule used to live in
// three hand-synchronized copies — here, the ghost-prune's folder re-listing
// (autoTranscript), and resolveTrackedNotes' walk-time answeredDirs — each
// with its own subtle reading. Every per-file proof now goes through this
// single three-valued answer; the walk-time variant stays where the walk is
// (it already holds the listing) but documents this as its contract.
//   'present'     the folder ANSWERED and lists the file
//   'proven-gone' the folder ANSWERED with other entries — and not the file
//   'no-proof'    empty or failed listing (an unmounted SD looks exactly
//                 like an empty folder): conclude nothing, change nothing
export type FolderEvidence = 'present' | 'proven-gone' | 'no-proof';

export const folderEvidence = async (
  path: string,
): Promise<FolderEvidence> => {
  const cut = path.lastIndexOf('/');
  if (cut <= 0) {
    return 'no-proof';
  }
  const dir = path.slice(0, cut);
  const base = path.slice(cut + 1);
  const entries = await listDirNative(dir).catch(() => []);
  if (entries.length === 0) {
    return 'no-proof'; // empty folder OR failed listing — indistinguishable
  }
  return entries.some(e => !e.isDir && e.name === base)
    ? 'present'
    : 'proven-gone';
};

// Is this file PROVEN absent from its folder? Never a guess: see the
// evidence rule above.
export const provenGone = async (path: string): Promise<boolean> =>
  (await folderEvidence(path)) === 'proven-gone';

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
  await mutateStore(st => retireRenamedDoc(st, from, to));
  console.log(
    '[SmartNoteAI.store]',
    `renamed: ${from.split('/').pop()} → ${to.split('/').pop()} ` +
      '(sync mode, agents and lock followed; ghost entry removed)',
  );
};

// Startup sweep of OUR stale temp files in the plugin's private dir —
// the "29 MB install" diagnosis (2026-07-19). The batch upload writes
// batch-upload-<ts>.jsonl (8-18 MB each!) and deletes it in a `finally`;
// a process death mid-upload orphans it FOREVER (timestamped name, never
// reused, no sweep anywhere). Same for the sp-scratch/sp-doc render PNGs
// on exception paths. This sweep:
//   • touches ONLY our own name patterns, nothing else in the dir;
//   • only when the embedded timestamp is > 1 h old (an upload lasts
//     seconds — nothing in flight can be that old);
//   • logs a count + MB total, so the first launch doubles as the size
//     diagnosis we cannot run over adb (internal storage, no root).

import {NativeModules} from 'react-native';
import {FileUtils, PluginManager} from 'sn-plugin-lib';

const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    listDir?: (p: string) => Promise<{
      success?: boolean;
      entries?: {name: string; isDir: boolean; size?: number}[];
    }>;
  };
};

const STALE_MS = 60 * 60 * 1000; // 1 h

// Our temp-file patterns, each capturing its creation timestamp.
const PATTERNS = [
  /^batch-upload-(\d+)\.jsonl$/,
  /^sp-scratch-(\d+)-\d+\.png$/,
  /^sp-doc-(\d+)-\d+\.png$/,
  // v0.88 (audit): the .mark composite scratch was never swept — a kill
  // mid-composite orphaned ~1 MB PNGs forever.
  /^sp-mark-(\d+)-\d+\.png$/,
];

// v0.88 (audit): atomic-write leftovers (`<file>.tmp-write`, kept "for
// diagnosis" when a write throws — disk full, kill) also accumulate. No
// timestamp in the name: swept when present during a pass, they are by
// definition older than the current boot's writes (writes rename or fail
// within milliseconds).
const isTmpWrite = (name: string): boolean => name.endsWith('.tmp-write');

const staleTs = (name: string, now: number): boolean => {
  for (const re of PATTERNS) {
    const m = re.exec(name);
    if (m !== null) {
      const ts = Number(m[1]);
      return Number.isFinite(ts) && now - ts > STALE_MS;
    }
  }
  return false;
};

// Fire-and-forget at startup (index.js). Never throws.
export const sweepTempFiles = async (): Promise<void> => {
  try {
    let dir: string | null = null;
    for (let i = 0; i < 3 && dir === null; i++) {
      const d = await (
        PluginManager as {getPluginDirPath: () => Promise<unknown>}
      )
        .getPluginDirPath()
        .catch(() => null);
      dir = typeof d === 'string' && d.length > 0 ? d : null;
    }
    if (dir === null) {
      return; // no dir, no sweep — never guess a path to delete in
    }
    const ls = await SmartNoteAiOverlay?.listDir?.(dir);
    if (ls?.success !== true) {
      return;
    }
    const now = Date.now();
    let count = 0;
    let bytes = 0;
    for (const e of ls.entries ?? []) {
      if (e.isDir || (!staleTs(e.name, now) && !isTmpWrite(e.name))) {
        continue;
      }
      try {
        await (
          FileUtils as {deleteFile: (p: string) => Promise<boolean>}
        ).deleteFile(`${dir}/${e.name}`);
        count++;
        bytes += typeof e.size === 'number' ? e.size : 0;
      } catch {
        // best-effort; retried at the next launch
      }
    }
    if (count > 0) {
      console.log(
        '[SmartNoteAI.janitor]',
        `${count} stale temp file(s) deleted — ${
          Math.round((bytes / (1024 * 1024)) * 10) / 10
        } MB reclaimed (orphaned by interrupted uploads/renders)`,
      );
    } else {
      console.log('[SmartNoteAI.janitor]', 'no stale temp files');
    }
  } catch (e) {
    console.warn('[SmartNoteAI.janitor]', `sweep failed: ${String(e)}`);
  }
};

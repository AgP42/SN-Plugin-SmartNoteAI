// Native file read glue. sn-plugin-lib exposes read via
// fetch('file://…'). Write goes through the native module
// (SmartNoteAiOverlay.writeFileBase64), used by settings.ts.
// Kept out of the CORE so the pure modules never import this.
import {utf8FromBytes, utf8ToBase64} from '../core/util/base64';

// Fixed device paths. Manta / current-gen Supernote → /storage/emulated
// /0/MyStyle. (A5X gen-1 uses a different root; handled when we target
// it.) The config dir tracks the plugin name (SmartNoteAI).
export const CONFIG_DIR =
  '/storage/emulated/0/MyStyle/Plugins/SmartNoteAI';
export const KEY_FILE_PATH = `${CONFIG_DIR}/mistral-key.txt`;

const decodeAscii = (bytes: Uint8Array): string => {
  // Strip a UTF-8 BOM if present (files synced from desktop often have
  // one — it corrupted the first key otherwise).
  let start = 0;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    start = 3;
  }
  // Config values (key, model id, integer) are ASCII — a byte-wise
  // decode is sufficient and avoids a TextDecoder polyfill dependency.
  let out = '';
  for (let i = start; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
};

export const readTextFile = async (path: string): Promise<string | null> => {
  try {
    const res = await fetch(`file://${path}`);
    if (!res.ok) {
      return null;
    }
    const buf = await res.arrayBuffer();
    return decodeAscii(new Uint8Array(buf));
  } catch {
    return null;
  }
};

// Native UTF-8 IO (perf audit 2026-07-20): the bridge marshals Java
// strings natively, so readFileUtf8/writeFileUtf8 skip the per-character
// JS codec loops entirely — every shard at startup, settings, jobs. The
// JS decode/encode below stays as the fallback (and what unit tests pin).
type NativeFsModule = {
  readFileUtf8?: (p: string) => Promise<{success?: boolean; data?: string; code?: string}>;
  writeFileUtf8?: (p: string, content: string) => Promise<{success?: boolean}>;
  listDir?: (
    p: string,
  ) => Promise<{
    success?: boolean;
    entries?: Array<{name: string; isDir: boolean; size: number}>;
  }>;
  listStorageVolumes?: () => Promise<{success?: boolean; roots?: string[]}>;
};
const nativeFs = (): NativeFsModule | null => {
  try {
    const {NativeModules} = require('react-native');
    return (NativeModules?.SmartNoteAiOverlay as NativeFsModule) ?? null;
  } catch {
    return null;
  }
};

// UTF-8 variant — for settings.json, whose persona may hold accents or
// emoji that the ASCII decode above would mangle.
// v0.88 (audit): NOT_FOUND vs read-error, distinguishable — a genuinely
// deleted shard must be DROPPED from the index, while a transient IO error
// keeps it referenced for retry. Only the native module reports the code;
// without it we conservatively report notFound=false.
export const readTextFileUtf8Ex = async (
  path: string,
): Promise<{data: string | null; notFound: boolean}> => {
  const mod = nativeFs();
  if (mod?.readFileUtf8 !== undefined) {
    try {
      const r = await mod.readFileUtf8(path);
      if (r?.success === true && typeof r.data === 'string') {
        return {data: r.data, notFound: false};
      }
      if (r?.code === 'NOT_FOUND') {
        return {data: null, notFound: true};
      }
    } catch {
      // fall through to the generic reader
    }
  }
  return {data: await readTextFileUtf8(path), notFound: false};
};

export const readTextFileUtf8 = async (
  path: string,
): Promise<string | null> => {
  const mod = nativeFs();
  if (mod?.readFileUtf8 !== undefined) {
    try {
      const r = await mod.readFileUtf8(path);
      if (r?.success === true && typeof r.data === 'string') {
        return r.data;
      }
      if (r?.code === 'NOT_FOUND') {
        return null;
      }
      // READ_FAILED etc.: fall through to the fetch path below — same
      // best-effort contract as before.
    } catch {
      // fall through
    }
  }
  try {
    const res = await fetch(`file://${path}`);
    if (!res.ok) {
      return null;
    }
    const buf = await res.arrayBuffer();
    return utf8FromBytes(new Uint8Array(buf));
  } catch {
    return null;
  }
};

// Atomic UTF-8 write (tmp + rename, native). Returns false when the
// native method is unavailable or refused — callers keep their existing
// base64 write as the fallback.
export const writeTextFileUtf8 = async (
  path: string,
  content: string,
): Promise<boolean> => {
  const mod = nativeFs();
  if (mod?.writeFileUtf8 === undefined) {
    return false;
  }
  try {
    const r = await mod.writeFileUtf8(path, content);
    return r?.success === true;
  } catch {
    return false;
  }
};

// Native directory listing (moved here from the deleted batch pipeline —
// it was never batch-specific). [] on any failure or an old plugin binary.
export const listDirNative = async (
  path: string,
  // size: native listDir has always reported it (tmpJanitor relies on it);
  // surfaced in the type since v0.88.3 for the append-only change gate.
): Promise<Array<{name: string; isDir: boolean; size?: number}>> => {
  try {
    const r = await nativeFs()?.listDir?.(path);
    return r?.success && Array.isArray(r.entries) ? r.entries : [];
  } catch {
    return [];
  }
};

// External volume roots (SD card…), via the native module's Android APIs —
// the runtime /storage listing does NOT show mounted cards from PluginHost
// (device-verified 2026-07-18). [] when none or on an old plugin binary.
export const listStorageVolumesNative = async (): Promise<string[]> => {
  try {
    const r = await nativeFs()?.listStorageVolumes?.();
    return r?.success && Array.isArray(r.roots)
      ? r.roots.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
};

// The one text-write entry point for callers: native UTF-8 first, JS
// base64 encode + writeFileBase64 as fallback (tests, refused write).
// Both paths are atomic (tmp + rename in Kotlin).
export const writeTextAtomic = async (
  path: string,
  content: string,
): Promise<boolean> => {
  if (await writeTextFileUtf8(path, content)) {
    return true;
  }
  try {
    const mod = nativeFs() as {
      writeFileBase64?: (p: string, b64: string) => Promise<{success?: boolean}>;
    } | null;
    if (mod?.writeFileBase64 === undefined) {
      return false;
    }
    const r = await mod.writeFileBase64(path, utf8ToBase64(content));
    return r?.success === true;
  } catch {
    return false;
  }
};

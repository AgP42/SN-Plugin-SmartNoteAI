// Encrypted-at-rest API key storage (v0.20.1). The key lives in the
// plugin's PRIVATE dir (never MyStyle → never cloud-synced), XORed with
// a PBKDF2 keystream derived from a random device-local pepper — see
// src/core/config/keystream.ts for the exact (and honest) threat model.
//
// Soft migration: if no stored key exists but the legacy
// MyStyle/…/mistral-key.txt does, its key is imported, encrypted and
// stored; the caller can then offer to delete the legacy file.

import {NativeModules} from 'react-native';
import {FileUtils, PluginManager} from 'sn-plugin-lib';
import {readTextFileUtf8, KEY_FILE_PATH, readTextFile} from './fs';
import {parseKeyFile} from '../core/config/keyFile';
import {
  xorBytes,
  parseSecretFile,
  PBKDF2_ITERATIONS,
  type SecretFile,
} from '../core/config/keystream';
import {
  base64ToBytes,
  bytesToBase64,
  utf8FromBytes,
  utf8ToBase64,
} from '../core/util/base64';

type CryptoResult = {success?: boolean; bytesB64?: string; message?: string};
const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    writeFileBase64: (p: string, b64: string) => Promise<{success?: boolean}>;
    cryptoRandomBytes: (len: number) => Promise<CryptoResult>;
    cryptoPbkdf2Sha256: (
      passwordUtf8B64: string,
      saltB64: string,
      iterations: number,
      keyLengthBytes: number,
    ) => Promise<CryptoResult>;
  };
};

let dirP: Promise<string> | null = null;
const secretsDir = (): Promise<string> => {
  if (dirP === null) {
    dirP = (async () => {
      // RETRY, then FAIL — never the old /sdcard fallback (audit
      // 2026-07-19 B6): it wrote pepper AND encrypted key side by side
      // into a shared, MTP-visible volume, defeating the encryption's
      // threat model. A failure is not cached: the next call retries.
      for (let i = 0; i < 3; i++) {
        const d = await (
          PluginManager as {getPluginDirPath: () => Promise<unknown>}
        )
          .getPluginDirPath()
          .catch(() => null);
        if (typeof d === 'string' && d.length > 0) {
          cleanSdcardLeftovers(); // fire-and-forget, see below
          return `${d}/secrets`;
        }
      }
      dirP = null; // retry on the next call
      throw new Error('plugin dir unavailable — secret store unreachable');
    })();
    dirP.catch(() => {
      dirP = null;
    });
  }
  return dirP;
};

// Sessions that ran the old fallback may have left pepper.txt/key.json
// in /sdcard/secrets — visible over MTP. Best-effort removal, once per
// session, as soon as the real dir resolves.
let sdcardCleaned = false;
const cleanSdcardLeftovers = (): void => {
  if (sdcardCleaned) {
    return;
  }
  sdcardCleaned = true;
  (async () => {
    for (const f of ['/sdcard/secrets/key.json', '/sdcard/secrets/pepper.txt']) {
      const del = await (
        FileUtils as {deleteFile?: (p: string) => Promise<boolean>}
      )
        .deleteFile?.(f)
        .catch(() => false);
      if (del === true) {
        console.warn('[SmartNoteAI.key]', `removed old fallback secret: ${f}`);
      }
    }
  })().catch(() => {});
};

const writeText = async (path: string, text: string): Promise<boolean> => {
  try {
    const dir = path.slice(0, path.lastIndexOf('/'));
    try {
      await (FileUtils as {makeDir?: (p: string) => Promise<unknown>}).makeDir?.(
        dir,
      );
    } catch {
      // best-effort
    }
    const r = await SmartNoteAiOverlay?.writeFileBase64(
      path,
      utf8ToBase64(text),
    );
    return !!r?.success;
  } catch {
    return false;
  }
};

// The pepper: 32 random bytes, created once, device-local.
const getPepperB64 = async (): Promise<string | null> => {
  const dir = await secretsDir();
  const path = `${dir}/pepper.txt`;
  const existing = await readTextFileUtf8(path);
  if (existing !== null && existing.trim().length > 0) {
    return existing.trim();
  }
  const r = await SmartNoteAiOverlay?.cryptoRandomBytes(32);
  if (!r?.success || !r.bytesB64) {
    return null;
  }
  return (await writeText(path, r.bytesB64)) ? r.bytesB64 : null;
};

const keystreamFor = async (
  saltB64: string,
  length: number,
): Promise<Uint8Array | null> => {
  const pepper = await getPepperB64();
  if (pepper === null) {
    return null;
  }
  const r = await SmartNoteAiOverlay?.cryptoPbkdf2Sha256(
    pepper,
    saltB64,
    PBKDF2_ITERATIONS,
    Math.max(32, length),
  );
  return r?.success && r.bytesB64 ? base64ToBytes(r.bytesB64) : null;
};

export const setApiKey = async (key: string): Promise<boolean> => {
  try {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      return false;
    }
    const saltR = await SmartNoteAiOverlay?.cryptoRandomBytes(16);
    if (!saltR?.success || !saltR.bytesB64) {
      return false;
    }
    const keyBytes = base64ToBytes(utf8ToBase64(trimmed));
    const stream = await keystreamFor(saltR.bytesB64, keyBytes.length);
    if (stream === null) {
      return false;
    }
    const secret: SecretFile = {
      v: 1,
      saltB64: saltR.bytesB64,
      dataB64: bytesToBase64(xorBytes(keyBytes, stream)),
    };
    const dir = await secretsDir();
    return writeText(`${dir}/key.json`, JSON.stringify(secret));
  } catch {
    return false; // secrets dir unreachable (B6) — never /sdcard
  }
};

const readStoredKey = async (): Promise<string | null> => {
  const dir = await secretsDir();
  const secret = parseSecretFile(await readTextFileUtf8(`${dir}/key.json`));
  if (secret === null) {
    return null;
  }
  const data = base64ToBytes(secret.dataB64);
  const stream = await keystreamFor(secret.saltB64, data.length);
  if (stream === null) {
    return null;
  }
  const key = utf8FromBytes(xorBytes(data, stream)).trim();
  return key.length > 0 ? key : null;
};

export type ApiKeyState = {
  key: string | null;
  // The legacy MyStyle key file still exists (offer to delete it —
  // MyStyle is cloud-synced, the whole point of the migration).
  legacyFilePresent: boolean;
  // This call performed the txt → encrypted import.
  migrated: boolean;
};

export const getApiKey = async (): Promise<ApiKeyState> => {
  // An unreachable secrets dir must degrade to "no key" (the UI's
  // recoverable state), not reject every caller (B6).
  const stored = await readStoredKey().catch(() => null);
  const legacyText = await readTextFile(KEY_FILE_PATH);
  const legacyFilePresent = legacyText !== null;
  if (stored !== null) {
    return {key: stored, legacyFilePresent, migrated: false};
  }
  // Soft migration path.
  if (legacyText !== null) {
    const parsed = parseKeyFile(legacyText);
    if (parsed.ok) {
      const ok = await setApiKey(parsed.apiKey);
      console.log('[SmartNoteAI.key]', `migrated legacy key file: ${ok}`);
      return {key: parsed.apiKey, legacyFilePresent: true, migrated: ok};
    }
  }
  return {key: null, legacyFilePresent, migrated: false};
};

// "Delete key" (config): remove the encrypted key file. The pepper stays
// (it protects nothing once the key is gone, and a future key reuses it).
export const deleteApiKey = async (): Promise<boolean> => {
  try {
    const dir = await secretsDir();
    const path = `${dir}/key.json`;
    const del = await (
      FileUtils as {deleteFile?: (p: string) => Promise<boolean>}
    ).deleteFile?.(path);
    if (del === true) {
      return true;
    }
    // No delete primitive on some firmwares: overwriting with an empty
    // object is equivalent (parseSecretFile rejects it → no key).
    return writeText(path, '{}');
  } catch {
    return false;
  }
};

export const deleteLegacyKeyFile = async (): Promise<boolean> => {
  try {
    return (
      (await (
        FileUtils as {deleteFile: (p: string) => Promise<boolean>}
      ).deleteFile(KEY_FILE_PATH)) === true
    );
  } catch {
    return false;
  }
};

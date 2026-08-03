// ConversationStore (v0.21, SPEC §2.5): persist conversations so a
// close/crash loses nothing and any past discussion can be resumed.
// Thanks to the cooling mechanic a finished conversation is 100% text
// and self-contained — persisting it is just serialising turns[].
//
// Layout (plugin PRIVATE dir, never MyStyle):
//   conversations/index.json   — id → {title, noteName, updatedAt} (the
//                                list the Historique sheet shows; avoids
//                                needing a native directory listing)
//   conversations/<id>.json    — full turns

import {NativeModules} from 'react-native';
import {FileUtils, PluginManager} from 'sn-plugin-lib';
import {readTextFileUtf8} from './fs';
import {writeTextAtomic} from './fs';
import {makeWriteQueue} from '../core/util/writeQueue';
import type {ChatTurn} from '../core/model/types';

const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    writeFileBase64: (p: string, b64: string) => Promise<{success?: boolean}>;
    listDir?: (p: string) => Promise<{
      success?: boolean;
      entries?: {name: string; isDir: boolean}[];
    }>;
  };
};

export const RETENTION_MAX = 50;
export const RETENTION_DAYS = 90;

export type ConvMeta = {
  id: string;
  title: string;
  noteName: string;
  notePath: string;
  updatedAt: number;
  // v0.55: the AI agent this conversation talks to (undefined = standard
  // Chat). Kept in the INDEX so the history sheet can tag rows without
  // loading every conversation; a deleted agent's conversations keep the
  // id and reopen as standard Chat.
  agentId?: string;
};

export type SavedConversation = ConvMeta & {
  createdAt: number;
  turns: ChatTurn[];
  // v0.54 "Add to CHAT": pages picked from a library search. sent=true
  // once their block went out with a message (they stay listed for the
  // whole conversation). Absent on pre-v0.54 conversations.
  pendingCtx?: {path: string; page: number; sent?: boolean}[];
  // v0.81 (user): lasso images are persistent context — base64 PNGs that
  // ride with every message until the user removes their chip. Stored with
  // the conversation (a Resume restores them) and dropped when the
  // conversation is deleted, like the rest of it.
  ctxImages?: {id: string; image: string}[];
};

let dirP: Promise<string> | null = null;
const convDir = (): Promise<string> => {
  if (dirP === null) {
    dirP = (async () => {
      // RETRY, then FAIL — never the old cached /sdcard fallback (audit
      // 2026-07-19 B6): it orphaned the whole history in a shared,
      // MTP-visible volume for the rest of the session. A failure is
      // NOT cached (dirP reset below): the next call retries.
      for (let i = 0; i < 3; i++) {
        const d = await (
          PluginManager as {getPluginDirPath: () => Promise<unknown>}
        )
          .getPluginDirPath()
          .catch(() => null);
        if (typeof d === 'string' && d.length > 0) {
          return `${d}/conversations`;
        }
      }
      dirP = null; // retry on the next call
      throw new Error('plugin dir unavailable — conversations unreachable');
    })();
    dirP.catch(() => {
      dirP = null; // a rejected promise must not poison the cache
    });
  }
  return dirP;
};

// All index writes are read-modify-write: serialize them (audit
// 2026-07-19 B5 — two concurrent saves could resurrect a just-deleted
// entry or drop a just-saved one). Same pattern as the settings queue.
const queued = makeWriteQueue();

const writeJson = async (path: string, value: unknown): Promise<boolean> => {
  try {
    const dir = path.slice(0, path.lastIndexOf('/'));
    try {
      await (FileUtils as {makeDir?: (p: string) => Promise<unknown>}).makeDir?.(
        dir,
      );
    } catch {
      // best-effort
    }
    return await writeTextAtomic(path, JSON.stringify(value));
  } catch {
    return false;
  }
};

const parseMetaList = (text: string): ConvMeta[] | null => {
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) {
      return null;
    }
    return arr.filter(
      (m: ConvMeta) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.title === 'string' &&
        typeof m.updatedAt === 'number',
    );
  } catch {
    return null;
  }
};

// Absent → genuinely no history ([]). Unreadable/corrupt → try the .bak
// mirror; both dead → THROW so the next save cannot rewrite the index
// down to one entry (audit 2026-07-19 B5 — the whole history became
// unreachable). Same rules as the transcript-store index.
const readIndex = async (): Promise<ConvMeta[]> => {
  const dir = await convDir();
  const text = await readTextFileUtf8(`${dir}/index.json`);
  if (text !== null) {
    const list = parseMetaList(text);
    if (list !== null) {
      return list;
    }
  }
  const bakText = await readTextFileUtf8(`${dir}/index.json.bak`);
  if (bakText !== null) {
    const bak = parseMetaList(bakText);
    if (bak !== null) {
      if (text !== null) {
        console.warn(
          '[SmartNoteAI.conv]',
          `index corrupt — recovered ${bak.length} entry(ies) from .bak`,
        );
      }
      return bak;
    }
  }
  if (text === null && bakText === null) {
    // Both reads came back empty-handed — but "absent" and "transient
    // read failure" look identical (fs.ts cannot distinguish), and the
    // next save would commit a ONE-ENTRY index, orphaning every prior
    // conversation (re-audit 2026-07-19, B5 residual). Evidence probe:
    // the <id>.json files each carry their own meta — rebuild from them,
    // the same rule as the transcript store's B1 shard rebuild.
    let listed = false;
    let files: {name: string}[] = [];
    try {
      const ls = await SmartNoteAiOverlay?.listDir?.(dir);
      if (ls?.success === true) {
        listed = true;
        files = (ls.entries ?? []).filter(
          e =>
            !e.isDir &&
            e.name.endsWith('.json') &&
            !e.name.startsWith('index.json'),
        );
      }
    } catch {
      // listing threw: no evidence either way — a fresh install must
      // still be able to start a history.
    }
    if (!listed || files.length === 0) {
      return []; // genuinely fresh history
    }
    const rebuilt: ConvMeta[] = [];
    for (const f of files) {
      const t = await readTextFileUtf8(`${dir}/${f.name}`);
      if (t === null) {
        continue;
      }
      try {
        const c = JSON.parse(t) as SavedConversation;
        if (
          c &&
          typeof c.id === 'string' &&
          typeof c.title === 'string' &&
          typeof c.updatedAt === 'number'
        ) {
          rebuilt.push({
            id: c.id,
            title: c.title,
            noteName: typeof c.noteName === 'string' ? c.noteName : '',
            notePath: typeof c.notePath === 'string' ? c.notePath : '',
            updatedAt: c.updatedAt,
            ...(typeof c.agentId === 'string' && c.agentId.length > 0
              ? {agentId: c.agentId}
              : {}),
          });
        }
      } catch {
        // one unreadable conversation cannot vote
      }
    }
    if (rebuilt.length > 0) {
      console.warn(
        '[SmartNoteAI.conv]',
        `index lost — rebuilt from ${rebuilt.length}/${files.length} ` +
          'conversation file(s) on disk',
      );
      return rebuilt;
    }
    // Files EXIST but none could be read back: evidence of history this
    // session cannot see — don't let a save disown it.
    throw new Error(
      'conversation files exist but none is readable — not overwriting the index',
    );
  }
  throw new Error('conversation index unreadable — not overwriting it');
};

const writeIndex = async (list: ConvMeta[]): Promise<void> => {
  const dir = await convDir();
  if (await writeJson(`${dir}/index.json`, list)) {
    // Mirror only after the main write landed (keep the old good .bak
    // when the main write fails).
    await writeJson(`${dir}/index.json.bak`, list);
  } else {
    console.warn('[SmartNoteAI.conv]', 'index write refused');
  }
};

export const listConversations = async (): Promise<ConvMeta[]> =>
  (await readIndex()).sort((a, b) => b.updatedAt - a.updatedAt);

// Save (upsert) + retention purge: keep the newest RETENTION_MAX, drop
// anything older than RETENTION_DAYS. Purged files are best-effort
// deleted (a stale <id>.json without an index entry is unreachable and
// tiny — acceptable).
export const saveConversation = (conv: SavedConversation): Promise<void> =>
  queued(() => saveConversationInner(conv));

const saveConversationInner = async (
  conv: SavedConversation,
): Promise<void> => {
  const dir = await convDir();
  await writeJson(`${dir}/${conv.id}.json`, conv);
  let index = (await readIndex()).filter(m => m.id !== conv.id);
  index.push({
    id: conv.id,
    title: conv.title,
    noteName: conv.noteName,
    notePath: conv.notePath,
    updatedAt: conv.updatedAt,
    ...(conv.agentId !== undefined ? {agentId: conv.agentId} : {}),
  });
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const keep = index
    .slice(0, RETENTION_MAX)
    .filter(m => m.updatedAt >= cutoff);
  for (const dropped of index.filter(m => !keep.includes(m))) {
    try {
      await (
        FileUtils as {deleteFile: (p: string) => Promise<boolean>}
      ).deleteFile(`${dir}/${dropped.id}.json`);
    } catch {
      // best-effort
    }
  }
  await writeIndex(keep);
};

export const loadConversation = async (
  id: string,
): Promise<SavedConversation | null> => {
  const dir = await convDir();
  const text = await readTextFileUtf8(`${dir}/${id}.json`);
  if (text === null) {
    return null;
  }
  try {
    const c = JSON.parse(text) as SavedConversation;
    if (
      c &&
      typeof c.id === 'string' &&
      Array.isArray(c.turns) &&
      c.turns.every(
        t =>
          t &&
          (t.role === 'user' || t.role === 'assistant') &&
          typeof t.text === 'string',
      )
    ) {
      // Sanitize the optional v0.54 pendingCtx (hand-edited/corrupt
      // entries must not crash the send flow).
      c.pendingCtx = Array.isArray(c.pendingCtx)
        ? c.pendingCtx.filter(
            r =>
              r &&
              typeof r.path === 'string' &&
              typeof r.page === 'number' &&
              r.page >= 0,
          )
        : undefined;
      if (typeof c.agentId !== 'string' || c.agentId.length === 0) {
        c.agentId = undefined;
      }
      // v0.81: sanitize the persisted lasso images (base64 PNGs).
      c.ctxImages = Array.isArray(c.ctxImages)
        ? c.ctxImages.filter(
            r =>
              r &&
              typeof r.id === 'string' &&
              typeof r.image === 'string' &&
              r.image.length > 0,
          )
        : undefined;
      return c;
    }
  } catch {
    // fall through
  }
  return null;
};

export const deleteConversation = (id: string): Promise<void> =>
  queued(async () => {
    const dir = await convDir();
    try {
      await (
        FileUtils as {deleteFile: (p: string) => Promise<boolean>}
      ).deleteFile(`${dir}/${id}.json`);
    } catch {
      // best-effort
    }
    await writeIndex((await readIndex()).filter(m => m.id !== id));
  });


// Auto-title: source note + the first words of the first user question.
export const titleFor = (noteName: string, turns: ChatTurn[]): string => {
  const first = turns.find(t => t.role === 'user')?.text ?? '';
  const head = first.split('\n')[0].slice(0, 40).trim();
  return noteName.length > 0 ? `${noteName} · ${head}` : head || 'Chat';
};

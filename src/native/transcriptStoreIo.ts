// File IO for the TranscriptStore — SHARDED since v0.56 (user decision
// 2026-07-19: no more monolithic JSON, no more size policy):
//
//   <pluginDir>/transcripts/index.json       — tiny commit point: the
//       shard list. Written on
//       every persist, mirrored to index.json.bak.
//   <pluginDir>/transcripts/docs/<shard>.json — ONE file per document
//       ({v:2, path, doc}). Written only when the doc was TOUCHED
//       (core-side tracking via docOf/markDocTouched), deleted when the
//       doc left the store. writeFileBase64 is atomic (tmp+rename,
//       v0.44), so a shard is never torn; a corrupt shard costs ONE doc
//       (re-read later), never the library.
//
// The in-memory model is unchanged: ONE Store singleton, rebuilt from
// the shards at session load (parallel small reads instead of one giant
// parse), served to the same pure helpers. What changed is the WRITE
// granularity: a page upsert persists ~2 KB instead of re-serializing
// the whole library through the bridge (the 4.5 MB era did that twice
// per persist — and silently EVICTED paid docs at the cap; see the
// v0.55.1/0.55.2 handover entries for the incident).
//
// Legacy migration: a v1 store.json (+ .bak recovery dance) is read
// once, split into shards, and the old files are deleted only AFTER the
// first successful index write. NEVER MyStyle (cloud-synced).
//
// Crash ordering: shards first, index last. A crash between the two
// leaves either an orphan shard (invisible, rewritten on the next touch)
// or a fresher shard than the index expects (harmless: the shard is
// self-consistent and simply newer). The index is the commit point.

import {NativeModules} from 'react-native';
import {FileUtils, PluginManager} from 'sn-plugin-lib';
import {readTextFileUtf8, readTextFileUtf8Ex} from './fs';
import {writeTextAtomic, CONFIG_DIR} from './fs';
import {
  type Store,
  type DocEntry,
  emptyStore,
  sanitizeDocEntry,
  markDocTouched,
  takeTouchedDocs,
  removeDoc,
  clearDocRespectingLocks,
  sweepEphemeralPages,
} from '../core/store/transcriptStore';
import {readSettings} from './settings';
import {effectiveMode} from '../core/store/autoEngine';

const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    writeFileBase64: (
      path: string,
      b64: string,
    ) => Promise<{success?: boolean}>;
    listDir?: (p: string) => Promise<{
      success?: boolean;
      entries?: Array<{name: string; isDir: boolean; size: number}>;
    }>;
  };
};

// Pure runaway backstop (a corrupted loop writing garbage) — NOT a data
// policy: ~10 years of heavy use away, paid transcriptions are never
// evicted in normal life (user decision 2026-07-19, after the 4.5 MB
// cap silently destroyed paid docs — the "120 to sync" incident).
// (MAX_STORE_BYTES and auto-eviction removed in Phase A — decision F.)

// v0.58: the transcript CONTENT schema, carried by the store's own
// index.json. The "fresh start on incompatible transcripts" decision
// used to hang on settings.json's schemaV (App.tsx) — so a transiently
// unreadable settings file wiped the whole paid store (the 2026-07-18
// incident, audit C3). The store now versions itself: wipe ONLY when an
// index explicitly carries a DIFFERENT contentV. An index without the
// field (pre-v0.58) is adopted as current — its content is already
// schema-32 (the last content break was v0.32).
const STORE_CONTENT_V = 32;

// v0.55 agent pinning (HARD, user decision): docs referenced by an AI
// agent are never LRU-evicted (only relevant on the runaway backstop
// path now). The refs are pushed by index.js at startup — BEFORE the
// scheduler starts —, App.load and ChatAgentsScreen on edit; this module
// cannot read settings itself without an import cycle.
// (The agent-pin subsystem was deleted in Lot 1: it existed solely to
// shield agent docs from auto-eviction, which decision F removed.)
// (isAgentPinned removed with auto-eviction — pins now only matter to
// future free-space UI; setPinnedDocRefs keeps recording them.)

let dirP: Promise<string | null> | null = null;
const storeDir = (): Promise<string | null> => {
  if (dirP === null) {
    dirP = (async () => {
      // RETRY 3× (self-audit M2 2026-07-19): a transient boot failure
      // used to pin the whole session onto /sdcard on the first try.
      // The final result — fallback included — IS cached: load and
      // every persist of a session must use the SAME dir (a cross-dir
      // split would let an empty fallback load overwrite the real
      // store once the path resolves again).
      for (let i = 0; i < 3; i++) {
        const d = await (
          PluginManager as {getPluginDirPath: () => Promise<unknown>}
        )
          .getPluginDirPath()
          .catch(() => null);
        if (typeof d === 'string' && d.length > 0) {
          return `${d}/transcripts`;
        }
      }
      // v0.88 (audit, M2 rule — same as settings/secureKey): NEVER write the
      // store to shared /sdcard. Paid data persisted there was stranded (the
      // next session, with the real dir resolved, never saw it) and sat
      // MTP-visible. null = memory-only session; persistOnce skips writes.
      console.warn(
        '[SmartNoteAI.store]',
        'getPluginDirPath failed 3× — store is MEMORY-ONLY this session (no /sdcard writes)',
      );
      return null;
    })();
  }
  return dirP;
};

// ---- shard naming ----
// Stable, filename-safe, human-greppable: fnv1a32(path) + sanitized
// basename. A collision would need same hash AND same basename — and
// the path INSIDE the shard is verified at read time anyway.
/* eslint-disable no-bitwise -- fnv1a is a bitwise hash by definition */
const fnv1a32 = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};
/* eslint-enable no-bitwise */
export const shardNameFor = (path: string): string => {
  const base = (path.split('/').pop() ?? 'doc')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 40);
  return `${fnv1a32(path)}-${base}.json`;
};

type ShardFile = {v: 2; path: string; doc: DocEntry};

type IndexFile = {
  v: 2;
  // Transcript content schema (v0.58) — see STORE_CONTENT_V above.
  contentV?: number;
  shards: Record<string, string>; // doc path → shard file name
};

const parseIndex = (text: string | null): IndexFile | null => {
  if (text === null || text.trim().length === 0) {
    return null;
  }
  try {
    const obj = JSON.parse(text) as IndexFile;
    if (!obj || obj.v !== 2 || typeof obj.shards !== 'object' || !obj.shards) {
      return null;
    }
    const shards: Record<string, string> = {};
    for (const [p, f] of Object.entries(obj.shards)) {
      if (typeof f === 'string' && f.length > 0) {
        shards[p] = f;
      }
    }
    return {
      v: 2,
      contentV: typeof obj.contentV === 'number' ? obj.contentV : undefined,
      shards,
    };
  } catch {
    return null;
  }
};

let storeP: Promise<Store> | null = null;
const listeners = new Set<() => void>();
// Doc paths as of the last successful persist/load — the deletion diff.
let lastPaths = new Set<string>();
// Approx serialized bytes per shard (for the runaway backstop).
const shardBytes = new Map<string, number>();
// Legacy v1 files to delete once the first index write succeeds.
// (legacyToDelete plumbing removed in Phase C — no v1 migration remains.)
// Shards the index references but whose file could not be READ this load
// (transient IO, torn copy…): path → shard file name. They stay in every
// index this session writes, so the doc is retried at the next load
// instead of silently expelled — an expelled doc is a PAID re-read
// (audit 2026-07-19 B2).
const unloadedShards = new Map<string, string>();
// "Read failure ≠ absence" (audit 2026-07-19 B1/B4): when the on-disk
// truth could not be established at load (index+bak unreadable with
// shards present but unlistable, or a legacy store present but
// unparseable), committing an index would DISOWN everything on disk.
// While this flag is set, persists still write shards (paid data lands)
// but never the index — the next session retries the full load.
let degradedLoad = false;
// Full review 2026-08-02 #5: the paid pipeline must know a memory-only
// session for what it is — reads would re-bill the whole library and the
// results could not even be saved.
export const isDegradedLoad = (): boolean => degradedLoad;
// Phase C: a doc whose shard was unreadable at load is READ-ONLY for the
// session — paid reads on it would not persist, so the pipeline skips it.
export const isDocReadOnly = (path: string): boolean =>
  unloadedShards.has(path);
// Round 10 #0: THE one question every paid entry point must ask before
// spending: will the store keep this result? False in a degraded session
// (nothing is written at all) and for a doc whose shard is unreadable.
export const canPersistDoc = (path: string): boolean =>
  !degradedLoad && !unloadedShards.has(path);
// ONE copy of the refusal message (round-12 #6 dedupe, done in Lot 1).
export const STORAGE_UNAVAILABLE_MSG =
  '⚠ Storage unavailable for this document — restart the plugin and retry.';

const deleteFile = async (path: string): Promise<void> => {
  try {
    await (
      FileUtils as {deleteFile: (p: string) => Promise<boolean>}
    ).deleteFile(path);
  } catch {
    // best-effort
  }
};

// The in-memory store is a singleton shared by the panel and the config
// page (same JS runtime). All mutations go through mutateStore below so
// persistence and change notifications can't be forgotten.
export const loadStore = (): Promise<Store> => {
  if (storeP === null) {
    storeP = (async () => {
      const dir = await storeDir();
      if (dir === null) {
        degradedLoad = true; // memory-only session: never let evict/persist run
        return emptyStore();
      }
      // Index first (with .bak recovery: a transient read error is
      // indistinguishable from "absent"; trust the mirror before
      // concluding "empty" — same D2/D3 dance as the legacy store).
      let index = parseIndex(await readTextFileUtf8(`${dir}/index.json`));
      if (index === null || Object.keys(index.shards).length === 0) {
        const bak = parseIndex(
          await readTextFileUtf8(`${dir}/index.json.bak`),
        );
        if (bak !== null && Object.keys(bak.shards).length > 0) {
          console.warn(
            '[SmartNoteAI.store]',
            `index empty/unreadable — recovered ${
              Object.keys(bak.shards).length
            } shard ref(s) from index.json.bak`,
          );
          index = bak;
        }
      }

      // Index AND mirror dead (or empty) while docs/ may hold paid
      // shards: rebuild the index FROM the shards — each one carries its
      // own path (audit 2026-07-19 B1: a transient double read failure
      // used to start an empty session whose first persist committed an
      // empty index, orphaning the whole library).
      if (index === null || Object.keys(index.shards).length === 0) {
        try {
          const ls = await SmartNoteAiOverlay?.listDir?.(`${dir}/docs`);
          const files = (ls?.entries ?? []).filter(
            e => !e.isDir && e.name.endsWith('.json'),
          );
          if (ls?.success && files.length > 0) {
            const shards: Record<string, string> = {};
            for (const f of files) {
              const text = await readTextFileUtf8(`${dir}/docs/${f.name}`);
              try {
                const shard =
                  text !== null ? (JSON.parse(text) as ShardFile) : null;
                if (
                  shard !== null &&
                  shard.v === 2 &&
                  typeof shard.path === 'string' &&
                  shard.path.length > 0
                ) {
                  shards[shard.path] = f.name;
                }
              } catch {
                // an unreadable file cannot vote — skipped
              }
            }
            if (Object.keys(shards).length > 0) {
              console.warn(
                '[SmartNoteAI.store]',
                `index lost — REBUILT from ${
                  Object.keys(shards).length
                }/${files.length} shard file(s) on disk`,
              );
              index = {v: 2, contentV: undefined, shards};
            } else {
              // Shard files EXIST but none could be read back: evidence
              // of data this session cannot see — don't commit an index
              // that would disown it (B1). A failed/absent listing is
              // NOT degraded (a fresh install has no docs/ dir at all —
              // treating it as degraded would never commit anything).
              degradedLoad = true;
              console.warn(
                '[SmartNoteAI.store]',
                `${files.length} shard file(s) on disk, none readable — ` +
                  'DEGRADED session (index commits disabled)',
              );
            }
          }
        } catch {
          // Listing threw: no evidence either way — proceed as fresh.
        }
      }

      // Content-schema fresh start (v0.58) — decided HERE, from the
      // store's own index, never from another file's health.
      if (
        index !== null &&
        index.contentV !== undefined &&
        index.contentV !== STORE_CONTENT_V
      ) {
        // Phase C (owner decision G): the plugin was never published, the
        // format is frozen at 32, so a foreign contentV can only mean a
        // future version's store or corruption. NEVER wipe paid data over
        // it: run memory-only (degraded), tell the user, touch nothing.
        console.warn(
          '[SmartNoteAI.store]',
          `content schema ${index.contentV} ≠ ${STORE_CONTENT_V} — ` +
            'UNKNOWN format: memory-only session, nothing touched',
        );
        degradedLoad = true;
        return emptyStore();
      }

      if (index !== null) {
        const store = emptyStore();
        const entries = Object.entries(index.shards);
        await Promise.all(
          entries.map(async ([path, file]) => {
            const rd = await readTextFileUtf8Ex(`${dir}/docs/${file}`);
            const text = rd.data;
            if (text === null) {
              if (rd.notFound) {
                // v0.88 (audit): the file is GONE for real (hand cleanup,
                // ghost ref) — keeping it referenced meant a warn-log and a
                // dead index entry at every boot forever. Dropped.
                console.warn(
                  '[SmartNoteAI.store]',
                  `shard missing on disk — reference dropped: ${file}`,
                );
                return;
              }
              // Keep the doc REFERENCED (B2): a transient read failure
              // must not expel it from the next index — expelled means a
              // PAID re-read. Retried at the next session load.
              unloadedShards.set(path, file);
              console.warn(
                '[SmartNoteAI.store]',
                `shard unreadable (kept in index, retried next load): ${file}`,
              );
              return;
            }
            try {
              const shard = JSON.parse(text) as ShardFile;
              // The path inside the shard is authoritative (guards
              // against hash-collision or hand-copied files).
              const p = shard.v === 2 && shard.path === path ? path : null;
              const doc = p !== null ? sanitizeDocEntry(shard.doc) : null;
              if (p !== null && doc !== null) {
                store.docs[p] = doc;
                shardBytes.set(p, text.length);
              } else {
                // Deterministic rejection (collision guard) — dropping
                // the ref is correct; the file may belong to another
                // path that references it legitimately.
                console.warn(
                  '[SmartNoteAI.store]',
                  `shard rejected (path/schema mismatch): ${file}`,
                );
              }
            } catch {
              // Same rule as unreadable (B2): referenced, retried; a
              // later live read of the doc rewrites the shard and heals.
              unloadedShards.set(path, file);
              console.warn(
                '[SmartNoteAI.store]',
                `shard corrupt (kept in index, retried next load): ${file}`,
              );
            }
          }),
        );
        lastPaths = new Set(Object.keys(store.docs));
        console.log(
          '[SmartNoteAI.store]',
          `loaded: ${lastPaths.size} doc(s) from ${entries.length} shard(s)`,
        );
        // Full review 2026-08-02 #3: pages written by a consented OFF read
        // are wiped in that read's finally — unless the process was killed
        // mid-read. They carry the `eph` marker exactly for this moment:
        // purge them before anything can show or export them. Mode-aware
        // (v0.92.1): only docs CURRENTLY Off are purged; leftover markers
        // on other docs are defused, never destroyed.
        try {
          const st = await readSettings();
          const targets = st.autoTargets ?? {};
          const offPaths = new Set(
            Object.keys(store.docs).filter(
              p2 => effectiveMode(targets, p2) === 'off',
            ),
          );
          const r = sweepEphemeralPages(store, offPaths);
          if (r.purged > 0 || r.defused > 0) {
            console.warn(
              '[SmartNoteAI.store]',
              `boot sweep: ${r.purged} stranded OFF page(s) purged, ` +
                `${r.defused} stray marker(s) defused`,
            );
            schedulePersist();
          }
        } catch (e) {
          // Settings unreadable: DO NOTHING. Purging without knowing the
          // modes could destroy paid pages; the sweep re-runs next boot.
          console.warn(
            '[SmartNoteAI.store]',
            `boot sweep skipped (settings unreadable): ${String(e)}`,
          );
        }
        return store;
      }

      // Phase C (owner decision G, never published): the v1 store.json
      // migration is GONE. No index = an empty library — with one guard:
      // if an old store.json is somehow present, do not silently ignore
      // paid data; run degraded so nothing writes around it.
      const legacy = await readTextFileUtf8(`${dir}/store.json`);
      if (legacy !== null && legacy.trim().length > 0) {
        degradedLoad = true;
        console.warn(
          '[SmartNoteAI.store]',
          'pre-shard store.json found (unsupported since Phase C) — ' +
            'memory-only session; restore via the library backup instead',
        );
        return emptyStore();
      }
      console.log('[SmartNoteAI.store]', 'no index — empty library');
      const store = emptyStore();
      return store;
    })();
  }
  return storeP;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// C2 (audit 2026-07-19): persists used to be REENTRANT — the debounced
// timer fires persistNow un-awaited, so a concurrent flushStore() (or a
// second timer shot) could interleave with it: run A's deletion diff
// could remove a shard run B had just written, and both mutated
// lastPaths/takeTouchedDocs mid-flight. One persist at a time, strictly
// ordered; every caller (timer, flush, clear) joins the same chain.
let persistChain: Promise<void> = Promise.resolve();
const persistNow = (): Promise<void> => {
  const run = persistChain.then(persistOnce, persistOnce);
  persistChain = run.catch(() => {});
  return run;
};

const persistOnce = async (): Promise<void> => {
  // Audit 9 #0: 'memory-only, nothing touched' must mean the SHARDS too.
  // A degraded session (foreign contentV, pre-shard file, unreadable dir)
  // used to skip only the index commit while still rewriting shard files —
  // a rollback could overwrite a future version's paid shards with this
  // session's structural stubs.
  if (degradedLoad) {
    return;
  }
  const store = await loadStore();
  const dir = await storeDir();
  if (dir === null) {
    return; // memory-only session (M2): no /sdcard writes, ever
  }
  try {
    await (
      FileUtils as {makeDir?: (p: string) => Promise<unknown>}
    ).makeDir?.(dir);
    await (
      FileUtils as {makeDir?: (p: string) => Promise<unknown>}
    ).makeDir?.(`${dir}/docs`);
  } catch {
    // best-effort; the writes below report the real failure
  }

  const current = new Set(Object.keys(store.docs));

  // 1. Touched shards (only what actually changed since the last write).
  // A failed write is re-marked AND re-scheduled (audit 2026-07-19 B3:
  // without the schedule, the retry waited for an unrelated mutation);
  // a doc whose shard has NEVER landed on disk must also stay out of
  // the index this pass, or the index would reference a ghost file.
  let writeFailed = false;
  const neverWritten = new Set<string>();
  const touched = takeTouchedDocs().filter(p => current.has(p));
  for (const p of touched) {
    // Full review 2026-08-02 #1: this doc's on-disk shard could not be
    // read at load. Writing now would replace a full paid transcript with
    // this session's near-empty rebuild. Read + merge it here (the disk
    // may have healed); if it still cannot be read, REFUSE this write and
    // retry later — losing this session's few pages on restart is bounded,
    // destroying the shard is not.
    if (unloadedShards.has(p)) {
      // Phase C (owner decision B): the store REFUSES instead of repairing.
      // A doc whose shard could not be read at load is read-only for the
      // session — no write, no merge, the old index reference stays, and
      // the next boot retries the read. (The two generations of clever
      // merges each destroyed data in their own way.)
      console.warn(
        '[SmartNoteAI.store]',
        `write refused (unreadable shard, read-only this session): ${unloadedShards.get(p)}`,
      );
      neverWritten.add(p);
      continue;
    }
    const shard: ShardFile = {v: 2, path: p, doc: store.docs[p]};
    const json = JSON.stringify(shard);
    try {
      const okW = await writeTextAtomic(`${dir}/docs/${shardNameFor(p)}`, json);
      if (okW) {
        shardBytes.set(p, json.length);
        unloadedShards.delete(p); // healed: a fresh shard replaces it
      } else {
        console.warn(
          '[SmartNoteAI.store]',
          `shard write refused (will retry): ${shardNameFor(p)}`,
        );
        markDocTouched(p); // retry on the next persist
        writeFailed = true;
        if (!shardBytes.has(p)) {
          neverWritten.add(p);
        }
      }
    } catch (e) {
      console.warn(
        '[SmartNoteAI.store]',
        `shard write threw (will retry): ${(e as Error).message}`,
      );
      markDocTouched(p);
      writeFailed = true;
      if (!shardBytes.has(p)) {
        neverWritten.add(p);
      }
    }
  }
  if (writeFailed) {
    schedulePersist(); // B3: the retry must not wait for the next edit
  }

  // 2. Deletion diff: docs gone from the store lose their shard file.
  for (const p of [...lastPaths].filter(x => !current.has(x))) {
    await deleteFile(`${dir}/docs/${shardNameFor(p)}`);
    shardBytes.delete(p);
  }

  // 3. Index = the commit point (tiny), then its mirror. NOT in a
  // degraded session (B1/B4): when the on-disk truth could not be read
  // at load, committing an index from this session's memory would
  // disown it for good.
  if (degradedLoad) {
    console.warn(
      '[SmartNoteAI.store]',
      'degraded session — index commit skipped (shards written)',
    );
    return;
  }
  const indexShards: Record<string, string> = {};
  for (const [p, f] of unloadedShards) {
    // B2: unread docs stay referenced — INCLUDING when this session also
    // holds an in-memory doc for the path whose write was refused above
    // (full review #1: the old rule dropped the on-disk shard from the
    // index the moment the same session touched the doc).
    indexShards[p] = f;
  }
  for (const p of current) {
    if (!neverWritten.has(p)) {
      indexShards[p] = shardNameFor(p);
    }
  }
  const index: IndexFile = {
    v: 2,
    contentV: STORE_CONTENT_V,
    shards: indexShards,
  };
  try {
    const json = JSON.stringify(index);
    if (!(await writeTextAtomic(`${dir}/index.json`, json))) {
      console.warn('[SmartNoteAI.store]', 'index write refused');
      return; // keep lastPaths/legacy as-is; next persist retries
    }
    await writeTextAtomic(`${dir}/index.json.bak`, json).catch(() => {});
    lastPaths = current;
  } catch (e) {
    console.warn(
      '[SmartNoteAI.store]',
      `index write threw: ${(e as Error).message}`,
    );
    return;
  }

  // Phase A, owner decision F: the plugin NEVER evicts paid data on its
  // own. The old 200 MB "runaway backstop" was arbitrary (8000 pages of
  // text ≈ 20 MB) and destroyed locks and transcripts. What matters is the
  // DEVICE's free space, which the UI surfaces — the user makes room.
};


// Debounced persistence: a whole-note read upserts dozens of pages in a
// burst; one write at the end is enough. Money already spent is worth a
// short flush window (800 ms) after the last mutation.
const schedulePersist = (): void => {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow();
  }, 800);
};

// Force an immediate write — called after PAID bursts (a whole-note
// read, a batch collect): the 800 ms debounce window is small but a
// crash inside it would lose money already spent.
export const flushStore = async (): Promise<void> => {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistNow();
};

// Run a mutation against the loaded store, then persist + notify. The
// mutator may return EXACTLY false to signal "nothing changed" — the
// persist and the subscriber notification are then skipped (phase 4
// §2.3 dirty flag: sync paths used to notify every pass even when their
// docMetaEquals-style guards wrote nothing, feeding refresh loops).
// A void return keeps the historical behavior (assume changed).
export const mutateStore = async (
  fn: (store: Store) => void | boolean,
): Promise<void> => {
  const store = await loadStore();
  const changed = fn(store);
  if (changed === false) {
    return;
  }
  schedulePersist();
  for (const l of listeners) {
    try {
      l();
    } catch {
      // one bad subscriber must not break the others
    }
  }
};

// v0.79.16 (user): clear the local transcript of specific documents by hand
// (one open note, or every note currently set to Off). Returns how many docs
// were actually dropped. flushStore so the wipe survives an immediate close.
export const clearDocsTranscripts = async (
  paths: string[],
): Promise<{docs: number; keptLockedPages: number; skippedLockedDocs: number}> => {
  let docs = 0;
  let keptLockedPages = 0;
  let skippedLockedDocs = 0;
  let changed = false;
  await mutateStore(s => {
    for (const p of paths) {
      // Locks survive a clear (user decision 2026-08-03): a locked doc is
      // refused outright, locked pages are kept through a doc clear.
      const r = clearDocRespectingLocks(s, p);
      changed = changed || r.changed;
      if (r.skippedLockedDoc) {
        skippedLockedDocs++;
      } else {
        if (r.changed) {
          docs++;
        }
        keptLockedPages += r.keptLockedPages;
      }
    }
    return changed;
  });
  if (changed) {
    await flushStore();
  }
  return {docs, keptLockedPages, skippedLockedDocs};
};

// UI subscription (provenance chip re-render on store changes).
export const subscribeStore = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

// v0.76: MANUAL library backup (user decision 2026-07-21, after a plugin
// reinstall wiped the private transcript store and lost paid transcripts).
// The store lives in the plugin's private dir (gone on uninstall); this
// snapshots the WHOLE store to MyStyle — user storage that survives an
// uninstall — so it can be restored. Visible, hand-inspectable JSON.
export const LIBRARY_BACKUP_PATH = `${CONFIG_DIR}/smartnoteai-library-backup.json`;
// v0.95: FULL backup = a verbatim, file-by-file copy of the store directory
// (index + one shard per document) into MyStyle. Exact fidelity by
// construction — every field (locks, revs, markers) travels untouched, and
// no multi-megabyte string ever crosses the bridge (the one-JSON legacy
// export above serialized 8000 pages in a single ~25 MB string). This
// folder is THE migration source the post-simplification version imports.
export const LIBRARY_BACKUP_DIR = `${CONFIG_DIR}/smartnoteai-library-backup`;

export const exportLibraryFull = async (): Promise<
  {ok: true; docs: number; failed: number} | {ok: false; error: string}
> => {
  const dir = await storeDir();
  if (dir === null) {
    return {ok: false, error: 'store directory unavailable'};
  }
  // v0.95.1 (device report: 'could not write the backup index'): the SDK's
  // writeFile does NOT create parent directories — both levels must exist
  // before the first copy.
  try {
    const fu = FileUtils as {makeDir?: (p: string) => Promise<boolean>};
    await fu.makeDir?.(LIBRARY_BACKUP_DIR);
    await fu.makeDir?.(`${LIBRARY_BACKUP_DIR}/docs`);
  } catch (e) {
    console.warn('[SmartNoteAI.store]', `backup makeDir: ${String(e)}`);
  }
  await flushStore(); // everything in memory reaches the shards first
  const index = await readTextFileUtf8(`${dir}/index.json`);
  if (index === null || index.length === 0) {
    return {ok: false, error: 'index unreadable'};
  }
  const parsed = parseIndex(index);
  if (parsed === null) {
    return {ok: false, error: 'index unparsable'};
  }
  let docs = 0;
  let failed = 0;
  const landed: Record<string, string> = {};
  // Bounded pool (collecte 2026-08-03): the strictly sequential copy took
  // one native round-trip pair per doc — noticeable past ~150 docs. Four
  // in flight overlaps the bridge latency while keeping at most four
  // shards' text in memory at once (shards can be large).
  const entries = Object.entries(parsed.shards);
  let next = 0;
  const copyWorker = async (): Promise<void> => {
    for (;;) {
      const idx = next++;
      if (idx >= entries.length) {
        return;
      }
      const [path, file] = entries[idx];
      const text = await readTextFileUtf8(`${dir}/docs/${file}`);
      if (text === null || text.length === 0) {
        failed++; // unreadable shard: reported, never silently skipped
        continue;
      }
      if (await writeTextAtomic(`${LIBRARY_BACKUP_DIR}/docs/${file}`, text)) {
        docs++;
        landed[path] = file;
      } else {
        failed++;
      }
    }
  };
  await Promise.all(
    Array.from({length: Math.min(4, entries.length)}, copyWorker),
  );
  // The index goes LAST and lists ONLY what landed (pre-reinstall audit
  // #5: it used to copy the live index verbatim, ghosts included).
  const bakIndex = JSON.stringify({
    v: 2,
    contentV: parsed.contentV,
    shards: landed,
  });
  if (!(await writeTextAtomic(`${LIBRARY_BACKUP_DIR}/index.json`, bakIndex))) {
    return {ok: false, error: 'could not write the backup index'};
  }
  return {ok: true, docs, failed};
};

// (exportLibrary — the legacy one-JSON export — deleted in Lot 1: the
// file-by-file exportLibraryFull is the only backup writer since v0.95.)

// Restore = MERGE the backup's docs into the current store (a backed-up doc
// wins for its path), then persist all shards. A merge, not a wipe: it never
// destroys transcripts the current store already has that the backup lacks.
export const importLibrary = async (): Promise<
  | {ok: true; docs: number; skippedPages: number; unreadableDocs: number}
  | {ok: false; error: string}
> => {

  if (degradedLoad) {
    // Round 10 #1: with persistOnce refusing every write, a 'restored'
    // library would evaporate at the next restart while the UI claimed
    // success. Refuse honestly; Clear local data (which resets the store
    // files and this flag) is the documented recovery path.
    return {
      ok: false,
      error: 'storage is degraded this session — use "Clear local data" first, then restore',
    };
  }
  // Lot 1 (self-found): Restore still read the LEGACY one-JSON file while
  // Backup writes the shard DIRECTORY since v0.95 — the user's real backup
  // was invisible to Restore. Directory first; the legacy file stays as a
  // fallback for any old backup.
  const docsIn: Record<string, unknown> = {};
  // Pre-reinstall audit #1: a backup shard that cannot be read or parsed
  // is COUNTED and REPORTED — a restore must never claim clean success
  // over silently missing documents.
  let unreadableDocs = 0;
  const rawIndex = await readTextFileUtf8(`${LIBRARY_BACKUP_DIR}/index.json`);
  const bakIndex = parseIndex(rawIndex);
  if (rawIndex !== null && rawIndex.trim().length > 0 && bakIndex === null) {
    // Pre-reinstall audit #2: the directory backup EXISTS but its index is
    // damaged. Falling back to a months-old legacy file here silently
    // restored a stale snapshot as if it were the real backup.
    return {
      ok: false,
      error:
        'the backup folder exists but its index.json is unreadable — fix or re-create the backup (the legacy file was NOT used)',
    };
  }
  if (bakIndex !== null) {
    for (const [path, file] of Object.entries(bakIndex.shards)) {
      const t = await readTextFileUtf8(`${LIBRARY_BACKUP_DIR}/docs/${file}`);
      if (t === null || t.length === 0) {
        unreadableDocs++;
        continue;
      }
      try {
        const shard = JSON.parse(t) as {v?: number; path?: string; doc?: unknown};
        if (shard.v === 2 && shard.path === path && shard.doc !== undefined) {
          docsIn[path] = shard.doc;
        } else {
          unreadableDocs++;
        }
      } catch {
        unreadableDocs++;
      }
    }
  } else {
    const text = await readTextFileUtf8(LIBRARY_BACKUP_PATH);
    if (text === null || text.trim().length === 0) {
      return {
        ok: false,
        error: 'no backup found (neither the backup folder nor the legacy file)',
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {ok: false, error: 'the backup file is not valid JSON'};
    }
    const b = parsed as {docs?: unknown};
    if (b === null || typeof b !== 'object' || !b.docs || typeof b.docs !== 'object') {
      return {ok: false, error: 'not a library backup (no docs)'};
    }
    Object.assign(docsIn, b.docs as Record<string, unknown>);
  }
  // Audit 2026-07-30 C1: each restored doc must be sanitized (a hand-edited
  // backup injects arbitrary shapes) AND marked touched — the sharded
  // persistence only writes touched docs, yet the committed index listed
  // every doc: the restore looked fine in-session, then every shard read
  // came back NOT_FOUND after a restart and the restored library vanished.
  let count = 0;
  let skippedPages = 0;
  await mutateStore(store => {
    for (const [path, doc] of Object.entries(docsIn)) {
      const clean = sanitizeDocEntry(doc);
      if (clean === null) {
        console.warn('[SmartNoteAI.store]', `import: skipped malformed doc ${path}`);
        continue;
      }
      const live = store.docs[path];
      if (live === undefined) {
        store.docs[path] = clean; // absent live: the backup restores whole
      } else if (Object.keys(live.pages).length === 0) {
        // Audit 9 #1: a stub (lock-only doc, or a cleared locked doc) has
        // no pageIds, so the identity merge below restored NOTHING from
        // the backup. An empty live doc has nothing to protect: adopt the
        // backup wholesale and keep the user's lock.
        store.docs[path] = {...clean, ...(live.lock === true ? {lock: true} : {})};
      } else {
        // Phase C, owner rule (arbitrage C): restore merges BY IDENTITY.
        // - A note page travels with its PAGEID: it lands at the index
        //   where that PAGEID lives TODAY (insertions/deletions since the
        //   backup no longer shift anything). Unknown PAGEID = the page no
        //   longer exists: skipped, never stitched.
        // - A PDF page has no identity; its index is only meaningful if
        //   the document bytes are unchanged (docHash prefix match).
        // - The live copy wins every collision; locks are never touched.
        const liveIds = live.pageIds;
        // Round 10 #4: a live doc with pages but no pageIds cannot be
        // identity-merged — its skips are COUNTED and reported, never a
        // silent 'success'.
        const pdfSame =
          live.docHash.split('|')[0] === clean.docHash.split('|')[0] &&
          live.docHash.length > 0;
        for (const [k, v] of Object.entries(clean.pages)) {
          const pid = v.hash;
          // skippedPages means exactly: "this backup page could NOT be
          // restored" (unverifiable placement, or its page no longer
          // exists). A live-wins collision is NOT a skip — the data is
          // already there, nothing was lost (round 11 #6).
          if (pid.length > 0) {
            if (liveIds === undefined) {
              skippedPages++; // no identity map: placement unverifiable
              continue;
            }
            const idx = liveIds.indexOf(pid);
            if (idx < 0) {
              skippedPages++; // the page was deleted since the backup
              continue;
            }
            if (live.pages[String(idx)] === undefined) {
              live.pages[String(idx)] = v; // identity-placed
            }
            continue; // live-wins collision: not a skip
          }
          if (pdfSame) {
            if (live.pages[k] === undefined) {
              live.pages[k] = v; // same bytes: the index is trustworthy
            }
            continue; // live-wins collision: not a skip
          }
          skippedPages++; // PDF bytes changed: the index is untrustworthy
        }
        if (live.pageIds === undefined && clean.pageIds !== undefined) {
          live.pageIds = clean.pageIds;
        }
        if (live.docHash.length === 0 && clean.docHash.length > 0) {
          live.docHash = clean.docHash;
        }
      }
      markDocTouched(path);
      count++;
    }
  });
  await flushStore();
  return {ok: true, docs: count, skippedPages, unreadableDocs};
};

// "Clear local data" (config): wipe memory + files. Shards are deleted
// via the deletion diff (lastPaths still holds them), then the empty
// index commits the wipe.
// Clear ALL, lock-aware (user decision 2026-08-03): every doc goes
// through the lock-respecting clear; the raw file wipe below only runs
// when nothing locked survived. Shards that could not be READ this
// session are spared too when locks exist — we cannot see whether they
// hold locked pages, so the conservative side is to keep them.
export const clearAllRespectingLocks = async (): Promise<{
  docs: number;
  keptLockedPages: number;
  skippedLockedDocs: number;
}> => {
  const store = await loadStore();
  const r = await clearDocsTranscripts(Object.keys(store.docs));
  if (r.keptLockedPages === 0 && r.skippedLockedDocs === 0) {
    await clearStoreFile(); // historical full wipe (orphan shards included)
  }
  return r;
};

export const clearStoreFile = async (): Promise<void> => {
  await loadStore(); // ensure lastPaths reflects what is on disk
  storeP = Promise.resolve(emptyStore());
  takeTouchedDocs(); // drop pending marks for wiped docs
  // An explicit wipe is user intent — it overrides the degraded-load
  // protection and takes the unloaded shard files with it.
  degradedLoad = false;
  const dirForClear = await storeDir();
  if (dirForClear === null) {
    unloadedShards.clear();
    return;
  }
  for (const f of unloadedShards.values()) {
    await deleteFile(`${dirForClear}/docs/${f}`);
  }
  unloadedShards.clear();
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistNow();
  for (const l of listeners) {
    try {
      l();
    } catch {
      // ignore
    }
  }
};

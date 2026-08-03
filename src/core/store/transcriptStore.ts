// TranscriptStore — the persistent "read once, analyse forever" cache
// at the heart of v0.20 (SPEC-v0.20 §2.1). Pure module: plain data in,
// plain data out; the file IO lives in src/native/transcriptStoreIo.ts.
//
// One JSON document holds every transcribed page of every document,
// keyed by file path. A rename therefore misses the cache (documented
// trade-off: extracting the .note FILE_ID would cost a whole-file read
// per lookup); the page is simply re-read on first use under its new
// name.
//
// A .note page entry carries TWO signals (PDF pages have neither):
//   • `hash` = the page's PAGEID — its stable IDENTITY. It follows the
//     page through insert/delete/reorder and NEVER changes when the ink
//     is edited (so it alone can't tell an edited page from an untouched
//     one). (Before v0.22.4 `hash` was the element count.)
//   • `rev`  = the page's block ADDRESS in the append-only footer — a
//     CONTENT signal that moves whenever the page is rewritten. Same
//     PAGEID + changed rev ⇒ the page was edited (see pageNeedsRead).
// For PDFs the per-DOC byte length stands in (docHash); a changed file
// invalidates all its pages.

import {reflowTranscript} from '../model/reader';

// v0.35: the legacy 'eco' (Ministral+glossary engine) and 'recogntext'
// (free on-device baseline) sources are gone — no writer produces them
// since v0.32, and the schema-32 wipe removed every stored one.
export type TranscriptSource =
  | 'medium' // read by the vision model (escalation / Improve output)
  | 'mistral-ocr' // read by /v1/ocr (OCR stage, no escalation needed)
  | 'improved' // Improve: vision + image + previous transcript hint
  | 'user' // hand-corrected — never overwritten silently
  | 'guide'; // v0.60 embedded User Guide seed — shipped, never re-billed

// A low-confidence word reported by the OCR (v0.23): `t` the word, `c`
// its confidence. Only words under the escalation threshold are kept —
// they feed the transcript highlighting and the glossary suggestions.
export type LowWord = {t: string; c: number};

export type PageEntry = {
  text: string;
  source: TranscriptSource;
  at: number; // epoch ms of the read
  hash: string; // PAGEID (.note, since v0.22.4) or '' (PDF pages)
  low?: LowWord[]; // v0.23: OCR words under 0.8 confidence (capped)
  // v0.25.7 in-place-edit signal: the page's block ADDRESS in the
  // append-only .note footer. The PAGEID (`hash`) is the page's IDENTITY
  // and never changes when you edit the ink; the block address moves every
  // time the page's content is rewritten. Storing the address this entry
  // was read at lets Auto notice a page you kept writing on (same PAGEID,
  // new address) and re-read it — which the PAGEID alone can't detect.
  // Undefined for PDFs and for entries stamped before v0.25.7.
  rev?: string;
  // v0.88 (audit): NOTE pages only — the content rev of the last FAILED (or
  // empty) Vision attempt. When va === rev, the Vision drain skips the page
  // until its ink changes: without this, a page whose Vision reliably comes
  // back empty was re-billed 3 attempts per session, EVERY session.
  va?: string;
  // Phase B (v0.96): the PIXEL IDENTITY this page's vision text was made
  // from — 'mh:<hex>' of the rendered, annotation-composited image. ONE
  // identity per PDF page: the vision pass renders first (free), compares,
  // and only pixels that actually changed reach the paid model. Undefined
  // for notes (their identity is PAGEID+rev) and for pre-B entries.
  vh?: string;
  // v0.94 (user decision 2026-08-02): PAGE LOCK. Hand-correcting a page no
  // longer freezes it: a correction says "this is the right text", a LOCK
  // says "never re-read this page". Without a lock, a page whose ink is
  // PROVABLY changed is re-read even when its text is a hand correction.
  // Set from the page view; a whole-document lock lives on DocEntry.
  lock?: true;
  // v0.92 (full review #3): EPHEMERAL — written by a consented one-shot
  // read of an OFF document. Wiped in the read's finally; if a process
  // kill skips that, sweepEphemeralPages purges it at the next boot. The
  // flag exists precisely so the sweep cannot touch legitimate transcripts
  // stored before a document was switched to Off.
  eph?: true;
};

export type DocEntry = {
  // Phase B: byte size of the .mark sidecar at the last COMPLETE vision
  // pass — a cheap doorbell ("did annotations possibly change?"), never an
  // identity (sizes repeat; the per-page `vh` pixel hash is the identity).
  markSz?: number;
  // v0.94: whole-document lock — every page of this doc is frozen for
  // automatic passes (toggled from the Library row and the page grid).
  lock?: true;
  usedAt: number; // for LRU eviction
  docHash: string; // PDF byte length; '' for .note
  pages: Record<string, PageEntry>; // key = 0-indexed page number
  // v0.23 structural tracking: snapshot of the note's CURRENT page order
  // (pageIds[i] = PAGEID of page i). Lets the library show every page of
  // a known note, including the ones never read ("not read yet").
  pageIds?: string[];
  // v0.23 auto-transcript: file size at the last background sync — a
  // cheap "did anything change?" signal (the .note format is append-only,
  // any edit grows the file).
  stamp?: string;
  // v0.37 smart search: snapshotted from the .note at sync (like pageIds).
  // stars = 0-indexed pages carrying a five-pointed star (<FIVESTAR:…> in
  // the page block); kws = Supernote keywords {p: 0-indexed page, t: text}.
  stars?: number[];
  kws?: Array<{p: number; t: string}>;
};

export type Store = {
  v: 1;
  docs: Record<string, DocEntry>; // key = absolute file path
  // v0.20.1: ONE first-launch cloud consent replaces the per-document
  // dialog (device feedback: per-doc popups break the flow).
};

export const emptyStore = (): Store => ({v: 1, docs: {}});

const isValidEntry = (e: unknown): e is PageEntry => {
  const p = e as PageEntry;
  return (
    p != null &&
    typeof p.text === 'string' &&
    typeof p.at === 'number' &&
    typeof p.hash === 'string' &&
    (p.source === 'medium' ||
      p.source === 'mistral-ocr' ||
      p.source === 'improved' ||
      p.source === 'user' ||
      // v0.60: without this line the seeded guide pages would be
      // silently DROPPED at every shard reload (sanitize runs per load).
      p.source === 'guide')
  );
};

// Keep only well-formed low-confidence words; undefined when none valid
// (missing field = the common case, pre-v0.23 entries).
const sanitizeLow = (v: unknown): LowWord[] | undefined => {
  if (!Array.isArray(v)) {
    return undefined;
  }
  const out = v.filter(
    (w): w is LowWord =>
      w != null &&
      typeof (w as LowWord).t === 'string' &&
      (w as LowWord).t.length > 0 &&
      typeof (w as LowWord).c === 'number',
  );
  return out.length > 0 ? out.slice(0, 60) : undefined;
};

// Never throws: any malformed file (corruption mid-write, old schema)
// degrades to an empty store — worst case the pages are re-read.
// One untrusted doc → a clean DocEntry (or null). Extracted from
// parseStore in v0.56 so the sharded IO can sanitize a single doc file
// with EXACTLY the same rules as the legacy whole-store parse.
export const sanitizeDocEntry = (doc: unknown): DocEntry | null => {
  const d = doc as DocEntry;
  if (!d || typeof d !== 'object' || typeof d.pages !== 'object') {
    return null;
  }
  const pages: Record<string, PageEntry> = {};
  for (const [k, e] of Object.entries(d.pages)) {
    if (/^\d+$/.test(k) && isValidEntry(e)) {
      const pe = e as PageEntry;
      pages[k] = {
        ...pe,
        low: sanitizeLow(pe.low),
        // Drop a malformed rev so a non-string can't force spurious
        // re-reads (comparison is against a string address).
        rev: typeof pe.rev === 'string' ? pe.rev : undefined,
        va: typeof pe.va === 'string' ? pe.va : undefined,
        // v0.94: a lock is the user's freeze — it must survive every
        // reload, and only the literal `true` counts.
        lock: pe.lock === true ? true : undefined,
        vh: typeof pe.vh === 'string' ? pe.vh : undefined,
      };
    }
  }
  const entry: DocEntry = {
    usedAt: typeof d.usedAt === 'number' ? d.usedAt : 0,
    docHash: typeof d.docHash === 'string' ? d.docHash : '',
    pages,
  };
  if (d.lock === true) {
    entry.lock = true; // whole-document freeze (v0.94)
  }
  if (typeof d.markSz === 'number' && d.markSz >= 0) {
    entry.markSz = d.markSz;
  }
  if (
    Array.isArray(d.pageIds) &&
    d.pageIds.every(id => typeof id === 'string')
  ) {
    entry.pageIds = d.pageIds;
  }
  if (typeof d.stamp === 'string' && d.stamp.length > 0) {
    entry.stamp = d.stamp;
  }
  if (Array.isArray(d.stars)) {
    const stars = d.stars.filter(
      (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0,
    );
    if (stars.length > 0) {
      entry.stars = stars;
    }
  }
  if (Array.isArray(d.kws)) {
    const kws = d.kws.filter(
      (k): k is {p: number; t: string} =>
        k != null &&
        typeof (k as {p: unknown}).p === 'number' &&
        typeof (k as {t: unknown}).t === 'string' &&
        (k as {t: string}).t.length > 0,
    );
    if (kws.length > 0) {
      entry.kws = kws;
    }
  }
  return entry;
};
// (parseStore deleted in Lot 1 — nothing parses a legacy whole-store
// JSON since the v1 migration was purged in Phase C.)

export const serializeStore = (store: Store): string => JSON.stringify(store);

// ---- touched-doc tracking (v0.56 sharded persistence) ----
// INVARIANT: every mutation of store.docs[path] must either go through
// docOf() (all the standard writers do) or call markDocTouched(path)
// explicitly (touchDoc, remapDocPages, removePages, and the rev backfill
// in reading.ts do). The IO layer persists ONLY the touched shards —
// an unmarked mutation would be visible in memory but silently lost on
// restart. Deletions are NOT tracked here: the IO layer diffs the doc
// list against the last persisted one.
const touchedDocs = new Set<string>();
export const markDocTouched = (path: string): void => {
  touchedDocs.add(path);
};
// Drain the set (the IO layer re-marks the ones whose write failed).
export const takeTouchedDocs = (): string[] => {
  const out = [...touchedDocs];
  touchedDocs.clear();
  return out;
};

const docOf = (store: Store, path: string): DocEntry => {
  markDocTouched(path);
  let doc = store.docs[path];
  if (!doc) {
    doc = {usedAt: 0, docHash: '', pages: {}};
    store.docs[path] = doc;
  }
  return doc;
};

export const getPage = (
  store: Store,
  path: string,
  page: number,
): PageEntry | null => store.docs[path]?.pages[String(page)] ?? null;

// A stored page is usable when its change-signal still matches. An
// empty `expectedHash` (caller couldn't compute one) accepts any entry.
// BUT when we KNOW the page's PAGEID, an entry without one (legacy
// element-count or '' hash) is NOT trusted: after a page insertion the
// old index-keyed entry would silently answer for the new page (bug
// found on device 2026-07-12). It re-reads once, then carries its id.
export const isPageValid = (
  entry: PageEntry | null,
  expectedHash: string,
): entry is PageEntry => {
  if (entry === null || entry.text.trim().length === 0) {
    return false;
  }
  if (expectedHash === '') {
    return true;
  }
  if (looksLikePageId(expectedHash) && !looksLikePageId(entry.hash)) {
    return false;
  }
  return entry.hash === '' || entry.hash === expectedHash;
};

// Whether a page must be (re)read by a PAID engine right now. Folds the
// three long-standing reasons (no entry / free stopgap / stale identity)
// with the v0.25.7 in-place-edit signal: SAME page identity (PAGEID) but a
// CHANGED content-rev (the page's block address moved → its ink was edited
// after the last read). `expectedRev` is undefined when the footer read
// failed or the file is a PDF; a stored entry without a rev is a legacy /
// pre-v0.25.7 read. In BOTH cases we do NOT re-read (never churn the whole
// library on missing data — an edit is caught once both revs are known).
export const pageNeedsRead = (
  entry: PageEntry | null,
  expectedPageId: string,
  expectedRev: string | undefined,
  docLocked = false,
): boolean => {
  // A lock is absolute for every AUTOMATIC pass (v0.94).
  if (docLocked || entry?.lock === true) {
    return false;
  }
  if (entry === null) {
    return true;
  }
  // A hand correction is no longer a freeze (v0.94, user decision): it is
  // re-read ONLY on PROOF that the ink changed — same page identity, block
  // address moved, both stamps known. On missing/unknown stamps we never
  // re-read it: a footer glitch must not cost a correction (a 'user' entry
  // saved during one carries hash ''). To freeze a page for good, LOCK it.
  if (entry.source === 'user') {
    return (
      entry.hash === expectedPageId &&
      expectedRev !== undefined &&
      entry.rev !== undefined &&
      entry.rev !== expectedRev
    );
  }
  // Negative cache (C3): a page already read at the CURRENT content-rev
  // (same PAGEID and same rev) was attempted — don't re-read it, even if OCR
  // and vision both came back EMPTY (a genuinely blank page). It re-reads
  // once the ink changes (rev moves) or the page identity changes. Prevents
  // paying to re-render/re-OCR every blank page on every Auto pass.
  if (
    expectedRev !== undefined &&
    expectedRev.length > 0 &&
    entry.rev === expectedRev &&
    entry.hash.length > 0 &&
    entry.hash === expectedPageId
  ) {
    return false;
  }
  // Wrong or stale identity (a page was inserted before it, legacy
  // index-keyed entry, empty transcript…).
  if (!isPageValid(entry, expectedPageId)) {
    return true;
  }
  // Same page identity, but its content block moved → edited in place.
  if (
    expectedRev !== undefined &&
    expectedRev.length > 0 &&
    entry.rev !== undefined &&
    entry.rev.length > 0 &&
    entry.rev !== expectedRev
  ) {
    return true;
  }
  return false;
};

export const upsertPage = (
  store: Store,
  path: string,
  page: number,
  entry: PageEntry,
  now: number,
): void => {
  const doc = docOf(store, path);
  // Phase A (spec S6): the LOCK is the user's decision and this is the ONE
  // entry writer — it carries the lock forward so no caller can drop it.
  // (Round-8 #0: every write used to silently unlock the page it touched.)
  const prev = doc.pages[String(page)];
  if (prev?.lock === true && entry.lock !== true) {
    entry = {...entry, lock: true};
  }
  doc.pages[String(page)] = entry;
  doc.usedAt = now;
};

// The ONE entry factory (refactor v0.36 §1.2): every writer goes through
// it, so the text normalization (reflow into prose — deterministic,
// v0.24.8) and the identity/rev stamps can never be forgotten by a call
// site again (4 writers had forgotten them before the 2026-07-17 audit).
// 'user' text is stored VERBATIM — a hand correction is never reflowed.
export const makePageEntry = (
  text: string,
  source: TranscriptSource,
  stamp: {hash: string; rev?: string},
  at: number,
  low?: LowWord[],
): PageEntry => ({
  // 'user' text is stored VERBATIM (a hand correction is never
  // reflowed); 'guide' too (v0.60 — authored markdown, not OCR output).
  text: source === 'user' || source === 'guide' ? text : reflowTranscript(text),
  source,
  at,
  hash: stamp.hash,
  rev: stamp.rev,
  low: low !== undefined && low.length > 0 ? low : undefined,
});

export const touchDoc = (store: Store, path: string, now: number): void => {
  const doc = store.docs[path];
  if (doc) {
    doc.usedAt = now;
    markDocTouched(path);
  }
};

export const setDocHash = (
  store: Store,
  path: string,
  docHash: string,
): void => {
  docOf(store, path).docHash = docHash;
};

// Since v0.22.4 a .note entry's `hash` holds the page's PAGEID (a
// creation-stamped unique id read from the file itself) instead of the
// old element count — deleting/inserting/reordering pages then only
// changes WHERE an entry sits, never invalidates WHAT it says.
export const looksLikePageId = (h: string): boolean => /^P\d{14,}/.test(h);

/* ---- Relocation (2026-08-03, user request): recover paid transcripts
   that MOVED instead of re-billing them. COPY-based on purpose: the donor
   entry is never touched, so a copy, an unmounted SD card or a transient
   listing error can never lose data. Two identities, one per file kind:
   notes follow the PAGEID (it travels with the page, even across notes);
   PDFs match on file name + printed byte length. ---- */

// Donor index: PAGEID → entry over every OTHER doc's non-ephemeral,
// non-empty, identity-stamped entries. Built lazily by pagesNeedingRead —
// only when a candidate page actually shows up.
export const buildPageIdDonors = (
  store: Store,
  excludePath: string,
): Map<string, PageEntry> => {
  const out = new Map<string, PageEntry>();
  for (const [dp, doc] of Object.entries(store.docs)) {
    if (dp === excludePath) {
      continue;
    }
    for (const e of Object.values(doc.pages)) {
      if (e.eph === true || e.text.trim().length === 0) {
        continue; // Off-ephemeral text never propagates; stubs carry nothing
      }
      if (looksLikePageId(e.hash) && !out.has(e.hash)) {
        out.set(e.hash, e);
      }
    }
  }
  return out;
};

// Whole-PDF adoption: the store has nothing usable for pdfPath, but
// another doc with the SAME file name and SAME printed byte length is
// covered — the file was moved (or copied). Deep-copies the pages;
// markSz is NOT copied, so the annotation doorbell re-settles at the new
// path through the free per-page pixel hashes. Page locks travel with
// the copy (same document, the freeze was about its content). Refuses
// when the destination carries a lock stub (spec S6: the freeze is the
// user's standing decision — even a free write respects it) or already
// has pages. Returns false untouched in every refusal (mutateStore
// contract: exact false = no persist, no notify).
export const adoptPdfDoc = (
  store: Store,
  pdfPath: string,
  byteLen: number,
  now: number,
): boolean => {
  const cur = store.docs[pdfPath];
  if (
    cur !== undefined &&
    (cur.lock === true || Object.keys(cur.pages).length > 0)
  ) {
    return false;
  }
  const base = pdfPath.split('/').pop() ?? '';
  if (base.length === 0 || byteLen <= 0) {
    return false;
  }
  const hash = String(byteLen);
  for (const [dp, doc] of Object.entries(store.docs)) {
    if (dp === pdfPath || (dp.split('/').pop() ?? '') !== base) {
      continue;
    }
    const bar = doc.docHash.indexOf('|');
    const prefix = bar >= 0 ? doc.docHash.slice(0, bar) : doc.docHash;
    if (prefix !== hash) {
      continue;
    }
    const pages: Record<string, PageEntry> = {};
    for (const [k, e] of Object.entries(doc.pages)) {
      if (e.eph === true) {
        continue;
      }
      pages[k] = {
        ...e,
        low: e.low !== undefined ? e.low.map(w => ({...w})) : undefined,
      };
    }
    if (Object.keys(pages).length === 0) {
      continue;
    }
    store.docs[pdfPath] = {
      usedAt: now,
      docHash: prefix, // bytes-only — no doorbell, annotations re-settle free
      pages,
      stars: [],
      kws: [],
    };
    markDocTouched(pdfPath);
    return true;
  }
  return false;
};

// Realign a .note doc's entries to the CURRENT page order (pageIds[i] =
// PAGEID of today's page i). Identity-keyed entries follow their page;
// entries whose page no longer exists are dropped; legacy entries
// (element-count or empty hash) keep their index unless a remapped
// entry claims it. Returns what moved/vanished for logging.
export const remapDocPages = (
  store: Store,
  path: string,
  pageIds: string[],
): {moved: number; dropped: number; refused?: boolean} => {
  const doc = store.docs[path];
  if (!doc) {
    return {moved: 0, dropped: 0};
  }
  markDocTouched(path);
  const byId = new Map<string, PageEntry>();
  const idKey = new Map<string, string>(); // PAGEID → its current index key
  const legacy = new Map<string, PageEntry>();
  for (const [k, e] of Object.entries(doc.pages)) {
    if (looksLikePageId(e.hash)) {
      byId.set(e.hash, e);
      idKey.set(e.hash, k);
    } else {
      legacy.set(k, e);
    }
  }
  if (byId.size === 0) {
    return {moved: 0, dropped: 0}; // nothing identity-keyed yet
  }
  // Audit 2026-07-30: a HOLED id list is a partial footer parse, not a page
  // deletion — remapping against it deletes paid entries whose pages still
  // exist, and the next tick re-bills them. Refuse: entries stay as they
  // are, and the next complete walk remaps for real.
  if (pageIds.some(id => id.length === 0)) {
    console.warn(
      '[SmartNoteAI.store]',
      `remap ${path.split('/').pop()}: holed page-id list (partial parse), remap refused`,
    );
    // `refused` lets the caller skip its rev re-baseline too (full review
    // 2026-08-02 #7: re-baselining against a holed walk stamped a fresh
    // block address onto a genuinely edited page, masking the edit).
    return {moved: 0, dropped: 0, refused: true};
  }
  const next: Record<string, PageEntry> = {};
  let moved = 0;
  pageIds.forEach((id, i) => {
    if (id.length === 0) {
      return;
    }
    const e = byId.get(id);
    if (e !== undefined) {
      next[String(i)] = e;
      byId.delete(id);
      if (doc.pages[String(i)] !== e) {
        moved++;
      }
    }
  });
  let dropped = 0;
  for (const [id, e] of byId) {
    // An id absent from today's pageIds USUALLY means the page was deleted —
    // but the list can also be PARTIAL (a footer parse mid-write, a note
    // edited elsewhere). Deleting a hand correction on that evidence is not
    // acceptable: 'user' entries keep their old slot when it is free (like
    // legacy entries below), everything else is dropped. The LRU eviction
    // has protected 'user' docs since 2026-07-13; the remap was the one
    // deletion path without the guard (audit 2026-07-18).
    const k = idKey.get(id);
    if (e.source === 'user' && k !== undefined && next[k] === undefined) {
      next[k] = e;
    } else {
      dropped++;
    }
  }
  for (const [k, e] of legacy) {
    if (next[k] === undefined && Number(k) < pageIds.length) {
      next[k] = e;
    } else {
      dropped++; // displaced by an identity-mapped entry, or out of range
    }
  }
  doc.pages = next;
  return {moved, dropped};
};

export const getDocHash = (store: Store, path: string): string =>
  store.docs[path]?.docHash ?? '';

// v0.23 structural tracking: remember the note's current page order so
// the library can show unread pages too. Creates the doc if needed — a
// tracked note is "known" even before its first read.
export const setPageIds = (
  store: Store,
  path: string,
  pageIds: string[],
): void => {
  docOf(store, path).pageIds = pageIds;
};

// Total pages the library knows for a doc: the structural snapshot when
// present, else the highest stored entry index + 1 (PDFs, legacy docs).
export const docPageCount = (store: Store, path: string): number => {
  const doc = store.docs[path];
  if (!doc) {
    return 0;
  }
  const keys = Object.keys(doc.pages).map(Number);
  const byEntries = keys.length > 0 ? Math.max(...keys) + 1 : 0;
  return Math.max(doc.pageIds?.length ?? 0, byEntries);
};

// v0.37 smart search: refresh a doc's star/keyword snapshot. Returns true
// when something actually changed — callers only mutateStore in that case
// (an unconditional write from a sync path would notify subscribers every
// pass and re-open the 3 Hz-loop class).
export const docMetaEquals = (
  doc: DocEntry | undefined,
  stars: number[],
  kws: Array<{p: number; t: string}>,
): boolean => {
  const ds = doc?.stars ?? [];
  const dk = doc?.kws ?? [];
  return (
    ds.length === stars.length &&
    ds.every((v, i) => v === stars[i]) &&
    dk.length === kws.length &&
    dk.every((v, i) => v.p === kws[i].p && v.t === kws[i].t)
  );
};

export const setDocMeta = (
  store: Store,
  path: string,
  stars: number[],
  kws: Array<{p: number; t: string}>,
): void => {
  const doc = docOf(store, path);
  if (stars.length > 0) {
    doc.stars = stars;
  } else {
    delete doc.stars;
  }
  if (kws.length > 0) {
    doc.kws = kws;
  } else {
    delete doc.kws;
  }
};

export const getStamp = (store: Store, path: string): string =>
  store.docs[path]?.stamp ?? '';

export const setStamp = (store: Store, path: string, stamp: string): void => {
  docOf(store, path).stamp = stamp;
};


// Remove only specific page entries from a doc (used by the OFF ephemeral
// read: discard just the pages we read to answer, not the whole document).
// If the doc has no pages left, the doc itself is dropped.
export const removePages = (
  store: Store,
  path: string,
  pages: number[],
): void => {
  const doc = store.docs[path];
  if (doc === undefined) {
    return;
  }
  markDocTouched(path); // shard rewrite (or deletion diff) needed
  for (const p of pages) {
    delete doc.pages[p];
  }
  if (Object.keys(doc.pages).length === 0) {
    delete store.docs[path];
  }
};

// Fully drop ONE document's local transcript (all pages + docHash + stamp +
// stars + keywords). v0.79.16 (user): the Library can now clear a note's
// transcript by hand — a whole-doc removePages, but explicit so a caller can
// never leave a half-cleared doc entry behind.
// Clear that RESPECTS the locks (user decision 2026-08-03): a locked
// DOCUMENT is not cleared at all; locked PAGES survive a doc clear (only
// the unlocked entries are dropped). On a partial clear the docHash (and
// the .mark doorbell) are reset so the next read re-covers the unlocked
// pages — the read pipeline already skips locked pages, so their frozen
// text is never overwritten by that re-read.
export type ClearOutcome = {
  changed: boolean; // the store was actually mutated (persist needed)
  cleared: number; // entries actually dropped
  keptLockedPages: number; // entries kept because their page is locked
  skippedLockedDoc: boolean; // whole doc refused (document lock)
};

export const clearDocRespectingLocks = (
  store: Store,
  path: string,
): ClearOutcome => {
  const doc = store.docs[path];
  if (doc === undefined) {
    return {changed: false, cleared: 0, keptLockedPages: 0, skippedLockedDoc: false};
  }
  if (doc.lock === true) {
    return {changed: false, cleared: 0, keptLockedPages: 0, skippedLockedDoc: true};
  }
  const entries = Object.entries(doc.pages);
  const locked = entries.filter(([, e]) => e.lock === true);
  if (locked.length === entries.length && entries.length > 0) {
    // Every page is locked: nothing to drop, the doc stays exactly as is.
    return {
      changed: false,
      cleared: 0,
      keptLockedPages: locked.length,
      skippedLockedDoc: false,
    };
  }
  if (locked.length === 0) {
    removeDoc(store, path);
    return {
      changed: true,
      cleared: entries.length,
      keptLockedPages: 0,
      skippedLockedDoc: false,
    };
  }
  markDocTouched(path);
  const kept: Record<string, PageEntry> = {};
  for (const [k, e] of locked) {
    kept[k] = e;
  }
  doc.pages = kept;
  doc.docHash = ''; // a future read re-covers the unlocked pages
  delete doc.markSz;
  return {
    changed: true,
    cleared: entries.length - locked.length,
    keptLockedPages: locked.length,
    skippedLockedDoc: false,
  };
};

export const removeDoc = (store: Store, path: string): boolean => {
  const doc = store.docs[path];
  if (doc === undefined) {
    return false;
  }
  markDocTouched(path);
  if (doc.lock === true) {
    // Spec S6: clearing a transcript drops the pages (and their page
    // locks with them) but the DOCUMENT lock is the user's standing
    // decision — it survives on a stub.
    store.docs[path] = {usedAt: doc.usedAt, docHash: '', pages: {}, lock: true};
    return true;
  }
  delete store.docs[path];
  return true;
};

// One row per document for the config-side Library browser, grouped by
// parent folder by the caller. `pages` counts non-empty transcripts.
export type DocSummary = {
  path: string;
  name: string;
  folder: string; // parent dir path
  pages: number; // pages with a NON-EMPTY transcript
  // v0.37.2: pages that carry ANY entry (incl. a page read but found
  // BLANK — negative-cached so Auto never re-reads it). "Pages still to
  // read" = total - read; using `pages` here counted every blank page as
  // pending FOREVER (device confusion: '25 pending' that never drained).
  read: number;
  total: number; // pages the note has (structural snapshot; ≥ read ≥ pages)
  // PDF whose docHash is stamped = the whole doc was read in one /v1/ocr
  // call — treat as fully read even when text-less pages have no entry.
  pdfCovered: boolean;
  // v0.68 pipeline view: pages still at the OCR stage (source
  // 'mistral-ocr' with text) vs pages past vision (source 'medium' /
  // 'improved' / 'user'). Lets the SYNCHRONISATION frame show the real
  // per-stage backlog instead of a job counter that conflated "OCR
  // running at Mistral" with "OCR done, vision pending".
  ocrOnly: number;
  visionDone: number;
  updatedAt: number;
};

export const docsSummary = (store: Store): DocSummary[] => {
  const out: DocSummary[] = [];
  for (const [path, doc] of Object.entries(store.docs)) {
    const withText = Object.values(doc.pages).filter(
      p => p.text.trim().length > 0,
    );
    const pages = withText.length;
    const read = Object.keys(doc.pages).length;
    const total = docPageCount(store, path);
    if (read === 0 && total === 0) {
      continue; // consent-only docs are noise in a library view
    }
    // Per-stage split (v0.68): a page with OCR text still tagged
    // 'mistral-ocr' has not been through vision; anything else with text
    // has (blank vision keeps the OCR text but is promoted to 'medium').
    const ocrOnly = withText.filter(p => p.source === 'mistral-ocr').length;
    const visionDone = pages - ocrOnly;
    const i = path.lastIndexOf('/');
    out.push({
      path,
      name: i === -1 ? path : path.slice(i + 1),
      folder: i === -1 ? '' : path.slice(0, i),
      pages,
      read,
      total,
      // A PDF read is ONE /v1/ocr call over the whole doc: once its
      // docHash is stamped, the document is fully read — pages with no
      // extractable text (cover, pure images) deliberately get no entry,
      // and counting them as "to read" left a permanent phantom backlog
      // ("2 pages to sync" forever, device report 2026-07-18).
      pdfCovered: /\.pdf$/i.test(path) && (doc.docHash ?? '') !== '',
      ocrOnly,
      visionDone,
      updatedAt: doc.usedAt,
    });
  }
  return out.sort((a, b) =>
    a.folder === b.folder
      ? a.name.localeCompare(b.name)
      : a.folder.localeCompare(b.folder),
  );
};

// 0-indexed pages of a doc that hold a non-empty transcript.
export const pagesOfDoc = (store: Store, path: string): number[] =>
  Object.entries(store.docs[path]?.pages ?? {})
    .filter(([, e]) => e.text.trim().length > 0)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);

// (evictToFit deleted — production-dead since Lot 1 removed
// auto-eviction; the plugin never discards paid data on its own.)

// Provenance aggregate for the header chip: how many of the given pages
// are covered, by source. `missing` = pages with no usable entry.
export type Provenance = {
  covered: Partial<Record<TranscriptSource, number>>;
  missing: number;
};

export const provenanceFor = (
  store: Store,
  path: string,
  pages: number[],
): Provenance => {
  const covered: Partial<Record<TranscriptSource, number>> = {};
  let missing = 0;
  for (const p of pages) {
    const e = getPage(store, path, p);
    if (e !== null && e.text.trim().length > 0) {
      covered[e.source] = (covered[e.source] ?? 0) + 1;
    } else {
      missing++;
    }
  }
  return {covered, missing};
};

// Purge the ephemeral (Off-consent) pages a killed session left behind.
// Startup-only companion of the OFF wipe in gatherContext (full review
// 2026-08-02 #3). Mode-aware (v0.92.1): only docs the caller lists as OFF
// are purged; on every OTHER doc a leftover marker is DEFUSED (cleared),
// never purged — v0.92.0 mislabelled ordinary chat-read pages as eph, and
// an unconditional sweep would have destroyed legitimate paid transcripts.
export const sweepEphemeralPages = (
  store: Store,
  offPaths: ReadonlySet<string>,
): {purged: number; defused: number} => {
  let purged = 0;
  let defused = 0;
  for (const [path, doc] of Object.entries(store.docs)) {
    const marked = Object.entries(doc.pages).filter(([, e]) => e.eph === true);
    if (marked.length === 0) {
      continue;
    }
    if (offPaths.has(path)) {
      removePages(
        store,
        path,
        marked.map(([k]) => Number(k)),
      );
      purged += marked.length;
    } else {
      for (const [, e] of marked) {
        delete e.eph;
      }
      markDocTouched(path);
      defused += marked.length;
    }
  }
  return {purged, defused};
};

// ---- v0.94 page/document locks ----------------------------------------
// A lock freezes a page (or a whole document) against every AUTOMATIC
// pass: Auto, the vision drain, the annotation pass, a whole-file re-OCR.
// Explicit user actions ("Redo AI transcript") refuse and say so, instead
// of silently ignoring the lock.

export const isDocLocked = (store: Store, path: string): boolean =>
  store.docs[path]?.lock === true;

export const isPageLocked = (
  store: Store,
  path: string,
  page: number,
): boolean => {
  const doc = store.docs[path];
  if (doc === undefined) {
    return false;
  }
  return doc.lock === true || doc.pages[String(page)]?.lock === true;
};

export const setDocLock = (store: Store, path: string, on: boolean): void => {
  let doc = store.docs[path];
  if (doc === undefined) {
    if (!on) {
      return; // nothing to unlock
    }
    // Spec S6: locking a document the AI never read is the most natural
    // use of the lock — create the stub the flag lives on. (Round-8 #5:
    // this used to no-op while the UI said "Document locked".)
    doc = {usedAt: 0, docHash: '', pages: {}};
    store.docs[path] = doc;
  }
  if (on) {
    doc.lock = true;
  } else {
    delete doc.lock;
  }
  markDocTouched(path);
};

export const setPageLock = (
  store: Store,
  path: string,
  page: number,
  on: boolean,
): void => {
  let e = store.docs[path]?.pages[String(page)];
  if (e === undefined) {
    if (!on) {
      return; // nothing to unlock
    }
    // Pre-reinstall audit #3 (same rule as setDocLock, spec S6): locking a
    // page that has no transcript yet is legitimate — 'never read this' is
    // exactly what the user means. The stub carries the flag; unlocked and
    // still empty, it reads like any unread page.
    const doc = store.docs[path] ?? {usedAt: 0, docHash: '', pages: {}};
    store.docs[path] = doc;
    e = {text: '', source: 'mistral-ocr', at: 0, hash: ''};
    doc.pages[String(page)] = e;
  }
  if (on) {
    e.lock = true;
  } else {
    delete e.lock;
  }
  markDocTouched(path);
};

// How many pages of a doc are individually locked (badge in the grid).
export const lockedPageCount = (store: Store, path: string): number => {
  const doc = store.docs[path];
  if (doc === undefined) {
    return 0;
  }
  return Object.values(doc.pages).filter(e => e.lock === true).length;
};

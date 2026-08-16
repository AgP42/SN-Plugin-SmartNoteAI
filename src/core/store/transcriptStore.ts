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
  // PDF completeness truth (simplification lot 1, 2026-08-16): the page count
  // the whole-file /v1/ocr actually returned, stamped alongside docHash. It is
  // the PDFs' equivalent of the notes' footer: an INDEPENDENT total the store
  // can be audited against. With it, a missing entry inside [0, pageCount) of
  // a covered PDF is provably a CLEARED page (the OCR writes an entry for
  // every page, blanks included) — repairable per-page Vision debt — where it
  // used to be indistinguishable from a blank and silently counted 'finished'
  // (the 2026-08-16 covered-gate hole: Clear one page of a covered PDF and
  // the engine said "up to date" forever while the Library counted it).
  // Absent on legacy docs: their missing entries keep the old blank=done
  // reading until the next OCR pass stamps the truth — no mass re-bill.
  pageCount?: number;
  // Sync-count redesign (2026-08-14): the ONE authoritative "what does this doc
  // still owe?", written by the ENGINE from its own per-page read decision and
  // READ by the UI, so the count can never disagree with what "Sync now" does.
  // It replaces the tangle of drifting counters (manualStale, pageStage-for-UI).
  //   read   = pages needing a PAID read (exactly what "Sync now" reads)
  //   vision = pages that owe ONLY the Vision leg, DISJOINT from `read` (a page
  //            needing a re-read redoes Vision too, so it is never in both —
  //            this disjointness is what a doc-level structural count could not
  //            express, and it double-counted an edited OCR page).
  // Both counts are INVALIDATED on any store write (upsertPage clears owed) and
  // recomputed by the engine when absent, so the Vision drain can never leave
  // either stale.
  owed?: {read: number; vision: number; at: number};
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
  if (
    typeof d.pageCount === 'number' &&
    Number.isInteger(d.pageCount) &&
    d.pageCount > 0
  ) {
    entry.pageCount = d.pageCount;
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
  const o = d.owed;
  if (
    o != null &&
    typeof o === 'object' &&
    typeof o.read === 'number' &&
    o.read >= 0 &&
    typeof o.vision === 'number' &&
    o.vision >= 0
  ) {
    entry.owed = {
      read: Math.max(0, Math.floor(o.read)),
      vision: Math.max(0, Math.floor(o.vision)),
      at: typeof o.at === 'number' ? o.at : 0,
    };
  }
  return entry;
};

// Read/write the authoritative sync-owed counts (redesign 2026-08-14). setOwed
// is the ONE writer path used by the engine; nothing else writes `owed`.
export const getOwed = (
  store: Store,
  path: string,
): {read: number; vision: number} | null => {
  const o = store.docs[path]?.owed;
  return o === undefined ? null : {read: o.read, vision: o.vision};
};

export const setOwed = (
  store: Store,
  path: string,
  owed: {read: number; vision: number},
  now: number,
): void => {
  const doc = store.docs[path];
  if (doc === undefined) {
    return;
  }
  doc.owed = {
    read: Math.max(0, Math.floor(owed.read)),
    vision: Math.max(0, Math.floor(owed.vision)),
    at: now,
  };
  // setOwed writes doc.owed directly (not via docOf), so it MUST mark the shard
  // touched or the IO layer never persists it — a changed-PDF owed flag set by
  // recordOwed (its ONLY store mutation) was silently lost on restart, reviving
  // the round-5 phantom-PDF bug (owed-persistence audit 2026-08-14).
  markDocTouched(path);
};

// Invalidate the engine's owed cache: any mutation that changes a doc's page
// set or page markers (va/vh/rev) makes the last recorded owed stale, so it
// must be dropped — a null owed makes every reader fall back to the (now
// correct) structural count until the engine's next pass recomputes it. The
// ONE invalidator, mirroring setOwed as the ONE writer (owed-lifecycle audit
// 2026-08-14: the drain's va-settle and Clear/remove/remap bypassed upsertPage
// and left owed stale-HIGH — phantom "✓ vision…" / cleared pages shown ✓✓).
export const invalidateOwed = (store: Store, path: string): void => {
  const doc = store.docs[path];
  if (doc !== undefined && doc.owed !== undefined) {
    doc.owed = undefined;
    markDocTouched(path);
  }
};
// (parseStore deleted in Lot 1 — nothing parses a legacy whole-store
// JSON since the v1 migration was purged in Phase C.)

export const serializeStore = (store: Store): string => JSON.stringify(store);

// ---- touched-doc tracking (v0.56 sharded persistence) ----
// INVARIANT: every mutation of store.docs[path] must either go through
// docOf() (all the standard writers do) or call markDocTouched(path)
// explicitly (remapDocPages, removePages, and the rev backfill
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
  // Invalidate the engine's owed count whenever a page ENTRY changes here
  // (redesign audit 2026-08-14): owed is the engine's authoritative read count,
  // but chat / re-read / the Vision drain also persist entries WITHOUT calling
  // recordOwed. Clearing it at THE store write means no writer can leave owed
  // stale — the UI falls back to the (accurate-for-read-pages) structural count
  // until the next engine pass rewrites owed. Marker-only mutations (va/vh/rev)
  // do not go through here, so they correctly leave owed intact.
  doc.owed = undefined;
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

// LIMBO (v1.0.1, device repro 2026-08-03 18:12): entries the remap drops
// because their PAGEID left the note are PARKED here (in-memory, capped)
// instead of vanishing. The tick's doc order is arbitrary — when the
// SOURCE note of a page move is remapped before the DESTINATION syncs,
// the donor entry was deleted 400 ms before the relocation looked for
// it, and 3 pages were re-billed. Same-session only by design: no
// schema, no persistence, no backup impact.
const LIMBO_CAP = 200;
const limbo = new Map<string, PageEntry>();
const parkInLimbo = (e: PageEntry): void => {
  if (e.eph === true || !looksLikePageId(e.hash) || e.text.trim().length === 0) {
    return; // nothing recoverable (or must never propagate)
  }
  limbo.delete(e.hash); // refresh insertion order (Map = FIFO by insertion)
  limbo.set(e.hash, e);
  if (limbo.size > LIMBO_CAP) {
    const oldest = limbo.keys().next().value as string;
    limbo.delete(oldest);
  }
};
// Test seam: inspect/clear the parked entries.
export const limboSize = (): number => limbo.size;
export const clearLimbo = (): void => {
  limbo.clear();
};

// Donor index: PAGEID → entry over every OTHER doc's non-ephemeral,
// non-empty, identity-stamped entries — LIMBO included as fallback (live
// entries win). Built lazily by pagesNeedingRead — only when a candidate
// page actually shows up.
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
  for (const [id, e] of limbo) {
    if (!out.has(id)) {
      out.set(id, e);
    }
  }
  return out;
};

// The doc that donated EVERY one of these PAGEIDs — and holds nothing
// else. That is the signature of a RENAMED (or moved) FILE, as opposed to
// a few pages carried from one note into another: the whole donor is
// accounted for at the destination. Returns null unless exactly one doc
// qualifies, so an ambiguous history never triggers a migration.
// Evidence about the FILE (is it really gone?) is the caller's job.
export const soleDonorDoc = (
  store: Store,
  excludePath: string,
  pageIds: readonly string[],
): string | null => {
  const wanted = new Set(pageIds.filter(looksLikePageId));
  if (wanted.size === 0) {
    return null;
  }
  let found: string | null = null;
  for (const [dp, doc] of Object.entries(store.docs)) {
    if (dp === excludePath) {
      continue;
    }
    // Same filter buildPageIdDonors applies: an entry with no text never
    // donates, so it is never among the relocated pages either. Counting it
    // here made the donor look "not fully accounted for" and killed the
    // whole rename inference — one blank page in a notebook was enough
    // (release audit 2026-08-12).
    const ids = Object.values(doc.pages)
      .filter(e => e.eph !== true && e.text.trim().length > 0)
      .map(e => e.hash)
      .filter(looksLikePageId);
    if (ids.length === 0) {
      continue;
    }
    // Every page of this doc must be one of the adopted ones (nothing left
    // behind), and together they must cover all of them.
    if (ids.some(id => !wanted.has(id))) {
      continue;
    }
    if (!([...wanted].every(id => ids.includes(id)))) {
      continue;
    }
    if (found !== null) {
      return null; // two candidates: refuse to guess
    }
    found = dp;
  }
  return found;
};

// Retire a doc whose file was RENAMED, once its pages live on elsewhere.
// The document-level lock is the one thing that must survive the move —
// it is a standing user decision about this content, not about a path.
export const retireRenamedDoc = (
  store: Store,
  from: string,
  to: string,
): boolean => {
  const old = store.docs[from];
  if (old === undefined || store.docs[to] === undefined) {
    return false;
  }
  if (old.lock === true && store.docs[to].lock !== true) {
    store.docs[to].lock = true;
    markDocTouched(to);
  }
  // removeDoc keeps a locked stub by design (spec S6) — here the lock has
  // just been carried to the destination, so drop it first and let the
  // ghost go completely.
  delete old.lock;
  return removeDoc(store, from);
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
  // The refusal used to be "has ANY page object", which a TEXTLESS page at
  // a path nothing was ever read at was enough to arm: a lock on a
  // never-read page (setPageLock's stub), a blank negative-cache marker.
  // That re-OCR'd a whole already-paid book on a move.
  // But refusing on text/locks ALONE was worse (audit 3, two criticals):
  // a PDF with no printed text is a perfectly normal fully-paid document
  // (blank grid template, sketchbook — OCR returns '' for every page and
  // the vision markers are all it holds), so the relaxed guard adopted
  // over it and threw away its pixel markers AND its markSz doorbell; and
  // because the destination stayed textless, the next readPdf adopted
  // AGAIN — re-billing every annotated page on every tick, forever.
  // `docHash` is what makes this decidable and self-terminating: it is
  // stamped the moment a document has been read at all, and the adoption
  // below copies it — so a second adoption always refuses.
  if (
    cur !== undefined &&
    (cur.lock === true ||
      cur.docHash.length > 0 ||
      Object.values(cur.pages).some(
        e => e.text.trim().length > 0 || e.lock === true,
      ))
  ) {
    return false;
  }
  const base = pdfPath.split('/').pop() ?? '';
  if (base.length === 0 || byteLen <= 0) {
    return false;
  }
  for (const dp of Object.keys(store.docs)) {
    if (dp === pdfPath || (dp.split('/').pop() ?? '') !== base) {
      continue;
    }
    if (copyPdfDoc(store, dp, pdfPath, byteLen, now)) {
      return true;
    }
  }
  return false;
};

// The printed-bytes prefix of a doc's hash ('' when never read).
const bytesPrefix = (doc: DocEntry): string => {
  const bar = doc.docHash.indexOf('|');
  return bar >= 0 ? doc.docHash.slice(0, bar) : doc.docHash;
};

// Copy one PDF doc onto another path. Shared by the same-name adoption
// (a MOVE) and the rename follow-through, so the two can never drift.
const copyPdfDoc = (
  store: Store,
  from: string,
  to: string,
  byteLen: number,
  now: number,
): boolean => {
  const doc = store.docs[from];
  if (doc === undefined || bytesPrefix(doc) !== String(byteLen)) {
    return false;
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
    return false;
  }
  store.docs[to] = {
    usedAt: now,
    docHash: bytesPrefix(doc), // bytes-only — annotations re-settle free
    pages,
    stars: [],
    kws: [],
  };
  markDocTouched(to);
  return true;
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
      parkInLimbo(e); // a moved-out page stays adoptable by its new note
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
  invalidateOwed(store, path); // page set changed → owed stale
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
// present (notes), the OCR-stamped pageCount when present (PDFs, lot 1),
// else the highest stored entry index + 1 (legacy docs). Before pageCount,
// a PDF's total was inferred FROM its own entries — it audited nothing: a
// cleared last page shrank the doc and every counter agreed on the lie.
export const docPageCount = (store: Store, path: string): number => {
  const doc = store.docs[path];
  if (!doc) {
    return 0;
  }
  const keys = Object.keys(doc.pages).map(Number);
  const byEntries = keys.length > 0 ? Math.max(...keys) + 1 : 0;
  return Math.max(doc.pageIds?.length ?? 0, doc.pageCount ?? 0, byEntries);
};

// Stamped at the same site as docHash, from the /v1/ocr response itself —
// never guessed (lot 1). ONE writer: readPdf's stamp block.
export const setPdfPageCount = (
  store: Store,
  path: string,
  count: number,
): void => {
  if (!Number.isInteger(count) || count <= 0) {
    return;
  }
  const doc = docOf(store, path);
  if (doc.pageCount !== count) {
    doc.pageCount = count;
    markDocTouched(path);
  }
};

// The CLEARED pages of a covered PDF: indices inside [0, pageCount) with no
// entry. Only meaningful when the OCR truth is stamped (pageCount present)
// AND the printed bytes are covered (docHash set) — an uncovered doc's
// missing pages belong to the whole-file OCR, not to per-page Vision. A
// doc-locked PDF is frozen: nothing is owed. Used by pendingVisionPages and
// the drain collector so a cleared page is REPAIRABLE debt everywhere the
// engine looks (covered-gate hole, 2026-08-16).
export const pdfMissingPages = (store: Store, path: string): number[] => {
  const doc = store.docs[path];
  if (
    doc === undefined ||
    doc.lock === true ||
    doc.pageCount === undefined ||
    (doc.docHash ?? '') === ''
  ) {
    return [];
  }
  const out: number[] = [];
  for (let p = 0; p < doc.pageCount; p++) {
    if (doc.pages[String(p)] === undefined) {
      out.push(p);
    }
  }
  return out;
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
    return;
  }
  invalidateOwed(store, path); // dropped entries → owed stale
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
  invalidateOwed(store, path); // unlocked entries dropped → owed stale
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
  // Stage tally over the doc's STRUCTURAL pages (unified 2026-08-12): the ONE
  // source the tree row, the SYNC bar and computeSyncFrame all read, so a blank
  // page, a vision-settled page and an OCR-only page can never be counted three
  // different ways again. queued = needs a paid read (matches pagesNeedingRead);
  // ocrPending = OCR text on device, vision still owed; visioned = done (vision,
  // hand-edit, blank negative-cache, or a locked/settled OCR page).
  queued: number;
  ocrPending: number;
  visioned: number;
  // Authoritative sync-owed READ count written by the engine (redesign
  // 2026-08-14). When present the UI uses owed.read (exactly what "Sync now"
  // reads); when absent (a doc the engine has not processed yet) it falls back
  // to the structural `queued` above. The Vision count is ALWAYS structural
  // (`ocrPending`) so the batch Vision drain never leaves it stale.
  owed?: {read: number; vision: number};
  updatedAt: number;
};

// ---- vision-settled predicate (unified 2026-08-12) -------------------------
// Moved here from reading.ts so the library counters and the read engine share
// ONE definition. `va` records "Vision already ran on this page's CURRENT
// content and had nothing to add". Its identity differs by page kind:
//   note page          -> its ink rev ('' when the note has no rev yet)
//   plain PDF page      -> 'd:<the document hash it was read at>'
//   annotated PDF page  -> 'mh:<hash of the rendered page+ink image>'
export const visionSettled = (
  e: PageEntry,
  ctx: {isPdf: boolean; docHash: string},
): boolean => {
  if (e.va === undefined) {
    return false;
  }
  if (!ctx.isPdf) {
    return e.rev !== undefined ? e.va === e.rev : e.va === '';
  }
  if (e.va.startsWith('d:')) {
    return e.va.slice(2).split('|')[0] === ctx.docHash.split('|')[0];
  }
  return e.va.startsWith('mh:');
};

export type PageStage = 'queue' | 'ocr' | 'finished';

// The ONE classification of a page's pipeline stage. classifyPipeline (the SYNC
// STATUS bar), docsSummary (the tree row + "to sync"), and the read engine all
// route through this, so no two counters can disagree again (release audit
// 2026-08-12: the same page was simultaneously counted queue / on-going / done
// by three code paths). Matches pagesNeedingRead: only a 'queue' page owes a
// paid read; an 'ocr' page owes the cheaper Vision leg; 'finished' owes nothing.
export const pageStage = (
  e: PageEntry | undefined,
  ctx: {
    isPdf: boolean;
    docHash: string;
    docLocked: boolean;
    pdfCovered: boolean;
    // Lot 1 (2026-08-16): true when the doc carries the OCR-stamped pageCount.
    // With that truth, the OCR is known to write an entry for EVERY page
    // (blanks included), so a missing entry of a covered PDF is provably a
    // CLEARED page — Vision-repairable debt, not a blank.
    hasPageCount: boolean;
  },
): PageStage => {
  if (e === undefined) {
    // No entry, covered PDF: with the pageCount truth this is a cleared page
    // → 'ocr' (owes the per-page Vision leg the drain repairs — no re-OCR of
    // the whole doc). Without it (legacy doc), keep the old reading: the
    // whole-file OCR ran and found nothing → done. A doc-locked PDF is
    // frozen either way. Anything not covered was never read at all.
    if (ctx.pdfCovered) {
      return ctx.hasPageCount && !ctx.docLocked ? 'ocr' : 'finished';
    }
    return 'queue';
  }
  if (e.text.trim().length === 0) {
    return 'finished'; // read and found BLANK (negative cache) — done  [K4]
  }
  if (e.source !== 'mistral-ocr') {
    return 'finished'; // vision / improved / hand-edited text
  }
  // OCR-only text. Vision is owed UNLESS it already ran and had nothing to add
  // (settled), or the page is frozen (locked) — then it is as done as it gets.
  if (
    ctx.docLocked ||
    e.lock === true ||
    visionSettled(e, {isPdf: ctx.isPdf, docHash: ctx.docHash})
  ) {
    return 'finished';
  }
  return 'ocr'; // OCR text on device, genuinely awaiting Vision
};

// Per-doc stage tally over the STRUCTURAL page range (0..total-1), so pages that
// were never read (no entry) are counted too.
export const docStageCounts = (
  store: Store,
  path: string,
): {queued: number; ocrPending: number; visioned: number} => {
  const doc = store.docs[path];
  const total = docPageCount(store, path);
  let queued = 0;
  let ocrPending = 0;
  let visioned = 0;
  if (doc !== undefined) {
    const isPdf = /\.pdf$/i.test(path);
    const ctx = {
      isPdf,
      docHash: doc.docHash ?? '',
      docLocked: doc.lock === true,
      pdfCovered: isPdf && (doc.docHash ?? '') !== '',
      hasPageCount: doc.pageCount !== undefined,
    };
    for (let p = 0; p < total; p++) {
      const st = pageStage(doc.pages[String(p)], ctx);
      if (st === 'queue') {
        queued++;
      } else if (st === 'ocr') {
        ocrPending++;
      } else {
        visioned++;
      }
    }
  }
  return {queued, ocrPending, visioned};
};

// The ONE selection of a doc's pending paid work, shared by the SYNC bar
// (classifyPipeline) and the SYNCHRONISATION frame (computeSyncFrame) so the two
// can never drift (they used to keep "exactly the same combination" in agreement
// BY HAND). read = the engine's authoritative owed.read when present, else the
// structural queue; vision = owed.vision when present, else structural ocrPending;
// both DISJOINT by construction and clamped so read+vision can never exceed total
// (a stale owed can't break the partition or push upToDate negative).
export const docPending = (
  owed: {read: number; vision: number} | undefined,
  structural: {queued: number; ocrPending: number},
  total: number,
): {read: number; vision: number} => {
  const read = Math.max(
    0,
    Math.min(total, owed !== undefined ? owed.read : structural.queued),
  );
  const vision = Math.max(
    0,
    Math.min(total - read, owed !== undefined ? owed.vision : structural.ocrPending),
  );
  return {read, vision};
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
    // Unified per-stage split (2026-08-12) via pageStage — over the STRUCTURAL
    // range, so never-read pages count as queued, and blank / vision-settled /
    // locked OCR pages count as done (the three counters used to disagree).
    const {queued, ocrPending, visioned} = docStageCounts(store, path);
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
      queued,
      ocrPending,
      visioned,
      owed:
        doc.owed === undefined
          ? undefined
          : {
              read: doc.owed.read,
              vision: doc.owed.vision,
            },
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
  // A lock toggle changes what owed SHOULD be: pageNeedsRead and pageStage both
  // branch on the lock (a locked page owes nothing; an unlocked edited page owes
  // a re-read). Nothing else recomputes owed on a toggle (bytes/footer-sig/
  // storePending all unchanged), so the cache must be dropped here or it goes
  // stale — phantom "✓ vision…" on lock, hidden read debt on unlock (audit
  // 2026-08-14). invalidateOwed is a no-op when no owed was recorded.
  invalidateOwed(store, path);
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
  invalidateOwed(store, path); // lock feeds pageNeedsRead/pageStage → owed stale
};

// How many pages of a doc are individually locked (badge in the grid).
export const lockedPageCount = (store: Store, path: string): number => {
  const doc = store.docs[path];
  if (doc === undefined) {
    return 0;
  }
  return Object.values(doc.pages).filter(e => e.lock === true).length;
};

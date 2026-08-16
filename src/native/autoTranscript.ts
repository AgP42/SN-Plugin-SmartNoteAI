// "Transcript always" (v0.23): keep the library up to date for the
// folders / notes the user set to Auto in the Library. While the plugin
// RUNS (panel open, config open, periodic tick), each tracked .note is
// checked for changes and its new / changed pages are read by the smart
// Mistral engine — same path, same escalation, same store as a manual
// read. Honest scope: the plugin is not a system service; pages written
// while it is closed are caught up at the next opening.
//
// Change detection is cheap: the .note format is APPEND-ONLY, so the
// file size is a reliable "something changed" signal (native listDir
// gives it without opening the file). Unchanged notes whose pages are
// all covered cost zero IO beyond the folder listing.

import type {CaptureDeps} from './capture';
import {setActivity, stopRequested} from './activity';
import {listDirNative} from './fs';
import {folderEvidence} from './renameFollow';
import {
  noteFailure,
  clearFailure,
  clearFailuresFor,
  failCapped,
  failCap,
} from './failLedger';
import {sleepHybrid} from './nativeSleep';
import {readSettings, updateSettings} from './settings';
import {getApiKey} from './secureKey';
import {
  loadStore,
  mutateStore,
  flushStore,
  isDegradedLoad,
  isDocReadOnly,
} from './transcriptStoreIo';
import {
  getStamp,
  setStamp,
  docsSummary,
  setOwed,
  getOwed,
  pageStage,
  docPageCount,
  removeDoc,
} from '../core/store/transcriptStore';
import {
  pagesNeedingRead,
  readNotePages,
  readPdf,
  syncNotePages,
  isNotePath,
  markFilePath,
  pdfPrintedCovered,
  pdfMarkSzOf,
  pendingVisionPages,
  finishVisionLive,
} from './reading';
import {
  readFooterRevs,
  invalidateNoteCache,
  readFileSize,
} from './noteTranscripts';
import {footerSignature} from '../core/notefile/footerSig';
import {
  assembleVisionPrompt,
  assemblePdfVisionPrompt,
} from '../core/model/visionPrompt';
import {
  resolveAutoTarget,
  isAutoFolderKey,
  DEFAULT_MODE,
  type AutoTarget,
} from '../core/store/autoEngine';
import {orphanedModeFor} from '../core/store/renamePath';

// Per-tick YIELD boundary: at most this many paid reads per tick, then the
// tick returns and — if a backlog remains — re-pokes itself right away
// (drain-continue below). This keeps each tick bounded (Stop stays snappy,
// the JS thread yields, new edits get seen between chunks) while the backlog
// drains CONTINUOUSLY, not one chunk per 15-min heartbeat.
export const MAX_PAGES_PER_TICK = 100;

// Runaway backstop, NOT a budget (full review 2026-08-02 #6; the v0.79.1
// removal left nothing at all): unattended Auto stops paying after this many
// pages per session, because every state bug that under-reports coverage
// (degraded load, store fresh-start, a destroyed shard) otherwise turns into
// an unbounded billing run overnight. An EXPLICIT user sync ('Force sync' /
// 'Sync now', trigger 'sync') raises the allowance by another block — the
// user's own big drains stay possible, silent runaways do not.
export const MAX_PAGES_PER_SESSION_BLOCK = 500;
let sessionPaidPages = 0;
let capLogged = false;
// True while a user-ordered sync still has backlog draining: those
// drain-continue ticks run ATTENDED (uncapped). Cleared when the backlog
// is done.
let userBacklog = false;

// Keep-awake "Sync on-going" bubble REMOVED (v0.84.2): FLAG_KEEP_SCREEN_ON on
// the overlay was ignored by the Supernote firmware's autosuspend, so the
// screen slept and the bubble vanished after a few seconds — the feature never
// reliably held the device awake. (Device evidence 2026-07-29.)

// Last AUTO-mode docs actually synced (user request 2026-07-19: the
// frame's AUTO column shows the last five with their datetime). Newest
// first, capped at 5, PERSISTED in settings (v0.63.1 — the session list
// looked permanently empty after every reinstall). ONE writer: here.
export type RecentAutoSync = {name: string; at: number; pages: number};
let recentAutoSyncs: RecentAutoSync[] = [];
export const hydrateRecentAutoSyncs = async (): Promise<void> => {
  try {
    recentAutoSyncs = (await readSettings()).recentAutoSyncs ?? [];
  } catch {
    // memory list stays; next record persists it anyway
  }
};
const recordAutoSync = (name: string, pages: number): void => {
  recentAutoSyncs.unshift({name, at: Date.now(), pages});
  recentAutoSyncs.length = Math.min(recentAutoSyncs.length, 5);
  updateSettings({recentAutoSyncs: [...recentAutoSyncs]}).catch(() => {});
};

// (Removed 2026-08-14: the "Sync now = standing ORDER" registry (manualWanted /
// manualSyncWanted). It was a per-document to-do list whose only unique job was
// auto-continuing a Manual OCR backlog >100 pages across background ticks — a
// marginal convenience that leaked stale orders, showed a misleading counter,
// paid for Manual docs in the background (against the meaning of "Manual"), and
// welded itself to the spend cap. "Sync now" now reads what it can in one pass;
// the 4 queues show the remainder and the user re-taps; the Vision drain still
// finishes the Vision leg for every non-Off doc on its own.)

// Epoch ms of the last pass that actually ran (for the Library "last sync"
// line). 0 = never this session.
let lastSyncAt = 0;
export const getLastSyncAt = (): number => lastSyncAt;

// Epoch ms of the last MANUAL sync the user launched (Sync now / Sync
// batch) — the MANUAL header's "last sync at" (v0.69, user request).
// Session-scoped like lastSyncAt; 0 = none this session.
let lastManualSyncAt = 0;
export const getLastManualSyncAt = (): number => lastManualSyncAt;
export const markManualSync = (): void => {
  lastManualSyncAt = Date.now();
};

// Minimum spacing between two ticks (the panel and the config can both
// trigger; a tick every few seconds would just burn IO).
// Page turns now drive Auto (ChatPanel), so keep a short floor to avoid
// hammering when flipping fast; the periodic 15-min tick is the fallback.
const MIN_TICK_GAP_MS = 20_000;
// Startup grace (v0.67): right after a process start EVERYTHING is cold
// (snapshot walks, backlog collect) and it used to land exactly on the
// user's first interaction — taps were eaten by 900 ms frames (device
// logs 2026-07-20). Automatic ticks and collects wait this long; the
// user's own buttons (opts.force) don't.
const STARTUP_GRACE_MS = 60_000;
let bootAt = Date.now();
// Tests pin the grace window against their mocked clock.
export const __setBootAtForTests = (at: number): void => {
  bootAt = at;
};

let running = false;
// Phase C: the tick is a QUEUE, not a reclaimable lock. A running tick is
// never taken over: if the JS thread is frozen, nothing else runs either,
// and on thaw the tick completes and replays the queued poke. Every await
// inside settles eventually (the HTTP layer has a freeze-proof watchdog),
// so the lock cannot be held forever. This deletes the whole generation/
// supersession/stale-reclaim apparatus — its interleavings double-paid,
// twice, across two review rounds.
let lastTickAt = 0;

// Foreground priority (2026-07-23): while the user is actively sending a chat
// message, PAUSE the background Auto drain so the foreground request isn't
// throttled by the shared rate governor (the "chat 429 while OCR advances"
// report). This is a DEDICATED flag — distinct from the live-read flag the
// Auto tick itself sets. Released → poke so Auto resumes at once.
// v0.88 (audit): REFCOUNT + expiry instead of a plain boolean — a caller
// that dies before releasing (or overlapping callers, e.g. a send plus a
// Read-and-add) must not pause the background drain forever. Stale after
// 5 min: no healthy foreground request lives that long.
// Long enough that a real request (a chat send that also reads pages) can
// never expire under itself; short enough that a caller that died without
// releasing does not pause the drain forever (review 2026-08-01 #7).
const FOREGROUND_STALE_MS = 20 * 60_000;
let foregroundBusyCount = 0;
let foregroundBusyAt = 0;
const isForegroundBusy = (): boolean =>
  foregroundBusyCount > 0 && Date.now() - foregroundBusyAt < FOREGROUND_STALE_MS;
export const setForegroundBusy = (v: boolean): void => {
  if (v) {
    foregroundBusyCount++;
    foregroundBusyAt = Date.now();
  } else {
    foregroundBusyCount = Math.max(0, foregroundBusyCount - 1);
    if (foregroundBusyCount === 0) {
      pokeAuto('foreground-done', {force: true});
    }
  }
};
// Failure backoff (lot 4a, 2026-08-16): the three session retry counters
// (per-page paid read, per-page vision leg, per-document PDF OCR) live in
// the ONE failLedger — see its header for each kind's contract and history
// (audits 2026-07-18, 2026-08-12 critical, fix-audit D14).
// Ghost-transcript pruning (2026-08-15): a note DELETED on the device but still
// holding a stale store entry keeps counting "1 to read" the tick can never
// read (the file is gone). We purge it — but ONLY after the file is confirmed
// unreadable for CONSEC_GHOST_TICKS consecutive ticks, never on one miss: the
// firmware has a known transient "all-notes 0 pages" glitch, and a false purge
// would drop a real transcript and re-bill the re-read.
//
// "Consecutive" is enforced by TWO presence resets earlier in the tick, not by
// this block alone (audit 2026-08-15): a healthy note can `continue` at the
// byte-size or footer-stamp skip long before reaching the prune logic, so the
// streak MUST be cleared the moment presence is proven — reset #1 when the walk
// saw the file (walkSizes), reset #2 when the footer read succeeded (sig). With
// both, the streak advances only on ticks where the walk AND the footer AND the
// page count AND readFileSize all fail together — a genuinely absent file.
//
// Even then, the prune block re-lists the file's own FOLDER before advancing:
// it only counts a tick as "gone" when the folder answers with OTHER files but
// not this one. A folder that still lists the file (present but locked) or an
// empty/unreadable listing (the volume itself is unmounted/stalled) HOLDS the
// streak and never prunes — so a storage outage can never delete a live
// transcript (audit 2026-08-15). Per-document, session-scoped.
const CONSEC_GHOST_TICKS = 3;
const ghostStreak = new Map<string, number>();
// v0.88.3 perf: a failed render PROBE is not retried for a minute (except on
// explicit/force pokes) — the v0.87.4 "ping" attempted 3 doomed renders on
// EVERY 20 s tick, a steady tax on the e-ink UI thread.
const PROBE_RETRY_MS = 60_000;
// ONE render-cooldown clock per kind (2026-08-15): the epoch ms until which a
// KIND's renders are stood down after a failed probe. Replaces the two
// last*ProbeFailAt timestamps and their scattered writes with one setter.
// (Kept SEPARATE from the per-tick noteRenderDead below — that has different
// bypass semantics: a note-host / force pass ignores this cooldown but still
// stands the rest of THIS tick down once a probe aborts.)
const renderBlockedUntil = {note: 0, pdf: 0};
const blockRender = (kind: 'note' | 'pdf', now: number): void => {
  renderBlockedUntil[kind] = now + PROBE_RETRY_MS;
};
// THE render-permission predicate (lot 3, 2026-08-16) — it was written twice
// (the note branch's skip and the drain's allowNote/allowPdf), and a future
// clause added to one copy would silently miss the other. A kind may render
// when the host HINT matches, on an explicit force poke (the "user switched
// apps" moments re-probe at once), or once the probe cooldown has elapsed.
// NOTE: the per-tick noteRenderDead stand-down is deliberately NOT folded in
// here — it has NO force bypass (its probe failed THIS tick, fresher than
// any hint) and dies with the tick; see its declaration.
const renderAllowed = (
  kind: 'note' | 'pdf',
  hostKind: 'note' | 'pdf' | null,
  force: boolean,
  now: number,
): boolean => hostKind === kind || force || now >= renderBlockedUntil[kind];
// For the Library auto-rebind (v0.88.3): true when PDF Vision debt exists
// but PDF renders are failing (stale host binding).
let pdfVisionBlocked = false;
export const isPdfVisionBlocked = (): boolean => pdfVisionBlocked;
// v0.88 (cost watch, device 2026-07-30: the page being written was read 3×
// in 40 s — each ink flush moves its rev): the CURRENT page is read at most
// once per minute, however many includeCurrent pokes land.
const CURRENT_READ_GAP_MS = 60_000;
let lastCurrentReadKey = '';
let lastCurrentReadAt = 0;
// Last observed render host (hint), for the Library's SYNC STATUS display.
let lastHostKind: 'note' | 'pdf' | null = null;
export const getLastHostKind = (): 'note' | 'pdf' | null => lastHostKind;
// Last footer signature seen for a MANUAL target's free refresh (they are
// never stamped — stamps mean "fully covered" — so without this they would
// re-walk on every tick). NOTE (2026-08-15): kept, NOT folded into the
// byte-size gate — a manual note with an unsynced backlog is storePending, so
// the byte gate never fires for it (forceProcess); and recording sizeAtSkip on
// the free path is unsafe because the .note writes bytes BEFORE the footer sig
// (firmware lag, bug 2026-07-15) — the grown size would seal a missed edit.
const manualSeenSig = new Map<string, string>();
// (manualStale removed in the sync-count redesign 2026-08-14 — the per-doc
// `doc.owed` in the store, written by recordOwed, is the ONE authoritative
// count now, read directly by the Library. An in-place edit still shows up
// because owed is a FRESH pagesNeedingRead, which compares revs.)

export type AutoTickResult = {
  ran: boolean;
  notesChecked: number;
  pagesRead: number; // pages read this pass
  reason?: string;
};

// Resolve the Auto engine-map to every concrete .note it covers: each
// folder key expands (recursively) to the .note files under it, each file
// key is itself, and the effective engine per note follows resolveAutoEngine
// (own entry over nearest ancestor folder). Returns notePath → AutoEngine.
// v0.88.3 perf: byte sizes seen during the LAST walk (listDir gives them
// for free). The .note format is append-only, so an unchanged size since
// the last fully-covered verdict means "nothing to do" without paying the
// ~3 footer reads per note that made every 20 s tick a 5 s bridge walk.
const walkSizes = new Map<string, number>();
const sizeAtSkip = new Map<string, number>();

export const resolveTrackedNotes = async (
  autoTargets: Record<string, AutoTarget>,
): Promise<Map<string, AutoTarget>> => {
  const candidates = new Set<string>();
  // What the DISK actually holds, and which directories really answered —
  // an empty listing is indistinguishable from a failed one (unmounted SD
  // card), so only a non-empty answer proves anything about absence.
  const seenOnDisk = new Set<string>();
  const answeredDirs = new Set<string>();
  walkSizes.clear();
  const walk = async (dir: string): Promise<void> => {
    const entries = await listDirNative(dir);
    if (entries.length > 0) {
      // Walk-time variant of folderEvidence's rule (lot 4b): a dir counts as
      // ANSWERED only when it returned entries — [] is empty OR failed, so it
      // proves nothing. Kept here because the walk already holds the listing
      // (a per-file folderEvidence call would re-list every folder).
      answeredDirs.add(dir);
    }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDir) {
        await walk(p);
      } else if (/\.(note|pdf)$/i.test(e.name)) {
        candidates.add(p);
        seenOnDisk.add(p);
        if (typeof e.size === 'number') {
          walkSizes.set(p, e.size);
        }
      }
    }
  };
  for (const key of Object.keys(autoTargets)) {
    if (isAutoFolderKey(key)) {
      await walk(key).catch(() => {});
    } else {
      candidates.add(key); // explicit .note or .pdf
    }
  }
  // An explicit per-file decision whose file is PROVEN gone from a folder
  // that really answered: the signature of a rename. Grouped by folder for
  // the adoption below (release audit 2026-08-12).
  const goneByDir = new Map<string, string[]>();
  for (const key of Object.keys(autoTargets)) {
    if (isAutoFolderKey(key) || seenOnDisk.has(key)) {
      continue;
    }
    const dir = key.slice(0, key.lastIndexOf('/'));
    if (!answeredDirs.has(dir)) {
      continue; // no proof — never guess a file away
    }
    goneByDir.set(dir, [...(goneByDir.get(dir) ?? []), key]);
  }
  // Files that EXIST with no decision of their own, per folder: the
  // inference below needs exactly one of those too, or it cannot tell
  // which file the vanished one became.
  const untrackedByDir = new Map<string, string[]>();
  for (const p of candidates) {
    if (autoTargets[p] !== undefined) {
      continue;
    }
    const dir = p.slice(0, p.lastIndexOf('/'));
    untrackedByDir.set(dir, [...(untrackedByDir.get(dir) ?? []), p]);
  }
  const out = new Map<string, AutoTarget>();
  for (const notePath of candidates) {
    let t = resolveAutoTarget(autoTargets, notePath);
    // A file with no decision of its own, sitting where one just vanished:
    // adopt the orphan's mode when it is STRICTER than what this path would
    // inherit. Renaming an Off notebook used to hand it to the folder's
    // Auto and get it read, billed and sent — the case the rename
    // follow-through could not cover, because an Off document has no
    // transcripts to relocate and nothing to infer a rename from.
    if (autoTargets[notePath] === undefined) {
      const dir = notePath.slice(0, notePath.lastIndexOf('/'));
      const adopted = orphanedModeFor(
        autoTargets,
        notePath,
        goneByDir.get(dir) ?? [],
        t?.mode ?? DEFAULT_MODE,
        untrackedByDir.get(dir) ?? [],
      );
      if (adopted !== null) {
        // IN MEMORY ONLY, for this tick's decision. The first version
        // called followRename here — which RETIRES the old document from
        // the store and moves its lock and agent references — on nothing
        // more than "an explicit entry's file is gone and an untracked
        // file sits in the same folder". That is a guess, and a guess must
        // never delete a paid transcript (verification pass 2026-08-12).
        // Deciding it fresh every tick costs nothing and writes nothing:
        // the protection holds for as long as the evidence does, and the
        // real rename follow-through still runs from the READ path, where
        // relocated transcripts prove the pairing.
        t = {mode: adopted.mode};
        console.log(
          '[SmartNoteAI.auto]',
          `${notePath.split('/').pop()}: reading as "${adopted.mode}" — the ` +
            `only untracked file where ${adopted.from.split('/').pop()} ` +
            'vanished (stricter of the two, nothing written)',
        );
      }
    }
    // Off = excluded from the AI; never read, even on an explicit Sync.
    if (t !== null && t.mode !== 'off') {
      out.set(notePath, t);
    }
  }
  return out;
};

// One background pass. Reads its own config (settings + key) so callers
// just need a CaptureDeps. Serialized: overlapping calls no-op.
// The ONE writer of doc.owed (sync-count redesign 2026-08-14). Computes the
// authoritative "still owes" counts from the engine's OWN read decision
// (pagesNeedingRead) plus the vision-owed count, and stores them. Called on
// EVERY doc-processing (free pass and paid pass), so the UI count can never
// drift from what "Sync now" actually reads — it IS that number.
// `precomputedReadPages` (a page LIST, not a count) reuses a pagesNeedingRead
// already run this pass, or expresses a whole-doc re-read (a changed PDF passes
// EVERY page); otherwise recordOwed re-runs pagesNeedingRead. The Vision count
// is ALWAYS derived disjoint from that read list — round-7 audit: an earlier
// version hard-set vision=0 on the precomputed path, so a fully-read note that
// still owed Vision showed as done. A failed change-check leaves the previous
// count untouched — never overwrite the truth with 0 on an error.
export const recordOwed = async (
  deps: CaptureDeps,
  notePath: string,
  wanted: number[],
  precomputedReadPages?: number[],
): Promise<void> => {
  const now = Date.now();
  let readPages = precomputedReadPages;
  if (readPages === undefined) {
    const need = await pagesNeedingRead(deps, notePath, wanted).catch(() => null);
    if (need === null) {
      return; // change-check failed — keep the last good count
    }
    // Exclude pages parked by the per-page failure backoff: the read loop
    // permanently drops them (needed.filter, failCapped 'read'), so counting them
    // would show "N to sync" that Sync-now can never clear — owed must be what
    // the reader ACTUALLY attempts (redesign audit 2026-08-14).
    readPages = need.filter(p => !failCapped('read', notePath, p));
  }
  const readList = readPages;
  await mutateStore(s => {
    const readSet = new Set(readList);
    const doc = s.docs[notePath];
    // Vision-owed pages DISJOINT from the read set: a page needing a re-read
    // redoes Vision too (counted in `read`), so it is NOT also in `vision`.
    // A page owing ONLY Vision (OCR done, Vision pending) IS counted — this is
    // exactly what a fully-read note with a Vision backlog needs (round-7).
    // A changed PDF passes every page in readSet → vision naturally 0.
    let vision = 0;
    if (doc !== undefined) {
      const isPdf = /\.pdf$/i.test(notePath);
      const ctx = {
        isPdf,
        docHash: doc.docHash ?? '',
        docLocked: doc.lock === true,
        pdfCovered: isPdf && (doc.docHash ?? '') !== '',
        hasPageCount: doc.pageCount !== undefined,
      };
      const total = docPageCount(s, notePath);
      for (let p = 0; p < total; p++) {
        if (readSet.has(p)) {
          continue;
        }
        if (pageStage(doc.pages[String(p)], ctx) === 'ocr') {
          vision++;
        }
      }
    }
    setOwed(s, notePath, {read: readList.length, vision}, now);
  });
};

export const autoTranscriptTick = async (
  deps: CaptureDeps,
  opts?: {
    force?: boolean;
    // 'background' (default): only mode==='auto' targets, live as you write.
    // 'sync': also mode==='manual' targets (the Library "Sync now" button).
    trigger?: 'background' | 'sync';
    // Only touch targets of this mode (v0.45: the Library Sync buttons act
    // on Manual targets ONLY — Auto catches up at its own tick; without the
    // filter, "Sync now" also force-read the Auto backlog).
    modeFilter?: 'manual' | 'auto';
    // v0.47 (device report: "Sync now" took minutes for 2 pages): `force`
    // only bypasses the 20 s tick gap now. Bypassing the footer-signature
    // skip too — cache invalidation + a FORCED structural walk of EVERY
    // tracked note — is opt-in via deepRecheck (the free "Check all notes
    // for changes" flow); a plain Sync now skips unchanged notes for ~3
    // small footer reads each.
    deepRecheck?: boolean;
    // Light pass (Library watch, v0.36.1): skip the current-note flush +
    // 600 ms sleep — the user is BROWSING, not writing; the flush every
    // 25 s was pure IO noise under the Library screen.
    skipCurrentFlush?: boolean;
    // v0.87.1 (device repro 2026-07-30): read the CURRENT page too on a
    // background tick. Set by pokes from the full-screen config/Library
    // views — the note behind cannot receive ink there, so the anti-blank-
    // render deferral has nothing to protect and would never release (the
    // note stays on that page while the user watches the Library). The
    // current-note flush above provides the same safety as Sync now.
    includeCurrent?: boolean;
    onProgress?: (label: string) => void;
  },
): Promise<AutoTickResult> => {
  const now = Date.now();
  // A foreground chat send is in flight → hold the background drain so the
  // user's request gets the shared rate budget (no self-inflicted 429).
  if (isForegroundBusy() && !opts?.force) {
    return {
      ran: false,
      notesChecked: 0,
      pagesRead: 0,
      reason: 'paused while you chat',
    };
  }
  // Already draining (drain-continue keeps a tick alive): a manual "Force
  // sync now" must say so, not the misleading "Nothing to sync" (bug report
  // 2026-07-23). Distinguished by a reason.
  if (running) {
    // Accepted trade (audit 9 #8): the queue is never reclaimed. If a
    // NATIVE promise ever hangs (SDK bug), sync stays parked until the
    // plugin restarts — visible below via the age, and strictly better
    // than the reclaim apparatus, whose interleavings double-paid twice.
    const mins = Math.round((now - lastTickAt) / 60_000);
    return {
      ran: false,
      notesChecked: 0,
      pagesRead: 0,
      reason:
        mins >= 5
          ? `a sync has been running for ${mins} min (restart the plugin if stuck)`
          : 'a sync is already running',
    };
  }
  if (
    !opts?.force &&
    (now - lastTickAt < MIN_TICK_GAP_MS || now - bootAt < STARTUP_GRACE_MS)
  ) {
    // Silent: pen-up drives this now, so it is called very often and
    // gated here — logging every gated call would flood logcat.
    return {ran: false, notesChecked: 0, pagesRead: 0};
  }
  running = true;
  // Hoisted out of the try so the finally can settle the session counter.
  let pagesRead = 0;
  let attended = false; // user-ordered work (sync / its backlog): uncapped
  let completedNormally = false;
  lastTickAt = now;
  try {
    const settings = await readSettings();
    const autoTargets = settings.autoTargets ?? {};
    const targetCount = Object.keys(autoTargets).length;
    const trigger = opts?.trigger ?? 'background';
    lastSyncAt = now;
    console.log(
      '[SmartNoteAI.auto]',
      `tick start: ${targetCount} Auto target(s) · ${trigger} (force=${!!opts?.force})`,
    );
    if (targetCount === 0) {
      console.log('[SmartNoteAI.auto]', 'nothing tracked → stop');
      return {ran: false, notesChecked: 0, pagesRead: 0};
    }
    // Cloud reads need the API key; 'local' targets don't. The consent
    // gate was REMOVED (user decision 2026-07-19): its silent skip
    // starved Auto for an afternoon after an accidental reset.
    const store = await loadStore();
    // Full review #5: a memory-only session (plugin dir unreachable, store
    // unreadable) sees ZERO coverage — reading now would re-bill the whole
    // library and the results could not even be persisted. No paid work.
    // Round 5 #8: suspend the PAID legs only. The free structural work
    // (walks, remaps, page-id refresh) still runs and still lands in the
    // shard files, so the Library stays truthful in a degraded session.
    const degraded = isDegradedLoad();
    if (degraded) {
      console.warn(
        '[SmartNoteAI.auto]',
        'degraded store session — structural work only, no paid reads',
      );
    }
    // Phase C, cap BY ORIGIN: the user's own work is never capped — an
    // explicit sync, and every drain-continue of ITS backlog (userBacklog
    // below), run attended. Only unattended background reads count toward
    // the runaway backstop and stop at it.
    // Consume-once (audit 9 #4): the flag is taken HERE and re-armed only
    // by a normal tick end that still drains — an early return (offline,
    // exception) can no longer leave it stale and disable the cap.
    attended = opts?.trigger === 'sync' || userBacklog;
    userBacklog = false;
    if (attended) {
      capLogged = false;
    }
    // v0.52 (phantom-backlog fix): the footer stamp asserts "covered"
    // without ever re-checking the STORE — entries lost after stamping
    // (remap on a partial parse, eviction) became invisible to Sync
    // forever while the frame kept counting them. A note the store shows
    // as incomplete bypasses the stamp skip below.
    const storePending = new Set<string>();
    for (const d of docsSummary(store)) {
      if (!d.pdfCovered && d.total - d.read > 0) {
        storePending.add(d.path);
      }
    }
    // Docs the store actually holds. A doc whose transcript was cleared is
    // absent here, and must NOT be skipped by the byte-size gate below
    // (review 2026-08-01 #4: "Clear transcript" then never re-read).
    const storeKnown = new Set(Object.keys(store.docs));
    const ks = await getApiKey();
    const key = ks.key;
    const tracked = await resolveTrackedNotes(autoTargets);

    // Flush the note currently being written. An IN-PLACE edit does NOT
    // change the page count, so ensureNoteFresh (which only saves on a count
    // mismatch) never flushes it — and the firmware writes lazily, so pen-up
    // fires while the footer is still stale (the edit would be skipped, and
    // a render would show the template only, not the fresh ink). Saving the
    // current note here makes the edit land in the footer THIS tick.
    let currentPath: string | null = null;
    let currentPage: number | null = null;
    // v0.86.5 (converged sync): the OPEN doc's type IS the render host — note
    // pages render only under the note app, PDF pages only under the document
    // app. We read the current path (cheap) to know which type we CAN render
    // right now. v0.87: null = unknown (no doc open / stat failed) → NO
    // renders this tick (attempts would fail for free and pollute the retry
    // budget); host-independent steps (PDF /v1/ocr) still run.
    let hostKind: 'note' | 'pdf' | null = null;
    try {
      const rawP = await deps.getCurrentFilePath();
      const p =
        typeof rawP === 'string'
          ? rawP
          : ((rawP as {result?: unknown})?.result as string);
      if (typeof p === 'string' && p.length > 0) {
        hostKind = /\.pdf$/i.test(p) ? 'pdf' : isNotePath(p) ? 'note' : null;
        lastHostKind = hostKind; // Library SYNC STATUS display (v0.88)
        if (tracked.has(p)) {
          // v0.88 (audit): the current path/page are ALWAYS read — a light
          // pass used to skip them, which dropped the blank-render deferral
          // of the on-screen page (a partial render could get billed and
          // stored as truth). Only the SAVE is light-skippable.
          currentPath = p;
          const rawPg = await deps.getCurrentPageNum().catch(() => null);
          const pg =
            typeof rawPg === 'number'
              ? rawPg
              : ((rawPg as {result?: unknown})?.result as number);
          currentPage = typeof pg === 'number' ? pg : null;
          if (opts?.skipCurrentFlush !== true) {
            console.log('[SmartNoteAI.auto]', `flush current note ${p.split('/').pop()}`);
            await deps.saveCurrentNote().catch(() => undefined);
            await sleepHybrid(600); // freeze-proof (audit C2)
            invalidateNoteCache(p);
          }
        }
      }
    } catch {
      // no current note — proceed
    }
    if (hostKind !== null) {
      console.log(
        '[SmartNoteAI.auto]',
        `render host = ${hostKind} → ${hostKind} renders + host-free steps`,
      );
    } else {
      console.log(
        '[SmartNoteAI.auto]',
        'render host unknown → no renders this tick (PDF OCR still runs)',
      );
    }

    let checked = 0;
    let postponed = 0;
    // Paid work is allowed when the store can keep the result AND, for
    // UNATTENDED work only, the session backstop still has room (the free
    // structural pass runs regardless — round 5 #8/#10).
    const capReached = (): boolean => {
      // The user's own work is never capped: an explicit sync (attended), and
      // its drain-continue ticks (userBacklog → attended), run uncapped. Only
      // UNATTENDED background reads count toward the runaway backstop.
      if (attended) {
        return false;
      }
      const hit = sessionPaidPages + pagesRead >= MAX_PAGES_PER_SESSION_BLOCK;
      if (hit && !capLogged) {
        capLogged = true;
        console.warn(
          '[SmartNoteAI.auto]',
          `session cap: ${sessionPaidPages + pagesRead} unattended paid ` +
            'page(s) — Auto pauses; Force sync / Sync now continues',
        );
      }
      return hit;
    };
    const mayPay = (): boolean => !degraded && !capReached();
    // v0.87.4 probe outcome: once a note read aborts on renders (host can't
    // render notes right now), the remaining notes stand down for this tick.
    let noteRenderDead = false;
    // v0.78.7: remember the first read failure reason (HTTP 401/429/…) so a
    // manual "Sync now" that reads 0 pages can SAY why instead of a bland
    // "Synced: 0 page(s)".
    let firstFailReason: string | undefined;
    // v0.79.14 (user confusion "1 page to read that never passes"): the ONLY
    // pending page was the one on screen, which is deferred by design. Track
    // it so a 0-read tick can SAY so instead of a bland "0 page(s) read".
    let deferredCurrentPage = false;
    for (const notePath of tracked.keys()) {
      checked++;
      if (isDocReadOnly(notePath)) {
        // Phase C: unreadable shard = read-only this session. Anything we
        // paid for here could not be persisted — skip, the next boot heals.
        continue;
      }
      if (stopRequested()) {
        console.log('[SmartNoteAI.auto]', 'tick stopped by user');
        break;
      }
      // A foreground chat send started mid-tick → yield the rate budget to it
      // (finish the current note first; the rest re-pokes when the send ends).
      if (isForegroundBusy()) {
        console.log('[SmartNoteAI.auto]', 'tick yielding to a chat send');
        break;
      }
      setActivity({
        label: 'Checking notes',
        done: checked,
        total: tracked.size,
      });
      const name = notePath.split('/').pop() ?? notePath;
      const target = tracked.get(notePath) as AutoTarget;
      if (opts?.modeFilter !== undefined && target.mode !== opts.modeFilter) {
        continue;
      }
      // An explicit user sync REALLY retries (verification pass 2026-08-12,
      // fix-verify 2026-08-16): the TAP re-arms this target's backoffs —
      // the whole-doc counter and every page's vision counter — so "use
      // Sync now to retry" is true for notes AND covered PDFs (the covered
      // gate below continues before the PDF branch, so this must run at
      // the top of the loop). trigger 'sync' ONLY, never bare force:
      // internal pokes (after a chat send, drain-continue, startup) carry
      // force and would re-arm doomed pages on every poke — unbounded
      // re-billing, the exact D14 class the ledger exists to close. Both
      // user buttons (Sync now, Force sync) pass trigger 'sync'.
      if (opts?.trigger === 'sync') {
        clearFailure('doc', notePath);
        clearFailuresFor('vision', notePath);
      }
      // v0.87.4 (user: "le plugin doit s'adapter tout seul"): the host HINT
      // (getCurrentFilePath) reflects which app last INVOKED the plugin —
      // not what is on screen — and goes stale when the user switches apps
      // with the chat or a config page open (device repro 2026-07-30:
      // `render host = note` while a PDF was displayed). So notes are no
      // longer gated on the hint: the first paid read PROBES reality —
      // CONSEC_RENDER_BREAK aborts after ≤3 FREE render failures — and a
      // failed probe stands the remaining notes down for THIS tick only.
      // The next tick re-probes: that is the "ping" that keeps the plugin
      // adaptive at ≤3 free renders per 20 s.
      const isCurrent = notePath === currentPath;
      // The ONE bypass shared by every skip gate below (byte-size + footer
      // stamp), defined ONCE so a future gate can't forget a guard — the class
      // of bug that had each audit bolt the storePending/deepRecheck guard onto
      // one gate at a time (v0.52, round-4, redesign audit). A note is always
      // PROCESSED (never skipped) when: the user asked for a deep re-check, it
      // is the note open on screen, or the STORE shows it incomplete (entries
      // lost to remap/evict/Clear after a stamp — v0.52 phantom-backlog fix).
      const forceProcess =
        opts?.deepRecheck === true || isCurrent || storePending.has(notePath);
      // Ghost-streak reset #1 (audit 2026-08-15): the folder walk SAW this file
      // on disk this tick (it has a size) → it is present, categorically not a
      // deleted ghost. Clear the streak HERE, before the byte-size skip below
      // can `continue` past the ghost logic at the bottom of the loop. Without
      // this a fully-covered note byte-skips every healthy tick and never
      // resets, so unrelated transient glitches accumulate to a FALSE prune
      // (removeDoc) of a real, paid transcript — the money bug the streak was
      // meant to prevent. Presence, not consecutiveness, is the real guarantee.
      if (isNotePath(notePath) && walkSizes.has(notePath)) {
        ghostStreak.delete(notePath);
      }
      // v0.88.3 perf (append-only format): same byte size as when this note
      // was last seen clean, and the store knows it → nothing to do, zero IO.
      // Any flushed edit grows the file and reopens the gate. `trigger==='sync'`
      // reopens it too: an explicit user sync re-verifies via the footer below
      // rather than trusting the byte cache (`force` alone — internal pokes —
      // does not, or it would undo the optimisation, round 2 #7).
      if (isNotePath(notePath)) {
        const sz = walkSizes.get(notePath);
        if (
          !forceProcess &&
          opts?.trigger !== 'sync' &&
          sz !== undefined &&
          sizeAtSkip.get(notePath) === sz &&
          storeKnown.has(notePath)
        ) {
          continue;
        }
      }
      // A background pass never PAYS for 'manual' targets — but their FREE
      // structural refresh runs anyway (user flow decision 2026-07-18: a
      // changed Manual note must show its fresh "N to read" without any
      // button; only the Mistral calls wait for Sync).
      const freeOnly = trigger === 'background' && target.mode === 'manual';

      // PDF target (Phase 3b): no footer/PAGEID structure. A cloud engine
      // pre-reads the WHOLE PDF in one /v1/ocr call (readPdf self-gates via
      // the file's byte length, so it no-ops when unchanged). 'local' PDF =
      // the embedded text, which the firmware only exposes for the OPEN
      // document, so background pre-read isn't possible — it's read on demand
      // when you open the PDF.
      if (!isNotePath(notePath)) {
        if (freeOnly || !mayPay()) {
          continue; // a PDF has no free structural scan
        }
        if (key === null) {
          console.log('[SmartNoteAI.auto]', `${name}: PDF needs the API key → skip`);
          continue;
        }
        // v0.87 host split: the OCR step runs under ANY host (it reads the
        // file bytes), but every Vision step renders via generateDocImage —
        // PDF host only. Unknown host = no renders.
        const canRenderPdf = hostKind === 'pdf';
        // Cheap size stat vs the stored docHash — the same signal readPdf
        // itself gates on, checked here WITHOUT fetching the whole PDF into
        // memory (v0.36: the old separate `pdf:<size>` stamp is gone; docHash
        // is the one PDF change signal). It MUST fold in the .mark size the
        // exact same way readPdf does (audit 2026-07-28): with the bare byte
        // size only, the FIRST annotation added to an already-read PDF left
        // the byte size unchanged, so this pre-gate skipped the file and the
        // annotation was never picked up by Auto or "Sync now".
        const size = await readFileSize(notePath).catch(() => null);
        const mSize =
          (await readFileSize(markFilePath(notePath)).catch(() => 0)) ?? 0;
        const pdfStore = await loadStore();
        const hashMatch =
          size !== null &&
          pdfPrintedCovered(pdfStore.docs[notePath], size ?? -1) &&
          pdfMarkSzOf(pdfStore.docs[notePath]) === mSize;
        // Skip only if the OCR is up to date AND every page has its Vision
        // (Option A 2026-07-29): a PDF whose Vision was interrupted (WiFi) has
        // pages still 'mistral-ocr' — readPdf's covered branch RESUMES them
        // without re-OCR, so the tick must NOT skip it.
        if (hashMatch) {
          if (pendingVisionPages(pdfStore, notePath).length === 0) {
            console.log('[SmartNoteAI.auto]', `${name}: PDF unchanged → skip`);
            continue;
          }
          // v0.87.4: Vision-only debt is the DRAIN's job exclusively — it
          // has the budget, the per-page 'vision' fail cap and the render
          // breaker. The old direct readPdf resume here bypassed every cap
          // (audit 2026-07-30 finding #1: a page whose Ministral read stays
          // empty was re-billed uncapped, twice per tick, forever).
          continue;
        }
        // Give up on a document that keeps failing, instead of paying for
        // the same doomed whole-file OCR at every tick (release audit).
        if (failCapped('doc', notePath)) {
          console.log(
            '[SmartNoteAI.auto]',
            `${name}: PDF failed ${failCap('doc')}× this session → parked ` +
              '(use Sync now to retry)',
          );
          continue;
        }
        const r = await readPdf(
          deps,
          key,
          assemblePdfVisionPrompt(settings.promptBlocks),
          notePath,
          {skipVision: !canRenderPdf, attended},
        ).catch(() => ({
          ok: false,
          read: 0,
          failed: [] as number[],
          reason: 'read threw',
        }));
        // Count FAILURES only (fix-audit lot-3 #0). The old `read === 0`
        // test also caught the paid-but-empty OCR (verification pass
        // 2026-08-12) — that case now returns ok:false from readPdf itself —
        // but it ALSO counted every SUCCESSFUL no-op (a covered resume with
        // its pages cap-deferred or hash-skipped) as a doc failure: three
        // quiet ticks parked a perfectly healthy PDF, and Sync could never
        // unpark it (the no-op repeated, the counter refilled).
        if (!r.ok) {
          // Nothing was stored and no docHash was stamped, so the next tick
          // would try the identical call. Count it, and SAY why — the
          // Library used to report "nothing new" while the bill grew.
          const n = noteFailure('doc', notePath);
          firstFailReason =
            firstFailReason ??
            (r as {reason?: string}).reason ??
            'PDF read failed';
          console.warn(
            '[SmartNoteAI.auto]',
            `${name}: PDF read failed (${n}/${failCap('doc')}) — ` +
              `${(r as {reason?: string}).reason ?? 'no reason given'}`,
          );
        } else {
          clearFailure('doc', notePath); // success — even a no-op — clears it
        }
        pagesRead += r.read;
        if (r.read > 0 && target.mode === 'auto') {
          recordAutoSync(name, r.read);
        }
        console.log(
          '[SmartNoteAI.auto]',
          `${name}: PDF pre-read (${r.read} page(s))` +
            (canRenderPdf ? '' : ' — Vision waits for a PDF host'),
        );
        continue;
      }
      // Change signal = the FOOTER SIGNATURE (the per-page block addresses),
      // NOT the file size. The old size stamp advanced the moment ink was
      // appended — but the firmware writes the footer LATER, so a tick in
      // between stamped the new size while the page content was still
      // invisible, then the note was skipped forever (bug 2026-07-15). The
      // footer signature only changes once an edit is actually flushed, so
      // stamping it can never mask a pending edit.
      const revs = await readFooterRevs(notePath).catch(
        () => new Map<number, string>(),
      );
      // 'v2:' epoch (2026-07-18): stamps written by the pre-v0.38.5 code
      // could mark notes covered while pages were deferred/failed — the
      // prefix bump invalidates ALL of them once, so the first tick
      // re-checks every note (free walk) and reads what is truly missing.
      const sig = revs.size > 0 ? 'v2:' + footerSignature(revs) : '';
      // Ghost-streak reset #2 (audit 2026-08-15): the footer read SUCCEEDED
      // (non-empty sig) → the file is present and parseable, so it is not a
      // ghost even if getNoteTotalPageNum/readFileSize glitch later this tick.
      // This covers the notes reset #1 misses: explicit per-file targets (never
      // in walkSizes) that stamp-skip below, and any present note that reaches
      // the footer without a walk size. Together the two resets make the streak
      // advance ONLY on ticks where BOTH the walk and the footer fail — i.e. a
      // genuinely absent file — so it is again truly "consecutive absent ticks".
      if (sig.length > 0) {
        ghostStreak.delete(notePath);
      }
      // The note you are actively writing in is ALWAYS processed (we just
      // flushed it above). The footer-signature skip is only an optimisation
      // for the OTHER tracked notes, which can't have changed since we last
      // saw them (they aren't open). `deepRecheck` bypasses it so a note
      // stuck with unread pages can always be re-checked by hand (device
      // bug 2026-07-18 — the stamp guard below prevents new occurrences;
      // v0.47: this bypass used to ride on `force`, which made every
      // "Sync now" re-walk the whole Manual library — minutes of bridge IO
      // to read 2 pages, the plugin frozen meanwhile).
      const stamp = getStamp(await loadStore(), notePath);
      if (!forceProcess && sig.length > 0 && stamp === sig) {
        console.log('[SmartNoteAI.auto]', `${name}: unchanged → skip`);
        {
          const sz = walkSizes.get(notePath);
          if (sz !== undefined) {
            sizeAtSkip.set(notePath, sz); // v0.88.3: next ticks skip for free
          }
        }
        continue; // footer identical to the last fully-covered pass
      }
      if (stamp === sig && storePending.has(notePath)) {
        console.log(
          '[SmartNoteAI.auto]',
          `${name}: stamp ok but the store shows unread pages → re-check`,
        );
      }
      if (freeOnly) {
        if (
          sig.length > 0 &&
          manualSeenSig.get(notePath) === sig &&
          // Like the byte-size and stamp gates, this fast-skip must NOT fire
          // when the store shows the doc incomplete — a note that lost entries
          // (evict / remap / Clear) after owed was written would be skipped
          // without refreshing owed, and the free-path recordOwed below never
          // runs → owed stays stale-low and the frame under-reports.
          !storePending.has(notePath) &&
          // Round-4 audit: nor when owed was INVALIDATED (upsertPage clears it —
          // the Vision drain, a chat read, a re-read) since it was last written.
          // The structural fallback cannot see an in-place edit (pageStage does
          // not compare footer revs), so a wiped owed must be recomputed here,
          // not skipped. owed defined ⇒ it is fresh (any write clears it).
          getOwed(await loadStore(), notePath) !== null
        ) {
          continue; // manual note unchanged since its last free refresh
        }
        manualSeenSig.set(notePath, sig);
      }
      // The KNOWN-changed case (a stamp exists and the footer signature
      // moved, or it's the note being written): drop the cached .note read
      // and FORCE the structural sync — refresh the free on-device OCR
      // baseline even when the page count is unchanged (bug 2026-07-15).
      // Otherwise (no stamp yet — e.g. covered via batch — or deepRecheck
      // on an unchanged note) the content-verified cache is trusted: a full
      // forced walk per note here is what froze the plugin for minutes on
      // "Sync now" (device report 2026-07-18).
      const knownChanged =
        isCurrent || (sig.length > 0 && stamp.length > 0 && stamp !== sig);
      if (knownChanged) {
        invalidateNoteCache(notePath);
      }
      opts?.onProgress?.(name);
      await syncNotePages(deps, notePath, knownChanged).catch(() => {});

      if (freeOnly) {
        // Manual + background: the store snapshot above refreshed the
        // structural counts, so an in-place edit finally shows up as "to
        // sync". The paid read waits for a Sync button. Record the
        // authoritative owed count from the fresh pagesNeedingRead.
        try {
          const totalM = await notePageCount(deps, notePath);
          if (totalM > 0) {
            const wantedM = Array.from({length: totalM}, (_, i) => i);
            const needM = await pagesNeedingRead(deps, notePath, wantedM);
            // Exclude pages parked by the per-page failure backoff — the read
            // loop and Sync-now permanently drop them, so owed must too, else it
            // shows an "N to sync" Sync-now can't clear (redesign audit).
            const readablePages = needM.filter(
              pp => !failCapped('read', notePath, pp),
            );
            await recordOwed(deps, notePath, wantedM, readablePages);
          }
        } catch {
          // keep the previous count
        }
        continue;
      }

      // The paid read needs the key. Missing → skip and DON'T stamp (retried).
      if (key === null) {
        console.log('[SmartNoteAI.auto]', `${name}: needs the API key → skip`);
        continue;
      }
      if (noteRenderDead) {
        continue; // this tick's probe already showed note renders failing
      }
      if (!renderAllowed('note', hostKind, opts?.force === true, Date.now())) {
        continue; // cross-host probe failed <60 s ago — no re-render yet
      }

      const total = await notePageCount(deps, notePath);
      if (total <= 0) {
        // A tracked note that walks to 0 pages while the store STILL holds a
        // transcript for it is either a genuinely deleted note (ghost) or a
        // transient native glitch. Tell them apart by the FILE: readFileSize
        // returns null when it cannot be opened at all. Only a ghost stays
        // unreadable tick after tick — purge it after CONSEC_GHOST_TICKS so its
        // stale "1 to read" stops haunting the count; a real note whose file
        // blips back resets the streak and keeps its transcript (never re-billed).
        const isTracked = store.docs[notePath] !== undefined;
        const sz = isTracked
          ? await readFileSize(notePath).catch(() => null)
          : 0;
        if (isTracked && (sz === null || sz <= 0)) {
          // Storage-outage guard (audit 2026-08-15): readFileSize===null cannot
          // by itself tell a DELETED file from one on a volume that is briefly
          // unmounted / MTP-locked / stalled — during an outage the walk, the
          // footer read AND readFileSize all fail on a PRESENT file, and pruning
          // it would delete + re-bill an intact transcript. Confirm the file is
          // REALLY gone via THE evidence primitive (lot 4b — folderEvidence,
          // the same "empty listing != failed listing" rule every proof uses):
          const ev = await folderEvidence(notePath);
          if (ev === 'present') {
            // The folder still lists this file → it exists, we just could not
            // open it this tick (a lock / transient) → not a ghost.
            ghostStreak.delete(notePath);
            console.log(
              '[SmartNoteAI.auto]',
              `${name}: 0 pages but the folder still lists it (locked?) → hold, no prune`,
            );
            continue;
          }
          if (ev === 'no-proof') {
            // Empty / unreadable listing = no proof storage is even live →
            // hold the streak (neither advance nor reset) and never prune.
            // Fail-safe: a lingering ghost is cosmetic and Clear-able; a false
            // prune costs money.
            console.log(
              '[SmartNoteAI.auto]',
              `${name}: 0 pages, folder empty/unreadable (storage down?) → hold, no prune`,
            );
            continue;
          }
          // 'proven-gone': the folder ANSWERED with other files, not this one.
          const n = (ghostStreak.get(notePath) ?? 0) + 1;
          if (n >= CONSEC_GHOST_TICKS) {
            ghostStreak.delete(notePath);
            console.log(
              '[SmartNoteAI.auto]',
              `${name}: file gone for ${CONSEC_GHOST_TICKS} ticks → pruning ghost transcript`,
            );
            await mutateStore(s => removeDoc(s, notePath));
          } else {
            ghostStreak.set(notePath, n);
            console.log(
              '[SmartNoteAI.auto]',
              `${name}: 0 pages, file unreadable (${n}/${CONSEC_GHOST_TICKS}) → skip`,
            );
          }
        } else {
          ghostStreak.delete(notePath); // file present (empty note) — not a ghost
          console.log('[SmartNoteAI.auto]', `${name}: 0 pages → skip`);
        }
        continue;
      }
      ghostStreak.delete(notePath); // walked fine → not a ghost
      const wanted = Array.from({length: total}, (_, i) => i);
      // Audit 2026-07-30: a THROW here must not read as "nothing needed" —
      // that stamped the note at the current footer sig with a masked edit
      // behind it. An errored check skips the note WITHOUT stamping.
      let needCheckFailed = false;
      let needed = await pagesNeedingRead(deps, notePath, wanted).catch(() => {
        needCheckFailed = true;
        return [] as number[];
      });
      if (needCheckFailed) {
        console.log(
          '[SmartNoteAI.auto]',
          `${name}: change-check failed, retried next tick (not stamped)`,
        );
        continue;
      }
      // Backoff: drop pages that already failed failCap('read') times this
      // session (they'd be re-billed every tick otherwise).
      let failSkipped = false;
      {
        const before = needed.length;
        needed = needed.filter(
          p => !failCapped('read', notePath, p),
        );
        if (needed.length !== before) {
          failSkipped = true;
          console.log(
            '[SmartNoteAI.auto]',
            `${name}: ${before - needed.length} page(s) skipped after ${failCap(
              'read',
            )} failures (this session)`,
          );
        }
      }
      // Never read the page you're LOOKING AT: while a page is displayed its
      // render (generateNotePng) comes back blank/partial even after a save,
      // so a background read of it stores an empty transcript (device report
      // 2026-07-15: the page you end on came back empty). Defer it — it is
      // read on the next tick once you've turned away (saved, not current).
      // Defer the page you're LOOKING AT — but ONLY on a background tick.
      // While a page is displayed its render can come back blank/partial, so
      // a silent background read would store an empty transcript. On an
      // EXPLICIT sync (Force sync / Sync now, trigger==='sync') the user asked
      // for it: read it (the note is saved first) rather than leave a page
      // that "never passes" (user 2026-07-25).
      let currentDeferred = false;
      // v0.88 cost guard: even with includeCurrent, the SAME current page is
      // read at most once per minute — the page being written moves its rev
      // at every ink flush and was billed 3× in 40 s (device 2026-07-30).
      const curKey = `${notePath}#${currentPage ?? -1}`;
      const currentReadTooSoon =
        isCurrent &&
        currentPage !== null &&
        lastCurrentReadKey === curKey &&
        now - lastCurrentReadAt < CURRENT_READ_GAP_MS;
      if (
        isCurrent &&
        currentPage !== null &&
        needed.includes(currentPage) &&
        ((trigger === 'background' && opts?.includeCurrent !== true) ||
          currentReadTooSoon)
      ) {
        currentDeferred = true; // not covered yet → the stamp must wait
        deferredCurrentPage = true;
        needed = needed.filter(p => p !== currentPage);
        console.log(
          '[SmartNoteAI.auto]',
          `${name}: deferring current page p.${currentPage + 1} (read once you leave it)`,
        );
      }
      console.log(
        '[SmartNoteAI.auto]',
        `${name}: total=${total} pages, needing a paid read=${needed.length}`,
      );
      // Per-tick yield boundary only — the rest is re-picked next chunk
      // (drain-continue re-pokes immediately when a backlog remains).
      const budget = MAX_PAGES_PER_TICK - pagesRead;
      const todo = needed.slice(0, Math.max(0, budget));
      postponed += needed.length - todo.length;
      let noteOk = true; // did every attempted page actually land?
      // The free structural pass above already ran for this note; only the
      // PAID read is gated by the backstop / degraded store.
      if (todo.length > 0 && mayPay()) {
        const r = await readNotePages(
          deps,
          key,
          assembleVisionPrompt(settings.promptBlocks),
          notePath,
          todo,

        ).catch(() => ({
          ok: false,
          read: 0,
          failed: todo,
          reason: 'read failed',
        }));
        pagesRead += r.read;
        if (r.read > 0 && target.mode === 'auto') {
          recordAutoSync(name, r.read);
        }
        noteOk = r.ok;
        if ((r as {renderAborted?: boolean}).renderAborted === true) {
          noteRenderDead = true; // stand the other notes down for this tick
          blockRender('note', Date.now());
        }
        if (
          isCurrent &&
          currentPage !== null &&
          todo.includes(currentPage) &&
          !r.failed.includes(currentPage)
        ) {
          lastCurrentReadKey = curKey; // v0.88: 60 s gap before re-reading it
          lastCurrentReadAt = Date.now();
        }
        // v0.87: a RENDER failure is free (no API call) and usually means the
        // host, not the page — it must not consume the paid-failure budget,
        // or a few wrong-host ticks park the page for the whole session.
        const freeRenderFails = new Set(
          (r as {renderFailed?: number[]}).renderFailed ?? [],
        );
        for (const p of todo) {
          if (r.failed.includes(p)) {
            if (!freeRenderFails.has(p)) {
              noteFailure('read', notePath, p);
            }
          } else {
            clearFailure('read', notePath, p);
          }
        }
        if (!r.ok && r.reason !== undefined && /Network error/i.test(r.reason)) {
          console.log('[SmartNoteAI.auto]', `offline, tick aborted (${r.reason})`);
          return {ran: true, notesChecked: checked, pagesRead, reason: r.reason};
        }
        if (!r.ok) {
          // v0.78.7: surface WHY — the live read path only said "failed to
          // read", so a 401 (key rejected / free monthly quota exhausted) and
          // a 429 (rate limit) looked identical in the logs. r.reason carries
          // the HTTP status from mistralRequest.
          if (firstFailReason === undefined) {
            firstFailReason = r.reason;
          }
          console.log(
            '[SmartNoteAI.auto]',
            `${name}: ${r.failed.length} page(s) failed to read → NOT stamped, ` +
              `will retry${r.reason !== undefined ? ` — ${r.reason}` : ''}`,
          );
        }
      }
      // Stamp the FOOTER SIGNATURE only when the whole backlog was covered
      // AND every page actually landed (device bug 2026-07-18: stamping on
      // ATTEMPT, not success, marked failed pages "done" and skipped the
      // note forever — it sat at "2 pages to read" that never drained). A
      // postponed backlog or any failure leaves it unstamped → retried.
      const fullyCovered =
        needed.length === todo.length &&
        noteOk &&
        !currentDeferred &&
        !failSkipped;
      if (fullyCovered && sig.length > 0) {
        await mutateStore(s => setStamp(s, notePath, sig));
      }
      if (fullyCovered) {
        manualSeenSig.delete(notePath); // next free pass recounts fresh
        const szc = walkSizes.get(notePath);
        if (szc !== undefined) {
          sizeAtSkip.set(notePath, szc);
        }
      }
      // The ONE owed writer (redesign 2026-08-14): a FRESH pagesNeedingRead
      // over the just-updated store, so "N to sync" is exactly what a
      // subsequent Sync-now would read. Replaces manualStale, whose conditional
      // write/clear went stale — the "N to sync that Sync-now can't clear" class.
      // When the note is fullyCovered we KNOW the READ leg is done: pass an EMPTY
      // read list so owed.read=0 directly — a transient pagesNeedingRead failure
      // in recordOwed (which then keeps the last count) can't leave a covered
      // note stuck at a stale-HIGH owed that the stamp-skip locks in forever.
      // recordOwed still derives the DISJOINT vision from that empty read set, so
      // OCR-only pages awaiting Vision remain visible (round-7 audit: passing 0
      // there hard-set vision=0 and hid the Vision backlog).
      await recordOwed(
        deps,
        notePath,
        wanted,
        fullyCovered ? [] : undefined,
      );
    }
    // v0.87 Vision drain — "no OCR-only page left behind" (user rule
    // 2026-07-30): finish the Vision leg of every stored OCR-only page the
    // CURRENT host can render (notes under a note host, PDFs under a PDF
    // host), for every mode except Off — that OCR was paid on a legitimate
    // trigger, finishing its Vision is completing the same read, not a new
    // spend. Budget shared with the structural reads above; per-page session
    // retry cap via the 'vision' fail ledger; the page on screen defers like everywhere
    // else (its render can come back blank on a background pass).
    // v0.87.4: no `kind` filter and no host gate any more — the drain
    // attempts BOTH types every tick and lets the per-kind render breakers
    // (≤3 free failures each) discover what the real host can render. This
    // is the "ping" that makes the plugin follow the user across apps
    // without re-opening it from the right one.
    let visionTruncated = 0;
    const visionBudget = MAX_PAGES_PER_TICK - pagesRead;
    // v0.88.3: a kind whose render probe failed <60 s ago is not re-probed
    // (force pokes re-probe at once — the "user switched apps" moments).
    const nowP = Date.now();
    const allowNote = renderAllowed('note', hostKind, opts?.force === true, nowP);
    const allowPdf = renderAllowed('pdf', hostKind, opts?.force === true, nowP);
    if (
      key !== null &&
      visionBudget > 0 &&
      (allowNote || allowPdf) &&
      !degraded &&
      !capReached() &&
      !stopRequested() &&
      !isForegroundBusy()
    ) {
      const fv = await finishVisionLive(
        deps,
        key,
        assembleVisionPrompt(settings.promptBlocks),
        {
          ...(allowNote && allowPdf
            ? {}
            : {kind: allowNote ? ('note' as const) : ('pdf' as const)}),
          limit: visionBudget,
          attendedHint: attended,
          shouldStop: stopRequested,
          onProgress: (done, totalV) =>
            setActivity({label: 'Vision', done, total: totalV}),
          pageFilter: (path, page) =>
            !capReached() &&
            !failCapped('vision', path, page) &&
            !(
              trigger === 'background' &&
              opts?.includeCurrent !== true &&
              path === currentPath &&
              page === currentPage
            ),
          onPageOutcome: (path, page, ok) => {
            if (ok) {
              clearFailure('vision', path, page);
            } else {
              noteFailure('vision', path, page);
            }
          },
        },
      ).catch(() => null);
      if (fv !== null) {
        pagesRead += fv.read;
        visionTruncated = fv.truncated;
        if (fv.read > 0 || fv.pending > 0) {
          console.log(
            '[SmartNoteAI.auto]',
            `vision drain: ${fv.read} page(s) finished` +
              (fv.pending > 0 ? `, ${fv.pending} still pending` : '') +
              (fv.truncated > 0 ? `, ${fv.truncated} over budget → draining` : ''),
          );
        }
        if (
          firstFailReason === undefined &&
          fv.pending > 0 &&
          fv.reason !== undefined
        ) {
          firstFailReason = fv.reason;
        }
        const fb = fv as {
          noteBlocked?: boolean;
          pdfBlocked?: boolean;
          pdfAttempted?: boolean;
        };
        if (fb.noteBlocked === true) {
          blockRender('note', Date.now());
        }
        if (fb.pdfBlocked === true) {
          blockRender('pdf', Date.now());
        }
        // Only a pass that actually ATTEMPTED PDFs may move this flag
        // (review 2026-08-01 #6: a note-only pass cleared it, so the
        // Library's manual "Resume PDF Vision" button kept vanishing).
        // "PDFs were ATTEMPTED", not merely "allowed": a pass whose budget
        // went to notes must not clear a real PDF block (round 2 #6).
        if (allowPdf && fb.pdfAttempted === true) {
          pdfVisionBlocked = fb.pdfBlocked === true;
        }
      }
    }
    if (pagesRead > 0) {
      await flushStore();
    }
    console.log(
      '[SmartNoteAI.auto]',
      `tick done: ${checked} note(s) checked, ${pagesRead} page(s) read` +
        (postponed > 0 ? `, ${postponed} postponed → draining` : ''),
    );
    // Drain-continue: a backlog bigger than one chunk keeps flowing instead
    // of waiting for the 15-min heartbeat. The re-poke fires after `running`
    // clears (in the finally) and is Stop-able like any tick. Vision pages
    // over this tick's budget (truncated) drain the same way.
    const draining =
      (postponed > 0 || visionTruncated > 0) && pagesRead > 0 && !stopRequested();
    // The user's standing order travels with ITS backlog: drain-continue
    // ticks of an attended sync stay attended (uncapped); once the backlog
    // is done, background work goes back under the backstop.
    userBacklog = draining && attended;
    completedNormally = true;
    if (draining) {
      pokeAuto('drain-continue', {force: true});
    }
    // Reason precedence: a real read failure first; otherwise, if the only
    // thing left unread was the page on screen, say so (that "1 page that
    // never passes" is by design — it reads once you turn away from it).
    const reason =
      firstFailReason ??
      (pagesRead === 0 && postponed === 0 && deferredCurrentPage
        ? "the page you're on syncs once you leave it"
        : undefined);
    return {
      ran: true,
      notesChecked: checked,
      pagesRead,
      ...(reason ? {reason} : {}),
    };
  } finally {
    // Round 10 #9: an exception mid-drain must not demote the user's
    // order — re-arm the consumed flag so the next tick resumes attended.
    if (attended && !completedNormally) {
      userBacklog = true;
    }
    if (!attended) {
      sessionPaidPages += pagesRead; // only unattended work counts
    }
    setActivity(null);
    running = false;
    // Replay the explicit poke that landed while this tick ran (its flags
    // intact — includeCurrent above all). Goes through the normal debounce.
    if (queuedPoke !== null) {
      const q = queuedPoke;
      queuedPoke = null;
      pokeAuto(q.why, q.opts);
    }
  }
};

const notePageCount = async (
  deps: CaptureDeps,
  notePath: string,
): Promise<number> => {
  try {
    const raw = await deps.getNoteTotalPageNum(notePath);
    const n =
      typeof raw === 'number'
        ? raw
        : ((raw as {result?: unknown})?.result as number);
    return typeof n === 'number' ? n : 0;
  } catch {
    return 0;
  }
};

/* ---------------- the ONE Auto scheduler (v0.36 §1.3) ---------------- */
// All background triggers funnel here. index.js starts the scheduler once
// at plugin load (periodic fallback tick); every surface event — pen-up,
// page turn, config open, Library watch — just pokes it. Debounce here,
// 20 s floor + serialization inside autoTranscriptTick: the timing is
// designed in ONE place instead of five hand-wired timers (audit
// 2026-07-17).

const PERIODIC_MS = 15 * 60_000;
const POKE_DELAY_MS = 1_500;
// A pending debounce older than this = its JS timer is FROZEN (RN pauses
// timers while the plugin view is backgrounded — the writing-in-the-note
// situation). Device 2026-07-30: a pen-up poke scheduled mid-writing sat
// frozen forever and silently ate every later poke.
export const POKE_STALE_MS = 5_000;
let schedDeps: CaptureDeps | null = null;
let periodic: ReturnType<typeof setInterval> | null = null;
let pokePending: ReturnType<typeof setTimeout> | null = null;
let pokePendingAt = 0;
let pokePendingWhy = '';
type PokeOpts = {force?: boolean; light?: boolean; includeCurrent?: boolean};
let pokePendingOpts: PokeOpts = {};
// An EXPLICIT poke (force / includeCurrent) that landed while a tick was
// running — re-fired right after that tick ends instead of being dropped
// (device 2026-07-30: the Library's includeCurrent poke landed during the
// startup walk and vanished; the edited current page was never read).
let queuedPoke: {why: string; opts: PokeOpts} | null = null;

const mergePokeOpts = (a: PokeOpts, b: PokeOpts): PokeOpts => ({
  ...(a.force === true || b.force === true ? {force: true} : {}),
  ...(a.includeCurrent === true || b.includeCurrent === true
    ? {includeCurrent: true}
    : {}),
  // light only survives if EVERY merged poke asked for a light pass.
  ...(a.light === true && b.light === true ? {light: true} : {}),
});

const firePoke = (why: string, opts: PokeOpts): void => {
  const deps = schedDeps;
  if (deps === null) {
    return;
  }
  if (running) {
    // Periodic pokes (heartbeat, pen-up) come back on their own — but an
    // explicit one carries user intent and must survive the running tick
    // (queued here, replayed by the tick's finally).
    if (opts.force === true || opts.includeCurrent === true) {
      queuedPoke = {
        why: `${why} (queued)`,
        opts: queuedPoke === null ? opts : mergePokeOpts(queuedPoke.opts, opts),
      };
    }
    return;
  }
  console.log('[SmartNoteAI.auto]', `poke: ${why}`);
  autoTranscriptTick(deps, {
    ...(opts.force === true ? {force: true} : {}),
    ...(opts.light === true ? {skipCurrentFlush: true} : {}),
    ...(opts.includeCurrent === true ? {includeCurrent: true} : {}),
  }).catch(() => {});
};

export const startAutoScheduler = (deps: CaptureDeps): void => {
  schedDeps = deps;
  hydrateRecentAutoSyncs().catch(() => {});
  if (periodic === null) {
    periodic = setInterval(() => {
      autoTranscriptTick(deps).catch(() => {});
    }, PERIODIC_MS);
    // Kick a first pass ~5 s after launch (force: past the startup grace) so
    // an Auto backlog starts draining on its own, without waiting for the
    // 15-min heartbeat or a manual poke. drain-continue then carries it to
    // completion. Fire-and-forget; the tick's own guards keep it safe.
    setTimeout(() => pokeAuto('startup', {force: true}), 5000);
  }
};

// Ask for a pass "soon". No-op before startAutoScheduler (index.js runs
// it at plugin load, so in practice: never). force bypasses the 20 s
// floor (plugin-start catch-up).
export const pokeAuto = (why: string, opts?: PokeOpts): void => {
  if (schedDeps === null) {
    return;
  }
  const o: PokeOpts = opts ?? {};
  if (pokePending !== null) {
    // Debounce coalescing keeps the FLAGS: the merged poke must be at least
    // as strong as each of its parts (a swallowed includeCurrent is exactly
    // the 2026-07-30 device bug).
    pokePendingOpts = mergePokeOpts(pokePendingOpts, o);
    // Frozen-timer flush: JS timers pause while the plugin view is
    // backgrounded, so this pending debounce may never fire on its own —
    // but THIS call proves JS is running (native events still execute), so
    // an overdue debounce is fired inline right now.
    if (Date.now() - pokePendingAt > POKE_STALE_MS) {
      clearTimeout(pokePending);
      pokePending = null;
      firePoke(`${pokePendingWhy} (thawed)`, pokePendingOpts);
    }
    return;
  }
  pokePendingWhy = why;
  pokePendingOpts = o;
  pokePendingAt = Date.now();
  pokePending = setTimeout(() => {
    pokePending = null;
    firePoke(pokePendingWhy, pokePendingOpts);
  }, POKE_DELAY_MS);
};

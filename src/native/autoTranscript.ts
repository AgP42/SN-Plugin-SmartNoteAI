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
  pagesOwedVision,
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
import {followRename} from './renameFollow';

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

// v0.87 "Sync now is an ORDER, not a tap-again loop" (user 2026-07-30):
// MANUAL docs whose sync the user explicitly requested and whose debt is not
// gone yet (chunked >100 pages, offline cut, wrong render host, Vision
// pending). Background ticks treat them as paid-allowed until the debt —
// Vision included — clears, then drop them. PERSISTED (survives restarts);
// ONE writer: this module.
let manualWanted = new Set<string>();
// True when the attended bypass came from an order RESTORED at boot rather
// than a tap in this session (release audit 2026-08-12).
let hydratedOrder = false;
export const hydrateManualWanted = async (): Promise<void> => {
  try {
    manualWanted = new Set((await readSettings()).manualSyncWanted ?? []);
    if (manualWanted.size > 0) {
      // A persisted Sync-now order resumes as the user's own work: the
      // first tick runs attended, and the flag then lives only while the
      // backlog actually progresses (round 10 #2/#9).
      userBacklog = true;
      hydratedOrder = true;
    }
  } catch {
    // memory set stays; the next persist writes it anyway
  }
};
export const getManualWanted = (): ReadonlySet<string> => manualWanted;
// User decision 2026-08-03: a standing Sync-now order must be CANCELLABLE
// without mode gymnastics. No path = cancel them all.
export const cancelManualSync = (path?: string): void => {
  if (path !== undefined) {
    manualWanted.delete(path);
  } else {
    manualWanted.clear();
  }
  persistManualWanted();
};
// The file this order was placed on was RENAMED (2026-08-10). The engine
// deliberately never prunes on absence, so without this the order sits
// inert forever — and a non-empty manualWanted keeps the unattended spend
// cap bypassed for the whole session (see mayPayFor). ONE writer: this
// module owns manualSyncWanted, so the rename follow-through calls in.
export const renameManualWanted = (from: string, to: string): void => {
  if (!manualWanted.has(from)) {
    return;
  }
  manualWanted.delete(from);
  manualWanted.add(to);
  persistManualWanted();
};

const persistManualWanted = (): void => {
  updateSettings({manualSyncWanted: [...manualWanted]}).catch(() => {});
};

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
// Per-page failure counter (session-scoped): a page that keeps failing
// (blank render, non-network API error) is retried at most MAX_PAGE_FAILS
// times, then skipped — it used to be re-billed on EVERY tick with no
// backoff and without counting toward the session cap (audit 2026-07-18).
const MAX_PAGE_FAILS = 3;
const pageFails = new Map<string, number>();
// v0.87 Vision drain: session retry counter for the VISION leg alone. A page
// whose vision keeps failing — or keeps coming back empty (it is re-stored
// 'mistral-ocr': no promotion without a real Ministral read, user rule
// 2026-07-30) — would otherwise be re-billed by every tick's drain. Render
// failures never reach this map (free, no API call — see onPageOutcome).
const visionFails = new Map<string, number>();
// Release audit 2026-08-12 (critical): the PDF branch of the tick had NO
// failure accounting at all. A whole-file OCR that fails stores nothing and
// stamps no docHash, so the document looked untouched and was re-uploaded —
// and re-billed — at EVERY tick, forever. It was invisible to the session
// cap too (that counts pages READ, and a failure reads none), so the 500-page
// backstop could never engage. Same shape as pageFails, per DOCUMENT.
const MAX_PDF_FAILS = 3;
const pdfFails = new Map<string, number>();
export const getPdfFails = (): ReadonlyMap<string, number> => pdfFails;
// v0.88.3 perf: a failed render PROBE is not retried for a minute (except on
// explicit/force pokes) — the v0.87.4 "ping" attempted 3 doomed renders on
// EVERY 20 s tick, a steady tax on the e-ink UI thread.
const PROBE_RETRY_MS = 60_000;
let lastNoteProbeFailAt = 0;
let lastPdfProbeFailAt = 0;
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
// re-walk on every tick).
const manualSeenSig = new Map<string, string>();
// v0.53 (device report: an EDITED Manual page showed "0 to sync"): an
// in-place edit keeps its store entry, so the structural counters
// (total − entries) can't see it — only pagesNeedingRead (rev compare)
// can, and it's FREE. This map carries the last known per-note stale
// count; the Library counters override structure with it when present.
const manualStale = new Map<string, number>();
export const getManualStale = (): ReadonlyMap<string, number> => manualStale;
export const setManualStale = (path: string, n: number): void => {
  manualStale.set(path, n);
};

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
      );
      if (adopted !== null) {
        t = {mode: adopted.mode};
        console.log(
          '[SmartNoteAI.auto]',
          `${notePath.split('/').pop()}: adopting "${adopted.mode}" from ` +
            `${adopted.from.split('/').pop()} (renamed — mode kept)`,
        );
        // Persist it, so the decision is made once and everything else the
        // old path carried (agents, standing order) follows too.
        followRename(adopted.from, notePath).catch(() => {});
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
  let paidThisTick = 0;
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
    // Round 10 #2: manualWanted.size alone must NOT make every tick
    // attended — one stuck order would disable the cap for the whole
    // session (and it persists). Instead the flag is re-armed at boot
    // (hydrateManualWanted) and then lives ONLY while the backlog actually
    // progresses; a stuck order stops draining and the cap re-engages.
    attended = opts?.trigger === 'sync' || userBacklog;
    const fromHydratedOrder =
      attended && hydratedOrder && opts?.trigger !== 'sync';
    hydratedOrder = false;
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
    // Round 13 #2: a Sync-now order whose doc left Manual mode is STALE —
    // pruned HERE, before any spending decision, not after the drain
    // already used it to open the cap gate. Round 14 #4 (amended in
    // self-review): absence from `tracked` is NEVER proof — the folder
    // walk swallows listDir failures, and readFileSize's null covers
    // transient errors too. Only an explicit mode change prunes; an order
    // for a vanished file just sits inert (its doc is never processed, so
    // it can neither spend nor open any gate) until a real signal.
    {
      let pruned = false;
      for (const p of [...manualWanted]) {
        const t0 = tracked.get(p);
        if (t0 !== undefined && t0.mode !== 'manual') {
          manualWanted.delete(p);
          pruned = true;
        }
      }
      if (pruned) {
        persistManualWanted(); // one write, coalesced (round 14 #8)
      }
    }

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

    let pagesRead = 0;
    let checked = 0;
    let postponed = 0;
    // Paid work is allowed when the store can keep the result AND, for
    // UNATTENDED work only, the session backstop still has room (the free
    // structural pass runs regardless — round 5 #8/#10).
    const capReached = (): boolean => {
      if (attended) {
        return false; // the user's own work is never capped
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
    // Round 11 #5: the user's persisted Sync-now order is PER DOCUMENT.
    // Whatever happened to the session flags (a stalled order resuming on
    // a background tick after connectivity returns), spending for a doc
    // the user explicitly ordered is never capped — only degraded blocks.
    const mayPayFor = (path: string): boolean =>
      !degraded && (manualWanted.has(path) || !capReached());
    // v0.87: docs whose STRUCTURAL debt is known clear after this tick
    // (stamp-skip "unchanged", or fully covered this pass) — the manualWanted
    // sweep below only releases a wanted doc from this set (and only once its
    // Vision debt is gone too).
    const coveredThisTick = new Set<string>();
    let wantedDirty = false;
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
      // v0.87: an explicit manual sync REGISTERS the order — it persists
      // until the doc's debt (Vision included) is gone, so an interrupted /
      // chunked / wrong-host "Sync now" finishes by itself later.
      if (
        trigger === 'sync' &&
        target.mode === 'manual' &&
        !manualWanted.has(notePath)
      ) {
        manualWanted.add(notePath);
        wantedDirty = true;
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
      // v0.88.3 perf (append-only format): same byte size as when this note
      // was last seen fully covered, and the store agrees → nothing to do,
      // zero IO. Any flushed edit grows the file and reopens the gate.
      if (isNotePath(notePath)) {
        const sz = walkSizes.get(notePath);
        if (
          !opts?.deepRecheck &&
          // Only an explicit user sync reopens the gate. `force` alone is
          // set by every internal poke (drain-continue, foreground-done,
          // app-active), which would undo the optimisation (round 2 #7).
          opts?.trigger !== 'sync' &&
          !isCurrent &&
          sz !== undefined &&
          sizeAtSkip.get(notePath) === sz &&
          storeKnown.has(notePath) &&
          !storePending.has(notePath)
        ) {
          coveredThisTick.add(notePath);
          continue;
        }
      }
      // A background pass never PAYS for 'manual' targets — but their FREE
      // structural refresh runs anyway (user flow decision 2026-07-18: a
      // changed Manual note must show its fresh "N to read" without any
      // button; only the Mistral calls wait for Sync). Exception (v0.87): a
      // doc under a standing "Sync now" order (manualWanted) is paid-allowed.
      const freeOnly =
        trigger === 'background' &&
        target.mode === 'manual' &&
        !manualWanted.has(notePath);

      // PDF target (Phase 3b): no footer/PAGEID structure. A cloud engine
      // pre-reads the WHOLE PDF in one /v1/ocr call (readPdf self-gates via
      // the file's byte length, so it no-ops when unchanged). 'local' PDF =
      // the embedded text, which the firmware only exposes for the OPEN
      // document, so background pre-read isn't possible — it's read on demand
      // when you open the PDF.
      if (!isNotePath(notePath)) {
        if (freeOnly || !mayPayFor(notePath)) {
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
            coveredThisTick.add(notePath);
            continue;
          }
          // v0.87.4: Vision-only debt is the DRAIN's job exclusively — it
          // has the budget, the per-page visionFails cap and the render
          // breaker. The old direct readPdf resume here bypassed every cap
          // (audit 2026-07-30 finding #1: a page whose Ministral read stays
          // empty was re-billed uncapped, twice per tick, forever).
          continue;
        }
        // Give up on a document that keeps failing, instead of paying for
        // the same doomed whole-file OCR at every tick (release audit).
        if ((pdfFails.get(notePath) ?? 0) >= MAX_PDF_FAILS) {
          console.log(
            '[SmartNoteAI.auto]',
            `${name}: PDF failed ${MAX_PDF_FAILS}× this session → parked ` +
              '(use Sync now to retry)',
          );
          continue;
        }
        const r = await readPdf(
          deps,
          key,
          assemblePdfVisionPrompt(settings.promptBlocks),
          notePath,
          {skipVision: !canRenderPdf},
        ).catch(() => ({
          ok: false,
          read: 0,
          failed: [] as number[],
          reason: 'read threw',
        }));
        if (!r.ok && r.read === 0) {
          // Nothing was stored and no docHash was stamped, so the next tick
          // would try the identical call. Count it, and SAY why — the
          // Library used to report "nothing new" while the bill grew.
          const n = (pdfFails.get(notePath) ?? 0) + 1;
          pdfFails.set(notePath, n);
          firstFailReason =
            firstFailReason ??
            (r as {reason?: string}).reason ??
            'PDF read failed';
          console.warn(
            '[SmartNoteAI.auto]',
            `${name}: PDF read failed (${n}/${MAX_PDF_FAILS}) — ` +
              `${(r as {reason?: string}).reason ?? 'no reason given'}`,
          );
        } else if (r.read > 0) {
          pdfFails.delete(notePath); // progress clears the backoff
        }
        pagesRead += r.read;
        paidThisTick = pagesRead;
        if (r.read > 0 && target.mode === 'auto') {
          recordAutoSync(name, r.read);
        }
        if (r.ok && canRenderPdf && r.failed.length === 0) {
          coveredThisTick.add(notePath); // OCR + Vision both landed
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
      if (
        !opts?.deepRecheck &&
        !isCurrent &&
        sig.length > 0 &&
        stamp === sig &&
        !storePending.has(notePath)
      ) {
        console.log('[SmartNoteAI.auto]', `${name}: unchanged → skip`);
        coveredThisTick.add(notePath);
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
        if (sig.length > 0 && manualSeenSig.get(notePath) === sig) {
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
        // structural counts — and since v0.53 the FREE stale count too
        // (footer revs vs stored entries), so an in-place edit finally
        // shows up as "to sync". The paid read waits for a Sync button.
        try {
          const totalM = await notePageCount(deps, notePath);
          if (totalM > 0) {
            const needM = await pagesNeedingRead(
              deps,
              notePath,
              Array.from({length: totalM}, (_, i) => i),
            );
            manualStale.set(notePath, needM.length);
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
      if (
        hostKind !== 'note' &&
        opts?.force !== true &&
        Date.now() - lastNoteProbeFailAt < PROBE_RETRY_MS
      ) {
        continue; // cross-host probe failed <60 s ago — no re-render yet
      }

      const total = await notePageCount(deps, notePath);
      if (total <= 0) {
        console.log('[SmartNoteAI.auto]', `${name}: 0 pages → skip`);
        continue;
      }
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
      // Backoff: drop pages that already failed MAX_PAGE_FAILS times this
      // session (they'd be re-billed every tick otherwise).
      let failSkipped = false;
      {
        const before = needed.length;
        needed = needed.filter(
          p => (pageFails.get(`${notePath}#${p}`) ?? 0) < MAX_PAGE_FAILS,
        );
        if (needed.length !== before) {
          failSkipped = true;
          console.log(
            '[SmartNoteAI.auto]',
            `${name}: ${before - needed.length} page(s) skipped after ${MAX_PAGE_FAILS} failures (this session)`,
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
      let failedCount = 0;
      // The free structural pass above already ran for this note; only the
      // PAID read is gated by the backstop / degraded store.
      if (todo.length > 0 && mayPayFor(notePath)) {
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
        paidThisTick = pagesRead;
        if (r.read > 0 && target.mode === 'auto') {
          recordAutoSync(name, r.read);
        }
        noteOk = r.ok;
        failedCount = r.failed.length;
        if ((r as {renderAborted?: boolean}).renderAborted === true) {
          noteRenderDead = true; // stand the other notes down for this tick
          lastNoteProbeFailAt = Date.now();
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
          const k = `${notePath}#${p}`;
          if (r.failed.includes(p)) {
            if (!freeRenderFails.has(p)) {
              pageFails.set(k, (pageFails.get(k) ?? 0) + 1);
            }
          } else {
            pageFails.delete(k);
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
      // Keep the FREE stale counter honest after a PAID pass (audit
      // 2026-07-19 E1): "Sync now" never purged manualStale, and the
      // light pass skips its recompute while the footer signature is
      // unchanged (manualSeenSig) — so "N to sync · ~X €" kept showing
      // pages already paid for, forever.
      // The purge runs for EVERY mode (device report 2026-07-19 evening:
      // a note that had been Manual kept its stale count while AUTO —
      // pages read and stored, the frame still said "N to read").
      if (fullyCovered) {
        manualStale.delete(notePath);
        manualSeenSig.delete(notePath); // next free pass recounts fresh
        coveredThisTick.add(notePath);
        const szc = walkSizes.get(notePath);
        if (szc !== undefined) {
          sizeAtSkip.set(notePath, szc);
        }
      }
      if (target.mode === 'manual') {
        if (!fullyCovered && todo.length > 0) {
          manualStale.set(
            notePath,
            needed.length - todo.length + failedCount,
          );
        }
      }
    }
    // v0.87 Vision drain — "no OCR-only page left behind" (user rule
    // 2026-07-30): finish the Vision leg of every stored OCR-only page the
    // CURRENT host can render (notes under a note host, PDFs under a PDF
    // host), for every mode except Off — that OCR was paid on a legitimate
    // trigger, finishing its Vision is completing the same read, not a new
    // spend. Budget shared with the structural reads above; per-page session
    // retry cap via visionFails; the page on screen defers like everywhere
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
    const allowNote =
      hostKind === 'note' ||
      opts?.force === true ||
      nowP - lastNoteProbeFailAt >= PROBE_RETRY_MS;
    const allowPdf =
      hostKind === 'pdf' ||
      opts?.force === true ||
      nowP - lastPdfProbeFailAt >= PROBE_RETRY_MS;
    if (
      key !== null &&
      visionBudget > 0 &&
      (allowNote || allowPdf) &&
      // Round 12 #0: the drain must still ENTER when a persisted Sync-now
      // order has Vision debt, or the per-doc bypass in the pageFilter is
      // unreachable and the user's order stalls at the cap for the whole
      // session. The pageFilter then caps everything non-manual.
      !degraded &&
      (manualWanted.size > 0 || !capReached()) &&
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
          shouldStop: stopRequested,
          onProgress: (done, totalV) =>
            setActivity({label: 'Vision', done, total: totalV}),
          pageFilter: (path, page) =>
            (manualWanted.has(path) || !capReached()) &&
            (visionFails.get(`${path}#${page}`) ?? 0) < MAX_PAGE_FAILS &&
            !(
              trigger === 'background' &&
              opts?.includeCurrent !== true &&
              path === currentPath &&
              page === currentPage
            ),
          onPageOutcome: (path, page, ok) => {
            const k = `${path}#${page}`;
            if (ok) {
              visionFails.delete(k);
            } else {
              visionFails.set(k, (visionFails.get(k) ?? 0) + 1);
            }
          },
        },
      ).catch(() => null);
      if (fv !== null) {
        pagesRead += fv.read;
        paidThisTick = pagesRead;
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
          lastNoteProbeFailAt = Date.now();
        }
        if (fb.pdfBlocked === true) {
          lastPdfProbeFailAt = Date.now();
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
    // v0.87: release the "Sync now" orders that are DONE — structural debt
    // clear this tick AND no Vision pending any more. Orders for docs no
    // longer tracked as Manual (mode changed, file gone) are dropped too.
    if (manualWanted.size > 0) {
      const s2 = await loadStore();
      for (const p of [...manualWanted]) {
        // (Staleness pruning happens at tick start, walk-failure-proof —
        // round 14 #9: this sweep only RELEASES completed orders.)
        if (coveredThisTick.has(p) && pagesOwedVision(s2, p).length === 0) {
          console.log(
            '[SmartNoteAI.auto]',
            `${p.split('/').pop()}: Sync-now order complete → released`,
          );
          manualWanted.delete(p);
          wantedDirty = true;
        }
      }
    }
    if (wantedDirty) {
      persistManualWanted();
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
    // Release audit 2026-08-12: a standing order that can never complete is
    // re-armed by hydrateManualWanted at EVERY plugin start, so every
    // restart granted one uncapped tick — the runaway backstop weakened for
    // as long as the order sits there, and it persists. Absence of a file is
    // never proof (that rule stands), but "we ran attended for it and read
    // nothing" is proof enough, measured here: drop the orders so no future
    // session re-arms. Cancelling costs the user nothing — the documents
    // still sync under their own mode, and Sync now is one tap away.
    if (fromHydratedOrder && pagesRead === 0 && !degraded && !stopRequested()) {
      const stuck = manualWanted.size;
      if (stuck > 0) {
        console.warn(
          '[SmartNoteAI.auto]',
          `${stuck} standing Sync-now order(s) made no progress — cancelled ` +
            'so they stop bypassing the session spend cap',
        );
        cancelManualSync();
      }
    }
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
      sessionPaidPages += paidThisTick; // only unattended work counts
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
  hydrateManualWanted().catch(() => {});
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

# SPEC — Refactor phases 3 & 4: one simple, robust flow

> Status: **PHASE 3 IMPLEMENTED (v0.36.0, 2026-07-17)** — approved by the
> user the same day with the recommendations of §5: (1) snapshot cache =
> 3 slots, (2) one network retry in the transport, (3) thumbnail kept but
> lazy, (4) search cleanup in scope (landed with phase 3, not 4).
>
> **Implementation amendments** (differences vs the text below):
> - §1.1: the "noteState" value object was realized INSIDE
>   noteTranscripts.ts — one cached walk (3 slots) serves ids + revs +
>   RECOGNTEXT coherently, ensureNoteFresh moved in, captureContext
>   deleted. Same guarantees, no new module boundary.
> - §1.3: the doc-level footer signature is KEPT as the cheap Auto skip.
>   Rationale: post-refactor readNotePageRevs is the full (cached) walk;
>   dropping the digest would re-walk EVERY tracked note on EVERY tick.
>   The digest now derives from the new footer-only readFooterRevs (~3
>   native reads) — one signal source (footer addresses), two
>   granularities. The separate 'pdf:<size>' stamp DID die (docHash is
>   the one PDF signal).
> - §1.6: the legacy batch parser was deleted now (not deferred); a
>   leftover pre-v0.34 job is written off as failed.
> Phase 4 (§2) remains TO DO and needs its own GO after device testing.
> Prerequisites already landed in v0.35.0: the 8 audit bug fixes (phase 0),
> the dead-code purge (phase 1) and the characterization tests over
> `reading.ts` / `autoTranscript.ts` / `transcriptStoreIo.ts` (phase 2).
> Nothing in this document is started. Each phase below is one deliverable
> version, testable on the device before the next starts.

## 0. Why (audit findings this must fix)

The audit found the same physical questions answered by several parallel
code paths, each patched separately over v0.17→v0.34:

- **"Did this note change, and what is the id/rev per page?"** — answered 4
  ways: `ensureNoteFresh` (captureContext), `syncPageIds` fast/slow paths
  (reading), `readPageIds`/`readNotePageRevs` + 45 s single-slot cache
  (noteTranscripts), and Auto's footer-signature stamp (autoTranscript +
  footerSig). The 45 s cache and the always-fresh footer reads can describe
  two different file states within the same call (`pagesNeedingRead` reads
  `ids` from the cache and `revs` fresh).
- **"Write a transcript"** — 11 hand-rolled `upsertPage` call sites; the
  reflow pipeline is manually re-applied at 7 of them; the hash/rev
  stamping was forgotten by 4 of them (fixed in phase 0 with `pageStamp`,
  but the writer is still copy-paste).
- **"Escalate a hard page to vision"** — 3 near-copies (.note loop, PDF
  loop, Improve).
- **HTTP plumbing** — the POST/auth/error/abort idiom exists 4× (mistral,
  ocr, conversations, batchIo); only mistral.ts maps 401/422 nicely; no
  client retries.
- **"When does Auto run?"** — 5 scattered triggers (ChatPanel mount timer,
  ChatPanel 15-min interval, ChatPanel page-turn poll, App config-open
  kick, App Library 25 s interval) + index.js pen-up. Behavior is emergent.
- **UI god-components** — App.tsx ~2 400 lines / ~40 useState; ChatPanel
  ~2 000 lines / 80+ hooks; `send()` ≈ 250 lines; sheets/dialogs/confirm
  patterns duplicated 4×.

## 1. Phase 3 — one transcript flow (`v0.36`)

### 1.1 New module: `src/native/noteState.ts` (the only footer reader)

One value object answers every freshness/identity question:

```ts
type NoteState = {
  ids: Map<number, string>;   // 0-indexed page → PAGEID
  revs: Map<number, string>;  // 0-indexed page → block address (content rev)
  count: number;              // page count as the FILE sees it
  liveCount: number | null;   // page count as the SDK sees it (null = unknown)
  fresh: boolean;             // file agreed with live count (after retries)
};

noteState(deps, notePath, opts?: {maxAgeMs?: number}): Promise<NoteState>
invalidateNoteState(notePath): void
```

Rules:
- **One cache** (the current 45 s single-slot moves here; consider keying by
  path with 2–3 slots so chat-on-note-A + Auto-on-note-B stop thrashing).
  `ids` and `revs` always come from the SAME read — the audit's
  cache-disagreement class disappears structurally.
- Owns the save/sleep/retry loop (absorbs `ensureNoteFresh`; captureContext
  is deleted). `maxAgeMs: 0` = force a fresh read (replaces the `force`
  flag threading and Auto's own invalidate+sleep dance).
- Owns the RECOGNTEXT map too (same walk) — `noteTranscripts.ts` shrinks to
  the pure range-walker + this module's IO.

### 1.2 `reading.ts` keeps the flow, loses the machinery

- `syncPageIds` slow path (remap + `setPageIds` + rev re-baseline) becomes a
  store-alignment function `alignStore(deps, notePath, st: NoteState)` —
  called by the functions that need it, with the fast path expressed as
  "snapshot matches `st.ids` → skip". No `force` parameter anywhere.
- `pagesNeedingRead(deps, path, pages)` — same contract, built on ONE
  `noteState` call (ids+revs coherent by construction).
- `readPages` / `readPdf` — same contracts. The three escalation copies
  fold into one:

```ts
escalatePage(fetchFn, apiKey, img, hint, personaOcr, signal):
  Promise<{ok: boolean; text?: string; reason?: string}>
// hint non-empty → buildImproveRequest; empty → buildReaderRequest
// (empty-hint guard stays: a hint block with nothing under it makes
// models invent text — bench 2026-07-12)
```

- **One writer**: `makePageEntry(text, source, stamp, low?)` in core applies
  `normalizeTranscript = cleanMarkdown ∘ mergeTables ∘ reflowTranscript`
  and returns a complete `PageEntry`; `upsertTranscript(path, page, entry)`
  in native is the only `upsertPage` caller outside tests. 'user' entries
  skip normalization by construction (their text is verbatim). The rev
  backfill patch in `pagesNeedingRead` can then be retired after one
  release (every writer stamps rev).

### 1.3 One Auto change-detector and one scheduler

- **Drop the footer-signature stamp** (`DocEntry.stamp`, `getStamp`/
  `setStamp`, `footerSig.ts`): with `noteState` cached and coherent, the
  per-page rev comparison IS the change detector, and the double footer
  read per tick disappears. (The PDF `pdf:<size>` stamp stays — PDFs have
  no revs; move it to `DocEntry.docHash` handling.)
  ⚠ Review note: the stamp currently also encodes "fully covered at this
  signature" (budget postponement). Replacement rule: a note is skipped
  when `pagesNeedingRead` returns empty — which is the same condition,
  computed instead of stored.
- **One scheduler** `startAutoScheduler(deps)` in autoTranscript.ts, started
  once per surface (bubble index.js / config App). It owns the periodic
  interval and exposes `pokeSoon(reason)` for pen-up / page-turn / config
  events. The 20 s floor, the serialization flag and the session budget
  stay internal. ChatPanel/App lose their 5 hand-wired timers.

### 1.4 One Mistral transport

`src/core/model/http.ts`:

```ts
mistralPost(fetchFn, apiKey, path, body, signal): Promise<
  | {ok: true; data: unknown}
  | {ok: false; reason: string; status?: number}>
```

- Carries the shared headers, abort→"timed out" mapping, `!res.ok` →
  401/403 ("check your key") / 404/422 ("check the model id") / snippet,
  `res.json()` null-guard. mistral.ts / ocr.ts / conversations.ts keep only
  their body-building and response-parsing; batchIo reuses it for the JSON
  endpoints (multipart upload stays specific).
- Single place to add ONE retry with backoff on network errors/5xx later
  (out of scope for v0.36 unless trivial).

### 1.5 Slim `capturePage`

Chat context is text-only; today every 2.5 s page-turn poll triggers a full
render + PNG read + OCR cascade to produce a 34×46 thumbnail and an
EPUB-only text fallback.

- `captureCurrent(deps)` → `{path, page, totalPages}` (three cheap SDK
  calls, no render). The poll and `onRefresh` use this.
- Thumbnail: rendered lazily ONLY when `ctxMode === 'page'` and the panel
  is expanded (`capturePageImage`, unchanged).
- The recognizeElements fallback leaves the chat path entirely: .note
  context comes from the store; the PDF/EPUB fallback calls
  `getCurrentDocText` directly at gather time.
- `PageCapture.pageText`/`imageBase64` disappear from the capture object —
  the second "transcript source that can disagree with the store" goes away.

### 1.6 Explicitly out / kept

- `parseBatchResults` legacy branch: DELETE in v0.36 (grace period over).
- `keyFile.ts`: shrink to key parsing + `DEFAULT_MODEL` (drop the
  model/max_tokens validation of fields nobody reads).
- `remapDocPages` legacy map: KEEP (protects hash-less user edits).
- PDF Off-file semantics: `readPdf` stores ALL pages but the OFF ephemeral
  wipe removes only the selected ones. Decide: wipe every page the read
  ADDED (diff before/after) — small, do it here.
- Store search stays in transcriptStore.ts until phase 4 (moves to
  `librarySearch.ts` with the UI split; `searchLibrary` folds into
  `searchLibraryAdvanced`).

### 1.7 Acceptance for v0.36

- Characterization suite (phase 2) still green with the SAME assertions
  (contracts unchanged) except tests pinned to removed internals
  (footer-stamp tests get rewritten against the computed rule).
- Device script: (1) edit a page → pen-up → Auto re-reads exactly that
  page; (2) delete a page in a 50-page note → NO mass re-read; (3) chat on
  note A while Auto covers note B → no cache thrash in logs (one walk per
  note); (4) Off file: ask → consent → answer → store empty for that file
  even after Stop; (5) page turns with the panel open feel instant (no
  render per turn).

## 2. Phase 4 — UI split (`v0.37`)

### 2.1 Shared UI kit (`src/ui/`)

- `labels.ts`: SRC_LABEL/SRC_LONG, date formatters (`fmtDay`,
  `fmtDateTime`, `fmtHm`), `baseName` — deletes the App/ChatPanel copies.
- `useArmedConfirm(timeoutMs)` hook — replaces the 4 one-tap-confirm
  implementations (armThen, confirmDelKey, guardOverwrite, confirmDelId).
- Components: `<Page title onBack>` (header + scroll + msg footer),
  `<Section title note>`, `<Btn label onPress size variant disabled>`
  (collapses the 6 near-identical bordered-button style families),
  `<Sheet title onClose>`, `<ConfirmDialog text okLabel onOk onCancel>`.

### 2.2 App.tsx → router + screens

```
App.tsx (~150 lines: screen state, settings load/save, shared msg)
screens/HomeScreen.tsx
screens/KeyAppScreen.tsx
screens/ChatConfigScreen.tsx          (model, persona, tools, quick actions)
screens/library/LibraryScreen.tsx     (search + tree + sync banner)
screens/library/PageGrid.tsx
screens/library/PageView.tsx          (transcript, word-fix, image, native OCR)
screens/library/OcrConfigBlock.tsx    (manual + glossary + test)
```

State moves with its screen (41 useState → ~8 shared + locals); typing in
the glossary no longer re-renders the folder tree. Business logic leaves
the components: `syncBatch` orchestration → `pretranscript.submitManualBatch`,
the C4 structural sync → autoTranscript, the raw `/v1/models` fetch →
`catalog.resolveLatestAliases(fetchFn, apiKey)`.

### 2.3 ChatPanel.tsx → panel + extracted flow

- `src/native/gatherContext.ts`: everything between the consent gates and
  `composeUserText` — input `(capture, scope, apiKey, personaOcr, gates)`,
  output `{userText, pages}`; the OFF wipe lives inside (finally). `send()`
  drops to ~90 lines: gates → gather → HTTP → bookkeeping. Unit-testable.
- One `scope` object `{mode, start, end}` with PARSED numbers replaces
  `ctxMode/rangeStart/rangeEnd` and the 5 duplicated
  `(parseInt(x,10)||1)-1` blocks.
- The chip + transcript-sheet derivation effects merge into one
  `useTranscriptView(cap, scope)` that NEVER calls `syncNotePages`
  (syncing happens in refresh/poll only) and subscribes to the store
  DEBOUNCED like App does — removes the residual 3 Hz-loop topology.
  Additionally `mutateStore` only notifies when the mutator actually
  changed something (dirty flag) — kills the whole loop class.
- `TranscriptSheet`, `HistorySheet` and the 3 dialogs become components on
  the shared kit (~-250 lines).
- `KeyState.config` collapses to `apiKey` (the embedded model/maxTokens
  copies are stale — `chosenModel` is already the truth).

### 2.4 Acceptance for v0.37

- Zero intended behavior change (pure reorganization + the mutateStore
  dirty-flag). Device pass: config navigation, glossary typing latency,
  chat send/stop/refresh, transcript sheet edit/improve, history, search,
  batch submit/check.

## 3. Estimated impact

| Area | Before (v0.35) | After (v0.37) |
|---|---|---|
| Transcript read paths | 6 | 1 (+ batch submit variant) |
| Footer readers / caches | 3 readers, 2 caches | 1 / 1 |
| Change detectors (Auto) | 2 (rev + footer stamp) | 1 |
| Escalation implementations | 3 | 1 |
| Store writers (`upsertPage` sites) | 11 | 1 |
| HTTP plumbing copies | 4 | 1 |
| Auto triggers wired by hand | 5 + pen-up | 1 scheduler + pokes |
| Largest file | App.tsx ≈ 2 400 | < 700 |
| Net lines (whole plugin) | ≈ 12 900 | ≈ 10 800–11 200 |

## 4. Risks & mitigations

- **Freshness regressions** (the hardest-won behavior): the phase-2
  characterization tests pin fast-path read-only-ness, slow-path remap +
  re-baseline, backfill, negative cache, escalation outcomes — they must
  pass unchanged against `noteState`.
- **Auto skip/spend regressions** when the footer stamp is removed: add
  tests proving "unchanged note → zero paid calls" and "one edited page →
  exactly one read" BEFORE deleting the stamp.
- **Device-only behaviors** (lazy flush, blank current-page render):
  unchanged code paths, but each phase ends with the §1.7 / §2.4 device
  scripts before the next starts.
- Phases land as separate versions (v0.36, v0.37) so a device regression
  bisects to one refactor.

## 5. Open questions (answer before GO)

1. **noteState cache**: keep one slot (current) or 2–3 slots per path so
   Auto + chat on different notes stop evicting each other? (Cheap; my
   recommendation: 3 slots.)
2. **Retry in the transport**: add the single network retry now (one place,
   ~15 lines) or defer? (Recommendation: now, it removes a whole class of
   "1 page failed" noise on flaky wifi.)
3. **Thumbnail**: keep it (lazy) or drop it entirely and free the capRow
   space? (Recommendation: keep lazy — it's the only "you're looking at
   the right page" cue.)
4. **`searchLibrary` merge + search move to `librarySearch.ts`**: fold into
   phase 4 as written, or skip to keep phase 4 purely mechanical?

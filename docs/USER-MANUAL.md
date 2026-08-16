# SmartNote AI — User Manual

The in-app config pages are kept deliberately short (one line per setting).
This is the full version: what each option does, why, and the numbers
behind it. Nothing here is required reading to use the plugin.

## What it is

SmartNote AI brings your Supernote to the age of AI, privacy first.
Everything is built on **READ**: your notes and documents are transcribed
into a local library (page by page on demand, or always up to date in the
background), and every feature works on top of it. CHAT, SEARCH, EXPORT and AI
AGENTS are all available today.

## Privacy

- **Fully open source** — audit it: github.com/AgP42/SN-Plugin-SmartNoteAI
- **Mistral AI only**: a European company on European infrastructure. Your
  data stays under EU jurisdiction (GDPR) and is processed in Europe,
  protected from the US Cloud Act and the Chinese Data Security Law. On a
  paid API plan, your requests are never used to train Mistral's models.
- **Bring your own key**: a direct link between your Supernote and your
  Mistral account; the key is kept in the plugin's private storage — never
  synced to the cloud, not in device backups.
- **Transcripts and conversations stay on the device only**, never synced,
  never stored on Mistral's servers (requests are sent with `store: false`).
- Still: do not send confidential information to any cloud model.

## READ — one engine, three modes (v0.32)

**One engine.** Every page is read by **Mistral OCR 4**; pages it is unsure
about (drawings, schemas, messy writing) are automatically re-read by
Ministral Vision, guided by your glossary. Each page's provenance shows
which was used: "Mistral OCR" or "Mistral OCR + Vision". Cost ≈3.5€/1000
pages (the bare-OCR price; the vision re-read of the few hard pages adds a
little). **PDFs** use the same engine — the whole PDF in one call, correct
reading order on any layout. Handwritten annotations on a PDF **are**
captured: annotated pages get a Vision read with your ink composited, and
are re-checked automatically when you write on them again.

### Modes — per folder or note, set in the Library

| Mode | What it does |
|---|---|
| **Off** | Excluded from the AI: never read, no transcript stored. If you ask a chat question about an Off page, the plugin asks for one-shot consent, reads it once to answer, then discards the transcript (no memory). |
| **Manual** (default) | Read and stored only on demand: the Library "Sync now" button, or a chat question about that page. |
| **Auto** | New and changed pages are transcribed in the background, kept up to date, as you turn pages while the plugin runs (a periodic tick is the fallback). |

Set a folder's mode and its notes inherit it (a note's own mode wins). The
"Sync now" button and the "N pending" count cover the folders/notes you set
to Auto or Manual (Off excluded); untracked pages are read on demand from
the chat. Consent-gated for the cloud; Auto is capped at 100 paid pages per
pass, the rest caught up next tick. Rough cost: 100 new pages/week ≈
0.35€/week, billed directly by Mistral.

### Glossary

Optional extra vocabulary to help the reading: your handwriting's
languages, then the people and place names you write (proper nouns are the
hardest thing for any OCR), then your acronyms and jargon. Stacking all
your subjects is harmless (measured). Aim for ≤ 2000 characters. Leave it
empty and the engine still works — the general instructions always apply.
"Suggest words from my library" mines your transcripts for recurring
low-confidence words and frequent proper nouns to add in one tap.

"Changed pages" includes a page you kept **writing on** after it was first
read, not just brand-new pages (v0.25.7). Each read remembers the page's
content state (its block address in the file); when you edit that page the
address moves, so Auto — and a manual Re-read — notice it and read it
again. Two caveats: the tablet writes the file lazily, so a just-edited
page is picked up on a later pass (once saved, e.g. after turning the
page); and a page you **hand-corrected** (Manual) is never re-read
automatically — it stays your version until you Re-read it yourself.

### Reflow

Transcripts are reflowed into full sentences and paragraphs: hand-wrap line
breaks (a line that only breaks because the page is narrow) are joined; a
new line is kept only for a real paragraph, a bullet/numbered item, a
heading or a table row. Done both by the prompt and, deterministically, in
code — so a "clean" page never comes back line-per-scribble.

### Fixing transcripts

- **Edit** rewrites the whole page (source: Manual, top rank, never
  overwritten by re-reads).
- **Tap a low-confidence word** (underlined bold) to fix just that word.
- **Re-read** re-runs the paid engine on the page.
- **Improve** (panel): re-reads with the image plus the current transcript
  as a hint — best on hard pages.

### Background sync (v0.88)

The old half-price Batch mode is gone (v0.79): everything now goes through
one live pipeline, OCR 4 then Vision per page, throttled automatically when
Mistral rate-limits. The sync adapts to what is on screen by itself: note
pages are read while a note can be rendered, PDF Vision runs while a PDF
reader is available ("Rendering via:" under SYNC STATUS → Details shows
which). A "Sync now" reads what it can in one pass; if a big backlog remains,
the counts show what is left — tap Sync now again. No page stays OCR-only:
pending Vision passes run automatically as soon as the right app is open.

- **Cleared pages repair safely.** If you clear one page of an already-read
  PDF, it shows as pending again and is re-read on your next explicit Sync
  (or Library action) **with that PDF open in the reader** — the one
  condition under which the page image cannot be confused with another
  document's. Background passes never guess.
- **Wrong-image protection.** A Vision result that doesn't match the page
  it was asked about (a rare renderer mix-up) is rejected instead of
  stored; the page keeps its safe OCR text. To force a fresh read: open
  that PDF and use "Redo AI" on the page.
- **Self-cleaning counts.** Deleting a file on the device makes its
  leftover "to read" count disappear by itself after a few background
  passes — no manual cleanup.
- **Moving vs renaming.** Moving or copying a PDF (same file name) keeps
  its transcripts for free. **Renaming** it counts as a new document: it
  is re-read once.

## CHAT

**Chat answers come from your stored transcripts, instantly.** A chat
question never triggers a Vision pass: if the document changed since its
last read, only the fast OCR runs so the answer has fresh text; the Vision
quality catch-up happens in the background or on your next Sync — never
behind a chat question. Asking about an unread document still asks for
confirmation above 100 pages (OCR price only).

Ask any Mistral model about the current page, a page range or the whole
note. The presets are the models that can drive the **Tools** (web search,
code interpreter): Small (default — open, tool-capable, on par with Large
and Medium in our tests for a fraction of the price), Large 3, Medium,
Magistral S/M. Any other model works in the free-text field, but the
smaller ones (Ministral, Nemo) cannot run the connectors.

- **Persona** (optional): shapes how the assistant answers.
- **Web search** (one-shot button, ≈0.01€ per search): arm it and it
  applies to your NEXT message only. Answers produced by a real web run
  carry a **🌐 badge** and cite their sources.
- **No invented facts**: without Web armed, the assistant is told — for
  every message — that it has no live data: it will not present remembered
  knowledge as current, and it never cites or fabricates source links. For
  time-sensitive questions (weather, news, prices) it asks you to arm Web.
  No 🌐 badge = the answer came from the model's memory.
- **Full transparency**: the exact system prompt a chat message sends
  (persona · agent documents · lasso directive · the per-message tool
  line) is shown in CHAT & AGENTS under "Full prompt — what the chat
  sends", like the READ prompts in their own door.
- **Quick actions**: editable one-tap prompts shown in the panel.

## SEARCH & the Library

Typing a bare word in the search field looks through your transcripts
**and document names**: "bujo" finds `BUJO_T12S10.pdf` even if no page
contains the word — the name match appears on top as "(document name)".
Prefixes still scope precisely: `n:` name only, `f:` folder,
`type:note|pdf`, `p:8`, `star:`, `kw:`…

The "Original page" preview of a PDF page shows your handwritten
annotations composited on the printed page.

## The reading model

Improve, Test and the Vision passes all use
`ministral-14b-2512` (pinned to a dated snapshot on purpose — a `-latest`
alias silently changed target mid-bench). It ties Mistral Medium in quality
on our author-graded ground truth for ~8× less on the vision call, and read
the schema page best of all Mistral models. The full benchmark is in
`docs/bench-ocr-2026-07-10/`.

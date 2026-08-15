> **SUPERSEDED (2026-08-03).** The manual is now designed OUTSIDE the repo
> (Claude Design) and imported with `tools/import_guide_pdf.py` — the
> distributed PDF is `docs/SmartNoteAI-UserGuide.pdf`, the embedded asset
> and the searchable transcripts are generated from it. This file stays as
> a text reference only; editing it no longer changes the plugin.

# SmartNote AI, User Guide

> Revision 2 (v0.88.9, 01/08/2026). Image slots are marked `[IMAGE: file]`
> and point at `assets/guide/`. Every paragraph here becomes one page of the
> embedded PDF.

**Cover**: the official Supernote device drawing, the SmartNote AI logo on its
screen, the title *SmartNote AI · User Guide*, `by AgP42`, the GitHub link,
and the Ko-fi QR code.
`[IMAGE: cover-schema.png + logo + kofi-qr.png]`

---

# 1. Welcome to SmartNote AI

**Your Supernote in the age of AI; privacy first.**

Write as you always do. Then supercharge your notes and thinkings with AI power. A question about the page under your pen,
a summary of the meeting you just took down, a translation of the paragraph
you lassoed, a search across four years of notebooks. All on the device, with
your own key, without sending anything you did not choose to send.

What can you do with it, right away:

- **Ask about the page you are writing.** The floating assistant sits over
  your note; you keep writing while it answers. Nothing has to be prepared,
  transcribed or stored first.
- **Lasso and ask.** Circle a scribbled address, a diagram, a table. "What's
  the postcode?" "Explain this." "Turn this into a checklist."
- **Turn a notebook into a searchable library.** Transcribe what you choose.
  Then search every word you ever wrote, in seconds.
- **Give an assistant your documents.** An agent that knows your project
  notebooks, another that knows a 300-page PDF and quotes it.
- **Get your text out.** Export any page, notebook or folder to `.md` or
  `.txt`, straight into your Supernote file browser.

And the part that is not a feature but a stance: **it talks to exactly one
AI provider, Mistral AI, in Europe, under GDPR privacy protection.** Your key,
your data, your rules. Files you mark *Off* never leave the tablet without
your explicit agreement.

`[IMAGE: hub.jpg]`

---

# 2. Core concepts

Four ideas explain the whole plugin.

## Transcripts: how a page becomes text

A page of handwriting is an image. To search it, quote it, or discuss it, it
has to become text. That is what **READ** does, and every page goes through
the same two steps:

1. **Mistral OCR 4** reads the page. It is fast, cheap and powerfull. It returns the text
   plus a confidence score for each word. But... it doesn't "see" images, scheme or manual handwritten notes on PDF, it also cannot receive instruction about the content to transcript. To overcome this, after this first step, the plugin add on top :
2. **Vision (Ministral 14B)** then reads the *page image*, with the OCR text
   riding along as a hint. Vision is what understands layout, tables,
   drawings, margin notes and your own conventions, and it is the step that
   follows the prompt you can edit (chapter 3.3). *The READ prompt drives
   Vision only: the OCR endpoint takes no instructions.*

The result is stored **on the tablet**, page by page, with a fingerprint of
the page it was read from. Change the ink on a page and only that page is
read again. Never touch it, and it is never paid for twice.

**PDFs work slightly differently.** The whole file is read in one OCR call,
fast and cheap for printed text, and then each page also gets a Vision pass,
so schemas, figures and *your handwritten annotations on top of the PDF* are
read too, not just the printed layer.

Low-confidence words come back **underlined** in the transcript: tap one to
correct it. A hand-corrected page is marked as yours and is never overwritten
by a later sync.

Page after page, those transcripts become a **library**: your own local,
searchable copy of what you wrote. It is what makes **SEARCH** possible (one
query across every notebook you ever transcribed, in seconds) and **EXPORT**
useful (any page, notebook or folder written out as `.md` or `.txt`, ready to
leave the tablet). Nothing is uploaded to build it: the library lives in the
plugin's private storage, on the device.

## Chat and agents

Once a page has a transcript (or on demand, live), you can chat about it. The
**floating assistant** is a movable panel that sits over your note. It always
knows what you are looking at, and you can add anything else: other pages,
whole notebooks, a lassoed image.

An **agent** is the same chat with a memory of its own: a name, a persona, a
model, and a set of library documents it always knows.

Four ready-made agents ship with the plugin and can be added in one tap:
**Extractor** (pulls out actions, dates and figures), **Writer** (turns notes
into clean prose), **Tutor** (explains and quizzes you) and **Brainstorm**
(pushes ideas further). They are ordinary agents once added: rename them,
change their model, give them documents.

And you create your own: a "Meeting notes" agent over your work notebooks, a
"Recipes" agent, a "Thesis" agent that knows a long PDF and quotes it. You
pick one when you start a conversation.

## The menu: one button, everything behind it

The Supernote toolbar entry **SmartNote AI Menu** opens a compact menu over
your page:

| Entry | What it opens |
|---|---|
| Open the assistant | the floating chat, on the current page |
| Library: Sync, Search & Export | the library and the sync cockpit |
| Current note transcript | the note/PDF you have open, in the Library |
| Current page transcript | the exact page you are on |
| Plugin configuration | the three configuration doors |
| User manual (PDF) | this guide |

`[IMAGE: menu.jpg]`

## Map of the plugin

```
                    ┌───────────────────────┐
                    │   Plugin configuration │
                    │  1·Key  2·READ  3·CHAT │
                    └───────────┬───────────┘
                                │  ▲  (top bar: ≡ Menu)
                                ▼  │
   User Guide  ◄──────────  ┌─────────────┐  ◄──────────►  ┌──────────┐
     (PDF)                  │    MENU     │                │   CHAT   │
                            └──────┬──────┘                │ assistant│
                                   │                       └────┬─────┘
                                   ▼                            ▲
                            ┌─────────────┐                     │
                            │   LIBRARY   │  ───────────────────┤
                            │ sync·search │                     │
                            └──────┬──────┘                     │
                                   ▼                            │
                        ┌────────────────────┐                  │
                        │  Note / PDF pages  │  ────────────────┤
                        └──────────┬─────────┘                  │
                                   ▼                            │
                        ┌────────────────────┐                  │
                        │  Page transcript   │  ────────────────┘
                        └────────────────────┘
```

Every screen reaches the **Menu** from its top bar, and the **Assistant**
button is there too. Arrows down go deeper; arrows up come back. The User
Guide is a one-way trip: it opens in the Supernote reader and the plugin
steps aside.

---

# 3. Configuration

Three doors, reached from *Plugin configuration*. Nothing here is a
prerequisite: the plugin works out of the box once the Mistral API key is in.
Every field is explained below.

## 3.1 Getting started: your Mistral API key

SmartNote AI has no server of its own and no subscription. You create a key
at Mistral, paste it once, and pay Mistral directly for what you read.

**Step 1: create an account** at `console.mistral.ai`.
`[IMAGE: mistral1.jpg]`

**Step 2: you land on Mistral Studio.** Everything you need is in the left
rail.
`[IMAGE: mistral2.jpg]`

**Step 3: open *My API Keys*** (via your account menu, bottom left) and
choose **Create new key**.
`[IMAGE: mistral3.jpg]`

**Step 4: name the key.** Anything works; "SmartNote Plugin" makes it easy
to revoke later. Expiration and workspace can stay on their defaults.
`[IMAGE: mistral4.jpg]` `[IMAGE: mistral5.jpg]`

**Step 5: copy the key.** It is shown **once**. Copy it now.
`[IMAGE: mistral6.jpg]`

**Step 6: your key is listed** and can be revoked at any time from the same
screen.
`[IMAGE: mistral7.jpg]`

**Step 7: paste it into the plugin**: *Plugin configuration → 1 · API key* →
*Paste from clipboard* → *Save key (encrypted)*.

> **Free tier.** Every feature of the plugin works on the free tier, with
> comfortable limits: all models are available, and field-testing in July
> 2026 gave roughly ~1300 transcribed pages per month plus a lot of chat
> requests. Only a **paid** plan guarantees Mistral never trains on your
> data. A paid plan is pay-as-you-go: a few euros last a long time : in July 2026, for ~1300 pages transcripted per months plus many chats, count ~7€/months. For 100 pages and few requests, less than 1€. 

## 3.2 Door 1: API key, privacy, backup & appearance

`[IMAGE: door1.jpg]`

**Mistral API key.** Shows the current key masked. *Paste from clipboard*
fills the field (the Supernote keyboard has no paste), *Save key (encrypted)*
stores it in the plugin's private directory, never in a cloud-synced folder.
*Delete stored key* removes it. If an old plain-text key file from an early
version is still around, a *Delete old key file* button appears: use it.

**Privacy.** Reminds you what leaves the device: your questions and the
content of the pages you send. *Clear ALL transcripts* wipes the local
library in one go (the same action exists in the Library).

**Settings backup.** Settings live in private storage and are never synced.
*Export settings* writes a readable copy to `MyStyle/Plugins/SmartNoteAI/`
that you can edit by hand or copy to another device; *Import settings*
replaces all settings with that file. *Add starter agents* adds the four
ready-made agents if you removed them.

**Appearance.**
- *Text size* (S/M/L/XL) and *Button size* apply **everywhere**, floating
  panel included. Set these first if you find the UI small.
- *Note toolbar side* tells the plugin where your Supernote pen toolbar sits,
  so the floating panel and the **menu position** never cover it.

## 3.3 Door 2: READ, AI transcript params

This door shapes **what the AI is told when it reads a page**. It drives the
Vision step; OCR takes no instructions.

`[IMAGE: door2a.jpg]`

The prompt is not hidden: it is a list of **blocks**, each editable, joined
together into the instruction actually sent. Edit any of them; an untouched
block keeps following future improvements of the plugin.

**You do not have to touch any of this.** The shipped blocks are the result of
benchmarking on real handwritten pages and give good results as they are. They
are exposed because your notes are yours: if your pages have conventions of
their own, you can say so. And every block has a *Reset* button, plus a
*Reset to default, all this page* at the top, so you can always come back to
the shipped prompts.

| Block | What it controls |
|---|---|
| **Role** (.note / .pdf) | what the model is doing: transcribe a handwritten page, or a document page. Two variants, because a PDF is not a notebook. |
| **Fidelity** | how faithful to be, and what to do with unreadable words (mark them `<?>` rather than invent). |
| **Formatting (Markdown)** | headings, lists, tables, how to reflow wrapped lines into real paragraphs. The plugin renders Markdown everywhere (transcripts, chat answers, exports), so Markdown is exactly the right thing to ask the model for. |
| **Drawings & diagrams** | what to do with a sketch or a schema: describe it briefly, in place. |
| **Template vs content** | ignore the printed template (ruled lines, grids, margins) but keep anything *written* inside a box or a header. |
| **Languages** | which languages your notes mix. Keep each word in the language it was written in. |
| **Money & units** | currency and unit conventions (a bare `£`/`$` next to a number is usually your currency). |
| **Glossary (your vocabulary)** | **the single biggest quality lever**: your names, acronyms and jargon. |

`[IMAGE: door2b.jpg]`

Three helpers sit under the glossary:
- *Suggest words from my library* mines what has already been read for
  frequent and low-confidence words, so you can add them in one tap.
- *Test the prompt on the current page* runs a real read on the page you were
  on, so you can judge a change before applying it everywhere.
- *Full prompt* (handwritten / PDF) unfolds the exact text that will be sent.

**Lasso: image reading** is at the bottom. A lasso is not text like every
other context: it is an **image** the model has to read itself, so it needs
its own instruction, and that is what this block is. Leave it **empty** to
send no instruction at all. Note that the assistant's model must be able to
see images: Ministral, Mistral Small, Medium and Large all can.

*Reset to default, all this page* restores every block. It asks twice: your
glossary is your work.

## 3.4 Door 3: CHAT & AGENTS, your assistants

One page for every assistant. **CHAT** is the default one; its persona,
model, answer style and quick actions apply everywhere unless an agent
overrides them.

`[IMAGE: door3a.jpg]`

**Model.** Any Mistral model name works in the field; the presets are the
ones that can use the chat's Web and Calc tools. *Small* is cheap and good
for most questions, *Medium* is the default, currently the most expensive model from Mistral, *Large* for hard reasoning, but currently outdated (12.2025, a new Large is expected soon). 
The plugin point to the model "-latest", then it display to which model this -latest currently point.
The screen shows the model's real price and description, so there is no guessing.

`[IMAGE: door3b.jpg]`

- **Web search** is *one-shot*: you arm it in the chat panel and it applies to
  your **next message only**. Web answers cite their sources (~0.01 € per
  search). *(The code interpreter was removed: it is no longer offered in the
  panel.)*
- **Answer style**: *Precise* sticks to the facts, *Creative* allows looser
  phrasing, *Balanced* is the model's own tuning.
- **Persona (System prompt)**: who the assistant is and how it should talk to
  you. It is prepended to every conversation.

**Quick actions** are the one-tap prompts under the chat input. Toggle which
appear, reorder them, edit their text, add your own. They *write into the
input field*, so you can always adapt the prompt before sending it yourself.

`[IMAGE: door3c.jpg]`

**Lasso quick actions** (up to 3) appear **only** while a lassoed image is in
the context, ahead of the normal ones.

**Agents.** Up to **8 custom agents**, plus the built-in CHAT (so 9 entries in
the list). Each has its own name, icon, persona, model, answer style, quick
actions and, the whole point, its own **documents**.

`[IMAGE: door3d.jpg]`

*Context documents & cost*: build the agent's context from the Library
(*+ Add to → the agent*). Folders and whole notes stay **live** (future pages
are included automatically); specific pages are fixed. The screen tells you
how many pages are already read, what reading the rest would cost, and the
token weight of the context, with the honest reminder that **less context is
cheaper**: half the pages is half the price. Within a conversation, only the
first message pays the full context: Mistral's caching then bills the
following messages at about 10% of that context price.

---

# 4. Library

`[IMAGE: library.jpg]`

The Library is your local transcript store **and** the cockpit for syncing,
searching and exporting. The tree shows your `Note` and `Document` folders,
SD card included. Each row carries its sync chip, its page count, and how
many pages are still to read; a badge shows every agent that knows it.

Whole-library actions live at the top: *Export all* (`.md` / `.txt`),
*Back up library* / *Restore backup*, *Clear all transcripts*, and
*Clear transcripts of Off notes*.

## 4.1 Synchronisation

`[IMAGE: syncstatus.jpg]`

### Three modes, set with one tap

Every **folder** and every **note or PDF** carries a mode chip. Setting a chip
costs nothing: it only saves a preference. A folder's mode covers everything
under it; a single document can override its folder.

- **Off**: never sent to the AI. The privacy switch. Asking the chat about an
  Off page requires an explicit one-time consent, and that read is not stored.
  Switching a document to Off **does not delete transcripts already stored**:
  they stay in your library, searchable and exportable, they simply stop being
  updated or sent. To remove them, use *Clear transcript* on that document, or
  *Clear transcripts of Off notes* in the Library to wipe them all at once.
- **Manual**: read only when *you* ask: a Sync button, or a chat question
  that needs the page. **"Sync now" reads what it can in one pass** (up to
  100 pages); if a big backlog remains, the counts show what is left, tap
  Sync now again. Pending **Vision** passes still finish **by themselves** as
  soon as the right app is open (a note for note pages, a PDF reader for PDFs).
- **Auto**: read in the background, page by page, while the plugin is
  running.

A good habit: active notebooks on **Auto**, archives on **Manual**, anything
private on **Off**.

### What actually triggers an Auto read

Auto is not a system service: it is the plugin working while it is alive.
Two things must be separated here, because they are often confused.

**What is read.** A page is read **only if its content actually changed** since
its last read, and **the page you are currently writing on is deliberately
left alone**. So no, writing does not send anything: not on every pen stroke,
not on every tick of the assistant. The `.note` format is append-only, which
lets the plugin compare, in order and for free, the file size, then the page
fingerprints, then each page's own revision. An unchanged page costs nothing
and is never sent again.

**When the plugin looks.** Several ordinary moments make it check whether
something changed:

- when you **finish writing** and lift your pen, or **turn a page** (the page
  you just left may now need a read);
- while the assistant is open, on its regular pulse;
- when you **come back to the plugin**, or open the Library or a
  configuration screen;
- every **15 minutes** as a fallback, and once at start-up;
- right after a pass that could not finish a large backlog in one go.

These checks are throttled to one every 20 seconds, and most of them cost
nothing at all: if no file changed, nothing is read and nothing is paid.

**The page under your pen** is read when it is actually needed, and never
while you are on it: its render would come back blank. In practice it is read
when you **turn away from it**, or when you **open the Library** (you cannot
be writing on it then). And the same page is never read more than once a
minute, so a page you keep editing is not billed repeatedly.

**Asking the chat about the page you just wrote on works.** When you send a
message, the assistant checks the pages in your context and reads on the spot
anything that is out of date, your current page included, before answering.

### Notes and PDFs do not have the same constraints

Rendering a page is done by the Supernote app that owns it:

- **note pages** can only be rendered while the **note app** can render (a
  note is the document in the background);
- **PDF pages** can only be rendered by the **document reader**, and that
  applies to the Vision step of PDFs.

The **OCR** step of a PDF is the exception: it reads the file's bytes and
works whatever is on screen.

The plugin probes what it can render at every pass and tells you in the sync
frame: *Rendering via: note app / PDF reader / none yet*. If PDF Vision pages
are waiting and rendering fails, a button appears, **▶ Resume PDF Vision ·
opens \<file\>**, and *you* decide when to tap it. The plugin never opens a
document by itself.

### Honest limits

- Auto works **while the plugin lives**. Close everything and it pauses, then
  resumes where it stopped.
- When the plugin is in the background, how long the system keeps it running
  is **not something the plugin controls**: it may keep going for a while, or
  be frozen at any moment.
- Nothing runs while the **device is off**.
- A page takes roughly **8 to 30 seconds** (render + OCR + Vision over your
  connection). A first sync of a whole notebook is a "start it and let it
  run" job.

### The panel, button by button

- **AUTO column**: last sync time, pending count, and *Force sync* to run the
  Auto backlog now.
- **MANUAL column**: last sync time, pending count with its price, and
  *Sync now*. *Check changes* re-scans your Manual documents for edits, for
  free.
- **SYNC STATUS**: a progress bar over your tracked pages, split by type
  (notes / PDFs), with a details view:
  1. **Queue**: new or edited, not read yet.
  2. **OCR done, Vision to do**: the OCR landed, Vision has not (a failed
     attempt, or no host to render). A **▶ Force Vision** button sits right
     there.
  3. **Finished**: Vision transcript, or your own correction.
- A **⏹ Stop** button interrupts any running pass; paid pages are kept.

## 4.2 Browse transcripts

`[IMAGE: browse_a.jpg]`

Open a document to see **every page as a tile**: the first lines of its
transcript, its source, or *not read yet* if it has never been read. A page
that was read and found empty says *(blank page)*: it is done, not pending.
The header counts what is transcribed out of the total.

`[IMAGE: browse_b.jpg]`

Open a page and you get three things side by side: **the transcript**, the
**original page image**, and the Supernote's own live OCR (free, for
comparison).

From here you can:
- **Edit** the transcript by hand. A corrected page is marked as yours and is
  **never** overwritten by a later sync;
- tap an **underlined "unsure" word** to fix just that word;
- **Re-read** the page (or *Read with Vision* on a PDF page, for a schema or
  an annotation);
- **Rotate right + redo** / **Rotate left + redo**: re-read the page rotated by
  90°. Pages written in landscape are usually flagged as such by the Supernote
  and straightened automatically before reading, so you rarely need this. It is
  there for the cases where that flag is missing and the AI read your page
  sideways;
- **Export** this page, or add it to the chat.

## 4.3 Search

`[IMAGE: search.jpg]`

Search runs over **your local transcripts only**, that is what has already
been read. An *Off* document, or one never synced, is invisible until you
sync it.
Results are capped and the line under the field always shows how your query
was understood.

**The grammar** (separators: a space or a `+`):

| You type | It means |
|---|---|
| `budget review` | both words, anywhere in the page (AND condition) |
| `"quarterly review"` | that exact phrase |
| `budget\|forecast\|plan` | any one of them (OR condition)|
| `!draft` | pages **without** that word |
| `!"to do"` | pages without that phrase |
| `n:Egypt` | in notes whose **name** contains "Egypt" |
| `f:Perso` | in that **folder** |
| `type:note` / `type:pdf` | only notes, or only PDFs |
| `star:` / `star:no` | pages with (or without) a **starred** mark |
| `kw:invoice` | pages carrying that Supernote **keyword** (or part of the keyword) |
| `src:manual` / `src:ai` | your hand-corrected pages, or AI-read ones |
| `after:2026-01` / `before:2026-06` | by read date |
| `p:12` | page 12 (1-based) |
| `p:first` / `p:last` | the document's first / last transcribed page |
| `approx:meting` | tolerate spelling variants |
| `sort:date` | order by date instead of relevance |

Criteria combine freely: `f:Work type:note "action items" !draft after:2026-03`.

**On each result line** you can: open the **transcript**, **Go to page** (the
Supernote opens the real page), or **add the page to the chat**.

## 4.4 Export

`[IMAGE: export.jpg]`

Transcripts become real files, `.md` (formatted) or `.txt` (plain), and you
can start an export from **every level**:

| From | Exports |
|---|---|
| Library header, *Export all* | the whole library |
| a **folder** row, *Export ▾* | that folder and everything under it |
| a **document** row, *Export ▾* | that note or PDF |
| the **page grid**, *Select pages* then export | only the pages you ticked |
| a **page** view | that single page |
| a **search result** | the matching page |

Files land in **`/EXPORT/`**, at the root of your Supernote, mirroring your
folder tree. They are visible from a PC over USB, from the Supernote Partner
app, and can be synchronised to the cloud. Each file starts with a header
giving the date and how complete the export is. Re-export after a sync to
refresh.

---

# 5. The floating assistant

`[IMAGE: chat.jpg]`

*Open the assistant* gives you a movable, resizable panel that floats **over**
your note: you keep writing on the page while you talk about it. Drag the
header to move it, the black bar at the bottom to resize it, the **⌄** button
to collapse it into a floating bubble, **⛶** to snap it to a corner or full
screen, and **✕** to close it.

## 5.1 CHAT

- The **brain dropdown** (the name and arrow in the header) switches between
  CHAT and your agents. It shows the current model, how many documents and
  pages are loaded, *New chat*, and your **History**.
- **Quick actions** under the input write a prompt into the field; you send it
  yourself with the **M** button.
- **Web** is one-shot: arm it and it applies to the next message only. Web
  answers cite their sources.
- A **Stop** button is always available while the assistant works.
- Asking about pages that are not read yet shows the **price first**. *Off*
  files ask for a one-time consent, and their text is stored nowhere: not in
  your library, not at Mistral.
- Follow-up questions cost about 10% of the first, thanks to prompt caching.

## 5.2 Agents

Pick an agent from the brain dropdown when you **start** a conversation.
It brings its persona, model, answer style, quick actions and its documents.
You can also change agent during a conversation to change the behavior of the chat, the full history is send to the new model to allow continuying the discussion.

`[IMAGE: brain_agents.jpg]`

## 5.3 Search from the panel

The same search as the Library, without leaving your page. The input at the
bottom of the panel does two different things, so you tell it which one you
want: tap the **🔍 magnifier** on its left to switch the panel into **search
mode** (the placeholder changes to *Search notes*), and tap it again to go
back to asking the AI. In search mode what you type is a query against your
transcripts, not a question to a model, and nothing is sent anywhere.

Each hit can be opened as a transcript, jumped to with *Go to page*, or
**added to the current conversation**.

`[IMAGE: panel_search.jpg]`

## 5.4 Context management

The **Chat context** row under the header shows exactly what will be sent.
Each chip opens **its own** manager:

- **⌾ Current note**: choose the scope, *This page*, a *Range*, or the
  *Whole note*. *See transcript* shows the transcript of **this context
  only**. You can also remove the current page from the context.
  `[IMAGE: ctx_current.jpg]` `[IMAGE: ctx_transcript.jpg]`
- **📄 Added pages**: the pages you added from the Library or from Search, one
  per line, each with a **✕** to remove it. *See transcript* shows the
  transcripts of **these pages only**, in order.
  `[IMAGE: ctx_added.jpg]`
- **🖼 Lasso**: the lassoed image itself, with *Remove from context*.
  `[IMAGE: ctx_lasso.jpg]`
- **＋**: adds more pages from the Library.

The current-page chip follows you as you turn pages.

## 5.5 Lasso

Select part of a page with the Supernote lasso and tap **Ask SmartNote AI**.
The selection is attached to the conversation as an image. It is not a
separate tool: it rides on whatever chat or agent is active.

- The image stays as a **Lasso chip** until you remove it; add several if you
  want.
- The instruction sent with it is the *Lasso: image reading* directive
  (door 2), editable, or empty for none.
- Your **lasso quick actions** (door 3) appear while an image is in context.

No transcription is involved: lasso a diagram and ask "explain this", lasso a
to-do and ask "turn this into a checklist".

---

# 6. Extra

## 6.1 Costs, privacy, tips

### Costs

You pay **Mistral directly**, for what you read or ask.

- Transcription cost : ~4€/1000 pages (prices July 2026)
- **Unchanged pages are never paid twice.**
- Every paid action shows its estimated price **before** you confirm, with one
  exception: **Auto**, which by design reads silently in the background. If you
  want a hard ceiling, set a monthly budget cap in the Mistral console.
- Chat questions are billed per token; follow-ups are far cheaper (~10% of
  the first) thanks to prompt caching.
- Your live usage is at **https://admin.mistral.ai/organization/usage**.
- Free tier: every feature works, all models are available with comfortable
  limits (~1300 pages/month in field testing), but only a **paid** plan
  guarantees no training on your data.

### Privacy

- **Off** files never leave the device (one-time consent excepted, and that
  read is never stored).
- Transcripts, conversations, settings and your **encrypted** key live in the
  plugin's private directory: not cloud-synced, not visible over USB.
- Mistral is a European company under the GDPR; a paid plan does not train on
  your data.
- Still: do not put in any cloud service what you would not want to leave the
  device at all. That is what *Off* is for.

### Tips/infos

- Feed the **glossary** with your recurring names and jargon. Accuracy jumps.
- Active notebooks on Auto, archives on Manual, private ones on Off.
- Text and button sizes (door 1) apply everywhere, floating panel included.
- Accuracy depends on your handwriting: OCR + Vision handle most of it, but
  messy pages and unusual names trip any AI. The glossary is your lever.
- The interface is in **English** only.
- This guide lives in `Document/SmartNote AI/`. Deleting it is fine: the
  configuration home page reinstalls it.
- **Tested on** the Manta and the A5 X. Other current models on the same
  plugin framework should work but are less tested. Because a plugin rides on
  device internals, a firmware update can briefly break it. If something stops
  working right after one, check for a new release.

### Before uninstalling, read this

Uninstalling the plugin **deletes its private directory**: your transcripts,
your conversations, your settings and your stored key go with it. If you want
to keep them: **Library → Back up library**, and **door 1 → Export settings**.
Both write to `MyStyle/`, which survives the uninstall and is visible over USB
or from the Partner app.

## 6.2 Why Mistral only

I feel this design choice will be the first "blame" on my plugin : why Mistral and why Mistral **only** ? That is a deliberate choice, and here is the reasoning.

Our handwritten notes are among the most personal data we own, and the privacy was my key concern during this plugin development. I would personnaly not trust sharing my daily notes and personnal thinking to "I don't know whom and I don't care who will read them and why..."

The question is not only "is the model smart?" but **"under whose laws does this text land, and who can compel access to it?"**

The plugin already keeps exposure small: everything (transcripts, chats,
settings, your encrypted key) stays **on the tablet**; each request is
transient: Mistral answers and keeps no memory of you beyond a short-lived
cache that makes follow-ups cheaper, and *Off* files are never sent. (On a
paid plan.)

But the most significant privacy impact is the choice of the AI model used. 

I choose Mistral that is an **EU company** (French), so all API requests fall under the
GDPR: no training on your data on a paid plan, the data use is limited to answering your
request, real security duties, and enforceable rights (access, deletion) with
regulators and heavy fines behind them. A legal framework that have demonstrated it's strenghts, not a settings toggle.

Other jurisdictions work differently. In the US, the **CLOUD Act** lets
authorities compel a US company to hand over data wherever it is stored, and
**FISA (Foreign Intelligence Surveillance Act) Section 702** openly targets
surveillance of non-US persons located outside the US, and agencies such as
the FBI can search that data without a warrant.

In China, the **National Intelligence Law (Article 7)** and the **Data Security Law** require companies
to cooperate with the state on request. 
A training opt-out only helps as far as you trust it is honoured, with no independent regulator behind it.

**You are in the US or in China?** An EU model may help you also: your notes get
European-grade handling *and* sit outside your own country's easiest reach.
No provider hides you from a determined state, and nothing dangerous for you
should go into any cloud, but for everyday notes, moving them under EU law is
a real gain wherever you live.

**Is the quality there?** For reading your handwriting and answering about
your own pages, what matters is legibility and your glossary, not frontier
reasoning, and Mistral's OCR and vision models are strong at exactly that
(they were chosen on measured results, not on brand). 
Sure, top providers models are clearly ahead than Mistral, but I consider Mistral "good enough" for Supernote users needs, and this tradeoff I make on purpose, driven by "Privacy first". 

## 6.3 Licence

SmartNote AI is released under the **GNU Affero General Public License,
version 3 (AGPL-3.0)**.

In plain terms:

- **You may** read, audit, run, modify and share the code. Pull requests are
  welcome.
- **If you distribute a modified version**, or run one as a network service,
  **you must publish your source code under the same licence.** Improvements
  come back to everyone.
- **There is no warranty.** You run it at your own risk.
- **The name and logo are not covered by the licence.** "SmartNote AI" and its
  icon stay mine: a fork must ship under its own name.

Why AGPL: the code is open for anyone to inspect, which matters for a plugin
that handles your notes and claims to take care of your privacy, but nobody
can take the work, swap a few pieces, and close it up as a product of their
own. The full licence text ships with the sources (`LICENSE`).

Sources, issues and pull requests: **github.com/AgP42/SN-Plugin-SmartNoteAI**
Support the project: **ko-fi.com/agp42**

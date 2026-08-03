# Brouillon post Reddit — r/Supernote (à relire/adapter avant publication)

**Titre proposé :**
[Plugin] SmartNote AI v1.0 — search & chat over your handwritten notes, privacy-first (open source, AGPL)

---

Hi r/Supernote 👋

After a few months of building (and a lot of testing on my Manta), I'm
releasing **SmartNote AI v1.0** — a plugin that turns your Supernote into
an AI-assisted notebook without giving your notes away.

**What it does**

- **Transcribe what you choose** (Mistral OCR + a Vision pass, so
  drawings, tables and margin notes are read too). Each page is
  fingerprinted: an unchanged page is never paid twice — and moving a
  note to another folder, or a page to another note, keeps its
  transcript.
- **Search every word you ever wrote**, in seconds, with a small grammar
  (`f:folder`, `type:pdf`, `star:`, `approx:word`, …). Tap a result and
  the Supernote opens the real page.
- **A floating assistant** over the page you're writing: ask about the
  current page, a range, the whole notebook. **Lasso** a sketch or a
  scribbled address and ask about the image directly.
- **Agents**: a "Thesis" agent that knows a 300-page PDF, a "Meeting
  notes" agent over your work notebooks — you build them from your
  library.
- **Export** any page/notebook/folder to `.md` or `.txt`, full local
  **backup/restore**, hand-corrections that are never overwritten,
  **locks** to freeze a transcript for good.

**The privacy stance (why I built it this way)**

Your notes never touch a server of mine — there is none. The plugin
talks to exactly ONE provider, **Mistral (EU, GDPR)**, with **your own
API key**, and only for the pages you choose: an `Off` mode guarantees a
file is never sent (and never silently stored). Everything else — the
transcript library, search, settings, your encrypted key — lives in the
plugin's private storage on the device. The code is **open source
(AGPL-3.0)** so you can check every word of this paragraph.

**Costs**: you pay Mistral directly, roughly **~4€ per 1000 pages**
transcribed (July 2026 pricing), chat costs cents. There's a usable free
tier to try everything. No subscription, no middleman.

**Install**: download the `.snplg` from the GitHub release, copy it to
`MyStyle/`, then Settings → Apps → Plugins. A 16-page illustrated user
guide is embedded (and in the repo). Tested on the Manta (A5 X2);
installs on the A5 X gen 1 via MTP.

**Links**
- Code + releases + user guide: https://github.com/AgP42/SN-Plugin-SmartNoteAI
- If it's useful to you: https://ko-fi.com/agp42

Feedback, bug reports and PRs very welcome — this is v1.0, be kind but
honest. 🙂

---

*Notes pour toi avant de poster :*
- *Ajoute 2-3 captures (le panneau flottant sur une note, la recherche,
  la Library) — les posts avec images performent bien mieux.*
- *Vérifie la règle du sub sur l'autopromotion (flair "Plugin" ou
  "Project" si dispo).*
- *Le chiffre ~4€/1000 pages vient du manuel ; re-vérifie ta conso
  réelle si tu veux l'affiner.*

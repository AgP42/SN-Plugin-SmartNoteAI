# SmartNote AI — textes UI (v0.88.0 · 2026-07-30)

- **MàJ v0.88.0 (2026-07-30)** : **balayage tirets cadratins** — plus aucun « — »
  dans les textes visibles (remplacés par « : », « · », virgule ou point ; la
  règle v0.23 avait dérivé). **SYNC STATUS** : nouvelle ligne d'état du host de
  rendu (« Rendering via: note app (PDF Vision waits for a PDF) » / « …PDF
  reader… » / « …none yet (open a note or a PDF) »). **Vision now** : messages
  reformulés (« Vision on OCR-only PDF pages: needs a PDF open (also runs by
  itself when one is)… » ; échec partiel : « retries by itself at the next
  sync »), et pre-check host (« Open a PDF in the reader first: Vision renders
  there. It also runs by itself once one is open. »). **Sync now** occupé :
  « Another pass is finishing, yours runs right after… ». **Tuiles pages** :
  une page lue mais vide affiche « (blank page) » (au lieu de « not read
  yet »). **READ** : le reset de page est armé (« Tap again to reset ALL
  blocks »). La synchronisation se déclenche désormais seule (host sondé à
  chaque passe) : les textes qui suggéraient une action manuelle disent
  maintenant que ça repart tout seul.

- **MàJ v0.83.0 (2026-07-28)** : lasso → **mode transverse** (l'image devient un chip persistant « 🖼 Lasso » sur n'importe quel chat/agent ; directive « Lasso — image reading » en porte 2 ; jusqu'à 3 *image quick actions* « About this selection » en porte 3) ; lecture des **annotations .mark + schémas via Vision** (bouton PDF « 🔍 Read with Vision (schemas & annotations) », annotations lues automatiquement) ; refonte **Library / SYNCHRONISATION** (AUTO & MANUAL côte à côte, SYNC STATUS toujours visible, « ☀ Keep Supernote awake during Sync », actions bibliothèque, badges d'agent par ligne, « 🗑 Clear transcript ») ; **audit UX** (confirms en vidéo inversée, scaling texte/bouton partout, `BigTextInput` Paste/Clear/Reset) ; **mode Batch RETIRÉ** (plus de Sync batch, de filtres Expand 1/2/3/all, de « ＋ Whole note » / « ⟳ Refresh capture » dans le chat).

> Fichier ÉDITABLE : modifie directement le texte d'une ligne (garde son ID),
> puis redonne-moi le fichier ou dis « applique » — je fais le diff et je
> reporte dans le code. Les parties dynamiques sont notées `${…}`, les
> variantes d'un même élément séparées par « / ». Ne pas renuméroter les IDs.


## H — Accueil (hub)

- H1 · [title] · "SmartNote AI" (header title, with app icon)
- H2 · [title] · "User Guide" (section heading)
- H3 · [paragraph] · "Your Supernote in the age of AI — privacy first!\nTwo ways to use it:\n**① Just ask.** Open the floating assistant on any note and ask the AI about the page, a range of pages or the full note; or lasso a part of it for a quick question. The transcription will be generated live.\n**② Build a library (READ).** You can also transcribe a selection of your notes and PDFs into a local library, this will open up more features: powerful SEARCH, AI AGENTS that know your documents, and EXPORT." (bold : ① Just ask. / ② Build a library (READ).)
- H4 · [label] · "READ" (module tree box, black/active)
- H5 · [label] · "│" (tree connector line)
- H6 · [label] · "CHAT" (module tree box, black/active)
- H9 · [label] · "AI AGENTS" (module tree box, black/active — après CHAT)
- H7 · [label] · "SEARCH" (module tree box, black/active)
- H8 · [label] · "EXPORT" (module tree box, black/active)
- H10 · (RETIRÉ — la boîte grise "…" « coming » a disparu ; les 5 boîtes sont toutes actives)
- H11 · [paragraph] · "**READ**: transcribe notes and PDFs with Mistral OCR 4 + Ministral 14B Vision; correct anything by hand. Three modes per folder or note/PDF: Auto, Manual, Off.\n**CHAT**: ask any Mistral model about a page, a range or the whole note; add any extra context, or lasso a zone for a quick question.\n**AI AGENTS**: custom chats with their own persona, model and library documents.\n**SEARCH**: powerful search into your local transcripts.\n**EXPORT**: export your local transcripts in .md or .txt.\n\n**Privacy first**: open source plugin, AI from Mistral AI only (EU/GDPR, a paid plan never trains on your data, nothing stored on their servers), your own encrypted key, transcripts local-only. Anyhow, do not share confidential information.\n\nGuide and sources: github.com/AgP42/SN-Plugin-SmartNoteAI" (bold : READ, CHAT, AI AGENTS, SEARCH, EXPORT, Privacy first)
- H23 · [button] · "Open the User Guide (PDF) →" (ouvre le PDF embarqué, le réinstalle depuis les assets s'il a été supprimé)
- H12 · [status] · key status line, three variants :
  - `✓ key loaded (${maskKey(keyState.config.apiKey)})`
  - "⚠ No API key yet: set it in \"1 · API key, privacy, backup & appearance\""
  - "Loading…"
- H20 · [title] · "Configuration" (section heading au-dessus des 3 portes de config)
- H13 · [button] · door 1 : "1 · API key, privacy, backup & appearance →" (rendu `${label} →`)
- H14 · [button] · door 2 : "2 · READ: AI transcript params →"
- H16 · [button] · door 3 : "3 · CHAT & AGENTS: your assistants →" (rendu `${label} →`)
- H21 · [title] · "Plugin modules" (section heading au-dessus de la porte Library)
- H15 · [button] · "📚 LIBRARY: browse, sync & fix your transcripts →" (JSX : `browse, sync &amp; fix your transcripts`)
- H17 · [button] · "Open floating assistant" (s'ouvre sans clé — seul l'ENVOI exige une clé)
- H25 · [hint] · sous le bouton, sans clé : "Tip: it opens without a key — but answering needs one (set it in \"1 · API key…\")."
- H18 · [paragraph] · footer (Ko-fi) : "SmartNote AI is a personal project built by a Supernote user, for Supernote users. It is not an official product of Supernote or Mistral AI, just a plugin that loves them both. I built it with love, time, skills and expensive tokens ;-) If you like it, please consider a small contribution:"
- H19 · [label] · "https://ko-fi.com/agp42" (selectable link text, next to Ko-fi QR image)
- H24 · [status] · "opening the User Guide…" / (échec) "⚠ Could not open the User Guide PDF."

## K — 1 · API key, privacy, backup & appearance

- K1 · [title] · "1 · API key, privacy, backup & appearance" (sub-header)
- K2 · [title] · "Mistral API key" (section heading)
- K3 · [paragraph] · key state, two variants :
  - `Current key: ${maskKey(apiKey)}, stored encrypted in the plugin's private storage (never synced).`
  - "No key stored yet. Paste your Mistral API key below."
- K4 · [hint] · "Get one at https://console.mistral.ai/ → API Keys → Create (about 3 clicks). The free tier allows using all features of this plugin, but only a paid plan guarantees Mistral never uses your data to train its models."
- K5 · [placeholder] · "paste a new Mistral API key…"
- K27 · [button, v0.76.1] · "Paste from clipboard" (colle la clé depuis le presse-papier natif) + (champ non vide) "Clear"
- K6 · [button] · "Save key (encrypted)"
- K7 · [button] · "Delete stored key" / (armé, vidéo inversée) "Really delete the stored key?"
- K8 · [hint] · (only if legacy file present) "The old key file (MyStyle/…/mistral-key.txt) still exists. MyStyle syncs to the Supernote cloud; once the key works here, delete it."
- K9 · [button] · "Delete old key file"
- K10 · [title] · "Privacy" (section heading)
- K11 · (RETIRÉ — l'ancien paragraphe « SmartNote AI asks once, at first use… » est parti avec le consentement cloud)
- K12 · [note] · "Using CHAT or a Sync sends your questions and the pages' content (text, and images when reading) to Mistral (EU) with your own key. Nothing is stored on their servers, and only a paid Mistral plan guarantees your data never trains their models. Files set to Off are never sent."
- K13 · [hint] · "Transcripts stay on this device only. This wipes every one of them for good (same as the Library button)."
- K14 · [button] · "Clear ALL transcripts" / (armé, vidéo inversée) "Really clear ALL transcripts?"
- K22 · [title] · "Settings backup" (section heading)
- K23 · [paragraph] · "Settings are stored in the plugin's private storage (never cloud-synced). Export writes a readable copy to ${EXPORT_SETTINGS_PATH sans /storage/emulated/0/} — as a backup, to edit by hand, or to move to another device. Import replaces ALL settings with that file."
- K24 · [button] · "Export settings"
- K25 · [button] · "Import settings (replace all)" / (armé, vidéo inversée) "Really replace ALL settings from the file?"
- K28 · [button, v0.80] · "Add starter agents" (ajoute les presets de départ ; status "Added ${n} starter agent(s) — open \"3 · CHAT & AGENTS…\" to try them." / "All starter agents are already in your config.")
- K26 · [status] · "Settings exported to ${path}." / "Export failed — could not write the file." / "Settings imported (${fields})." / "Import failed: ${error}."
- K15 · [title] · "Appearance" (section heading)
- K16 · [label] · "Text size"
- K17 · [chip] · text-size chips : "S" / "M" / "L" / "XL"
- K18 · [label] · "Button size"
- K19 · [chip] · button-size chips : "S" / "M" / "L" / "XL"
- K20 · [label] · "Note toolbar side (snaps won't cover it)"
- K21 · [chip] · toolbar-side chips : "None" / "Left" / "Right" / "Top" / "Bottom"

## R — 2 · READ: transcript params

(Les fragments `ocrConfigBlock`, `glossarySuggestUI`, `ocrTestUI` se rendent sur cet écran. Les labels/hints/défauts des blocs viennent de visionPrompt.ts — voir section V.)

- R1 · [title] · "2 · READ: AI transcript params" (sub-header)
- R2 · [paragraph] · "Every page is read by Mistral OCR 4 and then by Vision (ministral-14b), which follows the prompt below. Each page is read the first time you ask about it (or in the background when set to Auto), stored in your library, and reused for free after. PDFs are read by OCR (printed text, correct multi-column order); a PDF page the OCR struggles with is escalated to Vision automatically, with a neutral document prompt (same blocks below, minus the notebook-specific ones)."
- R3 · [title] · "Vision prompt — what the AI is told" (section heading, avec à droite le bouton R35)
- R35 · [button, v0.83.1] · "Reset to default · all this page" (remet TOUS les blocs de prompt ET la directive lasso à leurs défauts)
- R4 · [paragraph] · "Nothing is hidden: the full instruction sent to the model is these blocks, joined. Edit any of them. The Glossary (your names, acronyms, jargon) is the biggest quality lever."
- R5 · [label] · par bloc : `${b.label}` + tag "   (.note only)" (role/fidelity côté note + template) / "   (.pdf only)" (role/fidelity côté PDF, rendus CÔTE À CÔTE) / "   (.note + PDF)" (les autres). Labels externes — visionPrompt.ts.
- R6 · [button] · reset par bloc = le bouton "Reset to default" de `BigTextInput` (voir R34), visible seulement quand le bloc diffère de son défaut
- R7 · [hint] · par bloc : `${b.hint}` (externe — visionPrompt.ts)
- R8 · [placeholder] · éditeur de bloc : `${b.default}` (externe) — SAUF le bloc glossary qui utilise le placeholder local :
  "Notes in ENGLISH and SPANISH.\nTopics: beekeeping business, permaculture garden.\nPeople often mentioned: Dr Ramirez, Marta Okafor, uncle Bram.\nAcronyms and jargon: IPM, CAP, HOA, top-bar hive, nuc box…" (`PERSONA_OCR_PLACEHOLDER`)
- R9 · [button] · "Suggest words from my library" (sous le bloc glossary)
- R10 · [hint] · "No suggestions yet: they build up as Mistral reads your pages."
- R11 · [label] · "The OCR often hesitates on these (tap to add):"
- R12 · [chip] · suggestion chip : `+ ${w}`
- R13 · [label] · "Frequent names in your notes (tap to add):"
- R14 · [button] · OCR test : "Test the prompt on the current page" / (busy) "Reading current page…"
- R15 · [status] · OCR test error : `⚠ ${ocrTest.reason}` — raisons locales :
  - "No captured .note page: tap the plugin button from a note."
  - "Page render failed."
  - (sinon le message API/exception verbatim)
- R16 · [status] · résultat OCR test vide (rendu MarkdownView) : "(empty result)"
- R17 · [hint] · "Satisfied? Keep stores it as the page's transcript (it is paid for); Discard keeps nothing."
- R18 · [chip] · "Keep this transcript" (chip actif = vidéo inversée)
- R19 · [chip] · "Discard"
- R20 · [title, repliable] · "▸/▾ Full prompt — handwritten pages (.note)" (card = `assembleVisionPrompt`, replié par défaut)
- R21 · [title, repliable] · "▸/▾ Full prompt — PDF pages escalated to Vision" (card = `assemblePdfVisionPrompt`)
- R22 · [paragraph] · "A PDF page the OCR struggles with is often hard PRINT (old scan, dense table), not handwriting — so its Vision pass uses a neutral document version of the prompt: the \"(.pdf only)\" Role and Fidelity blocks above, no notebook-template block, and your \".note + PDF\" blocks exactly as you edited them."
- R30 · [title, NOUVEAU v0.81] · "Lasso — image reading" (section heading)
- R31 · [paragraph] · "When you lasso a part of a note and send it, this instruction is added to whichever chat or agent is active, telling the AI there is an image to read and act on. Edit it freely. Leave it EMPTY to send no instruction at all."
- R32 · [placeholder] · éditeur (`BigTextInput`) : "(empty — no image instruction is sent)" (valeur = `lassoDirective`, défaut = `DEFAULT_LASSO_DIRECTIVE`, voir Q6)
- R33 · [button] · "Reset to default" (barre `BigTextInput` du champ lasso ; restaure `DEFAULT_LASSO_DIRECTIVE`)
- R34 · [toolbar `BigTextInput`, v0.81] · sous chaque grand champ (blocs de prompt R8 + champ lasso R32) : boutons "Paste" (colle le presse-papier natif, APPEND) · "Clear" (vide le champ ; grisé si vide) · "Reset to default" (visible seulement si la valeur diffère du défaut)

## V — Blocs du prompt vision (défauts)

- V1 · [block id "role"] · label "Role" · hint "What the model is doing and what to output." · default : "You transcribe handwritten notebook pages from an e-ink tablet. Output ONLY the transcription itself, with no preamble and no commentary."
- V2 · [block id "fidelity"] · label "Fidelity" · hint "How faithful, and what to do with unreadable words." · default : "Transcribe the handwriting faithfully and completely, in reading order, in its original language, including small insertions and margin notes. Never invent text; mark an illegible word with <?>."
- V3 · [block id "formatting"] · label "Formatting (Markdown)" · hint "The plugin renders Markdown, so ask for it here." · default : "Format the transcription in light Markdown. Use # and ## for headings the page shows as titles, - for bullet lists, 1. for numbered lists, > for quotes, and **bold** ONLY where the writer clearly emphasised a word (underline, box, colour). Render a hand-drawn table as a Markdown table. Reflow narrow line-wraps into flowing sentences: keep a line break only for a real new paragraph, list item, heading or table row."
- V4 · [block id "drawings"] · label "Drawings & diagrams" · hint "What to do with schemas and sketches." · default : "If the page contains drawings, diagrams or schemas, describe each one briefly in place (what it depicts, its boxes and links)."
- V5 · [block id "template"] · label "Template vs content" · hint "Ignore the printed background, keep real content." · default : "Ignore the blank printed template graphics (ruled lines, grids, margins). But you MUST transcribe any text written or printed inside a box, a shaded or coloured area, a title field or a header — that is content (e.g. the page title), not template."
- V6 · [block id "languages"] · label "Languages" · hint "Which languages your notes mix." · default : "The notes mix French, English and German, sometimes within one sentence. Keep each word in the language it is actually written in."
- V7 · [block id "money"] · label "Money & units" · hint "Currency and unit conventions." · default : "Financial amounts are almost always in euros: write € for euros, k€ for thousands, M€ for millions. A currency mark that looks like £ or $ next to a number is almost always € on these pages."
- V8 · [block id "glossary"] · label "Glossary (your vocabulary)" · hint "Names, acronyms and jargon you write often — the biggest quality lever." · default : "" (vide)
- V9 · [constant] · MAX_BLOCK_CHARS = 4000 (cap par bloc)

V count : 8 blocs + 1 constante

- V10 · [pdf role, id "pdfRole" — ÉDITABLE depuis v0.47] · label "Role" · hint "What the model does on a PDF page escalated to Vision." · default : "You transcribe one page of a PDF document. The page may contain printed text, handwriting, tables or figures. Output ONLY the transcription itself, with no preamble and no commentary."
- V11 · [pdf fidelity, id "pdfFidelity"] · label "Fidelity" · hint "Faithfulness rules for escalated PDF pages." · default : "Transcribe the page faithfully and completely, in reading order, in its original language, including margin notes and annotations. Never invent text; mark an illegible word with <?>."
  (l'escalade PDF réutilise ensuite les blocs V3/V4/V6/V7/V8 avec tes overrides ; V5 « template » ne s'y applique pas)

## L — 3 · LIBRARY

### Écran principal (search + actions bibliothèque + cadre SYNCHRONISATION + arbre)

- L1 · [title] · "📚 LIBRARY: browse, sync & fix your transcripts" (sub-header identique à la porte H15 ; back labellé "‹ Config")
- L2 · [title] · "Search" (section heading ; les champs de recherche vivent dans SearchControls.tsx)
- L3 · [status] · recherche active, zéro résultat : "No match. Search only covers pages already read by the AI — a folder or note that is Off or never synced is invisible here. Set it to Manual/Auto and Sync to make it searchable."
- L4 · [status] · `${searchHits.length} result(s):`
- L5 · [label] · ligne de résultat : `${h.name} · p.${h.page + 1}` (snippet avec termes en gras via `highlightSnippet`)
- L50 · [button] · par résultat : "Transcript" / "Go to page ›" / "+ Add to ▾" (AddToPicker — CHAT ou un agent)
- L6 · [title] · "All notes & PDFs" (section heading ; JSX `All notes &amp; PDFs`)
- L51 · [button, NOUVEAU v0.79.13 — row d'actions bibliothèque à côté du titre] :
  - "Export all .md" / "Export all .txt" (préfixe "✓ " sur succès)
  - "⤓ Back up library"
  - "⤒ Restore backup" / (armé) "Restore backup? (tap again)"
  - "Clear transcripts of Off notes" / (armé) "Clear Off-note transcripts? (tap again)" (seulement si lib non vide)
- L7 · [button] · destructeur ultime (remplace l'ancien « Clear all ✕ ») : "⚠ Clear all transcripts" / (armé, vidéo inversée) "⚠ Tap again: wipe ALL transcripts"
- L52 · [banner] · `<ActivityBanner>` — voir A1-A4 (bandeau « ⚙ ${label} ${done}/${total} » + "✕ Stop" / "stopping…", s'auto-retire)
- L8 · [label] · "SYNCHRONISATION" (label du cadre)
- L53 · [button, titre du cadre] · toggle keep-awake : "☀ Keep Supernote awake during Sync" / (actif, vidéo inversée) "■ Keep Supernote awake during Sync"
- L9 · [label] · deux colonnes CÔTE À CÔTE : "AUTO" (gauche) / "MANUAL" (droite) — le bloc OFF a disparu (Off = interrupteur de confidentialité)
- L54 · [status] · ligne « last sync » de chaque colonne (si une sync a eu lieu) : `last sync ${fmtDateTime}`
- L10 · [status] · filesLine de chaque colonne (v0.69 schema) : `${f} folder(s) · ${noteFiles} notes · ${pdfFiles} PDF · ${pages} tracked` (« folder » au singulier / « folders » au pluriel ; parties nulles omises) / "nothing on Auto" / "nothing on Manual"
- L55 · [status] · ligne « to read/sync » : colonne AUTO `${n} pages to read` / "all up-to-date" ; colonne MANUAL `${toSync} pages to sync` / "all up-to-date"
- L56 · [button, colonne AUTO] · "Force sync" / (busy) "Syncing…"
- L48 · [button, colonne MANUAL] · "Check changes" / (busy) le status en cours ou "Checking…" (renommé depuis « Check all notes for changes » ; passe FREE sur notes + PDF Manual)
- L11 · [button, footer colonne MANUAL] · `Sync now · ~${eurosTotal(toSync)} €` / (busy) `Syncing… ${syncingNote}`
- L57 · [status/section, NOUVEAU v0.69 — SYNC STATUS, sous les deux colonnes, toujours visible] :
  - titre "SYNC STATUS"
  - ligne : `Auto + Manual · ${finished}p read / ${tracked}p tracked · ${pct}% · ${onGoing}p on-going`
  - toggle "details ▸" / "hide ▾" + barre de progression
  - détails dépliés — 3 lignes : "1 · Queue" (hint "new / edited, not read yet") · "2 · OCR done, Vision to retry" (hint "on Supernote") avec bouton "▶ Vision now · ${ocrDone}" / (busy) "Running vision…" · "✓ · Finished"
- L58 · [row, sous le cadre] · filtres : "Show:" + chips "Auto" / "Manual" / "Off" (multi-select, vidéo inversée) ; si ≥1 agent : " · In agent:" + un chip `${icon} ${name}` par agent
  - (RETIRÉ v0.80 : les filtres « · Expand: 1/2/3/all » — ancien L64)
- L16 · [label] · caret d'arbre : "▾" (ouvert) / "▸" (fermé)
- L17 · [label] · ligne de dossier : `${name}/` (racines "Note" et "Document")
- L18 · [status] · "(empty)" (dossier vide déplié)
- L49 · [label] · racine SD : "SD_Card" / "SD_Card ${n}" (toute carte SD montée découverte dynamiquement)
- L59 · [chip, NOUVEAU — badge d'agent en bout de ligne] · un badge `${icon}` par agent qui possède ce doc/pages ; tap → armé `${icon} remove ✕` (2ᵉ tap = retire de CET agent)
- L60 · [button, bout de ligne] · "+ Add ▾" (AddToPicker — ajoute le dossier/doc à CHAT ou un agent)
- L70 · [menu `AddToPicker`, partout où « + Add … ▾ » apparaît] · items : "💬 CHAT (this chat)" (quand `showChat`) puis un item `${icon} ${name}` par agent ; menu vide : "No agents configured" ; bouton grisé sans cible possible : "No agent yet"
- L61 · [button, bout de ligne de dossier] · "Export ▾" (menu "Export .md" / "Export .txt" ; préfixe "✓ " sur succès)
- L19 · [status] · texte de statut de fichier (`stText`) :
  - `${count} · ${pend} to read` (Manual/Auto, en attente)
  - `${count} · ✓` (Manual/Auto, tout lu)
  - `${count} · ${total} to read` (Manual/Auto, jamais scanné)
  - "not read" (Manual/Auto, aucun compte local)
  - `${count}` (Off ou non tracké : `${total} p` seul, jamais « to read »)
  - "" (inconnu ; PDF sans compteur local avant 1ʳᵉ lecture)
- L20 · [chip] · Mode par ligne : `Sync: ${modeLabel}` (labels "Off" / "Manual" / "Auto") ; hérité d'un dossier : `↳ Sync: ${modeLabel}` (pointillé, grisé)
- L21 · [hint] · "One chip per row sets the mode: Off (never sent to the AI), Manual (read on demand — a Sync button or a chat question), or Auto (read in the background while the plugin is open). A folder covers every note and PDF under it; a note or PDF can be set on its own. There is a single engine — Mistral OCR, escalating to Vision automatically on hard pages. Setting a chip costs nothing; you only pay when pages are actually read."
- L12 · (RETIRÉ v0.80 — « Sync batch · −50%… », mode batch supprimé)
- L13 · (RETIRÉ v0.80 — ligne « At Mistral: … »)
- L14 · (RETIRÉ v0.80 — « Check batch results »)
- L15 · (RETIRÉ v0.80 — « Retry failed »)

### Grille de pages (un document) — `PageGrid`

- L22 · [title] · sub-header : `${docName}` (back labellé "‹ Library")
- L23 · [paragraph] · `${n transcrites} transcribed / ${browsePages.length} page(s). Tap one to view, edit or re-read its transcript.`
- E1 · [menu] · "Export ▾" (InlineMenu → "Export .md" / "Export .txt" ; préfixe "✓ " sur succès)
- L62 · [button] · "+ Add to ▾" (AddToPicker — ajoute le doc entier à CHAT/agent)
- E2 · [button] · "☐ Select pages" (mode sélection)
- L63 · [button] · "🗑 Clear transcript" / (armé, vidéo inversée) "Clear transcript? (tap again)"
- L67 · [button, PDF uniquement — hors mode sélection] · "🔍 Read all with Vision" / (armé, vidéo inversée) `Read all ${browsePages.length} p. with Vision? (paid, tap again)`
- L68 · [button, PDF uniquement — mode sélection] · `🔍 Read ${exportSel.size} p. with Vision` / (armé, vidéo inversée) `Read ${exportSel.size} p. with Vision? (paid, tap again)`
- E3 · [menu, mode sélection] · "Export ${n} p. ▾" (→ "Export .md" / "Export .txt") · "+ Add ${n} p. to ▾" · "Cancel"
- L24 · [label] · numéro de tuile : `p.${t.page + 1}`
- L25 · [chip] · source de la tuile (`SRC_LABEL`) : "Mistral OCR+Vision" ('medium' & 'improved') / "Mistral OCR" ('mistral-ocr') / "Manual" ('user')
- L26 · [status] · corps de tuile : le snippet, ou "(empty)" (lue mais blanche), ou "not read yet" (pas de transcript)

### Détail d'une page — `PageView`

- L27 · [title] · sub-header : `${docName} · p.${browsePage + 1}` (back labellé "‹ Pages")
- L28 · [button] · mode édition : "Cancel"
- L29 · [button] · mode édition : "Save (manual)" (chip actif = vidéo inversée)
- L30 · [dialog] · correction d'un mot : `Correcting "${wordFix.orig}":`
- L31 · [button] · word-fix : "Replace"
- L32 · [button] · word-fix : "Cancel"
- L33 · [status] · box transcript vide : "…" (chargement) / "(empty)" (chargé, sans texte)
- L34 · [button] · nav de page : "‹" (préc.) et "›" (suiv.)
- L35 · [label] · position : `p.${browsePage + 1}` + (si connu : `/${dernier + 1}`)
- L36 · [label] · `Source: ${pageView?.label ?? '…'}` — variants :
  - "no transcript yet"
  - `${SRC_LONG[e.source]} · ${fmtDateTime(e.at)}` (SRC_LONG : "Mistral OCR 4 + Vision" / "Mistral OCR" / "Manual (edited by you)")
- L64 · [status] · correction périmée : "✎ Edited since your fix — the page's ink changed after this manual correction. \"Redo AI transcript\" re-reads it (and overwrites your correction)."
- L37 · [hint] · `⚠ ${n} unsure word(s) — underlined bold in the transcript; tap one to fix it.` (n = mots low ENCORE présents dans le texte)
- L38 · [button] · "↗ Go to this page"
- L65 · [button] · "+ Add this page to ▾" (AddToPicker)
- L39 · [button] · "✎ Edit"
- L40 · [button] · "🔄 Redo AI transcript" / (busy) "🔄 Redoing…"
- L66 · [button, NOUVEAU v0.82 — PDF uniquement] · "🔍 Read with Vision (schemas & annotations)" (JSX `schemas &amp; annotations` ; lit schémas + annotations manuscrites composées)
- L40b · [button] · "↻ Rotate right + redo" / "↺ Rotate left + redo"
- L41 · [label] · colonne bas-gauche : "Original page" (un seul libellé .note ET .pdf)
- L42 · [status] · placeholder image : "…" (rendu) / (échec) "(no preview in this context: page renders need the app showing this document — open the plugin from the note/PDF and retry)"
- L43 · [label] · colonne bas-droite : "Supernote live OCR"
- L44 · [status] · OCR natif absent : "(no real-time recognition on this page)" (.note sans RTR) / "—" (pas un .note)

## A — 3 · CHAT & AGENTS (page unifiée à ZONES repliables)

- A1 · [title] · sub-header : "3 · CHAT & AGENTS: your assistants" (identique à la porte H16 qui mène ici)
- A27 · [paragraph] · intro : "One page for every assistant. CHAT is the default one — its persona, model, answer style and quick actions apply everywhere unless an agent overrides them. An agent adds its own name and a set of library documents it always has in mind; you pick it when STARTING a conversation. Document text is read from your local transcripts (free) and repeated context is billed at 10% after the first message."
- A28 · [chrome] · zones repliables : entête "▸/▾ ${titre}" + résumé grisé à droite quand repliée ; tout se replie au changement d'entrée
- A29 · [section] · "Your assistants · ${agents.length}/${MAX_AGENTS} custom agents" + suffixe save "   ✓ saved ${HH:MM:SS}" / "   ⚠ SAVE FAILED — settings not writable" / "   ⚠ SAVE FAILED — see logcat"
- A30 · [row, toujours en tête] · "💬 CHAT (default) · ${model-court}" (sélectionnée = vidéo inversée) ; entête d'édition "Edit — 💬 CHAT (default)" ; zones du défaut : **Model** / **Persona (System prompt)** / **Quick actions** / **Lasso quick actions**
- A2 · [zone] · "Model" (fusionne modèle + tools + answer style — anciennement « Chat model »)
- A3 · [paragraph, zone Model] · "Any Mistral model works in the field below. The presets are the ones that can use the chat's Web/Calc tools. Default is Small: open, cheap and on par with the big ones in our tests."
- A4 · [placeholder] · champ modèle : `${DEFAULT_MODEL}` (externe — keyFile.ts)
- A5 · [chip] · presets : `${m.label}` (Small/Medium/Large — catalog.ts)
- A6 · [hint] · à droite du champ : `"${saisie}" currently points to ${resolvedId}` (+ ligne `⚠ deprecated ${date} → use ${repl}`) ou "⚠ unknown model id (checked live against api.mistral.ai)" ; sous les chips : `${note} · prices as of 07/2026` (note = ligne prix, ou "custom model id") ; puis en petit italique `Mistral description: "${desc}"`
- A11 · [paragraph, bas de zone Model] · "Web search (~0.01€ per search) and Code interpreter (≈free) are ONE-SHOT buttons in the chat panel, next to Send: arm \"Web\" or \"Calc\" and they apply to your NEXT message only. Web answers cite their sources." + (modèle sans tools :) " This model does not support tools — pick Small, Medium or Large to use them." (⚠ le panneau ne ship plus que le bouton « Web » — voir P56)
- A24 · [subhead, zone Model] · "Answer style"
- A25 · [paragraph] · "How freely the assistant words its answers. Precise sticks to the facts with stable wording; Creative allows looser phrasing; Balanced uses each model's own tuning."
- A26 · [chip] · answer-style : "Precise" / "Balanced" / "Creative"
- A7 · [zone] · "Persona (System prompt)" (résumé replié = le persona ou "default")
- A8 · [paragraph] · "Shapes how the assistant answers. Leave empty for the default."
- A9 · [placeholder] · persona : `${DEFAULT_SYSTEM}` (externe — compose.ts)
- A14 · [zone] · "Quick actions" (résumé replié `${n on} on / ${total}`)
- A15 · [paragraph] · "Toggle which appear in the panel (ON/off), reorder with ↑ ↓."
- A16 · [button] · toggle par action : "ON" / "off"
- A17 · [placeholder] · label d'action : "Button label"
- A18 · [button] · réordonner/retirer : "↑" / "↓" / "✕"
- A19 · [placeholder] · prompt d'action : "Prompt sent to the AI…"
- A20 · [button] · "+ Add action" (sous le max)
- A21 · [label] · label d'une action neuve : "New action"
- A31 · [zone, NOUVEAU v0.81 — entrée CHAT] · "Lasso quick actions" (résumé replié `${n} shown with an image`)
- A32 · [paragraph] · "Up to 3 quick actions that appear in the panel ONLY when a lassoed image is in the context — ahead of the normal ones. The image-reading instruction itself lives in door 2 (READ → \"Lasso — image reading\")." (éditeur = A14-A21 ; cap MAX_IMAGE_QUICK_ACTIONS = 3)
- A33 · [button, bas de liste] · "+ New agent" (sous MAX_AGENTS) + menu "+ Add preset ▾" (options `${icon} ${name}` — voir AG14)

## AG — agents (dans la page unifiée A)

- AG3 · [rows] · un agent : `${icon} ${name} · ${model-court} · ${n} doc(s)` (sélectionné = vidéo inversée)
- AG4 · [editor] · entête "Edit — ${icon} ${name}"
- AG5 · [zone] · "Name & icon" · champ "Agent name" + GRILLE de 16 icônes : 🤖 🎓 📋 💼 📚 ⚖️ 📈 🛠️ 💡 🌍 ✈️ 🍳 🏥 🧪 🎨 ❤️ (sélectionnée = fond noir)
- AG6 · [zone] · "Model" (fusionne modèle + answer style de l'agent) :
  - champ libre, placeholder `${(model||DEFAULT_MODEL)} (CHAT default)` + chips Small/Medium/Large
  - note `${note} · prices as of 07/2026` + ligne live `→ ${resolvedId} · ${n}k context · tools ✓/✗` / "⚠ unknown model id (checked live against api.mistral.ai)"
  - subhead "Answer style" + aide "\"Default\" follows the CHAT answer style; the others override it for this agent's conversations." + chips "Default" / "Precise" / "Balanced" / "Creative"
- AG5b · [zone] · "Persona (System prompt)" · aide "Who this agent is and how it should answer. Leave empty for the standard chat behaviour." (placeholder = DEFAULT_SYSTEM)
- AG12 · [zone] · "Quick actions" (agent) : hérité → "This agent uses the CHAT quick actions. Customize to give it its own set (starts as a copy of the current ones)." + bouton "Customize for this agent" ; personnalisé → éditeur A14-A21 + "Reset to CHAT quick actions"
- AG13 · [zone] · "Context documents & cost" (MANIFESTE en lecture, alimenté depuis la Library) :
  - paragraphe "Build this agent's context from the Library: open a folder, note or pages and tap “+ Add to ▾ → ${icon} ${name}”. Folders and whole notes stay live (future pages included); specific pages are fixed." (guillemets courbes “ ”)
  - bouton "Go to Library ›"
  - subhead "In this agent's context"
  - vide : "Nothing yet — this agent has no stored context."
  - lignes : `📁 ${path}/  · live` / `📄 ${leaf} · whole${' · Off' si Off}` / `📄 ${leaf} · p. ${pages}${' · Off'}` — chacune avec bouton "Remove"
  - `+ ${n} page(s) pinned individually.`
- AG8 · [estimate, dans AG13] · `${docs} doc(s) · ${read} page(s) read${ (+${unread} not read yet — offered when you pick the agent) }\n~${n}k tokens of context${ → 1st message ~${a} cents · next ~${b} cents (cached −90%) | · price unknown for this model id}\n${⚠ Larger than a 128k model context — trim the documents.}\nLess context = cheaper: half the pages ≈ half the price.`
- AG9 · [button] · "Delete agent" / (armé, vidéo inversée) "Delete this agent? (conversations are kept)"
- AG14 · [menu, "+ Add preset ▾"] · PRESET_AGENTS — 4 presets ajoutables (agents ordinaires, éditables/supprimables) :
  - 📋 **Extractor** (mistral-small-latest, precise) — extraction fidèle ; quick actions "Summarize" / "Key points & actions" / "To table" / "Dates & deadlines"
  - ✍️ **Writer** (mistral-small-latest, balanced) — assistant d'écriture EN ; "Rewrite clearly" / "Warmer tone" / "Draft an email" / "Proofread"
  - 🎓 **Tutor** (mistral-small-latest, balanced) — tuteur ; "Explain simply" / "Grill me" / "Revision plan" / "Give an example"
  - 💡 **Brainstorm** (ministral-14b-2512, creative) — partenaire d'idéation ; "5 ideas" / "Another angle" / "What if…" / "Titles" / "What's missing?" / "Devil's advocate"
- AG1 · (RETIRÉ v0.59 — pas de sub-header d'agent dédié)
- AG2 · (remplacé par A27)
- AG10 · (RETIRÉ — pas d'état vide, la ligne CHAT default est toujours là)
- AG11 · (fusionné dans AG6 — l'answer style de l'agent vit dans la zone Model)
- AG7 · (fusionné dans AG13 — l'ancienne arborescence à cocher est remplacée par le manifeste « Add from Library »)

## D — Chrome partagé & messages de statut

### Shared chrome

- D1 · [button] · "Assistant" (bouton noir de chaque header — ferme config, ouvre le panneau)
- D2 · [button] · "✕" (header close — ferme la vue plugin)
- D3 · [button] · sub-header back : "←" (défaut) OU "‹ ${backLabel}" (back labellé, ex. "‹ Config" / "‹ Library" / "‹ Pages")

### Status messages (`setMsg`, ligne grise `msg`)

Key management :
- D4 · [status] · "Key imported from mistral-key.txt (now stored encrypted)." (migration unique)
- D5 · [status] · "Could not store the key."
- D6 · [status] · "Key saved (encrypted, device-local)."
- D7 · [status] · "Old key file deleted." / "Could not delete the old key file."
- D8 · [status] · "Key deleted from the device." / "Could not delete the key."

Privacy / clears :
- D10 · [status] · "All transcripts cleared."

Sync now (colonne MANUAL) :
- D11 · [status] · "Syncing…"
- D12 · [status] · `Synced: ${r.pagesRead} page(s) read.` / "Synced: 0 page(s) (nothing new)." / `Nothing to sync${r.reason ? ` (${r.reason})` : ''}.`
- D13 · [status] · `Sync failed: ${message}`

Force sync (colonne AUTO, NOUVEAU) :
- D28 · [status] · "Auto sync…" / `Auto sync: ${n} page(s) read.` / `${reason capitalisé}.` / "Auto sync: nothing new to read." / "Nothing to sync — all Auto pages are read." / `Auto sync failed: ${message}`

Finish vision (SYNC STATUS · Vision now) :
- D29 · [status] · "Vision on OCR-only pages — this can take a while…" / `Vision: ${d}/${t} page(s)…` / `Vision done for ${n} page(s)${; ${pending} still pending…}` / `${n} page(s) could not be read — tap again in a minute.` / "No OCR-only pages awaiting vision." / `Vision failed: ${message}` / "Add a Mistral API key first."

Check changes (colonne MANUAL) :
- D24 · [status] · `Checking Manual notes ${i}/${n}…` puis `Checking Manual PDFs ${i}/${n}…` (dans la colonne, à côté du bouton)

Keep-awake (v0.79.14) :
- D30 · [status] · "Keep-awake sync on — the screen stays on until the queue drains."

Library backup / restore / clear-off (déplacés en Library) :
- D31 · [status] · `Library backed up (${docs} doc(s)) to ${path}.` / "Library backup failed — could not write the file."
- D32 · [status] · `Library restored (${docs} doc(s) merged in).` / `Library restore failed: ${error}.`
- D33 · [status] · `Cleared the local transcript of ${n} Off note(s).` / "No Off note has a local transcript to clear."
- D34 · [status] · `Transcript cleared for this document.` / "Nothing to clear — no transcript stored." (🗑 Clear transcript de la grille)

Account walls (surfacés dans les statuts sync/vision, v0.78.7) :
- D35 · [status] · "⚠️ Mistral rejected the key (401). Free monthly limit reached, or the key is invalid/revoked — check it on console.mistral.ai, or switch to billing."
- D36 · [status] · "⚠️ The free Mistral API does not allow Batch (402). Use “Transcribe LIVE (free)”, or enable billing."
- D37 · [status] · "Rate limit (429) — the plugin is slowing down; give it a moment and retry."

Library page view :
- D26 · [status] · refus/échec Redo-AI : `⚠ ${reason}` (raisons de reading.ts — ex. N16 pour un fichier Off) ; Read with Vision (page, PageView) : "Reading this page with Vision…" puis "✓ Page read with Vision (schemas & annotations)." / `⚠ ${reason} — open the PDF in the reader if the render failed.`
- D38 · [status, PDF grid — Read all/N p. with Vision] · progression `Vision ${i + 1}/${pages.length}…` puis résultat `✓ Vision read: ${ok} page(s)${ · ${fail} failed (open the PDF in the reader if renders failed)}.`

Floating assistant :
- D21 · [status] · "opening floating assistant…"
- D22 · [status] · `Could not open panel: ${r ? `${r.code}, ${r.message}` : 'no result'}`
- D23 · [status] · `Open failed: ${message}`

Retirés v0.80 (mode batch) : D9 (consentement, déjà retiré v0.62), D14–D20, D25, D27.

## E — EXPORT (Library → /EXPORT)

- E1 · [menu] · grille (note entière) : "Export ▾" → "Export .md" / "Export .txt" (préfixe "✓ " sur succès)
- E2 · [button] · "☐ Select pages"
- E3 · [menu, sélection] · "Export ${n} p. ▾" → "Export .md" / "Export .txt" ; "Cancel"
- E4 · [menu, dossier] · "Export ▾" → "Export .md" / "Export .txt" (préfixe "✓ ")
- E5 · [button] · "Export all .md" / "Export all .txt" (row d'actions bibliothèque, préfixe "✓ ")
- E6 · [dialog] · titre : "⇪ Export ${label}" (label = carnet / "${dossier}/" / "library" / "${carnet} (N p.)")
- E7 · [dialog] · corps : "${n} page(s) not read yet (~${euros}€). " + "${n} PDF(s) not read yet (one cheap OCR call each). " + "Read them first, or export what the library has (gaps are marked)?"
- E8 · [dialog] · boutons : "Read then export" / "Export incomplete" / "Cancel"
- E9 · [hint] · sans clé : "Reading needs an API key (screen 1)."
- E10 · [status] · progression : "⇪ checking transcripts…" / "⇪ reading ${i}/${n}…" / "⇪ exporting ${name} (${d}/${t})…"
- E11 · [status] · résultat : "⇪ ${n} document(s) exported to /EXPORT (.${fmt})" + " · ${f} failed" + " · ${o} Off file(s) skipped"
- E12 · [status] · "Nothing to export." / "Nothing to export (${n} Off file(s) skipped)."
- E15 · [status] · `⚠ Export failed: ${message}`
- E16 · [status] · `⚠ Export check failed: ${message}`
- E13 · [file header] · `Exported by SmartNote AI at ${date} · ${read}/${total} pages · Transcript source: ${label(s)} at ${datetime}` (en .md préfixé '> ')
- E14 · [fichier .txt] · cadre : "${nom}" · "Exported by SmartNote AI · ${date} · ${x}/${y} pages" · "--- Page ${n} ---" · "(not read yet)" · "(blank page)"

## P — Fenêtre flottante — Chat

- P1 · [header, remplace le titre] · déclencheur de la « brain dropdown » : `${activeAgent.icon} ${activeAgent.name}` / "💬 Chat", suivi de " ▾"
- P2 · [header drag handle] · "⠿"
- P69 · [header] · lien "Lib" (ouvre la config sur la Library) · icône ⚙ (settings) · icône fenêtre + "▾" (snaps) · collapse · "✕" (close — pendant un envoi, ⏹ d'abord puis close)
- P70 · [brain dropdown, NOUVEAU v0.79.6] · ouverte depuis P1 :
  - haut : `${effectiveModel}` · (agent actif) `knows ${docs} doc(s) · ${read} page(s) read` · (si contexte) `${n} context page(s)` · boutons "＋ New chat" / "🕘 History"
  - lignes brain : `${'● '/'○ '}${icon} ${name} · ${model-court}${ · ${docs} docs · ${read} p si agent}`
  - usage : `last: ${inputTokens} in${ (${cachedTokens} cached −90%) si >0} · ${outputTokens} out`
- P4 · (fusionné dans P70 — plus de barre de statut dédiée ; le modèle et l'usage vivent dans la dropdown)
- P63 · [popover snaps] · icône fenêtre + "▾" ; popover = 6 icônes (default/top/bottom/left/right/full), aucun texte
- P8 · [ContextTray, v0.78 — remplace l'ancienne ligne « 📄 … ▾ »] · rangée de chips :
  - P71 · [label] · "Chat context:" (nomme la rangée)
  - P72 · [chip agent] · `${icon} ${docs} docs · ${read} p` (tap → brain dropdown)
  - P73 · [chip lasso] · `🖼 Lasso${ ${i+1} si plusieurs}` + "✕" (retirable, plusieurs autorisés)
  - P9 · [chip page] · `📄 ${cap === null ? 'no page' : ctxPageOff ? 'page removed' : `${fileName} · ${scope}`} ▾` — scope : `all ${totalPages} p` (Whole note) / `p.${a}–${b}/${totalPages}` (Range) / `p.${page+1}/${totalPages}` (This page)
  - P74 · [chip added] · `+${pendingCtx.length} pages ▾`
  - P75 · [chip add] · "＋" (ouvre la sheet contexte)
- P20 · [empty state] · "Ask about your page, or tap a quick action below."
- P21 · [assistant bubble, copy] · DEUX boutons : "Copy .md" / "Copy .txt" (chacun "✓" sur succès)
- P76 · [user bubble] · préfixe "🖼 " si le tour a porté une image lasso
- P22 · [busy indicator] · "…thinking"
- P23 · [progress line] · `${label} ${done}/${total}…` — labels : "reading (ocr)" (contexte), `reading ${noteName}` (gaps agent)
- P77 · [busy bar] · sous la conversation : `${progress ?? '…thinking'}` + bouton "⏹ Stop"
- P7 · [offline banner, AU-DESSUS de l'input] · "⚠ ${offline}" — valeurs : "Offline: stored transcript only" / "Offline: embedded text only" / un refus/échec de lecture (N10–N16) / etc.
- P59 · [button input] · "🔍" — arme la recherche locale (inversé = armé)
- P24 · [input placeholder] · "Search notes 🔍 · Ask AI" (repos) / "Search your notes…" (recherche armée)
- P78 · [button input] · champ vide → "Paste" (presse-papier natif ; APPEND) ; champ non vide → "✕" (efface)
- P55 · [button input] · one-shot Web search "Web" (armé = inversé ; grisé si le modèle ne supporte pas les tools ou pendant un envoi ; retombe seul à OFF)
- P56 · (RETIRÉ — le bouton one-shot « Calc » / Code interpreter n'est plus dans le panneau ; le texte de config A11 le mentionne encore)
- P25 · [stop button] · "⏹" (à la place du bouton d'envoi pendant un envoi)
- P26 · [send button] · icône Mistral "M" monochrome blanche (assets/ic-mistral-white.png)
- P79 · [quick actions inline, v0.77] · chips sous l'input (masqués en recherche) : `${a.label}` par action active ; la 1ʳᵉ (image quick action) est accentuée quand une image lasso est en contexte ; tap = préremplit le prompt (APPEND si le champ n'est pas vide)
- P27 · [assistant error bubble] · "⚠ ${failText}" — "Stopped." / la raison d'échec (ex. "Request timed out.")
- P28 · [web-search sources] · "Sources:" puis "• ${title}\n  ${url}"

### Sheet contexte (tap sur un chip)

- P60 · [title] · "Context — ${fileName}" / "Context" (pas de capture) · fermeture "✕" · tap dehors ferme
- P17 · [label] · "Send:"
- P18 · [chips] · "This page" / "Range" / "Whole note"
- P19 · [range] · séparateur "–" entre les deux champs de page
- P10 · [provenance chip] · "Transcript: ${chip.label}${ · ${chip.sub}}" (tap → ferme, ouvre la sheet Transcript)
- P11 · [labels single page] · "none" / "Mistral OCR+Vision" / "Mistral OCR" / "Manual"
- P12 · [label multi-page] · `${SRC_LABEL} ${n} · … · unread ${n}`
- P13 · [context state] · "↩ born on ${bornOn} · " + "this page removed" / "in context" / "• sent with next message" / ""
- P80 · [button] · "✕ Remove the current page from context" / "＋ Put the current page back in context"
- P61 · [added list] · "Added pages (${n}):" puis par ligne "${noteName} · p.${n}" + "✕" (retirable) / "in CHAT" (envoyée, non retirable) — la liste SCROLLE
- P81 · [button] · "＋ From Library" (ouvre la Library ; renvoie via chatCtxSeed)

### Sheet Transcript (tap sur la provenance chip)

- P29 · [title] · "Transcript · p.${page}/${totalPages} · ${fileName}" · "✕" · tap dehors ferme
- P31 · [source line] · "Source: ${voletEntry?.label ?? '…'}"
- P32 · [labels single page] · "Mistral OCR 4 + Vision · ${datetime}" / "Mistral OCR · ${datetime}" / "Manual (edited by you) · ${datetime}" / "no transcript yet"
- P33 · [label multi-page] · "whole note · ${read}/${total} pages read" / "range · ${read}/${total} pages read"
- P34 · [multi-page headers] · "[ p.${n} · ${SRC_LONG} · ${d/mm} ]" / "[ p.${n} · not read yet ]"
- P35 · [empty body] · "…" (chargement) / "(no transcript)" (fichier Off) / "(empty: this page has no transcript yet. Redo AI transcript to create one)"
- P36 · [edit buttons] · "Cancel" / "Save (manual, top rank)"
- P37 · [copy] · "Copy" / "✓ copied"
- P57 · [warning, fichier Off] · "⚠ No transcript available: sync is set to \"Off\" for this note. You can still ask the Chat about it."
- P38 · [edit button] · "Edit" (mode This page seulement)
- P39 · [redo button, This page] · "Redo AI transcript" / (busy) "⏹ Stop redo" / (armé sur entrée Manual) "Overwrite manual edit?"
- P58 · [rotate, This page] · "↻ Rotate right + redo" / "↺ Rotate left + redo"

### Sheet Historique

- P41 · [title] · "Conversations"
- P42 · [new button] · "＋ New"
- P43 · [close] · "✕"
- P44 · [empty] · "No saved conversations yet."
- P45 · [row title] · "(current) ${title}" / "▸ ${title}"
- P67 · [row prefix agent] · `${icon} ` (ou "∅ " si l'agent a été supprimé) devant le titre
- P46 · [row date] · `${fmtDay(updatedAt)}`
- P47 · [row delete] · "✕" / (armé, vidéo inversée) "Delete?"

### Dialogs

- P50 · [OFF-file text] · "\"${docName}\" is set to Off (excluded from the AI). Read it once to answer this question? It is sent to Mistral (EU) and the transcript is NOT saved."
- P51 · [OFF-file buttons] · "Cancel" / "Read once, don't save"
- P66 · [agent gaps text] · "${icon} ${name}: ${n} page(s) of its documents are not read yet.\nRead them now ≈ ${euros}€ — or chat with what is already in the library." · boutons "Cancel" / "Chat with what's read" / "Read now"
- P52 · [big-read text] · "Read ${count} pages?\nCost ≈ ${euros}€ · takes a few minutes."
- P53 · [big-read buttons] · "Cancel" / "Read"
- P54 · [saved-history redaction] · "(Off file: the page transcript was not saved.)"

Retirés depuis v0.79.x : P14 (« ⟳ Refresh capture » — la capture se rafraîchit toute seule via heartbeat), P62 (sheet « ⚡ Quick actions » — les quick actions sont inline), P64 (carte « START A CONVERSATION » — le brain dropdown remplace la sélection d'agent), P65 (ligne de statut agent — remplacée par P1), P68 (message batch PDF).

## S — Fenêtre flottante — Search (overlay de la recherche armée)

- S1 · [back, reading view] · "‹ Results"
- S2 · [reading view title] · "${name} · p.${page}"
- S3 · [go-to-page button] · "Go to page ›"
- S4 · [reading view body] · "…" / "(empty)"
- S5 · [hint repos (< 2 car.)] · "Search your notes — type at least 2 characters." + la ligne grammaire (G2) + "Each result: \"Transcript\" reads it here · \"Go to page ›\" opens the note underneath · \"Add to CHAT\" attaches the page to the conversation (free, pick as many as you want) · \"+ Agent ▾\" stores the page in an agent's permanent context."
- S6 · [no-results] · "No match." / "No match. ${zeroHint}"
- S7 · [result count] · "${n} result(s):"
- S13 · [truncation] · "⚠ Showing the first ${SEARCH_LIMIT} matches only — refine your query to see the rest." (= G4)
- S12 · [interpretation echo] · "→ ${interp}"
- S8 · [result row title] · "${name} · p.${page}" (snippet avec mots en gras)
- S9 · [buttons par résultat] · "Transcript" · "Go to page ›" · le bouton d'ajout (S10/S11) · "+ Agent ▾" (S14) · "+ Whole note ▾" (S15)
- S10 · [Add to CHAT] · "Add to CHAT" / "✓ added" (pas encore envoyée, MULTI) / "✓ in CHAT" (envoyée) ; fichier Off : badge "Off" grisé
- S11 · [Read & add — hit META non lu] · "Read & add" → armé "~${c} c€ — sure?" → "Reading…"
- S14 · [button, NOUVEAU] · "+ Agent ▾" (AddToPicker, sans « Chat ») — stocke la page dans le contexte permanent d'un agent (flash `✓ p.${n} → ${icon} ${name}` / "⚠ could not add (agent gone?)")
- S15 · [button, NOUVEAU] · "+ Whole note ▾" — ajoute TOUTE la note à CHAT (`✓ ${n} page(s) of ${note} → CHAT` / `✓ ${note} already in CHAT`) ou à un agent (ref live : `✓ ${note} (live) → ${icon} ${name}` / "⚠ could not add (agent gone?)") ; masqué pour un fichier Off

## G — Champ de recherche (grammaire)

- G1 · [SearchControls placeholder] · "🔍 Search every transcript…"
- G2 · [GRAMMAR_HINT] · "word · \"phrase\" · a|b · !not · f:folder · n:note · p:8 · approx:word · kw:tag · star: · type:note|pdf · src:manual|ai · after:2026-06 · sort:date"
- G3 · [interpretation echo] · "→ ${interpretation}" (parseSmartQuery — ex. "page = 8" / "≈ mot (fuzzy)")
- G4 · [truncation] · "⚠ Showing the first ${SEARCH_LIMIT} matches only — refine your query to see the rest." (SEARCH_LIMIT = 60)
- G5 · [clear button] · "✕"

## Q — Quick actions (labels + prompts)

Défauts CHAT (v0.76.1 — 3 actions génériques ; les spécialisées vivent dans les preset agents) :
- Q1 · [label] "Summarize" · [prompt] "Summarize the provided notes concisely."
- Q2 · [label] "Explain" · [prompt] "Explain the provided notes in simple, clear terms."
- Q3 · [label] "Translate" · [prompt] "Translate the provided content."

(MAX_QUICK_ACTIONS = 12 ; les défauts sont tous activés. Retirés des défauts CHAT : les anciens « Translate → EN », « Key points », « Grill me ».)

Image quick action (v0.81 — montrée seulement avec une image lasso, MAX_IMAGE_QUICK_ACTIONS = 3) :
- Q4 · [label] "About this selection" · [prompt] "Focus on the lassoed selection shown in the image. Use the rest of the context only as background. If it is a question, answer it (use web search for anything current); otherwise transcribe or explain it." (`SELECTION_QUICK_ACTION`, seul défaut de la liste image)

Directive lasso (v0.81, éditée en porte 2 — R32/R33) :
- Q6 · [`DEFAULT_LASSO_DIRECTIVE`] · "The user lassoed a region of their handwritten note and attached it as an image. Read it, then either carry out the instruction it contains, or treat it as the subject of the user’s question or request in the chat. It may be text, a table, a diagram or a sketch. Use web search for anything current (weather, news, prices, schedules). Never merely say you will do something and stop; do it now."

## M — Modèles (picker)

Affichage : label + note + desc (dans le picker de config door 3).

- M1 · [model] id "mistral-small-latest" · label "Small" · note "open weights · 0.13/0.53 €/M · default" · desc "Mistral Small 4\nOur powerful hybrid model unifying instruct, reasoning, and coding capabilities in a single model. 119B parameters with 6.5B active."
- M3 · [model] id "mistral-medium-latest" · label "Medium" · note "open weights (Modified MIT) · 1.31/6.56 €/M · priciest output" · desc "Mistral Medium 3.5\nOur frontier-class multimodal model optimized for agentic and coding use cases. Released as open weights under a Modified MIT license."
- M2 · [model] id "mistral-large-latest" · label "Large" · note "open weights · 0.44/1.31 €/M · top quality" · desc "Mistral Large 3\nMistral Large 3, is a state-of-the-art, open-weight, general-purpose multimodal model with a granular Mixture-of-Experts architecture. It features 41B active parameters and 675B total parameters."

## N — Messages moteur (progress / erreurs)

(Le mode batch est retiré — pretranscript.ts n'existe plus. N1-N7 supprimés.)

autoTranscript.ts :
- N8 · [auto-tick progress label] · "${noteName}" / label de vague "Checking notes"
- N9 · [auto-tick reason] · "read failed" (fallback) / "paused while you chat" / "a sync is already running" / raison HTTP sous-jacente (« Network error… », 401/429…)

reading.ts (ReadOutcome.reason surfacés) :
- N10 · [reason] · "Stopped." (⏹ / abort)
- N11 · [reason] · "render failed" (rendu de page)
- N12 · [reason] · "Vision returned nothing." (transcription vide)
- N13 · [reason] · "Cannot read the PDF."
- N14 · [reason] · "PDF read failed: ${message}"
- N15 · [note-read progress] · numérique — onProgress(done, total) ; le label visible "reading (ocr)" vient de ChatPanel (P23)
- N16 · [refusal] · "This file is set to Off. Switch it to Manual/Auto in the Library to read it." (`OFF_READ_REFUSED` — surfacé par P7 et le message Library D26)

ActivityBanner (bandeau d'activité, Library + panneau flottant) :
- N17 · [banner] · "⚙ ${label}${ ${done}/${total}}" + "✕ Stop" / (armé) "stopping…" — labels : "Checking notes" / "Rendering pages for Mistral" / "Checking Mistral jobs"

## User Guide embarqué (PDF)

Le PDF du guide (8 pages) est généré depuis `src/core/guide/guidePages.json` (liste de 8 objets `{title, …}`, 1ʳᵉ page « Welcome to SmartNote AI »). Installé/pré-transcrit dans la Library au premier lancement (`ensureUserGuide`), ré-ouvrable via H23. Contenu non transcrit ligne à ligne ici.

---

## v0.63 — cadre SYNCHRONISATION enrichi + filtres d'arbre (2026-07-19)

(Historique — plusieurs éléments ci-dessous ont depuis été REMPLACÉS par la refonte v0.69/v0.80, voir sections suivantes.)

- L60/L61/L62 (colonne AUTO batch) : REMPLACÉS par le format v0.69 (L54-L56).
- L63 « Show: Auto/Manual/Off » : conservé (L58).
- L64 « Expand: 1/2/3/all » : RETIRÉ v0.80.
- Export all .md/.txt : déplacés dans la row d'actions bibliothèque (L51).
- R60 « Full prompt » repliables : conservé (R20/R21).

## v0.64 — recherche p:/approx:, Paste/✕, lien Lib, header espacé (2026-07-20)

- Grammaire : `p:8` (page exacte) et `approx:mot` (flou) ajoutés au GRAMMAR_HINT (G2).
- Interprétation : "page = 8" / "≈ mot (fuzzy)".
- « Check all notes for changes » → « Check changes » (L48), + passe PDF (D24).
- Champ chat : "Paste" (vide) ↔ "✕" (non vide) (P78).
- Header panneau : lien "Lib" (P69) ; icônes espacées.

## v0.67 — bandeau d'activité + Stop (2026-07-20)

- Bandeau « ⚙ ${label} ${done}/${total} » + "✕ Stop" / "stopping…", auto-retiré (N17).
- Labels : "Checking notes" / "Rendering pages for Mistral" / "Checking Mistral jobs".

## v0.68–v0.69 — pipeline découplé + SYNC STATUS (2026-07-20)

- Cadre réorganisé ; colonne PIPELINE puis, en v0.69, AUTO/MANUAL pleine largeur + SYNC STATUS.
- (v0.80 : AUTO/MANUAL repassent en DEUX COLONNES côte à côte, et SYNC STATUS se réduit à 3 lignes — Queue / OCR done, vision to retry / Finished — le batch ayant disparu, les étapes serveur Mistral n'existent plus. Voir L9/L57.)

## v0.80 — audit UX : confirms vidéo inversée, scaling, batch retiré (2026-07-26)

- Tous les confirms armés passent en VIDÉO INVERSÉE (fond noir) : K7, K14, K25, L7, L51 (Restore/Clear-off), L63, AG9, P39, P47, S11.
- Le réglage Text/Button size s'applique PARTOUT (Home, READ, Library, door 3, panneau).
- MODE BATCH SUPPRIMÉ : plus de « Sync batch », « Check batch results », « Retry failed », filtres « Expand », messages D14-D20/D27, N1-N7 (pretranscript.ts supprimé).
- Library : AUTO & MANUAL côte à côte (L9), SYNC STATUS toujours visible à 3 lignes (L57), « ☀ Keep Supernote awake during Sync » (L53), row d'actions bibliothèque (L51), badges d'agent + « Clear transcripts of Off notes » (L59/L51), « 🗑 Clear transcript » dans la grille (L63).
- Panneau : erreurs au-dessus de l'input (P7), quick actions qui AJOUTENT au lieu de remplacer (P79), backs labellés (D3).
- Door 3 : « Your assistants · N/8 custom agents » (A29), « Add starter agents » en porte 1 (K28).

## v0.81 — lasso → mode transverse, BigTextInput (2026-07-27)

- Le lasso n'est plus un agent : l'image devient un chip PERSISTANT « 🖼 Lasso » (P73) sur n'importe quel chat/agent, retirable, plusieurs autorisés.
- Directive « Lasso — image reading » en porte 2 (R30-R33, `DEFAULT_LASSO_DIRECTIVE` Q6) — éditée via `BigTextInput` (Paste/Clear/Reset), vide = rien envoyé.
- Jusqu'à 3 « Lasso quick actions » en porte 3 (A31/A32), montrées seulement avec une image en contexte (défaut « About this selection », Q4).
- Brain dropdown : chaque ligne montre `icon · name · model · N docs · M p` (P70) ; les lignes portent le modèle effectif.

## v0.82 — annotations .mark + schémas via Vision (2026-07-27)

- Bouton PDF « 🔍 Read with Vision (schemas & annotations) » (L66) — lit les schémas manqués par l'OCR ET les annotations manuscrites (rendu composé avec l'encre .mark).
- Les pages ANNOTÉES (.mark) d'un PDF sont escaladées en Vision AUTOMATIQUEMENT à la lecture (union dédupliquée avec les pages « flagged »).

## v0.83 — porte 3 renommée, guide, consolidation (2026-07-28)

- Door 3 : sub-header « 3 · CHAT & AGENTS » (A1) ; porte H16 « 3 · CHAT & AGENTS: your assistants » (le « QUICK LASSO CHAT » a disparu).
- Home : « Two ways to use it » (H3), boîte grise « … » retirée (H10), porte Library « 📚 LIBRARY: browse, sync & fix your transcripts » (H15).
- Guide PDF embarqué : `src/core/guide/guidePages.json` (8 pages).

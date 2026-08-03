# SmartNote AI — tous les textes du plugin (v0.31.0)

> Document de relecture : chaque texte visible (ou envoyé au modèle) avec
> un identifiant. Annote directement ici ou donne-moi les IDs à corriger.
>
> **MàJ v0.25.6 (2026-07-14)** : tes comments intégrés — bouton "Open
> floating assistant" AU-DESSUS du disclaimer (H7), retour Library →
> hub principal, message parasite "opening floating assistant…" supprimé,
> texte guide H3/H3c revu (+SEARCH), aide clé Mistral (K2), "Clear ALL"
> aussi dans Privacy (K9), page READ réordonnée **PDF d'abord** puis
> .note, glossaire regroupé sous ".note only" (R8). Le bouton "Go to page"
> ajouté dans la recherche flottante (FS4). `Go to page ›` = intent
> ACTION_VIEW comme Dashboard. Diagnostic Auto ajouté (voir logs).
>
> **MàJ v0.25.1 (2026-07-14)** : LIBRARY sur sa propre page, SEARCH
> implémenté (accent-insensible) à la fois dans la config et dans la
> fenêtre flottante via un toggle **💬 Chat / 🔍 Search** (une seule
> fenêtre, deux outils — option A). Vue page révisée : transcript
> **encadré en haut**, aperçu de la page manuscrite **en dessous**
> (rendu à la volée, zéro stockage). Bouton Pre-transcript ajouté dans
> LIBRARY. Retour à la grille de pages : la tuile éditée se rafraîchit.
> Case `SEARCH` du schéma H3b passée en noir (dispo).
>
> **Rappel v0.24.9** : allègement complet des pages de config (une phrase
> par réglage), détails dans `docs/USER-MANUAL.md`. Auto au changement de
> page, reflow des transcripts en phrases.
> **v0.31.0** : chemin note Smart simplifié en OCR-4 nu (≈3.5€/1000, plus
> d'étage annotation) ; le glossaire ne s'applique plus qu'à l'escalade
> vision et à l'Eco (plus au OCR). Eco = ministral image + glossaire seul
> (hint Supernote local retiré).

## H · Config — accueil (hub)

- **H1** titre : `SmartNote AI`
- **H2** section : `User Guide`
- **H3** guide (COURT) ✅ :
  > Your Supernote in the age of AI, privacy first! The plugin is built on **READ**: your notes are transcribed into a local library, then several modules build on it (black = today, grey = coming):
- **H3b** schéma (boîtes) : `READ` (noir) │ `CHAT` (noir) `SEARCH` (noir) `EXPORT` `AI AGENTS` `…` (gris)
- **H3c** suite (COURT) ✅ :
  > **READ**: three engines, free Local OCR, cheap Eco, or best-quality Smart. Correct anything by hand.
  > **CHAT**: ask any Mistral model about a page, a range or the whole note.
  > **SEARCH**: powerful search into your local transcripts.
  >
  > **Privacy first**: open source plugin, AI from Mistral AI only (EU/GDPR, never trains on your data), your own encrypted key, transcripts local-only. Anyhow, do not share confidential information.
  >
  > Full guide: github.com/AgP42/SN-Plugin-SmartNoteAI
- **H4** ligne d'état : `✓ key loaded (sk-4••••x2)` / sans clé : `⚠ No API key yet: set it in "1 · API key, privacy & appearance"`
- **H6** portes (v0.31.1, 3 portes) : `1 · API key, privacy & appearance →` / `2 · LIBRARY: transcript & search your notes →` / `3 · CHAT: ask your notes & documents →` (l'ancienne porte READ a fusionné dans Library)
- **H7** bouton ✅ : `Open floating assistant` — déplacé **au-dessus** du disclaimer.
- **H8** Ko-fi + disclaimer (option C) :
  > SmartNote AI is a personal project built by a Supernote user, for Supernote users. It is not an official product of Supernote or Mistral AI, just a plugin that loves them both. I built it with love, time, skills and expensive tokens ;-) If you like it, please consider a small contribution:
  + `https://ko-fi.com/agp42` + QR code.

## K · Config — 1 · API key, privacy & appearance

- **K1** titre : `1 · API key, privacy & appearance`
- **K2** section : `Mistral API key` ✅ + aide : `Get one at console.mistral.ai → API Keys → Create (about 3 clicks). The free tier works for testing, but only a paid plan guarantees Mistral never uses your data to train its models.`
- **K3** avec clé : `Current key: sk-4••••x2, stored encrypted in the plugin's private storage (never synced).`
- **K4** sans clé : `No key stored yet. Paste your Mistral API key below.`
- **K5** placeholder : `paste a new Mistral API key…`
- **K6** bouton : `Save key (encrypted)`
- **K6b** bouton (si clé) : `Delete stored key` → `Really delete the stored key?` → `Key deleted from the device.`
- **K7** note migration : `The old key file (MyStyle/…/mistral-key.txt) still exists. MyStyle syncs to the Supernote cloud; once the key works here, delete it.`
- **K8** bouton : `Delete old key file`
- **K9** section : `Privacy` ✅ — ajout de `Clear ALL transcripts` (note : `Transcripts stay on this device only. This wipes every one of them for good (same as the Library button).`) ; 2 fois le clear all (Privacy + Library), voulu.
- **K10** texte : `SmartNote AI asks once, at first use, before sending note content to Mistral (EU). Resetting shows that dialog again.`
- **K11** bouton : `Reset cloud consent`
- **K12** section : `Appearance` — `Text size` (S/M/L/XL) · `Button size` (S/M/L/XL) · `Note toolbar side (snaps won't cover it)`
- **K14** messages : `Key saved (encrypted, device-local).` / `Could not store the key.` / `Old key file deleted.` / `Consent reset: the first-use dialog will show again.`

## R · "User manual & OCR config" collapsible (dans LIBRARY) — v0.32

Un seul moteur (Mistral OCR 4 + escalade Vision auto) : **les chips de moteur ont disparu**. Le collapsible ne garde que le manuel + le glossaire.

- **R2** manuel (COURT) : `One engine: Mistral OCR 4 reads every page, and pages it is unsure about (drawings, schemas, messy writing) are automatically re-read by Ministral Vision. Each page's provenance shows which was used: "Mistral OCR" or "Mistral OCR + Vision". A page is read the first time you ask about it (or in the background when set to Auto), stored in your library, and reused for free after. You can also pre-transcript whole folders in batch (billed half-price). Cost ≈3.5€/1000 pages. Set a folder or note to Off below to exclude it. PDFs read their printed text with correct multi-column order; handwritten annotations on a PDF are not captured yet.`
- **R8** section : `Glossary (optional)`
- **R9** guidance : `Extra vocabulary to help the handwriting reading: your languages, the names, acronyms and jargon you write. Aim for 2000 characters or less.`
- **R9b** suggestions : `Suggest words from my library` → `The OCR often hesitates on these (tap to add):` / `Frequent names in your notes (tap to add):` / vide : `No suggestions yet: they build up as Mistral reads your pages.`
- **R11** compteur glossaire : `123 / 10000`
- **R12–R14** test : `Test on the current page` / `Reading current page…` / `Satisfied? Keep stores it as the page's transcript (it is paid for); Discard keeps nothing.` (`Keep this transcript` / `Discard`) / erreur `No captured .note page: tap the plugin button from a note.`
- **Re-read (vue page)** : un seul bouton `Re-read · Smart · ~3.5€/1000` (busy : `⟳ Re-reading…`) ; la ligne `Re-read with:` a disparu (v0.35).

## L2 · Library — chip Mode + encart Auto + dialog OFF (v0.32)

- **Chip Mode** par dossier/fichier : `Off` / `Manual` / `Auto` (cycle Off→Manual→Auto). Hérité d'un dossier : `↳ Auto` (grisé). Défaut (non réglé) : `Manual`.
- **Encart `SYNCHRONISATION`** (v0.32.3) — 2 lignes : `Auto` : `watching N (+N manual) · last sync hh:mm · N pending` (ou `· up to date`). `Manual` : 2 boutons avec le prix/timing DANS le bouton → `⟳ Sync now · full price` / `⧉ Sync batch · −50%, come back later`.
- Le collapsible « User manual & OCR config » est **tout en haut de la page**, au-dessus de `Search`. Le chip Mode hérité (`↳ Auto`) est **cliquable** (override manuel).
- **Retiré (v0.32.3)** : le seed du texte OCR local à la capture (une page non lue n'affiche plus rien : `no transcript yet`) et le warning `weak transcript (Local OCR): Improve & re-ask` (obsolète en Smart-only).
- **Dialog OFF (CHAT)** : `"{file}" is set to Off (excluded from the AI). Read it once to answer this question? It is sent to Mistral (EU) and the transcript is NOT saved.` — `Cancel` / `Read once, don't save`

✅ Le message parasite `opening floating assistant…` qui restait en bas des pages est supprimé (nettoyé dès l'ouverture de la bulle). Le bouton reste sur le hub (déplacé au-dessus du disclaimer, H7).

## L · Library (page dédiée, à séparer de READ — 2026-07-14)

- **L15** titre/section : `Your library: 87 pages · 5 documents · 340 KB`
- **L16** texte (COURT) : `Transcripts stay on this device (never synced). Use the buttons below to delete them for good.`
- **L17** vide : `Library is empty. Ask about a page, or run Pre-transcript.`
- **L18** lignes : `▾ Note/Perso/  [Auto] [Clear folder]` · par doc : `Pelican.note  12/43 p  [Auto] [Browse] [Clear]` · `(deleted)` si le fichier n'existe plus · confirmations : `Clear folder?` / `Clear?`
- **L18c** note Auto (COURT) : `Auto: tracked notes are transcribed in the background as you turn pages, while the plugin runs.`
- **L19** bouton : `⚡ Pre-transcript folders (batch, −50 %) →` · note : `−50 %: batched jobs are billed by Mistral AI at half the normal per-page reading price.`
- **L21** bouton : `Clear ALL transcripts` / `Really clear ALL transcripts?`
- **L22** browse (pages) : `38 transcribed / 43 page(s). Tap one to view, edit or re-read its transcript.` — tuiles ; non lues : `not read yet` en pointillés. Au retour depuis une page éditée/re-lue, la tuile se rafraîchit (🆕 v0.25.1).
- **L23** vue page (ordre 🆕 v0.25.1) : `Source: Mistral OCR · 11/07/2026`, puis le **transcript encadré**, puis `Edit` / `Re-read`, puis `Original handwritten page:` + l'aperçu manuscrit dessous · édition : `Cancel` / `Save (manual, top rank)` · vide : `(empty)` / `no transcript yet`
- **L23b** correction au TAP : légende `Underlined bold = words the OCR was unsure about (7). TAP one to fix just that word, use Edit for the whole page, or add the recurring ones to the glossary.` · mini-éditeur `Correcting "975":` + champ + `Replace` / `Cancel`
- **L23c** ✅ (implémenté v0.25) : image de la page manuscrite rendue à la volée sous le transcript (`Original handwritten page:`), pour corriger en regardant l'original. Aucun stockage : rendu à l'ouverture, jamais gardé en librairie.

## SE · SEARCH (Library + fenêtre) ✅ base v0.25, avancé v0.25.9

Composant partagé `SearchControls` (config Library ET fenêtre flottante).
- **SE0** (v0.37.1) : le toggle `Base`/`Advanced` a DISPARU — un seul champ smart. Sous le champ, ligne d'aide permanente : `word · "phrase" · a|b · !not · f:folder · n:note · kw:tag · star: · type:note|pdf · src:manual|ai · after:2026-06 · sort:date`.
- **SE1** Base = **recherche SMART (v0.37)** : placeholder `🔍 words · "phrase" · !not · f: n: kw: star: type:`. Grammaire (termes séparés par espace OU `+`, tous en ET ; guillemets pour protéger espaces/`+`) :
  - `mot` (contient tous les mots), `"phrase exacte"`, `a|b|c` (au moins un), `!mot` / `!"phrase"` (exclusion) ;
  - `f:`/`folder:` (dossier), `n:`/`note:` (carnet), `type:note|pdf` (origine), `star:` / `star:no` (étoile ★), `kw:xxx` (keyword Supernote), `src:manual|ai`, `after:2026-06` / `before:2026-07-15` (date de lecture), `sort:date|note|relevance`.
  - Préfixe inconnu = traité comme un mot (visible dans l'écho). Sous le champ, une **ligne d'interprétation** `→ all of: … · folder ~ … · ★ starred` montre comment la requête a été comprise.
  - `star:`/`kw:` remontent AUSSI les pages **non transcrites** (extrait `★ keyword — (not read yet)`), sauf si un critère textuel est présent.
  - Un bouton `✕` en bout de champ efface le texte (v0.36.3). Résultats `carnet · p.N` + extrait avec **termes surlignés** (gras). Tap = ouvre/va à la page.
- **SE1b** (v0.36.3) au-delà de 60 résultats : `⚠ Showing the first 60 matches only — refine your query to see the rest.`
- **SE2** Advanced : jusqu'à **10 critères** (`+ Add criterion (n/10)`), tous en ET sur la MÊME page. Chaque ligne = une **puce type** (tap pour cycler) + un champ :
  - `has all` (tous les mots), `phrase` (phrase exacte), `has any` (au moins un = OU), `excludes` (aucun de ces mots),
  - `notebook` (nom du carnet contient…), `folder` (dossier contient…), `source` (puces `Manual` / `AI` — la puce `Device` a disparu avec la source locale, v0.35).
  - `✕` pour retirer une ligne.
- **SE3** Tri : `Sort:` `Relevance` / `Date` / `Notebook`.
- **SE4** vide/aucun résultat : hint d'aide / `No match.` / sinon `N result(s):`

## A · Config — 3 · CHAT

- **A1** titre : `3 · CHAT: ask your notes & documents`
- **A2** section : `Chat model` — champ libre + 5 chips : `Small` (défaut) / `Large 3` / `Medium` / `Magistral S` / `Magistral M`
- **A2b** intro (COURT) : `Any Mistral model works in the field above. The presets are the ones that can use the Tools below. Default is Small: open, cheap and on par with the big ones in our tests.`
- **A3** notes par modèle : `default · open (Apache 2.0) · tools · 0.13/0.53 €/M` / `open · tools · top quality · 0.44/1.31 €/M` / `proprietary · tools · 1.31/6.56 €/M (priciest output)` / `reasoning · open · tools · slower · 0.44/1.31 €/M` / `reasoning · proprietary · tools · 1.75/4.38 €/M` / `custom model id`
- **A4** résolution latest : `"mistral-small-latest" currently points to mistral-small-2603.`
- **A5** section : `Chat persona (optional)` · texte (COURT) : `Shapes how the assistant answers. Leave empty for the default.`
- **A7** section : `Tools` · texte (COURT) : `The model uses them on its own when useful; web answers cite their sources.` (+ si modèle sans tools : ` Pick Small, Large, Medium or Magistral to use them.`)
- **A9** toggles : `Web search (~0.01€ per search)` / `Code interpreter (≈free)` — grisés si le modèle ne supporte pas les tools
- **A10** section : `Quick actions (5/12)` · `Toggle which appear in the panel (ON/off), reorder with ↑ ↓.`
- **A11** placeholders : `Button label` / `Prompt sent to the AI…` — `+ Add action`

## P · Config — Pre-transcript

- **P1** titre : `Pre-transcript your Supernote`
- **P2** intro (COURT) : `Mass-read whole folders at half price (batch). The tablet uploads, Mistral processes on its own, you collect the results later. Pages already read are never paid twice.`
- **P3** sections : `Folders` / `Estimate` / `Batch jobs`
- **P4** scan : `Scanning notebooks…` — `☐ Perso/   812 p · 12 note(s)`
- **P5** estimation (€) : `Selection: 812 page(s) · 187 already in the library` / `To read: 625 page(s), cost ≈ 0.16€ (batch −50 %) · upload ≈ 37 min` / `⚠ Stay on wifi during upload; processing then runs at Mistral without the tablet.`
- **P6** boutons : `GO` → `Confirm: read 625 pages for ≈0.16€?` → `Running… (tap Stop below)` + `■ Stop`
- **P7** jobs : `No jobs yet.` / `2 processing · 1 done · 0 failed.` — `Check results` / `Rescan`
- **P8** messages : `3 batch job(s) created, 118 page(s) submitted. You can turn the tablet off; come back later and tap "Check results".`

## F · Fenêtre flottante (panneau)

- **F0** toggle 🆕 v0.25.1 (sous le header, sur les deux vues) : `💬 Chat` / `🔍 Search` (segmenté, la vue active en noir). Une seule fenêtre, deux outils. Le header (drag / snaps / collapse / ✕) reste commun.
- **F1** titre : `SmartNote AI`
- **F2** ligne clé : `sk-4••••x2 · mistral-small-latest` / `No key: open ⚙ Settings`
- **F3** usage : `last: 2412 in (2200 cached −90%) · 156 out`
- **F4** hors-ligne : `⚠ Offline: Supernote transcript only` / `⚠ Offline: embedded text only`
- **F5** capture : `Pelican.note · p.33/43` / `No page captured.`
- **F6** chip : `Transcript: Mistral OCR · 11/07` (valeurs : `Local OCR` / `Eco` / `Mistral OCR` / `Mistral OCR+Vision` / `Manual` / `none` ; agrégat : `Mistral OCR 38 · unread 5`)
- **F7** contexte : `in context` / `sent with next message` / `↩ born on Pelican · `
- **F8** boutons : `⟳ Refresh` / `New chat` / `🕘`
- **F9** sélecteur : `Ask about:` `This page` / `Range` / `Whole note`
- **F10** vide : `Ask about your page, or tap a quick action above.` — `…thinking`
- **F11** progression : `reading (ocr) 3/12…` / `reading (eco) 3/12…` / `reading (Supernote) …`
- **F12** escalade : `⚠ weak transcript (Local OCR): Improve & re-ask (≈1€/1000 pages)`
- **F13** input : `Ask about your page…` — `➤` / `⏹`
- **F14** réponse : `Copy` / `✓ copied` — erreurs : `⚠ Stopped.` / `⚠ Request timed out.` / `⚠ Network error: …` / `⚠ HTTP 401: API key rejected. Check your Mistral key.`
- **F15** sources : bloc `Sources:` + `• Titre` + URL

## FS · Fenêtre flottante — vue SEARCH (🆕 v0.25.1)

- **FS1** builder : le même `SearchControls` (Base/Advanced, cf. SE) en haut de la vue.
- **FS2** avant recherche : hint `Base: type words… Advanced: add up to 10 criteria (phrase, has-any, excludes, notebook/folder/source). Tap a result to read it; edits stay in the config page.` · sinon `No match.` ou `N result(s):`
- **FS3** résultats : lignes `carnet · p.N` + extrait (3 lignes max) **avec surlignage**. Tap = lecture pleine page.
- **FS4** lecture d'un résultat : `‹ Results` (retour) + `carnet · p.N` + `Go to page ›` (ouvre la page exacte dans le carnet, ou le PDF dans le Document viewer, via intent ACTION_VIEW comme le plugin Dashboard) + transcript complet en lecture seule (l'édition reste dans la page de config).

## S · Volet Transcript (panneau)

- **S1** titre : `Transcript · p.33/43 · Pelican.note`
- **S2** source : `Source: Mistral OCR · 11/07` (noms longs : Mistral OCR+Vision (escalation) / Mistral OCR / Eco (Ministral + glossary) / Mistral OCR+Vision (improve pass) / Manual (edited by you) / Local OCR (on-device)) / `Local OCR (not stored)` / `no transcript yet`
- **S2b** multi : `range · 5/12 pages read` / `whole note · 8/8 pages read` — en-tête `[ p.3 · Mistral OCR · 12/07 ]` / `[ p.4 · not read yet ]`
- **S3** vide : `(empty: this page has no transcript yet. Re-read to create one)`
- **S4** boutons : `Copy` / `Edit` / `Re-read` / `Improve (≈1€/1000 p)` / garde : `Overwrite manual edit?`
- **S5** édition : `Cancel` / `Save (manual, top rank)`

## HS · Historique / D · Dialogues / M · Prompts / Q · Quick actions

(inchangés vs v0.24.3 sauf coûts en €/1000 ; voir git si besoin. M3/M4/M5 = consignes de transcription avec REFLOW ; M1/M2 = système chat + plain-text.)
- **D1** consentement : `SmartNote AI sends your questions and the selected pages' content (text, and page images when reading) to Mistral (EU). Nothing is stored on their servers. OK?` — `Cancel` / `OK, don't ask again`
- **D2** estimation (€) : `Read 128 pages? Cost ≈ 0.45€ · takes a few minutes.` — `Cancel` / `Read`
- **Q1-Q5** : `Summarize` / `Translate → EN` / `Key points` / `Explain` / `Grill me` (inchangés)

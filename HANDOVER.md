# SmartNote AI — Handover

> Session hand-over snapshot. Read this first, then `SPEC.md` for the original
> plan and the git log for detail. Last updated at **v0.88.0 (code 278)** —
> les entrées v0.80→v0.86.5 manquent ici : voir le git log (le HANDOVER
> n'avait pas suivi ; reprise au v0.87).

## v0.88.0 (2026-07-30) — audit 4-axes appliqué en 5 lots (GO user « enchaîne tout »)
Audit par 4 subagents (sync/argent, chat/contexte, écrans config, natif/stockage),
findings re-vérifiés, puis TOUT corrigé d'une traite + textes + manuels :
- **Lot 1 ARGENT** : importLibrary sanitize+markDocTouched (l'index committé
  référençait des shards jamais écrits → bibliothèque restaurée évaporée au
  restart) ; flushStore après le stamp OCR d'un PDF (kill dans la fenêtre =
  re-facturation du /v1/ocr entier) ; pagesNeedingRead en échec ne stampe plus ;
  remapDocPages REFUSE une liste d'ids trouée (parse partiel ≠ deletion) ;
  revisionMarksOnly ne stampe qu'à 0 échec ; renderAborted propagé par
  resumePdfVision.
- **Lot 2 TIMERS** : sleepImpl core injectable + sleepHybrid natif (résolu par
  le heartbeat quand RN gèle les timers) installé au boot — retry sleep, pacing
  429, watchdog 60 s, flush 600 ms, yields ; verrou `running` périmable 10 min
  (repris par les pokes) ; foregroundBusy = refcount + expiry 5 min.
- **Lot 3 CONFIG** : updateSettingsWith (patch calculé DANS la file d'écriture) ;
  les 3 écrivains de `agents` migrés (ChatAgentsScreen = transforms par
  opération + subscribeSettings ; withAgents ; restoreDefaultAgents) ; les
  boutons Sync attendent un tick en cours et REJOUENT (markManualSync après
  exécution réelle) ; reset READ armé ; flushSettings avant goToNotePage /
  Save key / Import / AppState background ; quickActions vides = volontaires
  (plus de résurrection des défauts) ; agentsView rafraîchi à la ré-entrée.
- **Lot 4 NATIF** : override invalidate() (fenêtre fantôme + heartbeat zombie) ;
  ALREADY_OPEN re-bind le heartbeat au contexte courant ; self-stop après 5
  emit ratés ; restores syncLabel (2ᵉ bulle KEEP_SCREEN_ON) et layoutParams
  (NOT_OPEN après removeView raté) ; conn.disconnect() en finally ; store
  MEMORY-ONLY si plugin-dir introuvable (règle M2, plus de /sdcard) ; janitor
  couvre sp-mark-*.png et *.tmp-write.
- **Lot 5 POLISH** : PageEntry.va (rev de la dernière Vision ratée — plus de
  re-facturation cross-session des pages que Vision n'améliore pas) ; passe
  light garde le report page-courante ; cap 1 lecture/60 s de la MÊME page
  courante ; « Rendering via: … » affiché dans SYNC STATUS ; tuiles « (blank
  page) » ; useModelInfo refetch au changement de clé ; plus AUCUN scratch
  sur /sdcard ; shard NOT_FOUND = ref droppée (vs erreur IO = retry).
- **Textes** : balayage tirets cadratins des chaînes visibles (règle v0.23
  re-appliquée, 34 chaînes), UI-TEXTS.md delta v0.88.
- **Manuels** : README + docs/USER-MANUAL.md (sections batch/roadmap périmées
  remplacées par la sync auto-adaptative) ; guide embarqué pages 3/4/8/10 mis
  à jour (PDF = OCR+Vision, Sync now = ordre permanent, host sondé), PDF
  régénéré (tools/make_guide_pdf.py), GUIDE_REV 8→9.
Restant assumé : QaEditor keys par index (ids stables non faits), base64
strict (ripple), fsync avant rename, exécuteur partagé walkNote/post.

## v0.87.0→0.87.3 (2026-07-30) — convergence sync (host par étape, drain Vision, pokes fiables)
Règles user actées : (1) jamais de page OCR4-only dont la Vision n'est pas
passée ; (2) déclenchements automatiques partout où possible (Auto + Manuel
déjà déclenché) ; (3) AUCUNE promotion 'medium' sans vraie lecture Ministral
(Vision vide ⇒ reste 'mistral-ocr', éteinte par le cap 3/session).
- **0.87.0** : split host PAR ÉTAPE — OCR PDF (`/v1/ocr` sur les octets) sous
  tout host via `readPdf {skipVision}` (mark-only différé SANS stamp) ; notes
  = host note pour les 2 jambes ; host inconnu = zéro rendu. Drain Vision auto
  dans le tick (`finishVisionLive` borné budget, tous modes sauf Off, cap
  `visionFails` 3/session). `renderFailed` dans ReadOutcome (échecs de rendu
  gratuits hors `pageFails`). `manualSyncWanted` persisté : « Sync now » =
  ordre permanent payé par les ticks background jusqu'à dette nulle (règle le
  stall >100 p du drain-continue, qui repartait en freeOnly).
- **0.87.1** : pokes `view:*` passent `includeCurrent` — sous la Library la
  note ne peut pas recevoir d'encre, le report « page courante » ne se
  libérait jamais (repro device : « deferring current page p.20 » en boucle).
- **0.87.2** : disjoncteur `CONSEC_RENDER_BREAK=3` (readNotePages +
  visionPassPdf, `renderAborted` propagé dans finishVisionLive) + pre-check
  host sur les boutons « Vision now » (une passe sans host avait tenté 3742
  rendus condamnés, logcat noyé ~10 min). DÉCIDÉ : le backlog Vision legacy
  ~3742 p PDF (ère « PDF = OCR seul ») SERA drainé sous host PDF.
- **0.87.3** : pokes fiables (repro logs 21:25) — (a) un poke explicite
  (force/includeCurrent) tombant sur un tick en cours est REJOUÉ à la fin du
  tick (avant : jeté, le fix 0.87.1 était court-circuité) ; (b) debounce gelé
  (RN fige les timers JS quand la vue plugin est backgroundée — 5ᵉ occurrence
  du pattern) : un poke suivant flushe inline le debounce périmé
  (`POKE_STALE_MS`) ; (c) listener AppState 'active' dans App.tsx → poke
  `includeCurrent` à CHAQUE retour au premier plan (l'effet `[screen]` ratait
  les ré-entrées, la vue restant montée sur 'library').
395 tests. Fichiers cœur : `src/native/autoTranscript.ts`,
`src/native/reading.ts`, `App.tsx`, `screens/library/LibraryScreen.tsx`.

## v0.79.1 (2026-07-22) — §4 : drain Auto continu (caps de ticks supprimés)
Suite du batch. Les 3 raisons des caps étaient tombées (UI native + governor
429 + budget console). Retiré `MAX_PAGES_PER_SESSION` + `sessionPaidPages` + le
message trompeur « session cap reached » + les gardes PDF/note associées.
GARDÉ `MAX_PAGES_PER_TICK=100` comme SIMPLE borne de rendement (Stop réactif,
yield JS, edits vus entre chunks), MAIS ajouté **drain-continue** : à la fin
d'un tick, si `postponed>0 && pagesRead>0 && !stop`, `pokeAuto('drain-continue',
{force})` relance tout de suite → le backlog draine EN CONTINU au lieu d'un
chunk par battement de 15 min. S'arrête seul si backlog vide / reads échouent
(pagesRead=0, ex. 401 quota) / Stop / pas de clé. tsc clean, 366/366.
Aussi: retiré un dernier texte batch user-facing raté (`ReadConfigScreen`
« pre-transcript whole folders in batch, half-price »).
Reste (mineur): re-sync complet du catalogue `UI-TEXTS.md` (lag ~v0.69).

## v0.79.0 (2026-07-22) — SUPPRESSION DU MODE BATCH (gros refacto)
Décision user: le batch (−50%) créait ~2000 lignes de plomberie, pas de
confidence-scores (unsure-words absents des pages batch), et TOUS les problèmes
free-tier (mur 402). Budget géré via console Mistral → plus besoin côté plugin.
Voir `BATCH-REMOVAL-PLAN.md`. Fait en 3 commits (2be0ce0, 6499847, 107d82e):
- **SUPPRIMÉS**: `pretranscript.ts` (1555), `batchIo.ts`, `batchFileNative.ts`,
  `core/model/batch.ts` + leurs tests (~2000 l.).
- **Partagés extraits**: `listDirNative`/`listStorageVolumesNative` → `fs.ts` ;
  shields in-flight → SUPPRIMÉS (morts sans batch, seul le submit batch les
  écrivait) + gardes correspondantes retirées de `reading.ts`.
- **Débranché**: `autoTranscript` (plus de `maybeCollectBatch`/collect, gardes
  batch-pending), `gatherContext`, `ChatPanel` (3 gardes), `LibraryScreen`
  (boutons Sync batch/Check results/Cancel jobs + ptJobs/ptCheck retirés →
  UN bouton **« Vision now »** live + **« Sync now »** seul en Manual).
- **Pipeline**: 5 étapes → 3 (`queue`/`ocrDone`/`finished`), `classifyPipeline`
  sans jobs, SYNC STATUS UI simplifié.
- **Guide** purgé de toute mention batch (pages 1/2/4/8).
- tsc clean, **366/366 tests** (37 suites). CONSERVÉ: le pipeline de lecture
  OCR 4 → Vision (`readOne`), glossaire, rotation, unsure-words, `rateGovernor`.
- **§4 NON FAIT (GO séparé demandé)**: virer les caps de ticks
  (`MAX_PAGES_PER_TICK/SESSION`, `sessionPaidPages`) — les 3 raisons sont
  tombées (UI native + governor 429 + budget console). Message « session cap
  reached » encore trompeur en attendant.

## v0.78.8 (2026-07-22) — fix cyclage mode dossier (OFF inatteignable)
BUG (user): impossible de mettre un dossier hérité en OFF — le chip cyclait
`↳ Manual → Auto → ↳ Manual → …`, OFF jamais atteint. Cause: `cycleModeFor`
(LibraryScreen) avait un cas spécial "au dernier mode (auto), lâche l'override
→ inherit" qui interceptait exactement le passage auto→off. Rustine v0.63.3.
FIX (simple/robuste, demande user "pas de patchs partout"): remplacé toute la
logique par UNE liste ordonnée parcourue à chaque tap — hérité:
`['inherit','off','manual','auto']`, racine: `['off','manual','auto']`,
`next = cycle[(indexOf(cur)+1)%len]`. Tous les états atteignables, zéro cas
spécial. Imports morts retirés (cycleMode, MODE_CYCLE, effectiveMode). tsc clean.

## v0.78.7 (2026-07-22) — raisons HTTP explicites (401/402/429)
APPRIS: le tier gratuit a un QUOTA MENSUEL ≈2350 pages → au-delà, TOUT le
compte renvoie 401 (mail Mistral "limites gratuites du mois"), même une clé
neuve; seul un NOUVEAU compte redonne 200. 401≠clé cassée = compte/quota.
Distinct de 429 (débit/min, univ. tous tiers — ministral-14b-2512 = 0,5 req/s
= 30/min, c'est LE goulot vision; OCR /v1/ocr = 625 p/min) et 402 (batch payant).
- **Trou comblé**: le chemin LIVE ne loguait que "N pages failed to read" sans
  code HTTP → 401 et 429 indistinguables. Maintenant `r.reason` (de
  mistralRequest) remonte: `autoTranscript` log inclut la raison, le tick
  retourne `reason` (1ʳᵉ raison d'échec).
- **UI (`LibraryScreen`)** `accountWallMsg(reason)`: 401→"Mistral a rejeté la
  clé (401), quota mensuel gratuit atteint / clé invalide — vérifie
  console.mistral.ai ou passe payant"; 402→"l'API gratuite n'accepte pas le
  Batch, utilise Transcribe LIVE"; 429→"rate limit, ça ralentit, réessaie".
  Câblé dans finishVisionLiveNow, finishVisionNow (402 explicite armé) et
  syncAutoNow (Sync now dit enfin POURQUOI 0 page).
- tsc clean, 37/37 (autoTranscript+reading). Pas de nouveau test dédié (chemins
  UI/log). RÈGLE conservée: pas de sélecteur free/paid, adaptatif ([[smartnoteai-freetier-batch-429]]).

## v0.78.6 (2026-07-22) — throttle adaptatif 429 (rateGovernor)

## v0.78.6 (2026-07-22) — throttle adaptatif 429 (rateGovernor)
CONTEXTE (logs device): gros sync-burst en gratuit → tout se prend des 429 →
notes entières "failed to read → will retry" → re-burst → thrash, la file de
1733 pages (étage 1, jamais OCR'd) ne draine pas. Le 429 n'était PAS retryable
(< 500) → échec sec. Pas de sélecteur free/paid (refus user, à raison): un SEUL
chemin adaptatif qui s'auto-détecte, marche pour les 2 clés.
- **`src/core/model/rateGovernor.ts`** (pur, testé): pacing GLOBAL. Off (0
  surcoût) tant que RAS; au 1ᵉʳ 429 → espace tous les appels (BASE 2,5 s ≈
  24/min), double à chaque 429 (cap 30 s); 8 appels propres d'affilée → pace/2,
  puis 0 = plein régime. Leaky-bucket (`nextSlot`) → espace même les appels
  concurrents. Reset au restart (rien persisté).
- **`http.ts` `mistralRequest`**: `rateAcquire()` avant chaque envoi,
  `rateReport(status)` après; 429 devient **retryable** (le retry repart après
  le back-off au lieu de faire échouer la page). errorReason(429) explicite +
  log `[SmartNoteAI.rate] 429 … throttling to ~X/min`. Couvre OCR (/v1/ocr),
  vision+chat (/v1/chat/completions), createBatchJob — tout passe par là.
- Tests: `rateGovernor.test.ts` (5) — no-op tant que pas de 429, pacing +
  espacement concurrent, double capé, decay→0, 402/500 neutres. 119/119 OK.
- NON FAIT (refusé/à décider par user): fallback batch→live AUTO (reste MANUEL
  via le bouton armé v0.78.5, décision user), masquage prix, sélecteur.

## v0.78.5 (2026-07-22) — fallback vision LIVE + détection mur batch 402

## v0.78.5 (2026-07-22) — fallback vision LIVE + détection mur batch 402
FAIT MARQUANT (logs device 2026-07-22): la biblio actuelle (2473 p.) vient
ENTIÈREMENT de la clé GRATUITE → le tier gratuit SAIT faire de la vision, mais
UNIQUEMENT en LIVE (chat+image, Auto/Sync now). L'API **Batch** (`POST
/v1/batch/jobs`) est un **droit payant** → 402 "enable billing" (prouvé sur mes
clés de test; chat/models/upload = 200). Les pages `mistral-ocr` en attente de
vague vision BATCH stallent; elles drainent lentement quand l'Auto les RELIT en
live (compteur 94→43 observé = travail de l'Auto, pas du batch).
- **`isBatchBlocked()` (timestamp + TTL 60 min)** dans `pretranscript.ts`: posé
  sur un 402 à la création de job batch, effacé sur toute soumission réussie.
  TTL = se re-sonde tout seul si la facturation est réactivée (un flag booléen
  serait resté bloqué à vie). `drainVisionQueue` fait un early-out (aucun
  render) quand bloqué → fini le gaspillage (rendait 94 p. à chaque passe).
- **`finishVisionLive()` (`reading.ts`)**: relit LIVE (force:true) toutes les
  pages `mistral-ocr` → OCR4+Vision → stockées 'medium' → sortent de la file.
  Gratuit, c'est le chemin qui a fait les 2473.
- **UI `LibraryScreen`**: "Run vision now" force un re-essai batch; sur 402 il
  ARME (15 s) un 2ᵉ tap "▶▶ Transcribe LIVE (free)" → `finishVisionLive`.
  Message trompeur "No OCR-only pages" corrigé (respecte pendingPages).
- Tests: 4 nouveaux dans `pretranscript.test.ts` (402 pose le mur, collecte de
  fond skippe le render, manuel re-sonde, submission efface le mur). 25/25 OK.
- À CONFIRMER: le comportement batch de la VRAIE clé plugin (réinstaller pour
  voir le log "wave 2 JOB create failed … 402" ou au contraire des submits).

## v0.78.4 (2026-07-22) — fix cadre table + diagnostic batch 402
- **Table Markdown** (`MarkdownView.tsx`): le `ScrollView horizontal` imbriqué
  ballonnait — son `contentContainer` (flexDirection:row) étirait la `<View>`
  table sur toute la hauteur parent, `onLayout` mesurait donc une hauteur
  énorme et l'épinglait → cadre géant vide sous une table de 3 lignes + boutons
  Copy flottants. Fix: `alignSelf:'flex-start'` sur `styles.table` → `onLayout`
  mesure la hauteur RÉELLE. (Suite de v0.78.3 qui avait déjà tué le hard-freeze.)
- **Diagnostic vision batch** (`pretranscript.ts` `submitVisionWave`): les
  `return null` sur échec upload / createBatchJob étaient SILENCIEUX. Maintenant
  `console.warn` avec la raison HTTP. C'est là que le **402 free-tier** ("You do
  not have access to this service. Enable billing") devient visible — testé en
  direct: le tier gratuit fait chat+OCR-live+upload (200) mais PAS
  `POST /v1/batch/jobs` (402). Les pages `mistral-ocr` restaient coincées sans
  explication. FIX UX (option 3, à venir): détecter 402 → stop retry + message,
  ET fallback vision LIVE (gratuit) pour vider la file.

## v0.75.2 (2026-07-21) — Markdown activé + boutons copie/insert

- **PLAIN_TEXT_RULE SUPPRIMÉ** (`compose.ts`) : c'était le "system prompt caché"
  (« no Markdown, no tables ») collé à chaque envoi → forçait le texte brut, tous
  modèles, et contredisait la transcription. Le chat répond désormais en Markdown
  (rendu par `MarkdownView`, tables incluses).
- **Persona vide = system vide** (`ChatPanel.send`) : `DEFAULT_SYSTEM` n'est PLUS
  substitué en douce quand la persona est vide (décision user : « pas de texte que
  je ne contrôle pas »). Reste exporté (placeholder config + test). Le Reader garde
  sa persona (jamais vide via `resolveReaderAgent`).
- **READER_PERSONA** : ajoute une consigne « répondre en Markdown ».
- **3 boutons par réponse** (`ChatPanel`) : **Copy .md** (markdown brut), **Copy .txt**
  (`mdToPlain` — aplatit titres/gras/listes/**tables en colonnes ·**), **Insert to note**
  (copie .txt + collapse le panneau).
- **⚠️ LIMITE SDK** : « Insert to note » NE fait PAS add-textbox+paste automatique —
  le natif n'expose que `copyToClipboard` (25 méthodes listées, aucune insertion ;
  `pushElementsToClipboard` = « planned for next SDK version » dans le .kt). Donc
  Insert = copie texte brut + range le panneau ; l'user colle à la main (long-press).
- tsc ✓ · eslint 0 err · 394/394 tests.

## v0.75.1 (2026-07-21) — correctifs audit v0.75.0

## v0.75.1 (2026-07-21) — correctifs audit v0.75.0

- **#4 (critique)** : les ajouts depuis la Library étaient écrits sur disque mais
  invisibles en config → App.`agents` jamais rafraîchi. Fix : `ChatAgentsScreen`
  relit `settings.agents` au mount (+ `LibraryScreen` garde `agentsView` local
  rafraîchi après chaque add/remove).
- **#2** : « Original page » plafonné à 49 % (ne gonfle plus quand « live OCR » masqué).
- **#3** : defaults du Quick lasso chat écrits DANS le champ (`value = stocké || DEFAULT`,
  éditable ; vide = défaut).
- **#1** : picker « + Add to ▾ » ajouté aux résultats de recherche **Library**.
- **#8** : ligne « **Context: …** » (relabel) ; feuille de contexte = bouton **retirer/
  remettre la page courante** (`ctxPageOff` → `includeContext`), liste « Added pages ».
- **#5** : `toggleExpand` ne relance le lister natif que si non caché (re-expand instantané).
- **#6** : filtres « Show » **multi-select** (`modeShow: Set`).
- **#7** : un **chip par agent** dans « Show » → filtre l'arbre au contexte de l'agent +
  bouton **✕ Remove** par ligne (dossier/note/pages directs). `removeFromAgent` dans
  `contextActions`. tsc ✓ · eslint 0 err · 394/394 tests.
- **À TESTER DEVICE** : #4 (contexte visible en config), #8 (Context: + retrait page),
  #7 (filtre agent + remove), #5 (réactivité expand). **§5 cache image toujours pas fait**
  (D2 : vérif device en attente).

## v0.75.0 (2026-07-21) — Batch config + contexte (sujets 1→10)

## v0.75.0 (2026-07-21) — Batch config + contexte (sujets 1→10)

Spec = artifact context-system (voir mémoire config-refactor-batch). Décisions
user : symétrique partout (un « Add to ▾ » CHAT|agent), Add-to-CHAT depuis la
library via seed, cache image à vérifier device.

- **1. Re-layout config** (`ChatAgentsScreen`) : zone unique **« Model »** (model +
  tools + answer style fusionnés) placée AVANT **« Persona (System prompt) »**, puis
  Quick actions. CHAT (default) ET agents.
- **2. « Read selection » → « Quick lasso chat »** + son propre **Model** (model +
  answer style) : nouveaux champs `settings.readerModel` / `readerAnswerStyle`,
  `resolveReaderAgent(persona,prompt,model,style)`.
- **3. Titre** : « 3 · CHAT, AGENTS and Quick lasso chat: your assistants → ».
- **4. Add pages → CHAT/Agent depuis la Library** : note-overview (whole doc +
  sélection de pages) et page-view (page unique) ont un « + Add to ▾ ». Agent gagne
  le **page-scope** `agent.docPages: {path:number[]}` (statique ; `resolveAgentDocPages`
  dédup vs whole-note ; compose dans ChatPanel.send). Remove dans le manifest (§10).
- **5. Vue originale** : PARTIEL — cadre « live OCR » masqué quand vide ; **cache image
  NON fait** (D2 : vérifier device si le rendu réussit en sync background avant de
  figer le cache — `generateNotePng`/`generateDocImage` exigent l'app hôte au 1er plan).
- **6. `p:first` / `p:last`** dans la recherche (`smartQuery` + `librarySearch`).
- **7. « + Agent ▾ » à côté de chaque « Add to CHAT »** dans la recherche flottante
  (`SearchOverlay`, résultat + détail transcript).
- **8. Library rows** : Export .md/.txt fusionnés en **« Export ▾ »** (dossier +
  note-overview) + **« Add ▾ »** par ligne (dossier → live ref / note → whole).
- **9. Tranché** : symétrique ; CHAT depuis library = handoff `chatCtxSeed` (copie
  `lassoSeed`) consommé par ChatPanel → `pendingCtx` (mount + subscribe).
- **10. Config agent = manifest** : arbre `docsBody` SUPPRIMÉ → liste read-only
  (dossiers/notes/pages) + Remove + « Go to Library ». Cost estimate conservé.
- Nouveaux : `src/native/chatCtxSeed.ts`, `src/native/contextActions.ts`,
  `src/ui/AddToPicker.tsx` (+ `InlineMenu`). E-ink = pas de couleur, marqueurs
  💬 / icônes agent. tsc ✓ · eslint 0 err · **394/394 tests** (+8) · bundle vérifié.
- **À VÉRIFIER DEVICE** : les nouveaux flows d'ajout (library→chat handoff, page-scope
  agent, pickers), + décider du cache image (§5, D2).

## v0.74.3 (2026-07-21) — Reader : bloc de config dédié (Stage 2)

## v0.74.3 (2026-07-21) — Reader : bloc de config dédié (Stage 2)

- **Le Reader ("Read selection") a désormais sa PROPRE entrée** dans « 3 · CHAT &
  AGENTS », juste sous CHAT (default), éditée comme un agent : zone **Persona** +
  zone **Prompt**. Nom/icône fixes ; pas de zones docs/model/style (il ne lit que
  l'image du lasso). Vide = les défauts livrés (le prompt qui marche sans « ? »).
- **Persistance** : nouveau champ `settings.readerPersona` (persona ; ≤2000 c,
  sanitizé), le **prompt réutilise `lassoPrompt`** (déjà câblé index.js + seed).
  Owner = App (save debounced, comme lassoPrompt) — pas de 2e writer.
- **Résolution** : `resolveReaderAgent(persona?, prompt?)` dans `agents.ts` fusionne
  les overrides sur `READER_AGENT` (vide → `READER_PERSONA`/`READER_QUICK_PROMPT`).
  ChatPanel : send re-résout sur settings FRAÎCHES (billing) ; `activeAgent` +
  bouton quick-action utilisent une copie montée `readerAgent` (miroir des edits).
- L'ancienne zone « lasso » sous CHAT (default) a été **déplacée** dans l'entrée
  Reader (plus de doublon). Test unitaire `resolveReaderAgent` (défauts + overrides).
- tsc ✓ · eslint 0 err · 386/386 tests · bundle vérifié (readerPersona,
  resolveReaderAgent, header, 0 fuite FR) · md5 local==device.

## v0.74.2 (2026-07-21) — Reader prompt fix + anglais only

- **Prompt Reader (#4, device)** : sans « ? » le modèle croyait que ce n'était pas
  une question → transcrivait (météo cassée). `READER_QUICK_PROMPT` +
  `READER_PERSONA` réécrits : traitent la sélection comme une INSTRUCTION à
  exécuter (impératifs compris), transcription = fallback. Web reste manuel
  (arme 🌐). `modelLacksTools('mistral-medium-latest')`=false → tools OK, ce
  n'était PAS ça. cf [[smartnoteai-lasso-prompt]].
- **Anglais only** : `READER_AGENT.name` 'Read selection', quick action 'Read &
  answer', `SELECTION_QUICK_ACTION` 'About this selection', gate button + hints +
  champ config en anglais (l'user a exigé EN only).
- **Log diag 2e-lasso (#5)** : `apply()` log `seed applied to chat (turns=…)` —
  la capture réussit à chaque lasso (logs), reste à confirmer si l'image
  s'affiche dans une conv en cours.

**RESTE (prochain, PROMIS) :** bloc config DÉDIÉ « Read selection » (entrée
éditable dans la liste d'agents, persona + prompt), fondation = un helper
`resolveReaderAgent` + champ `settings.readerAgent` (4 fichiers : settings/App/
ChatPanel/ChatAgentsScreen) — non bâclé en fin de marathon.

## v0.74.1 (2026-07-21) — flux fenêtre, Stage 2 : gate compact + Lecteur éditable

- **Gate compact (2b)** : le start card n'est plus une liste verticale mais une
  LIGNE de 3 boutons — `💬 Chat · 🧩 Agent ▾ · 🔍 Lire la sélection`. « Agent ▾ »
  (état `agentMenuOpen`) déplie un sous-menu des agents user ; le bouton reflète
  l'agent choisi (`selectedUserAgent`). Lecteur grisé sans `pendingImage`, « Agent »
  grisé si aucun agent. Ligne d'indice sous la rangée (`gateHint`). Styles
  `gateRow/gateBtn/gateBtn(On|Text|TextOn)/agentMenu/gateHint`.
- **Prompt Lecteur éditable (2a)** : le champ config « Lasso → chat prompt »
  (ChatAgentsScreen zone `lasso`, alimente `settings.lassoPrompt` → pré-remplissage
  index.js) est reclarifié « 🔍 "Lire la sélection" prompt » (défaut = hybride).
  C'est le levier éditable de la quick action du Lecteur.
- tsc/eslint clean, 384 tests.

**Reste (Stage 2+, optionnel) :** Lecteur comme ENTRÉE éditable dans la liste
d'agents de la config (persona éditable — nécessite un champ settings réservé +
merge partout + chirurgie ChatAgentsScreen ; le prompt est déjà éditable via le
champ ci-dessus). Option « Chat agrège la page entière + lasso ».

## v0.74.0 (2026-07-21) — flux fenêtre flottante, Stage 1 : le Lecteur

Refonte validée (artifacts flow-spec v1/v2, spec-first). Modèle : chaque message =
un CERVEAU (Chat / Agent / **Lecteur**) × un CONTEXTE. Le lasso n'est pas un 3ᵉ
cerveau mais une source de contexte (image) + une quick action.

**Stage 1 (LIVRÉ) :**
- 🔍 **Lecteur** = agent RÉSERVÉ (`READER_AGENT` + `READER_AGENT_ID='__reader__'`
  dans `agents.ts`), PAS stocké dans `settings.agents` (ne compte pas dans
  MAX_AGENTS, ne pollue pas save/sanitize) — résolu partout où un agent est
  cherché (send `agent`, `activeAgent`). Persona Q&A-first (pas scribe), docs [] →
  **image seule**. Quick action = `READER_QUICK_PROMPT` (prompt hybride testé).
- **Start card** affiché TOUJOURS : `💬 Chat · 🔍 Lire la sélection · [agents]` ;
  Lecteur grisé (`agentBtnOff`) tant que `pendingImage === null`.
- **Lasso polymorphe** : seed sur conv fraîche (`turnsLenRef===0`) → `setAgentId(
  READER_AGENT_ID)` ; conv en cours → garde le cerveau courant, image versée +
  `SELECTION_QUICK_ACTION` (« À propos de cette sélection ») en tête des quick
  actions (non-Lecteur + image présente).
- `index.js` : défaut prompt lasso = `READER_QUICK_PROMPT` (fini « Transcript and
  answer » qui bloquait web_search — cf [[smartnoteai-lasso-prompt]]).
- tsc/eslint clean, 384 tests.

**Stage 2 (À FAIRE) :** Lecteur ÉDITABLE dans la config (persona/quick action —
overrides sous l'id réservé) ; polish UI = ligne compacte 3 boutons + dropdown
Agent ; option "Chat agrège la page entière + lasso" (débattu, coûteux). Web reste
manuel (spec Q5).

## v0.73.6 (2026-07-21) — lasso→chat sur fenêtre déjà ouverte : FIX

**Bug (device 2026-07-21) :** un lasso « Ask SmartNote AI » ne faisait RIEN quand le
chat flottant était déjà ouvert ; il ne marchait que lorsque le lasso *montait* la
fenêtre (1er lasso sans fenêtre, ou après fermeture). Confirmé « chat complet
ouvert → rien ne bouge ; ouverture manuelle + lasso → rien » non plus.

**Cause (vérifiée dans le natif) :** `SmartNoteAiOverlayModule.open()` faisait
`removeOverlay()` + recréait le panneau à CHAQUE ouverture. La graine lasso
(`lassoSeed`, one-shot) était consommée par l'abonnement du panneau vivant, puis
le re-montage repartait de zéro et ne retrouvait rien → image jamais attachée.
Explique aussi les « pas de contexte » (envoi depuis un panneau sans image).
NB : le format image du chemin Web/Conversations a été TESTÉ (clé, probe) et
marche — ce n'était PAS le bug (hypothèse écartée avant tout patch).

**Fix :** (1) `open()` devient **idempotent** — `overlayView != null` → on garde la
fenêtre (résout `ALREADY_OPEN`), plus de teardown/recréation ; bonus : ne
réinitialise plus une fenêtre déplacée/redimensionnée. (2) `Bubble.tsx` s'abonne à
la graine et déplie (`setMode('normal')`) le sous-cas fenêtre-repliée-en-bulle.
JS clean (tsc/eslint/384 tests). Banc 2× (même session) : verdict garder
`times:1` (tokens image identiques 1×/2× = 2809 ; Mistral downscale, gain nul).

## v0.69.0 (2026-07-20) — SYNCHRONISATION horizontal + SYNC STATUS 5 étapes, POUSSÉE MANTA

Refonte UI (schéma user validé sur artefact). Cadre réorganisé en LIGNES
pleine largeur : AUTO / MANUAL / SYNC STATUS (fini les 3 colonnes v0.68).

**Partition stricte des 5 étapes** (`src/core/store/pipeline.ts`,
`classifyPipeline`, PUR + testé) : chaque page tracked dans UNE seule
case → somme = tracked, Finished ≤ tracked TOUJOURS. Priorité : job OCR/
vision en cours > store source > Queue. RÉSOUT le risque user « page
rééditée comptée 2× » : une page éditée & re-soumise compte en
OCR-on-going (job), pas en double. Le classificateur tourne async
(`pipelineFromStore`, lecture store en mémoire, PAS de lecture footer —
le stale d'une édition depuis le dernier check n'est pas vu, Check
changes le rafraîchit ; assumé dans l'artefact).
Étapes : 1 Queue · 2 OCR4 on-going (Mistral) · 3 OCR4 done vision-to-do
(Supernote) · 4 Vision on-going (Mistral) · 5 Finished.

SYNC STATUS affiché seulement si travail pipeline actif (ocr/vision
on-going, vision-to-do, sync en cours). Barre de progression + details
dépliable + actions [Run vision · N][Check results][Cancel jobs].
Stamp `getLastManualSyncAt`/`markManualSync` (autoTranscript) pour le
"MANUAL last sync at". DocSummary a déjà ocrOnly/visionDone (v0.68).

**DÉVIATION à confirmer** : SYNC STATUS "tracked" = TOUS modes
(Auto+Manual), pas Manual-only comme le 5244 du schéma. Choix honnête
(les pages Auto à vision ratée sont dans le pipeline aussi). Bascule
triviale en Manual-only si le user préfère.

388 tests (10 neufs : classifyPipeline partition/re-flow/PDF), tsc/eslint
0. JS pur (pas de Kotlin). Push md5 OK, 0.68.0 purgée. Clé API à révoquer.

## v0.68.0 (2026-07-20) — PIPELINE DÉCOUPLÉ + colonne PIPELINE + Finish vision, POUSSÉE MANTA

Le « 1016 pages at Mistral OCR qui ne bougent pas » était un MENSONGE de
couplage : un job note-ocr restait pending tant que sa vague vision
n'était pas soumise → son OCR (fini, stocké) comptait encore « at
Mistral OCR », et tout se bloquait document ouvert.

**Découplage (GO user « corrige TOUT » + « tente doc ouvert »)** :
- Un job note-ocr bascule DONE dès l'OCR stocké. La vision est une file
  DÉRIVÉE du store durable : une page dont `source==='mistral-ocr'` (avec
  texte) n'a pas encore vu la vision. Signal dans le store persisté (pas
  un job/mémoire) → **résiste à une coupure batterie ET à un fichier de
  jobs perdu** (question resume du user). `drainVisionQueue` après la
  boucle collect, page par page (une page différée ne bloque plus les
  autres), exclut les pages déjà en job vision + les notes Off (privacy).
- Vision-blanche-qui-garde-l'OCR PROMEUT désormais la page en 'medium'
  (avant : restait 'mistral-ocr' → re-drain infini).
- `finishVision()` = bouton « Finish vision (N) » (force le drain now).
- Doc ouvert ne bloque plus (rendu natif v0.67) : drain + maybeCollectBatch
  tournent en naviguant ; seule une lecture PAYANTE en cours ou la page
  exactement affichée diffère (par page).
- Drain adaptatif : WAVE2_PAGES_PER_PASS 50→150, gap 350→150 ms (rendu
  natif off-thread ⇒ gros lot rapide, ~22 s, banner+Stop couvrent).

**Colonne PIPELINE** (3ᵉ du cadre SYNCHRONISATION) : OCR @ Mistral (jobs)
/ → Vision local (store) / Vision @ Mistral (jobs) / Up to date (store) +
Check & upload last-time. DocSummary gagne `ocrOnly`/`visionDone`.

**RÈGLE À RETENIR** : « OCR done, vision pending » = `source ===
'mistral-ocr'` avec texte, dans le store persisté. C'est LE signal
durable — ne jamais le recoupler à un état de job.

378 tests (11 neufs/màj), tsc/eslint 0. Invariants money-safety
préservés (pas de double-pay, vision jamais perdue, expiry 48 h borne).
Push md5 OK, 0.67.0 purgée. Clé API user TOUJOURS à révoquer.

## v0.67.0 (2026-07-20) — LA VRAIE CORRECTION (« marre d'empiler des patches »), POUSSÉE MANTA

Diagnostic logs 18:10 : frames de 918 ms + « didn't get starting
ACTION_DOWN » ×5 = taps AVALÉS par des re-renders pendant la tempête
post-réinstallation (walks JS 2-7 s/note × 104 + base64 par page).
Réponse structurelle, pas de pansement :
1. **Kotlin `walkNote(path)`** : TOUT le walk .note (footer, blocs
   pages — PAGEID/FIVESTAR/ORIENTATION/RECOGNTEXT base64→JSON —,
   KEYWORDs avec le slice UTF-8) porté 1:1 depuis l'oracle JS, thread
   natif, UN aller-retour de pont. JS parse via `snapshotFromWalkJson`
   (pur, testé) ; fallbacks ranges/full-fetch conservés.
2. **Kotlin `postJsonWithFile`** : le jumeau LIVE du pipeline batch —
   placeholder __FILE_B64__ rempli nativement au POST ; injecté comme
   FetchFn (`nativeFileFetch`) dans les couches modèle INCHANGÉES
   (retries/messages/parsing identiques). Le PNG scratch est supprimé
   après la page (l'adaptateur ne supprime jamais : retry-safe).
   Chemin legacy base64 conservé (tests) ; PDF entier inchangé.
3. **Bandeau d'activité** (demande user) : `activity.ts` + banner
   Library ET panneau — label + n/N + ✕ Stop, SE RETIRE SEUL à la fin.
   Producteurs : tick Auto (par note), vague 2 (par page, Stop = defer
   comme l'abort live-read), collecte (par job). Flag Stop meurt avec
   l'activité. Aucun timer (gel overlay-only).
4. **Grâce démarrage 60 s** : tick/collecte automatiques attendent
   après un (re)boot du process ; les boutons user passent (opts.force).
   Hook `__setBootAtForTests`.
373 tests verts (7 neufs), tsc/eslint 0. classes14.dex vérifié
(walkNote + postJsonWithFile), push md5 OK, 0.66.0 purgée.
ATTENDU sur device : plus de walks JS dans les logs (« (native, X ms) »
au lieu de « (ranges, 7166 ms) »), taps fiables pendant les jobs.

## v0.66.0 (2026-07-20) — MÉNAGE + PERF (GO « corrige TOUT »), POUSSÉE MANTA

Deux audits agents (code mort / perf), constats majeurs recoupés sur
pièces, puis tout corrigé sur GO user (« pas besoin de maintenir une
vieille legacy »).

**Ménage (−338 lignes, zéro changement de comportement)** : morts purs
(improvePage+IMPROVE_COST_CENTS, scanNoteTree+FolderInfo,
countPagesNeeded, estimateCents, clearAllConversations,
getSessionPaidPages, getPinnedCount, per1000, Kotlin
redraw/redrawOnUiThread, 5 styles) ; restes consentement (champ
globalConsent PARTOUT — store, sanitize, round-trip index.json) ;
schemaV (écrit jamais lu) ; migration personaOcr pré-v0.38 ; doublons
consolidés (makeWriteQueue partagé, sleep exporté de http.ts,
DEFAULT_CHAT_MAX_TOKENS unique dans types.ts, shouldEscalate) ;
exports test-only retirés avec leurs tests (agentPinsPath, storeStats).
GARDÉ exprès : fallback JS du batch (filet runtime, épinglé tests).

**Perf — les 4 mécanismes du jank tués** :
1. ChatPanel : throttle leading-edge 1,5 s des DEUX subscriptions
   (store + settings), trailing flushé par le heartbeat NATIF (pas de
   setTimeout : timers gelés overlay-only) ; MarkdownView React.memo ;
   l'interval 2,5 s se tait quand les beats natifs arrivent.
2. Recherche : cache WeakMap du texte désaccentué par entrée (remplacées
   jamais mutées), critères précompilés hors boucle, debounce 150 ms
   côté Library config UNIQUEMENT (overlay reste 0 — timers gelés).
3. Arbre Library : statusOf en Map, « ⟳ reading… » sorti de l'arbre
   (progress dans le cadre SYNC + bouton Stop), sweep sur libCountSig
   (plus de restart par identité lib), flush par 25.
4. Cadre SYNCHRONISATION : agrégation (~40k startsWith) en useMemo.

**IO natif UTF-8** : Kotlin readFileUtf8/writeFileUtf8 (tmp+rename
atomique, classes14.dex vérifié) ; writeTextAtomic() essaie natif puis
fallback base64 (les 4 mocks fs des tests routent vers leur
mockWriteFileBase64 — assertions inchangées). Tous les
shards/index/settings/jobs/conversations passent par là ; démarrage
sans boucle de décodage JS par caractère.

**Différé volontairement (effort L, version dédiée)** : render→POST
natif du chemin LIVE, walk .note par lots, FlatList. readSettings
garde sa deep copy (appelants mutent le retour).

369→366 tests (3 morts avec leurs helpers), tsc/eslint 0 erreur.
Push vérifié md5, 0.65.2 purgée.

## v0.65.2 (2026-07-20) — FENCES ``` : le vrai coupable de la p.3, POUSSÉE MANTA

La p.3 de `Supernote plugin dev.note` restait en rendu BRUT après la
0.65.1 (et après un Redo AI : autre texte, même symptôme). Vrai
mécanisme, REPRODUIT hors device : Mistral enveloppe parfois toute sa
réponse dans ```markdown …```; le reflow collait la fence fermante au
dernier mot → fence jamais refermée → le parseur (contrat « unclosed →
rest is code ») avale TOUTE la page en un bloc de code brut.
Trois couches (GO user) :
- `stripWrappingFence` (reader.ts) : wrapper taggé markdown/md toujours
  retiré ; wrapper nu seulement si l'intérieur n'a pas d'autre fence ET
  ressemble à du markdown (une page qui EST un bloc de code garde ses
  fences).
- `reflowTranscript` fence-aware : le code entre fences passe VERBATIM
  (lignes vides comprises), seule la prose est refluée ; fence non
  fermée → reste verbatim, aligné sur le parseur.
- `parseMarkdown` self-heal : page stockée qui parse en UN bloc code
  via fence non fermée + signature de dégât claire (tag markdown/md en
  tête, ou ``` collé après du texte en fin) → re-parse wrapper retiré.
  Les pages déjà mutilées s'affichent bien SANS relecture payée.
Restreint exprès : un ``` nu non fermé avec de la prose reste du code
(vraie page de code tronquée possible). + reliquat consentement :
import mutateStore mort retiré (KeyAppScreen, dernière erreur eslint).
7 tests neufs (369 verts). Push vérifié md5, 0.65.1 purgée.

## v0.65.1 (2026-07-20) — hr markdown + zero-hint recherche, POUSSÉE MANTA

Deux fixes GO'd (JS pur, pas de Kotlin) :
- **« --- une phrase »** (rapport user, ex. `Supernote plugin dev.note`
  p.3) : Mistral sépare des sections par une règle horizontale `---` ;
  `reflowTranscript` (reader.ts) COLLAIT la phrase suivante sur la
  ligne `---` au moment du STORE. Triple fix : (1) reader.ts `HR_LINE`
  — une ligne hr n'absorbe jamais la suivante ; (2) markdown.ts bloc
  `{k:'hr'}` + `RE_HR_GLUED` (RATTRAPAGE : un « --- phrase » déjà
  stocké se parse hr + paragraphe, pas de relecture payée) ; (3)
  MarkdownView rend hr en filet fin. Test corpus pinne h/p/hr/ul/ol/
  quote/code/table. SI la p.3 s'affiche encore mal après install :
  Export .md de la note → lire le brut via adb dans Document/EXPORT/
  (suspect suivant : titres setext `Titre\n===`, non supportés).
- **Zero-hint recherche** (« f:refl → 0 résultats » sur dossier jamais
  synchronisé) : moteur VÉRIFIÉ correct (désaccentué partout) ; le
  dossier n'avait juste aucune page transcrite. Une recherche active
  sans hit affiche maintenant l'explication (panel + Library) : search
  ne couvre que les pages DÉJÀ lues par l'IA.

362 tests verts, tsc/eslint 0 erreur. Push vérifié md5 (le 1er push
avait échoué « Is a directory » — device débranché ; re-push OK après
reboot user). 0.65.0 purgée device+local.

**OUVERT — bug geste système (2 doigts barre gauche + lasso plante
jusqu'au restart)** : plausiblement NOUS, 2 mécanismes candidats —
(1) fenêtre overlay fantôme (chemins d'échec removeOverlay laissant
une fenêtre demi-vivante qui intercepte les touchers) ; (2) moteur de
reco stressé par nos rendus. Protocole à la prochaine occurrence,
AVANT restart : `adb shell dumpsys window windows | grep -iE
"smartnote|pluginhost"` (fenêtre présente panneau fermé = fantôme =
notre bug) puis `adb shell am force-stop` du PluginHost (si le geste
guérit sans reboot = coupable dans PluginHost). User a rebooté ce
coup-ci sans capturer — en attente de la prochaine occurrence.

## v0.65.0 (2026-07-20) — LE PIPELINE NATIF (GO user), POUSSÉE MANTA

Le chantier anti-lenteur définitif : PLUS AUCUN octet d'image/JSONL ne
traverse le thread JS. Les rendus restent pilotés SDK (API du host),
mais tout le lourd autour est natif :
- Kotlin `appendBatchLine(file, template, dataPath, deleteAfter)` : lit
  le PNG (ou le PDF entier), l'encode base64, substitue le placeholder
  __FILE_B64__ dans un gabarit ~1 Ko (les builders de lignes EXISTANTS
  appelés avec le placeholder comme argument b64), APPEND la ligne
  JSONL, supprime le scratch. Avant, par vague côté JS : N×1 MB de b64
  + join ~20 MB + utf8ToBase64 ~27 MB (boucle JS !) + 27 MB en argument
  de pont. Après : N gabarits d'1 Ko + N chemins.
- capturePagePng / renderDocPagePng (rendu → chemin, sans lecture) ;
  uploadBatchFilePath (upload du fichier bâti nativement, delete en
  finally) ; uploadBatchFile conservé en wrapper legacy.
- Les 3 flux de submit (vague-1 notes, vague-2 vision, PDF entier)
  utilisent le builder natif si présent, sinon FALLBACK legacy JS
  intégral — exactement ce que les tests unitaires épinglent (seam
  mocké indisponible) : zéro churn de tests, 355 verts.
- Le submit PDF ne lit plus le document entier en JS pour son check
  docHash (stat de taille d'abord, comme readPdf v0.63.2).
CAVEAT documenté : la substitution suppose __FILE_B64__ unique dans le
gabarit (un hint contenant le littéral corromprait UNE ligne —
improbabilité extrême, pire cas une ligne de batch ratée).
Kotlin recompilé ; marqueurs bundle (__FILE_B64__, batchFileAvailable)
et dex (appendBatchLine, classes14) vérifiés. Poussée Manta, 0.64.0
purgée.
À SENTIR device : lancer un Sync batch et NAVIGUER pendant le submit et
les rattrapages — l'UI doit rester fluide de bout en bout ; logcat :
plus de gros « writeFileBase64 … bytes(b64)=18230760 », les uploads
partent d'un fichier bâti nativement.

## v0.64.0 (2026-07-20) — fournée relecture 5 (6 points), POUSSÉE MANTA

1. « Check Manual notes/PDF changes » : renommé ET rendu vrai — passe
   PDF Manual gratuite (taille vs docHash → manualStale).
2. LENTEUR pendant un job de fond : réponse donnée = la seule vraie
   carte restante est le PIPELINE 100 % NATIF (service Kotlin
   rendu→encodage→upload, JS orchestrateur seul ; même le JSONL ~27 MB
   traverse aujourd'hui le pont JS). CHANTIER D'UNE SESSION DÉDIÉE —
   attend « GO pipeline » du user.
3. Recherche : `p:8` (page exacte 1-based) + `approx:mot` (Levenshtein
   borné : 1, 2 dès 6 lettres — approx:bug trouve bag). Moteur vérifié
   insensible casse/accents sur TOUTES les branches (deaccentLower) —
   l'impression contraire du user ne se reproduit pas dans le code.
   Hint grammaire resync. 2 tests.
4. Champ chat : « Paste » in-row champ vide (Kotlin getClipboardText,
   presse-papier système, main thread — le long-press natif marche
   aussi) ↔ « ✕ » reset champ non vide.
5. Header panneau : lien « Lib » → setNavIntent('library') + flux
   openSettings ; App consomme l'intent (poll 500 ms foreground-only,
   module src/native/navIntent.ts) et saute directement à la Library.
6. Icônes du header distribuées sur toute la largeur (space-evenly).
Nettoyage : état `persona` mort + import mutateStore (restes consent/P1).
355 tests, tsc/eslint 0. Kotlin recompilé, marqueurs bundle (6/6) et
dex (getClipboardText, classes14) vérifiés. Poussée Manta, 0.63.7
purgée.

## v0.63.7 (2026-07-20) — fournée relecture 4 : layout du cadre + re-tap Sync batch = STOP, POUSSÉE MANTA

1. Le « Submitting batch… » du bas de cadre disparaît en cours de run :
   la progression vit SUR le bouton Sync batch (qui montrait déjà la
   note en cours).
2. Liste des synchros Auto récentes : 3 affichées (5 persistées).
3. « Force sync now » à droite du titre AUTO ; « Check all notes for
   changes » à droite du titre MANUAL (réponse donnée : il ne vérifie
   QUE les .note Manual — l'Auto s'auto-vérifie au tick, les PDF via
   docHash). « ✓ last check » reste sous l'en-tête Manual.
4. RE-TAP sur « Sync batch » en cours = STOP (bouton actif en
   « ⏹ Stop — <note> » ; shouldStop déjà honoré entre rendus et avant
   chaque chunk — un upload en vol termine son chunk). Les chunks déjà
   soumis restent chez Mistral en jobs normaux, supprimables via
   « Cancel jobs at Mistral » (v0.63.6) — la boucle contrôle est
   complète : couper le rendu/upload (re-tap) + couper l'attente
   Mistral (Cancel).
353 tests, tsc/eslint 0. Marqueurs bundle vérifiés (stopping\u2026 +
\u23f9 présents, « Submitting batch » ABSENT). Poussée Manta, 0.63.6
purgée.

## v0.63.6 (2026-07-20) — annuler les jobs Mistral + garde double-paiement jobs corrompus, POUSSÉE MANTA

ANNULATION (demande user) : batchIo.cancelBatchJob (POST /v1/batch/jobs/
{id}/cancel) + pretranscript.cancelPendingJobs — sous le verrou jobs,
annule chaque job pending chez Mistral (best-effort : un job disparu/
fini est quand même retiré du record) ; les pages quittent pendingSets
et redeviennent « to read » (le −50 % déjà engagé est perdu → bouton
ARMÉ : 2 taps, « Cancel — sure? (loses −50% work) »). À côté de « Check
batch results » dans la ligne At Mistral.

Le CRITIQUE jobs-corrompus (audit 2026-07-20) fixé côté sûr pour le seul
chemin non surveillé et volumineux : loadJobs THROW sur pretranscript.
json corrompu (jamais [] qu'un save écraserait), mais le tick Auto
l'avalait en [] → il lisait en PLEIN tarif jusqu'à 100 p/tick déjà
payées en jobs −50 % invisibles. Désormais un fichier jobs illisible
MET EN PAUSE les lectures payantes du tick (le refresh structurel
gratuit tourne ; log « paid reads paused ») ; il guérit au prochain
collect ou via Cancel. Les consommateurs chat / read-then-export
restent best-effort (initiés user, bornés, une facture se remarque) —
NON traités, à faire si besoin.

RAPPEL user sur « la question du critique » : c'était = comment fixer,
(a) bloquer les lectures payantes vs (b) supposer tout pending. Choisi
(a) pour le tick (le seul risque réel de double-paiement en boucle).

3 tests cancel neufs. 353 tests, tsc/eslint 0. Marqueurs bundle
vérifiés (Cancel jobs, endpoint cancel, paid reads paused). Poussée
Manta, 0.63.5 purgée. À TESTER device : bouton « Cancel jobs at
Mistral » → les jobs bloqués disparaissent d'« At Mistral », pages
reviennent « to read ». (Note : v0.63.5 les libère déjà au prochain
collect ; Cancel = contrôle immédiat + cas jobs vraiment coincés
QUEUED.)

## v0.63.5 (2026-07-20) — les PDF bloqués LIBÉRÉS + audit moteur sync (2 régressions perso), POUSSÉE MANTA

LES « 4 (5) PDF at Mistral depuis hier » : le endpoint batch de Mistral
strippe les confidence_scores → chaque page PDF batch lue comme
escalate (0 mot scoré) → vague vision de TOUT le document (a) pur
surcoût (b) insoumettable en contexte note-hosted → jobs pending à vie,
texte OCR DÉJÀ stocké (5 jobs, 310 p re-téléchargées à chaque check ;
~1,5 € de vision fantôme sur le seul PDF 291 p). FIX : pas de scores
dans un job batch = PAS d'escalade (OCR-only, comme les pages
imprimées live ; bench 12/07 = OCR nu gagnant sur l'imprimé). L'escalade
reprendra le jour où Mistral renverra les scores en batch.

AUDIT MOTEUR SYNC (agent de fond) — 2 RÉGRESSIONS que j'ai livrées hier,
mêmes symptômes « bloqué chez Mistral », CORRIGÉES ici :
- v0.63.2 uiDocOpen coincé TRUE (PluginHost garde l'arbre JS monté à la
  fermeture → le cleanup de l'effet browseDoc ne tourne pas sur ✕ /
  « Go to page » doc ouvert → maybeCollectBatch bloqué à vie, jobs
  finis même pas téléchargés). Fix : marqueur HORODATÉ, auto-expire
  ~2 min après la dernière interaction page (renouvelé par openPage,
  purgé par goToNotePage) quel que soit le chemin de fermeture.
- v0.63.3 marche de fond openDoc sans jeton : open A → retour → open B,
  la marche tardive de A repeignait la grille de B (et la base de sa
  sélection) → « Read then export » pouvait payer des pages de B non
  choisies. Jeton browseReq ajouté (miroir de pageReq).

AUDIT — findings NON corrigés (reportés au user, décision en attente) :
- CRITIQUE : pretranscript.json corrompu → les 3 conscommateurs money
  (tick, gather chat, read-then-export) `loadJobs().catch(()=>[])`
  traitent « illisible » comme « rien en pending » → double paiement
  live des pages en job −50 %, sans auto-réparation. À décider :
  bloquer les lectures payantes vs « tout supposer pending ».
- MAJEUR : l'expiry 48 h ne borne PAS un job dont l'output se
  télécharge bien mais dont la vague 2 ne peut jamais partir (généralise
  le cas PDF aux note-ocr en contexte DOC ; et tout statut Mistral
  inconnu mappé 'pending' n'est jamais expiré). Argent SÛR à l'expiry si
  des résultats ont été stockés (docHash/revs bloquent la re-soumission)
  — perdu seulement si le job échoue AVANT tout collect réussi.
- MAJEUR : collect ignore l'échec du saveJobs par-job après push d'une
  vague 2 (fenêtre kill = double vague 2). MINEURS : re-collect vague-1
  écrase une entrée live plus fraîche ; cap session vs « Sync now »
  silencieux ; ticks concurrents → « Nothing to sync » trompeur ;
  bannière sous-compte les dossiers jamais listés ; readPdf stat-first
  fenêtre stat/read.
BLANCHI : live-read markers try/finally, in-flight registry, manualStale/
recents/stamps mono-writer.
350 tests, tsc/eslint 0. Marqueurs bundle vérifiés. Poussée Manta,
0.63.4 purgée. À VÉRIFIER device : logcat « no confidence data in the
batch output — escalation skipped » au prochain check → les 5 jobs PDF
passent DONE et quittent « At Mistral ».

## v0.63.4 (2026-07-19) — le métronome des 45 s MEURT + les échecs muets parlent, POUSSÉE MANTA

Rapport user « c'est freeze, je peux plus rien faire » — verdict logs :
le runtime était VIVANT (ticks finissant en 1,5 s), mais (1) le
« library-watch » relançait une passe complète de 68 notes TOUTES LES
45 SECONDES, en continu, config ouverte (timeline 21:05→21:09 au
métronome) — SUPPRIMÉ : config ouverte = personne n'écrit dans une
note ; les vrais déclencheurs suffisent (pen-up, tour de page,
config-open, interval 15 min qui TOURNE en config, activité
foreground). (2) « Redo ne fait rien » = plugin hébergé par le lecteur
DOC (« note renders unavailable » ×2 aux logs) et le Redo n'affichait
AUCUNE raison — un rendu échoué s'explique désormais (« open it from
the note »). (3) Signal « ✎ Edited since your fix » (GO user) : une
page corrigée main dont l'encre a changé depuis la correction l'affiche
dans la fiche page (probe de rev vs footer live, gardée par pageReq) —
le contrat « jamais écrasé » tient, la péremption n'est plus muette
(pageNeedsRead ignore volontairement les revs des entrées 'user',
vérifié et expliqué au user).
348 tests, tsc/eslint 0. Marqueurs bundle : ✎ présent, raison de rendu
présente, « library-watch » ABSENT. Poussée Manta, 0.63.3 purgée.
RESTE (si la lenteur persiste malgré 0.63.2+0.63.4) : le cap radical =
pipeline rendu/encodage/upload 100 % natif (service Kotlin coroutines),
backlog documenté.

## v0.63.3 (2026-07-19) — fournée relecture 3, POUSSÉE MANTA

1. Le cycle de la chip de mode RETROUVE l'héritage : avec un ancêtre
   tracké, un cran après le dernier mode SUPPRIME l'override et le
   chemin suit à nouveau son parent (il n'y avait AUCUN moyen de
   revenir « comme le parent » une fois un override posé).
2. « Transcript » depuis la recherche restait 15-20 s sans réaction :
   openDoc faisait la marche structurelle COMPLÈTE (syncNotePages,
   9 s mesurées sur une grosse note froide, pire sous contention)
   AVANT d'afficher. La liste de pages s'affiche désormais
   INSTANTANÉMENT depuis le store ; la marche de réalignement tourne en
   fond et rafraîchit la grille. Sûr côté argent : les chemins payants
   re-passent par syncPageIds eux-mêmes à la lecture (v0.42).
   goToNotePage était déjà léger — sa latence venait de la saturation
   du thread JS, résolue par le b64 natif de v0.63.2.
3. La ligne « Batch check: N stored this pass… » est SUPPRIMÉE
   (décision user) — seuls les échecs affichent un message ; la ligne
   « At Mistral: OCR X · Vision Y » suffit à suivre le drain.
RÉPONSE ARCHITECTURE donnée au user (« pas de multitâche en 2026 ? ») :
Android multitâche très bien — RN n'a qu'UN thread JS et notre pipeline
y faisait trop de travail ; le cap durable si besoin = pipeline de
rendu/encodage/upload ENTIÈREMENT natif (service Kotlin coroutines),
JS = orchestration seule. Backlog si la 0.63.2+0.63.3 ne suffisent pas.
348 tests, tsc/eslint 0. Poussée Manta, 0.63.2 purgée.

## v0.63.2 (2026-07-19) — la cure de lenteur UI : base64 NATIF + pause doc-ouvert, POUSSÉE MANTA

Diagnostic device (logcat : 72 rendus en 7 min pendant le rapport
« l'UI est très lente ») : ce n'est PAS le réseau Mistral — le poids
était CHEZ NOUS : l'encodage base64 pur-JS de chaque PNG rendu
(0,5-1 MB) bloquait le thread JS des centaines de ms par page pendant
les épisodes de rattrapage vague-2 (allongés par le budget 50).
- Kotlin `readFileBase64(path)` : lecture + encodage sur le thread
  NativeModules (hors UI et JS). Branché sur readPngBase64 (rendus
  note), renderDocPage (rendus doc) et readPdf — fallback JS conservé
  pour un vieux binaire. MARQUEUR DEX vérifié (classes14.dex).
- readPdf : stat de taille GRATUIT d'abord (readFileSize) → le
  early-return docHash ne tire plus tout le PDF en mémoire JS (ce
  chemin tourne à CHAQUE send chat touchant un PDF couvert).
- Marqueur `uiDocOpen` (capture.ts, posé par le navigateur de pages de
  la Library) : le collect auto SKIP et submitVisionWave DIFFÈRE sa
  vague entière tant qu'un document est ouvert — même esprit que la
  pause de la sweep (v0.42.1) ; le bouton explicite « Check batch
  results » reste actif.
348 tests, tsc/eslint 0. Kotlin recompilé (pas UP-TO-DATE), bundle +
dex vérifiés. Poussée Manta, 0.63.1 purgée. À SENTIR device : pendant
un épisode de rattrapage, la Library doit rester réactive (l'encodage
n'est plus sur le thread JS) ; ouvrir un doc suspend les rendus de
fond.

## v0.63.1 (2026-07-19) — fournée relecture 2 (6 points user), POUSSÉE MANTA

1. READ : les deux full prompts assemblés sont REPLIABLES (flèche,
   repliés par défaut).
2. Filtre Show STRICT : seuls les dossiers dont le mode effectif
   correspond (ou contenant un override descendant du mode) s'affichent
   — plus le squelette des autres modes. Calculé depuis autoTargets
   seul, zéro marche d'arbre.
3. Liste des dernières synchros Auto PERSISTÉE
   (settings.recentAutoSyncs, max 5, UN writer : autoTranscript,
   hydratée au démarrage du scheduler) — la liste session paraissait
   toujours vide après chaque réinstall.
4. « Force sync now » : cadre au texte (alignSelf), plus pleine largeur.
5. Ligne batch libellée « Batch check: N p stored this pass · M job(s)
   at Mistral · K failed » (l'ancienne lecture « 552 pages stored »
   passait pour une somme Auto+Manuel cassée — expliqué au user : c'est
   le résultat de LA passe de collecte).
6. MAX_PAGES_PER_SESSION 1000 → 5000 (backlog réel ~4200 p ; reste un
   plafond anti-emballement ~20 €). « Session » = vie du process
   PluginHost (fermer le plugin ne la réinitialise PAS ; kill Android /
   réinstall / reboot oui) — documenté dans la constante.
348 tests, tsc/eslint 0. Marqueurs bundle vérifiés (MAX_PAGES=5e3,
hydrateRecentAutoSyncs, Batch check:). Poussée Manta, 0.63.0 purgée.
Post Reddit r/MistralAI publié par le user (batch strippe
confidence_scores — non documenté, /v1/ocr listé supporté) — réponse à
surveiller.

## v0.63.0 (2026-07-19) — cadre v2 (fournée relecture user, 6 points), POUSSÉE MANTA

1. Porte 1 renommée « API key, privacy, backup & appearance ».
2. GUIDE : note batch-vs-live (batch = pas de feedback unsure, TOUTES
   les pages formatées par Vision ; PDF live escaladés only-if-needed),
   paragraphe consentement remplacé, features du cadre documentées.
   GÉNÉRATEUR COMMITTÉ (tools/make_guide_pdf.py — celui de v0.60 était
   mort avec un scratchpad) ; guideSeed versionné (GUIDE_REV=2) : un
   guide installé d'une rev antérieure est REMPLACÉ fichier+transcript
   (contrat assumé, test adapté). PDF 14 749 o vérifié dans l'app.npk.
3. Cadre SYNCHRONISATION : colonne AUTO affiche les 3 dernières
   synchros Auto (nom · N p · datetime, session), les NOMS des docs
   « to read » (cap 4), et un bouton « Force sync now » (tick force +
   modeFilter auto). SOUS le cadre : chips « Show: Auto/Manual/Off »
   (filtre l'arbre par mode effectif), « Expand: 1/2/3/all », et les
   Export all déplacés là — Clear all reste en haut (anti-appui
   accidentel). La ligne msg du bas de page DÉMÉNAGE dans le cadre.
4. WAVE2_PAGES_PER_PASS 24 → 50 (backlog drainé ~2× plus vite,
   épisodes ~2 min) ; le test de budget se dimensionne sur la constante.
5. Réponses données : le Manual « extrêmement lent » = drain vague-2 du
   gros backlog à 24 p/15 min (rien de bloqué, logs à l'appui) ; « PDF
   en markdown bien formaté ? » → OUI, l'OCR 4 sort déjà du markdown
   structuré (titres/tableaux), l'escalade vision ne sert que
   photos/figures/manuscrit — le bench 07/2026 donne même l'OCR nu
   gagnant sur l'imprimé.
348 tests, tsc/eslint 0. Marqueurs bundle (8/8) vérifiés. Poussée
Manta, 0.62.3 purgée. À TESTER device : re-seed du guide (log « seeded
8 guide page(s) (rev 2… ») + ouvrir le PDF (nouveau contenu p.3) ;
colonne AUTO enrichie ; Force sync now ; chips Show/Expand ; Export all
en bas ; drain vague-2 à 50 p/passe.

## v0.62.3 (2026-07-19) — relecture user : guide home + privacy honnête, POUSSÉE MANTA

Home : mention « (black = today, grey = coming) » et boîte grise « … »
supprimées (tout ce qui est affiché existe) ; AI AGENTS déplacé juste
APRÈS CHAT dans l'arbre ET dans les lignes de description (même ordre
que le schéma) ; « custom assistants » → « custom chats » ; « Full
guide: » → « Guide and sources: ». Écran clé : paragraphe Privacy
réécrit post-suppression du consentement (CHAT/Sync envoient à Mistral
EU avec TA clé, rien stocké, plan payant = pas d'entraînement, fichiers
Off jamais envoyés). UI-TEXTS H3/H9/H11/K12 resync. 348 tests,
tsc/eslint 0. Vérifié bundle (positif + négatif). Poussée Manta,
0.62.2 purgée. Réponse donnée au user sur « c'était déjà comme ça ? » :
OUI — les soulignés venaient des pages lues LIVE ; le premier gros
Sync batch date du 18/07, exactement la fenêtre d'apparition du
symptôme (angle mort révélé par le changement d'usage, pas une
régression).

## v0.62.2 (2026-07-19) — compteur « unsure » honnête, POUSSÉE MANTA

Décision user : « si tu sais qu'il n'y en a que 2 dans le texte, le
warning doit dire 2 » — les low words viennent de l'OCR, le texte de la
VISION : un mot réécrit par la vision est résolu, un mot conservé reste
douteux. Helper partagé `matchedLowWords` (core/text/lowMatch) avec LE
MÊME WORD_SPLIT que le soulignage de MarkdownView (importé depuis là —
source unique) ; le label de PageView ne compte que les survivants et
disparaît à 0. Données stockées inchangées (le glossaire garde tout).
Le gras spontané du MODÈLE est CONSERVÉ (décision user : « dans
certains cas c'est bien », pas de strip à l'affichage).
IDEAS : entrée « sessions de correction » (retrouver les pages à mots
unsure — agrégation par note à faire). 5 tests neufs (348), tsc/eslint
0. Poussée Manta, 0.62.1 purgée.

MYSTÈRE SOULIGNÉS — VERDICT FINAL (test batch-vs-live, 19/07 18:07) :
même image, même corps (confidence_scores_granularity:'word'), même
modèle → LIVE : champ PRÉSENT (25 mots scorés) ; BATCH : champ ABSENT
de la réponse (la clé n'existe pas dans l'objet page), TEXTE IDENTIQUE
au caractère près. **Le endpoint batch de Mistral IGNORE le paramètre
de granularité** — c'est structurel côté serveur, pas un bug plugin.
Conséquences : (1) toute page passée par Sync batch n'aura JAMAIS de
soulignés (les pages live Auto/Sync now/chat en ont) ; (2) ⚠ ARGENT :
pour les PDF en batch, le signal d'escalade (0 mot scoré → escalate)
est faussé → TOUTES les pages du PDF escaladent en vision (surcoût
depuis v0.42). Latence mesurée : 58 min de queue pour un job d'1 page
un samedi soir (processing instantané ensuite). OPTIONS (GO user en
attente) : documenter tel quel / ticket support Mistral / heuristique
d'escalade batch-PDF qui n'escalade plus sur la seule absence de
scores. Clé de test à RÉVOQUER (rappelé au user).

## v0.62.1 (2026-07-19) — le « N to read » fantôme des notes Auto, POUSSÉE MANTA

Post-0.62.0, l'Auto lit enfin (14 p puis 23 p au logcat) MAIS la ligne
de fichier ET le cadre disaient encore « 23 to read » (Vacances
Egypte). Racine : les entrées manualStale posées quand la note était
MANUAL survivent au passage en Auto — la purge E1 ne tournait que pour
mode 'manual', et la box + les lignes appliquaient le override stale à
TOUS les modes. Fix aux 3 sites : purge sur passe payée couverte QUEL
QUE SOIT le mode ; box et lignes n'honorent le stale que pour les docs
ACTUELLEMENT Manual. (+ loadStore inutilisé du retrait consent purgé.)
343 tests, tsc/eslint 0. Poussée Manta, 0.62.0 purgée.

MOTS SOULIGNÉS — mystère CLOS, deux comportements expliqués au user :
(1) « 10 unsure words » mais 2 soulignés = les low words viennent de
l'OCR, le texte final de la VISION → le soulignage ne marque que les
tokens retrouvés verbatim dans le texte vision (2/10 ici). (2) les
AUTRES mots en gras = le MODÈLE lui-même (markdown), pas nos marques
(les exports le strippent déjà, v0.52). Diag live 16:45 : « 14 p ·
word scores on 13 · 105 low » → l'API renvoie bien les scores ; RESTE
à voir un « diag job » (batch) au prochain collect pour comparer.
OPTIONS proposées (GO en attente) : compteur « N unsure · M shown » ;
strip du gras modèle à l'affichage comme dans les exports.

## v0.62.0 (2026-07-19) — LE CONSENTEMENT CLOUD DÉGAGE (décision user), POUSSÉE MANTA

Incident du jour : le flag globalConsent est passé à false ~15:51 (seul
setter en session = bouton « Reset cloud consent » de l'écran clé,
probablement touché par accident) → l'Auto a skippé CHAQUE note payante
en silence pendant des heures (« needs consent → skip », zéro signal
UI, « 12 to read » figé). Verdict user : « dégage-moi ce consentement
si ça fout le bordel pour rien ».

SUPPRIMÉ : gate+dialog du send (ChatPanel), gates du tick et du collect
(autoTranscript — la CLÉ est désormais le seul gate cloud), gate canRead
de l'export (LibraryScreen), bouton « Reset cloud consent » (KeyApp —
remplacé par une note privacy simple). CONSERVÉ : le dialog one-shot
OFF (protège du CONTENU) ; le champ globalConsent reste dormant dans le
store (zéro migration) — un rebuild d'index qui le reset n'a plus
d'effet. UI-TEXTS : K12/D9/P48/P49 supprimés, E9 réécrit.

343 tests (2 adaptés : consent-skip → la lecture part quand même),
tsc/eslint 0. Marqueurs bundle vérifiés dans LES DEUX SENS (dialog et
« needs consent » ABSENTS ; note privacy et gate Off PRÉSENTS).
Poussée Manta, 0.61.3 purgée. EFFET ATTENDU au premier tick post-
réinstall : les 12 pages de Supernote Plugin dev.note partent SANS
re-consentir (sauf la page affichée, différée by design) + les lignes
« [SmartNoteAI.ocr] diag » trancheront enfin les mots soulignés.
Artefact des flux : « flux-sync-v0.61.3 » (la gate consent y est
désormais historique).

## v0.61.3 (2026-07-19) — diag mots soulignés + janitor temp (les « 29 MB »), POUSSÉE MANTA

(a) DIAG SOULIGNÉS (GO user) : la chaîne code est prouvée intacte de
bout en bout (granularité demandée dans les 3 bodies, extraction <0.8,
collect/vague-2/sanitize préservent low) → suspect = la RÉPONSE de
`mistral-ocr-latest` (alias serveur repointable). Une ligne de résumé
aux 4 points d'entrée OCR (live note « diag live: », live PDF, batch
note-ocr « diag job », batch pdf) : N p · word scores sur M · K low(<0.8)
+ verdict « confidence field ABSENT » si 0 score avec du texte.
`OcrPage.words` ajouté pour distinguer « champ absent » de « recalibré
≥0.8 ». LECTURE : ABSENT partout = Mistral a coupé le champ (→ signaler
/ enlever la feature) ; scores>0 et low=0 = confidences recalibrées
(→ remonter le seuil 0.8 ?). ⚠ si ABSENT : TOUTES les pages PDF
escaladent en vision (le signal d'escalade utilise les mêmes scores) —
surcoût à surveiller.

(b) JANITOR TEMP (diagnostic des « 29 MB ») : mesuré, une install
propre = 8,5 MB (npk 7,06 + bundle 1,39) ; uploadBatchFile supprime son
batch-upload-<ts>.jsonl en finally MAIS un kill mi-upload orpheline
8-18 MB à VIE (nom horodaté, aucun balayage). Sweep au démarrage
(index.js, fire-and-forget) : NOS patterns uniquement (batch-upload
jsonl, sp-scratch/sp-doc png), >1 h d'âge, log « N stale temp file(s)
deleted — X MB reclaimed ». Le premier lancement EST le diagnostic
(stockage interne illisible via adb). Si après sweep la taille reste
>>8,5 MB+data → c'est l'empilement d'installs PluginHost (bug connu,
memory pluginhost-version-stacking-bug ; PluginJanitor natif toujours
PAS embarqué — backlog).

3 tests janitor neufs ; attendus ocr/batch portent `words`. 343 tests,
tsc/eslint 0 erreur. Marqueurs vérifiés bundle (4 diag + 2 janitor).
Poussée Manta, 0.61.2 purgée. VÉRIFS DEVICE : (1) au premier lancement
logcat « [SmartNoteAI.janitor] … MB reclaimed » → me donner le chiffre ;
(2) après un Sync/collect : les lignes « [SmartNoteAI.ocr] diag … » →
me donner UNE ligne, elle tranche le mystère des soulignés.

## v0.61.2 (2026-07-19) — REVERT budget 24 + compteur At Mistral par vague, POUSSÉE MANTA

Verdict device du test 1000 (rapport user ~16 h) : « rien n'est
fluide » — la passe unique géante (170+ rendus, uploads 8-18 MB)
par-dessus les walks du tick Auto (67 notes/min, Library ouverte)
enterrait la Librairie. REVERT à 24 + test v0.60.2 restauré.

ET la racine du « 347 p at Mistral since 11:07 qui ne bouge JAMAIS »
(mesuré au logcat 15:43-15:52 : 178 pages OCR stockées + re-soumises
vision pendant que le chiffre restait plat) : le compteur SOMMAIT les
deux vagues — une page qui sort d'OCR entre en Vision, le nombre est
constant par construction. Le cadre affiche désormais
« At Mistral: OCR X p · Vision Y p [· N PDF] · since HH:MM », et seule
la vague OCR se déduit du « to sync » (une page en vague Vision a déjà
son texte stocké — l'ancienne soustraction rétrécissait le backlog
affiché des AUTRES notes, même famille que le fix mode-flip du lot V).

Marqueurs vérifiés dans le bundle (`WAVE2_PAGES_PER_PASS=24`, libellé
OCR/Vision). Poussée Manta, 0.61.1 purgée. À VÉRIFIER device : la
ligne At Mistral bouge maintenant à chaque collect (OCR ↓, Vision ↑,
puis Vision ↓ quand les jobs vision rentrent) ; fluidité redevenue
celle de la 0.60.2.

RESTE OUVERT (design, GO user en attente) : exposer le flux OCR→Vision
par doc (chips d'état, « Run Vision now », progression du checking…) —
proposition détaillée en conversation ; + le diagnostic une-ligne des
word_confidence_scores (mystère des mots soulignés : chaîne code
vérifiée intacte de bout en bout, suspect = réponse de l'API/modèle
`mistral-ocr-latest` repointé côté serveur).

## v0.61.1 (2026-07-19) — budget vague-2 parké à 1000 (test user), POUSSÉE MANTA

Décision user : le budget 24 p/passe ne limitait en pratique que le
NOMBRE de jobs (≤40 p chacun) par réveil, au prix de 15 min de throttle
par tranche (~1 h 15 pour 100 p). Hypothèse à trancher sur device : le
gap de 350 ms suffit seul à garder la Librairie fluide (le defer
live-read du lot R protège déjà les flux payants). Parké à 1000 (soupape
conservée, une ligne), test v0.60.2 remplacé par le comportement dormant
(2 jobs même passe). FLUIDE → supprimer le mécanisme ; RAME → revert 24
+ restaurer le test depuis 12825e7. Buildée ×2, `WAVE2_PAGES_PER_PASS=1e3`
vérifié dans le bundle, poussée Manta (0.61.0 purgée device+local).
TEST : gros Sync batch puis naviguer la Librairie pendant le rattrapage
(désormais une seule passe de ~3 min pour 100 p) — walks fluides ?

## v0.61.0 (2026-07-19) — lots ré-audit R/P/S/V, BUILDÉE ×2, POUSSÉE MANTA

Ré-audit complet v0.60.0 (5 agents, session audit) : les 17 majeurs
v0.60 vérifiés (15/17 corrects, B5/B6-store partiels) + findings neufs.
Les 4 lots ci-dessous corrigent le tout — 4 commits (unités de revert),
340 tests (14 nouveaux), tsc/eslint 0 erreur. **Buildée ×2 (zéro ligne
Kotlin touchée — le dex est celui de v0.60) ; les 7 marqueurs des lots
vérifiés par grep dans le bundle livré + versionName 0.61.0 embarqué.
`smartnoteai-0.61.0.snplg` poussé sur la Manta (MyStyle), la 0.60.2
purgée device + local. Reste côté user : désinstaller/réinstaller le
plugin sur le device (hygiène habituelle) puis dérouler les vérifs
device plus bas.**

- **Lot R (argent)** : les rendus ne s'entrelacent plus JAMAIS —
  `serializeRender` (capture.ts) sérialise tout generateNotePng/
  generateDocImage dans une chaîne unique ; marqueur live-read
  (readNotePages + escalade PDF) → `maybeCollectBatch` diffère (avant
  le stamp 15 min) et `submitVisionWave` abandonne SA vague entière
  (gratuit, job vague-1 reste pending — mécanique defer v0.60.1) ; la
  garde « page affichée » de la vague 2 est désormais FRAÎCHE PAR PAGE
  (l'ancien snapshot one-shot ne protégeait que la page ouverte au
  début d'une boucle qui dure des minutes en fond).
- **Lot P (panel)** : le CHAT standard (= agent par défaut) reçoit la
  même fraîcheur que les vrais agents — send() lit model/persona frais
  des settings (l'ancien état de montage FACTURAIT le vieux modèle
  après une édition config panneau monté) ; `subscribeSettings`
  (settings.ts, notifieur in-memory — un seul runtime JS) → la carte de
  départ re-lit les agents à CHAQUE écriture settings (le symptôme
  device « aucun agent » ne peut plus revenir par ce chemin) + sync
  live de l'affichage (ligne statut, chips ⚡).
- **Lot S (persistance)** : « échec de lecture ≠ absence » pour les 2
  derniers modules — settings : preuve (fichier lu-mais-corrompu, ou
  listDir montre les fichiers) → session READ-ONLY, l'Import explicite
  lève la garde (chemin de récupération voulu) ; conversationStore :
  index+bak morts mais des <id>.json présents → index RECONSTRUIT
  depuis les fichiers (règle B1) ; présents mais illisibles → throw.
  Premier fichier de tests conversationStore (B5 était livré sans).
- **Lot V** : cadre sync — les pages batch pending ne comptent dans la
  colonne Manual que si le doc résout ENCORE Manual (le flip Auto/Off
  post-submit faisait disparaître le backlog des autres notes et
  pouvait griser les boutons Sync) ; sweep — les notes échouées d'une
  passe ANNULÉE sont relâchées au cleanup (avant : plus de compteur de
  la session) ; hygiène — SmartNoteAI-0.59.0.snplg racine purgé.

**À tester device (v0.61.0 installée)** : (1) send pendant qu'un collect de
fond tourne → log « wave 2: live read in progress — wave deferred » et
AUCUN rendu entrelacé ; (2) éditer le modèle CHAT config ouverte
panneau monté → le send suivant utilise/affiche le nouveau ; (3) créer
un agent config ouverte panneau monté sur la carte de départ → il
apparaît sans fermer le panneau ; (4) tourner les pages pendant un
rattrapage vague-2 → chaque page tournée-vers est différée (log) ;
(5) flip Manual→Auto d'une note avec batch pending → le « to sync »
des AUTRES notes ne bouge pas.

**Restent connus (non traités, décisions/design)** : sleeps Timing dans
les pipelines payants (la sérialisation des rendus réduit le risque ;
la conversion en yields non-Timing reste à trancher), B6-store
(fallback /sdcard cache-session — trade-off documenté), F1/F2 du
ré-audit store (shard préservé-non-chargé écrasé par un touch live ;
neverWritten×unloadedShards), Clear qui ne vide pas docs/, guide qui
ressuscite après suppression user, consent global bypassé par Read-now
agent/Read&add, quickActions vidées non persistables.

## v0.60.2 (2026-07-19) — le rattrapage vague-2 ne fige plus la Librairie

Retour device v0.60.1 (depuis une note — « Original page » REVENUE ✓,
vagues 2 soumises ✓, « wave-2 vision submitted (20 p) » etc.) : le
plugin devenait ULTRA LENT dans la Librairie. Cause mesurée au logcat :
le rattrapage des vagues différées rendait des dizaines de pages
dos-à-dos (render + base64 + upload) pendant la navigation — les walks
de notes passaient de ~0,5 s à 23–55 s (famine JS/native). Fixes :
- chaque rendu de vague 2 RESPIRE (350 ms de gap, plus un simple yield) ;
- BUDGET de 24 pages de vague 2 par passe de collect
  (WAVE2_PAGES_PER_PASS) — au-delà, les jobs restants restent pending et
  prennent la passe suivante (15 min auto ou entrée Librairie). Un job
  isolé plus gros que le budget passe quand même seul.
Soulignés : toujours en attente du diagnostic batch (job 1 ligne en
file > 20 min). Si le batch renvoie bien les scores → les pages
regardées ont simplement peu de mots < 0,8. 328 tests.

## v0.60.1 (2026-07-19) — rapport de régression ANALYSÉ : les rendus sont LIÉS À L'APP HÔTE

Rapport user post-0.60 (la **v0.60.0 ÉTAIT bien installée** — preuve :
le PDF guide copié sur le device à 11:17 ; j'avais d'abord conclu à tort
« v0.59 » sur l'ABSENCE de logs du seed, mangés par le filtre chatty
d'Android pendant la fenêtre d'install — gotcha #34 du skill ; une
absence de logcat n'est PAS une preuve, un artefact disque oui) :
« plus de VISION après OCR », « Original page vide pour une .note »,
« aucun mot souligné ».

**Cause racine (device-prouvée, logcat 11:28)** : `generateNotePng`
échoue en ~5 ms par page avec `HostCommImpl: checkAPIAvailable
packageName:com.supernote.document` — le plugin était HÉBERGÉ PAR LE
LECTEUR DOC (l'user venait d'un PDF), et generateNotePng est une API de
l'app NOTE. Contrainte firmware PRÉ-EXISTANTE (pas une régression de
code v0.60) ; symétriquement generateDocImage exigera le contexte DOC.
Conséquences dans ce contexte : la vague 2 échouait en bloc et le code
marquait le job done « OCR text kept » → **vision perdue À JAMAIS** pour
ces pages (15 pages Kim Slager grillées à 11:28) ; le rendu « page » de
la vue détail échoue pareil. Le v0.60 aggravait l'exposition (bouton
guide → DOC ; auto-check 15 min depuis n'importe quel contexte).

**Fixes v0.60.1** :
- La vague 2 non soumise (rendus indisponibles OU upload raté) laisse le
  job PENDING → re-tenté au prochain check (rendus gratuits, re-store
  wave-1 idempotent, borné par l'expiry 48 h). Plus JAMAIS de « OCR text
  kept » silencieux. Idem pour l'escalade PDF.
- Vue page : après les deux tentatives de rendu, placeholder explicite
  « (no preview in this context: … open the plugin from the note/PDF
  and retry) » au lieu du « … » éternel (L42).

**Soulignés (symptôme 3)** : AUCUNE régression de code trouvée — chaîne
complète vérifiée (wave-1 stocke `low`, collect vision préserve
`prev.low`, LibraryScreen passe `e.low`, PageView → MarkdownView
souligne). Diagnostic API LIVE : `confidence_scores` toujours présents
(/v1/ocr, granularité word, tokens avec espace initial → gérés par le
trim). Test BATCH 1 ligne lancé pour confirmer que le batch renvoie
aussi les scores (résultat en mémoire/section suivante si terminé).
Hypothèse restante si le batch les renvoie : les pages regardées ont
simplement peu/pas de mots < 0,8 (OCR devenu plus confiant côté
Mistral) — à vérifier sur une page manuscrite vraiment difficile.

**Note importante** : les 15 pages de Kim Slager collectées à 11:28
(v0.59) ont leur job fermé « OCR kept » — pour leur donner la vision :
éditer/toucher ces pages OU un « Sync now » après édition (le rev
bougera) ; sinon elles restent OCR-only.

### Test rapide après install v0.60.1
1. Installer smartnoteai-0.60.1.snplg (Settings → Plugins) — vérifier le
   log `[SmartNoteAI.guide] seeded 8 guide page(s)` au premier open.
2. OUVRIR LE PLUGIN DEPUIS UNE NOTE → vue page d'une .note : « Original
   page » doit se rendre ; depuis le lecteur PDF → le placeholder
   explicite doit s'afficher à la place.
3. Sync batch d'une note manuscrite difficile → attendre le collect
   (auto ≤15 min, plugin ouvert DEPUIS UNE NOTE) → la page passe en
   source « Mistral OCR 4 + Vision » et les mots incertains se
   soulignent.

## v0.60.0 (2026-07-19) — MAJEURS de l'audit (17 points) + 4 features — BUILDÉE ×2, POUSSÉE MANTA

Mission « majeurs d'abord puis features » (GO user). Chaque lot = un
commit (unité de revert). 326 tests (28 nouveaux), tsc/eslint 0 nouveau.
**Build ×2 OK (Kotlin D1/D2/copyAssetToFile compile), marqueurs vérifiés
dans le bundle ET le dex (classes14.dex), PDF guide 14 255 o dans
app.npk, reactPackages OK. `smartnoteai-0.60.0.snplg` poussé sur la
Manta (MyStyle), la 0.59.0 purgée du device et du local.** Reste côté
user : désinstaller/réinstaller le plugin sur le device (hygiène
habituelle) puis dérouler les vérifs ci-dessous.

### Lot A — ARGENT (tous vérifiés sur v0.59 avant fix)
- A1 `submitVisionWave` défère la page AFFICHÉE (rendu partiel → vision
  facturée sur une image fausse, stampée rev frais). Même issue que
  l'échec de submit wave-2 : le texte OCR wave-1 reste.
- A2 gate Off au collect : un doc passé Off APRÈS submit → job clos,
  résultats payés DROPPÉS (loggés), rien stocké, pages déverrouillées.
- A3 `loadJobs` corrompu → THROW (absent ≠ illisible ; [] laissait le
  prochain save écraser des jobs payés) ; `saveJobs` vérifie {success},
  3 essais, et les flows de submit S'ARRÊTENT si l'écriture échoue.
- A4 `contextSent` marqué succès OU échec (le turn porteur reste dans
  l'historique — la recomposition re-facturait à chaque tour) ; les
  bulles `⚠` portent `error:true` et sont FILTRÉES de ce que voit le
  modèle (il répondait à ses propres messages d'erreur).
- A5 l'estimation des gaps d'agent exclut les pages batch-pending (prix
  jusqu'à ~2,5× trop haut, total de progression inatteignable).
- A6 registre in-flight (core/model/batch) : la fenêtre render/upload
  d'un submit (jobs pas encore sur disque → invisibles de pendingSets)
  est consultée par `pagesNeedingRead` + `readPdf`.

### Lot B — STORE/IO (« échec de lecture ≠ absence »)
- B1 index+bak morts → index RECONSTRUIT depuis les fichiers shards
  (chacun porte son path) ; shards présents mais illisibles → session
  DÉGRADÉE : shards écrits, commits d'index désactivés. Consent reset
  (privacy-conservateur) sur reconstruction.
- B2 un shard illisible GARDE son entrée d'index (expulsé = re-lecture
  payée) ; guéri à la prochaine réécriture du doc.
- B3 échec d'écriture shard → re-schedule du persist + un shard JAMAIS
  écrit reste hors index (pas de référence fantôme).
- B4 legacy store présent mais imparsable → fichiers CONSERVÉS, session
  dégradée (la suppression détruisait la dernière copie).
- B5 conversationStore : miroir index.json.bak, index corrompu → throw,
  écritures sérialisées (file).
- B6 secureKey + conversationStore : retry getPluginDirPath, échec NON
  caché, plus JAMAIS de fallback /sdcard (pepper+clé visibles MTP) ;
  nettoyage best-effort des restes /sdcard/secrets.

### Lot C — PANEL (vérifs device plus bas)
- C1 ✕ et ⚙ grisés pendant un send (la réponse payée était jetée) —
  Stop (⏹) d'abord, puis fermer.
- C2 Cancel d'un dialog consent/Off/estimation REMET le message tapé
  dans l'input (sauf si du texte plus récent).
- C3 send() pousse la liste d'agents FRAÎCHE dans l'affichage (ligne de
  statut / « ∅ deleted agent » pouvaient montrer un modèle et facturer
  un autre).
- C4 un nom d'agent vidé n'est JAMAIS persisté (dernier nom non vide
  gardé) — le vider détruisait l'agent au prochain load.

### Lot D — KOTLIN (non compilé ici)
- D1 heartbeat en companion (statique) : chaque recréation du module
  orphelinait un Runnable re-posté à vie (events doublés).
- D2 rotatePng atomique (.tmp+rename) ; côté JS un rotate ÉCHOUÉ annule
  la capture (pas d'OCR payé sur image de travers), page re-tentée.

### Lot E — DIVERS
- E1 une passe payée couvrant une note Manual PURGE `manualStale` (+
  reset `manualSeenSig`) ; passe partielle → résidu honnête. Le « N to
  sync · ~X € » fantôme post-paiement est mort.
- E2 auto-save de conversation ÉVÉNEMENTIEL quand le dernier turn est
  assistant (les timers JS sont gelés en flottant ; les effects, non).
- E3 `flushSettings`/openAssistant attendent AUSSI l'écriture en vol
  (`lastWriteRef`) — un flush pendant write résolvait immédiatement.

### Features
- F1 le bloc OFF quitte le cadre SYNCHRONISATION (Auto + Manual).
- F2 « Original page » (un seul libellé .note/.pdf) + VRAI aperçu PDF
  dans la vue page via renderDocPage (chargé à l'ouverture seulement).
- F3 auto-check batch 15 min : `maybeCollectBatch` (autoTranscript),
  auto-throttlé, INDÉPENDANT de la garde Auto (un user tout-Manual a
  aussi des jobs), branché sur chaque tentative de tick ET sur le
  heartbeat natif de l'overlay. Fire-and-forget, withJobsLock-safe.
- F4 USER GUIDE EMBARQUÉ : PDF 8 pages (asset APK, généré depuis
  `src/core/guide/guidePages.json` — source unique, ASCII pur, script
  scratchpad make_guide_pdf.py) copié vers `Document/SmartNote AI/` ;
  transcript seedé source **'guide'** (union + WHITELIST
  sanitizePageEntry + labels ; texte verbatim, pas de reflow) ;
  docHash = taille réelle du fichier installé → pdfCovered, jamais « to
  sync », jamais facturé ; seed idempotent à chaque App.load (couvre
  install, fresh start contentV, Clear all, shard corrompu) ; bouton
  Home « Open the User Guide (PDF) » → FileUtils.openFilePath (+
  réinstall si supprimé). Kotlin `copyAssetToFile` (atomique, EXISTS).

### À VÉRIFIER DEVICE (v0.60 installée)
1. ~~Kotlin compile~~ FAIT (build 19/07).
2. Guide : premier lancement → PDF dans Document/SmartNote AI/, doc
   dans la bibliothèque (8 p, source Guide), « Open the User Guide »
   ouvre le lecteur DOC (`FileUtils.openFilePath` jamais testé device —
   plan B : openNoteAt Kotlin). Supprimer le PDF → bouton le réinstalle.
3. C1 : ✕/⚙ grisés pendant un send ; C2 : Cancel d'une estimation remet
   le texte ; C3 : renommer l'agent en cours de conversation → la ligne
   de statut suit au send suivant ; C4 : vider le nom → sortie/retour →
   dernier nom conservé.
4. F3 : logcat `batch auto-check:` ~15 min après un Sync batch, panel
   ouvert sur une note (heartbeat) OU config ouverte (tick).
5. D1 : ouvrir/fermer l'overlay plusieurs fois → UN seul battement dans
   logcat (plus de doublons).
6. A2 : passer un fichier Off avec un job pending → « Check batch
   results » → log `paid results DROPPED`.
7. E1 : Sync now sur une note à N « to sync » → le cadre tombe à 0 sans
   « Check all ».
8. Store shardé : `loaded: N doc(s) from N shard(s)` + la ligne
   `[SmartNoteAI.guide] seeded 8 guide page(s)`.

### Restants de l'audit (mineurs, non traités ici)
Voir mémoire `smartnoteai-audit-2026-07-19` — mineurs + décisions
design en attente (stabilité du préfixe cache agents, re-soumission PDF
silencieuse si docHash absent, backfill hash au submit, asymétries
d'affichage par ligne).

## v0.59.0 (2026-07-19) — UNIFICATION : le CHAT standard = l'agent par défaut

Décision user : "toute la config du CHAT standard dupliquée dans les
agents (quick actions, answer styles) → architecture unique, le chat
standard n'est qu'un agent par défaut sans contexte ; regrouper les
pages CHAT et AGENTS (structure de la page Agent, zones collapsibles)".

**Cœur** :
- `Agent` gagne `answerStyle?` et `quickActions?` — ABSENT = hérite des
  défauts CHAT (settings.answerStyle / settings.quickActions) : les
  agents existants ne changent pas de comportement, "customiser" est un
  acte explicite. `sanitizeQuickActions` extrait dans quickActions.ts,
  partagé settings/agents (garbage → absent, jamais de crash).
- ChatPanel : température = `agent?.answerStyle ?? défaut` ; rangée
  quick actions = `activeAgent?.quickActions ?? défauts`.

**Écran unifié `ChatAgentsScreen.tsx`** (remplace ChatConfigScreen +
AgentsScreen, supprimés) : porte "3 · CHAT & AGENTS" (l'ancienne porte 4
disparaît ; route 'agents' = alias vers le même écran). Liste "Your
assistants (n+1/5)" : 1ʳᵉ ligne fixe "💬 CHAT (default) · model" puis
les agents, "+ New agent". Édition par ZONES repliables (▸/▾ + résumé
grisé quand repliée ; tout se replie au changement de sélection) :
- défaut : Persona / Model & tools (texte Tools fusionné dedans) /
  Answer style / Quick actions — champs App inchangés (save débouncé) ;
- agent : Name & icon / Persona / Model / Answer style (chips Default+3,
  Default = hérite) / Quick actions ("uses CHAT defaults" + "Customize
  for this agent" = copie des défauts ; sinon éditeur complet + "Reset
  to CHAT quick actions") / Context documents & cost (arbre + pédagogie
  coût fusionnés) ; Delete en bas. Un champ = UN writer inchangé
  (agents auto-persistés "✓ saved", défauts via App).

**Fixes du self-audit v0.58 embarqués** :
- M1 : `App.load()` setters INCONDITIONNELS avec défauts (persona,
  scales, toolbarSide, model — `prev || m` supprimé) → l'Import est un
  vrai "replace all".
- M2 : `getPluginDirPath` retenté 3× (settings + store). Settings : si
  toujours en échec, session READ-ONLY (écritures refusées, warn — plus
  JAMAIS d'écriture /sdcard, ni du split "load vide fallback → write
  état vide sur le vrai fichier"). Store : fallback CACHÉ (cohérence
  load/persist d'une session) + warn.
- m3 : `readSettings()` rend une copie PROFONDE (une mutation en place
  chez un lecteur ne peut plus corrompre le singleton).

UI-TEXTS : H16/H22, section A refondue (A27-A30), AG11-AG13. 298 tests
(sanitize overrides + M2 guard), tsc/eslint 0 nouveau.
Test device : porte 3 unique ; ligne CHAT default éditable par zones ;
créer un agent → overrides style/QA → la conversation de l'agent montre
SES quick actions et son style ; agents existants inchangés ; Import
d'un fichier partiel remet bien les défauts partout.

## v0.58.0 (2026-07-19) — settings SINGLETON privé + les 6 critiques de l'audit

Réponse à l'incident du 18/07 (conflit de sync Supernote → settings.json
vidé → merge-sur-vide → schemaV absent → clearStoreFile = TOUS les
transcripts payés perdus) + au batch d'audit C1-C6. Décisions user :
singleton pleine-écriture, config hors du chemin de sync, import/export
volontaires, version du store portée par le store.

**Architecture settings (settings.ts RÉÉCRIT)** :
- AUTORITÉ = `<pluginDir>/settings.json` (+ `.bak`) — dossier PRIVÉ,
  jamais synchronisé, survit aux réinstalls (même maison que le store
  shardé). MyStyle n'est plus JAMAIS lu/écrit en continu.
- SINGLETON en mémoire, chargé UNE fois par session ; lecteurs servis en
  copie ; écrivains = `updateSettings(patch)` qui patch l'état et
  sérialise l'état COMPLET. Plus AUCUN read-merge-write disque : une
  lecture vide/périmée ne peut plus être promue vérité. Écritures
  sérialisées par une file interne (rafales de frappe OK).
- Boot : settings.json → sinon `.bak` → sinon MIGRATION UNIQUE de
  l'ancien MyStyle/settings.json (write-through privé ; l'ancien fichier
  n'est plus jamais relu, ni supprimé — il appartient au user).
- Export/Import (KeyAppScreen, section "Settings backup", K22-K26) :
  Export = copie JSON lisible (pretty) vers
  `MyStyle/Plugins/SmartNoteAI/smartnoteai-settings.json` (backup cloud
  gratuit + édition à la main + transfert Manta→A5X). Import (tap armé)
  = REMPLACEMENT total après sanitize, résumé des champs affiché, puis
  `load()`. La clé API n'est pas dans Settings → jamais exportée.
- Writers migrés : App (effet débouncé → `updateSettings` des champs
  qu'il possède, plus de readSettings avant write), AgentsScreen
  (`updateSettings({agents})`, garde "✓ saved"/log), LibraryScreen
  (`updateSettings({lastCheckAllAt})`). Un champ = UN writer, inchangé.

**C3 — le store se versionne LUI-MÊME** : `contentV: 32` dans l'index
du store (transcriptStoreIo). Fresh start UNIQUEMENT si l'index porte
explicitement un contentV DIFFÉRENT ; index pré-v0.58 sans le champ =
adopté tel quel (pas de wipe) et stampé au persist suivant. App.tsx ne
wipe plus JAMAIS le store sur l'état des settings (le bloc schemaV →
clearStoreFile est SUPPRIMÉ ; SETTINGS_SCHEMA ne versionne plus que le
fichier settings).

**C2 — verrou de persistance** : persistNow sérialisé par chaîne de
promesses (timer débouncé, flushStore, clearStoreFile rejoignent la même
file) — le diff de suppression d'un run ne peut plus effacer le shard
qu'un run concurrent vient d'écrire. Test dédié (flush pendant persist
en cours → attend).

**C1 — wipe Off scopé** : ReadOutcome.storedPages désormais renseigné
par readNotePages AUSSI (pages réellement écrites ce run) ; le finally
de gatherContext wipe EXACTEMENT `storedPages ?? []` — plus jamais la
sélection de contexte entière (qui détruisait du payé/édité-main jamais
relu). Exception avant retour = wipe RIEN (ne jamais deviner).

**C4 — docHash PDF** : readPdf ne stampe plus docHash à 0 page parsée
(jumeau live du fix batch v0.44) — le doc re-tentera au lieu de passer
"couvert" à vide.

**C5 — pages blanches en batch** : parseChatBatchResults garde les
lignes 200 à contenu VIDE (verdict "page blanche", plus un drop) ; le
collect wave-2 les stocke en entrée VIDE stampée hash+rev (le cache
négatif que le live écrit depuis v0.44) sauf si la wave-1 OCR avait du
texte. Le Sync suivant voit la page couverte → plus de re-facturation
infinie des pages blanches.

**C6 — éditions manuelles flushées** : upsertTranscript flushe le store
IMMÉDIATEMENT quand source === 'user' (panel Edit-Save + Library) — la
4ᵉ occurrence du pattern timers-gelés, réglée dans l'écrivain unique.

Tests : 296 (settings.test.ts NOUVEAU — 10 tests dont le test-incident
"disque vidé sous nos pieds → l'écriture d'un champ garde tout" ;
contentV ×2 ; verrou C2 ; parseur C5). tsc 0, eslint 0 nouveau warning.
Test device : 1) réglages/agents intacts après ce déploiement (migration
auto depuis MyStyle) ; 2) Export → fichier visible dans MyStyle ;
3) éditer le fichier → Import → résumé + état appliqué ; 4) page blanche
dans un Sync batch → plus re-soumise au Sync suivant ; 5) Edit-Save d'un
transcript puis fermeture immédiate → édition conservée.

## v0.57.0 (2026-07-19) — persistance des agents REFONDUE : un seul writer, immédiat, VISIBLE

4ᵉ échec device de la chaîne "setAgents → state App → effet débouncé →
write" (fichier réel : l'agent par défaut sauvé, AUCUNE édition —
"Agent 1 · 0 p" au lieu d'"Agent Joke · 5 p"). Le code source de la
chaîne est correct à la relecture (deps, payload, flushes v0.56.x) mais
elle échoue sur device pour une raison que les logs n'attrapaient pas.
DÉCISION : on ne raffine plus une mécanique inobservable, on la
SUPPRIME pour les agents :
- **AgentsScreen se persiste LUI-MÊME, immédiatement, à chaque
  modification** (upd/add/delete → `apply()` → setAgents pour
  l'affichage + `persistAgents()` = read-merge-write direct de
  settings.json — le pattern EXACT de lastCheckAllAt, le seul writer
  PROUVÉ sur ce device). File d'écritures sérialisée (pas de
  réordonnancement en rafale de frappe), ZÉRO timer.
- **App n'écrit plus JAMAIS le champ agents** (retiré du payload et des
  deps de l'effet débouncé ; `...cur` le fait transiter intact). Un
  seul writer = plus aucun scénario d'écrasement par une copie périmée.
- **Feedback VISIBLE** : l'écran affiche "✓ saved HH:MM:SS" après
  chaque écriture (ou "⚠ SAVE FAILED …") + log
  `[SmartNoteAI.agents] saved N agent(s): Nom(x docs), …` à chaque
  write — si ça re-échoue, le logcat dira exactement quoi.
Les flushes v0.56.x restent pour les AUTRES champs (persona/model/…).
Test device : éditer nom+persona+docs → voir "✓ saved" changer à
chaque frappe → sortir/revenir → tout est là → carte de départ =
"<icône> <nom> · N p". 281 tests, tsc/eslint 0.

## v0.56.1 (2026-07-19) — la VRAIE racine des settings perdus : timers gelés

Retour device 0.56.0 : la carte montre ENFIN un agent, mais sans le nom/
persona/docs édités — seule la création par défaut avait été sauvée.
VRAIE racine (plus profonde que le cleanup v0.56.0) : le save débouncé
500 ms est un TIMER JS, et RN GÈLE les timers quand la vue du plugin
passe en arrière-plan (la découverte heartbeat v0.53 appliquée aux
settings). "Éditer → ✕ dans les 500 ms" = timer congelé, write jamais
exécuté ; pire, le timer zombie peut se réveiller au foreground suivant
avec une closure périmée et ÉCRASER du plus récent. Fix :
- `flushSettings()` appelé à CHAQUE sortie : bouton ← des sous-écrans,
  ✕ de fermeture (attend le write AVANT closePluginView), Assistant
  (déjà en 0.56.0), démontage.
- GARDE DE GÉNÉRATION : chaque run de l'effet bump `saveGenRef` ; un
  doSave d'une génération antérieure devient no-op (tue le zombie).
RÈGLE DURABLE (3ᵉ occurrence du pattern) : dans ce plugin, AUCUN timer
JS ne doit porter une écriture critique — flush explicite aux sorties,
ou Handler natif. À vérifier device : créer/éditer un agent, sortir par
← puis ✕, rouvrir → nom/persona/docs intacts dans la config ET sur la
carte de départ.

## v0.56.0 (2026-07-19) — STORE SHARDÉ + LE bug "aucun agent dans la fenêtre" TUÉ

**Le bug agents (rapport user furieux, à raison) : les settings modifiés
dans la config pouvaient NE JAMAIS être écrits.** Preuve device :
settings.json contenait `"agents": []` pendant que l'écran config
affichait l'agent. Cause : le save est débouncé 500 ms ; « créer
l'agent → taper Assistant » ferme la config ~250 ms après → le cleanup
de l'effet TUAIT le timer → écriture perdue. Trou antérieur aux agents
(tout réglage édité <500 ms avant fermeture se perdait) — les agents
l'ont rendu systématique car le flux naturel est créer-puis-tester.
Fix triple : (1) flush du save en attente au démontage de App ;
(2) `openAssistant` ATTEND le flush AVANT d'ouvrir l'overlay (le
panneau lit settings.json pour sa carte — plus de course) ; (3) le
panneau relisait déjà les settings à chaque affichage de carte
(v0.55.1). L'agent créé par l'user dans la session courante était en
état mémoire uniquement : IL DOIT LE RECRÉER UNE FOIS après install.

## Architecture : STORE SHARDÉ (GO user "ok go, code")

Fin du JSON monolithique. Nouveau layout (dir privé, jamais MyStyle) :
- `transcripts/index.json` (+.bak) = POINT DE COMMIT minuscule : liste
  des shards + globalConsent. Écrit à chaque persist.
- `transcripts/docs/<fnv1a32(path)>-<basename>.json` = UN fichier par
  document ({v:2, path, doc}) ; le path INTERNE fait foi à la lecture
  (garde anti-collision). writeFileBase64 étant atomique (v0.44), un
  shard corrompu coûte UN doc (relu plus tard), jamais la bibliothèque.
- MODÈLE MÉMOIRE INCHANGÉ : le singleton Store est reconstruit des
  shards au chargement (lectures parallèles) ; les helpers purs, la
  recherche, les compteurs, l'UI : zéro modification.
- ÉCRITURES : seuls les shards TOUCHÉS. Tracking côté core
  (`markDocTouched`/`takeTouchedDocs`, alimenté par docOf — l'entonnoir
  de tous les writers — + marques explicites : touchDoc, remapDocPages,
  removePages, backfill de revs de reading.ts). **INVARIANT à respecter
  pour tout futur writer : passer par docOf OU marquer explicitement.**
  Suppressions par DIFF (lastPaths vs store) → delete du shard. Échec
  d'écriture → re-marqué, retenté au persist suivant. Ordre crash-safe :
  shards d'abord, index en dernier (commit).
- MIGRATION legacy : store.json (+ récup .bak) lu une fois → tous les
  docs marqués → premier persist écrit shards + index → SEULEMENT après
  ce commit, store.json/.bak supprimés. Logs : "loaded: N doc(s)
  (legacy v1 — migrating to shards)" puis "legacy v1 store migrated to
  N shard(s)".
- parseStore refactoré : `sanitizeDocEntry` extrait (mêmes règles pour
  un shard seul et le legacy). Backstop anti-emballement 200 MB conservé
  (somme des tailles de shards, chemin pathologique uniquement).
281 tests (13 nouveaux IO : load shardé, récup index.bak, migration,
touched-only, diff de suppression, retry, clear). tsc/eslint 0 erreur.
Déployé v0.56.0 (0.55.2 purgée). À VÉRIFIER device au premier lancement:
les deux logs de migration, puis au fil de l'usage l'absence de
réécritures massives (une lecture de page = ~2 Ko écrits).

## v0.55.2 (2026-07-19) — la limite de store SAUTE (décision user)

User : "on a 32 GB + SD, me soûle pas avec quelques Mo". Acté :
l'éviction LRU n'est PLUS une politique de gestion — le cap devient un
simple filet anti-emballement à 200 MB (~10 ans d'usage), jamais atteint
en vie normale : les transcriptions payées ne sont plus jamais
supprimées. Le "5 MB" de SPEC-v0.20 gardait les coûts du JSON
monolithique (parse complet au chargement, sérialisation complète à
chaque persist, via le bridge), pas le disque. Au passage : le persist
ne sérialise plus qu'UNE fois (l'ancien code sérialisait dans
evictToFit pour mesurer PUIS pour écrire — à chaque persist). Si un
jour le chargement devient lent à quelques dizaines de Mo, la vraie
solution est le SHARDING par doc (backlog), pas la suppression. La
protection user-edits + pinning agents reste dans evictToFit pour le
cas pathologique. Les docs évincés par l'ancien cap 4,5 MB restent
perdus — ils seront relus au prochain Sync (une fois).

## v0.55.1 (2026-07-19) — AUDIT (2 agents) + retours device + mystère "120 to sync" RÉSOLU

**Le mystère "120 pages to sync" après un Sync batch (19 p + PDF 291 p
déjà lu), résolu par l'audit** : ÉVICTION LRU SILENCIEUSE. Le store
était en butée du cap 4,5 MB (PDF 291 p transcrit + ~110 docs) ; chaque
persist (submit/collect écrivent !) évincait des docs Manual ENTIERS
déjà payés ; le sweep session v0.51 ressuscitait leurs totaux en
"to sync" (~120) avec des minutes de délai. Après réinstallation les
caches session (pageCounts/manualStale, module-level) sont vidés → "0
to sync" = SOUS-comptage trompeur, pas une guérison. Les transcriptions
évincées sont PERDUES (re-facturées au prochain Sync). H1-H4 (docHash
PDF, resoumission, expiry vague-2, ventilation pendingSets) toutes
infirmées par le code — la ventilation elle-même est correcte.
**Mitigation d'urgence livrée** : cap 4,5 → 10 MB (le "5 MB" venait de
SPEC-v0.20, pas de la plateforme) + éviction en console.warn AVEC LES
NOMS des docs perdus. **DÉCISION USER EN ATTENTE** : politique
définitive (avertissement UI quand le store approche du cap ? nettoyage
utilisateur ? cap plus haut ?). Vérif device : logcat
"⚠ LRU cap … evicted N PAID doc(s): …" et la ligne "loaded: N doc(s)".

**Retours device v0.55.0 corrigés** :
1. La carte de départ n'offrait AUCUN agent : la fenêtre overlay
   survit statiquement à une visite config, les agents étaient lus au
   seul montage. Fix : re-lecture settings à chaque affichage de la
   carte + send() résout l'agent dans les settings FRAIS.
2. Icône d'agent : le clavier Supernote n'a pas d'emoji → GRILLE de 16
   icônes prédéfinies (remplace le champ libre ; AG4).

**Audit général v0.54→v0.55 (2ᵉ agent), corrigés ici** : #1 blocs Added
dupliqués après un send ÉCHOUÉ (le turn reste dans l'historique local et
repart — marquage sent même sur échec) ; #2 onNewChat gardait sur le
state busy périmé (→ busyRef, même fix que send/onResume) ; #3 flag
sent posé sans bloc réellement composé (doc évincé → "in CHAT" menteur ;
désormais sent SEULEMENT si le texte est parti) ; #5 stats/gaps agent
comptaient les docs Off (euros surestimés) ; #6 AgentsScreen sans garde
pdfCovered (backlog fantôme PDF en config) ; #7 un hit META lu via
Read & add re-proposait le bouton payant (l'état added prime) ; #8
scheduler démarré avant les refs de pinning (réordonné).
**NON corrigés (décisions/design, à trancher)** : #4 stabilité du
préfixe cache agent (la section docs est recomposée du store à chaque
send : tout tick Auto/nouvelle lecture d'un doc épinglé casse le cache
−90 % promis ; options : figer par conversation vs accepter ; + la page
courante d'un doc d'agent part en double system+user turn) ; agent-audit
comptage #3 (re-soumission silencieuse d'un PDF entier quand docHash
absent/évincé — confirmation coût ?) ; #4 (hash '' au submit si
readPageIds échoue → une re-facturation au Sync suivant ; backfill du
hash possible) ; #5/#6 (asymétries mineures d'affichage par ligne).
277 tests, tsc/eslint 0 erreur. Déployé v0.55.1 (0.55.0 purgée).

## v0.55.0 (2026-07-19) — AI AGENTS (L3 de la spec refonte, toutes décisions user actées)

Un agent = persona + docs de la bibliothèque + modèle, choisi au DÉBUT
d'une conversation (carte de départ). Max 4 (+ Chat standard = 5 choix).
- **Core pur** `src/core/agents/agents.ts` (10 tests) : sanitize,
  `isUnderDocRef` (folders VIVANTS : préfixe sur frontière '/', une note
  créée plus tard dans le dossier est incluse), `resolveAgentDocs` (trié
  → préfixe system DÉTERMINISTE), `composeAgentDocsSection` (blocs
  `--- Agent doc: "<name>" p.N ---` triés par (path, page)),
  `estimateAgentCost` (tokens=chars/4 ; 1er msg au prix input, suivants
  à 10 %). Prix numériques `inEurPerM` ajoutés au catalogue (statiques
  07/2026) ; id custom → tokens seulement.
- **Pinning LRU DUR** : `evictToFit(store, max, isPinned)` épargne les
  docs d'agents même en dernier recours (+ test) ; refs poussées via
  `setPinnedDocRefs` (transcriptStoreIo) par index.js au démarrage (le
  scheduler background évince sans UI !), App.load et AgentsScreen.
- **Écran config "4 · AGENTS"** (AgentsScreen, porte home + box module
  passée en noir) : liste (4 max), éditeur nom/icône/persona/modèle
  (chips + champ libre + ligne live via le hook PARTAGÉ
  `src/ui/useModelInfo.ts` — extrait de ChatConfigScreen, déplacement
  verbatim), sélecteur de docs par dossiers/docs cochables (Off =
  "excluded", via-dossier = implicite grisé), **pédagogie du coût ICI**
  ("~Nk tokens → 1st msg ~a c€ · next ~b c€ · less context = cheaper" +
  ⚠ >100k tokens), Delete armé ("conversations are kept").
- **ChatPanel** : CARTE DE DÉPART dans l'état vide (seulement si ≥1
  agent — zéro régression sinon) : 💬 Chat + agents avec "model · N p
  [· M not synced]", sélection AVANT le 1er message, New chat y ramène.
  **Dialog GAPS à la sélection** (pages non lues → "Read now ≈ X € /
  Chat with what's read / Cancel", lecture avec progression + ⏹, gardes
  batch-pending + Off). **send()** : persona de l'agent + docs dans le
  SYSTEM (préfixe stable → cache −90 % dès le 2ᵉ message), modèle de
  l'agent prioritaire (capacité tools suivie sur le modèle EFFECTIF).
  Ligne statut = "${icon} ${name} · model · N p" EN NOIR à la place du
  modèle standard (décision user) ; agent supprimé → "∅ deleted agent →
  standard Chat" (la conversation continue en standard, tag conservé).
  `agentId` persisté (index + conversation, sanitisé) ; history rows
  préfixées de l'icône ("∅" si supprimé).
277 tests / 29 suites, tsc/eslint 0 erreur. UI-TEXTS : section AG
nouvelle, P64-P67, H9/H22. Déployé smartnoteai — v0.55.0 (0.54.1
purgée). **À tester device** : créer un agent (dossier + persona),
carte de départ, gaps dialog, ligne agent, cache −90 % dès le 2ᵉ
message (usage line), history taguée, delete agent → conversation
rouvre en standard. Watchlists actives : rev batch 1ʳᵉ question
(v0.54.1 #1) et logs "snapshot MISS/NOT cached" (v0.54.1 #2).

## v0.54.1 (2026-07-19) — retours device fournée 1 sur la refonte (3 points user)

Analyse du log du premier test user (page en contexte + recherche + add +
"summarize" → "assez long" + un OCR inattendu) :
1. **L'OCR** : UNE page relue (p.91 Egypt_2, la page COURANTE — le flux
   "Add to CHAT" ne lit jamais, texte du store). Cause identifiée : le
   `saveCurrentNote` du flux de lecture BOUGE le footer, et Egypt_2 est
   couverte par BATCH → entrées tamponnées avec des adresses pré-flush →
   1ʳᵉ question live sur une page batch = rev différent = "éditée" =
   relecture (~0,4 c€). **WATCHLIST (user : "on verra si systématique")** :
   prédiction = une fois par page batch à sa première question live, PAS
   à chaque send (la relecture re-tamponne post-flush). Test : reposer
   une question sur la même page → PAS de nouvel OCR. Si ça relit → bug
   plus profond à corriger (décision user déjà donnée).
2. **PERF (corrigé)** : 3 marches complètes d'Egypt_2 (106 p, ~9,3 s
   CHACUNE) avant la lecture. (a) Le flush vivait DANS readNotePages,
   APRÈS la marche de la garde d'estimation → footer bougé → tout le
   monde re-marchait. Fix : `gatherContext` flushe UNE fois en tête de
   send ; la marche d'estimation décrit déjà le fichier post-flush, le
   cache vérifié-par-contenu sert le reste (le save de readNotePages
   devient no-op). (b) La 3ᵉ marche = probable FENCE du cache (une
   invalidation pendant une marche jette le résultat) — DIAGNOSTIC posé :
   logs "snapshot MISS (cold|ttl-expired|footer-changed)" et "snapshot
   NOT cached (invalidated during walk)". Le prochain test device dira
   qui invalide.
3. **"Add to CHAT" persistant (décision user, remplace le sent-once)** :
   les pages ajoutées restent LISTÉES toute la conversation. `pendingCtx`
   garde un flag `sent` : non envoyée = bloc composé au prochain send +
   ✕ retirable ; envoyée = marquée `sent`, affichée "in CHAT" (sheet) /
   "✓ in CHAT" (overlay, non-retoggleable — elle vit dans l'historique,
   re-envoyée cachée −90 %, jamais recomposée). Off à l'envoi = DROP de
   l'entrée (log). Le "+N" de la ligne contexte compte TOUT (envoyées
   incluses). Bouton renommé "+ ctx" → **"Add to CHAT"** (user).
267 tests verts (mock deps.saveCurrentNote ajouté), tsc/eslint 0 erreur.
UI-TEXTS S5/S10/P61 réécrits. Déployé smartnoteai — v0.54.1 (0.54.0
purgée). À observer au prochain test : les logs snapshot MISS/NOT cached
pendant un send, et la watchlist du point 1.
>
> ⚠ The per-version log below is complete up to **v0.23.0** only; v0.24→v0.34
> lived in the git log (see especially the giant v0.34.0 commit message,
> which bundles the v0.25→v0.34 redesign: single Smart engine, Off/Manual/
> Auto modes, everything batched via /v1/ocr). Latest entries:

## v0.54.0 (2026-07-19) — REFONTE PANNEAU : saisie unifiée + add-to-context (session parallèle, spec artefact)

Conçue/spécifiée dans une AUTRE session (artefact claude.ai avec maquettes,
décisions user actées) et livrée en 2 PR GitHub mergées (#1 #2, unités de
revert) + ce commit release. AUCUN chemin payant modifié hors "Read & add".
- **UN champ, deux sorties** : tabs Chat/Search SUPPRIMÉS. 🔍 à gauche du
  champ ARME la recherche locale (live par frappe, SANS debounce — les
  timers JS sont en pause sous le panneau, cf. heartbeat v0.53 ; hook
  partagé src/ui/useSmartSearch.ts, SearchControls/Library inchangés) ;
  send = sortie IA (désarme). Placeholder "Search notes 🔍 · Ask AI".
- **SearchOverlay.tsx** (remplace SearchPanel.tsx) : hint grammaire au
  repos, ligne d'interprétation, par hit Transcript / Go to page › /
  **"+ ctx"↔"✓ added" MULTI-sélection** ; fichier Off → badge "Off"
  (gate) ; hit META non lu → **"Read & add"** (confirm armée ~0,4 c€,
  garde batch-pending, readNotePages 1 page).
- **Add to context** : pendingCtx par conversation (persisté
  SavedConversation.pendingCtx, sanitisé au load ; New chat vide, Resume
  restaure) ; envoi = blocs `--- Added: "<note>" p.N ---` APRÈS le
  contexte page (compose.composeAddedText, gratuit depuis le store),
  **sent-once** : consommés sur succès (les ajouts pendant un envoi en
  vol survivent) ; Off RE-vérifié à l'envoi ; dédup vs pages du contexte
  page ; stripPageText généralisé → compose.stripContextBlocks (testé).
  Une ligne ajoutée au DEFAULT_SYSTEM (blocs "Added" = contexte en plus).
- **Chrome 6-7 lignes → 3** : ligne contexte unique tappable
  "📄 note · p.X/Y [+N] ▾ [•]" (• = partira au prochain message ; scope
  résumé : p.3/12, p.3–7/12, all 12 p) → SHEET CONTEXTE (chips scope +
  range, chip provenance → fiche Transcript, born-on/état, ⟳ Refresh
  capture, liste "Added from search" retirable ✕ avant envoi). ⚡ →
  sheet quick actions + chips inline dans la conversation vide.
  VIGNETTE SUPPRIMÉE (aperçu de la page déjà visible derrière ; ses
  generateNotePng affamaient le device, épisode v0.42.1). Header 9→5
  icônes (5 snaps derrière popover ▾). Ligne statut fusionnée
  "${model} [→ resolved] · last: N in (M cached −90%) · K out" — la clé
  masquée a quitté le panneau (décision user).
- **Bouton send = M Mistral** monochrome officiel (assets/
  ic-mistral-{white,black}.png, ~2,6 KB ; usage référentiel — le bouton
  envoie littéralement à Mistral ; variante noire embarquée pour plus
  tard).
267 tests (7 nouveaux compose), tsc/eslint 0 erreur. UI-TEXTS resync
(P3/P5/P8 supprimés, P4/P9/P24/P26 réécrits, P59-P63 + S10-S13 neufs).
**À tester device** : (1) armer 🔍, requête, +ctx ×2, question → blocs
"--- Added ---" dans la fiche + "+2" qui se draine ; (2) Read & add sur
un hit ★ non lu ; (3) rendu e-ink des glyphes 🔍/📄/⚡ (si pâté noir
comme 🌐 v0.52 → fallbacks texte "Search"/"Doc"/"Actions" prêts, cf.
UI-TEXTS P59/P62) ; (4) sheet contexte (scope/range/Refresh) ; (5)
popover snaps ; (6) logo M sur send (rendu + disabled).
**SUITE SPÉCIFIÉE (attend GO)** : L3 Agents — persona + docs + modèle
par agent, carte de départ dans l'état vide, agent lié à la conversation
(agentId), docs dans le SYSTEM (préfixe stable → cache −90 %), écran
config avec estimation de coût, pinning LRU. Décisions user actées :
4 agents max (+Chat), pinning dur + compteur, héritage Web/Calc,
folders vivants, sélecteur d'arbre dédié simple, prix numériques
presets (custom → tokens only), conversations d'agent supprimé taguées.
Spec complète : artefact "SPEC Agents + refonte CHAT" (session design).

## v0.53.2 (2026-07-19) — Sync batch : skip par tampon (question user "il re-analyse tout ?")

Reponse donnee : oui, passe GRATUITE par design (0 centime pour une note
a jour) mais IO par note. Sur GO : runPretranscript adopte le skip du
tick (v0.47/v0.52) — note tamponnee + footer identique + store non
contradictoire ⇒ skip en ~3 lectures (log "unchanged (stamp) → skip").
ET il POSE le tampon quand pagesNeedingRead revient vide (avant filtre
pending) : les notes couvertes PAR BATCH etaient stampless et
re-marchaient a chaque Sync. "Sync now" avait deja tout ca (confirme a
l'user). 260 tests, tsc/eslint 0. Deployee smartnoteai-0.53.2.snplg
(0.53.1 purgee). Premier batch de session = encore lent (caches froids),
les suivants rapides.

## v0.53.1 (2026-07-19) — colonnes du cadre : folders · notes + PDFs · pages

Suite du "64 vs 73" : VÉRIFIÉ sur le device (settings.json + find) —
73 Manual = 64 .note + 9/10 PDF (7 dossiers cibles ; 1 PDF d'écart
disque-vs-compteur à surveiller, sans doute pas encore vu par la marche
de session). L'explication v0.53 ("exclut les Auto") était FAUSSE et
corrigée auprès de l'user. Sur son GO, la 1re ligne des TROIS colonnes
adopte le format unifié : `N folder(s) · N note(s) + N PDF(s) · P pages
tracked` (foldersOf via isAutoFolderKey; parties nulles omises) — le
"Checking Manual notes i/64" devient auto-explicatif. 260 tests,
tsc/eslint 0. Déployée smartnoteai-0.53.1.snplg (0.53.0 purgée).

## v0.53.0 (2026-07-18/19) — retours device fournée 3 (10 points user)

1. **Page Manual ÉDITÉE invisible** (Bids topics p.4) : une édition en
   place garde son entrée → les compteurs structurels (total−entrées)
   disaient 0. Fix : `manualStale` (autoTranscript, GRATUIT :
   pagesNeedingRead = comparaison de revs) alimenté par la passe
   background freeOnly ET par Check-all ; le cadre + les lignes de
   fichiers l'utilisent en priorité. Le "64" vs 73 : Check-all = notes
   MANUAL .note seulement (Auto s'auto-vérifie, PDF via docHash) →
   libellé "Checking Manual notes i/n…". Test caractérisation mis à jour
   (background appelle needMock mais PAS readMock).
2. Ligne Auto : "last check <datetime>" (fmtDateTime, plus fmtHm).
3. Seed de l'arbre : NIVEAU 2 (racines dépliées seulement — revirement
   user, 3 c'était trop).
4. SD montée confirmée par l'user ✓ (plan B validé).
5. **Contexte qui ne suit toujours pas** (repro 2) : VRAIE cause — RN
   PAUSE les timers JS quand l'activité hôte est en arrière-plan =
   exactement la situation panneau flottant sur la note (même racine que
   le bug debounce recherche v0.25.4). Fix : HEARTBEAT NATIF (Handler
   main-looper, 2,5 s, start/stop avec l'overlay) → event
   "SmartNoteAiHeartbeat" → pollOnce ; setInterval gardé en ceinture.
6+8. Rotation : libellés explicites + LES 2 SENS ("↻ Rotate the page
   right and redo AI transcript" / "↺ ... left ...", 90/270) — vue page
   ET fiche du panneau. User : résultat "excellent et impressionnant"
   sur Egypt_3 p.9 (le modèle a même interprété "9 locos fleet install").
7. Fiche Transcript : datetime complet (heure) sur la provenance.
9. Recherche LIBRARY : duo "Transcript"/"Go to page ›" par résultat
   (Go ferme la config — plein écran — via goToNotePage existant).
10. Export sélection : "4/106 pages" (docTotal passé aux composers),
   plus jamais "4/4".
260 tests, tsc/eslint 0. Markers dex (SmartNoteAiHeartbeat) + bundle
vérifiés. Déployée smartnoteai-0.53.0.snplg (0.52.0 purgée).
À tester : le heartbeat (tourner des pages panneau ouvert SANS toucher
le panneau → contexte suit en ~2,5 s), l'édition d'une page Manual qui
apparaît en "to sync" après un tour de page ou un Check-all.

## v0.52.0 (2026-07-18) — BUILDÉE ET DÉPLOYÉE (fin de session marathon)

La v0.52.0/135 emballe TOUT le lot ci-dessous + la 2e fournée (points 4-7
user) + les 2 derniers GO :
- **Rotation** (page 9 Egypt_3 : timeline écrite en travers → transcript
  halluciné) : (a) clé <ORIENTATION:1090> du .note harvestée dans la
  marche existante (gratuit) → pages en mode paysage device auto-pivotées
  90° avant lecture ; (b) bouton manuel "↻ Redo rotated" (vue page
  Library + fiche Transcript du panneau) → rendu pivoté 90° (nouveau
  Kotlin rotatePng, in place) puis relecture forcée. NB vérifié sur le
  fichier : ORIENTATION reflète le MODE paysage, pas l'écriture tournée à
  la main (page 9 = 1000) → d'où le bouton manuel.
- **Search → duo par résultat** : "Transcript" / "Go to page ›" ; la
  navigation NE FERME PLUS le panneau (v0.37.2 annulée : le problème
  était la taille plein écran) — bascule vue Chat + snap default, le
  poll self-healing suit la page cible.
- Markers vérifiés dans le dex (listStorageVolumes, rotatePng,
  tmp-write) ET le bundle (Redo rotated, chat stays open, Web/Calc,
  Mistral Description, currently points to, last check, Transcript
  source…). :app:compileDebugKotlin recompilé (pas UP-TO-DATE).
260 tests / 30 suites, tsc/eslint 0. Déployée smartnoteai-0.52.0.snplg
(0.51.0 purgée local+device). UI-TEXTS 0.52.0/135, 285 IDs, 0 doublon.
À TESTER device en priorité : SD_Card dans l'arbre (logcat
"[SMARTPAPER_OVERLAY] storage volumes:"), "↻ Redo rotated" sur Egypt_3
p.9, Go to page sans fermeture, le cadre sync complet (phantom PDF
disparu, ✓ last check), exports (✓ + en-tête + propre), Web/Calc.

## Lot v0.52 (2026-07-18) — CODÉ, PAS BUILDÉ (user en session de tests, GO "code 1+2+3, pas de build")

Sept changements dans le working tree, tests 260/260, tsc/eslint 0 :
1. **Compteur PDF fantôme** ("2 pages to sync" du PDF Gérer les situations
   difficiles) : DocSummary.pdfCovered (docHash posé = doc entièrement lu ;
   les pages sans texte n'ont pas d'entrée PAR DESIGN). Cadre + lignes de
   fichiers. Rétroactif, zéro relecture. Test docsSummary.
2. **Statut du check DANS le cadre** : checkStatus local ("Checking i/n…")
   + "✓ last check <datetime>" persisté (settings.lastCheckAllAt, écrit
   direct par LibraryScreen ; la save débouncée d'App MERGE désormais sur
   le fichier disque pour ne pas l'écraser). Plus de msg global pour ça.
3. **Tampon revérifié côté store** : storePending (docsSummary) au début
   du tick ; stamp==sig MAIS store incomplet → re-check (log dédié). Le
   défaut "entrées perdues après tampon = invisibles à vie" devient
   auto-guérissant. Test ajouté.
4. **SD plan B** (la 0.51 ne voyait pas la carte : la vue /storage de
   PluginHost ne liste pas les volumes montés) : Kotlin
   listStorageVolumes (StorageManager API30+ + getExternalFilesDirs
   coupé à /Android/, primaire exclu, GÉNÉRIQUE) ; JS
   listStorageVolumesNative fusionné dans la découverte des racines.
   ⚠ NÉCESSITE LE BUILD KOTLIN au prochain déploiement.
5. **Export : ✓ de succès** sur LE bouton utilisé (exportDone key
   label|fmt, 6 s) — grid, sélection non (libellé propre), minis
   dossiers, Export all.
6. **Export : en-tête enrichi** : "Exported by SmartNote AI at <datetime>
   · x/y pages · Transcript source: <label(s)> at <datetime transcript le
   plus récent>" (agrégat par doc, labels SRC_LABEL joints par ' + ').
7. **Export PROPRE** : stripEmphasis (bold/italic inline retirés hors
   fences, structure gardée) sur le .md — le "gras des mots douteux" venait
   du MODÈLE (aucun code ne marque les low words dans le texte ; vérifié) ;
   les marques ne vivent que dans le plugin. Tests.
Points 4-7 reçus et CODÉS (même lot, toujours pas buildé) :
4. Chips one-shot en TEXTE "Web"/"Calc" (choix user W4+C5 via artifact —
   l'emoji 🌐 se rendait en pâté noir e-ink, ⚙ évoquait un réglage).
5. Écran CHAT : champ modèle à MI-LARGEUR, moitié droite = '"saisie"
   currently points to <id daté>' (+ dépréciation) ou unknown ; la desc
   fixe devient citation : petit italique 'Mistral Description : "…"'.
6. BUG confirmé par repro user (tourner les pages ne changeait pas le
   contexte, Refresh requis) : le poll marquait la page "vue" AVANT que
   la recapture aboutisse — un échec/stale bloquait tout retry. Fix :
   comparaison permanente à cap + retry au tick suivant (self-healing),
   poke Auto découplé (1×/page tournée).
7. Fiche Transcript : warning fichier Off ("No transcript available:
   sync is set to OFF… You can still ask the CHAT") + bouton grisé ;
   Improve SUPPRIMÉ (redondant depuis v0.38 : le Redo fait déjà
   OCR→vision avec hint) ; bouton unique "Redo AI transcript" aligné
   Library. UI-TEXTS resynchronisé (E/D24-D25/L49 + header). Prochaine
livraison = v0.52.0/135 avec build Kotlin.

## v0.51.0 (2026-07-18) — comptes de pages pour TOUTES les notes + racine SD_Card

Deux demandes user :
1. "Pourquoi toujours pas les nb de pages pour toutes les notes Off ?" —
   deux causes trouvees : (a) depuis le split v0.46, pageCounts/attempted
   etaient du state COMPOSANT → reset a chaque entree Library, la sweep
   repartait de zero ; (b) la sweep ne couvrait que treeCache = dossiers
   DEPLIES. Fix : pageCountCache/countAttempted au niveau MODULE
   (survivent aux visites) + fullWalk une fois par session (marche
   recursive pacee 50 ms/dossier de toutes les racines, reprise si
   interrompue) qui alimente la sweep — dossiers replies inclus.
2. Racine SD_Card : DECOUVERTE GENERIQUE (exigence user explicite: "pour
   TOUTES les cartes SD") — listDir('/storage') cote app, tout volume
   hors emulated/self devient une racine "SD_Card" (n. 2, 3 si
   plusieurs). RIEN de code en dur. TREE_ROOTS → state treeRoots
   (rootsCache module) branche sur : listing racines, seed 3 niveaux,
   Export all, treeRows, sweep. Verifie sur la Manta : carte montee
   public:179,97 — invisible pour adb (permissions shell), visible cote
   app (a confirmer au test device, log "[SmartNoteAI.lib] roots:").
UI-TEXTS: L49 ajoute, en-tete 0.51.0/134. 255 tests, tsc/eslint clean.
Deploye smartnoteai-0.51.0.snplg (0.50.0 purgee).
NOTE TEST DEVICE : verifier logcat "roots: Note, Document, SD_Card" a
l'entree Library; si la SD n'apparait pas, la vue /storage du process
PluginHost ne l'expose pas → plan B = lire les mounts (a investiguer).

## v0.50.0 (2026-07-18) — connecteurs ONE-SHOT par message (spec user validee)

Motivation (verifiee) : toggles sticky ON ⇒ TOUS les tours passaient par
Conversations (pas de prompt_cache_key) ⇒ la remise cache -90% sur le
prefixe etait perdue en permanence. Historique 100% client-side
(store:false) ⇒ basculer d'endpoint mid-conversation ne casse rien.
- ChatPanel : 2 chips one-shot 🌐/⚙ DANS la ligne d'input (a gauche du
  Send — layout serre, panneau redimensionnable ; alternative barre du
  haut proposee a l'user, non retenue par defaut). Arme = CE message part
  via Conversations ; reset a OFF apres l'envoi (succes OU echec, dans le
  finally du bloc HTTP — les early-returns des dialogs consent/estimate
  CONSERVENT l'armement). Grisage par capacite live function_calling
  (nouveau src/native/modelCaps.ts, 1 GET cache par session) + fallback
  statique modelLacksTools garde cote envoi.
- Sticky supprimes : settings.webSearch/codeInterpreter retires du type
  et du sanitize (migration douce : vieilles cles ignorees) ; etats/props
  retires de App et ChatConfigScreen ; la section Tools de la config est
  desormais explicative seulement.
- cached_tokens : deja affiches ("N in (M cached -90%)") — bonus #4
  etait couvert d'avance.
- Reset one-shot post-send : pas testable sans harnais de tests RN
  composant (note; le test buildBody cacheKey existant couvre le cote
  requete).
UI-TEXTS : A11 reecrit, A12/A13 supprimes, P55/P56 ajoutes ; en-tete
enfin bump (v0.50.0/133 — il etait reste a v0.46.0). 255 tests,
tsc/eslint 0 erreur. Deploye smartnoteai-0.50.0.snplg (0.49.0 purgee).

## v0.49.0 (2026-07-18) — picker final (choix user, données API live a l'appui)

Session live avec la cle API fournie par l'user (transitoire, jamais
stockee — LUI RAPPELER DE LA REVOQUER). Le dump /v1/models a revele :
magistral-small-latest EST mistral-small-2603 (fusion reasoning dans
Small 4), magistral-medium-2509 DEPRECATED au 2026-07-31 (remplacant
mistral-medium-3-5), Medium 3.5 passe OPEN WEIGHTS (Modified MIT — notre
etiquette "proprietary" etait perimee), champs API riches (deprecation,
deprecation_replacement_model, reasoning, default_model_temperature...).
Decisions user implementees :
- **Picker a 3** : les 2 chips Magistral SUPPRIMEES (doublon + mourant).
- Affichage par modele = note statique (openness + prix "as of 07/2026")
  + DESC FIXE fournie par l'user (Small 4 / Medium 3.5 / Large 3) + ligne
  live reduite a `→ id date` + `⚠ deprecated <date> → use <remplacant>`
  (context/vision/tools retires : identiques sur les 3; la capacite tools
  grise toujours les toggles; unknown-id check garde).
- **"Answer style"** (jamais le mot temperature) : chips Precise/Balanced/
  Creative → temperature 0.2 / rien (defaut du modele : 0.3 Small+Large,
  1.0 Medium !) / 0.9. settings.answerStyle, lu FRAIS a chaque send,
  passe dans buildBody ET completion_args (Conversations). Test buildBody.
UI-TEXTS: M4/M5 supprimes, M1-M3 notes+desc, A22 reduit+deprecation,
A24-A26 answer style, A11 sans Magistral. 255 tests, tsc/eslint clean.
Deploye smartnoteai-0.49.0.snplg (0.48.0 purgee).

## v0.48.0 (2026-07-18) — picker de modeles enrichi LIVE (schema valide user)

GO user sur le schema propose. Ecran CHAT :
- Ligne statique du modele + " · prices as of 07/2026" (l'API ne publie
  aucun prix; model cards docs.mistral.ai = HTML-only, verifie).
- LIGNE LIVE sous le modele choisi (GET /v1/models, le meme appel que la
  resolution -latest): "→ <id date resolu> · Nk context · vision ✓/✗ ·
  tools ✓/✗" + description officielle 1 ligne. Marche aussi pour un id
  tape dans le champ libre; id inconnu → "⚠ unknown model id". Absente
  hors-ligne (comportement inchange).
- Les toggles Web search/Code interpreter se grisent d'apres la capacite
  LIVE function_calling (fallback modelLacksTools hors-ligne). Phrase
  no-tools reecrite (ordre Small/Medium/Large).
- "Large 3" → "Large" (user: le "3" ne servait a rien — l'alias -latest
  rend la generation dynamique, la ligne live montre l'id date).
- ChatPanel garde le filtre statique modelLacksTools cote envoi
  (fallback OK, note backlog: le brancher sur la capacite live).
Refus user acte : PAS de Ministral dans le picker (champ libre suffit).
UI-TEXTS: M2, A6 (prix statiques), A22/A23 (ligne live + unknown id),
A11 (phrase no-tools). 254 tests, tsc/eslint 0 erreur. Deploye
smartnoteai-0.48.0.snplg (0.47.1 purgee).

## v0.47.1 (2026-07-18) — blocs Role/Fidelity .note|.pdf côte à côte

Demande user : les deux variantes d'un même bloc s'affichent maintenant
en 2 colonnes (editor() factorisé, blockPair flexDirection row). Répondu
au passage (voir la conversation) : les PRIX du picker sont STATIQUES
(catalog.ts — /v1/models n'expose aucun prix; les model cards docs.mistral.ai
sont HTML-only, pas d'API), l'API expose par contre capabilities/context/
description (enrichissement proposé, pas fait); le batch manuel EST déjà
2 vagues avec Ministral 14B en vague 2 (BATCH_VISION_MODEL=READER_MODEL);
Ministral absent du picker CHAT par curation (proposé en option; le champ
libre accepte déjà tout id). 254 tests, tsc/eslint clean. Déployé
smartnoteai-0.47.1.snplg (0.47.0 purgée).

## v0.47.0 (2026-07-18) — retours device session B : "Sync now" gelait le plugin

Premiers retours de la session de tests (A = GOOD; B = "Sync now" pour
2 pages → minutes, plugin entier gelé). Trois fixes, tous demandés/prouvés :
1. **"Sync now" ne re-marche plus toute la bibliothèque** (la cause du
   gel) : `force` contournait le skip par signature de footer
   (autoTranscript:308, filet v0.44) → cache invalidé + syncNotePages
   FORCÉ sur CHAQUE note Manual (des minutes de bridge IO, la note de
   104 p mesurée à 16-22 s). Séparation `force` (passe le gap 20 s) /
   `deepRecheck` (le re-check profond, réservé au bouton GRATUIT "Check
   all notes for changes", qui invalide + force désormais). Le sync
   ordinaire ne force la marche QUE si la signature a réellement bougé
   (`knownChanged`), sinon cache content-verified. Test caractérisation
   mis à jour (force+stamp inchangé ⇒ skip; deepRecheck ⇒ re-check).
   Bouton "Syncing… <note>" affiche la progression. C4 (LibraryScreen) :
   150 ms entre notes, annulé en sortant, UNE fois par session (module
   flag) — post-split il repartait à chaque entrée Library.
2. **Blocs "(.pdf only)" éditables** (demande user : "je n'ai aucun cadre
   .pdf only") : PDF_PROMPT_BLOCKS (pdfRole/pdfFidelity) rejoignent
   l'éditeur de l'écran READ avec tag "(.pdf only)" + Reset ; overrides
   dans le même promptBlocks map ; assemblePdfVisionPrompt les honore
   (test : l'override 'role' .note ne fuit PAS dans la variante PDF).
3. **Catalogue modèles** : ordre Small/Medium/Large 3/Magistral S/
   Magistral M, notes harmonisées "openness · tools · €/M · trait",
   Magistral S passe à `magistral-small-latest` (le -2509 était codé en
   dur). **Résolution -latest robuste** : l'API liste chaque nom (daté ET
   alias) comme entrée avec aliases croisés — le code prenait n'importe
   quel id et le dernier écrasait ("mistral-small-latest →
   magistral-small-latest" à l'écran). Désormais : cibles = ids DATÉS
   uniquement + garde de famille (l'alias ne résout que vers un id du
   même préfixe).
UI-TEXTS resynchronisé (M1-M5 réordonnés/notes, R5 tag .pdf only, L11
progression). 254 tests verts, tsc/eslint 0 erreur. Déployé
smartnoteai-0.47.0.snplg (0.46.0 purgée). Session de tests user EN COURS
(C batch 2 vagues, D gate Off, E chat, F export, G bulle restants).

## v0.46.0 (2026-07-18) — REFACTOR PHASE 4 (SPEC-REFACTOR-v0.36 §2), GO user

Réorganisation pure, ZÉRO changement de comportement voulu (+ 1 fix UI :
la ventilation Manual affiche "X up to date · Y at Mistral · Z to sync" —
les 22 pages "manquantes" du rapport user étaient le batch en vol).
- **App.tsx 3343 → 470 lignes** : routeur mince (settings load/save,
  keyState, autoTargets, msg, lib+refreshLib+abonnement store débouncé —
  gardés dans App car actifs sur tous les écrans) + screens/ :
  HomeScreen (223), KeyAppScreen (216), ReadConfigScreen (385),
  ChatConfigScreen (265), library/LibraryScreen (1799),
  library/PageGrid (224, présentationnel), library/PageView (350,
  présentationnel) + src/ui/theme.ts (29 styles partagés + maskKey).
  Déplacements VERBATIM (script à ancres assertées, marqueurs comptés
  avant/après). Sémantique mount/unmount assumée : sweep/ptCheck/C4/
  library-watch/seed montent à l'ENTRÉE de la Library (état tree réinit
  par visite) ; résolution -latest par visite ANALYSE. Gotcha réglé :
  les require('./assets/…') déplacés → '../assets/…' (Metro échouait).
- **src/ui/labels.ts** (SRC_LABEL/SRC_LONG/fmtDay/fmtDateTime/fmtHm/
  baseName — la copie ChatPanel disait encore "(escalation)" pré-v0.38) ;
  **src/ui/useArmedConfirm.ts** remplace les 4 tap-to-confirm.
- **src/native/gatherContext.ts** : le flux contexte de ChatPanel.send()
  extrait (~190 l.) — filtre batch-pending, garde estimate >100 p,
  lectures payées, wipe Off en finally. send() = gates → gather → HTTP →
  bookkeeping. parseScope remplace le trio ctxMode/rangeStart/rangeEnd
  aux coutures. 4 TESTS neufs (estimate sans lecture, filtre batch,
  wipe-même-sur-throw).
- **mutateStore dirty flag** : mutator → false = ni persist ni notify
  (+ test) ; adopté sur les touch LRU du chemin chat.
253 tests / 29 suites verts, tsc 0 erreur, eslint 0 erreur (warnings
pré-existants relogés). Déployé smartnoteai-0.46.0.snplg (0.45.0 purgée).
NON testée device — l'user prévoit UNE GROSSE SESSION DE TESTS couvrant
v0.44+v0.45+v0.46 (acceptance §2.4 : navigation config, frappe glossaire,
send/stop/refresh, sheet transcript, historique, recherche, batch).
DESCOPÉ de la phase 4 (backlog) : syncBatch → pretranscript.
submitManualBatch, C4 → autoTranscript, /v1/models → catalog.
resolveLatestAliases, composants Btn/Page/Sheet génériques,
useTranscriptView, collapse KeyState.config.

## v0.45.0 (2026-07-18) — cadre SYNCHRONISATION 2 colonnes (design user) + labels

Design itéré EN DIRECT avec l'user (screenshot 14:13 à l'appui) pendant que
son premier Sync batch (~480 p) tournait. Décisions actées :
- **Cadre 2 colonnes** : GAUCHE = état pur (AUTO : "12 notes · 640 p
  tracked · ✓ all read / N to read → next auto check · last check HH:MM";
  trait ; OFF : "9 notes · 154 p · never sent to the AI"). DROITE = MANUAL,
  la zone d'action, dans l'ordre du flux : ventilation "X up to date · Y to
  sync (+N PDF unknown)" → bouton GRATUIT "Check all notes for changes"
  (passe forcée syncNotePages sur les .note Manual) → "To sync" + les 2
  boutons AVEC € ("Sync now · full price · ~X €" / "Sync batch · −50%
  during server underload · ~Y €") → ligne "At Mistral: N pages · since
  HH:MM" + "Check batch results" (pages, plus de "31 jobs · 64 done").
- **La PAGE est l'unité principale partout** (on paye à la page); le nb de
  notes reste en contexte ("12 notes · 640 p"). Le "to sync" DÉCOMPTE les
  pages déjà en batch pending (pendingSets) — la confusion "496 to read
  qui ne bouge pas après un Sync batch" est morte. Invariant affiché :
  tracked = up to date + to sync + at Mistral (PDF inconnus à part).
- **Sync now/batch = cibles MANUAL uniquement** (validé user) — nouveau
  `modeFilter` d'autoTranscriptTick; l'Auto se rattrape à son tick.
- Chips "Sync: Off/Manual/Auto" (héritage "↳ Sync: X"); boutons export
  "Export .md"/"Export .txt"/"Export all .md/.txt"/"Export N p. .md".
- Sweep page-counts : un .note en ÉCHEC transitoire (bridge saturé par un
  submit batch) est réessayé à la passe suivante (v0.44 le figeait pour la
  session); les PDF restent non-réinterrogés (aucune API locale).
- Réponses données à l'user (screenshot) : les compteurs manquants =
  sweep affamée par le submit batch en cours + PDF sans API; le "496
  pages Manual" = backlog réel enfin compté juste depuis que la sweep
  converge (0.44) + pages en batch non décomptées (fixé ici).
248 tests verts, tsc clean, eslint 0 erreur, marqueurs vérifiés dans le
bundle. Déployé smartnoteai-0.45.0.snplg (0.44.0 purgée local+device).
⚠ L'user avait la 0.44.0 installée avec un batch ~480 p en cours — la
0.45.0 est POUSSÉE mais à installer quand il veut (store + jobs batch
survivent à la réinstallation). Ni 0.44 ni 0.45 testées device.

## v0.44.0 (2026-07-18) — audit v0.39→v0.43 : 1 critique + 13 majeurs corrigés

Audit 4 axes (money paths / App / ChatPanel-overlay / core+Kotlin) sur la
plage af10a5f..HEAD, chaque finding re-vérifié à la main avant fix. Livré :
- **BATCH (le gros lot, pretranscript.ts)**: (C1) un collect PDF à 0 page
  parsable stampait quand même le docHash + job done → OCR payé perdu et
  PDF "lu" pour toujours (garde parsedPages===0 → pending/expiry). (M)
  saveJobs INCRÉMENTAL après chaque job done (kill mi-collect = vague 2
  orpheline + re-soumission = double paiement). (M) `withJobsLock` mutex
  module-level sur submit/collect (ptCheck auto vs bouton Sync = dernier
  écrivain gagnait). (M) les gardes "0 parsable → pending" consultent enfin
  `expired` (pages plus jamais verrouillées à vie dans batchPending). (M)
  le collect n'écrase plus les entrées 'user' (3 branches). Stop mi-chunk
  ne soumet plus le chunk partiel; la page AFFICHÉE est déférée au submit
  (comme le live). `pendingSets` (core/model/batch.ts, pur + testé) =
  L'UNIQUE classificateur pending, par PATH: la vague-2 vision d'un PDF
  (kind 'note') gate désormais le doc PDF — 3 sites dédupliqués
  (autoTranscript, ChatPanel, readThenExport).
- **OFF partout (reading.ts)**: gate Off DANS la couche lecture
  (OFF_READ_REFUSED; `offOk` réservé au flux send qui gère consentement +
  wipe) — Re-read/Improve/re-read Library n'envoient plus un fichier Off
  chez Mistral. Les transcripts Off sont RÉDIGÉS de l'historique persisté
  (ChatTurn.ephemeral + redactForSave — "read once, don't save" tenu).
- **Store**: remapDocPages garde les entrées 'user' orphelines à leur index
  (un parse de footer PARTIEL les supprimait définitivement; test ajouté).
- **Kotlin**: writeFileBase64 ATOMIQUE (.tmp-write + rename — couvre
  pretranscript.json, index conversations, settings, clé; store.json avait
  déjà son .bak); tryAddView démonte le ReactRootView sur échec addView
  (fuite de ChatPanel fantômes); removeOverlay restaure les statics si
  removeView échoue vue encore attachée (ghost window irrécupérable).
- **App**: exportSel reset au changement de doc (payait des pages jamais
  choisies via Read-then-export); la sweep page-counts CONVERGE (les
  chemins traités restent dans countFetchRef; seuls les non-traités
  relâchés au cleanup — churn SDK permanent avant); catch sur
  startExport/doExport (messages "checking/exporting…" figés à vie).
- **ChatPanel**: send gardé par busyRef (double-tap même frame);
  persistNow ref-driven = flush de l'historique à l'unmount/New chat/
  Resume (le dernier tour <600 ms était perdu); Re-read/Improve bloqués
  pendant un send busy.
- **Core mineurs**: parseDay rejette les dates impossibles par round-trip
  (2026-13 "roulait" en janv. 2027); custom_id '' / null ≠ page 0
  (parseChatBatchResults); countOcc gardé contre needle vide; les 5 caches
  dirP survivent à un getPluginDirPath rejeté (fallback /sdcard).
248 tests / 27 suites verts (5 nouveaux), tsc clean, eslint 0 erreur.
Kotlin recompilé (markers vérifiés dans le dex du .npk), bundle vérifié.
Déployé Manta smartnoteai-0.44.0.snplg (0.43.0 purgée local+device).
NON testé device. Restent connus (mineurs, non corrigés): snapshot vide
caché 10 min sur échec lecture .note; débounce recherche (deaccent full-
library par frappe); C4 sans pacing; tree ScrollView non virtualisée;
canRead figé dans exportAsk; erreurs réseau collect affichées "still
processing"; cleanupOldVersions promise.reject asymétrique.

## Session close 2026-07-18 (soir)

State at hand-off: **v0.43.0 (code 125) deployed to the Manta**, repo
clean & pushed. NOT device-tested yet. First things to watch on device:
1. Batch 2 vagues: Sync batch un petit dossier Manual → Check #1 stocke
   l'OCR + soumet la vision, Check #2 upgrade en OCR+Vision avec les
   mots douteux soulignés ([SmartNoteAI.batch] dans logcat).
2. "Handwritten page" de la vue page (fix famine 0.42.1).
3. Écran READ: tags (.note only)/(.note + PDF) + les DEUX cartes de
   prompt (réellement livrés en 0.42.2 — vérifiés par grep).
4. Export: deux boutons par format partout, /EXPORT/<nom>.(md|txt).
5. Compteurs Library: "N to read" seulement en Manual/Auto; le gros
   chiffre Manual du bandeau = backlog facturable d'un Sync (expliqué à
   l'user: souvent un dossier haut en Manual hérité).
User poursuit la relecture de UI-TEXTS.md (resynchronisé v0.43.0,
IDs stables) — prochaine fournée de corrections à appliquer en diff.
PROCESS: mémoire [[feedback-assert-scripted-edits]] — asserter chaque
ancre scriptée + grepper les marqueurs livrés avant tout build.

## v0.43.0 (2026-07-18) — export: one format per button (user decision)

"je veux pas exporter en .md ET .txt !" — the .txt twin (v0.41.0) wrote
both formats on every export. Now ONE format per run (his stated
preference: two buttons, not a prompt): runExport takes fmt 'md'|'txt'
(ExportFormat), writes only that file (.txt names derived from the .md
collision-safe names). Entry points doubled everywhere: grid "⇪ Export
.md" / "⇪ Export .txt"; selection "⇪ N p. → .md" / "→ .txt"; header
"⇪ All .md" / "⇪ All .txt"; folder rows "⇪md" / "⇪txt" minis. Result
message says the format. All anchors asserted + markers grepped (per the
v0.42.2 process rule). 245 tests. Deployed as smartnoteai-0.43.0.snplg.

## v0.42.2 (2026-07-18) — the PDF-prompt display, ACTUALLY shipped

Post-mortem: the whole v0.40.2 READ-screen patch (block tags + PDF
prompt card) NEVER LANDED — the python replaces anchored on wrong
indentation and no-op'd silently; tsc/tests passed trivially and the
version shipped claiming the feature. Caught by the user ("je ne vois
toujours rien !"). Re-applied with count-asserted anchors and grep
verification: every block label now tagged "(.note only)"
(role/fidelity/template) or "(.note + PDF)"; assembled-prompt section
split into "Full prompt — handwritten pages (.note)" and "Full prompt —
PDF pages escalated to Vision" (assemblePdfVisionPrompt verbatim +
explanation line). Marker audit of ALL other recent python patches ran
clean (home restructure, .txt export, freeOnly, manualSeenSig, sweep
pause, tryRender — all present; H11 EXPORT line was a grep false alarm).
PROCESS RULE going forward: every scripted replace must assert its
anchor count, and ship only after grepping the landed markers.

## v0.42.1 (2026-07-18) — regression fixes after user audit call-out

User: "tu fais que la moitié des trucs… on ne voit plus de handwritten
page dans le détail". Fixes:
1. "Handwritten page" preview gone (page detail): root cause = the
   v0.40.1 page-count sweep queues sequential SDK calls that starved
   generateNotePng on device. Sweep now PAUSES while a doc is open
   (browseDoc in deps → cleanup cancels mid-flight, unfetched paths
   retried later), breathes 150 ms between calls; openPage render gets
   ONE retry after 900 ms; kickLocalScan yields 100 ms between notes.
2. The genuinely half-done item found on re-read: "les actions locales
   en background immédiatement" — background ticks now run the FREE
   structural refresh for MANUAL targets too (freeOnly path: footer sig
   → sync → fresh "N to read"; no paid read, no stamp). Guarded by a
   module `manualSeenSig` map so unchanged manual notes cost ~3 footer
   reads/tick, not a re-walk.
Known honest limit (told to user): PDFs have no local page-count API in
the SDK (getNoteTotalPageNum is tried on them anyway); their count
appears once read. 245 tests green. ⚠ adb offline at deploy — push
pending via the background waiter (smartnoteai-0.42.1.snplg ready).

## v0.42.0 (2026-07-18) — two-wave batch: OCR4+Vision EVERYWHERE, for real

User (rightly) pushed back: "on a déjà tranché ça" — the systematic
OCR4→Vision decision was settled at v0.38, and the vision-only batch was
the one path that drifted from it (side-effect: batch entries had no
low-word data → the unsure-word underlines vanished from his library).
Batch now mirrors the live pipeline:
- WAVE 1 (submit, Sync batch): OCR batch on rendered pages
  (buildOcrImageBatchLine = buildSmartBody, word confidences on), job
  kind 'note-ocr'. parseOcrBatchResults now KEEPS escalate+low per page
  (they were dropped since v0.34 — the old open point #1).
- COLLECT ('note-ocr' done): store provisional 'mistral-ocr' entries
  (text + LOW WORDS + hash/rev — paid data hits disk even if wave 2
  dies), then submit WAVE 2: vision chat batch on freshly re-rendered
  images with the OCR text as hint (buildVisionHintBatchLine — live
  escalateRead rule incl. empty-hint guard), fresh revs at render time,
  job kind 'note'. Vision collect carries prev.low onto the 'medium'
  entry (underlines survive).
- PDF batch: entries now store low words; escalate-flagged pages (15%
  rule) get a wave-2 vision job with the NEUTRAL PDF prompt (batch
  escalation existed nowhere before — v0.34 open point closed).
- collectResults signature: (deps, apiKey, {note, pdf} prompts, opts) —
  it renders images and submits jobs now. Caller updated (App ptCheck).
- batch-pending guards ('note-ocr' counts): autoTranscript, ChatPanel,
  App readThenExport.
- Dead v0.38 buildVisionBatchLine removed (parseChatBatchResults stays:
  wave-2 + legacy vision jobs read through it; legacy sniff intact).
Cost note: note batch = (OCR + vision)/2 per page again, like pre-v0.38
intent; wave 2 arrives one "Check results" later than before.
245 tests / 27 suites green. Deployed as smartnoteai-0.42.0.snplg.
Device test: Sync batch a small Manual folder → first Check stores OCR
text + submits wave 2 → second Check upgrades entries to OCR+Vision with
underlined unsure words.

## v0.41.0 (2026-07-18) — user's UI-TEXTS pass (partial) + .txt export

Applied the user's first batch of UI-TEXTS.md edits (file still MID-EDIT,
more to come — his comments/corrections live in the committed UI-TEXTS.md
diff): home restructured into "Configuration" (1 keyapp / 2 READ: AI
transcript params / 3 CHAT: AI chat params) + "Plugin modules" (LIBRARY
door, unnumbered: "LIBRARY: your transcripts; sync, search & export your
notes"); EXPORT module box now BLACK/active; H11 module paragraph rewritten
(adds EXPORT line, privacy: "a paid plan never trains on your data,
nothing stored on their servers"); screen subheaders follow (READ/CHAT
renamed, Library → "LIBRARY: sync, search & export"); visionPrompt V3
hint "app"→"plugin". NEW: .txt TWIN EXPORT (his H15 comment: the
Supernote reader opens .txt natively, not .md) — composeExportTxt (plain
frame, "--- Page N ---", mdToPlain) written next to every .md; grid
button now "⇪ Export .md + .txt"; result message counts documents.
⚠ lowWords finding (user: "je ne vois plus les mots unsure soulignés"):
NOT a display bug — MarkdownView/App wiring verified intact. Root cause:
the v0.38 note batch is VISION-ONLY (buildVisionBatchLine = image+prompt,
no OCR leg) → batch entries have NO low-word data, and his library was
re-transcribed via batch. Options offered to user (not implemented):
2-wave batch (OCR batch → vision batch with hint, restores low words +
hint quality at extra cost) vs live-reads-only keep low words. 243 tests.

## v0.40.2 (2026-07-18) — READ screen shows the PDF prompt variant

User: "je ne vois pas la difference des prompts entre pdf et .notes …
il faut le dire et le montrer". READ screen now: each block label tagged
"(.note only)" (role/fidelity/template) or "(.note + PDF)" (the shared
ones); the assembled-prompt section split in two cards — "Full prompt —
handwritten pages (.note)" and "Full prompt — PDF pages escalated to
Vision" (assemblePdfVisionPrompt verbatim) with an explanation line.
UI-TEXTS.md/artifact NOT regenerated (user mid-edit); new strings listed
in the reply for his text pass.

## v0.40.1 (2026-07-18) — Library UX/perf pass (4 device feedbacks)

1. TOUCH: rows/back/chips easier to hit — libMain/libFolderMain
   paddingVertical 11/10→14, caret 16→18, back button wider + hitSlop,
   hitSlop on rows (rowSlop) and chips/⇪ minis (chipSlop, module consts).
2. PERF: the tree (hundreds of rows) is now a useMemo — it used to rebuild
   on EVERY state change (each progress/msg update repainted the whole
   list on e-ink). renderAutoChips → useCallback. Library-watch poke
   25s→45s (footer-checks every Auto note; the IO competed with taps).
   Page-count fills land in batches of 8, not per file.
3. TREE: opens 3 levels deep on first Library visit (roots + their
   subfolders, treeSeededRef once/session; user collapses respected).
4. STATUS RULES (user decision): page count shows for EVERY file it is
   known for, whatever the mode; "N to read" ONLY for effective
   Manual/Auto. Off rows used to show "48p · 48 to read" when the store
   knew them (eff non-null included 'off' — bug). New `pageCounts` state:
   free background getNoteTotalPageNum for files the store doesn't know
   (works for .note; PDFs get a count once read). FLOW: switching a chip
   to Manual/Auto kicks a FREE background structural scan (syncNotePages
   on store-unknown notes only) so "50p to read" appears immediately —
   paid reads still wait for Sync/Auto. Banner also counts tracked
   store-unknown files via pageCounts (the "Manual 538 pages" confusion).
242 tests green, tsc clean. Deployed to Manta as smartnoteai-0.40.1.snplg.
Note: UI-TEXTS.md (L19 semantics) not regenerated — the user is editing it.

## v0.40.0 (2026-07-18) — EXPORT module (Library → /EXPORT .md)

User-scoped (4 AskUserQuestion answers) then GO. Exports the transcript
STORE as Markdown under the device's own /EXPORT folder — zero Mistral
calls unless the user explicitly asks to fill gaps first.
- Core pure: `src/core/export/exportMd.ts` (composeExportMd with
  `# name` / `> Exported by SmartNote AI · date · X/Y pages` / `## Page N`
  frame, *(not read yet)* and *(blank page)* markers; pageRangeLabel
  "p3-7"; exportFileNames with (note)/(pdf) collision suffixes). 7 tests.
- Native: `src/native/exporter.ts` — EXPORT_ROOT=/storage/emulated/0/EXPORT,
  countExportGaps (notes: exact pagesNeedingRead count; PDFs: covered iff
  ≥1 stored page), runExport (targetFor mirrors trees: baseDir /Note/Work
  → /EXPORT/Note/Work/x.md; flat for single docs; selection appends
  " p3-7" to the name). New Kotlin `mkdirs` @ReactMethod (writeFileBase64
  refuses missing parents by design — unchanged).
- UI (Library): grid gets "⇪ Export .md" + "☐ Select pages" (tap tiles to
  toggle, 3px border = selected, "⇪ Export N page(s)"); folder rows get a
  ⇪ mini; "⇪ Export all" next to Clear all. Off files are ALWAYS skipped
  (counted in the result message). Gaps → dialog card: "Read then export"
  (only with key+consent; reuses readNotePages/readPdf with the
  batch-pending guards, PDF prompt variant) / "Export incomplete" /
  "Cancel". Cost shown via eurosTotal(OCR+READ).
242 tests / 27 suites green, tsc clean. Built (Kotlin compiles) as
smartnoteai-0.40.0.snplg — ⚠ adb device was OFFLINE at deploy time: the
push to MyStyle is PENDING (file ready in the repo dir). NOT device-tested;
first test = export a small read note, check /EXPORT/<name>.md appears.

## v0.39.1 (2026-07-18) — neutral PDF escalation prompt

The open design point is CLOSED (user: "évidemment il faut faire ça").
An escalated PDF page is often hard PRINT (old scan, dense table), not
handwriting — the notebook prompt was factually wrong there. New
`assemblePdfVisionPrompt` (visionPrompt.ts): neutral PDF role+fidelity
(PDF_ROLE_BLOCK/PDF_FIDELITY_BLOCK, not user-editable), drops the
notebook 'template' block, keeps the user's content blocks WITH their
overrides (formatting/drawings/languages/money/glossary — a customised
'role' does NOT leak). Wired into all 4 readPdf call sites (auto tick,
App "Redo AI transcript", ChatPanel send + reread via
freshPdfVisionSystem). READ-screen manual sentence updated (also fixes
the v0.39.0 miss where the old "Vision is not used on PDFs" sentence
survived a bad replace). 235 tests green. Deployed to Manta as
smartnoteai-0.39.1.snplg; 0.39.0 purged.

## v0.39.0 (2026-07-18) — audit fixes A+B+C · READ config page · stamp epoch v2

Full sweep of the Opus 4.8 range audit (1489627..af10a5f), user GO "A+B+C":
- **Lot A (money):** A1 legacy kind:'note' jobs (OCR-shaped) are shape-sniffed
  at collect (chat parse → fallback parseOcrBatchResults, source
  'mistral-ocr'); a job with 0 parseable results but pages>0 is NEVER marked
  done (stays pending, 48 h expiry decides). A2 saveCurrentNote moved to the
  TOP of readNotePages (before ids/revs) — stale-rev double-pay. A3
  batchPending now also covers PDFs (auto tick skips readPdf when a pdf job
  is pending) AND the ChatPanel paths (note pages filtered from the live
  read; PDF answered from the store). A4 per-page failure backoff in
  autoTranscript (pageFails map, ≥3 fails → skipped without stamping,
  cleared on success). A5 `currentDeferred` now blocks the stamp (deferred
  current page froze notes at "1 page to read"). A6 blank-page negative
  cache only when OCR **and** vision both genuinely ran ok.
- **Lot B (markdown):** unicode bullets (`•`/`·`) + `✓☑✗☐`/`N)` keep-lines;
  one-line/one-fence code blocks keep their content; `---` alone is no
  table separator; bold/italic flanking rules (`_` intraword rejected);
  MarkdownView style order fixed so heading sizes/textScale win over
  baseStyle (H1 bug). 6 regression tests.
- **Lot C:** PtJob.revs recorded at submit + stamped at collect (edits made
  while a batch runs are no longer masked); only actually-submitted pages
  go in the job record (phantom pages blocked Auto 48 h); ChatPanel
  re-assembles the vision prompt from FRESH settings at every use (stale
  mount-time copy); big-read estimate = OCR + READ cents (was −12%);
  applyWordFix uses a replacer function ($-escape).
- **Stamp epoch `v2:`** — the "25 pages to read that never drain" root cause
  was poisoned stamps from the 2026-07-17 stamping bugs (device logs: every
  note "unchanged → skip", 0 read). All sigs now prefixed `v2:`; every old
  stamp is invalid once, the first tick re-checks the whole library (free
  walk) and reads what is truly missing. Also `sig=''` when the footer read
  fails (never stamp on an empty rev map).
- **UI:** OCR/prompt config moved OUT of the Library into its own screen
  "2 · READ: transcript params" (home door added; Library → 3, Chat → 4;
  collapsible gone). PDF manual text updated (15% escalation).
232 tests / 26 suites green, tsc clean, eslint = pre-existing warnings only.
Deployed to Manta as smartnoteai-0.39.0.snplg. NOT device-tested yet.
**Watch on device:** first tick after install re-checks all ~83 notes (log
"tick start" → should now READ the stuck pages); [SmartNoteAI.batch] on the
next "Check results" for the legacy-job sniff.
**Open design point (user not asked yet):** PDF escalation now sends the
full handwriting prompt to Vision on escalated pages — reverses the bench
finding that print+vision hallucinates; may deserve a print-specific block.

## v0.38.0 (2026-07-17) — always OCR4→Vision · editable prompt blocks · Markdown display

Three user-requested changes:
1. **Markdown rendered, not stripped** (opportunity, not a bug — helps
   future exports). New pure parser `src/core/text/markdown.ts` + RN
   `MarkdownView.tsx` (headings/bullets/ordered/quote/code/table + inline
   bold/italic/code, robust to malformed markdown). Wired into: ChatPanel
   transcript sheet + assistant bubbles, SearchPanel read view, App OCR-test
   result. (Page-view low-word tap-highlight left on renderWithLowWords —
   Markdown there is phase 2.)
2. **Always OCR 4 → Vision, systematically** (no escalation heuristic).
   readNotePages: OCR (hint + low-words) then Vision ALWAYS → source
   'medium'. Covers live/auto/manual/chat/rereadPage/improve AND batch
   (batch notes are now a VISION chat-completions batch, one line/page,
   −50%; new buildVisionBatchLine/parseChatBatchResults). **PDF stays
   OCR-only** (deliberate: print is where OCR wins, Vision hallucinates and
   costs most — one /v1/ocr call reads the whole doc; only rare photo pages
   escalate). Bench that drove this: docs bench + the artifact on
   Poland.note (0/7 pages escalated under the old 30% threshold, yet
   Vision+glossary fixed ~40% of words — Q66→Cl66 etc; and bare OCR ignores
   the glossary entirely, /v1/ocr takes no prompt).
3. **Full vision prompt exposed as editable BLOCKS** (nothing hidden):
   `src/core/model/visionPrompt.ts` (PROMPT_BLOCKS: role, fidelity,
   formatting[now asks for Markdown], drawings, template, languages, money,
   glossary). settings.promptBlocks (blockId→override, absent=default;
   personaOcr migrated into the glossary block). reader.ts builders take the
   assembled `system` string. Config shows every block editable + the
   assembled prompt verbatim. The old single "Glossary" field is gone.
217 tests / 26 suites green, tsc + eslint clean. Characterization tests
updated for always-vision (happy path now OCR+Vision→medium, 4 calls/2pp).
NOT device-tested yet. Note: batch-vision is the least-exercised path
(batch endpoints historically unverified) — first device test should run a
tiny Manual folder and watch [SmartNoteAI.batch].

## v0.37.0 (2026-07-17) — SMART search (user-designed grammar)

One field compiling to the advanced engine (core/store/smartQuery.ts,
pure + tested): words / "phrase" / a|b|c / !neg / f: n: type:note|pdf /
star: / kw: / src: / after: / before: / sort:. Separators: space AND '+'
(user choice); quotes protect both. Unknown prefix = plain word, made
visible by the INTERPRETATION LINE under the field (the trust mechanism
on e-ink). Engine additions (librarySearch): excludePhrase, doctype,
starred, keyword, after/before (read date, UTC); META hits surface
UNREAD starred/keyworded pages ("★ kw — (not read yet)") when no text
criterion is present. Store: DocEntry.stars/kws snapshotted at sync
(setDocMeta/docMetaEquals — write only on change, no notify loop);
harvested in the SAME cached walk (FIVESTAR key in the page block, free;
KEYWORD_ footer entries → one small block each, UTF-8 decoded). Format
findings verified on the user's device: page block key <FIVESTAR:coords>,
footer <KEYWORD_xxx:addr> → block with KEYWORDPAGE/KEYWORD. Native
search is slow because it scans files at query time; ours stays instant
because extraction happens once at sync and queries hit the in-memory
store. v0.36.3 (same day): search field ✕ clear button + "first 60
matches" truncation warning.

## v0.36.2 (2026-07-17) — Auto edit-detection fix (device logs, same day)

The user edited an Auto note; ticks ran every ~24 s (pen-up pokes worked)
but every one logged "needing a paid read=0". Root cause (probably
LONG-standing, since Auto started forcing the sync ~v0.30): the forced
slow path's rev RE-BASELINE stamped the current block addresses onto
every entry BEFORE pagesNeedingRead compared — the in-place edit's rev
delta was erased on every tick, so Auto never saw any edit. Fix:
syncPageIds now distinguishes by STRUCTURE (page count + PAGEID order vs
the stored snapshot): same structure ⇒ read-only, NO re-baseline (the
edit delta survives to pageNeedsRead); structure changed ⇒ remap +
re-baseline as designed (a reflow is still not billed as N edits). The
old count-based fast path and the `force` slow-path detour collapse into
this one comparison. Regression test added (rev must stay OLD through a
forced sync; the edited page must be returned by pagesNeedingRead).

## v0.36.1 (2026-07-17) — Library perf fix (device feedback, same day)

Device logs showed the 104-page France.note walk taking 16-22 s of bridge
IO, run 2-3× CONCURRENTLY, and expiring every 45 s — the Library felt
frozen on open and on back. Fixes:
- Snapshot cache is now CONTENT-VERIFIED: on each hit the live footer
  (~3 reads, readFooterRevs) is compared to the cached revs; identical ⇒
  the walk is still exact (append-only format), refreshed in place. TTL
  is only a 10-min memory bound. One walk per note per real change.
- In-flight dedup (concurrent callers join the running walk) + a
  generation fence (an invalidation during a 20 s walk keeps its result
  out of the cache).
- Library-watch pokes are 'light': no current-note flush + 600 ms sleep
  every 25 s while the user is just browsing.
Batch "OCR+Vision" question investigated the same day: since v0.36 the
batch collect can ONLY store 'mistral-ocr'; entries labeled OCR+Vision on
Manual/batch notes are pre-v0.34 batch results (that pipeline WAS direct
vision) or live re-reads — check a page's Source line (escalation vs
improve pass + date) to distinguish. Escalation criterion unchanged:
0 words OR >30 % words <0.8 confidence, live path only (batch never
escalates — still v0.34 open item #1).

## v0.36.0 (2026-07-17) — refactor phase 3: ONE simple robust flow

SPEC-REFACTOR-v0.36.md §1 implemented (user GO + 4 decisions same day),
in four commits (lots A-D):
- **A — one Mistral transport** (`core/model/http.ts`): headers, abort
  wording, 401/422 hints, malformed guard + ONE network/5xx retry, used
  by chat, OCR, Conversations and the batch job endpoints.
- **B — one coherent note reader + one writer**: noteTranscripts serves
  ids + revs + RECOGNTEXT from ONE cached walk (3 slots, 45 s);
  ensureNoteFresh lives there; captureContext deleted. reading.ts:
  `upsertTranscript` = the ONE store writer (stamps + reflow via core
  `makePageEntry`, 'user' text verbatim), `escalateRead` = the ONE vision
  escalation (was 3 copies). readPdf reports `storedPages` and the OFF
  wipe uses it (a PDF read stores the whole doc).
- **C — one Auto scheduler**: `startAutoScheduler` (index.js, periodic
  15 min) + `pokeAuto` (pen-up / page-turn / panel-open / config-open /
  library-watch) replace the 5 hand-wired timers. Cheap change detector
  = `readFooterRevs` (footer-only ~3 reads) feeding the kept doc digest;
  PDFs now gate on docHash only ('pdf:<size>' stamp gone).
- **D — slim capture + leftovers**: `captureCurrent` (3 SDK calls) for
  the 2.5 s poll — page turns no longer render+OCR for a thumbnail; the
  panel thumbnail is lazy (.note, page mode, expanded); recognizeElements
  cascade deleted; legacy batch parser deleted; keyFile reduced to key
  parsing; search moved to `core/store/librarySearch.ts`, searchLibrary
  folded into searchLibraryAdvanced.
179 tests / 23 suites green, tsc + eslint clean. NOT yet device-tested —
device script in SPEC §1.7. Phase 4 (UI split) awaits its own GO.

## v0.35.0 (2026-07-17) — audit fixes + dead code + characterization tests

A full-code audit (4 parallel reviews: App, ChatPanel, src/native, src/core)
found 8 real bugs and ~650 lines of dead code left by the v0.34 refactor.
- Phase 0 (bugs): OFF-file transcripts leaked on Stop (wipe now in a
  finally); infinite ptCheck network loop while the Library was open;
  manual 'user' edits could be overwritten by Auto when saved with hash ''
  ('user' checked FIRST in pageNeedsRead + all UI writers stamp id+rev via
  the new `pageStamp()`); New chat/Resume during a busy send corrupted
  history; scope change mid-send lost the next context; stale image/OCR in
  the Library page view on fast prev/next; batch jobs never pruned/expired;
  tool toggles wiped while typing a custom model id.
- Phase 1 (dead code): sources 'eco'/'recogntext' removed (with
  isBaselineReplaceable, per-doc consent, removeDoc, the Search "Device"
  filter), capImagesToBudget/8-image budget, engine:'medium' fallback,
  readerModel overrides, captureContext's empty session caches,
  getElementCounts, App's write-only stats, 16 orphan styles.
- Phase 2: NEW characterization tests over `reading.ts` (sync fast/slow,
  escalation tree, negative cache, stop/abort), `autoTranscript.ts`
  (throttle, budget, stamp, current-page deferral) and
  `transcriptStoreIo.ts` (.bak recovery) — the money-spending orchestration
  had zero tests before.
- **Next: `SPEC-REFACTOR-v0.36.md`** (submitted to the user for review) —
  phase 3 "one transcript flow" (noteState, one writer, one escalation, one
  transport, one Auto scheduler, slim capturePage) and phase 4 "UI split"
  (App router+screens, gatherContext extracted, shared UI kit).

## What it is

A Supernote plugin: an AI note assistant powered by **Mistral AI**. A floating,
movable/resizable overlay panel chats with Mistral about the handwritten note
page(s) behind it (image + on-device OCR). The note stays visible and writable
behind the panel.

- **Name (user-facing):** SmartNote AI. **pluginKey:** `SmartNoteAI`.
- **Internal identifiers (never renamed, invisible):** android package
  `com.smartnoteai`, native module `SmartNoteAiOverlay`, overlay component
  `SmartNoteAiBubble`, output `smartpaper.snplg`, `pluginID qzv0bazughqxhbph`.
- History of names: SmartPaper → SuperMistralAI → **SmartNote AI** (the
  "Mistral" trademark in the middle name was the reason for the last rename).

## Architecture

Clean split, CORE is pure + unit-tested (46 tests, `npx jest`):

- `src/core/` — pure, testable, no RN deps:
  - `model/mistral.ts` — request builder + fetch. `buildBody`, `wireContent`,
    `capImagesToBudget` (8-image safety cap), `MAX_IMAGES_PER_REQUEST`.
  - `model/types.ts` — `ChatTurn {role,text,images?}`, `ChatRequest`, usage.
  - `model/catalog.ts` — model list (Small/Pixtral/Medium/Large; Medium 3 is
    newer/cheaper/better than Large 2).
  - `convo/compose.ts` — `DEFAULT_SYSTEM`, `composeUserText` (`--- Page
    (transcribed) ---` marker; the UI strips everything from that marker on).
  - `convo/composeContext.ts` — `pagesForContext` (0-indexed!), `composePagesText`.
  - `actions/quickActions.ts` — built-ins + `QuickActionItem`,
    `resolveQuickActions`, `MAX_QUICK_ACTIONS=12`.
  - `config/keyFile.ts`, `util/base64.ts`.
- `src/native/` — thin RN glue: `capture.ts`, `captureContext.ts`
  (`gatherPagesText`/`gatherPagesImages`, both locally cached), `settings.ts`
  (`readSettings`/`writeSettings` → `settings.json`), `fs.ts`, `fetchAdapter.ts`.
- UI: `App.tsx` (full-screen config + the setup sub-page), `ChatPanel.tsx` (the
  chat, reused), `Bubble.tsx` (floating shell: drag/resize/snap/collapse).
- Android: `android/app/src/main/java/com/smartnoteai/*.kt`.

### The overlay-mounts-React trick (the treasure — do not re-lose)

A native overlay window (`TYPE_APPLICATION_OVERLAY`) hosts a React root by
reflecting into the **plugin's own** ReactInstanceManager (not the host's):
`getNativeModule("NativePluginManager")` → `PluginModule.pluginApp` (private
field) → `getReactNativeHost().reactInstanceManager` →
`ReactRootView.startReactApplication(rim, "SmartNoteAiBubble", …)`. Ported from
sn-copilot's `CopilotOverlayModule.kt`. Native module = `SmartNoteAiOverlayModule.kt`
(open/move/resize/close/getScreenSize/copyToClipboard/cleanupOldVersions/
writeFileBase64; static window state in the companion object to avoid ghost
windows). Requires `SYSTEM_ALERT_WINDOW` (already granted on the Manta).

## Build / deploy / debug

- **Env:** `source /home/agp/GitHub/supernote-plugins/env.sh` (exports
  JAVA_HOME/ANDROID_HOME — note it lives in the MAIN checkout root, NOT the
  worktree). Then `bash buildPlugin.sh` from the `smartnoteai/` dir (the
  folder was renamed from `smartpaper/` at v0.18.0; the INTERNAL name stays
  `smartpaper` — package.json `name`, `rootProject.name`, `smartpaper.snplg` /
  `.bundle` outputs all derive from it, NOT from the folder). Gotcha: after
  any folder move/rename, purge `android/.gradle`, `android/build`,
  `android/app/build` and `node_modules/.cache` — the RN autolinking cache
  stores absolute paths and gradle fails on `:sn-plugin-lib` otherwise (and
  buildPlugin.sh still packages a STALE app.npk despite the gradle failure).
- `buildPlugin.sh` compiles Kotlin → `app.npk` (`:app:compileDebugKotlin`) and
  bundles JS → `build/outputs/smartpaper.snplg` (~7 s incremental). A native
  `.kt` change IS recompiled — verify `:app:compileDebugKotlin` is not
  `UP-TO-DATE` in the log.
- **Version:** edit `PluginConfig.json` by hand (`versionName` + `versionCode`).
  Not synced from package.json.
- **Deploy:** `adb push build/outputs/SmartNoteAI-X.Y.Z.snplg
  /storage/emulated/0/MyStyle/` then install on device (uninstall old first).
  adb works on the Manta (device id `SN100C10003768`) after enabling
  sideloading. adb path: `/home/agp/Android/Sdk/platform-tools/adb`.
- **Cleanup rule (user request):** on every new push, delete old versioned
  `SmartNoteAI-*.snplg` locally AND on device, keep only the newest; never
  touch other plugins' `.snplg` (SnCopilot, dashboard, supertemplate).
- **Delivery pattern:** `cp` to `SmartNoteAI-X.Y.Z.snplg`, `adb push`,
  `SendUserFile`, `git commit` (Co-Authored-By trailer). Deliver in chat too.
- **Debug:** `adb logcat -s ReactNativeJS:V` for `console.log`. Native overlay
  logs under tag `SmartNoteAiOverlay` / `[SMARTPAPER_OVERLAY]` (add
  `SmartNoteAiOverlay:V` to see them). Kill lingering streams before handing off.
- **Mistral key:** `MyStyle/Plugins/SmartNoteAI/mistral-key.txt` (line
  `key=...`). Settings persisted next to it in `settings.json` (PC/USB editable).

## Recent work (0.17.x)

- **0.17.0** configurable quick actions (up to 12, dedicated setup page +
  `settings.json`), Persona moved to the setup page.
- **0.17.1** diagnostic build (temporary logs) for the reported "settings stop".
- **0.17.2** three fixes: (a) **accidental overlay close** — a native
  `TapToCloseListener` was attached to the whole overlay frame; a palm/arm on
  the border closed the window. Now attached ONLY in the React-mount-failure
  fallback; closing goes through ✕. (b) config "Open floating assistant" button
  **pinned in a sticky footer** (was scrolling off at Button size XL). (c)
  **Refresh** shows an in-progress state ("⟳ Refreshing…", inverted).
- **0.17.3** **image-once + OCR sticky text** (the big one). `/v1/chat/
  completions` is stateless → the old code re-uploaded the full base64 page
  images from history every turn (bandwidth + tokens), which also blew past
  Mistral's hard **8-images-per-request** limit (error code 3051). Now: a
  context turn sends its image(s) ONCE; on success the turn is "cooled" (image
  dropped, page kept as TEXT). Later turns replay text only → no re-upload,
  stable/cacheable prefix, structurally under 8 images. On failure the image is
  kept for retry. `buildBody` caps total images at 8 as a safety net. Max page
  images options are now 2/4/6/8.
- **0.18.0** **audit fixes** (code review of the whole plugin; NOT yet built or
  device-tested): (a) the page poll also compares `getCurrentFilePath()` — a
  note switch landing on the same page number no longer leaves the panel
  targeting the previous note. (b) fresh captures re-seed BOTH the OCR text
  and image caches for the current page (`seedPageImage`), so a Refresh after
  editing never re-sends a stale image; a failed-OCR capture ('') no longer
  clobbers a good cached transcript. (c) `send()` wrapped in try/finally +
  90 s AbortController timeout — a hung request can't lock the panel. (d)
  `contextSent` only set if the capture is unchanged after the request
  (Refresh-mid-send race); Refresh disabled while busy. (e) elements are
  `recycle()`d after `recognizeElements` (native-memory leak, skill gotcha #4).
  (f) drag-release clamps the window (and bubble, and restore-from-bubble)
  fully on-screen — FLAG_LAYOUT_NO_LIMITS made off-screen windows invisible
  but alive. (g) `writeSettings` creates `CONFIG_DIR` first (settings were
  silently lost until the user hand-created the key folder). (h) janitor
  rejection handled; quick actions with an empty prompt filtered out;
  `MAX_MULTI_IMAGES` deduped into `MAX_IMAGES_PER_REQUEST`.

- **0.18.1** ⏹ Stop button (aborts HTTP + bails gather loops +
  `cancelRecognize()`), phase-labelled progress ("rendering pages n/m" then
  "reading pages n/m"), transcripts labelled with their note name (a note
  switch mid-conversation confused the model — observed on device).
- **0.19.0** **stored-transcript cascade** (the user's find). The real-time
  recognition transcript lives INSIDE the .note file and is read directly:
  tail 4 bytes (LE u32) → footer block → `<PAGEn:addr>` → page block →
  `<RECOGNTEXT:addr>` → block = base64 → UTF-8 JSON
  `{elements:[{label:"<page text>"}]}`. Parser: `src/core/notefile/
  recognText.ts` (pure, tested; validates every address — the format is
  append-only and FULL of stale blocks; only the tail footer is
  authoritative). Reader: `src/native/noteTranscripts.ts` (fetch file://,
  5 s TTL cache). Cascade everywhere transcripts are needed (single-page
  capture + gatherPagesText): (1) stored RECOGNTEXT — instant, best
  quality; (2) `recognizeElements` — 6-30 s/page, for notebooks with
  real-time recognition OFF; (3) '' (image still carries the page).
  Validated on ToDo.note: 7/7 clean French transcripts where
  recognizeElements returned 0 chars on every page.
- **0.20.0** **TranscriptStore — read once, analyse forever** (SPEC-v0.20 +
  SPEC-UI-v0.20, phase 1). The two flows are decoupled:
  READ: `.note` pages → **medium vision** (`src/core/model/reader.ts`,
  READER_MODEL pinned to medium; the user's **OCR persona** rides as its
  system prompt) page by page — renders sequential, network reads in a
  sliding window of 4 (`src/native/reading.ts`; measured same cost as one
  8-image call, 2.7× faster). PDFs → whole file to **/v1/ocr** in ONE call
  (`src/core/model/ocr.ts`) — fixes the multi-column embedded-text order
  bug, no 8-image limit. Results persist in
  `<pluginDir>/transcripts/store.json` (`src/core/store/transcriptStore.ts`
  pure + `src/native/transcriptStoreIo.ts` IO; LRU 4.5 MB, element-count
  page hash, janitor-safe, NEVER MyStyle).
  ANALYSE: the chat is **text-only** — no images on the wire anymore; the
  old 3-state `pageSource` + `maxImages` settings are gone (silently
  dropped from settings.json). Source picker in config: medium (default) /
  free Supernote OCR. Offline → RECOGNTEXT fallback, not persisted, banner.
  UI: provenance chip in the header (`MED/OCR/OCR+/USER/SN · date`,
  aggregate on multi-page) → Transcript sheet (full text, Copy,
  Re-read ≈0.7 c$); cloud-consent dialog once per document (Always/Once,
  persisted in the store); big-read estimate dialog above 100 pages;
  config gets "OCR persona" (+ Test on current page → Keep/Discard) and
  "Local data" (stats, Clear transcripts, Reset consents — uninstall does
  NOT reliably clean the private dir).
- **0.20.1** device-feedback batch: **API key in the UI, encrypted at
  rest** (`src/native/secureKey.ts`: XOR keystream from PBKDF2 over a
  random device-local pepper, both in the PRIVATE dir — protects against
  MyStyle cloud sync, not adb root; soft migration from mistral-key.txt
  + "Delete old key file" offer); `max_tokens` is an internal default
  now; **config is a HUB** (home = status + Open + doors); real icon.png
  instead of emoji; **ONE global first-use cloud consent** replaces the
  per-document dialog (store.globalConsent; Reset consents re-arms).
- **0.21.0** **Conversations client** (`src/core/model/conversations.ts`:
  inline model+tools, `store:false`, instructions/inputs, citations as
  `tool_reference` → appended "Sources:" block) behind two config
  toggles: **Web search** (~+1 c$ when the model decides to search) and
  **Code interpreter** (≈free — Python sandbox, math that LLMs flub).
  **Eco engine** `transcriptSource:'ocr'` (mistral-ocr + Document AI
  annotation, OCR persona as the schema description). Transcript sheet
  gets **Improve** (medium+image+hint, 7.0/10, source 'improved'),
  **Edit** (manual → source 'user', never overwritten without the
  one-tap-confirm guard), and the chat an "Improve & re-ask" footer when
  the answer ran on a weak (SN) transcript. **ConversationStore**
  (`src/native/conversationStore.ts`: conversations/<id>.json + index,
  auto-save after every turn, retention 50/90d) + 🕘 Historique sheet
  (resume, "↩ born on X" reminder, tap-confirm delete).
- **0.22.0** **Pre-transcript your Supernote** via the **Batch API**
  (−50%): native `listDir` (Kotlin) + folder browser with page counts,
  estimate (only pages the store doesn't cover), GO → sequential renders
  → ~40-page JSONL chunks (custom_id = page, one job per chunk per note)
  → upload `/v1/files` (multipart via temp file) → `/v1/batch/jobs`;
  job records in `pretranscript.json`; the tablet may power off during
  processing; **"Check results"** downloads outputs into the store
  (source 'medium'). Resume-safe by construction (pagesNeedingRead skips
  covered pages; pending jobs' pages are not re-submitted).
  Core clients: `src/core/model/batch.ts` (+ tests), `src/native/batchIo.ts`,
  `src/native/pretranscript.ts`. ⚠ Batch endpoints are code-verified but
  NOT yet exercised against the real API — first device test should run
  a small folder (a few pages) and watch `[SmartNoteAI.batch]` logs.
- **0.22.8** **"chemin 2" — the ONE smart Mistral path** (user decision).
  The .note picker is down to TWO choices: Supernote OCR (free) or
  "Mistral OCR 4 — smart": OCR (+ annotation when the glossary is set,
  now via the OFFICIAL `document_annotation_prompt` + a one-line field
  contract + `sanitizeAnnotation()` in code — A/B-tested, prompt-only
  format rules kill drawing descriptions) with AUTOMATIC silent vision
  escalation when the OCR is unsure. Signals (free, same call,
  `confidence_scores_granularity:'word'`): 0 words extracted (drawings)
  or >30% words below 0.8 (ESCALATE_PCT). Per-PAGE confidence is
  USELESS (0.92 on an empty-transcribed page — measured). PDFs escalate
  too (photos/figures): flagged pages rendered via `generateDocImage`
  then vision-read (⚠ untested on a non-open PDF). `pages[].tables`
  content is now MERGED into transcripts (the user's handwritten grade
  table came out near-perfect there; markdown alone only had a
  placeholder). Legacy 'medium' source value migrates to 'ocr'.
  Costs at 30% escalation: ≈5.6€/1000 pages (≈2.8€ batch).
- **0.22.10** device bug (new page answered with the OLD page's text) +
  audit pass. Root causes: (1) the firmware flushes .note files LAZILY —
  right after a page create/delete the on-disk footer (PAGEIDs,
  RECOGNTEXT) lags the live note, so remap validated the stale order;
  (2) legacy store entries (hash '' or element-count) were accepted by
  isPageValid even when the real PAGEID was known. Fixes:
  `ensureNoteFresh()` (captureContext): live getNoteTotalPageNum vs
  file's PAGEID count → saveCurrentNote + cache invalidation + retry ×4;
  wired into pagesNeedingRead, readNotePages (incl. FORCE/Re-read),
  improvePage, gatherPagesText (free path had the same bug), manual-edit
  stamping (panel + library) and the glossary test. isPageValid now
  REJECTS non-PAGEID hashes when a PAGEID is expected (legacy entries
  re-read once, then carry ids). Index-keyed session caches invalidated
  on any remap movement. Audit extras: `flushStore()` right after paid
  bursts (readNotePages / readPdf / batch collect) so a crash inside the
  800 ms debounce can't lose paid transcripts.
- **0.22.15** perf: native `readFileRange` (RandomAccessFile) + a
  range-walker in noteTranscripts — the .note metadata (PAGEIDs +
  RECOGNTEXT) is now read in ~2×pages+2 SMALL blocks instead of
  fetch(file://)-ing the whole note through the JS bridge (measured:
  16 s for a 5.5 MB note on the Manta, janking the whole shared JS
  thread — the "config UI extremely slow" report). Whole-file fetch
  kept as fallback if the native method is missing; the log line says
  which path ran and its duration. Also: debounced the Library
  store-subscription refresh (storeStats serializes the store), and
  bounded the header titleRow (the ✕ close button could overflow
  off-screen right).
- **0.23.0** the "always up to date library" batch (user go 2026-07-12,
  all four lots in one version):
  (A) TEXTS: no em-dash anywhere in user-facing strings (user: "only
  AIs write like that"); disclaimer merged into the Ko-fi footer
  ("personal project... not an official product of Supernote or
  Mistral AI") + README top; User Guide intro rewritten; Reading
  engine split into ".note reading" / "PDF reading" labels; the
  Vision-model free-text setting REMOVED (escalation pinned to
  Medium; `settings.readerModel` silently dropped on next write);
  "Delete stored key" button (secureKey.deleteApiKey).
  (B) FREE BASELINE LAYER: `recogntext` entries are now PERSISTED.
  syncPageIds stores a `pageIds` snapshot per doc (DocEntry.pageIds)
  and fills uncovered pages with the note's stored RECOGNTEXT as
  source 'Device' (same cached range-read, no extra IO). ChatPanel
  syncs every visited note (cap effect) so any note the panel sees
  enters the library. Library shows `12/43 p`, dashed "not read yet"
  tiles, and "(deleted)" for docs missing on disk (listDir check on
  READ open). Low-confidence words (<0.8) from OCR reads are stored
  per page (PageEntry.low, cap 60).
  (C) TRANSCRIPT ALWAYS: Auto chips on Library folders (recursive) and
  notes → settings.trackedFolders/trackedNotes. New module
  `src/native/autoTranscript.ts`: tick on config open + panel open +
  every 15 min; change detection via file SIZE stamp (append-only
  format, DocEntry.stamp); consent-gated, max 100 paid pages per tick
  (rest postponed), offline-abort. Honest UI text: the plugin is not a
  system service, catch-up happens at next opening.
  (D) QUALITY LOOP: page view underlines the stored low-confidence
  words (legend + Edit hint); "Suggest words from my library" under
  the glossary (src/core/store/glossarySuggest.ts: recurring unsure
  words + recurring proper nouns, stopword-filtered, tap-to-add).
  103 jest tests green; UI-TEXTS.md fully resynced (answers to the
  user's three R7c pricing questions inline).

> 📊 **Banc de reconnaissance manuscrite complet** (7 sources, 4 variantes
> deep-transcript, mesures recognizeElements, rating qualité/prix par page) :
> `docs/bench-ocr-2026-07-10/README.md`. Fonde la cascade v0.19.0 et les
> verdicts multi-provider / deep-transcript.

### Key facts learned (don't re-derive)

- **Prompt caching (`prompt_cache_key`) does NOT reduce bandwidth** — it only
  discounts server compute/billing for identical prefixes (~10%). The bytes are
  still uploaded every request. This is why "image-once" matters.
- Mistral hard limit: **8 images per request** across the whole conversation.
- Page numbers are **0-indexed** internally (`getCurrentPageNum`, `getElements`,
  `generateNotePng`), **1-indexed** in the UI. Off-by-one bugs live here.
- On-device OCR is weak on handwriting (`recLen=0` common) → default Page
  context = "Image only". The image-once "OCR sticky text" inherits this
  weakness (see roadmap).
- `generateNotePng` renders blank if ink isn't saved → `saveCurrentNote()` first.
- **`recognizeElements` is EXPENSIVE**: measured on the Manta (2026-07-10),
  ~6–30 s per page (avg ~11 s; density-dependent). Each call ships the full
  stroke data over IPC to a separate `PluginRecognitionService` process which
  runs the engine — it does NOT read the transcript stored by real-time
  recognition (no SDK API exposes that at all). The per-(note,page) OCR cache
  is what keeps multi-page usable; never clear it wholesale. Page render +
  base64 read is ~3.3 s/page (of which ~2.7 s is fetch(file://)+JS base64 —
  a native `readFileBase64` would cut that).
- Mistral quality levers measured on a hard cursive page: the dedicated
  `/v1/ocr` endpoint (1.3 s/page, ~0.1 c/page) and chat-vision each win on
  different lines (neither dominates); splitting the page into 2 half-images
  and a domain glossary in the persona both give real gains. Roadmap idea:
  use `/v1/ocr` as the multi-page transcript source instead of on-device OCR.

## Roadmap / next steps (pending)

**To test on device (v0.17.3, not yet user-verified):**
1. Whole note (5 pages) → ask 2–3 follow-ups → no "over 8", and the header
   `cached` counter should climb on later turns (stable prefix now caches).
2. Follow-up coherence ("translate that", "expand point 2") without re-sending
   images.
3. Weak-OCR case: if a page's OCR is empty, follow-ups lean on the assistant's
   prior answers — watch for context loss.
4. Re-confirm the 0.17.2 fixes: palm-on-border no longer closes; XL button
   reachable; Refresh shows "Refreshing…".

**Open design decisions (offered, not started):**
- **Softer settings UX:** tapping ⚙ currently closes the floating panel and
  opens the full-screen config (jarring; the panel must be re-opened manually).
  Option discussed: a small settings screen INSIDE the bubble (model / page
  context / size) with a "full config →" link, so the floating panel never
  disappears. NOT built.
- **Image handling variant:** the user chose "image-once + device OCR". If OCR
  proves too weak in testing, the fallback plan is "vision-transcribe once":
  first time a page is seen, ask the model itself for a faithful transcription,
  cache it locally by page hash, then use text forever. Higher quality, one
  extra call per new page. NOT built.

**Backlog (from SPEC §12, unchanged):** external files as context, note
insertion / export (SDK `pushElementsToClipboard` not yet exposed), persistent
chat history.

## State at hand-off

- Version **0.17.3** built, pushed to Manta, delivered, committed. Git clean.
- 46/46 jest tests pass; `tsc --noEmit` clean.
- Background logcat streams killed; scratchpad debug files removed.

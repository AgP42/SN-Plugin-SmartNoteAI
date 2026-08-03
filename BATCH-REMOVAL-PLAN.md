# Plan de suppression du mode BATCH — SmartNote AI

> Objectif : **un seul chemin de lecture, LIVE** (OCR 4 → Vision Ministral, par
> page, avec confidence/unsure-words). On retire **uniquement le transport
> batch** (~2000 lignes) ; le cerveau OCR→Vision (`readOne`/`readNotePages`
> dans `reading.ts`) est **intact**. Décidé avec Loïc 2026-07-22.
> **Budget dépense = géré par la console Mistral**, plus par le plugin.

---

## 0. Principe directeur
- **On garde** : `reading.ts` (OCR 4 puis Vision ALWAYS), le glossaire, la
  rotation auto, les confidence scores / unsure-words, `finishVisionLive`
  (re-lecture LIVE des pages OCR-only restées `mistral-ocr` = vision échouée),
  le `rateGovernor` (pacing 429).
- **On retire** : tout le pipeline batch (jobs, waves 1/2, upload/poll/collect,
  drain, persistance jobs), le mur 402, la double voie, les boutons batch.
- **Règle de sécurité** : à chaque phase, le projet **compile (tsc) et les
  tests passent** avant de continuer. On ne casse jamais la lecture.

---

## 1. Fichiers concernés (inventaire)

### À SUPPRIMER entièrement
| Fichier | Lignes | Contenu |
|---|---|---|
| `src/native/pretranscript.ts` | 1555 | jobs, waves, `drainVisionQueue`, `collectResults`, `finishVision`, `submitVisionWave`, `batchBlocked`… |
| `src/native/batchIo.ts` | 188 | `uploadBatchFile(Path)`, `createBatchJob`, `getBatchJob`, `cancelBatchJob`, `downloadFileContent` |
| `src/native/batchFileNative.ts` | 38 | builder JSONL natif (`appendBatchLine`) |
| tests : `pretranscript.test.ts`, parties batch de `batch.test.ts` | — | — |

### À DÉCOUPER (contiennent du partagé LIVE — NE PAS supprimer en bloc)
- **`src/core/model/batch.ts` (243 l.)** — mélange batch + partagé :
  - **GARDER (extraire vers `src/core/model/inflight.ts`)** : `markInFlightPages`,
    `markInFlightPdf`, `inFlightPages`, `isPdfInFlight`, `clearInFlight`
    → utilisés par `reading.ts` (shield anti-double-lecture LIVE). **Toujours utile**
    (deux lectures live concurrentes : Auto tick vs chat gather).
  - **SUPPRIMER** : `buildOcrImageBatchLine`, `buildVisionHintBatchLine`,
    `buildOcrPdfBatchLine`, `parseChatBatchResults`, `parseOcrBatchResults`,
    `OcrBatchResult`, `PendingJobLike`, `pendingSets`, `normalizeJobStatus`,
    `BatchJobStatus`, `BATCH_ENDPOINT_OCR/CHAT`, `BATCH_VISION_MODEL`.
    → `BATCH_VISION_MODEL` = `READER_MODEL` : remplacer les usages par
    `READER_MODEL` (déjà dans `src/core/model/reader.ts`).
- **`src/native/pretranscript.ts`** contient aussi **`listDirNative`** (util FS
  natif, PAS batch) importé par `autoTranscript.ts`.
  → **Extraire `listDirNative` vers `src/native/fs.ts`** AVANT de supprimer le fichier.

---

## 2. Consommateurs à retravailler

### `src/native/autoTranscript.ts`
- Retirer `import {listDirNative, loadJobs, collectResults} from './pretranscript'`
  (→ `listDirNative` depuis `fs.ts` ; `loadJobs`/`collectResults` supprimés).
- Supprimer **`maybeCollectBatch`** (l.196) + son `setInterval`/poke associé, et
  `COLLECT_GAP_MS`, `collectRunning`, `lastCollectAt`.
- Le tick Auto (`autoTranscriptTick`) : **inchangé sur la lecture LIVE**. On
  garde `firstFailReason` (v0.78.7). Voir §4 pour les caps.

### `src/native/gatherContext.ts`
- Retirer `import {pendingSets} from '../core/model/batch'` et
  `import {loadJobs} from './pretranscript'`.
- Supprimer les 2 blocs `pendingSets(await loadJobs()…)` (l.108, 171) : plus de
  notion « page en attente dans un job batch ». Une page est simplement **lue ou
  pas** (source dans le store). Simplifier la logique de contexte en conséquence
  (une page non lue = pas de transcript = ignorée / à lire à la demande).

### `screens/library/LibraryScreen.tsx` (grosse surface UI)
- **Imports à retirer** : `collectResults`, `cancelPendingJobs`, `finishVision`,
  `PtJob`, `loadJobs`. **Garder** `finishVisionLive`.
- **State à retirer** : `ptJobs`, `ptChecking`, `ptCancelling`, `confirmCancel`,
  `visionLiveArmed` (plus besoin de l'armement 402). **Garder** `pipe`
  (simplifié, §3), `finishingVision`.
- **Handlers à retirer** : `finishVisionNow` (batch), `cancelPending`, `ptCheck`.
  **Renommer** `finishVisionLiveNow` → `finishVisionNow` (le SEUL, live).
- **UI à retirer** : bouton « Run vision now » (batch)/armé, « Check results »,
  « Cancel jobs ». **Remplacer** par UN bouton clair **« ▶ Vision now (free) · N »**
  → `finishVisionLive` (relit les pages OCR-only en LIVE). `accountWallMsg`
  (401/429) reste utile ; **retirer la branche 402** (plus de batch).
- Retirer les `setPtJobs`/subscribe jobs (l.766, 1575) et le commentaire
  « batch status + Check results ».

---

## 3. Simplifier le pipeline d'état (`src/core/store/pipeline.ts` + `labels.ts`)
Aujourd'hui 5 étapes (queue / ocrOnGoing / ocrDone / visionOnGoing / done) dont
2 sont des états de **job batch** (`ocrOnGoing`, `visionOnGoing`).
- **Nouveau modèle, 3 états** :
  1. **À lire** (pas de transcript / page éditée) — ex-`queue`.
  2. **OCR seul** (`mistral-ocr` = vision échouée, à retenter) — ex-`ocrDone`.
  3. **Fait** (`medium`/`improved`/`user`).
- Supprimer `ocrOnGoing`/`visionOnGoing` (n'existent que via jobs). Adapter le
  cadre SYNC STATUS de la Library (v0.69) à 3 lignes.

---

## 4. (LIÉ) Simplifier les ticks/caps — décision séparée mais cohérente
Raisons d'origine des caps (100/tick, 15 min, 5000/session) :
1. Freeze UI → **obsolète** (rendu natif). 2. 429 → **géré par rateGovernor**.
3. Dépense → **gérée par la console Mistral** (décision Loïc).
→ **Les 3 raisons tombent.** Proposition :
- Retirer `MAX_PAGES_PER_TICK`, `MAX_PAGES_PER_SESSION`, `sessionPaidPages`, le
  message trompeur « session cap reached ».
- Laisser l'Auto **drainer en continu**, le **rateGovernor** étant le seul frein
  (rythme réseau). Cadence périodique conservée (`PERIODIC_MS`) juste comme
  battement de fond ; les pokes (édition, ouverture) déclenchent la lecture.
- ⚠️ **À valider séparément** — c'est un changement de comportement (l'Auto
  lira tout le backlog d'affilée). OK puisque budget = console.

---

## 5. Ordre d'exécution (chaque étape compile + teste)
1. **Extraire les partagés** : `listDirNative` → `fs.ts` ; inflight → `inflight.ts`.
   Repointer `reading.ts`, `autoTranscript.ts`. `tsc` + jest OK.
2. **Débrancher les consommateurs** : `gatherContext.ts` (retirer pendingSets/jobs),
   `autoTranscript.ts` (retirer maybeCollectBatch/collect), `LibraryScreen.tsx`
   (retirer boutons/handlers/state batch, garder le bouton Vision live). `tsc` OK.
3. **Supprimer les fichiers batch** : `pretranscript.ts`, `batchIo.ts`,
   `batchFileNative.ts`, parties batch de `batch.ts` + leurs tests. `tsc` OK.
4. **Simplifier le pipeline** (§3) : `pipeline.ts`, `labels.ts`, cadre SYNC STATUS.
5. **(Optionnel, §4)** simplifier les ticks/caps — sur ton GO séparé.
6. **Vérif finale** : `tsc --noEmit`, `jest` (toute la suite), build ×2, push
   Manta, test device (lecture live d'une note, unsure-words présents, pas de
   402/bouton batch résiduel).

---

## 6. Trade-offs assumés (rappel)
- **Prix plein** (pas de −50 % batch) → OK, budget géré console Mistral.
- **Plus d'async serveur** : le plugin doit rester actif pour drainer un gros
  backlog (vision live ~30/min, pacé par le governor). Sur gratuit le batch ne
  marchait pas de toute façon (402).
- **GAIN** : unsure-words partout, un seul chemin, plus de mur 402, ~2000 lignes
  en moins, plus de « cas où ».

---

## 7. Points à VÉRIFIER pendant l'implémentation (non tranchés ici)
- `settings.ts` : reste-t-il des champs batch (mode « batch » d'un dossier,
  `promptBlocks` pdf batch) ? Nettoyer si oui.
- `assemblePdfVisionPrompt` / prompts « batch » : encore utiles en live ? Sinon
  fusionner avec le prompt vision live.
- Le store `mistral-ocr` : garder comme état « vision à retenter » (le bouton
  Vision now + l'Auto s'en occupent) — cohérent avec §3.
- `conversationStore`/export : aucune dépendance batch attendue, à confirmer.

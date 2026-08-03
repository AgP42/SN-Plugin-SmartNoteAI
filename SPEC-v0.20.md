# SPEC v0.20 — « Transcript Store » : ingestion découplée de l'analyse

> **Statut : PROPOSITION** (2026-07-10, non implémentée). Fondée sur le banc
> noté par l'auteur et les mesures device du même jour —
> `docs/bench-ocr-2026-07-10/`. À discuter avant tout code.
>
> **Phasage réaligné le 2026-07-11 (décision utilisateur)** : la phase 1
> (v0.20) livre l'ARCHITECTURE COMPLÈTE — flow lecture→mémoire découplé du
> flow analyse — mais avec **UN SEUL moteur de lecture** : medium vision pour
> les `.note`, mistral-ocr pour les PDF. La cascade multi-étages, « Améliorer »,
> l'historique, « Corriger » et « Pre-transcript » sont DIFFÉRÉS aux phases
> suivantes, pas abandonnés. UI/UX : `SPEC-UI-v0.20.md`, alignée sur ce phasage.

## 1. Vision

Reconstruire la couche de transcription de Supernote, **en mieux** : chaque
page de chaque document est associée à un transcript « meilleure qualité
connue », persistant, avec provenance et chemin d'escalade. L'analyse (chat)
consomme ce store en texte pur. Les deux pipelines sont **découplés** — modèles,
déclenchement et coûts indépendants :

```
FLOW LECTURE (par page, une fois, cacheable, asynchrone)      — PHASE 1
  .note : PNG rendu ──► medium VISION + persona OCR (0,66 c$, ~3 s)
          page par page, 1 image/appel → la limite 8 images n'existe pas ici ;
          lit AUSSI les dessins (« dessin d'un brachiosaure » → cherchable)
  .pdf  : mistral-ocr, PDF ENTIER en 1 appel (12 p = 2,1 s mesuré)
  [hors-ligne : RECOGNTEXT gratuit, non persisté — dégradé, jamais bloqué]
                     │
                     ▼
       TranscriptStore persistant { texte, source, date, hash }

FLOW ANALYSE (par question, conversationnel)                  — PHASE 1
  question + transcripts (texte seul, étiquetés par note/page)
    ──► modèle de chat au choix : small / medium / large

ÉVOLUTIONS DU FLOW LECTURE (phases suivantes — différées, pas abandonnées)
  + moteur éco mistral-ocr+glossaire (0,5 c$)          — phase 2, option config
  + « Améliorer » medium+hint OCR (1,1 c$, 7,0/10)     — phase 2, escalade 1 tap
  + « Corriger » (source user, rang maximal)           — phase 2
  + option Sonnet (9,1/10, casse la story EU)          — vision
```

### Les étages retenus (décision utilisateur, notes vérité-terrain)

| # | Étage | Note /10 | Prix/page | Phase |
|---|---|---|---|---|
| 0 | OCR Supernote (RECOGNTEXT) | 2,4 | 0 | 1 — fallback hors-ligne + source « gratuit » en config |
| 1 | **medium vision + persona OCR** | **6,4** | 0,66 c$ | **1 — LE moteur de lecture `.note`** |
| 1b | mistral-ocr (PDF) | ~9-10 sur texte machine | 0,40 c$ | 1 — LE moteur PDF |
| 2 | mistral-ocr + glossaire Document AI | 4,4 → **5,2 mesuré** (11/07, glossaire device) | 0,44 c€ | livré v0.21+ — DÉFAUT depuis v0.22.7 |
| 3 | medium + hint OCR (« Améliorer ») | 7,0 | 1,10 c$ | 2 — escalade à la demande |
| 4 | Claude Sonnet 5 | 9,1 | 2,08 c$ | vision — non prioritaire |

## 2. Composants

### 2.1 TranscriptStore (nouveau)

- **Emplacement : répertoire privé du plugin** (`getPluginDirPath()`), sous
  `transcripts/`. **PAS dans MyStyle** (synchronisé vers le cloud Supernote —
  y mettre les transcripts uploaderait le contenu des notes en clair).
- Un JSON par document, clé = `FILE_ID` du `.note` (stable au rename) ;
  PDF = hash(chemin+taille). Entrées par page :
  `{ text, source: 'medium'|'mistral-ocr'|'improved'|'user'|'recogntext', at, hash }`
  (phase 1 : `medium` pour .note, `mistral-ocr` pour PDF ; les autres arrivent
  avec les phases suivantes).
- **`source: 'user'` — correction manuelle** (décision 2026-07-11) : le volet
  Transcript offre un mode « Corriger » où l'utilisateur édite le texte
  lui-même. C'est la source de rang MAXIMAL : jamais écrasée par Re-OCR ni
  « Améliorer » (ces boutons demandent confirmation explicite si une
  correction manuelle existe). Phasage : phase 2 (pas dans le cœur v0.20).
- **On ne persiste que ce qui a coûté de l'argent** (`medium`, `mistral-ocr`,
  `improved`) ou du travail (`user`). RECOGNTEXT se relit gratuitement à la
  demande.
- Invalidation par hash de page (nb d'éléments + adresse RECOGNTEXT).
  Écriture atomique (tmp + rename). Plafond LRU 5 Mo. Jamais d'images.
- ⚠️ Exclure `transcripts/` du nettoyage du janitor (`cleanupOldVersions`).
- Volume attendu : ~0,5-1 Ko/page → usage courant ≈ 150 Ko.

### 2.2 Flow lecture (ingestion)

**Phase 1 — un moteur par type de fichier :**

- `.note` : PNG rendu → `POST /v1/chat/completions` **medium vision**, page
  par page (1 image par appel — la limite 8 images ne s'applique jamais au
  flow lecture). Prompt = consigne de transcription + **persona OCR** (cf.
  ci-dessous). Multi-page : N appels d'une page, parallélisables par petits
  lots ; « Toute la note » devient N lectures + UNE question texte.
  **Mesuré 2026-07-11 (8 pages réelles, `docs/…/batch-8v1.json`)** :
  8×1 page en parallèle = 6,5 s / 3,72 c$ vs 1×8 images = 17,6 s / 3,63 c$
  — même coût (l'écart 2,4 % = persona répété), **2,7× plus rapide en
  parallèle**, et en prime granularité par page (store, retry, Stop).
  Batcher les images n'a AUCUN avantage.
  ⚠️ Fausse bonne idée écartée : envoyer les pages assemblées en PDF via
  `document_url` au chat (casserait la limite 8) — mesuré : 1 178 tokens
  d'entrée pour 8 pages = le modèle ne voit JAMAIS les pixels, Mistral OCRise
  le PDF côté serveur et le chat lit le texte de l'étage mistral-ocr
  (« Bus list », tickers massacrés) là où la vision lit ETH/SOL/HYPE/ZEC.
  C'est un moteur éco déguisé (~0,13 c$/p), pas de la vision
  (`docs/…/batch-pdf-medium.json`).
  Lit aussi les dessins (mesuré 2026-07-11 : « dinosaure de type
  Brachiosaurus » là où l'OCR voit une page blanche) — la description entre
  au store, cherchable et analysable.
- `.pdf` : le **fichier PDF directement** → `POST /v1/ocr` (fetch file:// →
  base64), plage de pages par extrait si besoin. Corrige le bug d'ordre du
  texte embarqué (multi-colonnes : association perdue — mesuré,
  `docs/bench…` annexe).
- Déclenchement : paresseux (première question sur la page) + préchargement
  léger (page courante ± voisines à l'ouverture du panneau). Le « sync tout »
  (Pre-transcript) est en v0.22.
- Perf à saisir : `readFileBase64` natif dans le module Kotlin (le rendu+lecture
  actuel = 3,3 s/page dont 2,7 s de fetch+base64 JS).

**Persona OCR — UNE description globale, éditable** (décisions 2026-07-11) :
distinct du persona de chat ; un seul champ où l'utilisateur empile tous ses
vocabulaires (perso + pro) — le mapping par zone est ABANDONNÉ : mesuré p33,
un glossaire mixte multi-sujets ne perturbe pas la lecture (le glossaire
biaise sans forcer, un terme absent de l'encre n'est pas halluciné).
- **Phase 1** : injecté comme system prompt de medium vision — un vrai
  prompt, aucune limite pratique.
- **Phase 2 (moteur éco mistral-ocr)** : injecté dans la `description` du
  schéma JSON des annotations Document AI. Limites mesurées : plafond dur =
  contexte du modèle d'annotation, **262 144 tokens** (erreur 3700 au-delà ;
  ~500 k chars passent) ; latence plate ≤ 10 k chars (3,3-3,4 s), puis croît
  (50 k : 3,8 s ; 500 k : 27 s) ; facturation CONFIRMÉE console La
  Plateforme (2026-07-11) : pas de composante token, MAIS l'annotation est
  un SKU séparé plus cher — OCR nu 3,40 €/1000 pages, OCR+annotation
  4,25 €/1000, déclenché par la PRÉSENCE de `document_annotation_format`
  dans la requête (glossaire vide ⇒ OMETTRE le paramètre — implémenté
  v0.22.5).
- Reco commune : viser ≤ 2 000 chars, plafonner l'UI à ~10 000.

### 2.3 Flow analyse

- Le chat est **texte seul** dès que le store couvre les pages demandées :
  en-têtes étiquetés par note/page (mécanique v0.18.1), cooling inchangé,
  prompt caching maximisé (préfixe texte stable).
- Réglage « Analyse » séparé du réglage « Transcription » (décisions
  utilisateur 2026-07-11) :
  - **Analyse** : picker `small / medium / large`, choix libre de
    l'utilisateur. Défaut : medium. (small = coût ÷10 sur transcript propre.)
  - **Transcription (source `.note`)** : picker — **dans la config, PAS dans
    la fenêtre de chat** (le chat reste épuré) ; pas de seuil d'escalade
    automatique, c'est ce réglage qui décide :
    - phase 1 : `OCR Supernote (gratuit, hors-ligne)` /
      `Mistral medium — vision (défaut, 0,66 c$/p)` ;
    - phase 2 : + `mistral-ocr + glossaire (éco, 0,5 c$/p)`.
- Coûts/latences : 1re question sur une page = lecture medium (~3 s ;
  0,66 c$) + chat texte (~2-3 s ; ~0,1 c$) ≈ équivalent au mode image
  actuel ; toutes les suivantes moins chères (600 tokens vs 2 400), et
  toute page déjà au store est gratuite à jamais (jusqu'à modification).

### 2.4 UI

**Spec détaillée : `SPEC-UI-v0.20.md`** (wireframes, flux, écrans — alignée
sur ce phasage). Résumé des invariants :

- **Chip de provenance** dans le header du panneau (`SN` / `MED` en phase 1 ;
  + `OCR`, `OCR+`, `USER` en phase 2) + date ; tap → volet Transcript
  (texte intégral, Copier, Relire).
- **Sélecteur de contexte à 3 items** : Cette page / Plage / Toute la note.
  PAS de mode « Image directe » : le moteur de lecture medium voit l'image
  (dessins inclus), la question A1 est fermée (cf. §5.1).
- Boutons « Améliorer » (pied de réponse + volet) et « Corriger » : phase 2.
- Stop / progression : mécanique v0.18.1 réutilisée telle quelle.

### 2.5 ConversationStore — historique et reprise des discussions (PHASE 2)

Deux notions distinctes : le **cache serveur** (`prompt_cache_key` Mistral,
économique et éphémère — n'est PAS de l'état) et la **persistance locale**,
qui est triviale grâce au cooling : après chaque réponse réussie, une
conversation est 100 % texte, autonome (transcripts sticky étiquetés par
note/page depuis v0.18.1). La persister = sérialiser `turns[]`.

- `plugin_dir/conversations/<id>.json` :
  `{ id, title (note + date), createdAt, updatedAt, turns, anchors, convId }`.
  Quelques Ko par conversation.
- **Sauvegarde auto après chaque tour** (tmp + rename) — plus aucune perte sur
  fermeture ou crash. « New chat » archive au lieu de détruire.
- **Reprise** : charger `turns`, continuer ; `contextSent` repart à zéro, le
  contexte frais s'ajoute avec son étiquette (mélange ancien/nouveau déjà géré).
  Premier tour de reprise : ré-envoi de l'historique texte (~1-3 Ko, négligeable),
  le cache serveur se réchauffe seul. Troncature/résumé des vieux tours :
  optimisation ultérieure si besoin.
- **UI** : bouton historique à côté de « New chat » (liste : titre, date, note
  d'origine → tap pour reprendre). Rétention 50 conversations / 90 jours.
- Mêmes règles que le TranscriptStore : répertoire privé (jamais MyStyle),
  exclu du janitor, local uniquement.
- Synergie v0.22 : les conversations rejoignent l'index FTS aux côtés des
  transcripts (« qu'avais-je conclu sur X ? » cherche notes + discussions).

### 2.6 Confidentialité et coûts

- Consentement explicite au premier envoi cloud d'un document (par document,
  mémorisé) ; exclusions par dossier pour les traitements de masse.
- Confirmation avec estimation de prix **au-delà de 100 pages** envoyées à
  l'OCR (décision 2026-07-11 ; prix constaté : 0,42 €/100 pages — même tarif
  par page pour manuscrit et PDF, la facturation est au `pages_processed`).
  En dessous : pas de dialogue, le coût passe dans la ligne de statut.
- Transcripts stockés localement uniquement (répertoire privé, non synchronisé).
- **Bouton « Effacer les données locales »** dans la config (transcripts +
  conversations), avec taille affichée (« 340 Ko, 87 pages, 12 conversations »).
  Nécessaire car la désinstallation ne nettoie PAS fiablement le répertoire
  privé — c'est précisément le bug d'empilement PluginHost que le janitor
  corrige pour les .npk ; nos données suivraient le même sort. Le janitor
  épargne `transcripts/` et `conversations/` ; ce bouton est le seul chemin
  d'effacement garanti.

## 3. Phasage

| Version | Contenu | Effort |
|---|---|---|
| **v0.19.1** (quick win, optionnel) | Défaut `pageSource` → **Image only** (le hint RECOGNTEXT coûte 1,2 pt — mesuré) ; `readFileBase64` natif. Peut être absorbé par la v0.20 si elle suit vite | 1 soirée |
| **v0.20.0 — PHASE 1** (cette spec) | L'architecture complète, un moteur par type : **TranscriptStore persistant** + lecture `.note` par **medium vision + persona OCR** (page par page) + lecture PDF par **`/v1/ocr`** + chat **texte seul** (picker small/medium/large) + sélecteur de contexte 3 items + **chip provenance + volet Transcript** (Copier / Relire) + consentement cloud + dialogue > 100 pages + section « Données locales » + fallback hors-ligne RECOGNTEXT | 2-3 soirées |
| **v0.20.1** (retours device du 2026-07-11, actés) | Icône réelle à la place des emoji du titre ; **clé API dans l'UI, chiffrée** (AES, secret device via `cryptoPbkdf2Sha256`/`cryptoRandomBytes` déjà présents dans le module natif) stockée dans le RÉPERTOIRE PRIVÉ (jamais MyStyle/cloud) avec migration douce depuis `mistral-key.txt` ; `max_tokens` supprimé (défauts internes) ; **config réorganisée en hub** (option B : accueil = état + Open + 4 portes : Connection & models / Personas & actions / Appearance / Data & privacy) ; **consentement cloud UNIQUE au premier lancement** (remplace le dialogue par document ; le dialogue > 100 pages reste ; Reset consents le réarme) | 1-2 soirées |
| **v0.21.0 — PHASE 2** | **Client `/v1/conversations`** + toggles **Web search** et **Code interpreter** (mesurés 2026-07-11 : inline sans agent, `store:false`, historique client via `inputs`, citations `tool_reference` ; recherche ~+1 c$ et +5 s quand déclenchée, le modèle décide seul ; code interpreter quasi gratuit — PnL/win rate/CAGR exécutés juste) + moteur éco `mistral-ocr + glossaire` (option config) + **« Améliorer »** + **« Corriger »** (source `user`) + **ConversationStore** (historique/reprise) | à spécifier |
| **v0.22.0 — PHASE 3** | **« Pre-transcript your Supernote » via l'API BATCH** (`/v1/batch` supporte `/v1/ocr` ET chat completions → lectures medium vision à **-50 %** : bibliothèque complète 4 759 p ≈ 16 $ en medium, ≈ 12 $ en éco ; JSONL par paquets ~150 pages, `custom_id` = doc+page → store ; upload puis LA TABLETTE PEUT S'ÉTEINDRE pendant le traitement — wifi requis seulement pour upload/download ; reprise garantie par le store) + navigateur de dossiers façon Dashboard (sélection, nb pages, coût, GO) + « Sync cette note » en arrière-plan + recherche locale (SQLite FTS, notes + conversations) + périmètre « dossier » | à spécifier |
| **v0.23+** | Chat avec tout l'historique (recherche-puis-réponse via **function calling** : `search_notes(query)` / `get_page(n)` déclarés au modèle, citations note+page) ; pont `insertKeyWord` (test device AVANT promesse) ; option provider Claude (~115 lignes) | vision |

### Décision finale moteurs (2026-07-12, « chemin 2 »)

DEUX choix utilisateur seulement, .note et PDF séparés :
`Supernote OCR (gratuit)` ou `Mistral OCR — smart` = OCR (+ annotation
`document_annotation_prompt` + contrat de champ + sanitizer quand le
glossaire est rempli) avec **escalade AUTOMATIQUE et silencieuse vers le
modèle vision** quand l'OCR doute (0 mot extrait, ou > 30 % de mots sous
0,8 de confiance par mot — signaux gratuits du même appel ; la confiance
par PAGE est inutilisable, mesuré). Escalade AUSSI pour les PDF
(décision 2026-07-12 : photos/figures de livres — pages rendues via
generateDocImage puis relues en vision ; ⚠ à valider device sur un PDF
non ouvert).
Mesuré sur 8 pages : mêmes déclenchements quels que soient les chemins ;
qualité moyenne chemin 2 = 5,9 vs 5,4 (nu) pour +0,88 €/1000 pages ;
1000 pages à 30 % d'escalade ≈ 5,61 € (batch −50 % ≈ 2,81 €). Les tables
manuscrites sortent quasi parfaites dans `pages[].tables` → fusionnées au
transcript depuis v0.22.8.

## 4. Non-objectifs / rejetés (avec preuves)

- **Écrire RECOGNTEXT dans les `.note`** : le firmware orphelinise nos blocs à
  la prochaine édition ; risque de corruption (écriture 30 Mo concurrente de
  l'app NOTE et du démon de sync) ; bounding-boxes des mots manquantes.
  → alternative : pont `insertKeyWord` (API officielle) + feature request
  Ratta (`setPageRecognText`).
- **« Deep transcript » systématique** (empilement d'indices) : l'ancrage
  dégrade précisément où la lecture est dure (diagonale, schémas) — mesuré
  4 variantes × 5 pages. Les indices ne s'ajoutent que sur demande (étage 3).
- **Hint RECOGNTEXT par défaut** : 5,2 vs 6,4 medium seul (notes utilisateur).
- **Haiku** : 2,4/10 + bloqué par le filtre de contenu même en structurel.
- **Transcription verbatim de livres via Claude** : filtre de contenu API
  (mesuré 3/3) — sans objet pour Mistral et pour les usages résumé/Q&A.
- **Document QnA Mistral** (`document_url` dans le chat) : OCR côté serveur
  puis LLM sur le TEXTE — le modèle ne voit jamais les pixels (mesuré :
  1 178 tokens d'entrée pour 8 pages vs 19 000 en vision ; qualité
  manuscrite retombe à l'étage OCR, tickers massacrés). Pour les PDF,
  strictement dominé par notre route v0.20 (même OCR, payé UNE fois,
  persisté) — Document QnA re-traiterait le document à chaque conversation.
- **Document Library Mistral** (RAG hébergé) : stockage PERMANENT des
  documents chez Mistral — contraire à la philosophie du plugin (store
  local, `store:false`, rien ne persiste côté serveur).

## 5. Questions ouvertes — décisions du 2026-07-11

1. **Modes / place de l'image : FERMÉE le 2026-07-11.** Le réglage 3-états
   disparaît et il n'y a NI mode « Image directe » NI fallback : avec medium
   vision comme moteur de lecture, l'image est vue par un vrai modèle de chat
   vision au moment de la lecture — dessins inclus. Preuve (test « pages
   dessin », `docs/bench-ocr-2026-07-10/plugindev-annot.json`) : sur p7/p8
   (dinosaure/smiley), l'OCR+annotations est aveugle (« page blanche », et
   hallucine), le canal `bbox` lit mal (« escargot »), medium vision lit
   juste (« dinosaure de type Brachiosaurus »). La description du dessin
   entre au store et le flow analyse y répond en texte. Sélecteur de
   contexte : 3 items. ACTÉ.
2. Analyse : picker `small / medium / large` au choix de l'utilisateur
   (défaut medium). ACTÉ — pas de banc préalable requis.
3. Pas de seuil automatique : la source (OCR Supernote / OCR Mistral) est un
   réglage de CONFIG choisi par l'utilisateur, le chat reste épuré. ACTÉ.
4. `insertKeyWord` : roadmap seulement, test device avant promesse. ACTÉ.
5. « Transcribe all » = mode du plugin dans la config : « Pre-transcript
   your Supernote » (cf. phasage v0.22). ACTÉ.

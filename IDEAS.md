# SmartNote AI — Idea Box 💡

> Backlog d'idées validées ou à creuser, par-dessus la base v0.22.8
> (bibliothèque de transcripts locale, PAGEIDs stables, provenance,
> conversations persistées, batch −50 %, connecteurs web/code).
> Rien ici n'est engagé tant que ce n'est pas passé dans SPEC + phasage.

## 1 · Exploiter la bibliothèque

- **Recherche locale avancée** (le socle — candidate v0.23) : FTS SQLite,
  instantanée, hors-ligne, sur TOUS les transcripts + les conversations
  archivées. Filtres dossier/carnet/date/source. Tolérance aux fautes
  quasi obligatoire (l'OCR écrit « Bag list », on cherche « bug list »).
  Résultats en tuiles avec extrait surligné → tap = transcript complet.
- **Sessions de correction des mots « unsure »** (user 2026-07-19) :
  retrouver facilement les pages qui contiennent encore des mots
  soulignés (filtre/liste dans la Library, compteur par note, tri par
  nombre de mots douteux) → enchaîner les corrections manuelles tap par
  tap. Le compteur par page utilise déjà `matchedLowWords` (v0.62.2) —
  l'agrégation par note est le morceau restant.
- **Extraction de tâches** : détection locale des ☐, «→ faire», listes
  d'action dans les transcripts → panneau TODO consolidé multi-carnets,
  avec lien vers la page d'origine. Zéro IA, grosse valeur PM.
- **Sommaire automatique par carnet** : titre/première ligne de chaque
  page → table des matières consultable (un jour exportable en page de
  garde du carnet).
- **Tags manuscrits** : indexer les `#tags` écrits à la main →
  collections automatiques gratuites.
- **Recherche sémantique** (option de luxe, complément du FTS) :
  embeddings Mistral (~coût one-shot négligeable/page), vecteurs stockés
  localement — « retrouve mes réflexions sur la gestion du risque » sans
  le mot exact.

## 2 · Améliorer la bibliothèque (cercle vertueux)

- **Surlignage des mots douteux** dans le volet Transcript : on a déjà
  la confiance PAR MOT et les bounding boxes des blocs — tap sur un mot
  suspect → correction → source `Edited`. La bibliothèque s'affine à
  l'usage.
- **Glossaire auto-enrichi** : analyse de fréquence locale des mots
  inconnus récurrents (« Solveig » ×40 mais absent du glossaire ?) →
  suggestion d'ajout en un tap. Sans IA ; améliore toutes les lectures
  futures.
- **Persister les résultats `recognizeElements`** (source `Device`) :
  le moteur gratuit re-paye aujourd'hui 6-30 s/page à chaque session —
  le stocker donnerait le « lu une fois » au chemin gratuit aussi.
- **Purge des documents orphelins** : au refresh de la Library, vérifier
  l'existence des fichiers (listDir natif) → notes supprimées affichées
  `(deleted)` ou auto-purgées. (Les PAGES supprimées sont déjà gérées par
  le remap PAGEID v0.22.4.)

## 3 · Faire sortir la donnée

- **Export `.md`/`.txt`** d'une note entière (ou d'une sélection de
  pages) vers un dossier / le presse-papier — débloque tout le reste.
- **Digest hebdo** : « résume ce que j'ai écrit cette semaine » — un
  bouton, les transcripts de la semaine (déjà payés), ~0,5 c€.
- **Intégrations directes, tokens sur la tablette** (privacy-first) :
  - **GitHub** : commit du `.md` dans un repo (= pont Obsidian pour un
    vault git-syncé : « envoie ce MoM sur Obsidian »). ~30 lignes.
  - **Notion** : création de page via l'API Notion, token chiffré
    device-side comme la clé Mistral. ~30 lignes.
  - Obsidian sans réseau : export dossier + Syncthing.
- **Connectors Mistral (MCP) via l'API** — le mode « je parle, il
  agit » : les connecteurs du catalogue (Notion, GitHub, Gmail, Slack,
  Jira…) passés dans `tools` de `/v1/conversations` ; le modèle rédige
  ET exécute. Public Preview ; ⚠ à tester empiriquement (les connecteurs
  catalogue OAuth-és au compte sont-ils exposés à l'API ?) ; ⚠ trade-off
  privacy : contenu + tokens transitent par Mistral. Escalier retenu :
  export local → intégrations directes → MCP.

## Layout v0.23 — READ au centre, features en tabs (validé sur croquis
## manuscrit du 2026-07-12, raffiné avec l'auteur)

```
┌──────────────────────────────────────────────┐
│ ⠿ SmartNote AI            [⚙][snaps][–][✕]   │
│ [▢12] Pelican.note · [ Transcript: OCR ✓ ]   │ ← bande READ : miniature
│ Scope: [Page][Range][Note][All]        [⟳]   │   adaptée au scope (rectangle
├──────────────────────────────────────────────┤   + nb pages en multi),
│ [ CHAT ] [ SEARCH ] [ EXPORT ] (+AGENT, …)   │   bouton Transcript GROS
├──────────────────────────────────────────────┤
│ contenu du tab actif                         │
│ CHAT: messages + quick actions + [🕘][New]   │
│       input épinglé en bas                   │
│ SEARCH: [champ 🔍] — respecte le Scope,      │
│       'All' = toute la bibliothèque          │
│ EXPORT: format/destination — respecte Scope  │
└──────────────────────────────────────────────┘
```
Décisions : le Scope (Page/Range/Note/All) vit dans la bande READ et
s'applique à TOUS les tabs (SEARCH y a droit aussi — décision auteur) ;
'All' n'a de sens que pour SEARCH/EXPORT au début (CHAT-All = Ask my
Supernote, plus tard). Le volet Transcript suit le scope (fait en
v0.22.14 : sections par page, x/N read). ⟳ = « je viens d'écrire sur
cette page » ; le changement de page est suivi automatiquement et ne
déclenche JAMAIS de lecture payante (les lectures partent à la
question). Tabs futurs : AGENT (espaces docs+persona dédiés),
AutoAction on Notes (déclencheurs).

- **Décrire les photos/figures DANS les pages PDF** (trouvé au banc
  2026-07-12) : une page de texte confiant n'escalade jamais, donc ses
  photos (placeholders `![...]` de l'OCR) sont silencieusement jetées.
  Déclencheur possible : placeholder image présent → un appel vision
  ciblé (quasi gratuit avec ministral) → description insérée à la place
  du placeholder. À chiffrer/tester avant promesse.

## 4 · Vision (déjà au phasage)

- **« Ask my Supernote »** (v0.23) : chat sur toute la bibliothèque en
  recherche-puis-réponse — la FTS trouve les pages candidates, seules
  elles partent au modèle, réponse avec citations carnet+page. Version
  function-calling : le modèle appelle `search_notes()` / `get_page()`.
- **Pre-transcript 2 vagues** : aligner le batch sur le « chemin 2 »
  (vague OCR → collecte → vague vision sur les pages signalées) au lieu
  du tout-vision actuel.
- **Pont recherche native** : `insertKeyWord` (test device des limites
  AVANT promesse).
- **Option provider Claude** (~115 lignes, façon ProviderClient) —
  Sonnet 9,1/10 au banc, mais casse la story EU.
- **i18n** de l'UI (skill Pattern 12).

## Divers / petit

- Ligne de soutien Ko-fi dans la config (H8 — texte validé, QR code
  suggéré) : https://ko-fi.com/agp42
- Stats d'écriture (pages/jour, carnets actifs) — gadget sympathique.
- Traduction d'une note entière stockée en transcript parallèle.
- Export/backup chiffré de la bibliothèque vers PC.

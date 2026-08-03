# SmartPaper — spec v1

Assistant IA pour Supernote, **repensé proprement** (successeur mental
de sn-copilot, sans son architecture). Focus : **Mistral AI** (privacy
UE), **fenêtre flottante** (façon Dashboard AgP), **contexte explicite**,
et **résultats qui reviennent dans la note**.

> Document de conception — à relire/amender AVANT scaffolding. Aucun
> code tant que la spec n'est pas validée.

---

## 1. Principes directeurs (ce qu'on corrige de sn-copilot)

| sn-copilot (patché) | SmartPaper (pensé dès le début) |
|---|---|
| Panneau fixe qui bloque ½ écran | **Bulle flottante** déplaçable, redimensionnable, plein écran, repliable |
| Menu note → ouvre le plugin fonctionnel | Menu note → **page de config seulement** ; le fonctionnel vit dans la bulle, accessible partout/tout le temps |
| Contexte deviné par regex de formulation | **Context tray explicite et visible** : tu vois et choisis ce qui part |
| Réponse = chat éphémère à copier | Réponse = **actions** : copier / **insérer dans la note** / exporter |
| Multi-provider bricolé | **Mistral seul**, sélecteur de modèles Mistral + champ libre |
| État/logique entremêlés dans l'UI | **Couches séparées et testables** (voir §9) |

**Non-objectifs v1** (pour rester réaliste) : pas de multi-carnets
(recherche transversale), pas de suite productivité (extraction tâches
auto, calendrier, compose email), pas de vocal. Notés en §10 pour plus
tard.

---

## 2. Deux points d'entrée distincts

```
┌─────────────────────────────────────────────────────────────┐
│  NOTE app → menu → Plugins → SmartPaper                          │
│        │                                                     │
│        ▼                                                     │
│  ┌──────────────────┐        showType:1 (plein écran)        │
│  │  PAGE DE CONFIG  │  ← clé API Mistral, modèle, persona,  │
│  │  (settings only) │    actions custom, taille bulle défaut │
│  └──────────────────┘    + bouton "Lancer SmartPaper"            │
│                                                              │
│  ┌──────────────────┐        overlay natif (persistant)      │
│  │  BULLE FLOTTANTE │  ← l'assistant fonctionnel, dispo      │
│  │  (le vrai plugin)│    par-dessus n'importe quelle note   │
│  └──────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

- **Page de config** (`showType:1`) : ouverte depuis le menu Plugins.
  Sert UNIQUEMENT à configurer (clé, modèle, persona, actions, prefs).
  Ne fait pas d'IA. Ferme et rend la main à la note.
- **Bulle flottante** (overlay `TYPE_APPLICATION_OVERLAY`) : lancée
  **depuis la config uniquement** (bouton "Lancer"), elle **survit à la
  fermeture** du plugin et flotte au-dessus de la note courante. C'est
  l'assistant réel. Réutilise la mécanique overlay du Dashboard.
- **Un seul bouton dans la barre de notes** (contrainte device : pas de
  2e bouton possible) → il ouvre la CONFIG. La bulle se lance depuis la
  config. Exactement le modèle du Dashboard. (DÉCIDÉ Q2.)

---

## 3. La fenêtre flottante — états & gestes

```
   (bulle)            (panneau)              (plein écran)
   ┌────┐            ┌───────────────┐      ┌───────────────────┐
   │ ✦ │  ──tap──▶  │ SmartPaper      ⤡ ✕│      │ SmartPaper          ⤡ ✕│
   └────┘            │ [context tray]│      │                   │
     ▲               │  ...chat...   │      │    ...chat...      │
     └───collapse────│ [saisie]  ➤  │      │                   │
                     └───────────────┘      │ [saisie]      ➤   │
                       ↑ drag header         └───────────────────┘
                       ↕ resize (coin ⤡)
```

- **Bulle** : petit rond ✦ déplaçable, toujours au-dessus. Tap → ouvre
  le panneau. La note reste pleinement utilisable derrière/autour.
- **Panneau** : header (drag pour déplacer), poignée coin (⤡ resize),
  bouton plein écran, bouton repli-en-bulle (pas juste ✕).
- **Plein écran** : pour lire une longue réponse ou travailler dense.
- **Persistance** : position + taille + dernier état mémorisés (prefs).
- Contrainte technique connue : voir skill `floating-window.md` +
  `pen-emr.md` (l'overlay ne gate qu'un des deux pipelines pen — si on
  dessine DANS SmartPaper il faut le full-screen EMR disable ; sinon inutile
  ici car on ne dessine pas dans SmartPaper).

---

## 4. Le Context Tray (cœur du "flow intelligent")

Remplace la regex devinette. Une **barre de contexte explicite** en
haut du panneau : chaque source est une pastille visible, cliquable,
avec estimation de coût. Ce qui est **sélectionné** part ; le reste non.

```
┌─ Context ───────────────────────────────────────── ~2.4k tok ─┐
│  [🖼 page courante ✓]  [📄 p.3-7]  [+ page]  [📎 fichier]      │
└───────────────────────────────────────────────────────────────┘
```

Sources (correspond à tes réponses de cadrage) :
1. **Page courante** — vignette de la capture (image + OCR firmware).
   Rafraîchie à la demande (pas de polling — leçon apprise). Toggle.
2. **Plage / note entière** — sélectionner p.3-7 ou tout le carnet.
   PDF → envoyé nativement à Mistral (Pixtral/Small lisent le PDF) ;
   .note → N rendus PNG (plafond, message si dépassé).
3. **Fichiers externes** — mini-explorateur (logique browser du
   Dashboard) → .txt/.json/.md (inline texte) / .pdf (document) /
   images (image block).

Règles :
- **Estimation de tokens** affichée en direct (image ≈ tokens fixes,
  texte ≈ len/4, PDF ≈ pages × ~N). Confirmation si > seuil (~20k).
- **Mémoire d'image** : une image jointe reste dans l'historique et est
  rejouée aux tours suivants (le modèle garde le contexte visuel) —
  cap 5, économisé par le prompt caching. (= l'ancien B1b, mais intégré
  dès le départ, pas patché.)
- **Quick actions** attachent toujours la page courante par nature ;
  le tray sert au chat libre + ajout de sources. Actions par défaut =
  celles de copilot (Translate, Grab ToDos, MoM, Clarifier, Challenger,
  Schema) + **Grill** (quiz/révision devient une action custom, pas une
  feature à part — DÉCIDÉ Q6). L'utilisateur peut **écrire ses propres
  prompts d'action** (fichier `custom_actions.txt`) EN PLUS du system
  prompt / persona (DÉCIDÉ Q5).
- **Privacy** : le tray EST le contrôle privacy — tu vois exactement ce
  qui quitte la tablette avant d'envoyer. Bandeau : "envoyé à Mistral
  (UE)".

---

## 5. Couche modèle — Mistral

- **API Mistral** (`api.mistral.ai`, compatible OpenAI → client simple).
- **Vision requise** (on envoie des pages en image). Modèles curés :

| Modèle | Rôle proposé | $/M in-out | Vision |
|---|---|---|---|
| `mistral-small-latest` (Small 4) | **défaut** | ~0.15 / 0.60 | ✅ |
| `mistral-small-3.2` | volume / Grill (moins cher) | ~0.08 / 0.20 | ✅ |
| `pixtral-12b` | option open-source (Apache 2.0) | ~0.15 flat | ✅ |
| `mistral-medium-latest` | analyse plus fine | intermédiaire | ✅ |

  (IDs exacts à re-vérifier au code — Mistral versionne ; `-latest`
  alias + champ libre.)
- **Sélecteur** : pastilles (sous le champ libre — leçon apprise) +
  champ libre. Éditable dans la config, écrit dans le fichier de clé.
- **Clé** : `MyStyle/SmartPaper/mistral-key.txt` (`key=...`, `model=...`,
  `max_tokens=...`). Chiffrement : **hors scope v1** (le vault de
  copilot a été un puits à bugs ; on reste plaintext, documenté).
- Config par tâche possible plus tard (`model_chat` / `model_bulk`).

---

## 6. Flow utilisateur de bout en bout

```
1. Installe SmartPaper → menu Plugins → CONFIG : colle la clé Mistral,
   choisis le modèle (défaut Small 4), (option) persona + actions.
2. "Lancer SmartPaper" → la BULLE ✦ apparaît, la config se ferme.
3. Travaille normalement dans tes notes. La bulle flotte.
4. Besoin de l'IA → tap la bulle → PANNEAU.
5. CONTEXT TRAY : la page courante est proposée (vignette). J'ajoute
   éventuellement p.3-7 ou un fichier. Je vois l'estimation de coût.
6. Soit une QUICK ACTION (Résumé/Traduis/…), soit je tape une question.
   → envoi à Mistral avec le contexte sélectionné.
7. RÉPONSE dans le chat. Sous la réponse : [📋 Copier] (v1).
8. Je crée une "New Text Box" dans ma note et je colle. (Insertion
   auto + export = plus tard, §10.)
9. Je replie en bulle. La conversation persiste. Je peux rouvrir plus
   tard, changer de note — SmartPaper suit.
```

Schéma d'état de la conversation :

```
  idle ──tap bulle──▶ panneau ──envoi──▶ pending ──réponse──▶ réponse+actions
    ▲                    │                                        │
    └───── repli ────────┴───────────────── nouveau tour ◀────────┘
```

---

## 7. Sortie des réponses — v1 = Copier seulement (DÉCIDÉ Q3)

v1 volontairement minimal et fiable : sous chaque réponse, **un seul
bouton [📋 Copier]**. L'utilisateur crée ensuite une "New Text Box"
dans sa note et **colle lui-même**. Pas d'insertion automatique, pas
d'export en v1 — on ne prend AUCUN risque sur l'écriture dans le
fichier note pour le premier jet.

⚠️ **Constrainte connue (bug SuperTemplate)** : un gros buffer de
texte qui ne se vidait pas. Le mécanisme de copie DOIT :
- écrire dans le presse-papier système proprement (pas un buffer
  interne persistant),
- se réinitialiser à chaque copie (ne pas accumuler / ne pas garder le
  texte précédent),
- tester avec de longues réponses (plusieurs Ko) que rien ne reste
  bloqué en mémoire.
Réutiliser/valider le pattern copie qui MARCHE (pas celui de
SuperTemplate). À cadrer précisément avant de coder cette partie.

Insertion auto dans la note + export fichier → **backlog** (§10),
seulement une fois le v1 stable et le bug buffer compris.

---

## 8. Données & privacy (argument central)

```
  [Page/fichiers] ──sélection explicite (tray)──▶ [aperçu coût]
        │
        ▼ (envoi UNIQUEMENT de ce qui est sélectionné)
  api.mistral.ai (UE, GDPR natif, pas d'entraînement sur API payante,
  rétention 30j anti-abus) ──▶ réponse
        │
        ▼
  [chat] → copier / insérer / exporter (reste sur la tablette)
```

- Rien n'est envoyé sans sélection visible dans le tray.
- Clé stockée en local (plaintext v1, documenté ; chiffrement plus tard
  seulement si repensé proprement).
- Pas de télémétrie. Logs locaux uniquement.

---

## 9. Architecture logicielle (couches propres et testables)

Ce qui manquait à copilot : une séparation nette. Modules purs testés,
UI mince par-dessus.

```
  ┌─────────────────── UI (React Native) ───────────────────┐
  │  FloatingWindow (bulle/panneau/resize) · ConfigPage      │
  │  ContextTray · ChatView · ResponseActions               │
  └───────────────┬─────────────────────────────────────────┘
                  │ (hooks minces, pas de logique métier)
  ┌───────────────▼─────────────────────────────────────────┐
  │  CORE (pur, testable, zéro import RN/SDK)                │
  │  • context/   : sélection sources → blocs de requête     │
  │  • model/     : client Mistral (envoi, historique, cache)│
  │  • convo/     : machine à états conversation + persist.  │
  │  • output/    : formatage insert / export                │
  │  • config/    : parse clé/modèle/persona/actions         │
  └───────────────┬─────────────────────────────────────────┘
                  │ (interfaces injectées — fakes en test)
  ┌───────────────▼─────────────────────────────────────────┐
  │  NATIVE / SDK (isolé derrière des interfaces)           │
  │  capture page · rendu PNG/PDF · insertText · fichiers ·  │
  │  overlay WindowManager (Kotlin, réutilisé du Dashboard)  │
  └─────────────────────────────────────────────────────────┘
```

Principe : le CORE ne connaît ni RN ni sn-plugin-lib (comme la couche
`storage`/`appState` de copilot qui, elle, était propre). Tout le SDK
passe par des interfaces injectées → tests avec des fakes, pas de
bridge natif en test. Caching prompt activé dès le départ.

---

## 10. Hors scope v1 (backlog assumé)

- **Insertion auto dans la note** + **export fichier** (repoussés du
  v1 : d'abord Copier seulement, cf. §7 et le bug buffer SuperTemplate).
- Multi-carnets / recherche transversale ("Ask Notebooks").
- Extraction de tâches automatique, sync calendrier, compose email.
- Entrée vocale.
- Chiffrement de la clé (seulement si repensé proprement, vu l'échec
  copilot).
- Routage multi-modèle par tâche (chat vs bulk).
- Insertion multi-pages / insertion en manuscrit.

---

## 11. Questions ouvertes (à trancher avant scaffolding)

Q1. RESOLU : **SmartPaper**. ("Smart" sous-entend l'IA ; distinct de
    Viwoods "AiPaper" ; scannable.)
Q2. ✅ RÉSOLU : 1 bouton barre de notes → config ; config lance la
    bulle. Modèle Dashboard.
Q3. ✅ RÉSOLU : v1 = bouton Copier seulement, l'utilisateur colle dans
    une New Text Box. Attention bug buffer SuperTemplate (§7).
Q4. **Device cible** : Manta d'abord (comme copilot) — à confirmer.
Q5. ✅ RÉSOLU : actions par défaut de copilot + prompts custom user.
Q6. ✅ RÉSOLU : Grill = une action custom (pas une feature séparée).

---

## 12. Ordre de build v1 (milestones testables)

Chaque milestone = un build pousse sur le Manta et teste, comme pour
copilot. On ne code pas tout d'un coup.

- **M0 - Scaffold** : `npx ... init smartpaper` (template 0.79.2),
  PluginConfig.json (pluginKey), build "hello" qui s'installe et
  s'affiche. Verifier le bug reactPackages (build x2). La fondation.
- **M1 - Config + client Mistral (CORE)** : page de config (bouton
  barre de notes -> config), lecture `mistral-key.txt`, selecteur de
  modele. Module `model/` (client Mistral pur, teste avec fake fetch) +
  bouton "Test connexion". PROUVE que la cle Mistral marche.
- **M2 - Chat minimal (dans la config d'abord)** : capture page +
  envoi a Mistral (vision) + reponse + bouton Copier propre (attention
  buffer §7). PROUVE le flow IA de bout en bout, avant la fenetre
  flottante.
- **M3 - Fenetre flottante** : overlay natif (repris du Dashboard),
  bulle ✦ <-> panneau, drag + resize + plein ecran + repli. Migre le
  chat M2 dans la bulle. Le gros morceau natif.
- **M4 - Context tray** : page courante (vignette), ajout plage/note,
  fichiers externes, estimation tokens, memoire d'image.
- **M5 - Actions & persona** : quick actions par defaut + custom_actions
  .txt + persona/system prompt. Grill comme action custom.
- **M6 - Polish** : persistance position/taille, conversation persistee,
  janitor (anti-stacking des le debut), prompt caching.

Backlog post-v1 : insertion auto note, export fichier, multi-modele par
tache, chiffrement (si repense), multi-carnets, vocal.

---

## 13. Backlog / Roadmap post-v1 (à jour 2026-07-09)

État : **v0.5.0** livrée et validée device. Renommée **SuperMistralAI**.
Fait : config+clé, chat+capture vision, bulle flottante (drag/resize/
collapse/plein écran), actions rapides, persona, persistance
(settings.json), janitor, auto-open, perf (image 1er tour), taille texte
S/M/L/XL, context tray (page/plage/note). Phase en cours : **usage réel
pour remonter bugs & irritants** avant de reprendre les features.

### 13.1 ⭐ v2 « Agents + Document Library » (Mistral server-side)
La grosse évolution d'archi envisagée. Deux volets liés :
- **Agents Mistral** : définir modèle + system prompt (persona) + outils
  côté console, appelés par `agent_id`. Le plugin route selon le contexte
  (Summarize → agent Résumeur, Grill → agent Tuteur, …) au lieu
  d'embarquer le prompt. Prompts centralisés, éditables sans rebuild.
- **Document Library (RAG)** : téléverser un corpus de référence
  (manuel, glossaire, anciennes notes) dans une library Mistral, attachée
  à un agent → réponses fondées sur **la page courante (context tray) +
  la doc de référence**. Indexation/retrieval gérés par Mistral (rien à
  faire côté plugin). Complémentaire du context tray (éphémère) : la
  library est le savoir de fond **persistant**.
- **Contrainte clé** : agents + libraries sont **liés au workspace du
  compte** → non portables si le plugin est partagé. Donc concevoir en
  **double mode** : « clé simple » (actuel, portable, BYOK) **+** « agent_id
  + library » (perso, avancé). Coût token en hausse (RAG). Privacy : les
  docs de référence vivent sur les serveurs Mistral (opt-out à vérifier).
- Pas d'API publique de solde/crédit → suivi conso = compteur local via
  le champ `usage` des réponses (cf. 13.2).

### 13.2 Autres pistes (par valeur/effort, à trier avec l'user)
- **Historique persistant** : reprendre une conversation après fermeture
  (infra settings.json déjà là). *Valeur haute, effort moyen.*
- **Actions rapides éditables** par l'utilisateur (ajouter/modifier ses
  boutons, pas seulement le set par défaut). *Effort faible.*
- **1ère réponse plus rapide** : OCR paresseux (envoyer l'image tout de
  suite, OCR en tâche de fond) — attaque la latence du tout 1er message.
- **Compteur de tokens / coût estimé** sous chaque réponse (depuis le
  champ `usage` renvoyé par l'API). Prévient avant la limite de crédit.
- **Réponses en streaming** (ressenti plus rapide ; RN fetch = non
  trivial à streamer).
- **Fichiers externes** comme contexte (2e moitié du context tray :
  joindre .txt/.md/image).
- **Insertion directe dans la note** : ⚠️ BLOQUÉ — SDK
  `pushElementsToClipboard` pas encore exposé par Ratta. Contournement =
  bouton Copier natif (déjà là). À rouvrir quand le SDK l'expose.
- **Export / partage** d'une réponse (fichier ou partage Android).
- Robustesse : invalidation du cache OCR quand une page est éditée,
  meilleurs messages d'erreur.

### 13.3 Hors scope (décidé)
Multi-carnets, chiffrement de la clé.

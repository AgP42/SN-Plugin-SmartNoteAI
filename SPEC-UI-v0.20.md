# SPEC UI/UX v0.20 — surfaces, flux et écrans

> **Statut : PROPOSITION** (2026-07-11). Déclinaison UI de `SPEC-v0.20.md`
> (architecture TranscriptStore / flows lecture+analyse découplés). Même
> règle : à discuter avant tout code. Les wireframes sont normatifs pour la
> structure, pas pour le pixel.
>
> **Alignée sur le phasage réaligné du 2026-07-11** : phase 1 (v0.20) =
> architecture complète, UN moteur de lecture (medium vision `.note` /
> mistral-ocr PDF). Les éléments marqués **(v0.21)** ou **(v0.22)** sont
> spécifiés ici mais livrés dans ces phases.

## 0. Principes (e-ink d'abord)

1. **E-ink first.** Pas d'animation, pas de spinner (texte de progression),
   pas de gris sur gris, bordures franches 1-2 px, cibles tactiles ≥ 44 px.
   Pas de long-press comme geste porteur de sens (leçon Dashboard : trop
   d'appuis fantômes sur e-ink) — tout est tap simple sur un élément visible.
2. **Le coût est toujours visible AVANT d'être dépensé.** Toute action qui
   appelle le cloud affiche son estimation dans le bouton même
   (« Améliorer ≈ 1,1 c$ ») ; toute opération multi-page passe par un
   dialogue d'estimation. Après la réponse, le coût réel s'affiche discret.
3. **La provenance est toujours visible.** L'utilisateur sait d'un coup
   d'œil sur quel texte le modèle raisonne (lu par medium / SN brut ; puis
   OCR éco / amélioré / corrigé main en phase 2) et de quand il date.
4. **Une action = un tap.** Le quotidien (poser une question sur la page
   courante) ne demande aucun réglage ; l'escalade qualité est à un tap ;
   la configuration est ailleurs (page config), jamais dans le panneau.
5. **Ne jamais bloquer l'écriture.** Le panneau reste une bulle flottante
   déplaçable/réductible ; le stylo écrit derrière ; Stop est toujours
   accessible pendant une requête.

## 1. Cartographie des surfaces

| Surface | Existe ? | Rôle v0.20 |
|---|---|---|
| Bouton barre de notes | ✅ | inchangé — ouvre la bulle |
| Bulle flottante (Bubble) | ✅ | inchangé — drag / resize / collapse / plein écran |
| Panneau de chat (ChatPanel) | ✅ | + chip provenance, + volet transcript ; + historique (v0.21) |
| Page de configuration (App) | ✅ | réorganisée en sections (cf. §5) |
| Sous-page Prompts & actions | ✅ | + champ **Persona OCR** (le 2ᵉ persona, cf. §5.4) |
| Volet « Transcript » | 🆕 | voir/relire le transcript de la page (cf. §3) ; Améliorer/Corriger (v0.21) |
| Dialogue estimation multi-page | 🆕 | coût + durée avant lecture > 100 pages (cf. §4.3) |
| Dialogue consentement cloud | 🆕 | 1ᵉʳ envoi d'un document (cf. §4.4) |
| Volet « Historique » | 🆕 (v0.21) | liste + reprise des conversations (cf. §6) |
| Écran « Pre-transcript » | 🆕 (v0.22) | lecture de masse par dossier (cf. §5.7) |

## 2. Panneau de chat — structure

```
┌──────────────────────────────────────────────┐
│ [Page ▾]  [MED · 11/07]        [🕘] [–][▭][✕] │  ← header ([🕘] = v0.21)
├──────────────────────────────────────────────┤
│  Vous : « résume cette page »                │
│  IA   : …réponse…                            │
│         [Copier]                             │
│         ⚠ transcript SN — [Améliorer] (v0.21)│  ← pied de réponse conditionnel (v0.21)
│                                              │
│  (zone scrollable, ancrage par tour — v0.18) │
├──────────────────────────────────────────────┤
│ [Résumer][Traduire][Points clés][Expliquer]  │  ← quick actions (inchangé)
│ ┌──────────────────────────────┐ [Envoyer]   │
│ │ votre question…              │ ou [■ Stop] │  ← Stop remplace Envoyer si busy
│ └──────────────────────────────┘             │
│ reading p.12 (medium) · 2/5 · 1,3 c$         │  ← ligne de statut : progress v0.18.1
└──────────────────────────────────────────────┘    + coût de la REQUÊTE en cours
```

- Décision 2026-07-11 (U2) : **pas de compteur de coût de session**. Le coût
  n'apparaît que (a) dans les boutons d'action payants, (b) dans la ligne de
  statut pendant/pour la requête en cours, (c) dans le dialogue > 100 pages.
- **`[Page ▾]` — sélecteur de contexte** (remplace l'actuel) : tap → menu
  **3 items** : `Cette page` / `Plage…` / `Toute la note`. PAS de mode
  « Image directe » (A1 fermée : le moteur de lecture medium voit l'image,
  dessins inclus — archi §5.1). Le 3-états image / image+texte / texte
  disparaît de la config (acté) ; la SOURCE du transcript est un réglage de
  config (§5.2), jamais un contrôle du chat — le chat reste épuré (A3).
- **Chip provenance `[MED · 11/07]`** : état du transcript de la page
  courante. Phase 1 : `MED` (lu par medium vision) / `SN` (source Supernote
  choisie en config, ou hors-ligne) / `—` (pas encore lu). Phase 2 : + `OCR`
  (moteur éco), `OCR+` (amélioré), `USER` (corrigé main).
  Tap → volet Transcript (§3). Sur `Toute la note` : **agrégat**
  (`MED 38 · — 5`) — acté (U1).
- **`[🕘]` historique (v0.21)** : ouvre le volet Historique (§6). « New
  chat » actuel devient la première entrée du volet. En phase 1, le bouton
  « New chat » existant reste tel quel.
- **Pied de réponse conditionnel (v0.21)** : si la réponse a été produite
  sur un transcript faible (`SN`), une ligne d'escalade apparaît sous la
  réponse. Un tap améliore ET rejoue automatiquement la dernière question.
- **Ligne de statut** : progression par phases (mécanique v0.18.1 :
  `rendering / reading / analysing`) + coût de la requête en cours.

## 3. Volet « Transcript » (nouveau)

Ouvert par tap sur la chip provenance. Recouvre le panneau (pas de fenêtre
supplémentaire), fermeture par `✕` ou tap hors volet.

```
┌──────────────────────────────────────────────┐
│ Transcript — p. 33/42 · Pelican.note     [✕] │
│ Source : Mistral medium (vision) · 11/07     │
├──────────────────────────────────────────────┤
│ Feedback des Trend Rider                     │
│ - Eth long : +15€ → clos seul ! …            │
│ (texte intégral, scrollable, sélectionnable) │
├──────────────────────────────────────────────┤
│ [Copier] [Relire ≈ 0,7 c$]                   │  ← phase 1
│ + [Améliorer ≈ 1,1 c$] [Corriger]            │  ← v0.21
└──────────────────────────────────────────────┘
```

- **Copier** : presse-papiers natif (mécanique bouton Copier existante).
- **Relire** (phase 1) : rejoue le moteur de lecture courant (utile après
  avoir complété la page ou modifié le Persona OCR), remplace l'entrée du
  store.
- **Améliorer** (v0.21) : medium + image + hint (7,0/10 mesuré), remplace
  l'entrée du store, met à jour la chip (`OCR+`).
- **Corriger** (v0.21, décision U3) : le texte devient éditable en place ;
  `[Enregistrer]` → `source: 'user'`, chip `USER`. Rang maximal : Relire et
  Améliorer affichent alors une confirmation « Écraser votre correction
  manuelle ? » avant d'agir.
- C'est AUSSI l'écran de confiance : l'utilisateur voit exactement ce que
  le modèle lira — pédagogie de la provenance à coût UI nul.

## 4. Flux clés

### 4.1 Question quotidienne (page courante) — zéro réglage

1. Tap bulle → panneau. Chip = état du store pour la page.
2. L'utilisateur tape sa question → `Envoyer`.
3. Si le store couvre la page : chat texte direct (~2-3 s).
   Sinon lecture paresseuse : statut `reading (medium, 0,7 c$)…` puis
   `analysing…`.
4. Réponse. (v0.21 : + pied d'escalade si provenance `SN`.)

### 4.2 Améliorer la transcription (v0.21)

Depuis le volet Transcript OU le pied de réponse. Toujours :
étiquette de coût dans le bouton → statut `improving…` → chip passe `OCR+`
→ (depuis le pied de réponse) la dernière question est rejouée d'office.

### 4.3 Multi-page (plage / toute la note) — dialogue d'estimation

Décision 2026-07-11 (U2) : déclenché **au-delà de 100 pages** non couvertes
par le store (`.note` medium : 0,66 c$/page ; PDF mistral-ocr : 0,42 €/100
pages, identique manuscrit/machine) :

```
┌────────────────────────────────────┐
│ Lecture — 128 pages                │
│ 111 à lire (17 déjà en mémoire)    │
│ Coût ≈ 0,73 € · Durée ≈ 3 min      │
│                                    │
│ [Annuler]                  [Lire]  │
└────────────────────────────────────┘
```

`.note` : N appels medium d'une page (petits lots parallèles, la limite
8 images ne s'applique pas au flow lecture) ; PDF : 1 appel `/v1/ocr` pour
tout le fichier. Stop actif pendant toute la phase. ≤ 100 pages : pas de
dialogue, le coût passe dans la ligne de statut.

### 4.4 Consentement cloud (1ᵉʳ envoi d'un document)

Une fois par document, mémorisé dans le store :

```
« Envoyer des pages de “Pelican.note” à Mistral (UE) pour
  transcription/analyse ? »   [Toujours pour ce doc] [Une fois] [Annuler]
```

### 4.5 Hors-ligne / erreurs

- Pas de réseau : bandeau 1 ligne `Hors-ligne — transcript Supernote seul`,
  le chat reste utilisable sur RECOGNTEXT (dégradé, jamais bloqué).
- Pas de clé : le panneau affiche l'état clé (existant) + lien vers config.
- Erreur API : le message d'erreur remplace la réponse, avec `[Réessayer]`.

## 5. Page de configuration — réorganisation

Sections dans l'ordre (structure actuelle conservée, contenu retrié) :

1. **Clé & état** — inchangé (statut clé, Reload key file).
2. **Modèles** — DEUX réglages, découplés comme les flows (actés A2/A3) :
   `Analyse (chat)` : picker **small / medium (défaut) / large** ;
   `Transcription (source .note)` : picker — phase 1 :
   **OCR Supernote (gratuit, hors-ligne) / Mistral medium — vision
   (défaut, 0,66 c$/p)** ; v0.21 : + **mistral-ocr + glossaire (éco,
   0,5 c$/p)**. C'est ICI que l'utilisateur choisit sa source, jamais dans
   le chat. (Les PDF vont toujours à mistral-ocr — pas un réglage.)
   Le 3-états `pageSource` DISPARAÎT ; `Max images` reste en Avancé.
3. **Persona chat** — champ existant (sous-page Prompts & actions).
4. **Persona OCR** 🆕 (même sous-page, sous le persona chat) :
   UN champ global multiligne — « Aide au déchiffrage : contexte, vocabulaire,
   noms propres. Empilez tous vos jargons (perso + pro) : mesuré sans effet
   de mélange. » Compteur `1 240 / 10 000` ; recommandation ≤ 2 000 affichée
   sous le champ ; pré-rempli avec un template commenté. En phase 1 il est
   injecté comme system prompt du moteur de lecture medium (un vrai prompt) ;
   en v0.21 il alimente aussi la `description` Document AI du moteur éco.
   Bouton `[Tester sur la page courante]` → une lecture (0,7 c$) et affiche
   le résultat — boucle de réglage sans quitter la config. Sous le résultat
   (décision U3) : `Satisfait ? [Garder ce transcript] [Jeter]` — Garder
   l'écrit dans le TranscriptStore (c'est payé), Jeter n'en garde rien.
5. **Interface** — tailles texte/boutons (existant).
6. **Données locales** 🆕 — `Transcripts : 340 Ko · 87 pages` /
   `Conversations : 12` ; boutons `[Effacer transcripts]`
   `[Effacer conversations]` (confirmation à 1 niveau) ; rappel : « la
   désinstallation n'efface pas ces données » ; `[Réinitialiser les
   consentements]`.
7. **Pre-transcript your Supernote** 🆕 (v0.22, acté A5) — bouton ouvrant un
   écran dédié :

   ```
   ┌──────────────────────────────────────────┐
   │ Pre-transcript your Supernote        [✕] │
   ├──────────────────────────────────────────┤
   │ ☐ Note/            (4 759 p)             │  ← navigateur de dossiers
   │   ☑ Note/Perso/      (812 p)             │    façon Dashboard ; cocher
   │   ☐ Note/Pro/      (2 130 p)             │    la racine = tout
   │ ☐ Document/          (640 p)             │
   ├──────────────────────────────────────────┤
   │ Sélection : 812 pages · 187 déjà en cache│
   │ Coût ≈ 2,66 € (4,25 €/1000 p)            │
   │ Durée ≈ 6 min — restez en wifi ⚠         │
   │                                   [GO]   │
   └──────────────────────────────────────────┘
   ```

   Pendant le job : progression `dossier/note · page x/y`, Stop, et écran
   final `812 pages · 3 échecs [Réessayer les échecs]`. **Reprise sur
   coupure par construction** : le job itère page par page et SAUTE toute
   page déjà au store avec hash à jour — relancer le même job après un
   crash/coupure ne repaye ni ne refait aucune page déjà passée.
8. **Avancé** — Max images, timeout, (futurs flags).

## 6. Volet « Historique » (v0.21)

Ouvert par `[🕘]` dans le header du panneau.

```
┌──────────────────────────────────────────────┐
│ Conversations                    [+ Nouvelle]│
├──────────────────────────────────────────────┤
│ ▸ Pelican — feedback Trend Rider   10/07 [✕] │
│ ▸ Recettes — astuces cuisson       09/07 [✕] │
│ ▸ (courante) HBR ch.1              11/07     │
└──────────────────────────────────────────────┘
```

- Titre auto = `note d'origine — premiers mots de la 1ʳᵉ question`.
- Tap ligne → reprise (charge `turns`, contexte frais ré-étiqueté — archi
  §2.5). Si la reprise se fait depuis une AUTRE note que celle d'origine,
  le header du panneau affiche un rappel `↩ née sur Pelican.note` (acté U4).
- Tap `[✕]` → suppression avec confirmation inline (le `[✕]` devient
  `[Suppr ?]` pendant 3 s — pas de long-press).
- `+ Nouvelle` archive la courante et repart à vide (remplace « New chat »).
- Rétention 50 / 90 jours (archi §2.5) ; au-delà, purge silencieuse.

## 7. Textes UI (langue)

L'UI actuelle est en anglais — on y reste pour v0.20 (i18n = chantier
séparé, skill Pattern 12). Libellés proposés :
`This page / Pages… / Whole note` ; chip `MED / SN` (v0.21 : `OCR / OCR+ /
USER`) ; `Re-read (≈0.7 c$)` ; v0.21 : `Improve (≈1.1 c$)` / `Edit` ;
`Read 111 pages (≈0.73 €)` ; `Offline — Supernote transcript only` ;
`OCR persona (decipher help)`.

## 8. Phasage UI (aligné sur l'archi §3)

| Version | Livré côté UI |
|---|---|
| v0.19.1 (optionnel) | Défaut interne = image seule ; AUCUN changement d'écran |
| **v0.20.0 — phase 1** | Sélecteur de contexte **3 items**, chip provenance (`MED`/`SN`/`—`), volet Transcript (Copier / Relire), dialogue estimation > 100 pages, consentement cloud, section Données locales, champ Persona OCR (+ Tester + Garder/Jeter), picker Analyse + picker Source |
| **v0.21.0 — phase 2** | Bouton « Améliorer » (volet + pied de réponse), « Corriger » (source user, chip `USER`), option source éco (`OCR`), volet Historique + rappel `↩ née sur…` |
| **v0.22.0 — phase 3** | Écran « Pre-transcript your Supernote » (§5.7), recherche locale (champ dans le volet Historique), périmètre dossier |
| v0.23+ | i18n, provider Claude |

## 9. Questions ouvertes UI — décisions du 2026-07-11

1. Chip `Toute la note` : **agrégat** (`OCR 38 · SN 5`). ACTÉ.
2. Coût de session : **non** — coût visible uniquement dans les boutons, la
   ligne de statut de la requête en cours, et le dialogue > 100 pages. ACTÉ.
3. Test du Persona OCR : on **demande** (`Satisfait ? Garder / Jeter`). ACTÉ.
4. Reprise depuis une autre note : oui, avec rappel `↩ née sur X.note`. ACTÉ.
5. **A1 FERMÉE (2026-07-11)** : pas de mode « Image directe », pas de
   fallback — le moteur de lecture medium vision voit l'image (dessins
   inclus, test dinosaure/smiley) et sa description entre au store.
   Sélecteur : 3 items. Cf. archi §5.1.

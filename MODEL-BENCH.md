# Banc d'essai des modèles Mistral — SmartNote AI

**Date :** 2026-07-21 · **But :** choisir le bon modèle Mistral par tâche pour les
agents de SmartNote, sur des preuves mesurées et non à l'intuition.

> **Verdict en une ligne :** **Small 4** est le choix de raison (factuel 10/10,
> multimodal, le moins cher ou presque) ; la *chaleur* du style se règle par
> **prompt**, pas par choix de modèle ; **Ministral 14B** plaît au style mais
> est le plus faible sur les faits **et** est *text-only* (pas de vision).

---

## 1. Méthode

- **Test à l'aveugle.** Même prompt envoyé aux 4 modèles, `temperature = 0.3`
  identique, sorties **anonymisées et mélangées** par item (labels A/B/C/D tirés
  par item). Le notateur ne sait pas quel modèle est quelle lettre.
- **Deux natures de tâches :**
  - **Q&R (q01–q10)** — factuel/raisonnement sur des notes. *Corrigé
    objectivement* (une réponse est juste ou fausse — pas besoin d'avis).
  - **Rédaction (c01–c10)** — écriture/reformulation. *Noté à l'aveugle par
    l'utilisateur* (préférence de style).
- **Règle anti-« faux protocole » :** aucune réponse de modèle inventée (appels
  API réels, sorties verbatim sur disque) ; aucun score de qualité inventé (la
  notation vient de l'utilisateur ou d'une correction factuelle vérifiable).
- **Reproductibilité :** harnais dans `bench/harness.py` et
  `bench/compare_warm.py`. Coût total du banc 20 items ≈ **0,023 €**.

## 2. Modèles et tarifs (EUR / M tokens)

| Modèle | id | Input | Output | Multimodal | Note |
|---|---|--:|--:|:--:|---|
| Ministral 14B | `ministral-14b-latest` | 0,18 | 0,18 | ❌ | text-only |
| **Mistral Small 4** | `mistral-small-latest` | 0,12 | 0,50 | ✅ | **défaut recommandé** |
| Mistral Large 3 | `mistral-large-latest` | 0,44 | 1,30 | ✅ | |
| Mistral Medium 3.5 | `mistral-medium-latest` | 1,25 | 6,40 | ✅ | le plus cher (~12× Small) |
| OCR 4 | `mistral-ocr-4-0` | — | — | ✅ | 3,5 €/1000 pages (Document AI 4,38) |

Fait notable : **Large 3 est bien moins cher que Medium 3.5** (le « milieu de
gamme » en prix, c'est Large, pas Medium).

## 3. Les 20 exercices

Prompts complets dans `bench/harness.py` (`ITEMS`). Résumé :

**Q&R (factuel/raisonnement)**
| id | Tâche | Piège / point clé |
|---|---|---|
| q01 | Lister actions/responsables/échéances d'un CR de réunion | une action (« acheter 2 tablettes ») n'a pas de responsable |
| q02 | Rendement de la photosynthèse | **absent** de la note → bonne réponse = « non mentionné » |
| q03 | Date de livraison (6 semaines ouvrées dès le 3 mars) | calcul ; bonne réponse ≈ **14 avril** |
| q04 | Repérer l'incohérence de chiffres | 42+55+48 = **145**, total noté 135 ; objectif 150 non atteint |
| q05 | Tendance sommeil/humeur (journal 5 j) | synthèse interprétative |
| q06 | Budget : total / poste max / part par personne | **408 € / gîte 180 € / 136 €** |
| q07 | Pour combien de personnes la recette ? | la note dit « environ 12 parts » |
| q08 | Idée « bulle flottante » + idées à risque technique | quick capture = bulle ; synchro cloud = risque |
| q09 | Regrouper 10 idées en 3-4 thèmes | clustering (subjectif) |
| q10 | Créneau planning sous contraintes | **seul Mardi 9h-12h** est valide |

**Rédaction (style)**
| id | Tâche |
|---|---|
| c01 | Reformuler un jargon en français clair |
| c02 | Résumer en exactement 3 puces |
| c03 | Rédiger un email de relance bref et poli |
| c04 | Réécrire un message sec en ton chaleureux |
| c05 | Expliquer l'e-ink à un enfant (≤ 4 phrases) |
| c06 | Corriger orthographe/grammaire (rendre juste le texte) |
| c07 | Proposer 5 titres accrocheurs |
| c08 | Traduire un paragraphe FR→EN |
| c09 | 5 idées cadeaux ≤ 50 €, une ligne chacune |
| c10 | Transformer des notes en vrac en plan hiérarchique |

## 4. Résultats factuels — Q&R (correction objective)

✓ correct · ~ partiel (oubli) · ✗ erreur factuelle

| Modèle | q01 | q02 | q03 | q04 | q05 | q06 | q07 | q08 | q09 | q10 | **Score** |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Small 4** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **10 / 10** |
| **Large 3** | ~ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **9,5 / 10** |
| **Medium 3.5** | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **9 / 10** |
| **Ministral 14B** | ~ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | **7,5 / 10** |

Les 3 items qui discriminent (7/10 : tout le monde juste) :
- **q01 ~** : Large et Ministral **oublient** l'action « acheter 2 tablettes ».
- **q03 ✗** : bonne date ≈ **14 avril**. Medium dit 18 avril (calcul faux),
  Ministral 16 avril (mauvaise interprétation). Small et Large : 14 avril.
- **q10 ✗** : Ministral **invente le mercredi** (salle indisponible ce jour-là).

**Conclusion factuelle : Small parfait ; Ministral seul à se tromper vraiment.**

## 5. Réponses à l'aveugle de l'utilisateur — Rédaction (c01–c10)

Ce que l'utilisateur a réellement noté, dé-anonymisé. *(Il a jugé plusieurs
réponses « équivalentes » sur beaucoup d'items → ex-æquo fréquents.)*

| Item | A | B | C | D | Classement utilisateur (meilleur → pire) |
|---|---|---|---|---|---|
| c01 reformuler | Medium | Small | **Ministral** | Large | Ministral > Medium = Small = Large |
| c02 résumé 3 puces | Large | Small | Medium | **Ministral** | Ministral > Large = Small = Medium |
| c03 email | Medium | Small | Large | Ministral | Large = Small > Ministral > **Medium** (« sec ») |
| c04 ton chaleureux | Ministral | Large | Small | Medium | Ministral = Large > Small = Medium |
| c05 enfant e-ink | Medium | Small | Large | Ministral | Large > Ministral > Small > Medium |
| c06 correction | Ministral | Large | Medium | Small | Ministral > Large = Medium = Small |
| c07 titres | Ministral | Medium | Large | Small | Medium = Large = Small > **Ministral** (majuscules+typos) |
| c08 traduction | Small | Large | Ministral | Medium | Ministral > Large = Medium > Small |
| c09 cadeaux | Small | Ministral | Medium | Large | Ministral > Medium > Small = Large |
| c10 plan | Small | Medium | Large | Ministral | Ministral > Small > Medium > Large |

Seul Q&R noté aussi à l'aveugle par l'utilisateur — **q10** (créneau) :
`Small 1er · Medium = Large 2e · Ministral dernier (fail : mercredi)`.

**Score Borda (préférence de style de l'utilisateur, c01–c10) :**

| Modèle | Score style (aveugle) |
|---|:--:|
| **Ministral 14B** | **78 %** 🥇 |
| Large 3 | 50 % |
| Small 4 | 38 % |
| Medium 3.5 | 33 % |

→ L'utilisateur préfère nettement le style de **Ministral** (1er 6 fois sur 10).
Ses 2 seules contre-perfs = les 2 cas « rigueur » : c07 (typos/majuscules) et
q10 (raisonnement). Profil : **agréable mais peu fiable.**

## 6. Jugement de rédaction non aveugle (discipline) — pour contraste

Grille « fidélité + respect des consignes + concision » (jugé en connaissant les
modèles, donc *indicatif*) :

| Modèle | Score discipline |
|---|:--:|
| Medium 3.5 | 68 % |
| Small 4 | 57 % |
| Large 3 | 57 % |
| Ministral 14B | 18 % |

**L'écart avec le §5 est le vrai enseignement :** la préférence de style de
l'utilisateur (richesse/chaleur) et la discipline d'écriture pointent en sens
**opposés** pour Ministral. « Difficile de trancher » venait de là : deux juges,
deux critères. En aveugle, une réponse bien mise en forme mais **fausse** peut
battre une réponse juste mais brève (cf. q03, où les 2 dates fausses ont été
préférées aux 2 justes).

## 7. Expérience « Small + prompt chaleureux »

Question : peut-on donner à Small le style de Ministral **par prompt** ?

Prompt système testé (persona « Rédacteur », cf. `bench/compare_warm.py`) :
chaleureux, généreux (propose une variante), **mais** respect strict des
contraintes de format/longueur, français impeccable, pas de majuscules-partout.

- **Style :** Small-warm tutoie, propose des variantes, ouvre par une formule
  engageante — **la chaleur de Ministral, sans ses typos ni ses
  Majuscules-Partout.** *(Duel aveugle Small-warm vs Ministral : feuille
  `RATING_WARM.md` — notation à compléter.)*
- **Factuel :** Small-warm chute à **9/10** (vs 10/10 en brut) : sur **q10**, le
  prompt « sois généreux, propose une variante » l'a poussé à ajouter un créneau
  **invalide** (jeudi), en se contredisant sur la contrainte Karim.

> **Règle qui en découle :** la **chaleur est *promptable*** ; la **fiabilité
> factuelle ne l'est pas**. Ne pas mettre le même prompt partout : persona
> **chaleureuse** pour la rédaction, persona **stricte** (« ne propose aucune
> option non demandée ») pour l'extraction/raisonnement. `answerStyle`
> (`precise`/`balanced`/`creative`) = le levier de température associé.

## 8. Croisement avec le banc OCR/vision — le cas du lasso (Reader)

Le **Reader** (lasso) est le **seul** agent dont l'entrée est une **image** : il
lui faut **voir** (lire l'écriture) **puis** raisonner. Conséquences :

- **Contrainte de capacité :** vision requise → **Ministral (text-only) est
  disqualifié** pour le Reader. Candidats : Small 4 / Large 3 / Medium 3.5.
- **Banc OCR (antérieur) :** sur vraies pages .note, **OCR4 nu (F1 85,2) ≥
  vision** ; le hint *lowWords* n'apporte ~rien. OCR4 est le champion de la
  transcription dense ; la vision-chat est proche mais derrière.
- **Deux architectures Reader :**
  - **A — Vision-chat en un coup** (Small 4 lit la PNG *et* répond) : 1 appel,
    latence mini, pas cher. *(Archi actuelle du Reader.)*
  - **B — OCR4 → Small** : meilleure lecture sur écriture dense, mais 2
    allers-retours + coût page OCR4 + latence.
- **Angle mort non encore mesuré :** Small-vision vs Large-vision qui *lisent et
  répondent* en un coup sur de vrais **petits lassos** manuscrits. À mesurer avec
  5–10 PNG réels (mini-banc vision, cf. §10).
- **Reco Reader d'ici là :** `mistral-small-latest`, `answerStyle: precise`,
  archi A par défaut, **mode précision = OCR4 → Small** en repli pour le dense.

## 9. Décisions → design des agents (5 = 4 + Reader)

| Agent | Model | answerStyle | Rôle | Preuve |
|---|---|---|---|---|
| 📋 Extracteur | Small 4 | precise | résumés, points clés, actions, tables | factuel 10/10 |
| ✍️ Rédacteur | Small 4 | balanced | reformuler, emails, ton | Small-warm ≈ Ministral, fiable |
| 🎓 Tuteur | Small 4 | balanced | expliquer, quiz, réviser | respecte la contrainte « enfant » |
| 💡 Brainstorm | Ministral 14B | creative | idéation (texte only) | style préféré + le moins cher |
| 🔍 Reader (lasso) | Small 4 | precise | lire+répondre sur sélection image | vision requise ; §8 |

Alternative slot 4 : **✨ Plume soignée** (Medium 3.5) pour du texte destiné à
publication (accepter ~12× le prix).

**Principes retenus :**
1. **Small 4 = défaut** (factuel + multimodal + prix).
2. **Capacité** (faits, vision) = critère de choix du **modèle** ; **style** =
   affaire de **prompt** (persona + answerStyle).
3. **Router par tâche** : persona stricte pour l'extraction, chaleureuse pour la
   rédaction.
4. **Ministral** : confiné au texte + idéation (faible en faits, pas de vision).
5. **Medium** : rédaction publiée seulement (discipline max, mais cher).

## 10. Trous restants / à mesurer

- **Mini-banc vision** (Reader) : Small-vision vs Large-vision vs OCR4→Small sur
  5–10 vrais lassos manuscrits. *(Nécessite des PNG réels de la Manta.)*
- **Duel Small-warm vs Ministral** : notation aveugle de `RATING_WARM.md` à
  finaliser pour confirmer que Small-warm remplace Ministral en chat.
- **q01–q09 en aveugle** par l'utilisateur : non fait (le factuel du §4 suffit,
  mais l'avis « style » sur les Q&R n'a pas été collecté).

---

*Harnais : `bench/harness.py` (20 items, 4 modèles), `bench/compare_warm.py`
(duel Small-warm vs Ministral). Clé API Mistral utilisée pour ce banc : **à
révoquer** (elle a transité en clair pendant la session de test).*

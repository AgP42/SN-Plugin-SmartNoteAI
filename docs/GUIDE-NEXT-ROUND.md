# Manuel utilisateur — retours pour la prochaine passe Claude Design

> État au **2026-08-10**, contre le code **v1.0.6**.
> Le PDF courant (« Manuel utilisateur v1.0.4.pdf », 17 p., régénéré le
> 2026-08-10 à 11:34) est **juste sur le fond** : tous ses chiffres et tous
> ses comportements décrits ont été re-vérifiés contre le code.
> Ce fichier accumule ce qui reste à corriger pour la **prochaine version
> complète** du manuel — rien ici n'est bloquant.

## ⚠️ Le seul vrai manque : le RENOMMAGE n'est documenté nulle part

C'est le point important de cette passe. Le §2 décrit l'empreinte de page
ainsi :

> The fingerprint follows the content, not the location: move a note or PDF
> to another folder, or move or copy a page between two notes, and its
> transcript is found again, never re-charged.

C'était exact en v1.0.4, mais **renommer** n'y figure pas — et c'était
justement l'opération qui cassait le plus de choses (mode de synchro révoqué,
agents qui perdaient la note, verrous dégelés, PDF renommé entièrement
re-payé). Depuis la **v1.0.6** le renommage est pris en charge de bout en
bout. Remplacer la phrase par :

> The fingerprint follows the content, not the location: **rename** a note or
> PDF, move it to another folder, or move or copy a page between two notes,
> and its transcript is found again, never re-charged. A rename takes
> everything with it — the file's sync mode, the agents that know it, and any
> lock you set.

## §4.3 Search — la pastille Off manque

La section décrit les trois actions d'une ligne de résultat sans mentionner
le refus visible ajouté en v1.0.5 (un document Off n'a pas de bouton
d'ajout, il affiche une pastille grise). Ajouter :

> A document set to **Off** shows an *Off* chip instead of the add button:
> its pages are never sent to the AI.

## Coquilles d'anglais restantes (§6.2 « Why Mistral only »)

Les cinq coquilles de fond du §6.2 et celle du §2 (« This allow … idenfied »)
ont été **corrigées dans la régénération du 2026-08-10** — ne pas les
re-signaler. Il ne reste que deux détails cosmétiques :

| Écrit | Corriger en |
|---|---|
| « (chosen on measured results) **;** while » | « (chosen on measured results)**,** while » — l'espace avant le point-virgule est une habitude typographique française |
| « **the** Mistral Small, Medium and Large are » | « Mistral Small, Medium and Large are » — l'article devant les noms de modèles est un calque du français |

## Vérifié conforme au code v1.0.6 (ne pas retoucher)

- Cap Auto non surveillé « 500 pages / session » → `MAX_PAGES_PER_SESSION_BLOCK = 500`.
- « Up to 8 custom agents plus CHAT (9 entries) » → `MAX_AGENTS = 8`.
- « Lasso quick actions (up to 3) » → cap 3 dans la porte 3.
- « only a large batch (more than 100 pages) asks you to confirm » → seuil 100
  dans `gatherContext`.
- Table du menu (6 entrées, dans l'ordre) → `src/ui/menuVocab.ts`, source unique
  depuis v1.0.5 (la bulle et l'app hôte ne peuvent plus diverger).
- « A page read and found empty says (blank page), it is done, not pending »
  → `BLANK_SRC_LABEL` ; une page vide n'est jamais étiquetée « Mistral ».
- Verrou : grisage Redo / Rotate ± redo, Edit et lock/unlock toujours actifs,
  survie aux Clear → conforme. Depuis la v1.0.6 le verrou suit aussi le
  fichier renommé.
- Couverture « PLUGIN V1.00. X » : volontaire (décision user) — pas de
  réédition du manuel à chaque patch.

## Point encore non vérifié (à faire par la user, console Mistral)

- **E11** : les chiffres du free tier (« ~1300 pages transcrites / mois »,
  « ~3000 pages avec 10 € ») datent d'un field-test de juillet 2026 et n'ont
  jamais été re-confrontés à la facturation réelle. Le tarif « ~4 € / 1000
  pages » de §6.1 est cohérent avec « 10 € → ~3000 pages » à ±20 %.

## Nouveautés v1.0.5 / v1.0.6 à couvrir si le manuel est repris en profondeur

Aucune n'est une correction — ce sont des comportements récents qu'un manuel
complet gagnerait à mentionner :

- **Redo sur une page PDF blanche** répond désormais franchement (« This page
  is blank — nothing to transcribe. » / « Vision found nothing to add — the
  transcript is unchanged. ») au lieu d'une erreur qu'on pouvait re-taper.
- **Export d'un document entièrement blanc** : plus de mention « Transcript
  source: Mistral OCR » dans l'en-tête.
- **Arbre de fichiers** : il se relit tout seul quand le plugin revient au
  premier plan, et « Check changes » relit le disque avant de compter — utile
  à dire si le manuel décrit la Library en détail.

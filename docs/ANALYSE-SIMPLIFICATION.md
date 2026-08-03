# SmartNote AI : analyse de simplification

> 2026-08-02, après 8 tours de revue (≈70 défauts confirmés au total).
> Objectif fixé par la propriétaire : un plugin simple et robuste, pas un
> patchwork de correctifs. Chaque proposition indique ce qu'elle supprime,
> ce qu'elle coûte en fonctionnalité, et ce qu'elle aurait évité comme bugs.

## 1. Diagnostic : où vit la complexité

Le code ne souffre pas d'un excès de fonctionnalités. Il souffre d'une
**multiplication des chemins** pour faire la même chose.

**1a. Huit points d'entrée de lecture payante.** `readNotePages`, `readPdf`,
`readPdfPageVision`, `visionPassPdf`, `revisionMarksOnly`, le drain
`finishVisionLive`, le test de la config, les lectures live du chat. Chaque
règle transverse (Off, verrou, plafond, session dégradée, estimation,
marquage éphémère) doit être posée dans CHACUN. C'est une matrice
8 chemins × 6 gardes = 48 cases, et chaque tour de revue a trouvé des cases
vides. Tant que la matrice existe, on en trouvera.

**1b. Sept signaux de changement.** PAGEID + adresse de bloc (notes),
docHash octets|mark (PDF), hash de pixels (PDF annoté), le champ `va` à
trois formats, les stamps de footer, la garde par taille de fichier,
`storePending`. Sept vérités partielles qui peuvent se contredire — et qui
se sont contredites (le ping-pong de re-facturation `mh:`/`d:` en est le
symptôme direct).

**1c. Quinze états en mémoire dans le scheduler.** `running`, `tickGen`,
`runningTouchedAt`, `queuedPoke`, `manualWanted`, `pageFails`,
`visionFails`, `sizeAtSkip`, `coveredThisTick`, `foregroundBusy`,
`sessionPaidPages`, `sessionPaidAllowance`, `userSyncActive`, `capLogged`,
`pdfVisionBlocked`… Chacun né d'un bug réel, mais leurs interactions deux à
deux sont invérifiables, et ils se réarment tous au redémarrage.

**1d. Une maintenance de store trop intelligente.** Fusion-réparation de
shards, restauration additive, éviction, remap, balayage éphémère : chaque
mécanisme est raisonnable seul ; leurs recouvrements ont produit les pires
bugs (pages recousues au mauvais index, deux fois).

## 2. Les trois décisions structurelles (recommandées)

### P1 — UN pipeline de lecture payante

Une seule fonction par laquelle passe TOUTE lecture payante :

    demanderLecture(doc, pages, origine)
      → gardes, UNE fois : Off/consentement, verrou, session dégradée,
        plafond, estimation, marquage éphémère
      → lecture (OCR et/ou Vision selon l'état des pages)
      → écriture (qui préserve verrou et marqueurs)

`origine` ∈ {auto, drain, chat, action-utilisateur} ne change QUE les
messages (refus visible pour une action explicite, silence pour l'auto),
jamais les gardes. Le drapeau `force:` disparaît — c'est lui qui a permis
au drain de contourner le verrou.

- Supprime : ~40 cases de la matrice des gardes, le drapeau force,
  la classe de bugs « garde oubliée sur le chemin X » (~15 des 70 défauts).
- Coût fonctionnel : zéro.
- C'est aussi LE point unique de ta spec du verrou : elle devient
  triviale à implémenter et à prouver.

### P2 — UNE identité de changement par page, UN marqueur

- Note : PAGEID + adresse de bloc (inchangé, ça marche).
- PDF : hash du rendu de la page (déjà implémenté pour les annotations),
  pour TOUTES les pages. Le docHash ne sert plus qu'à une chose : savoir si
  le fichier a bougé du tout (pré-filtre gratuit).
- `va` retrouve UN sens : « Vision a tourné sur cette identité et n'a rien
  ajouté ». Un seul format. Écrit par le pipeline, jamais ailleurs.
- **La passe d'annotations spécialisée (`revisionMarksOnly`) est SUPPRIMÉE.**
  Une annotation modifiée change le hash de sa page ; le pipeline normal
  relit cette page-là, et seulement elle. La passe a concentré à elle seule
  ~12 défauts sur 5 tours.

- Supprime : `revisionMarksOnly`, deux des trois formats `va`,
  `visionSettled` et ses paramètres, le tag `m<taille>`.
- Coût fonctionnel : les pages PDF non ouvertes ne peuvent pas être
  hashées sans hôte de rendu — déjà le cas aujourd'hui (règle host-bound),
  donc rien ne change pour toi.

### P3 — Un store qui refuse au lieu de réparer

- Shard illisible → le document est en LECTURE SEULE pour la session
  (les lectures payantes le sautent — pas de facturation invisible), et on
  réessaie au prochain démarrage. La fusion-réparation est SUPPRIMÉE.
- Restauration de sauvegarde → propose « remplacer » ou « ignorer » par
  document entier, jamais de couture page à page. La fusion additive est
  SUPPRIMÉE.
- Éviction → ne touche jamais un document verrouillé, épinglé ou corrigé ;
  au-delà, elle refuse d'évincer et affiche « bibliothèque pleine » (tu
  décides quoi nettoyer, le plugin ne sacrifie rien tout seul).

- Supprime : la fusion par identité (2 tours de bugs), la couture d'index,
  la casuistique d'éviction.
- Coût fonctionnel : une session avec un shard illisible ne stocke pas les
  lectures de CE document (rare, transitoire, et annoncé à l'écran).

## 3. Simplifications du scheduler (recommandées)

- **File d'attente au lieu de verrou réclamable.** Chaque tick attend la
  fin du précédent, point. Plus de génération, de réclamation, de
  « progrès », de tick supplanté. Si le JS est gelé, rien d'autre ne
  tourne de toute façon ; au dégel, la file continue. Le double-paiement
  par chevauchement devient structurellement impossible.
  Supprime : `tickGen`, `runningTouchedAt`, `tickLockStale`, `superseded`,
  `touchTick` (4 tours de bugs).
- **Compteur d'échecs SUR l'entrée de page** (persisté), au lieu de deux
  Maps en mémoire qui se réarment au redémarrage.
  Supprime : `pageFails`, `visionFails`, et la re-facturation par session.
- **Plafond simple** : les lectures d'origine `auto` s'arrêtent à 500
  pages/session ; toute origine utilisateur est illimitée. L'origine est
  mémorisée avec l'ordre `manualWanted`, donc ses continuations héritent.
  Supprime : l'arithmétique d'allocation, `userSyncActive`, `capLogged`.
- **Estimation sans heuristique d'octets** : le décompte de pages d'un PDF
  n'est connu qu'après l'OCR — alors on inverse : l'OCR (bon marché, une
  requête) donne le décompte EXACT, puis le dialogue s'affiche AVANT la
  partie chère (Vision, par page) dès que > 100 pages. Pour éviter tout
  OCR surprise : au-delà de 5 Mo de fichier inconnu, on demande d'abord
  (« taille inconnue, l'analyse initiale coûtera ~X € maximum »).
  Supprime : le plancher octets/page et ses faux dialogues.

## 4. Fonctionnalités à trancher (ton arbitrage)

| Option | Gain de simplicité | Coût pour toi |
|---|---|---|
| A. Supprimer la passe annotations dédiée (P2) | très fort (~12 bugs historiques) | aucun : même résultat par le chemin normal |
| B. Supprimer la fusion-réparation de shards (P3) | fort | un doc au shard illisible reste en lecture seule une session |
| C. Restauration par document entier, sans couture (P3) | fort | restaurer écrase OU ignore un doc, jamais de mélange |
| D. Supprimer le sous-système Batch Mistral (si encore actif) | fort (pipeline en double) | perte de la remise batch (~50 %) sur les gros volumes |
| E. Supprimer le bouton « test de transcription » de la config | moyen | le test se fait en lisant une vraie page via le chat |
| F. Éviction qui refuse au lieu de choisir (P3) | moyen | à bibliothèque pleine, c'est toi qui nettoies |

Ma recommandation : A, B, C, F oui ; E oui (un point d'entrée payant de
moins à garder étanche) ; D à vérifier — si le batch n'est plus utilisé
depuis le passage au pipeline live, c'est du code mort dangereux ; s'il
sert encore pour les grosses synchros, il passe par le pipeline P1 et on
le garde.

## 5. Ce qu'on garde tel quel

Le sharding du store (sain), les modes Auto/Manual/Off et leur héritage par
dossier, la recherche et sa grammaire, l'export, le guide embarqué, les
agents, le lasso, `sleepHybrid` et la discipline anti-timers-gelés, le
single-writer des settings. Rien de tout ça n'est en cause.

## 6. Séquence proposée

1. **Phase A** : le pipeline unique (P1) + ta spec du verrou implémentée
   dedans (préservation dans `upsertPage`, stub pour doc jamais lu,
   éviction qui épargne, UI abonnée au store). Les 10 constats ouverts du
   8ᵉ tour sont résolus PAR CONSTRUCTION, pas rustinés.
2. **Phase B** : l'identité unique (P2) + suppression de la passe
   annotations et des formats `va` multiples.
3. **Phase C** : store qui refuse (P3) + scheduler en file (§3) +
   suppression des fonctionnalités tranchées en §4.
4. Une revue après chaque phase (leçon des 8 tours), et des tests de
   propriété sur le pipeline (« aucune lecture payante sans passer par les
   gardes » devient un test, pas une espérance).

Estimation : Phase A est la plus grosse ; B et C suppriment plus de code
qu'elles n'en ajoutent. Solde net attendu : **≈ −1 500 lignes** et une
matrice de gardes qui devient UNE colonne.

## 7. En attendant : v0.94 sur ta Manta

Le verrou v0.94 MENT (il se perd à l'écriture, le drain l'ignore). Deux
options d'attente : (a) je pousse une v0.94.1 minimale qui masque les
puces de verrou tant que la Phase A n'est pas livrée (pas de fausse
promesse à l'écran), ou (b) tu évites simplement de te fier au verrou
d'ici là. Je recommande (a) — cinq minutes de travail, zéro risque.

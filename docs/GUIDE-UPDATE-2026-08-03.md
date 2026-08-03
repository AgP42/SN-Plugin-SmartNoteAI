# Manuel utilisateur — écarts vs code (v0.98.5) + prompt Claude Design

> Relecture du « Manuel utilisateur 3.08.2026_1.pdf » (17 p.) contre le code
> v0.98.5. Les numéros de section renvoient au PDF.

## Écarts à corriger

**E1 — Le verrou (lock) n'existe pas dans le manuel.** Feature majeure absente.
À documenter (nouvelle sous-section dans §4.2 Browse transcripts) :
- Un verrou par PAGE (bouton dans la vue page) et par DOCUMENT (chip
  « Lock document » dans la grille de pages, qui affiche aussi
  « N p. locked »). Chips 🔒 visibles sur les lignes de la Library.
- Sens : la page/le doc n'est plus JAMAIS relu automatiquement, même si
  l'encre change. C'est le gel du transcrit, pas une protection d'écriture.
- Les boutons « Redo AI transcript » et « Rotate ± redo » sont grisés et
  refusent sur une page/un doc verrouillé (le bouton lock/unlock et Edit
  restent actifs : les corrections MANUELLES sont toujours permises).
- Le verrou SURVIT à tout : re-sync, Restore, et depuis v0.98.5 il BLOQUE
  aussi les Clear (voir E2).

**E2 — Clear vs lock (§3.2 « Clear ALL transcripts » et §4 Library).**
Nouveau comportement v0.98.5 : un document verrouillé refuse son Clear ;
dans un doc non verrouillé, les pages verrouillées survivent au Clear
(doc, Off, et Clear ALL). Le message dit ce qui a été gardé.

**E3 — Ordre Sync permanent + Annulation (§4.1, panneau MANUAL).** Le
manuel décrit « Sync now is a standing order » ✔ mais pas son AFFICHAGE ni
son annulation : le cadre Synchronisation montre l'ordre en attente
(« N doc(s) ordered ») avec un bouton ✕ Cancel qui annule l'ordre debout
(v0.98.1).

**E4 — Fichiers déplacés (nouveau, v0.98.3) — à ajouter à « Each result is
stored… never paid twice » (§2) et/ou §4.1.** Déplacer une note ou un PDF
dans un autre dossier, déplacer/copier une page d'une note à une autre :
le transcrit est RETROUVÉ (identité de page pour les notes, nom+octets
pour les PDF), jamais re-facturé. Une page dont l'encre a changé reste
relue normalement.

**E5 — Seuil de 100 pages (§5.1 et §6.1).** Le manuel dit « Asking about
pages not read yet shows the price first » et « Every paid action shows
its estimated price before you confirm, except Auto ». Spec réelle : le
dialogue de confirmation n'apparaît qu'au-delà de 100 pages ; en dessous,
la lecture part directement (le coût reste visible dans l'estimation du
panneau MANUAL / la ligne de contexte). Reformuler les deux passages.

**E6 — « Read with Vision on a PDF page » (§4.2).** Bouton disparu
(v0.84) : la vue page n'a plus qu'un « Redo AI transcript » unifié
(OCR+Vision pour tous), plus « Rotate right + redo » et « Rotate left +
redo » (le manuel ne cite qu'un seul « Rotate + redo » à 90°).

**E7 — Chip Sync hérité (§4.1).** Le manuel explique l'héritage de
dossier ✔ mais pas l'affichage : un doc couvert par un dossier suivi
montre un chip grisé « ↳ Sync: X » ; le taper crée un réglage propre, et
le cycle passe alors par « inherit » pour revenir à l'héritage.

**E8 — Restore par identité (§3.2 Settings backup / §6.1 encadré
désinstallation).** Préciser en une phrase : Restore backup fusionne par
IDENTITÉ de page (une note réorganisée depuis la sauvegarde retrouve ses
pages) ; tes pages locales plus récentes gagnent ; le rapport liste docs
illisibles et pages ignorées.

**E9 — Plafond Auto (encadré « Honest limits », §4.1).** À ajouter :
l'Auto non surveillé s'arrête à 500 pages par session (garde-fou budget) ;
tout ce que TU demandes (Sync now, boutons, chat) est sans plafond et
re-arme la session.

**E10 — Fraîcheur des infos modèles (§3.4).** « Large … currently
outdated, a new one is expected very soon » et « Medium is the most
capable » sont datés (et Large 3 est aujourd'hui MOINS cher que Medium).
Reformuler sans pari sur l'actualité : « l'écran affiche prix et
description en direct, fie-toi à lui ».

**E11 — (mineur, à vérifier avant de figer) Chiffres du free tier
(§3.1).** « ~1300 pages/mois » et « 10 €/mois offerts en Pay-as-you-go » :
re-vérifier sur console.mistral.ai au moment de la mise à jour.

## Ce qui est correct et à NE PAS toucher
Grammaire de recherche (§4.3, table complète et exacte) · Export (§4.4) ·
Lasso (§5.5) · Off/consentement · le menu à 6 entrées (§2) · guide dans
Document/SmartNote AI/ ré-installé par la config · encadré
désinstallation (Backup + Export settings → MyStyle) · licence AGPL-3.0.

---

## Prompt pour Claude Design

```
Tu vas mettre à jour le « Manuel utilisateur » (PDF A4, 17 pages, design
existant à conserver tel quel : structure, palette, typographie, en-têtes
« SMARTNOTE AI · USER GUIDE · COMPACT », figures numérotées).

Le code source du plugin est la référence :
https://github.com/AgP42/SN-Plugin-SmartNoteAI (branche main, v0.98.5).
Lie ce repo au projet pour vérifier les comportements dans le code plutôt
que de deviner ; on travaillera ensemble dessus pour les prochaines
itérations du manuel.

Applique EXACTEMENT les changements E1 à E10 listés dans
docs/GUIDE-UPDATE-2026-08-03.md du repo (copie collée ci-dessous), sans
réécrire les sections déclarées correctes. Résumé :

1. NOUVELLE sous-section « Lock a page or a document » dans §4.2 :
   verrou par page (vue page) et par document (grille de pages, chip
   « Lock document · N p. locked ») ; gèle le transcrit : plus aucune
   re-lecture automatique même si l'encre change ; les boutons Redo /
   Rotate±redo sont grisés sur une page verrouillée ; Edit reste permis ;
   le verrou survit aux sync/Restore et BLOQUE les Clear : un doc
   verrouillé refuse son Clear, les pages verrouillées survivent aux
   Clear de doc, Clear Off et Clear ALL (le message dit ce qui est gardé).
2. §4.1 panneau MANUAL : documenter l'affichage de l'ordre Sync debout et
   son bouton ✕ Cancel.
3. §2 et §4.1 : « never paid twice » s'étend aux fichiers DÉPLACÉS —
   note/PDF déplacé de dossier, page déplacée ou copiée entre deux notes :
   le transcrit est retrouvé, jamais re-facturé.
4. §5.1 + §6.1 : le dialogue de prix n'apparaît qu'au-delà de 100 pages ;
   en dessous, la lecture part directement (coût visible dans le panneau
   MANUAL). Reformuler les deux phrases qui promettent un prix « avant
   chaque action payante ».
5. §4.2 : supprimer « Read with Vision on a PDF page » (bouton disparu) ;
   il y a DEUX boutons rotation (« Rotate right + redo », « Rotate left +
   redo »).
6. §4.1 : décrire le chip hérité « ↳ Sync: X » et le cycle qui inclut
   « inherit » quand un dossier parent est suivi.
7. §3.2/§6.1 : une phrase sur le Restore par identité de page (pages
   locales plus récentes gagnent ; rapport des docs illisibles/pages
   ignorées).
8. §4.1 « Honest limits » : Auto non surveillé plafonné à 500 pages par
   session ; les actions demandées par l'utilisateur sont sans plafond.
9. §3.4 : retirer les jugements datés sur les modèles (« Large outdated »,
   « Medium most capable/most expensive ») — renvoyer aux prix/descriptions
   affichés en direct par l'écran.
10. Garde la langue (anglais), le ton et la longueur actuels ; pas de
    nouvelle section hors E1 ; mets à jour la table des matières et la
    date de couverture.
```

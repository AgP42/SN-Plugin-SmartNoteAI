# Manuel utilisateur — retours pour la prochaine passe Claude Design

> État au **2026-08-11**, contre le code **v1.0.9**.
> Le manuel « v1.0.x » (18 p.) a été **intégré** en GUIDE_REV 18 : il ferme
> TOUS les points qui étaient ouverts ici (renommage, Export Log, porte 1
> réorganisée, pastille Off en §4.3, dernières coquilles du §6.2).
> **Il ne reste rien à corriger.** Ce fichier repart de zéro pour la suite.

## Rien en attente

Prochaine passe : rouvrir ce fichier quand une nouveauté du code ne sera pas
couverte par le manuel. Rappel de la boucle qui marche :
Claude Design lit le repo public → PDF → `python3 tools/import_guide_pdf.py
<pdf>` → bump `GUIDE_REV` dans `src/native/guideSeed.ts` → build ×2.

## Point encore non vérifié (à faire par la user, console Mistral)

- **E11** : les chiffres du free tier (« ~1300 pages transcrites / mois »,
  « ~3000 pages avec 10 € ») datent d'un field-test de juillet 2026 et n'ont
  jamais été re-confrontés à la facturation réelle. Le tarif « ~4 € / 1000
  pages » de §6.1 est cohérent avec « 10 € → ~3000 pages » à ±20 %.

## Vérifié conforme au code v1.0.9 (ne pas retoucher)

- Cap Auto non surveillé « 500 pages / session » → `MAX_PAGES_PER_SESSION_BLOCK = 500`.
- « Up to 8 custom agents plus CHAT (9 entries) » → `MAX_AGENTS = 8`.
- « Lasso quick actions (up to 3) » → cap 3 dans la porte 3.
- « only a large batch (more than 100 pages) asks you to confirm » → seuil 100.
- Table du menu (6 entrées, dans l'ordre) → `src/ui/menuVocab.ts`.
- « A page read and found empty says (blank page), it is done, not pending ».
- Verrou : grisage Redo / Rotate ± redo, Edit et lock/unlock actifs, survie
  aux Clear, et depuis la v1.0.6 le verrou suit le fichier renommé.
- Couverture « PLUGIN V1.00. X » : volontaire — pas de réédition par patch.
- L'URL du dépôt en §3.2 se coupe après « SN-Plugin- » : c'est correct
  (vérifié en extraction avec conservation de la mise en page), ne pas
  « corriger » le tiret.

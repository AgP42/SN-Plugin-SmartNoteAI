# Manuel utilisateur — retours pour la prochaine passe Claude Design

> Relecture du « Manuel utilisateur v1.0.4.pdf » (17 p., intégré tel quel en
> GUIDE_REV 17 le 2026-08-03) contre le code v1.0.5. Rien ici n'est bloquant :
> le manuel est **juste** sur le fond, ces points sont de la finition.

## Vérifié conforme au code (ne pas retoucher)

- Cap Auto non surveillé « 500 pages / session » → `MAX_PAGES_PER_SESSION_BLOCK = 500`.
- « Up to 8 custom agents plus CHAT (9 entries) » → `MAX_AGENTS = 8`.
- « Lasso quick actions (up to 3) » → cap 3 dans la porte 3.
- « only a large batch (more than 100 pages) asks you to confirm » → seuil 100
  dans `gatherContext`.
- Table du menu (6 entrées, dans l'ordre) → `src/ui/menuVocab.ts`, source unique
  depuis v1.0.5 (la bulle et l'app hôte ne peuvent plus diverger).
- « A page read and found empty says (blank page) » → `BLANK_SRC_LABEL`.
- Verrou : grisage Redo / Rotate ± redo, Edit et lock/unlock toujours actifs,
  survie aux Clear → conforme.
- Relocalisation « move a note or PDF to another folder, or move or copy a page
  between two notes, and its transcript is found again, never re-charged » →
  conforme, et **renforcé en v1.0.5** : l'identité de pixels voyage avec la page,
  donc plus aucune lecture d'amorçage après un déplacement.

## Coquilles d'anglais (§6.2 « Why Mistral only »)

Toutes dans le dernier tiers de la page ; le reste du manuel est propre.

| Écrit | Corriger en |
|---|---|
| « I a convinced that Mistral is “good enough” » | « I am convinced that Mistral is “good enough” » |
| « For reading handwriting notes or PDF and chating about them » | « For reading handwritten notes or PDFs and chatting about them » |
| « no need of the latest start-of-the-art over expensive model » | « no need for the latest state-of-the-art, overly expensive model » |
| « a readable handwritting » | « readable handwriting » |
| « Important for good result is to have clear prompts » | « What matters for good results: clear prompts » |

Ailleurs dans le manuel, deux détails mineurs :

- §2 Transcripts : « This allow every change to be easily idenfied » →
  « This allows every change to be easily **identified** ».
- §4.1 : « Off · the privacy switch » dit « Existing transcripts stay
  searchable until you clear them » ✔ — mais la Library propose aussi
  « Clear transcripts of Off notes », mentionné en §4 : garder les deux
  formulations cohérentes si la page est retouchée.

## Point encore non vérifié (à faire par la user, console Mistral)

- **E11** : les chiffres du free tier (« ~1300 pages transcrites / mois »,
  « ~3000 pages avec 10 € ») datent d'un field-test de juillet 2026 et n'ont
  jamais été re-confrontés à la facturation réelle. Le tarif « ~4 € / 1000
  pages » de §6.1 est cohérent avec « 10 € → ~3000 pages » à ±20 %.

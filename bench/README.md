# bench/ — harnais du banc d'essai des modèles

Voir `../MODEL-BENCH.md` pour la méthode, les exercices et les résultats.

## Lancer
```bash
export MISTRAL_API_KEY=...        # ta clé (jamais commitée)
python3 harness.py               # 20 items × 4 modèles → RATING_SHEET.md + key.json
python3 compare_warm.py          # duel Small+prompt chaleureux vs Ministral → RATING_WARM.md
```
Sorties brutes verbatim dans `runs/` (et `runs_warm/`). La feuille de notation
est anonymisée ; `key.json` garde le mapping lettre→modèle (à ne pas regarder
avant d'avoir noté).

Les 20 prompts et les 4 tarifs sont définis en tête de `harness.py`.

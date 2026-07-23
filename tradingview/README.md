# Indicateur TradingView — Highs & Lows 1H / 4H

Indicateur Pine Script (v5) qui marque les **highs** et **lows** des bougies
**1H** et **4H** sous forme de lignes horizontales avec un label
(`1h High`, `1h Low`, `4h High`, `4h Low`).

Les niveaux sont récupérés via `request.security`, donc ils **restent affichés
sur tous les timeframes** : tu peux descendre en 15m, 5m ou 1m, les highs & lows
des bougies 1H et 4H continuent d'être tracés.

## Installation

1. Ouvre [TradingView](https://www.tradingview.com/) puis un graphique.
2. En bas, ouvre l'onglet **Pine Editor** (Éditeur Pine).
3. Copie/colle le contenu de [`session-highs-lows.pine`](./session-highs-lows.pine).
4. Clique sur **Save** (Enregistrer), puis **Add to chart** (Ajouter au graphique).

## Réglages

| Réglage | Description |
| --- | --- |
| **Afficher 1H / 4H** | Active ou désactive chaque timeframe. |
| **Nombre de bougies à garder** | Nombre de highs/lows récents conservés à l'écran (par TF). |
| **Couleurs High / Low** | Couleur des lignes et labels pour chaque TF. |
| **Afficher les labels** | Affiche ou masque le texte (`1h High`, `4h Low`…). |
| **Épaisseur / Style de ligne** | Épaisseur (1–5) et style (plein, tirets, pointillés). |

## Notes

- Les valeurs utilisées sont celles de la **dernière bougie clôturée**
  (`high[1]` / `low[1]` avec `lookahead_on`) : l'indicateur **ne repeint pas**.
- Les lignes sont prolongées jusqu'au bord droit et les labels y sont recalés,
  comme sur la capture de référence.

# Indicateur TradingView — Trading Session Highs & Lows

Indicateur Pine Script (**v6**) qui regroupe **en un seul outil** :

1. **Highs & Lows des sessions** Asie / Londres / New-York (lignes live pendant
   la session, puis lignes conservées après clôture).
2. **Highs & Lows 1H / 4H** : le high et le low de chaque bougie 1H et 4H,
   récupérés via `request.security` — ils **restent affichés sur tous les
   timeframes** (tu peux descendre en 15m, 5m, 1m, ils continuent de s'afficher).

## Installation

1. Ouvre [TradingView](https://www.tradingview.com/) puis un graphique.
2. En bas, ouvre le **Pine Editor** (Éditeur Pine).
3. Copie/colle le contenu de [`session-highs-lows.pine`](./session-highs-lows.pine).
4. Clique sur **Save** puis **Add to chart**.

## Réglages

### Sessions (Asie / Londres / New-York)

| Réglage | Description |
| --- | --- |
| **Afficher la session** | Active/désactive chaque session. |
| **Horaires (Paris)** | Plage horaire de la session (fuseau `Europe/Paris`). |
| **Couleurs High / Low** | Couleur des lignes et labels par session. |

### Highs & Lows 1H / 4H

| Réglage | Description |
| --- | --- |
| **Afficher 1H / 4H** | Active/désactive chaque timeframe. |
| **Nombre de bougies à garder** | Nombre de highs/lows récents conservés (par TF). |
| **Couleurs High / Low** | Couleur des lignes et labels (blanc 1H, orange 4H par défaut). |

### Mitigation (niveaux balayés — s'applique aux niveaux 1H / 4H)

| Réglage | Description |
| --- | --- |
| **Arrêter les lignes balayées** | Une ligne cesse de suivre le prix dès qu'elle est prise. |
| **Action quand balayé** | `Figer` = la ligne s'arrête au point de balayage · `Supprimer` = elle est retirée. |
| **Balayage sur** | `Mèche` = balayé dès qu'une mèche traverse · `Clôture` = seulement si la bougie clôture au-delà. |
| **Estomper les lignes figées** | En mode `Figer`, rend la ligne balayée transparente + tirets et masque son label. |

### Affichage (commun)

| Réglage | Description |
| --- | --- |
| **Épaisseur / Style de ligne** | Épaisseur (1–4) et style (solide, pointillé, tirets). |
| **Afficher les labels** | Affiche ou masque le texte. |
| **Afficher le fond des sessions** | Colore l'arrière-plan pendant chaque session. |

## Notes

- Un **High 1H/4H** = une bougie **blanche** (haussière) suivie d'une bougie
  **noire** (baissière) → le **sommet** de la bougie blanche. Un **Low** = une
  bougie **noire** suivie d'une bougie **blanche** → le **creux** de la bougie noire.
  (Détection du retournement de couleur sur les bougies 1H et 4H.)
- Tout est calculé **nativement** sur les bougies du graphique et ancré par
  `bar_index` : **aucun `request.security`, aucun repeint**, lignes accrochées
  aux bougies sur tous les timeframes.
- Un timeframe n'est tracé que si le graphique est sur un TF **inférieur ou égal**
  (ex. sur un chart 4H, le 1H n'est pas tracé).
- Le balayage ne peut pas se déclencher sur la bougie qui a créé le niveau.

# Simulateur de livraison d'abonnés

Outil **pédagogique**, **100 % local** et **100 % fictif** qui reproduit la
mécanique interne d'un « panel » de vente d'abonnés : file d'attente, stock de
faux comptes, moteur de livraison progressive, chutes (« drops ») et
remplacements (« refills »).

> ### Ce que ce projet n'est pas
> Aucune connexion à Instagram ni à aucun réseau social. Aucune API externe,
> aucun compte réel, aucun faux compte réellement créé, aucun abonnement
> réellement envoyé. « Livrer un abonné » signifie ici **passer une ligne d'une
> table SQLite de l'état `queued` à l'état `active`**. Les pseudos affichés sont
> des chaînes générées aléatoirement en local ; ils ne désignent personne.
>
> Pour mémoire : acheter de vrais abonnés viole les conditions d'utilisation de
> toutes les grandes plateformes. L'intérêt de ce simulateur est justement de
> montrer, chiffres à l'appui, pourquoi ces livraisons chutent et pourquoi elles
> sont si faciles à détecter.

---

## 1. Stack technique

| Élément | Choix | Pourquoi |
|---|---|---|
| Runtime | **Node.js ≥ 22.5** | `node:sqlite` est intégré depuis cette version |
| Base de données | **SQLite** (`node:sqlite`) | un simple fichier `data/simulateur.db`, inspectable |
| Serveur HTTP | **`node:http`** + mini-routeur maison | ~60 lignes, rien à installer |
| Temps réel | **Server-Sent Events** | le serveur pousse, le navigateur ne sonde pas |
| Interface | **HTML/CSS/JS natifs** (modules ES) | aucun build, aucun bundler |
| Dépendances npm | **aucune** | `npm start` suffit, tout est hors-ligne |

## 2. Architecture

```
simulateur-livraison/
├── src/
│   ├── server.js               Point d'entrée : DB → stock → moteur → HTTP
│   ├── config.js               TOUS les réglages (vitesses, chutes, file d'attente)
│   ├── events.js               Bus d'événements interne (moteur → SSE)
│   │
│   ├── db/
│   │   ├── schema.sql          4 tables : fake_users, orders, deliveries, order_events
│   │   ├── index.js            Ouverture de la base + transactions
│   │   ├── seed.js             Génération du stock de faux comptes
│   │   └── reset.js            Remise à zéro
│   │
│   ├── domain/                 ── logique métier, sans HTTP ──
│   │   ├── usernames.js        Générateur de pseudos fictifs
│   │   ├── speed.js            Profils de vitesse → abonnés par battement
│   │   ├── orders.js           Création, lecture, annulation, chute, remplacement
│   │   └── engine.js           Le moteur : bat toutes les 500 ms
│   │
│   ├── http/                   ── plomberie HTTP réutilisable ──
│   │   ├── router.js           Routage `/api/order/:id`
│   │   ├── respond.js          Réponses JSON, erreurs, lecture du corps
│   │   └── static.js           Service de `public/`
│   │
│   └── api/                    ── la « fausse API fournisseur » ──
│       ├── routes.js           Table de routage complète
│       ├── orders.controller.js
│       └── stream.controller.js  Flux SSE
│
├── public/                     Interface (2 pages, zéro framework)
│   ├── index.html + js/order.js       Formulaire + suivi temps réel
│   ├── dashboard.html + js/dashboard.js
│   ├── js/api.js               Couche d'accès partagée
│   └── css/style.css
│
├── outils/demo.js              Démonstration en ligne de commande
└── data/simulateur.db          Base générée (ignorée par git)
```

### Séparation des responsabilités

- `domain/` ne connaît **ni HTTP ni l'interface** : ce sont des fonctions qui
  lisent et écrivent en base. On peut les appeler depuis un script (voir
  `outils/demo.js`).
- `api/` ne contient **aucune règle métier** : les contrôleurs traduisent
  HTTP ↔ fonctions du domaine.
- `config.js` est la **seule source de vérité** pour les réglages : changer une
  vitesse ou un taux de chute ne demande de toucher à aucun autre fichier.

## 3. Démarrage

```bash
cd simulateur-livraison
npm start
```

Aucun `npm install` n'est nécessaire (zéro dépendance). Au premier lancement, le
stock de 40 000 faux comptes est généré (~0,5 s), puis :

- interface de commande : <http://127.0.0.1:4300/>
- dashboard : <http://127.0.0.1:4300/dashboard>

Autres commandes :

```bash
npm run seed              # (re)compléter le stock de faux comptes
npm run reset             # effacer les commandes
npm run reset -- --tout   # effacer aussi le stock
node outils/demo.js       # démonstration commentée en ligne de commande
```

Le serveur écoute **exclusivement sur `127.0.0.1`** : il n'est jamais exposé au
réseau local.

## 4. Comment ça marche, étape par étape

### Étape 1 — Le stock (`db/seed.js`)
Un panel doit d'abord posséder des comptes. On en génère 40 000 par assemblage
de morceaux de mots (`itz_luna_grove4821`), avec trois qualités :

| Qualité | Part | Fragilité |
|---|---|---|
| `bot` (récent) | 55 % | ×1,6 — chute en premier |
| `inactif` | 32 % | ×0,9 |
| `ancien` | 13 % | ×0,35 — tient le plus longtemps |

C'est cette répartition qui explique le comportement observé plus loin : plus un
stock est composé de bots frais, plus la livraison « fond » vite.

### Étape 2 — La commande (`domain/orders.js`)
`POST /api/order` valide la cible et la quantité, crée la ligne dans `orders`
(statut `pending`) **et réserve immédiatement le stock nécessaire** : autant de
lignes `deliveries` à l'état `queued`. Si le stock ne suffit pas, la commande le
signale — exactement comme un panel en rupture.

### Étape 3 — Le moteur (`domain/engine.js`)
Un `setInterval` bat toutes les 500 ms et, à chaque battement :

1. sort de la file d'attente les commandes dont le délai est écoulé
   (`pending` → `processing`) ;
2. fait passer un paquet de lignes de `queued` à `active` — c'est *ça*, « livrer » ;
3. clôture les commandes arrivées à la quantité demandée (`completed`) ;
4. un battement sur six, évalue les chutes naturelles.

### Étape 4 — Les vitesses (`domain/speed.js`)
Chaque profil définit une fourchette d'abonnés par seconde, à laquelle on
applique trois effets qui rendent la courbe crédible :

- **aléa** dans la fourchette (le débit n'est jamais constant) ;
- **démarrage progressif** sur 4 s (le fournisseur « chauffe ») ;
- **pauses** aléatoires (12 % des battements : rate limit, file saturée).

| Profil | Débit | 10 000 abonnés en… |
|---|---|---|
| `instantanee` | 400–900/s | ~15 s |
| `rapide` | 120–260/s | ~1 min |
| `normale` | 40–90/s | ~3 min |
| `lente` | 10–25/s | ~10 min |
| `goutte_a_goutte` | 2–6/s | ~40 min |

### Étape 5 — Les chutes (« drops »)
Une chute fait passer des lignes de `active` à `dropped`. Le compteur
`delivered` **baisse** donc, et `remaining` **remonte**. Les comptes qui chutent
ne sont pas tirés au hasard : ils sont pondérés par la fragilité de leur qualité
(les bots partent d'abord).

Deux déclencheurs :
- **automatique** : à chaque évaluation, probabilité = `drop_rate × 0,15` ;
- **manuel** : `POST /api/order/:id/drop` avec `{ "percent": 10 }` ou
  `{ "count": 500 }` — le bouton « Simuler une chute » de l'interface.

### Étape 6 — Les remplacements (« refills »)
C'est le mécanisme que vendent les panels sous le nom de « garantie ». Si
`auto_refill` est actif, une chute :

1. remet la commande en `processing` ;
2. réserve de **nouveaux** comptes du stock (marqués `is_refill = 1`) ;
3. fixe un `resume_after` de quelques secondes (le fournisseur « réagit ») ;
4. le moteur relivre la différence, puis repasse en `completed`.

D'où le cycle bien visible sur le dashboard :
`completed → drop → processing → completed → drop → …`

Un taux de chute élevé avec refill automatique montre l'essentiel : le
fournisseur puise en permanence dans son stock, et le nombre affiché sur le
profil ciblé n'est jamais stable.

## 5. L'API

Toutes les routes sont locales (`http://127.0.0.1:4300`).

### `POST /api/order`
```json
{ "target": "@test", "quantity": 10000, "speed": "rapide",
  "drop_rate": 0.3, "auto_refill": true }
```
`speed`, `drop_rate` et `auto_refill` sont optionnels. Réponse `201` :
```json
{ "order_id": 18472, "target": "test", "quantity": 10000, "delivered": 0,
  "remaining": 10000, "dropped": 0, "refilled": 0, "status": "pending",
  "speed": "rapide", "drop_rate": 0.3, "auto_refill": true, "progress": 0,
  "created_at": "…", "estimation_secondes": 60 }
```

### `GET /api/order/:id`
Même objet, plus `events` (les 30 dernières lignes du journal).

### Autres routes

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/orders?limit=50&status=processing` | liste des commandes |
| `GET` | `/api/order/:id/followers?limit=40&state=active` | faux abonnés rattachés |
| `GET` | `/api/order/:id/events?limit=50` | journal complet |
| `POST` | `/api/order/:id/cancel` | annulation (`cancelled`) |
| `POST` | `/api/order/:id/drop` | chute forcée (`{count}` ou `{percent}`) |
| `POST` | `/api/order/:id/refill` | remplacement manuel |
| `GET` | `/api/stats` | compteurs globaux |
| `GET` | `/api/config` | vitesses et bornes (utilisé par l'interface) |
| `GET` | `/api/stream?order=18472` | flux temps réel (SSE) |

Erreurs normalisées : `{ "error": { "code": "invalid_quantity", "message": "…" } }`.

### Les 4 statuts

| Statut | Signification |
|---|---|
| `pending` | enregistrée, pas encore prise en charge (file d'attente) |
| `processing` | livraison en cours (ou remplacement en cours) |
| `completed` | quantité atteinte — ou stock épuisé |
| `cancelled` | arrêtée ; l'acquis reste acquis, le stock réservé est rendu |

### Champs d'une commande

| Champ | Description |
|---|---|
| `order_id` | numéro (démarre à 18472) |
| `target` | pseudo ciblé, normalisé (sans `@`, en minuscules) |
| `quantity` | quantité demandée |
| `delivered` | abonnés **actuellement actifs** (livrés − chutes + remplacements) |
| `remaining` | `quantity − delivered` — remonte donc après une chute |
| `dropped` | total des abonnés perdus depuis le début |
| `refilled` | abonnés actifs issus d'un remplacement |
| `status` | voir ci-dessus |
| `created_at` | horodatage ISO |

## 6. Exemple avec `curl`

```bash
# 1. Lancer une commande
curl -X POST localhost:4300/api/order -H 'Content-Type: application/json' \
  -d '{"target":"@test","quantity":10000,"speed":"rapide","drop_rate":0.3,"auto_refill":true}'

# 2. Suivre la progression
curl localhost:4300/api/order/18472

# 3. Provoquer une chute de 10 %
curl -X POST localhost:4300/api/order/18472/drop \
  -H 'Content-Type: application/json' -d '{"percent":10}'

# 4. Suivre en temps réel
curl -N localhost:4300/api/stream?order=18472
```

## 7. Inspecter la base

```bash
sqlite3 data/simulateur.db "SELECT username, quality FROM fake_users LIMIT 5;"
sqlite3 data/simulateur.db "SELECT state, COUNT(*) FROM deliveries GROUP BY state;"
```

C'est la meilleure façon de vérifier que tout est fictif : la base ne contient
que des chaînes générées localement, et le projet n'ouvre aucune connexion
sortante.

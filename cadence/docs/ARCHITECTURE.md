# Cadence — architecture

> Document de référence pour l'équipe technique. Décrit le découpage, le modèle de données,
> l'API, le moteur de génération et les choix structurants.

---

## 1. Principes de conception

Quatre décisions structurent tout le reste :

1. **L'opérateur est l'auteur du message.** L'outil produit des propositions, jamais un envoi.
   Aucune connexion aux plateformes d'abonnement, aucune automatisation de conversation. Cela
   simplifie l'architecture (pas de webhooks, pas de file d'attente) et cadre l'usage.
2. **Les garde-fous vivent côté serveur.** Politique éditoriale, détection de situations
   sensibles et validation des suggestions sont dans l'API. Un opérateur ne peut pas les
   désactiver depuis l'interface, et un changement de règle est déployé pour toute l'équipe d'un
   coup.
3. **Une seule dépendance d'infrastructure.** SQLite en fichier. Une agence de 3 à 30 opérateurs
   n'a besoin ni de Postgres, ni de Redis, ni de conteneurs. Les dépôts (`db/repos.ts`) isolent
   le SQL : migrer vers Postgres = réécrire ce fichier, rien d'autre.
4. **La vitesse d'usage prime.** L'écran de travail quotidien (la console) est une seule page,
   un seul raccourci clavier, un bouton de copie. Tout le reste (fiches, templates) est de la
   configuration, consultée rarement.

---

## 2. Vue d'ensemble

```
┌────────────────────────────────────────────────────────────────────┐
│  Navigateur — React 18 + Vite                                      │
│                                                                    │
│  Dashboard · Models · Global Scripts · Favorites · Prompt Generator │
│  Analytics · Settings · Search        (+ espace dédié par modèle)   │
│      │          │          │           │           │          │    │
│      └──────────┴──────────┴─── api.ts (fetch + cookie) ──────┘    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTP/JSON, session cookie httpOnly
┌──────────────────────────────▼─────────────────────────────────────┐
│  API — Express + TypeScript                                        │
│                                                                    │
│  http/       auth · api · scripts   (routes, validation zod)       │
│  generation/ variables → prompt → llm → validate   (service.ts)    │
│  db/         repos · scripts · migrations   (SQL isolé)            │
└───────────┬──────────────────────────────────┬─────────────────────┘
            │                                  │
   ┌────────▼────────┐              ┌──────────▼──────────┐
   │  SQLite (WAL)   │              │  Anthropic API      │
   │  fichier unique │              │  (ou mode local)    │
   └─────────────────┘              └─────────────────────┘
```

Le dossier `shared/` contient les types, le catalogue de variables et les scénarios livrés ;
il est importé **tel quel** par le serveur et par le front. Un champ ajouté à une fiche créateur
casse la compilation des deux côtés s'il n'est pas traité : c'est voulu.

---

## 3. Modèle de données

SQLite. Les colonnes suffixées `_json` stockent des listes ou des objets sérialisés — les
dépôts font la conversion, le reste du code ne voit que des objets typés.

| Table | Rôle | Champs notables |
|---|---|---|
| `users` | Opérateurs et administrateurs | `password_hash` (bcrypt), `role` |
| `sessions` | Sessions actives | `token` (32 octets aléatoires), `expires_at` |
| `creators` | Fiches créateurs | `personality`, `tone`, `writing_style`, `lexicon_json`, `guardrails_json` |
| `scenarios` | Scénarios de conversation | `beats_json`, `do_json`, `dont_json`, `is_system` |
| `templates` | Templates de prompt | `body` (avec `{{variables}}`), `variables_json`, `category`, `tags_json` |
| `generations` | Historique complet | `suggestions_json`, `system_prompt`, `user_prompt`, `used_suggestion_id`, `rating` |
| `script_categories` | Catégories de scripts | `key`, `label`, `sort_order`, `is_system` |
| `scripts` | Bibliothèque de scripts | `model_id` (null = global), `category_id`, `content`, `variables_json`, `version` |
| `script_tags` + `script_tag_links` | Tags normalisés | `slug` unique, table de liaison |
| `script_versions` | Historique de contenu | une ligne par changement de nom ou de contenu |
| `script_usage` | Utilisations réelles | `converted`, `revenue_cents`, `used_at` |
| `favorites` | Favoris par utilisateur | `entity_type` (`script`/`model`/`generation`), unicité par utilisateur |
| `meta` | Marqueurs internes | drapeaux d'initialisation |

**Choix notables**

- *Pourquoi stocker les prompts envoyés ?* Traçabilité. Quand une suggestion pose problème, on
  doit pouvoir répondre à « qu'est-ce que le modèle avait exactement sous les yeux ». C'est aussi
  la matière première pour améliorer les templates.
- *Pourquoi `lexicon` et `guardrails` en JSON ?* Ces blocs évoluent au rythme des retours de
  l'équipe éditoriale. Les faire évoluer sans migration SQL est un gain net ; ils ne sont jamais
  requêtés par champ.
- *Un script, deux appartenances.* `scripts.model_id` nullable porte toute la logique : `NULL`
  = bibliothèque globale, sinon le script appartient à un modèle. Une seule requête sert les trois
  portées (`model` / `global` / `all`), et un script global n'est jamais dupliqué pour être visible
  d'un modèle — il l'est par construction.
- *Statistiques calculées, pas dénormalisées.* `usage_count`, taux de conversion, revenu et score
  sont dérivés de `script_usage` à la lecture. Une correction se répercute immédiatement et il n'y
  a pas de compteur à resynchroniser. À l'échelle d'une agence (quelques milliers de lignes), le
  coût est négligeable ; si le volume changeait, un cache par script suffirait.
- *Tags normalisés.* `script_tags` + table de liaison plutôt qu'un tableau JSON : le filtre par tag
  reste indexé et renommer un tag ne demande pas de réécrire chaque script.
- *Favoris par utilisateur.* Une seule table pour les trois types d'objets, avec contrainte
  d'unicité : ajouter un type favorisable ne demande aucune migration.
- *Pas de table `subscribers`.* L'outil ne stocke pas les abonnés : seulement un alias libre saisi
  par l'opérateur. Moins de données personnelles conservées, moins de surface RGPD.
- `is_system` protège les six scénarios livrés : modifiables, non supprimables.

**Migrations.** `schema.sql` crée les tables manquantes ; il ne sait pas ajouter une colonne à une
table existante. `db/migrations.ts` s'en charge : il liste les colonnes attendues, interroge
`PRAGMA table_info` et n'ajoute que ce qui manque. Idempotent, exécuté à chaque démarrage, sans
toucher aux données — c'est ce qui a permis d'ajouter `age`, `avatar_url`, `content_style` et
`custom_instructions` aux bases déjà en service. Pour ajouter un champ : le déclarer dans le
`CREATE TABLE` **et** dans la liste de `migrations.ts`.

Le schéma (`server/src/db/schema.sql`) est appliqué au démarrage, en `IF NOT EXISTS`. Les données
initiales (compte admin, scénarios, templates de départ, créateur d'exemple) sont posées par
`db/seed.ts`, chaque bloc protégé par un marqueur dans `meta` — relancer le serveur ne duplique
rien et n'écrase aucune modification de l'équipe.

---

## 4. API HTTP

Toutes les routes sont sous `/api`, en JSON, protégées par un cookie de session `httpOnly`
(sauf `/api/health` et `/api/auth/login`). Validation systématique par zod : un corps invalide
renvoie `400` avec le détail des champs.

### Authentification

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/auth/login` | Ouvre une session (bcrypt + cookie) |
| `POST` | `/api/auth/logout` | Ferme la session |
| `GET` | `/api/auth/me` | Utilisateur courant |
| `GET` `POST` | `/api/auth/users` | Gestion des comptes (admin) |

### Ressources

| Méthode | Route | Rôle |
|---|---|---|
| `GET` `POST` | `/api/creators` | Liste / création de fiches |
| `GET` `PUT` `DELETE` | `/api/creators/:id` | Détail, mise à jour, suppression (admin) |
| `GET` `POST` | `/api/scenarios` | Liste (+ libellés de catégories) / création |
| `PUT` `DELETE` | `/api/scenarios/:id` | Mise à jour / suppression (hors scénarios système) |
| `GET` | `/api/templates?search=&category=` | Recherche plein texte (nom, description, corps, tags) |
| `GET` | `/api/templates/categories` | Catégories existantes |
| `GET` | `/api/templates/default-body` | Corps du template standard |
| `GET` `POST` `PUT` `DELETE` | `/api/templates[/:id]` | CRUD |
| `POST` | `/api/templates/:id/duplicate` | Duplication |

### Modèles, scripts, favoris

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/models[/:id]` | Modèles enrichis : compteur de scripts + performance agrégée |
| `GET` | `/api/scripts?scope=&model_id=&category=&tag=&search=&favorites=&recent=` | Bibliothèque filtrée (`scope` : `all` / `global` / `model`) |
| `GET` `POST` `PUT` `DELETE` | `/api/scripts[/:id]` | CRUD |
| `POST` | `/api/scripts/:id/duplicate` | Duplication, avec `model_id` optionnel pour cibler un modèle |
| `POST` | `/api/scripts/:id/variations` | Variantes générées, voix du modèle et variables conservées |
| `POST` | `/api/scripts/:id/usage` | Enregistre une utilisation (`converted`, `revenue_cents`) |
| `GET` | `/api/scripts/:id/versions` | Historique de contenu |
| `GET` `POST` | `/api/scripts/categories` | Catégories (16 livrées, extensibles) |
| `GET` | `/api/scripts/tags` | Tags utilisés, avec compteurs |
| `POST` | `/api/favorites/toggle` | Bascule un favori (`script` / `model` / `generation`) |
| `GET` | `/api/favorites` | Les trois types de favoris de l'utilisateur |
| `GET` | `/api/analytics` | Totaux, série 14 jours, top scripts, catégories, modèles |
| `GET` | `/api/search?q=` | Recherche globale : modèles, scripts, templates, historique |

### Génération

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/generate` | Produit N propositions et enregistre la génération |
| `POST` | `/api/preview` | Rend un template avec les variables, **sans appel au modèle** |
| `GET` | `/api/generations?creator_id=&search=&limit=` | Historique |
| `GET` | `/api/generations/:id` | Détail d'une génération |
| `POST` | `/api/generations/:id/feedback` | Marque la proposition envoyée / note la génération |
| `GET` | `/api/variables` | Catalogue des variables dynamiques |
| `GET` | `/api/stats` | Chiffres du dashboard |

**Mises à jour partielles.** Les routes `PUT` acceptent un corps partiel, validé par `patchOf()`
plutôt que par `schema.partial()`. La nuance compte : zod conserve les `.default()` à travers
`.partial()`, si bien qu'un `PUT { content }` réinitialiserait tous les autres champs à leur valeur
par défaut — un script de modèle repasserait « global », ses tags seraient vidés. `patchOf()` retire
les valeurs par défaut avant de rendre les champs optionnels : un champ absent reste absent.

`/api/preview` est séparé de `/api/generate` pour une raison de coût : l'aperçu temps réel de
l'éditeur de template se déclenche à chaque frappe (avec anti-rebond), il ne doit jamais appeler
le modèle.

---

## 5. Moteur de génération

Le cœur de l'outil. Cinq étapes, chacune dans son fichier, orchestrées par
`generation/service.ts`.

```
requête ─► analyse du message reçu ─► résolution des variables ─► assemblage du prompt
                     │                                                    │
              (blocage possible)                                          ▼
                                                              appel du fournisseur
                                                                          │
                              historique ◄── validation des suggestions ◄──┘
```

### 5.1 Analyse du message reçu (`validate.ts`)

Avant toute dépense d'appel API, le message reçu et l'historique sont passés au crible :

| Détection | Sévérité | Effet |
|---|---|---|
| Abonné potentiellement mineur | **bloquant** | Aucune génération. Escalade demandée, demande tracée. |
| Détresse / difficulté financière | avertissement | Active le *mode vigilance* : le prompt interdit toute relance commerciale. |
| Question sur l'identité de l'interlocuteur | avertissement | Interdit tout démenti, renvoie vers la procédure de l'agence. |
| Demande de contact ou paiement hors plateforme | avertissement | Signalé à l'opérateur. |

### 5.2 Résolution des variables (`variables.ts`)

Une table `{ nom → valeur }` est construite depuis quatre sources, par priorité croissante :
contexte (créateur, scénario, requête) → valeurs par défaut du template → surcharges explicites.

Une variable inconnue ou vide est **retirée** du texte et remontée dans `missing` (affichée dans
l'aperçu). Laisser un `{{...}}` non résolu partir vers le modèle produit des réponses incohérentes :
c'est la raison de ce comportement.

### 5.3 Assemblage du prompt (`prompt.ts`)

Le prompt système est concaténé dans un ordre stable, du plus figé au plus variable :

1. **Politique** — bloc constant, non modifiable depuis l'interface : exactitude factuelle,
   aucune promesse, identité, non-manipulation, cadre légal et règles de plateforme, données
   personnelles.
2. **Fiche créateur** — personnalité, ton, style, audience, sujets, puis les contraintes
   d'écriture traduites en instructions (longueur, emojis, ponctuation, casse, vocabulaire
   interdit, expressions signature) et les règles propres au créateur.
3. **Playbook de scénario** — but, structure attendue du message, à faire / à ne pas faire.
4. **Niveau de familiarité** — quatre paliers, chacun avec sa consigne (ce qui est permis de
   supposer et ce qui ne l'est pas).
5. **Format de sortie**.

Le préfixe étant stable pour un même créateur, il est marqué comme cacheable côté API : sur une
rafale de conversations pour le même créateur, seule la fin du prompt change.

Le **prompt utilisateur** est le template rendu (celui choisi par l'opérateur, ou le template
standard). C'est la séparation qui donne du sens aux templates : ils pilotent la demande, jamais
les règles.

### 5.4 Appel du fournisseur (`llm.ts`)

Interface `LlmProvider`, deux implémentations :

- **Anthropic** — `messages.parse` avec sortie structurée (schéma zod) : le modèle renvoie
  directement un tableau `{ label, text, rationale, warnings }`, pas de texte à parser. Modèle par
  défaut `claude-opus-5`, réflexion adaptative, effort configurable (`LLM_EFFORT`). Un refus du
  modèle (`stop_reason: "refusal"`) est remonté comme une erreur explicite.
- **Local** — composition hors ligne à partir de la fiche et du scénario, avec marqueurs
  `[À VÉRIFIER]` explicites. Sert de mode dégradé (clé absente, incident fournisseur), de mode
  démonstration et de mode test.

Basculer de fournisseur = ajouter une classe et une ligne dans `getProvider()`.

### 5.5 Validation des suggestions (`validate.ts`)

Chaque proposition est confrontée à la fiche du créateur **avant affichage** :

| Contrôle | Sévérité |
|---|---|
| Vocabulaire interdit (insensible à la casse et aux accents, sur mot entier) | bloquant |
| Sujet interdit | bloquant |
| Formulation de pression ou de culpabilisation | bloquant |
| Dépassement de la longueur maximale | avertissement |
| Promesse (prix, délai, contenu) quand la fiche l'interdit | avertissement |
| Fait personnel (lieu, âge, entourage) quand la fiche l'interdit | avertissement |
| Marqueur `[À VÉRIFIER]` restant | avertissement |
| Densité d'emojis hors du style déclaré | information |

Les suggestions sont affichées avec leurs avertissements : l'opérateur voit *pourquoi* une
proposition demande une relecture, plutôt que de recevoir un texte silencieusement filtré.

### 5.6 Variations de script

`POST /api/scripts/:id/variations` réécrit un script existant plutôt que d'en produire un nouveau.
Le prompt système reprend la politique et la fiche du modèle, puis impose trois contraintes :
conserver le sens et l'objectif, conserver la voix du modèle, et **conserver les variables**
`{{…}}` à l'identique. Après génération, le service compare les variables du script d'origine à
celles de chaque variante et signale toute variable perdue — une variante qui perd
`{{subscriber_name}}` casse le script à l'usage.

### 5.7 Score de performance

Défini dans `shared/scripts.ts`, donc identique côté serveur et côté interface :

```
score = conversion × 60  +  min(usage / 25, 1) × 20  +  min(revenu / 500 €, 1) × 20
```

Le volume et le revenu sont plafonnés pour qu'un script très utilisé mais peu convertissant ne
domine pas le classement. Le score est calculé à la lecture, jamais stocké.

---

## 6. Interface

React 18, Vite, `react-router`. Aucune bibliothèque de composants : un fichier CSS avec des
variables de thème (sombre par défaut, clair via `data-theme`) et une petite bibliothèque interne
(`components/ui.tsx` : `Field`, `TagInput`, `Modal`, `CopyButton`, toasts, `useAsync`,
`useDebounced`). Le poids de la page compte : les opérateurs l'ouvrent toute la journée.

| Écran | Ce qu'on y fait |
|---|---|
| **Dashboard** | Volume du jour et de la semaine, modèles, revenu attribué, dernières générations, état du fournisseur. |
| **Models** | Grille des modèles ; la sidebar reprend la liste avec recherche, avatar, statut, nombre de scripts. |
| **Espace modèle** | Cinq onglets : Overview, Profile, Scripts, Prompt Generator, Performance. |
| **Global Scripts** | Bibliothèque partagée, mêmes filtres et mêmes actions que celle d'un modèle. |
| **Favorites** | Scripts, modèles et prompts épinglés, retirables depuis la carte. |
| **Prompt Generator** | Deux colonnes : contexte à gauche, propositions à droite, avec Copy, Save as Script, Favorite et Regenerate. |
| **Analytics** | Série 14 jours, top scripts, ventilation par catégorie, tableau des modèles. |
| **Settings** | Prompt templates, scénarios, équipe, catalogue des variables, thème. |
| **Search** | Recherche globale depuis la barre du haut, résultats groupés par type. |
| **Historique** | Détail d'une génération, rejeu dans la console. |

**Composants réutilisés plutôt que dupliqués** — c'est ce qui garantit que la bibliothèque d'un
modèle et la bibliothèque globale se comportent exactement pareil :

| Composant | Utilisé par |
|---|---|
| `ScriptLibrary` | Global Scripts · onglet Scripts d'un modèle · Favorites · résultats de recherche |
| `ScriptEditor` | Toute création ou édition de script, y compris « Save as Script » depuis la console |
| `ModelProfileForm` | Modale de création d'un modèle (mode compact) · onglet Profile (mode complet) |
| `GeneratorPanel` | Page Prompt Generator · onglet Prompt Generator d'un modèle (modèle imposé) |

Détails pensés pour l'usage quotidien : le brouillon de la console est conservé localement (hors
message reçu) pour survivre à un rechargement ; copier une proposition la marque automatiquement
comme envoyée, ce qui alimente les statistiques sans travail supplémentaire.

---

## 7. Sécurité et conformité

- **Authentification** : bcrypt (coût 10), session en base, cookie `httpOnly` + `sameSite=lax`,
  `secure` en production, expiration 30 jours. Deux rôles : `admin` (comptes, suppression de
  fiches) et `operator`.
- **Clé API** : uniquement côté serveur, jamais exposée au navigateur.
- **Validation** : zod sur toutes les entrées, tailles maximales sur chaque champ.
- **SQL** : requêtes préparées et paramétrées exclusivement.
- **Données personnelles** : pas d'identité d'abonné stockée, seulement un alias libre. Les
  messages collés dans la console sont conservés dans l'historique — prévoir une politique de
  purge (voir §9) selon la durée de conservation retenue par l'agence.
- **Traçabilité** : chaque génération est liée à son opérateur, avec le prompt exact envoyé.

Ce qui est hors périmètre par construction : envoi automatique de messages, connexion aux
plateformes, contournement de règles de plateforme, production de démentis sur l'identité de
l'interlocuteur.

---

## 8. Déploiement

```bash
npm run build   # tsc (API) + vite build (interface)
npm start       # l'API sert l'interface compilée sur $PORT
```

Un seul processus Node, un fichier SQLite. Recommandations :

- reverse proxy TLS devant l'API (`NODE_ENV=production` active `secure` sur le cookie) ;
- `SESSION_SECRET` et `ADMIN_PASSWORD` renseignés hors dépôt ;
- sauvegarde périodique du fichier `DATABASE_PATH` (WAL activé : sauvegarder aussi `-wal` et
  `-shm`, ou passer par `sqlite3 .backup`) ;
- `LLM_EFFORT=low` pour réduire coût et latence sur les usages de masse, `high` pour les
  conversations à enjeu.

## 9. Évolutions prévues sans refonte

| Besoin | Point d'entrée |
|---|---|
| Purge automatique de l'historique | tâche planifiée sur `generations` (`created_at`) |
| Statistiques par opérateur | `generations.operator_id` et `used_suggestion_id` sont déjà là |
| Versionnage des templates | table `template_versions` + `templates.version` (le modèle existe déjà pour les scripts) |
| Import automatique des revenus | remplacer la saisie manuelle par une alimentation de `script_usage` |
| Nouvelles catégories de scripts | `POST /api/scripts/categories`, aucune migration |
| Nouveau type de favori | ajouter une valeur à `entity_type`, aucune migration |
| A/B testing de templates | `generations.template_id` + `rating` alimentent déjà la comparaison |
| Passage à Postgres | réécrire `db/repos.ts` uniquement |
| Autre fournisseur de modèle | nouvelle classe `LlmProvider` |
| Import de conversations | endpoint d'upload alimentant `conversation_history` |

## 10. Tests

`npm test` (21 tests) couvre les règles dont une régression est invisible à l'œil nu :

- **Moteur de génération** — rendu des variables, priorité des surcharges, vocabulaire et sujets
  interdits, longueur, marqueurs restants, formulations de pression, analyse du message entrant
  (mineur, détresse, question d'identité).
- **Bibliothèque de scripts** — portée globale vs modèle (un script global visible partout sans
  duplication, un script de modèle invisible ailleurs), mise à jour partielle qui ne réinitialise
  aucun champ, versionnage déclenché par le seul changement de contenu, duplication vers un modèle,
  favoris propres à chaque utilisateur, calcul de l'usage, de la conversion, du revenu et du score,
  filtres par recherche, tag et catégorie.

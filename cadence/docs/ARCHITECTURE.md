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
│  Dashboard   Console   Créateurs   Scénarios   Templates  Historique│
│      │          │          │           │           │          │    │
│      └──────────┴──────────┴─── api.ts (fetch + cookie) ──────┘    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTP/JSON, session cookie httpOnly
┌──────────────────────────────▼─────────────────────────────────────┐
│  API — Express + TypeScript                                        │
│                                                                    │
│  http/       auth · api        (routes, validation zod)            │
│  generation/ variables → prompt → llm → validate   (service.ts)    │
│  db/         repos (SQL isolé)                                     │
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
| `meta` | Marqueurs internes | drapeaux d'initialisation |

**Choix notables**

- *Pourquoi stocker les prompts envoyés ?* Traçabilité. Quand une suggestion pose problème, on
  doit pouvoir répondre à « qu'est-ce que le modèle avait exactement sous les yeux ». C'est aussi
  la matière première pour améliorer les templates.
- *Pourquoi `lexicon` et `guardrails` en JSON ?* Ces blocs évoluent au rythme des retours de
  l'équipe éditoriale. Les faire évoluer sans migration SQL est un gain net ; ils ne sont jamais
  requêtés par champ.
- *Pas de table `subscribers`.* L'outil ne stocke pas les abonnés : seulement un alias libre saisi
  par l'opérateur. Moins de données personnelles conservées, moins de surface RGPD.
- `is_system` protège les six scénarios livrés : modifiables, non supprimables.

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

---

## 6. Interface

React 18, Vite, `react-router`. Aucune bibliothèque de composants : un fichier CSS avec des
variables de thème (sombre par défaut, clair via `data-theme`) et une petite bibliothèque interne
(`components/ui.tsx` : `Field`, `TagInput`, `Modal`, `CopyButton`, toasts, `useAsync`,
`useDebounced`). Le poids de la page compte : les opérateurs l'ouvrent toute la journée.

| Écran | Ce qu'on y fait |
|---|---|
| **Dashboard** | Volume du jour et de la semaine, latence moyenne, scénarios les plus utilisés, dernières générations, état du fournisseur. |
| **Console** | Deux colonnes : formulaire à gauche (créateur, scénario, familiarité, objectif, message reçu, historique, contexte, réglages), propositions à droite. `⌘/Ctrl + ↵` pour générer, copie en un clic, prompt envoyé consultable. |
| **Créateurs** | Prompt Builder : identité, personnalité, traits, ton, style, audience, sujets, vocabulaire, forme, garde-fous. |
| **Scénarios** | Six scénarios livrés + création sur mesure (structure, à faire, à éviter). |
| **Templates** | Recherche, catégories, tags, duplication, épinglage ; éditeur avec palette de variables cliquable et aperçu temps réel. |
| **Historique** | Filtres par créateur et recherche plein texte, détail d'une génération, rejeu dans la console. |

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
| Versionnage des templates | table `template_versions` + `templates.version` |
| A/B testing de templates | `generations.template_id` + `rating` alimentent déjà la comparaison |
| Passage à Postgres | réécrire `db/repos.ts` uniquement |
| Autre fournisseur de modèle | nouvelle classe `LlmProvider` |
| Import de conversations | endpoint d'upload alimentant `conversation_history` |

## 10. Tests

`npm test` couvre le cœur métier : rendu des variables, priorité des surcharges, détection du
vocabulaire et des sujets interdits, longueur, marqueurs restants, formulations de pression, et
l'analyse du message entrant (mineur, détresse, question d'identité). Ce sont les règles dont une
régression est invisible à l'œil nu et coûteuse en production.

# 🔗 Tracking Links + Analytics

Module **autonome** de Valmont : un lien court par modèle (`mydomain.com/emma`),
placé en bio Instagram / TikTok, qui redirige vers sa page d'abonnement et
mesure les clics, les visiteurs uniques et les conversions **attribuées**.

Il n'a aucune dépendance avec les autres fonctionnalités de l'application :
tout vit dans ce dossier, plus deux balises et une entrée de menu dans
`index.html`.

---

## Ce que le module contient

| Fichier | Rôle |
| --- | --- |
| `schema.sql` | Base de données : tables, RLS, vues analytiques, fonctions d'attribution (à exécuter dans Supabase) |
| `worker.js` | Redirection publique `/<slug>` + API d'ingestion des conversions (Cloudflare Worker) |
| `tracking-links.js` | Interface : pages Tracking Links, détail d'un lien, modèles, modales |
| `tracking-links.css` | Style du module (préfixe `vtl-`, aucune règle ne sort de ses vues) |
| `tests/` | Tests SQL, tests du Worker, tests d'interface et de non-régression |

Découpage :

```
Navigateur (bio Instagram)                Cloudflare Worker              Supabase (Postgres)
        │                                        │                              │
        │  GET mydomain.com/emma                 │                              │
        ├───────────────────────────────────────►│                              │
        │                                        │  tl_resolve (cache 60 s)     │
        │  302 → page d'abonnement               ├─────────────────────────────►│
        │◄───────────────────────────────────────┤                              │
        │       (le clic est écrit APRÈS,        │  tl_record_click             │
        │        la redirection n'attend pas)    ├─────────────────────────────►│
                                                 │                              │
Source autorisée (plateforme)                    │                              │
        │  POST /api/conversions + Bearer clé    │  tl_ingest_conversion        │
        ├───────────────────────────────────────►├─────────────────────────────►│
                                                                                │
Application Valmont ──── lecture directe (RLS, session de l'utilisateur) ───────►│
```

---

## Étape 1 — Installer la base

1. Supabase → ton projet → **SQL Editor**.
2. Colle tout le contenu de [`schema.sql`](./schema.sql) → **Run**.
3. Le script est **idempotent** : tu peux le rejouer sans risque, il ne touche
   à aucune table existante (tout est préfixé `tl_`).

Tu obtiens :

| Table | Contenu |
| --- | --- |
| `tl_models` | Les modèles / créatrices |
| `tl_campaigns` | Les campagnes (optionnelles) |
| `tl_traffic_sources` | Référentiel Instagram / TikTok / Twitter-X / Reddit / Other |
| `tl_links` | Les liens de tracking (slug unique, destination, statut, fenêtre d'attribution) |
| `tl_visitors` | Visiteurs anonymes (`visitor_8f32…`) — aucune donnée personnelle |
| `tl_clicks` | Un clic = date, lien, visiteur, source, UTM, hôte référent, pays, type d'appareil |
| `tl_conversions` | Conversions reçues d'une source autorisée |
| `tl_attribution_events` | Preuve d'attribution : quel clic a justifié quel rattachement |
| `tl_ingest_keys` | Clés d'API (seul le hash SHA-256 est stocké) |

Et les vues `tl_link_stats`, `tl_link_daily`, `tl_link_sources`,
`tl_model_stats` (clics, visiteurs uniques, clics du jour / 7 j / 30 j,
conversions, fans, revenu, taux de conversion, revenu par visiteur, revenu par fan).

---

## Étape 2 — Déployer la redirection

1. Cloudflare → **Workers & Pages** → **Create Worker** (ex. `valmont-tracking`).
2. **Edit code** → colle le contenu de [`worker.js`](./worker.js) → **Deploy**.
3. Onglet **Settings → Variables and Secrets** :

   | Nom | Type | Valeur |
   | --- | --- | --- |
   | `SUPABASE_URL` | Variable | `https://xxxx.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | **Secret** | la clé `service_role` du projet |
   | `VISITOR_SALT` | **Secret** | une longue chaîne aléatoire de ton choix |
   | `APP_ORIGINS` | Variable | origines autorisées pour l'API, séparées par des virgules |
   | `FALLBACK_URL` | Variable | (optionnel) où envoyer un slug inconnu |

   ⚠️ La clé `service_role` contourne la RLS : elle ne doit **jamais** apparaître
   dans le code du site, uniquement en secret côté Worker.

4. **Settings → Domains & Routes** → ajoute ton domaine (`mydomain.com/*`).

Vérification : `https://mydomain.com/api/health` doit répondre
`{"ok":true,"service":"valmont-tracking"}`.

---

## Étape 3 — Brancher l'application

Dans `index.html`, en haut du fichier :

```js
window.VALMONT_TRACKING = {
  redirectBase: 'https://mydomain.com',
  apiUrl: 'https://mydomain.com/api/conversions'
};
```

C'est tout : la page **Tracking Links** apparaît dans le menu *Analytics*.

Sans backend Supabase configuré, le module fonctionne en **mode local** : les
liens sont conservés dans le navigateur, aucune redirection n'est servie et
**aucun chiffre n'est inventé** — les compteurs restent à zéro et un bandeau
l'explique. Un jeu de démonstration, clairement étiqueté `DEMO`, peut être
chargé à la demande (jamais automatiquement) et retiré d'un clic.

---

## Conversions : revenus et fans

> Un clic ne dit rien du revenu ni du nombre de fans. Le module ne le déduit
> jamais. Les conversions doivent arriver d'une **source autorisée** — l'API de
> la plateforme, ou l'import d'un export officiel.

### API

```bash
curl -X POST https://mydomain.com/api/conversions \
  -H "Authorization: Bearer vtl_…" \
  -H "Content-Type: application/json" \
  -d '{
        "external_id": "cv_8842",
        "slug": "emma",
        "visitor_id": "visitor_8f32a1b0c9d4e7f2",
        "fan_id_hash": "b7f1c0d9e2",
        "amount": 49.90,
        "currency": "USD",
        "created_at": "2026-08-24T10:12:00Z"
      }'
```

| Champ | Obligatoire | Détail |
| --- | --- | --- |
| `external_id` (ou `conversion_id`) | oui | Identifiant chez la source — garantit l'idempotence |
| `tracking_link_id` ou `slug` | non | Lien annoncé par la source |
| `visitor_id` | non | Identifiant anonyme émis lors du clic |
| `fan_id_hash` | non | Identifiant de fan **haché par la source** — jamais un nom, un e-mail ou un pseudo |
| `amount`, `currency` | oui / défaut `USD` | Montant ≥ 0, devise ISO à 3 lettres |
| `created_at` (ou `occurred_at`) | non | Défaut : maintenant |

Un lot est accepté (tableau JSON, 500 lignes max). Les clés se créent depuis
l'application : **Tracking Links → Attribution & API**. La clé en clair n'est
affichée qu'une fois ; seul son hash est conservé.

### Import manuel

Même écran, zone **Import** : colle un CSV (`external_id,slug,fan_id_hash,amount,currency,created_at`)
ou un tableau JSON. Les doublons sont ignorés, le résultat détaille
importées / attribuées / doublons / erreurs.

### Règle d'attribution

Une conversion passe en `attributed` **uniquement** si une correspondance
valide existe :

1. lien annoncé par la source **et** un clic sur ce lien avant la conversion,
   dans la fenêtre d'attribution ;
2. sinon, **dernier clic** du visiteur (`visitor_id`) dans la fenêtre du lien cliqué ;
3. sinon la conversion est conservée en `unattributed` — elle ne gonfle
   aucun chiffre, et pourra être rattachée plus tard
   (bouton *Relancer l'attribution*).

La fenêtre est réglable par lien : **7, 14, 30, 60 ou 90 jours** (30 par défaut).
Chaque rattachement laisse une trace dans `tl_attribution_events`
(clic retenu, critère, fenêtre appliquée).

---

## Vie privée et sécurité

- **Aucune donnée personnelle** : ni nom, ni e-mail, ni pseudo de fan.
- **Aucune IP stockée.** L'IP sert uniquement, en mémoire dans le Worker, à
  dériver une empreinte anonyme quand le navigateur refuse les cookies ; elle
  est hachée avec un sel et une date, puis oubliée.
- **Aucun user-agent stocké** : seule une catégorie d'appareil
  (`mobile` / `desktop` / `tablet` / `other`) est conservée.
- Le référent est réduit à son **hôte** (`instagram.com`), jamais l'URL complète.
- **RLS sur toutes les tables** : un utilisateur ne lit et n'écrit que ses
  propres modèles, liens, clics, visiteurs et conversions. Les données d'une
  modèle appartenant à un autre compte sont inaccessibles, y compris via les
  vues analytiques.
- Les écritures de tracking passent par des fonctions `SECURITY DEFINER`
  réservées au rôle `service_role` : le rôle public `anon` ne peut ni les
  appeler, ni lire une table.
- **Slugs** : format contraint (`^[a-z0-9][a-z0-9._-]{1,47}$`), liste de mots
  réservés, unicité garantie en base.
- **Destinations** : http(s) uniquement, hôtes locaux et plages privées
  refusés (anti-SSRF), longueur bornée — validé côté interface **et** en base.
- La page de redirection est en `no-store`, `noindex`, `no-referrer`.

---

## Tests

```bash
# Base de données (nécessite un PostgreSQL local + un schéma auth simulé)
psql -f tracking/tests/01-fonctionnel.sql
psql -f tracking/tests/02-securite-rls.sql

# Worker de redirection et API (aucun réseau)
node tracking/tests/03-worker.test.mjs

# Interface, mode cloud, non-régression de l'app (Chromium)
node tracking/tests/04-ui.test.mjs
node tracking/tests/05-cloud.test.mjs
node tracking/tests/06-non-regression.test.mjs
```

Les tests 01 et 02 s'exécutent sur n'importe quelle base PostgreSQL 15+ dans
laquelle on a d'abord créé les rôles `anon`, `authenticated`, `service_role` et
un schéma `auth` minimal (`auth.users`, `auth.uid()`) — voir l'en-tête de
`tests/02-securite-rls.sql`.

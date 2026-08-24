# Cadence — studio de messaging pour agences de créateurs

Outil interne qui aide un **opérateur humain** à gérer plusieurs modèles et à rédiger des messages
cohérents avec la personnalité de chacun : profils, bibliothèques de scripts, génération de
réponses, favoris, analytics et garde-fous.

L'outil **ne remplace pas l'opérateur** : il propose, l'opérateur relit, modifie et envoie. Rien
n'est envoyé automatiquement, aucune connexion aux plateformes n'est faite.

---

## Démarrage en 3 minutes

```bash
cd cadence
cp .env.example .env          # puis renseigne ANTHROPIC_API_KEY (optionnel, voir plus bas)
npm install
npm run dev                   # API sur :4000, interface sur :5173
```

Ouvre <http://localhost:5173> et connecte-toi avec le compte créé au premier démarrage
(`ADMIN_EMAIL` / `ADMIN_PASSWORD` du `.env`, par défaut `admin@cadence.local` / `cadence`).
**Change ce mot de passe avant toute utilisation réelle.**

Sans clé API, l'outil démarre en **mode local** : il compose des ébauches hors ligne. Tout le reste
(profils, scripts, favoris, recherche, analytics) fonctionne à l'identique.

### Production

```bash
npm run build && npm start    # l'API sert aussi l'interface, sur $PORT
```

Une seule dépendance d'infrastructure : un fichier SQLite (`DATABASE_PATH`), à sauvegarder.

---

## L'interface

| Section | Ce qu'on y fait |
|---|---|
| **Dashboard** | Volume du jour et de la semaine, modèles, revenu attribué, dernières générations. |
| **Models** | Liste des modèles, création. La sidebar reprend la liste avec recherche, avatar, statut, nombre de scripts. |
| **Global Scripts** | Bibliothèque partagée, accessible depuis tous les modèles sans duplication. |
| **Favorites** | Scripts, modèles et prompts épinglés, retirables d'un clic. |
| **Prompt Generator** | Génération de réponses pour un modèle : contexte, objectif, ton, plusieurs propositions. |
| **Analytics** | Usage, conversion, revenu et score, par script, par catégorie et par modèle. |
| **Settings** | Prompt templates, scénarios, équipe, variables disponibles, thème. |

### L'espace d'un modèle

Cliquer sur un modèle ouvre son espace, en cinq onglets :

- **Overview** — chiffres clés, résumé du profil, scripts récents, dernières générations.
- **Profile** — name, age, personality, tone of voice, writing style, vocabulary, interests,
  content style, target audience, things to mention, things to avoid, custom instructions.
  Ces informations alimentent **automatiquement** le prompt système à chaque génération.
- **Scripts** — bibliothèque du modèle **plus** les scripts globaux, filtrables.
- **Prompt Generator** — la console, avec le modèle déjà sélectionné.
- **Performance** — usage, conversion, revenu, dernière utilisation et score par script.

---

## Scripts

Un script appartient soit à un modèle, soit à la bibliothèque globale (`model_id = null`). Les
scripts globaux sont visibles depuis chaque modèle **sans être dupliqués**.

**16 catégories** livrées : First Message, Getting to Know, Flirting, PPV, PPV Follow-up, Upsell,
Custom Content, Re-engagement, Retention, High Spender, Low Spender, Objection Handling,
Thank You, Good Morning, Good Night, Other. D'autres peuvent être ajoutées.

Chaque script porte un nom, une catégorie, une description, un objectif, un ton, un déclencheur,
des tags, un contenu variabilisé, un compteur d'utilisation, un statut favori et un historique de
versions. Actions : Edit, Duplicate, Copy, Favorite, Delete, **Generate Variations**.

### Variables dynamiques

`{{creator_name}}`, `{{subscriber_name}}`, `{{subscriber_message}}`, `{{conversation_context}}`,
`{{objective}}`, `{{tone}}`, `{{price}}`, `{{content_type}}` — et une vingtaine d'autres, listées
dans Settings. L'éditeur les insère au curseur et montre le rendu réel en temps réel.

### Performance

Copier un script depuis la bibliothèque compte comme une utilisation. Une conversion (avec
montant) s'enregistre depuis l'onglet Performance. Le score sur 100 pondère conversion (60 %),
volume (20 %) et revenu (20 %).

---

## Raccourcis

- `⌘/Ctrl + ↵` dans la console : générer.
- Barre du haut : recherche globale (modèles, scripts, templates, historique).
- Clic sur **Copy** : copie le message et enregistre l'utilisation.
- Clic sur une variable dans un éditeur : insertion au curseur.

---

## Garde-fous intégrés

Appliqués **côté serveur**, non contournables depuis l'interface :

- aucun fait vérifiable inventé (lieu, âge, agenda, prix, délai, disponibilité) ;
- aucune promesse de contenu ou de service non fourni dans le contexte ;
- aucune pression, urgence artificielle ou culpabilisation ;
- si l'abonné demande s'il parle à une équipe, aucune suggestion de démenti n'est produite ;
- message laissant penser à un mineur → génération bloquée, escalade demandée ;
- signaux de détresse ou de difficulté financière → mode vigilance, aucune relance commerciale.

Chaque proposition est ensuite **validée automatiquement** contre le profil du modèle (vocabulaire
interdit, sujets interdits, longueur, style d'emojis, promesses, faits personnels) et les problèmes
sont affichés à l'opérateur avant l'envoi.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — modèle de données, API, moteur de génération,
  sécurité, déploiement, évolutions.

## Structure

```
cadence/
├── shared/        types, catalogue de variables, scénarios et catégories livrés
├── server/        API Express + SQLite + moteur de génération
│   └── src/
│       ├── db/          schéma, migrations, dépôts (repos, scripts), données initiales
│       ├── http/        routes (api, scripts, auth), validation zod
│       ├── generation/  variables, prompts, fournisseurs LLM, validation
│       └── lib/         erreurs, identifiants
└── web/           interface React + Vite
    └── src/
        ├── pages/       Dashboard, Models, ModelDetail, GlobalScripts, Favorites,
        │                Generator, Analytics, Settings, Search, History
        └── components/  ScriptLibrary, ScriptEditor, ModelProfileForm,
                         GeneratorPanel, bibliothèque d'UI
```

## Tests

```bash
npm test      # 21 tests : moteur de génération, portée des scripts, favoris, performance
```

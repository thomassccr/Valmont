# Cadence — studio de messaging pour agences de créateurs

Outil interne qui aide un **opérateur humain** à rédiger des messages cohérents avec la
personnalité d'un créateur : fiches créateurs, scénarios de conversation, templates de prompt
variabilisés, génération de plusieurs propositions de réponse, historique et garde-fous.

L'outil **ne remplace pas l'opérateur** : il produit des propositions que l'opérateur relit,
modifie et envoie. Rien n'est envoyé automatiquement, aucune connexion aux plateformes n'est faite.

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

Sans clé API, l'outil démarre en **mode local** : il compose des ébauches à partir de la fiche
créateur, sans appel réseau. Tout le reste (fiches, scénarios, templates, aperçu, historique)
fonctionne à l'identique — pratique pour installer, former l'équipe et tester.

### Production

```bash
npm run build                 # compile l'API et l'interface
npm start                     # l'API sert aussi l'interface, sur $PORT
```

Une seule dépendance d'infrastructure : un fichier SQLite (`DATABASE_PATH`). Prévoir une
sauvegarde de ce fichier.

---

## Les 6 briques

| Brique | Où | Ce que ça fait |
|---|---|---|
| **Prompt Builder** | Créateurs | Fiche complète : personnalité, ton, style, vocabulaire, sujets à privilégier / éviter, objectifs, garde-fous. |
| **Conversation Generator** | Console | Message reçu + historique + contexte → plusieurs propositions, avec copie en un clic. |
| **Scenario Builder** | Scénarios | 6 scénarios livrés (première interaction, relance, après achat, fidélisation, question, réactivation) + scénarios sur mesure. |
| **Prompt Templates** | Templates | Bibliothèque : créer, dupliquer, modifier, catégoriser, rechercher, épingler. |
| **Variables dynamiques** | Partout | `{{creator_name}}`, `{{subscriber_message}}`, `{{objective}}`… avec aperçu temps réel. |
| **Historique** | Historique | Traçabilité complète : qui a généré quoi, quelle proposition a été envoyée, rejeu en un clic. |

---

## Raccourcis utiles

- `⌘/Ctrl + ↵` dans la console : générer.
- Clic sur **Copier** : copie le message *et* le marque comme envoyé (statistiques d'équipe).
- Clic sur une variable dans l'éditeur de template : insertion au curseur.

---

## Garde-fous intégrés

Ces règles sont appliquées **côté serveur** et ne sont pas contournables depuis l'interface :

- aucun fait vérifiable inventé (lieu, âge, agenda, prix, délai, disponibilité) ;
- aucune promesse de contenu ou de service non fourni dans le contexte ;
- aucune pression, urgence artificielle ou culpabilisation ;
- si l'abonné demande s'il parle à une équipe, aucune suggestion de démenti n'est produite ;
- message laissant penser à un mineur → génération bloquée, escalade demandée ;
- signaux de détresse ou de difficulté financière → mode vigilance, aucune relance commerciale.

Chaque proposition est ensuite **validée automatiquement** contre la fiche du créateur
(vocabulaire interdit, sujets interdits, longueur, style d'emojis, promesses, faits personnels)
et les problèmes sont affichés à l'opérateur avant l'envoi.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture complète : modèle de données, API,
  moteur de génération, sécurité, déploiement, évolutions.

## Structure

```
cadence/
├── shared/        types TypeScript, catalogue de variables, scénarios livrés
├── server/        API Express + SQLite + moteur de génération
│   └── src/
│       ├── db/          schéma, connexion, dépôts, données initiales
│       ├── http/        routes, validation zod, authentification
│       ├── generation/  variables, prompts, fournisseurs LLM, validation
│       └── lib/         erreurs, identifiants
└── web/           interface React + Vite
    └── src/
        ├── pages/       Dashboard, Console, Créateurs, Scénarios, Templates, Historique
        └── components/  bibliothèque d'UI
```

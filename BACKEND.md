# Activer le backend cloud de Valmont (Supabase)

Sans configuration, Valmont fonctionne comme avant : tout est stocké dans le
navigateur (localStorage). En activant le backend, tu obtiens :

- **De vrais comptes** : email + mot de passe gérés par Supabase (mots de passe
  hashés côté serveur, plus rien de sensible dans le navigateur).
- **Synchronisation multi-appareils** : sessions de trading, comptes du
  dashboard, trades, avatar, plan… tout suit l'utilisateur sur n'importe quel
  appareil.
- **Plus de perte de données** si l'utilisateur vide son cache.
- **Reconnexion automatique** : plus besoin de se reconnecter à chaque visite.

L'installation prend ~10 minutes et le plan gratuit de Supabase suffit largement
pour démarrer.

## Étape 1 — Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com) → **Start your project** → crée un
   compte (gratuit).
2. **New project** : choisis un nom (ex. `valmont`), un mot de passe de base de
   données (garde-le quelque part), une région proche (ex. `eu-west-3` Paris).
3. Attends ~1 minute que le projet soit prêt.

## Étape 2 — Créer la table

1. Dans ton projet : menu de gauche → **SQL Editor**.
2. Ouvre le fichier [`supabase-schema.sql`](./supabase-schema.sql) de ce dépôt,
   copie tout son contenu, colle-le dans l'éditeur.
3. Clique **Run**. Tu dois voir « Success. No rows returned ».

## Étape 3 — (Recommandé) Simplifier l'inscription

Par défaut Supabase demande une confirmation par e-mail à l'inscription.
Pour que tes utilisateurs entrent directement :

1. Menu de gauche → **Authentication** → **Sign In / Up** (ou « Providers »).
2. Dans **Email**, désactive **Confirm email**.
3. Sauvegarde.

(Si tu laisses la confirmation activée, ça marche aussi : l'app affiche
« Vérifie ta boîte mail » après l'inscription.)

## Étape 4 — Brancher l'app

1. Dans Supabase : menu de gauche → **Project Settings** → **API** (ou
   « Data API »). Tu y trouves :
   - **Project URL** (ex. `https://abcdefgh.supabase.co`)
   - **anon public** key (une longue chaîne commençant par `eyJ…`)
2. Ouvre `index.html`, cherche `VALMONT_BACKEND` (tout en haut du fichier) et
   colle tes deux valeurs :

```js
window.VALMONT_BACKEND = {
  url: 'https://abcdefgh.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIs…'
};
```

3. Commit + push. C'est tout.

> La clé « anon public » est **faite pour être publiée** dans le code du site :
> la sécurité est assurée côté serveur par les règles RLS du schéma (chaque
> utilisateur ne peut lire et écrire que ses propres données).

## Comment ça marche

- **Inscription / connexion** : l'écran de login existant utilise maintenant
  Supabase Auth quand le backend est configuré. Les anciens comptes locaux
  continuent de fonctionner (y compris les mots de passe spéciaux).
- **Synchronisation** : à chaque modification (nouvelle session, trade importé,
  avatar changé…), l'app pousse automatiquement un instantané des données vers
  Supabase (2 s après la dernière modification). À la connexion sur un nouvel
  appareil, les données du cloud sont téléchargées.
- **Première connexion** : si le compte cloud n'a pas encore de données, les
  données locales existantes de l'appareil sont migrées vers le cloud
  automatiquement.
- **Reprise de session** : au chargement de la page, si l'utilisateur était
  connecté, il arrive directement sur l'accueil sans repasser par le login.

## Dépannage

- « Email ou mot de passe incorrect » alors que le compte existe → vérifie que
  l'utilisateur s'est bien inscrit **après** l'activation du backend (les
  anciens comptes locaux ne sont pas dans Supabase — il faut se réinscrire une
  fois avec la même adresse).
- Les données ne se synchronisent pas → ouvre la console du navigateur (F12) et
  cherche des messages `[VMB]`.
- Voir les utilisateurs inscrits → Supabase → **Authentication** → **Users**.
- Voir les données → Supabase → **Table Editor** → `user_data`.

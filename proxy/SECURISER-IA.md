# 🔐 Sécuriser le coach IA de Valmont

Aujourd'hui, la clé de l'IA est écrite en clair dans le code du site. Comme le
site est public, n'importe qui peut la voler. Ce guide met en place un petit
« intermédiaire » (un *proxy*) qui garde la clé cachée. Ça prend ~10 minutes,
c'est gratuit, et **il n'y aura aucune coupure du coach** si tu suis l'ordre.

> ⚠️ Important : ta clé actuelle est déjà publique. On la remplacera par une
> **nouvelle** clé, et on supprimera l'ancienne à la toute fin.

---

## Étape 1 — Créer une nouvelle clé Groq

1. Va sur **https://console.groq.com/keys**
2. Clique sur **Create API Key**, donne-lui un nom (ex. « valmont »).
3. **Copie la clé** (elle commence par `gsk_...`) et garde-la de côté.
   *(Ne supprime pas encore l'ancienne — on le fera à la fin.)*

---

## Étape 2 — Créer le proxy sur Cloudflare (gratuit)

1. Crée un compte gratuit sur **https://dash.cloudflare.com/sign-up**
2. Dans le menu de gauche : **Workers & Pages** → **Create application** →
   **Create Worker**.
3. Donne-lui un nom, par exemple **`valmont-ia`**, puis clique **Deploy**.
4. Une fois créé, clique **Edit code**.
5. Efface tout le code affiché, et **colle à la place** le contenu du fichier
   [`valmont-ia-worker.js`](./valmont-ia-worker.js) (dans ce même dossier).
6. Clique **Deploy** (en haut à droite).

---

## Étape 3 — Y mettre ta clé (en secret)

1. Reviens sur la page de ton worker → onglet **Settings** →
   **Variables and Secrets** (ou « Variables »).
2. Clique **Add** / **Add variable**, choisis le type **Secret**.
3. Nom : **`GROQ_KEY`** (exactement, en majuscules).
4. Valeur : **colle la nouvelle clé Groq** de l'étape 1.
5. **Save** / **Deploy**.

---

## Étape 4 — Récupérer l'adresse du proxy

En haut de la page de ton worker, tu vois une adresse qui ressemble à :

```
https://valmont-ia.TON-COMPTE.workers.dev
```

**Copie cette adresse et envoie-la-moi.** Je l'insère dans l'app et je publie
la mise à jour. À ce moment-là, le coach passe automatiquement par le proxy.

---

## Étape 5 — Supprimer l'ancienne clé (seulement après)

Une fois que je t'ai confirmé que l'app est passée sur le proxy et que le coach
répond bien :

1. Retourne sur **https://console.groq.com/keys**
2. Supprime **l'ancienne** clé (`gsk_Si6C2KW7...`).

Voilà : la clé n'est plus jamais exposée. 🎉

---

### En résumé

| Étape | Où | Ce que tu fais |
|------|-----|----------------|
| 1 | console.groq.com | Créer une **nouvelle** clé |
| 2 | Cloudflare | Créer le worker + coller le code |
| 3 | Cloudflare | Ajouter le secret `GROQ_KEY` |
| 4 | Cloudflare | Copier l'adresse et **me l'envoyer** |
| 5 | console.groq.com | Supprimer l'**ancienne** clé (à la fin) |

*(Alternative à Cloudflare : Vercel fonctionne aussi, mais Cloudflare Workers
est le plus simple pour ce cas — un seul fichier, pas de configuration.)*

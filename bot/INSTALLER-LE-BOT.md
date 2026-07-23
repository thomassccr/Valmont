# 🌙 Installer le bot « Shutdown 00h30 »

Chaque nuit à 00h30, ce bot Telegram te pose 3 questions pour fermer ta
journée, puis logge ta série de discipline (**streak**) :

1. Tes 3 priorités du jour, tu les as faites ?
2. Journal de trading rempli ?
3. LA priorité n°1 de demain (une phrase).

Objectif : **ne jamais finir une journée sans avoir défini la prochaine
action** — et rendre ta constance visible.

Ça tourne sur un **Cloudflare Worker** (comme ton proxy IA), c'est gratuit,
et l'installation prend ~15 minutes. Rien à laisser allumé chez toi.

---

## Étape 1 — Créer le bot Telegram

1. Dans Telegram, ouvre une conversation avec **@BotFather**.
2. Envoie `/newbot`, choisis un nom (ex. « Valmont Coach ») et un identifiant
   finissant par `bot` (ex. `valmont_shutdown_bot`).
3. BotFather te donne un **token** de la forme `123456789:AA...`. Garde-le.
   *(C'est ton `BOT_TOKEN`.)*

---

## Étape 2 — Créer le Worker

1. Sur **https://dash.cloudflare.com** → **Workers & Pages** →
   **Create application** → **Create Worker**.
2. Nomme-le **`valmont-shutdown-bot`**, clique **Deploy**, puis **Edit code**.
3. Efface tout, colle le contenu de [`shutdown-worker.js`](./shutdown-worker.js),
   et clique **Deploy**.
4. Note l'URL du worker (ex. `https://valmont-shutdown-bot.<toncompte>.workers.dev`).

---

## Étape 3 — Créer le stockage (KV)

1. **Workers & Pages** → **KV** → **Create a namespace**, nomme-le
   `shutdown` → **Add**.
2. Reviens sur ton worker → **Settings** → **Bindings** (ou **Variables**) →
   **Add** → **KV namespace**.
3. **Variable name** : `SHUTDOWN_KV` (exactement) — **KV namespace** : celui
   que tu viens de créer. **Save**.

---

## Étape 4 — Ajouter les secrets

Sur ton worker → **Settings** → **Variables and Secrets** → **Add** (type
**Secret**) pour chacun :

| Nom              | Valeur                                                        |
|------------------|--------------------------------------------------------------|
| `BOT_TOKEN`      | le token donné par BotFather (étape 1)                        |
| `WEBHOOK_SECRET` | une longue chaîne au hasard que tu inventes (ex. 30 caractères) |

*(On ajoutera `CHAT_ID` à l'étape 6, une fois qu'on l'aura obtenu.)*

Clique **Deploy** pour appliquer.

---

## Étape 5 — Brancher Telegram sur le Worker (webhook)

Dans un terminal, lance cette commande en remplaçant les deux valeurs entre
`< >` par ton token et ton `WEBHOOK_SECRET`, et l'URL par celle de ton worker :

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://valmont-shutdown-bot.<toncompte>.workers.dev/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

Tu dois voir `{"ok":true,"result":true,...}`.

---

## Étape 6 — Récupérer ton CHAT_ID

1. Dans Telegram, ouvre la conversation avec **ton** bot et envoie `/start`.
2. Le bot répond : `Ton CHAT_ID : 123456789`.
3. Retourne dans **Settings → Variables and Secrets**, ajoute un **Secret** :
   - Nom : `CHAT_ID` — Valeur : le numéro renvoyé.
4. **Deploy**.

---

## Étape 7 — Régler l'heure (Cron)

1. Sur ton worker → **Settings** → **Triggers** → **Cron Triggers** →
   **Add Cron Trigger**.
2. Entre : `30 22 * * *`
   *(00h30 à Paris en **été**. En **hiver**, remplace par `30 23 * * *`.)*
3. **Add**.

---

## C'est prêt ✅

- Teste tout de suite en envoyant `/shutdown` à ton bot : le rituel démarre.
- `/streak` → affiche ta série et ta priorité du lendemain.
- `/focus` → te renvoie ta priorité enregistrée (« la prochaine action »).
- Chaque nuit à 00h30, le rituel se lancera tout seul.

## Idées de suite (mêmes fichiers, mêmes secrets)

Ce worker est le **socle** de ton assistant. Tu peux y greffer, plus tard,
sans repartir de zéro :

- un **brief du matin** (autre Cron : Top 3 priorités du jour) ;
- le **rappel discipline de 15h20** avant l'ouverture des marchés ;
- un module **capture** (tu envoies une idée → rangée dans Notion/Todoist).

Un seul bot, des modules qu'on ajoute. Pas dix projets éparpillés.

---

## Dépannage

- Le bot ne répond pas à `/start` → revérifie l'étape 5 (webhook). Relance :
  `curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"` et regarde le
  champ `last_error_message`.
- Le message de 00h30 n'arrive pas → vérifie que `CHAT_ID` est bien défini et
  que le Cron Trigger existe (Settings → Triggers).
- Mauvaise heure → ajuste le cron été/hiver (étape 7).
- Voir ton streak et tes logs → Worker → **KV** → ton namespace → clés
  `streak`, `tomorrow`, `log:AAAA-MM-JJ`.

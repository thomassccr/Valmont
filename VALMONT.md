# Valmont

Une intelligence personnelle qui se souvient, remarque et prend l'initiative.

> **Note sur ce dépôt.** Le dépôt contient aussi **Valmont — Trading Assistant**,
> une application antérieure et sans rapport (`index.html`, `site/`, `proxy/`,
> `desktop-app/`, `supabase-schema.sql`, `BACKEND.md`). Elle n'a pas été touchée.
> Le présent projet vit dans `packages/` et `apps/`.

---

## Ce que c'est

Valmont retient ce que tu lui dis, le relie au reste, et t'en reparle quand
c'est pertinent. Il connaît tes projets, tes objectifs, tes habitudes et ta
manière de fonctionner, et il évolue avec toi.

Concrètement, il sait faire ça :

```
« J'ai une idée de business : une app de coaching sportif. »
  → crée l'idée, la met en incubation, la relie à tes projets existants

« Où en est Vintex ? »
  → statut, liens, derniers souvenirs, et depuis combien de temps tu n'en as pas parlé

« Tu trouves que je procrastine ? »
  → répond à partir de tes chiffres réels, pas d'une impression

« Rappelle-moi ce que j'avais imaginé il y a trois semaines. »
  → retrouve, y compris ce que tu as depuis abandonné

Et sans qu'on lui demande :
  « Tu n'as pas parlé de Vintex depuis 10 jours. »
  « Tu travailles beaucoup moins cette semaine. »
  « Tu m'avais dit 10k, tu dis 25k maintenant. »
  « La discipline revient de plus en plus dans ce que tu racontes. »
```

L'architecture, les arbitrages et les seuils sont documentés dans
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Démarrer

Il faut Node 22+ et pnpm 10+.

```bash
pnpm install
cp .env.example .env      # puis renseigner ANTHROPIC_API_KEY

pnpm dev:core             # le noyau, sur 127.0.0.1:4319
pnpm dev:ui               # l'interface, sur 127.0.0.1:4320
```

Au premier lancement, un jeton local est écrit dans `~/.valmont/token`. Il faut
le donner à l'interface :

```bash
echo "NEXT_PUBLIC_VALMONT_TOKEN=$(cat ~/.valmont/token)" >> apps/ui/.env.local
```

### Sans clé API

Valmont démarre quand même, en mode dégradé, et le dit. Rien ne bloque le
lancement — c'est délibéré.

### Choisir son modèle

Deux fournisseurs sont branchés, et ils ne servent pas à la même chose.

| | Claude (`anthropic`) | Groq (`groq`) |
| --- | --- | --- |
| Qualité de raisonnement et de français | la meilleure | correcte |
| Vitesse | normale | ~10× plus rapide |
| Coût | à l'usage | palier gratuit large |
| Embeddings | non | non |

**Le réglage recommandé : Claude pour la voix, Groq pour le fond.** Valmont fait
deux choses très différentes — parler (quelques dizaines d'appels par jour, où
la nuance décide de tout) et structurer (des centaines d'appels invisibles :
extraction, résumés, reformulations). Mettre les deux sur le même modèle est un
gâchis dans un sens ou une perte de qualité dans l'autre.

```bash
VALMONT_LLM_PROVIDER=anthropic     # la voix
ANTHROPIC_API_KEY=sk-ant-...
VALMONT_FAST_PROVIDER=groq         # les tâches de fond
GROQ_API_KEY=gsk_...
```

**Tout sur Groq**, si tu veux d'abord essayer sans payer :

```bash
VALMONT_LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
```

La clé se crée en trente secondes sur [console.groq.com](https://console.groq.com)
→ *API Keys*. Les identifiants de modèle ne sont pas figés dans le code : si tu
veux en changer, mets `VALMONT_LLM_MODEL` avec un identifiant pris dans
[la liste de Groq](https://console.groq.com/docs/models).

⚠️ Groq ne fournit **pas** d'embeddings. La mémoire vectorielle reste sur
Ollama, OpenAI ou le repli local — voir la section suivante.

### Recherche sémantique

Par défaut, les embeddings utilisent un repli local sans réseau : ça marche,
mais la recherche par le sens est nettement moins bonne. Deux options :

```bash
# 100 % local, aucune donnée ne sort de la machine
ollama pull nomic-embed-text
VALMONT_EMBEDDING_PROVIDER=ollama

# ou, meilleure qualité pour quelques centimes par an
VALMONT_EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

Changer de modèle d'embedding invalide l'index vectoriel, qui se reconstruit
tout seul. Aucun souvenir n'est perdu.

---

## Le dépôt

```
packages/
  types      vocabulaire commun — aucune dépendance, aucune logique
  kernel     bus d'événements, configuration, planificateur, math, texte
  llm        Claude + embeddings, derrière des interfaces remplaçables
  memory     souvenirs, entités, thèmes, métriques, initiatives, profil
  agents     conversation, extraction, observation, réflexion, résumé
apps/
  core       serveur du noyau — REST + WebSocket + tâches de fond
  ui         interface — noyau holographique, conversation, tableau de bord
```

## Commandes

```bash
pnpm typecheck                  # tout le monorepo
pnpm --filter @valmont/memory smoke   # exerce le moteur de mémoire de bout en bout
pnpm --filter @valmont/llm test       # vérifie la traduction vers l'API Groq
pnpm build                      # déclarations des paquets
```

Déclencher un agent de fond sans attendre son horaire :

```bash
curl -X POST http://127.0.0.1:4319/agents/observer/run
curl -X POST http://127.0.0.1:4319/agents/reflection/run
curl -X POST http://127.0.0.1:4319/agents/maintenance/run
```

## Tes données

Tout vit dans `~/.valmont/` : la base, les journaux, les sauvegardes. Rien ne
part ailleurs, en dehors des appels aux fournisseurs que tu as toi-même
configurés. Le serveur n'écoute que sur `127.0.0.1`.

Une sauvegarde à chaud tourne chaque nuit, en rotation sur sept jours, dans
`~/.valmont/cache/`. Le fichier `valmont.db` se copie tel quel.

# Valmont — architecture

> Ce document explique **pourquoi** le système est construit ainsi. Le code dit
> comment ; ici on garde la trace des arbitrages, pour que dans deux ans une
> décision ne soit pas défaite par ignorance de ce qu'elle protégeait.

---

## 1. Le principe directeur

Valmont n'est pas une application avec une base de données. C'est **une mémoire
qui parle**.

Cette phrase n'est pas de la rhétorique : elle décide de l'architecture. Dans
une application classique, la conversation est le produit et le stockage est un
détail. Ici, c'est l'inverse — la mémoire est le produit, et la conversation
n'est qu'une des interfaces avec elle. Le tableau de bord en est une autre. Une
future application mobile en sera une troisième. Toutes lisent la même mémoire ;
aucune ne détient d'état propre.

Trois conséquences qui traversent tout le code :

1. **Le noyau détient la vérité, les clients n'ont rien.** L'interface ne garde
   pas d'historique local, pas de cache, pas d'état de conversation. Un client
   qui stockerait finirait par diverger — et une mémoire qui diverge n'est plus
   une mémoire.
2. **Rien n'est jamais supprimé.** On déclasse, on archive, on remplace. « Ce
   que je pensais il y a trois semaines » doit rester répondable, même après un
   changement d'avis.
3. **Le journal d'événements fait autorité, tout le reste est une projection.**
   Si l'extraction s'améliore, on rejoue le journal et la mémoire se reconstruit.
   C'est la seule garantie qui rende le projet réellement évolutif sur des
   années.

---

## 2. Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────┐
│  CLIENTS — sans état, remplaçables                               │
│  apps/ui : Next.js · noyau holographique (R3F/GLSL) · voix       │
└─────────────────────────────┬────────────────────────────────────┘
                              │  WebSocket (flux, état, initiatives)
                              │  REST     (lectures ponctuelles)
┌─────────────────────────────▼────────────────────────────────────┐
│  NOYAU — apps/core                                               │
│  Fastify · Orchestrateur · Planificateur · Registre de modules   │
└──────┬───────────────────────────────────────┬───────────────────┘
       │                                       │
┌──────▼──────────────────┐          ┌─────────▼────────────────────┐
│  AGENTS                 │          │  MÉMOIRE                     │
│  packages/agents        │          │  packages/memory             │
│                         │          │                              │
│  Conversation (la voix) │◄────────►│  Souvenirs   Entités         │
│  Extracteur  (retient)  │          │  Thèmes      Métriques       │
│  Observateur (remarque) │          │  Initiatives Profil          │
│  Réflexion   (recoupe)  │          │  Journal (source de vérité)  │
│  Résumeur    (condense) │          │                              │
└──────┬──────────────────┘          └─────────┬────────────────────┘
       │                                       │
┌──────▼───────────────────────────────────────▼───────────────────┐
│  FONDATIONS                                                      │
│  packages/llm    — Claude, embeddings (interfaces remplaçables)   │
│  packages/kernel — bus, config, planificateur, math, texte        │
│  packages/types  — vocabulaire commun, zéro dépendance            │
└──────────────────────────────────────────────────────────────────┘
                              │
                    SQLite (~/.valmont/valmont.db)
```

Les dépendances vont **toujours vers le bas**. `types` ne dépend de rien.
`memory` ignore l'existence des agents. Les agents ignorent l'existence du
serveur. Aucun cycle, jamais.

---

## 3. La mémoire

C'est le cœur du projet et la partie qui mérite le plus d'attention.

### 3.1 Quatre natures de souvenir

| Nature       | Ce que c'est                     | Demi-vie  |
| ------------ | -------------------------------- | --------- |
| `episodic`   | Un événement daté                | 14 jours  |
| `reflective` | Une déduction de Valmont         | 90 jours  |
| `semantic`   | Un fait durable                  | 180 jours |
| `procedural` | Sa manière de fonctionner        | 365 jours |

La demi-vie n'est pas cosmétique : c'est la traduction chiffrée de « certaines
choses s'oublient vite, d'autres jamais ». Sans cette distinction, soit le
contexte est noyé sous l'anecdote récente, soit Valmont ressort des banalités
d'il y a six mois.

### 3.2 La récupération

Le score de pertinence combine six signaux :

```
score = w₁·sémantique + w₂·récence + w₃·importance
      + w₄·fréquence  + w₅·entités + w₆·dynamique_du_thème
```

le tout modulé par la confiance du souvenir — une déduction incertaine ne doit
pas se présenter avec la même autorité qu'une phrase dite explicitement.

**Trois sources de candidats**, fusionnées avant notation :

- **vectorielle** — capture le sens (« je suis crevé » ↔ « fatigue ») ;
- **plein texte (FTS5)** — capture les noms propres et le vocabulaire rare, que
  les embeddings diluent (« Vintex » n'est proche de rien) ;
- **graphe d'entités** — tout ce qui est rattaché aux entités citées.

Aucune ne suffit seule. La recherche vectorielle pure rate les noms de projets ;
la recherche plein texte pure rate les paraphrases. C'est l'erreur classique des
systèmes RAG, et elle se paie immédiatement en usage réel.

Enfin, **diversification MMR** : sans elle, une question sur « Vintex » remonte
cinq formulations du même fait et gâche tout le budget de contexte.

### 3.3 Ce qui rend la mémoire vivante

Quatre mécanismes automatiques, qui tournent sans intervention :

**Renforcement par le rappel.** Un souvenir effectivement utilisé voit son
importance monter légèrement. Au fil des mois, la mémoire se structure d'elle-même
autour de ce qui compte, sans qu'on ait rien à déclarer.

**Détection de contradiction.** Les souvenirs révisables portent un triplet
`(sujet, prédicat, objet)`. Un nouveau souvenir avec le même `(sujet, prédicat)`
et un objet différent déclasse l'ancien et émet un événement. C'est la matière
première du « tu m'avais dit X, là tu dis Y » — détecté par SQL, pas deviné par
un modèle.

**Thèmes émergents.** Regroupement incrémental des souvenirs autour de centres
de gravité vectoriels, puis mesure de la **dynamique** : fenêtre de 7 jours
contre fenêtre de 28, normalisée par la durée. Savoir que l'utilisateur parle de
sport n'apprend rien ; savoir qu'il en parle trois fois plus qu'il y a un mois
dit qu'un changement est en cours. C'est exactement le cas « si pendant
plusieurs semaines je parle de sport, discipline et nutrition, il doit
comprendre que ce sujet devient important ».

**Réflexion nocturne.** Chaque nuit, Valmont relit les souvenirs marquants et en
tire des observations de niveau supérieur — *« il abandonne ses projets vers la
troisième semaine, systématiquement après un premier retour négatif »*. Aucun
message ne dit ça ; ça ne se voit qu'en recoupant six semaines. Ces réflexions
sont stockées comme des souvenirs à part entière, avec un lien vers leurs
sources, donc traçables et contestables.

### 3.4 L'oubli

Les souvenirs épisodiques anciens, peu importants et jamais rappelés sont
**archivés**, jamais supprimés. Ils restent interrogeables explicitement mais
cessent de concurrencer le contexte courant. Une mémoire qui n'oublie rien
devient inutilisable exactement comme une mémoire qui oublie tout.

---

## 4. La proactivité

C'est ce qui sépare un agent d'un chatbot, et c'est aussi ce qui peut ruiner le
produit en une semaine si c'est mal fait.

### 4.1 Détection déterministe, formulation par le modèle

**Les constats sont calculés, pas devinés.** Silence d'un projet, décrochage
d'une métrique, contradiction, thème qui monte, corrélation, série record : tout
est du SQL et de l'arithmétique. Aucun modèle n'intervient dans la détection.
C'est reproductible, gratuit, auditable, et ça ne peut pas halluciner un
constat. Un agent proactif qui invente ce qu'il observe est pire qu'inutile.

Le modèle n'intervient qu'ensuite, pour **dire les choses bien** — transformer
« work_hours en baisse de 63%, z=-1.78 » en une phrase qu'une personne dirait.

### 4.2 L'étiquette

Les seuils par défaut sont le vrai contrat social du produit :

| Règle                        | Valeur         |
| ---------------------------- | -------------- |
| Interventions par jour       | 3 maximum      |
| Délai minimum entre deux     | 90 minutes     |
| Confiance minimale           | 0,55           |
| Plage horaire                | 8h – 23h       |
| Péremption d'une initiative  | 14 jours       |
| Temporisation par sujet      | 7 à 30 jours   |

Et un mécanisme d'apprentissage : le **taux de rejet par type** est mesuré sur
60 jours et vient pénaliser la confiance. Un type d'initiative systématiquement
rejeté finit par se taire tout seul.

Deux règles supplémentaires, tenues dans le code : Valmont ne prend jamais la
parole pendant qu'il répond, et une remarque périmée est supprimée plutôt que
livrée en retard.

---

## 5. Le noyau holographique

Le noyau n'est pas une décoration : c'est **la représentation de l'état
intérieur de Valmont**. Chaque état a un profil physique.

| État        | Ce qu'on voit                                                  |
| ----------- | -------------------------------------------------------------- |
| `idle`      | Respiration lente, rotation douce                              |
| `listening` | Les particules **convergent**, la turbulence s'éteint, les anneaux ralentissent |
| `thinking`  | Rotation maximale, engrenages lancés, circuits saturés          |
| `speaking`  | Pulsation calée sur l'amplitude de la voix                      |
| `working`   | Régime soutenu, mécanique très visible                          |

### Décisions de rendu

**Amortissement différencié.** L'énergie monte vite (le noyau doit réagir
instantanément), la mécanique a de l'inertie — comme une masse en rotation.
L'amortissement est exponentiel et indépendant de la fréquence d'images : sans
le terme en `dt`, l'animation changerait de vitesse entre 60 et 120 Hz.

**Un seul avanceur par image.** Une dizaine de composants lisent le profil à
chaque image, mais l'amortissement n'avance qu'une fois (composant `Driver`,
priorité `-1`). Les faire tous appeler `update` multiplierait la vitesse
d'animation par le nombre de composants — un bug invisible à la lecture et
évident à l'œil.

**Distribution des particules.** Spirale de Fibonacci pour les directions
(une distribution aléatoire produit des amas visibles), rayon en racine cubique
pour remplir le *volume* et non le centre, et surtout : le tirage « cœur » est
indépendant de l'indice. L'indice détermine déjà la latitude sur la spirale —
un test `i / count < 0.3` produit une calotte polaire, pas un cœur central.

**Bruit de rotationnel** plutôt que bruit simple : champ de vitesse à divergence
nulle, donc mouvement de fluide en circulation. C'est la différence entre « ça
vibre » et « ça vit ».

**Palette.** Braise → ambre → or → éclat blanc, avec un reflet bleu froid sur
les bords — c'est lui qui empêche le doré de virer au jaune plat. Aucun aplat
saturé, aucun néon : la lumière vient uniquement du noyau.

---

## 6. La voix

- **Détection d'activité vocale maison**, par énergie RMS avec seuil adaptatif.
  Un modèle de VAD embarqué coûte plusieurs mégaoctets pour un gain nul dans une
  pièce calme — le cas d'usage réel. Cinquante lignes suffisent, et ça démarre
  instantanément.
- **Interruption par la voix (barge-in).** Dès que l'utilisateur parle pendant
  que Valmont parle, la synthèse est coupée net et le tour en cours annulé. Sans
  ça, on ne peut pas couper la parole à Valmont, et la conversation cesse d'être
  naturelle.
- **Seuil adaptatif** : le plancher de bruit ne se met à jour que pendant le
  silence. Un seuil fixe serait inutilisable ailleurs que là où on l'a réglé.
- **Fenêtre de maintien** de ~0,65 s : une pause dans une phrase ne doit pas
  être prise pour une fin de tour.

---

## 7. Choix technologiques

| Choix                        | Pourquoi                                                                  |
| ---------------------------- | ------------------------------------------------------------------------- |
| **SQLite, un seul fichier**  | La mémoire d'une personne tient dans un fichier, doit survivre à l'absence de réseau et ne dépendre d'aucun service tiers. Un fichier se sauvegarde, se chiffre, se déplace. |
| **Index vectoriel en mémoire, balayage exhaustif** | ~18 000 souvenirs par an. 100 000 vecteurs à 768 dimensions = 300 Mo, balayés en ~15 ms. Une décennie de marge, zéro service à installer, **zéro faux négatif** — et « il a oublié » est le pire défaut possible pour une mémoire. L'interface `VectorIndex` reste le seul point de contact : Qdrant ou `sqlite-vec` se substituent sans toucher au reste. |
| **Claude en conversation, modèle rapide en fond** | L'extraction et la classification sont des tâches de structuration : y mettre le modèle de conversation coûterait dix fois plus cher pour un résultat équivalent. La réflexion nocturne, elle, tourne à effort élevé — c'est la seule tâche où le raisonnement profond change vraiment le résultat. |
| **Mise en cache d'invite systématique** | Persona + profil + souvenirs consolidés = des dizaines de milliers de jetons quasi identiques d'un tour à l'autre. Sans cache, une conversation longue coûte dix fois plus pour un résultat identique. D'où l'ordre imposé des segments : stable d'abord, volatile ensuite. |
| **Écoute sur 127.0.0.1 + jeton** | La mémoire d'une personne n'a rien à faire sur le réseau. |
| **Next.js plutôt qu'un bundle maison** | Le noyau holographique est lourd ; le découpage automatique et le chargement différé font que l'interface s'affiche instantanément et que le noyau s'allume ensuite — ce qui donne, à l'usage, l'impression d'un système qui se réveille. |

### Modes dégradés

**Valmont démarre toujours.** Une clé API manquante, un Ollama éteint, un
service injoignable : le système se lance, le signale dans `/health` et dans
l'interface, et fonctionne en dégradé. Une IA personnelle qui refuse d'ouvrir
parce qu'un service tiers est indisponible n'est pas une présence, c'est un
client d'API.

De même, une extraction ratée ne perd jamais rien : le message brut reste au
journal et sera réexploitable. Un embedding raté n'empêche pas l'écriture du
souvenir — une passe de rattrapage le vectorisera plus tard.

---

## 8. Ajouter un module

C'est le point d'extension central. Ajouter « calendrier », « santé » ou
« finances » ne doit demander **aucune** modification du noyau.

```ts
export const calendarModule: ValmontModule<CalendarApi> = {
  name: 'calendar',
  description: 'Rendez-vous et disponibilités.',
  dependsOn: ['memory'],

  async setup(context) {
    // 1. Des tâches planifiées
    context.schedule({
      name: 'sync-calendar',
      every: 15 * MINUTE,
      run: async () => { /* … */ },
    });

    // 2. Des outils pour les agents
    tools.register({
      name: 'agenda',
      label: 'Consulte ton agenda',
      description: 'Ce qui est prévu. Appelle-le pour « je fais quoi demain ? ».',
      inputSchema: { /* … */ },
      run: async (input, ctx) => { /* … */ },
    });

    // 3. Des réactions aux événements
    context.bus.on('message.received', async () => { /* … */ });

    return api;
  },
};
```

Le `ModuleRegistry` résout l'ordre de démarrage par tri topologique, refuse les
cycles explicitement, et arrête les modules en ordre inverse.

Les métriques sont génériques : ajouter « sommeil » ou « nutrition » au tableau
de bord est une **écriture**, jamais une migration.

---

## 9. Ce qui n'est pas encore fait

Assumé, et volontairement laissé ouvert :

- **Indexation des fichiers et dépôts.** Les tables `documents` et `chunks`
  existent dans le schéma ; le module qui scanne `VALMONT_PROJECT_ROOTS` reste à
  écrire. C'est le premier module à ajouter — il débloque « quels bugs restent à
  corriger ? » et « montre-moi mes notes sur X ».
- **Coquille de bureau.** L'interface tourne dans un navigateur. Un enrobage
  Tauri (préféré à Electron pour la taille et la mémoire) reste à faire, avec
  raccourci global et fenêtre sans cadre.
- **Synthèse vocale de qualité.** L'API Web Speech dépanne ; ElevenLabs est
  câblé dans la configuration mais pas branché. C'est ce qui changera le plus la
  perception du produit.
- **Chiffrement au repos.** Le fichier SQLite est en clair. SQLCipher ou un
  chiffrement au niveau du système de fichiers, avant toute synchronisation.
- **Synchronisation multi-appareils.** À faire en réplique chiffrée de bout en
  bout, jamais en base partagée — le modèle local-first ne doit pas être perdu.
- **Émotion dans la voix.** La prosodie n'est pas analysée ; seul le contenu
  textuel alimente la lecture affective.

---

## 10. Règles de contribution

1. **Ne jamais éditer une migration publiée.** On en ajoute une.
2. **Toute logique temporelle passe par `Clock`.** C'est la seule façon de
   tester « et dans trois semaines ? » sans attendre trois semaines.
3. **Aucun module ne lit `process.env`.** Il reçoit sa configuration.
4. **Une frontière externe ne lève jamais.** `Result`, `attempt`, `retry`.
5. **Un constat proactif est calculé, jamais généré.** Le modèle formule, il ne
   constate pas.
6. **Un nouveau seuil se justifie en commentaire.** Les nombres de ce système
   (0,94 pour la déduplication, 0,62 pour l'attachement à un thème, 1,3 en
   z-score pour une tendance) ont tous une raison. Sans elle, le prochain
   lecteur les changera au hasard.

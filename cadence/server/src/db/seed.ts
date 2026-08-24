import bcrypt from 'bcryptjs';
import { SYSTEM_SCENARIOS } from '../../../shared/scenarios.js';
import { SCRIPT_CATEGORIES } from '../../../shared/scripts.js';
import { env } from '../env.js';
import { DEFAULT_TEMPLATE_BODY } from '../generation/prompt.js';
import { creators, metaGet, metaSet, scenarios, templates, users } from './repos.js';
import { scriptCategories, scripts } from './scripts.js';

/** Templates livrés avec l'outil, prêts à être dupliqués par l'équipe. */
const STARTER_TEMPLATES = [
  {
    name: 'Standard — console',
    category: 'Système',
    description:
      "Template par défaut de la console. Sert de base à toutes les générations sans template explicite.",
    tags: ['défaut', 'console'],
    scenarioKey: null,
    body: DEFAULT_TEMPLATE_BODY,
  },
  {
    name: 'Première interaction — accueil',
    category: 'Acquisition',
    description: "Premier message après l'abonnement.",
    tags: ['premier contact', 'accueil'],
    scenarioKey: 'first_contact',
    body: `Rédige {{variant_count}} messages d'accueil pour {{creator_name}}, dans son ton : {{tone}}.

L'abonné {{subscriber_alias}} vient de s'abonner. Ce qu'on sait de lui : {{conversation_context}}
Son premier message, s'il y en a un : "{{subscriber_message}}"

Objectif : {{objective}}

Chaque message doit tenir en deux phrases maximum, se terminer par une question ouverte
différente, et ne faire référence à aucun élément qui n'est pas écrit ci-dessus.`,
  },
  {
    name: 'Relance — sans réponse depuis 48 h',
    category: 'Relance',
    description: "Relance douce après un message resté sans réponse.",
    tags: ['relance', 'silence'],
    scenarioKey: 'follow_up',
    body: `{{creator_name}} a écrit à {{subscriber_alias}} il y a deux jours, sans réponse.

Historique récent :
{{conversation_history}}

Contexte : {{conversation_context}}
Objectif : {{objective}}

Propose {{variant_count}} relances qui apportent chacune un élément nouveau plutôt que de répéter
la question restée sans réponse. Aucune ne doit reprocher le silence ni créer d'urgence.`,
  },
  {
    name: 'Après achat — remerciement',
    category: 'Après-vente',
    description: 'Message de suivi après un achat, sans relance commerciale.',
    tags: ['après achat', 'satisfaction'],
    scenarioKey: 'post_purchase',
    body: `{{subscriber_alias}} vient d'acheter. Détail de l'achat (ne rien inventer au-delà) :
{{conversation_context}}

Historique récent :
{{conversation_history}}

Rédige {{variant_count}} messages de suivi pour {{creator_name}} ({{tone}}) : remerciement
spécifique, vérification que tout est bien arrivé, et une ouverture pour continuer la
conversation. Aucune nouvelle offre dans ce message.`,
  },
  {
    name: 'Réactivation — abonné silencieux',
    category: 'Relance',
    description: 'Rouvrir une conversation inactive depuis plusieurs semaines.',
    tags: ['réactivation', 'inactif'],
    scenarioKey: 'reactivation',
    body: `{{subscriber_alias}} n'a plus échangé avec {{creator_name}} depuis longtemps.

Dernier historique connu :
{{conversation_history}}

Ce qui a changé depuis (source unique d'information) : {{conversation_context}}
Objectif : {{objective}}

Propose {{variant_count}} messages de reprise de contact : assumés, sans reproche, avec une
question à faible coût de réponse. Longueur maximale : {{max_message_chars}} caractères.`,
  },
  {
    name: 'Question directe — réponse factuelle',
    category: 'Support',
    description: "Répondre à une question précise sans inventer d'information.",
    tags: ['question', 'factuel'],
    scenarioKey: 'question',
    body: `Question posée par {{subscriber_alias}} : "{{subscriber_message}}"

Informations disponibles et vérifiées : {{conversation_context}}

Rédige {{variant_count}} réponses pour {{creator_name}} ({{tone}}).
Si l'information nécessaire ne figure pas ci-dessus, la réponse doit le dire honnêtement
(« je vérifie et je te dis ») plutôt que d'inventer. Termine par une relance courte.`,
  },
];

const DEMO_CREATOR = {
  name: 'Lina (exemple)',
  handle: '@lina.example',
  accent_color: '#e0669b',
  personality:
    "Douce et taquine, curieuse des gens, pose beaucoup de questions. Rit d'elle-même, jamais dans la séduction agressive.",
  traits: ['taquine', 'bienveillante', 'curieuse', 'spontanée'],
  tone: 'Chaleureux, complice, familier sans être vulgaire',
  interests: ['yoga', 'cinéma coréen', 'cuisine italienne', 'randonnée'],
  writing_style:
    'Phrases courtes, minuscules la plupart du temps, peu de ponctuation, jamais de pavé.',
  audience_type: 'Hommes 30-45 ans, francophones, plutôt réguliers',
  preferred_topics: ['leur journée', 'sport', 'cuisine', 'projets de voyage'],
  objectives: ['créer du lien', 'faire parler l’abonné', 'proposer le contenu au bon moment'],
  lexicon: {
    language: 'fr',
    preferred_words: ['coucou', 'dis-moi', 'franchement'],
    banned_words: ['bébé', 'chéri', 'mon cœur'],
    signature_phrases: ['raconte-moi tout', 'j’avoue'],
    favorite_emojis: ['🙂', '✨'],
    emoji_style: 'rare' as const,
    punctuation: 'sobre' as const,
    capitalization: 'minuscules' as const,
    typical_message_length: 'court' as const,
  },
  guardrails: {
    banned_topics: ['politique', 'religion', 'santé mentale'],
    hard_rules: [
      'Ne jamais donner de ville ni de lieu précis',
      'Ne jamais fixer de rendez-vous, même virtuel',
    ],
    no_promises: true,
    no_personal_facts: true,
    max_message_chars: 320,
  },
  notes: 'Fiche de démonstration : dupliquer puis adapter pour un vrai créateur.',
  archived: false,
};

export async function seed(): Promise<void> {
  // 1. Compte administrateur
  if (users.count() === 0) {
    users.create({
      email: env.admin.email,
      name: env.admin.name,
      passwordHash: await bcrypt.hash(env.admin.password, 10),
      role: 'admin',
    });
    console.log(
      `[cadence] compte administrateur créé : ${env.admin.email} — pense à changer le mot de passe.`,
    );
  }

  // 2. Scénarios système (ajoutés s'ils manquent, jamais écrasés)
  for (const scenario of SYSTEM_SCENARIOS) {
    if (!scenarios.findByKey(scenario.key)) {
      scenarios.create({ ...scenario }, true);
    }
  }

  // 3. Templates de départ (une seule fois)
  if (!metaGet('seed:templates:v1')) {
    for (const template of STARTER_TEMPLATES) {
      const scenario = template.scenarioKey ? scenarios.findByKey(template.scenarioKey) : null;
      templates.create(
        {
          name: template.name,
          description: template.description,
          category: template.category,
          tags: template.tags,
          body: template.body,
          variables: [],
          scenario_id: scenario?.id ?? null,
          creator_id: null,
          is_favorite: false,
        },
        null,
      );
    }
    metaSet('seed:templates:v1', new Date().toISOString());
  }

  // 4. Catégories de scripts (ajoutées si manquantes, jamais écrasées)
  for (const category of SCRIPT_CATEGORIES) {
    scriptCategories.ensure({ ...category, isSystem: true });
  }

  // 5. Scripts globaux de départ (une seule fois)
  if (!metaGet('seed:scripts:v1')) {
    for (const script of STARTER_SCRIPTS) {
      scripts.create({ ...script, model_id: null, variables: [] }, null);
    }
    metaSet('seed:scripts:v1', new Date().toISOString());
  }

  // 6. Créateur de démonstration (une seule fois, supprimable)
  if (!metaGet('seed:demo-creator:v1')) {
    creators.create(DEMO_CREATOR as never, null);
    metaSet('seed:demo-creator:v1', new Date().toISOString());
  }
}

/**
 * Scripts globaux livrés avec l'outil : des squelettes utilisables tels quels,
 * volontairement neutres, à dupliquer et adapter par modèle.
 */
const STARTER_SCRIPTS = [
  {
    category_key: 'first_message',
    name: 'Premier message — accueil simple',
    description: "Premier contact après l'abonnement, une question ouverte.",
    objective: "Obtenir une première réponse et apprendre quelque chose sur l'abonné",
    tone: 'Chaleureux, simple',
    trigger: "Dans l'heure suivant un nouvel abonnement",
    tags: ['accueil', 'nouveau'],
    content:
      "hey {{subscriber_name}} ! merci d'être là 🙂\nDis-moi, c'est quoi qui t'a donné envie de t'abonner ?",
  },
  {
    category_key: 'getting_to_know',
    name: 'Découverte — routine du soir',
    description: "Faire parler l'abonné de son quotidien.",
    objective: 'Récolter une information réutilisable dans les prochains échanges',
    tone: 'Curieux, détendu',
    trigger: 'Après deux ou trois échanges',
    tags: ['découverte'],
    content:
      "tu fais quoi de tes soirées en général {{subscriber_name}} ?\nmoi c'est {{creator_name}}, et je suis clairement du genre à finir la journée tranquille",
  },
  {
    category_key: 'ppv',
    name: 'PPV — annonce sobre',
    description: 'Proposer un contenu payant sans insister.',
    objective: 'Présenter le contenu et laisser la décision libre',
    tone: 'Direct, sans pression',
    trigger: 'Conversation déjà engagée, abonné réceptif',
    tags: ['ppv', 'vente'],
    content:
      "je viens de préparer {{content_type}} et j'ai pensé à toi en le faisant\nc'est à {{price}} si ça te tente — sinon aucun souci, on continue à discuter 🙂",
  },
  {
    category_key: 'ppv_follow_up',
    name: 'PPV Follow-up — sans achat',
    description: "Relancer après un PPV non ouvert, sans culpabiliser.",
    objective: 'Rouvrir la conversation, pas forcer la vente',
    tone: 'Léger',
    trigger: '24 à 48 h après un PPV non acheté',
    tags: ['relance', 'ppv'],
    content:
      "pas de souci si {{content_type}} c'était pas le bon moment {{subscriber_name}}\ndis-moi plutôt, ta journée elle a donné quoi ?",
  },
  {
    category_key: 'objection_handling',
    name: 'Objection — « c\'est trop cher »',
    description: "Répondre à une objection de prix sans braderie ni insistance.",
    objective: "Accepter le refus et garder la relation",
    tone: 'Compréhensif',
    trigger: "L'abonné évoque le prix",
    tags: ['objection', 'prix'],
    content:
      "je comprends totalement {{subscriber_name}}, aucun souci\nde toute façon j'aime bien qu'on discute, le reste c'est vraiment quand tu en as envie",
  },
  {
    category_key: 're_engagement',
    name: 'Réactivation — silence long',
    description: "Reprendre contact avec un abonné inactif depuis plusieurs semaines.",
    objective: 'Obtenir une réponse simple',
    tone: 'Léger, assumé',
    trigger: 'Plus de 3 semaines sans échange',
    tags: ['réactivation', 'inactif'],
    content:
      "ça fait un moment {{subscriber_name}} 🙂\nje me demandais : toujours sur {{conversation_context}} ou tu es passé à autre chose ?",
  },
  {
    category_key: 'thank_you',
    name: 'Remerciement — après achat',
    description: 'Remercier de façon spécifique et vérifier la réception.',
    objective: "Confirmer la satisfaction, garder la conversation ouverte",
    tone: 'Sincère',
    trigger: 'Juste après un achat',
    tags: ['après achat'],
    content:
      "merci beaucoup {{subscriber_name}}, vraiment 🙂\ntu me diras ce que tu en as pensé ? ça m'aide à savoir ce que tu aimes",
  },
  {
    category_key: 'good_night',
    name: 'Good Night — court',
    description: 'Message de fin de journée, sans intention commerciale.',
    objective: 'Entretenir la régularité des échanges',
    tone: 'Doux',
    trigger: 'Fin de soirée',
    tags: ['routine'],
    content: 'bonne nuit {{subscriber_name}} 🌙 raconte-moi ta journée demain si tu y penses',
  },
];

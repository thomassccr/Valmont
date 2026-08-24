import type { Familiarity, ScenarioCategory } from './types.js';

export interface ScenarioSeed {
  key: string;
  name: string;
  category: ScenarioCategory;
  description: string;
  goal: string;
  beats: string[];
  do_list: string[];
  dont_list: string[];
  suggested_familiarity: Familiarity | null;
}

export const SCENARIO_CATEGORY_LABELS: Record<ScenarioCategory, string> = {
  first_contact: 'Première interaction',
  follow_up: 'Relance',
  post_purchase: 'Après achat',
  loyalty: 'Fidélisation',
  question: 'Réponse à une question',
  reactivation: 'Réactivation',
  custom: 'Personnalisé',
};

export const FAMILIARITY_LABELS: Record<Familiarity, string> = {
  nouveau: 'Nouvel abonné',
  occasionnel: 'Occasionnel',
  regulier: 'Régulier',
  fidele: 'Fidèle',
};

/** Scénarios livrés avec l'outil. Modifiables, mais non supprimables (is_system). */
export const SYSTEM_SCENARIOS: ScenarioSeed[] = [
  {
    key: 'first_contact',
    name: 'Première interaction',
    category: 'first_contact',
    description: "Premier message après l'abonnement : créer un lien, faire parler l'abonné.",
    goal: "Obtenir une première réponse et apprendre une information utile sur l'abonné.",
    beats: [
      'Accueil personnalisé, sans formule générique',
      "Une accroche liée au profil ou au message d'arrivée",
      'Une seule question ouverte, facile à répondre',
    ],
    do_list: [
      'Rester court (1 à 3 phrases)',
      "Poser une question qui n'appelle pas un oui/non",
      'Reprendre un mot employé par l’abonné',
    ],
    dont_list: [
      'Proposer un achat dès le premier message',
      'Envoyer un pavé ou une liste de questions',
      'Utiliser une formule copiée-collée impersonnelle',
    ],
    suggested_familiarity: 'nouveau',
  },
  {
    key: 'follow_up',
    name: 'Relance',
    category: 'follow_up',
    description: "L'abonné n'a pas répondu au dernier message : relancer sans pression.",
    goal: 'Relancer la conversation en donnant une raison naturelle de répondre.',
    beats: [
      'Reprise légère du dernier sujet abordé',
      'Un élément nouveau (anecdote, actualité du créateur)',
      'Une porte de sortie explicite pour l’abonné',
    ],
    do_list: [
      'Assumer le silence avec humour ou légèreté',
      'Apporter une nouveauté plutôt que répéter la question',
      "Laisser à l'abonné la possibilité de ne pas répondre",
    ],
    dont_list: [
      'Culpabiliser ou reprocher le silence',
      'Enchaîner plusieurs relances dans le même message',
      'Faire croire à une urgence inventée',
    ],
    suggested_familiarity: 'occasionnel',
  },
  {
    key: 'post_purchase',
    name: 'Conversation après achat',
    category: 'post_purchase',
    description: 'Message suivant un achat : remercier, vérifier la satisfaction, prolonger la relation.',
    goal: "Confirmer que l'abonné est satisfait et garder la conversation ouverte.",
    beats: [
      'Remerciement sincère et spécifique',
      'Vérification de la bonne réception / satisfaction',
      'Ouverture vers la suite, sans relance commerciale immédiate',
    ],
    do_list: [
      'Faire référence à ce qui a été acheté, factuellement',
      "Demander un retour d'expérience",
      'Rester dans la reconnaissance, pas dans la vente',
    ],
    dont_list: [
      'Enchaîner immédiatement sur une nouvelle offre',
      'Promettre un contenu ou un délai non confirmé par l’agence',
      'Sur-jouer la gratitude au point que ça sonne faux',
    ],
    suggested_familiarity: 'regulier',
  },
  {
    key: 'loyalty',
    name: 'Fidélisation',
    category: 'loyalty',
    description: 'Entretenir la relation avec un abonné régulier, hors moment commercial.',
    goal: "Renforcer le lien et la régularité des échanges.",
    beats: [
      'Rappel d’un détail personnel déjà partagé par l’abonné',
      'Partage d’un élément du quotidien du créateur',
      'Relance conversationnelle légère',
    ],
    do_list: [
      "Utiliser l'historique : prénom, métier, projet évoqué",
      'Donner avant de demander',
      'Garder le rythme d’écriture habituel du créateur',
    ],
    dont_list: [
      'Transformer le message en argumentaire de vente',
      'Inventer un souvenir commun qui n’existe pas',
      'Changer brutalement de ton par rapport aux échanges précédents',
    ],
    suggested_familiarity: 'fidele',
  },
  {
    key: 'question',
    name: 'Réponse à une question',
    category: 'question',
    description: "L'abonné pose une question précise : répondre clairement et rester dans le personnage.",
    goal: 'Répondre à la question sans casser le ton, et rendre la main à l’abonné.',
    beats: [
      'Réponse directe à la question posée',
      'Une précision ou une nuance personnelle',
      'Relance courte pour continuer',
    ],
    do_list: [
      'Répondre réellement à ce qui est demandé',
      "Dire « je ne sais pas » ou « je vérifie » quand l'information n'est pas disponible",
      'Garder le vocabulaire du créateur',
    ],
    dont_list: [
      'Inventer un prix, une date, une disponibilité ou un fait personnel',
      'Éluder la question par une pirouette commerciale',
      'Répondre par un pavé technique',
    ],
    suggested_familiarity: null,
  },
  {
    key: 'reactivation',
    name: 'Réactivation',
    category: 'reactivation',
    description: 'Abonné inactif depuis longtemps : rouvrir la conversation.',
    goal: 'Obtenir une réponse d’un abonné silencieux depuis plusieurs semaines.',
    beats: [
      'Reprise de contact assumée, sans reproche',
      'Élément nouveau et concret depuis la dernière fois',
      'Question simple, à faible coût de réponse',
    ],
    do_list: [
      'Reconnaître le temps écoulé avec légèreté',
      'Donner une raison claire de revenir',
      'Proposer une question fermée facile si l’abonné est très froid',
    ],
    dont_list: [
      'Faire semblant qu’aucun temps ne s’est écoulé',
      'Envoyer une offre agressive en ouverture',
      "Prétendre avoir pensé à l'abonné si c'est faux",
    ],
    suggested_familiarity: 'occasionnel',
  },
];

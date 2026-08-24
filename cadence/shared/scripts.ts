/**
 * Catalogue des catégories de scripts.
 * Sert de source aux données initiales (`script_categories`) : la table reste
 * la source de vérité en base, ce fichier n'est que la liste livrée par défaut.
 */
export interface ScriptCategorySeed {
  key: string;
  label: string;
  sort_order: number;
}

export const SCRIPT_CATEGORIES: ScriptCategorySeed[] = [
  { key: 'first_message', label: 'First Message', sort_order: 10 },
  { key: 'getting_to_know', label: 'Getting to Know', sort_order: 20 },
  { key: 'flirting', label: 'Flirting', sort_order: 30 },
  { key: 'ppv', label: 'PPV', sort_order: 40 },
  { key: 'ppv_follow_up', label: 'PPV Follow-up', sort_order: 50 },
  { key: 'upsell', label: 'Upsell', sort_order: 60 },
  { key: 'custom_content', label: 'Custom Content', sort_order: 70 },
  { key: 're_engagement', label: 'Re-engagement', sort_order: 80 },
  { key: 'retention', label: 'Retention', sort_order: 90 },
  { key: 'high_spender', label: 'High Spender', sort_order: 100 },
  { key: 'low_spender', label: 'Low Spender', sort_order: 110 },
  { key: 'objection_handling', label: 'Objection Handling', sort_order: 120 },
  { key: 'thank_you', label: 'Thank You', sort_order: 130 },
  { key: 'good_morning', label: 'Good Morning', sort_order: 140 },
  { key: 'good_night', label: 'Good Night', sort_order: 150 },
  { key: 'other', label: 'Other', sort_order: 160 },
];

/**
 * Score de performance d'un script, sur 100.
 * Pondération : conversion 60 %, volume d'utilisation 20 %, revenu 20 %.
 * Les deux derniers sont plafonnés pour qu'un script très utilisé mais peu
 * convertissant ne domine pas le classement.
 */
export function performanceScore(stats: {
  usage_count: number;
  conversion_rate: number;
  revenue_cents: number;
}): number {
  const conversion = Math.min(Math.max(stats.conversion_rate, 0), 1) * 60;
  const volume = Math.min(stats.usage_count / 25, 1) * 20;
  const revenue = Math.min(stats.revenue_cents / 50_000, 1) * 20;
  return Math.round(conversion + volume + revenue);
}

export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(cents / 100);

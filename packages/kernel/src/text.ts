/** Utilitaires texte : normalisation, slug, mots-clés, estimation de jetons. */

/** Supprime les accents et met en minuscules — base de toute comparaison. */
export function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function slug(input: string): string {
  return fold(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Mots vides français et anglais. Volontairement court : on veut retirer le
 * bruit grammatical, pas appauvrir le vocabulaire propre de l'utilisateur.
 */
const STOP_WORDS = new Set(
  `le la les un une des du de d au aux et ou mais donc or ni car que qui quoi dont ou a as ai est sont
   etre avoir fait faire je tu il elle on nous vous ils elles me te se ce cet cette ces mon ma mes ton
   ta tes son sa ses notre nos votre vos leur leurs pour par avec sans sous sur dans en y pas ne plus
   moins tres trop bien tout tous toute toutes meme aussi comme si quand alors deja encore the a an and
   or but of to in on for with at by from is are was were be been it this that i you he she we they`
    .split(/\s+/)
    .filter(Boolean),
);

export function keywords(input: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const raw of fold(input).split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

/** Indice de Jaccard entre deux ensembles de mots-clés. */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Estimation du nombre de jetons. Approximation volontaire : on ne veut pas
 * embarquer un tokenizer pour un budget de contexte qui a 10% de marge.
 * ~3,6 caractères par jeton en français, un peu moins qu'en anglais.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/** Tronque proprement sur une frontière de mot. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Extrait le premier objet JSON valide d'une réponse de modèle, que le modèle
 * l'ait entouré de texte, de balises markdown, ou pas. Indispensable : les
 * agents d'extraction produisent du JSON et doivent être increvables.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], raw].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      /* on tente l'extraction par équilibrage de délimiteurs */
    }

    const start = trimmed.search(/[[{]/);
    if (start === -1) continue;
    const opener = trimmed[start];
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') inString = !inString;
      if (inString) continue;
      if (char === opener) depth++;
      else if (char === closer) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1)) as T;
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

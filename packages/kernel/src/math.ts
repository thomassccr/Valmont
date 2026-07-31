/** Primitives numériques partagées : similarité, statistiques, normalisation. */

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Similarité cosinus. Les vecteurs sont normalisés à l'écriture, donc en
 * pratique c'est un produit scalaire — mais on garde la normalisation
 * défensive : un vecteur non normalisé venu d'un futur fournisseur ne doit
 * pas corrompre silencieusement le classement de la mémoire.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function normalize(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += (vector[i] ?? 0) ** 2;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = (vector[i] ?? 0) / norm;
  return out;
}

export function centroid(vectors: Float32Array[]): Float32Array | null {
  const first = vectors[0];
  if (!first) return null;
  const out = new Float32Array(first.length);
  for (const vector of vectors) {
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (vector[i] ?? 0);
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / vectors.length;
  return normalize(out);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/** Corrélation de Pearson. Renvoie 0 si l'un des échantillons est constant. */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] ?? 0) - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/**
 * Décroissance exponentielle utilisée par la mémoire.
 * `halfLifeMs` : durée au bout de laquelle le score de récence vaut 0,5.
 */
export function decay(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1;
  return Math.exp((-Math.LN2 * ageMs) / halfLifeMs);
}

/**
 * Maximal Marginal Relevance : rééquilibre pertinence et diversité.
 * Sans ça, une recherche mémoire renvoie cinq formulations du même souvenir
 * et gaspille tout le budget de contexte.
 */
export function mmr<T>(
  candidates: Array<{ item: T; score: number; vector: Float32Array | null }>,
  limit: number,
  lambda: number,
): T[] {
  const selected: Array<{ item: T; vector: Float32Array | null }> = [];
  const pool = [...candidates].sort((a, b) => b.score - a.score);

  while (selected.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      if (!candidate) continue;
      let maxSimilarity = 0;
      if (candidate.vector) {
        for (const chosen of selected) {
          if (!chosen.vector) continue;
          maxSimilarity = Math.max(maxSimilarity, cosineSimilarity(candidate.vector, chosen.vector));
        }
      }
      const value = (1 - lambda) * candidate.score - lambda * maxSimilarity;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    const [chosen] = pool.splice(bestIndex, 1);
    if (chosen) selected.push({ item: chosen.item, vector: chosen.vector });
  }

  return selected.map((entry) => entry.item);
}

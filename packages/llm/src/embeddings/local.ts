import { fold, normalize } from '@valmont/kernel';
import type { EmbeddingProvider } from '../types.js';

/**
 * Embeddings de repli, sans réseau ni modèle.
 *
 * Principe : projection aléatoire creuse de n-grammes de caractères et de mots
 * (« hashing trick »). Deux textes proches partagent beaucoup de n-grammes et
 * atterrissent donc près l'un de l'autre.
 *
 * À quoi ça sert honnêtement : Valmont démarre et fonctionne dès la première
 * minute, sans clé API ni Ollama. La qualité sémantique est très inférieure à
 * un vrai modèle — il retrouve les reformulations, pas les synonymes. Le
 * système signale ce mode comme `degraded` et le tableau de bord l'affiche.
 *
 * Déterministe : le même texte donne toujours le même vecteur, y compris entre
 * deux exécutions. Indispensable, sinon la base se corromprait au redémarrage.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly model = 'local';
  readonly dimensions: number;

  constructor(options: { dimensions?: number } = {}) {
    this.dimensions = options.dimensions ?? 384;
  }

  health(): { ok: boolean; detail?: string } {
    return {
      ok: true,
      detail: 'repli local — recherche sémantique dégradée, configurer OpenAI ou Ollama',
    };
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    const folded = fold(text);

    // Mots entiers : porte le sens principal, poids fort.
    for (const word of folded.split(/[^a-z0-9]+/)) {
      if (word.length < 2) continue;
      this.add(vector, `w:${word}`, 1);
      // Préfixe : rapproche « motivation » et « motivé ».
      if (word.length > 4) this.add(vector, `p:${word.slice(0, 4)}`, 0.4);
    }

    // Trigrammes de caractères : tolère les fautes de frappe et les flexions.
    const compact = folded.replace(/[^a-z0-9]+/g, ' ');
    for (let i = 0; i < compact.length - 2; i++) {
      this.add(vector, `c:${compact.slice(i, i + 3)}`, 0.25);
    }

    return normalize(vector);
  }

  /** Répartit le poids d'un jeton sur quelques dimensions pseudo-aléatoires. */
  private add(vector: Float32Array, token: string, weight: number): void {
    let hash = hash32(token);
    for (let k = 0; k < 3; k++) {
      hash = hash32(`${token}#${k}`);
      const index = hash % this.dimensions;
      const sign = (hash >>> 31) & 1 ? -1 : 1;
      vector[index] = (vector[index] ?? 0) + sign * weight;
    }
  }
}

/** FNV-1a 32 bits — rapide, bien distribué, stable dans le temps. */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

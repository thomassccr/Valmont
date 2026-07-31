import { cosineSimilarity } from '@valmont/kernel';
import { decodeVector, encodeVector, type Db } from './db.js';

export type VectorOwner = 'memory' | 'entity' | 'theme' | 'chunk';

/**
 * Index vectoriel.
 *
 * Choix assumé : **balayage exhaustif en mémoire**, pas de HNSW ni de base
 * vectorielle dédiée. Pourquoi c'est le bon choix ici, et pour longtemps :
 *
 *  - Volume réel : une personne très bavarde produit ~50 souvenirs par jour,
 *    soit ~18 000 par an. À 768 dimensions, 100 000 vecteurs occupent 300 Mo
 *    et se balaient en ~15 ms. On a une décennie de marge.
 *  - Un index approximatif introduit des faux négatifs. Pour une mémoire
 *    personnelle, « il a oublié » est le pire défaut possible.
 *  - Zéro service à installer, à sauvegarder, à mettre à jour.
 *
 * L'interface `VectorIndex` reste néanmoins l'unique point de contact : le
 * jour où le volume l'exige, on remplace l'implémentation par Qdrant ou
 * sqlite-vec sans toucher au reste de la mémoire.
 */
export interface VectorIndex {
  put(owner: VectorOwner, id: string, vector: Float32Array, model: string): void;
  get(owner: VectorOwner, id: string): Float32Array | null;
  remove(owner: VectorOwner, id: string): void;
  /** Voisins les plus proches, éventuellement restreints à un sous-ensemble. */
  search(
    owner: VectorOwner,
    query: Float32Array,
    limit: number,
    candidates?: Set<string>,
  ): Array<{ id: string; score: number }>;
  size(owner: VectorOwner): number;
  /** Modèle utilisé — un changement de modèle invalide tout l'index. */
  model(): string | null;
}

export class InMemoryVectorIndex implements VectorIndex {
  private readonly stores = new Map<VectorOwner, Map<string, Float32Array>>();
  private currentModel: string | null = null;

  constructor(private readonly db: Db) {
    this.load();
  }

  private storeFor(owner: VectorOwner): Map<string, Float32Array> {
    let store = this.stores.get(owner);
    if (!store) {
      store = new Map();
      this.stores.set(owner, store);
    }
    return store;
  }

  private load(): void {
    const rows = this.db
      .prepare<[], { owner_kind: string; owner_id: string; model: string; vector: Buffer }>(
        'SELECT owner_kind, owner_id, model, vector FROM embeddings',
      )
      .all();

    for (const row of rows) {
      this.storeFor(row.owner_kind as VectorOwner).set(row.owner_id, decodeVector(row.vector));
      this.currentModel ??= row.model;
    }
  }

  model(): string | null {
    return this.currentModel;
  }

  put(owner: VectorOwner, id: string, vector: Float32Array, model: string): void {
    this.db
      .prepare(
        `INSERT INTO embeddings (owner_kind, owner_id, model, dim, vector)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_kind, owner_id) DO UPDATE SET
           model = excluded.model, dim = excluded.dim, vector = excluded.vector`,
      )
      .run(owner, id, model, vector.length, encodeVector(vector));

    this.storeFor(owner).set(id, vector);
    this.currentModel ??= model;
  }

  get(owner: VectorOwner, id: string): Float32Array | null {
    return this.storeFor(owner).get(id) ?? null;
  }

  remove(owner: VectorOwner, id: string): void {
    this.db
      .prepare('DELETE FROM embeddings WHERE owner_kind = ? AND owner_id = ?')
      .run(owner, id);
    this.storeFor(owner).delete(id);
  }

  size(owner: VectorOwner): number {
    return this.storeFor(owner).size;
  }

  search(
    owner: VectorOwner,
    query: Float32Array,
    limit: number,
    candidates?: Set<string>,
  ): Array<{ id: string; score: number }> {
    const store = this.storeFor(owner);
    // Tas borné : on ne trie pas 100 000 entrées pour en garder 20.
    const best: Array<{ id: string; score: number }> = [];
    let worst = -Infinity;

    for (const [id, vector] of store) {
      if (candidates && !candidates.has(id)) continue;
      const score = cosineSimilarity(query, vector);
      if (best.length < limit) {
        best.push({ id, score });
        if (best.length === limit) {
          best.sort((a, b) => a.score - b.score);
          worst = best[0]?.score ?? -Infinity;
        }
      } else if (score > worst) {
        best[0] = { id, score };
        best.sort((a, b) => a.score - b.score);
        worst = best[0]?.score ?? -Infinity;
      }
    }

    return best.sort((a, b) => b.score - a.score);
  }

  /**
   * Invalide tout l'index. Appelé quand le modèle d'embedding change : des
   * vecteurs de modèles différents ne sont pas comparables, et les mélanger
   * produirait des rappels silencieusement faux.
   */
  reset(newModel: string): void {
    this.db.prepare('DELETE FROM embeddings').run();
    this.stores.clear();
    this.currentModel = newModel;
  }
}

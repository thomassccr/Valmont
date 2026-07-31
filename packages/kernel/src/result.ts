/**
 * Type résultat explicite pour les frontières qui ne doivent jamais lever
 * (extraction LLM, appels d'outils, indexation de fichiers). Une extraction
 * ratée ne doit jamais faire tomber une conversation.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T, Error>> {
  try {
    return Ok(await fn());
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Réessaie avec repli exponentiel. Utilisé pour les appels réseau des
 * fournisseurs : une coupure de 3 secondes ne doit pas perdre un souvenir.
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { attempts?: number; baseMs?: number; maxMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseMs = options.baseMs ?? 400;
  const maxMs = options.maxMs ?? 8000;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (options.signal?.aborted) throw new Error('aborted');
    try {
      return await fn(i);
    } catch (error) {
      lastError = error;
      if (i === attempts - 1) break;
      const delay = Math.min(maxMs, baseMs * 2 ** i) * (0.75 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

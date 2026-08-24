import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'Non authentifié') => new HttpError(401, m);
export const forbidden = (m = 'Accès refusé') => new HttpError(403, m);
export const notFound = (m = 'Introuvable') => new HttpError(404, m);

/** Enveloppe les handlers async pour router les rejets vers le middleware d'erreur. */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  console.error('[cadence] erreur non gérée:', err);
  const message = err instanceof Error ? err.message : 'Erreur interne';
  res.status(500).json({ error: message });
}

import { randomBytes, randomUUID } from 'node:crypto';

/** Identifiant court, lisible dans les URLs et les logs. */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function token(): string {
  return randomBytes(32).toString('base64url');
}

export function now(): string {
  return new Date().toISOString();
}

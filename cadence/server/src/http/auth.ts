import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { User } from '../../../shared/types.js';
import { sessions, users } from '../db/repos.js';
import { isProd } from '../env.js';
import { asyncRoute, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { token } from '../lib/id.js';
import { loginSchema, userSchema } from './schemas.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export const SESSION_COOKIE = 'cadence_session';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,
  maxAge: 30 * 86_400_000,
  path: '/',
};

/** Résout la session si le cookie est présent — n'échoue jamais. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) {
    const user = sessions.resolve(raw);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Réservé aux administrateurs'));
  next();
}

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncRoute(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Identifiants invalides', parsed.error.flatten());

    const account = users.findByEmail(parsed.data.email);
    const ok = account && (await bcrypt.compare(parsed.data.password, account.password_hash));
    if (!account || !ok) throw unauthorized('Email ou mot de passe incorrect');

    const sessionToken = token();
    sessions.create(account.id, sessionToken);
    res.cookie(SESSION_COOKIE, sessionToken, cookieOptions);
    res.json({ id: account.id, email: account.email, name: account.name, role: account.role });
  }),
);

authRouter.post('/logout', (req, res) => {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) sessions.destroy(raw);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }
  res.json(req.user);
});

authRouter.get('/users', requireAdmin, (_req, res) => {
  res.json(users.list());
});

authRouter.post(
  '/users',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const parsed = userSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Champs invalides', parsed.error.flatten());
    if (users.findByEmail(parsed.data.email)) throw badRequest('Cet email existe déjà');

    const created = users.create({
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
      role: parsed.data.role,
    });
    res.status(201).json(created);
  }),
);

import 'dotenv/config';
import path from 'node:path';

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function int(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  port: int('PORT', 4000),
  webOrigin: str('WEB_ORIGIN', 'http://localhost:5173'),
  sessionSecret: str('SESSION_SECRET', 'cadence-dev-secret'),
  databasePath: path.resolve(str('DATABASE_PATH', './data/cadence.db')),
  admin: {
    email: str('ADMIN_EMAIL', 'admin@cadence.local'),
    password: str('ADMIN_PASSWORD', 'cadence'),
    name: str('ADMIN_NAME', 'Admin'),
  },
  llm: {
    provider: str('LLM_PROVIDER', 'anthropic'),
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: str('LLM_MODEL', 'claude-opus-5'),
    effort: str('LLM_EFFORT', 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    maxTokens: int('LLM_MAX_TOKENS', 8000),
  },
};

export const isProd = env.nodeEnv === 'production';

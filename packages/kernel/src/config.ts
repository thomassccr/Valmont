import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Configuration résolue une seule fois au démarrage. Aucun module ne lit
 * `process.env` directement : ils reçoivent leur configuration. Cela rend
 * le système testable et permettra plus tard une configuration par interface.
 */
export interface ValmontConfig {
  home: string;
  paths: {
    db: string;
    logs: string;
    cache: string;
    documents: string;
  };
  llm: {
    provider: 'anthropic' | 'mock';
    apiKey?: string;
    model: string;
    fastModel: string;
  };
  embedding: {
    provider: 'openai' | 'ollama' | 'local';
    apiKey?: string;
    model: string;
    baseUrl?: string;
    dimensions: number;
  };
  server: {
    host: string;
    port: number;
    token: string;
  };
  projects: {
    roots: string[];
  };
  voice: {
    ttsProvider: 'web' | 'elevenlabs';
    elevenLabsKey?: string;
    elevenLabsVoiceId?: string;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function env(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Charge un `.env` sans dépendance externe (format simple `CLE=valeur`). */
export function loadDotEnv(dir: string = process.cwd()): void {
  const file = join(dir, '.env');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Dimensions natives des modèles d'embedding connus. */
const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  local: 384,
};

export function loadConfig(overrides: Partial<ValmontConfig> = {}): ValmontConfig {
  const home = resolve(env('VALMONT_HOME') ?? join(homedir(), '.valmont'));

  const embeddingProvider = (env('VALMONT_EMBEDDING_PROVIDER') ??
    'local') as ValmontConfig['embedding']['provider'];
  const defaultEmbeddingModel =
    embeddingProvider === 'openai'
      ? 'text-embedding-3-small'
      : embeddingProvider === 'ollama'
        ? 'nomic-embed-text'
        : 'local';
  const embeddingModel = env('VALMONT_EMBEDDING_MODEL') ?? defaultEmbeddingModel;

  const config: ValmontConfig = {
    home,
    paths: {
      db: join(home, 'valmont.db'),
      logs: join(home, 'logs'),
      cache: join(home, 'cache'),
      documents: join(home, 'documents'),
    },
    llm: {
      provider: (env('VALMONT_LLM_PROVIDER') ?? 'anthropic') as 'anthropic' | 'mock',
      apiKey: env('ANTHROPIC_API_KEY'),
      model: env('VALMONT_LLM_MODEL') ?? 'claude-opus-5',
      fastModel: env('VALMONT_LLM_FAST_MODEL') ?? 'claude-sonnet-5',
    },
    embedding: {
      provider: embeddingProvider,
      apiKey: env('OPENAI_API_KEY'),
      model: embeddingModel,
      baseUrl: env('OLLAMA_BASE_URL') ?? 'http://127.0.0.1:11434',
      dimensions: EMBEDDING_DIMENSIONS[embeddingModel] ?? 768,
    },
    server: {
      host: env('VALMONT_CORE_HOST') ?? '127.0.0.1',
      port: Number(env('VALMONT_CORE_PORT') ?? 4319),
      token: env('VALMONT_TOKEN') ?? '',
    },
    projects: {
      roots: (env('VALMONT_PROJECT_ROOTS') ?? '')
        .split(':')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => resolve(p.replace(/^~/, homedir()))),
    },
    voice: {
      ttsProvider: (env('VALMONT_TTS_PROVIDER') ?? 'web') as 'web' | 'elevenlabs',
      elevenLabsKey: env('ELEVENLABS_API_KEY'),
      elevenLabsVoiceId: env('ELEVENLABS_VOICE_ID'),
    },
    logLevel: (env('VALMONT_LOG_LEVEL') ?? 'info') as ValmontConfig['logLevel'],
    ...overrides,
  };

  for (const dir of [config.home, config.paths.logs, config.paths.cache, config.paths.documents]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  return config;
}

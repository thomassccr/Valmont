import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './db/index.js';
import { seed } from './db/seed.js';
import { env, isProd } from './env.js';
import { getProvider } from './generation/llm.js';
import { attachUser, authRouter } from './http/auth.js';
import { apiRouter } from './http/api.js';
import { errorHandler } from './lib/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  migrate();
  await seed();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // En dev le front tourne sur Vite (port 5173) : on autorise cette origine avec cookies.
  if (!isProd) {
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', env.webOrigin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    const provider = getProvider();
    res.json({ ok: true, provider: provider.name, model: provider.model });
  });

  app.use(attachUser);
  app.use('/api/auth', authRouter);
  app.use('/api', apiRouter);

  // En production, l'API sert aussi le front compilé.
  const webDist = [
    path.resolve(here, '../../../../web/dist'), // build : dist/server/src → cadence/web/dist
    path.resolve(here, '../../web/dist'),       // dev   : server/src      → cadence/web/dist
  ].find((candidate) => fs.existsSync(candidate));
  if (webDist) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  app.listen(env.port, () => {
    console.log(`[cadence] API prête sur http://localhost:${env.port}`);
    console.log(`[cadence] base de données : ${env.databasePath}`);
    const provider = getProvider();
    console.log(`[cadence] génération : ${provider.name} (${provider.model})`);
  });
}

main().catch((error) => {
  console.error('[cadence] démarrage impossible:', error);
  process.exit(1);
});

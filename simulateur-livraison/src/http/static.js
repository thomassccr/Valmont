/**
 * http/static.js — Service des fichiers de `public/` (interface web).
 *
 * Volontairement minimal : pas de build, pas de bundler. Les pages HTML, le
 * CSS et le JavaScript sont servis tels quels.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Tente de servir un fichier statique.
 * @returns {boolean} vrai si la requête a été traitée
 */
export function servirFichier(chemin, res) {
  // `/` -> index.html, `/dashboard` -> dashboard.html
  let relatif = chemin === '/' ? 'index.html' : chemin.replace(/^\/+/, '');
  if (!path.extname(relatif)) relatif += '.html';

  const complet = path.join(CONFIG.chemins.public, relatif);

  // Garde-fou anti « path traversal » (../../etc/passwd) : on refuse tout
  // chemin qui sortirait du dossier public.
  if (!complet.startsWith(CONFIG.chemins.public + path.sep)) return false;
  if (!fs.existsSync(complet) || !fs.statSync(complet).isFile()) return false;

  const contenu = fs.readFileSync(complet);
  res.writeHead(200, {
    'Content-Type': TYPES_MIME[path.extname(complet)] ?? 'application/octet-stream',
    'Content-Length': contenu.length,
    'Cache-Control': 'no-store',
  });
  res.end(contenu);
  return true;
}

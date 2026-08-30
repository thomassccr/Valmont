/**
 * server.js — Point d'entrée du simulateur.
 *
 * Enchaînement au démarrage :
 *   1. ouverture de la base locale (créée si absente) ;
 *   2. génération du stock de faux comptes s'il est vide ;
 *   3. démarrage du moteur de progression ;
 *   4. ouverture du serveur HTTP sur 127.0.0.1 uniquement.
 *
 * ⚠️ Simulation intégrale : aucune requête n'est faite vers un service externe,
 * aucun compte réel n'est créé ni contacté. Toutes les données sont générées
 * localement et stockées dans data/simulateur.db.
 */

import http from 'node:http';
import { CONFIG } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { remplirLePool, tailleDuPool } from './db/seed.js';
import { demarrerMoteur, arreterMoteur } from './domain/engine.js';
import { construireRouteur } from './api/routes.js';
import { servirFichier } from './http/static.js';
import { erreur } from './http/respond.js';
import { ErreurMetier } from './domain/orders.js';

const routeur = construireRouteur();

/** Aiguillage principal : API d'abord, fichiers statiques ensuite. */
async function gererRequete(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  try {
    const route = routeur.resoudre(req.method, url.pathname);
    if (route) {
      await route.gestionnaire(req, res, route.params, url);
      return;
    }

    if (req.method === 'GET' && servirFichier(url.pathname, res)) return;

    if (url.pathname.startsWith('/api/')) {
      erreur(res, 404, `Route inconnue : ${req.method} ${url.pathname}`, 'unknown_route');
      return;
    }
    erreur(res, 404, 'Page introuvable.', 'not_found');
  } catch (e) {
    // Erreur métier attendue -> 4xx explicite ; sinon 500 + trace serveur.
    if (e instanceof ErreurMetier) {
      erreur(res, e.statut, e.message, e.code);
      return;
    }
    console.error('[serveur]', e);
    erreur(res, 500, 'Erreur interne du simulateur.', 'internal_error');
  }
}

function demarrer() {
  getDb();

  const stock = tailleDuPool();
  if (stock < CONFIG.pool.taille) {
    process.stdout.write('Génération du stock de faux comptes… ');
    const ajoutes = remplirLePool(CONFIG.pool.taille);
    console.log(`${ajoutes} ajoutés (total : ${tailleDuPool()}).`);
  }

  demarrerMoteur();

  const serveur = http.createServer(gererRequete);
  serveur.listen(CONFIG.serveur.port, CONFIG.serveur.host, () => {
    const base = `http://${CONFIG.serveur.host}:${CONFIG.serveur.port}`;
    console.log('');
    console.log('  ┌────────────────────────────────────────────────────────┐');
    console.log('  │  SIMULATEUR DE LIVRAISON — 100 % local, 100 % fictif   │');
    console.log('  └────────────────────────────────────────────────────────┘');
    console.log(`  Interface   : ${base}/`);
    console.log(`  Dashboard   : ${base}/dashboard`);
    console.log(`  API         : ${base}/api/config`);
    console.log(`  Stock       : ${tailleDuPool()} faux comptes en base`);
    console.log('');
    console.log('  Aucune connexion externe, aucun compte réel, aucun abonnement envoyé.');
    console.log('');
  });

  const arret = () => {
    console.log('\nArrêt du simulateur…');
    arreterMoteur();
    serveur.close(() => {
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', arret);
  process.on('SIGTERM', arret);
}

demarrer();

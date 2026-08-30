/**
 * api/orders.controller.js — La « fausse API fournisseur ».
 *
 * Elle imite la forme d'API que proposent les panels du marché :
 *   POST /api/order          -> crée une commande
 *   GET  /api/order/:id      -> état d'une commande
 * plus quelques routes utiles à la compréhension (journal, abonnés livrés,
 * annulation, chute, remplacement).
 *
 * Aucune de ces routes ne sort de la machine : tout est calculé localement.
 */

import { lireJson, json, erreur } from '../http/respond.js';
import { ErreurMetier } from '../domain/orders.js';
import * as commandes from '../domain/orders.js';
import { listerVitesses, estimerDureeSecondes } from '../domain/speed.js';
import { CONFIG } from '../config.js';

/** Convertit un `:id` d'URL en entier, ou lève une erreur 400. */
function lireId(params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    throw new ErreurMetier('Identifiant de commande invalide.', 400, 'invalid_order_id');
  }
  return id;
}

/** Récupère la commande ou lève une 404. */
function exigerCommande(id) {
  const commande = commandes.obtenirCommande(id);
  if (!commande) throw new ErreurMetier(`Commande #${id} introuvable.`, 404, 'not_found');
  return commande;
}

/** POST /api/order — crée une commande. */
export async function creer(req, res) {
  const corps = await lireJson(req);
  const commande = commandes.creerCommande(corps);
  json(res, 201, commande);
}

/** GET /api/order/:id — état complet d'une commande. */
export function detail(req, res, params) {
  const id = lireId(params);
  const commande = exigerCommande(id);
  json(res, 200, {
    ...commande,
    estimation_secondes: estimerDureeSecondes(commande.speed, commande.remaining),
    events: commandes.lireJournal(id, 30),
  });
}

/** GET /api/orders — liste des commandes (dashboard). */
export function lister(req, res, params, url) {
  const statut = url.searchParams.get('status');
  const limite = Math.min(200, Number(url.searchParams.get('limit') ?? 50) || 50);
  json(res, 200, { orders: commandes.listerCommandes({ statut, limite }) });
}

/** GET /api/order/:id/followers — les faux abonnés rattachés à la commande. */
export function abonnes(req, res, params, url) {
  const id = lireId(params);
  exigerCommande(id);
  const limite = Math.min(500, Number(url.searchParams.get('limit') ?? 40) || 40);
  const etat = url.searchParams.get('state');
  json(res, 200, { order_id: id, followers: commandes.listerAbonnes(id, { limite, etat }) });
}

/** GET /api/order/:id/events — journal détaillé. */
export function journal(req, res, params, url) {
  const id = lireId(params);
  exigerCommande(id);
  const limite = Math.min(CONFIG.journal.maxParCommande, Number(url.searchParams.get('limit') ?? 50) || 50);
  json(res, 200, { order_id: id, events: commandes.lireJournal(id, limite) });
}

/** POST /api/order/:id/cancel — annulation. */
export function annuler(req, res, params) {
  json(res, 200, commandes.annulerCommande(lireId(params)));
}

/** POST /api/order/:id/drop — provoque une chute (corps : {count} ou {percent}). */
export async function chute(req, res, params) {
  const id = lireId(params);
  const corps = await lireJson(req);
  json(res, 200, commandes.provoquerChute(id, {
    count: corps.count !== undefined ? Number(corps.count) : undefined,
    percent: corps.percent !== undefined ? Number(corps.percent) : undefined,
  }));
}

/** POST /api/order/:id/refill — déclenche un remplacement manuel. */
export function refill(req, res, params) {
  json(res, 200, commandes.programmerRefill(lireId(params)));
}

/** GET /api/stats — compteurs globaux. */
export function stats(req, res) {
  json(res, 200, commandes.statistiques());
}

/** GET /api/config — ce dont l'interface a besoin pour se configurer. */
export function config(req, res) {
  json(res, 200, {
    vitesses: listerVitesses(),
    quantite_min: CONFIG.commande.quantiteMin,
    quantite_max: CONFIG.commande.quantiteMax,
    taux_chute_max: CONFIG.commande.tauxChuteMax,
    statuts: ['pending', 'processing', 'completed', 'cancelled'],
    simulation: true,
  });
}

export { erreur };

/**
 * public/js/order.js — Logique de la page « Commander ».
 *
 * Enchaînement :
 *   1. charge la configuration (profils de vitesse, bornes de quantité) ;
 *   2. envoie le formulaire à POST /api/order ;
 *   3. ouvre le flux SSE filtré sur la commande créée et met à jour l'affichage
 *      à chaque événement (progression, chute, fin).
 */

import { API, ecouterLeFlux, nombre, libelleStatut, heure, couleurAvatar, echapper } from './api.js';

const $ = (id) => document.getElementById(id);

let commandeCourante = null; // dernier état connu de la commande suivie
let flux = null; // connexion SSE en cours

// =====================================================================
// 1. Configuration initiale
// =====================================================================

async function initialiser() {
  const config = await API.config();

  $('vitesse').innerHTML = config.vitesses
    .map((v) => `<option value="${v.id}" ${v.defaut ? 'selected' : ''}>${echapper(v.libelle)}</option>`)
    .join('');
  $('quantite').max = config.quantite_max;
  $('chute').max = Math.round(config.taux_chute_max * 100);

  const decrireVitesse = () => {
    const choisie = config.vitesses.find((v) => v.id === $('vitesse').value);
    $('aide-vitesse').textContent = choisie
      ? `${choisie.description} (~${choisie.parSeconde.min}–${choisie.parSeconde.max} abonnés/s)`
      : '';
  };
  $('vitesse').addEventListener('change', decrireVitesse);
  decrireVitesse();

  $('chute').addEventListener('input', () => {
    $('valeur-chute').textContent = `${$('chute').value} %`;
  });
}

// =====================================================================
// 2. Création de la commande
// =====================================================================

$('formulaire').addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  $('erreur').classList.add('masque');
  $('bouton-lancer').disabled = true;

  try {
    const commande = await API.creerCommande({
      target: $('cible').value,
      quantity: Number($('quantite').value),
      speed: $('vitesse').value,
      drop_rate: Number($('chute').value) / 100,
      auto_refill: $('refill').checked,
    });
    suivre(commande);
  } catch (erreur) {
    $('erreur').textContent = erreur.message;
    $('erreur').classList.remove('masque');
  } finally {
    $('bouton-lancer').disabled = false;
  }
});

// =====================================================================
// 3. Suivi temps réel
// =====================================================================

function suivre(commande) {
  commandeCourante = commande;

  for (const id of ['carte-suivi', 'carte-journal', 'carte-abonnes']) {
    $(id).classList.remove('masque');
  }
  $('journal').innerHTML = '';
  $('numero').textContent = `#${commande.order_id}`;
  $('rappel-cible').textContent = `Cible : @${commande.target} — ${nombre(commande.quantity)} abonnés demandés.`;

  afficher(commande);
  rafraichirJournal();
  rafraichirAbonnes();
  $('carte-suivi').scrollIntoView({ behavior: 'smooth', block: 'start' });

  flux?.close();
  flux = ecouterLeFlux((type, donnees) => {
    if (type === 'order:event') {
      ajouterAuJournal(donnees);
      return;
    }
    commandeCourante = donnees;
    afficher(donnees);
    if (type === 'order:completed' || type === 'order:drop') rafraichirAbonnes();
  }, commande.order_id);
}

/** Met à jour tous les compteurs de la carte de suivi. */
function afficher(commande) {
  $('statut').className = `statut ${commande.status}`;
  $('statut').textContent = libelleStatut(commande.status);
  $('livres').textContent = nombre(commande.delivered);
  $('total').textContent = nombre(commande.quantity);
  $('c-restant').textContent = nombre(commande.remaining);
  $('c-chutes').textContent = nombre(commande.dropped);
  $('c-remplaces').textContent = nombre(commande.refilled);
  $('c-vitesse').textContent = commande.speed;

  const barre = $('barre');
  barre.querySelector('span').style.width = `${(commande.progress * 100).toFixed(2)}%`;
  barre.classList.toggle('terminee', commande.status === 'completed');

  // Une commande terminée ou annulée ne peut plus être annulée.
  $('bouton-annuler').disabled = commande.status === 'completed' || commande.status === 'cancelled';
  $('bouton-drop').disabled = commande.delivered === 0;
  $('bouton-refill').disabled = commande.remaining === 0 || commande.status === 'cancelled';
}

// =====================================================================
// 4. Journal et liste des faux abonnés
// =====================================================================

function ajouterAuJournal({ type, message, at }) {
  const ligne = document.createElement('li');
  ligne.innerHTML = `<span class="heure">${heure(at)}</span>
    <span class="etiquette ${echapper(type)}">${echapper(type)}</span>
    <span>${echapper(message)}</span>`;
  $('journal').prepend(ligne);
  while ($('journal').children.length > 60) $('journal').lastElementChild.remove();
}

async function rafraichirJournal() {
  if (!commandeCourante) return;
  const { events } = await API.journal(commandeCourante.order_id, 40);
  $('journal').innerHTML = '';
  // L'API renvoie du plus récent au plus ancien : on ajoute en fin de liste.
  for (const evenement of events) {
    const ligne = document.createElement('li');
    ligne.innerHTML = `<span class="heure">${heure(evenement.created_at)}</span>
      <span class="etiquette ${echapper(evenement.type)}">${echapper(evenement.type)}</span>
      <span>${echapper(evenement.message)}</span>`;
    $('journal').append(ligne);
  }
}

async function rafraichirAbonnes() {
  if (!commandeCourante) return;
  const { followers } = await API.abonnes(commandeCourante.order_id, 40);
  $('abonnes').innerHTML = followers
    .map((abonne) => {
      const initiale = abonne.username.charAt(0).toUpperCase();
      return `<div class="abonne ${abonne.state}">
        <span class="avatar" style="background:${couleurAvatar(abonne.avatar_seed)}">${echapper(initiale)}</span>
        <span class="pseudo">@${echapper(abonne.username)}</span>
        <span class="qualite">${echapper(abonne.quality)}</span>
      </div>`;
    })
    .join('') || '<p class="aide">Aucun abonné livré pour l’instant.</p>';
}

// =====================================================================
// 5. Actions manuelles (chute, remplacement, annulation)
// =====================================================================

/** Exécute une action d'API et rafraîchit l'affichage. */
async function agir(action) {
  if (!commandeCourante) return;
  $('erreur-action').classList.add('masque');
  try {
    const commande = await action(commandeCourante.order_id);
    commandeCourante = commande;
    afficher(commande);
    rafraichirAbonnes();
  } catch (erreur) {
    $('erreur-action').textContent = erreur.message;
    $('erreur-action').classList.remove('masque');
  }
}

$('bouton-drop').addEventListener('click', () => agir((id) => API.chute(id, { percent: 10 })));
$('bouton-refill').addEventListener('click', () => agir((id) => API.refill(id)));
$('bouton-annuler').addEventListener('click', () => agir((id) => API.annuler(id)));

initialiser();

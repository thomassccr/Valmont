/**
 * public/js/dashboard.js — Logique du tableau de bord (étape 9).
 *
 * Le dashboard charge la liste complète une fois, puis se contente d'appliquer
 * les événements du flux SSE : chaque commande n'est redessinée que lorsqu'elle
 * change réellement, ce qui permet de suivre des dizaines de commandes sans
 * recharger la page.
 */

import { API, ecouterLeFlux, nombre, libelleStatut, echapper } from './api.js';

const $ = (id) => document.getElementById(id);

/** État local : order_id -> commande. */
const commandes = new Map();

// =====================================================================
// Rendu
// =====================================================================

function ligneHtml(commande) {
  const pourcent = (commande.progress * 100).toFixed(1);
  const date = new Date(commande.created_at).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return `
    <td><strong>#${commande.order_id}</strong></td>
    <td>@${echapper(commande.target)}</td>
    <td><span class="statut ${commande.status}">${libelleStatut(commande.status)}</span></td>
    <td>
      <div class="barre mini ${commande.status === 'completed' ? 'terminee' : ''}">
        <span style="width:${pourcent}%"></span>
      </div>
      <div class="libelle" style="font-size:11px;color:var(--texte-faible);margin-top:4px">${pourcent} %</div>
    </td>
    <td class="nombre">${nombre(commande.delivered)} / ${nombre(commande.quantity)}</td>
    <td class="nombre">${nombre(commande.remaining)}</td>
    <td class="nombre">${nombre(commande.dropped)}${commande.refilled ? ` <span style="color:var(--ok)">(+${nombre(commande.refilled)})</span>` : ''}</td>
    <td>${echapper(commande.speed)}</td>
    <td style="color:var(--texte-faible);font-size:13px">${date}</td>
    <td>
      <div class="actions-ligne">
      <button class="secondaire" data-action="drop" data-id="${commande.order_id}"
        ${commande.delivered === 0 ? 'disabled' : ''} style="padding:5px 10px;font-size:12px">Drop</button>
      <button class="secondaire" data-action="refill" data-id="${commande.order_id}"
        ${commande.remaining === 0 || commande.status === 'cancelled' ? 'disabled' : ''} style="padding:5px 10px;font-size:12px">Refill</button>
      </div>
    </td>`;
}

/** Insère ou met à jour la ligne d'une commande, en gardant l'ordre décroissant. */
function dessiner(commande) {
  commandes.set(commande.order_id, commande);

  let ligne = document.getElementById(`commande-${commande.order_id}`);
  if (!ligne) {
    ligne = document.createElement('tr');
    ligne.id = `commande-${commande.order_id}`;
    // Les commandes les plus récentes (id le plus grand) restent en haut.
    const suivante = [...$('lignes').children].find(
      (tr) => Number(tr.id.split('-')[1]) < commande.order_id,
    );
    $('lignes').insertBefore(ligne, suivante ?? null);
  }
  ligne.innerHTML = ligneHtml(commande);
  $('vide').classList.toggle('masque', commandes.size > 0);
}

async function rafraichirStats() {
  const stats = await API.stats();
  $('s-total').textContent = nombre(stats.total_commandes);
  $('s-encours').textContent = nombre(stats.commandes.processing + stats.commandes.pending);
  $('s-terminees').textContent = nombre(stats.commandes.completed);
  $('s-livres').textContent = nombre(stats.abonnes_livres);
  $('s-chutes').textContent = nombre(stats.abonnes_chutes);
  $('s-remplaces').textContent = nombre(stats.abonnes_remplaces);
  $('s-pool').textContent = nombre(stats.taille_du_pool);
}

// =====================================================================
// Actions rapides depuis le tableau (délégation d'événements)
// =====================================================================

$('lignes').addEventListener('click', async (evenement) => {
  const bouton = evenement.target.closest('button[data-action]');
  if (!bouton) return;
  const id = Number(bouton.dataset.id);
  bouton.disabled = true;
  try {
    const commande = bouton.dataset.action === 'drop'
      ? await API.chute(id, { percent: 10 })
      : await API.refill(id);
    dessiner(commande);
  } catch (erreur) {
    alert(erreur.message);
    bouton.disabled = false;
  }
});

// =====================================================================
// Démarrage
// =====================================================================

async function initialiser() {
  const { orders } = await API.listerCommandes(100);
  // On dessine du plus ancien au plus récent pour que l'insertion garde l'ordre.
  for (const commande of [...orders].reverse()) dessiner(commande);
  await rafraichirStats();

  ecouterLeFlux((type, donnees) => {
    if (type === 'order:event') return; // le journal détaillé est sur la page commande
    dessiner(donnees);
  });

  // Les compteurs globaux sont recalculés côté serveur : un rafraîchissement
  // périodique suffit largement (les barres, elles, bougent en temps réel).
  setInterval(rafraichirStats, 2000);
}

initialiser();

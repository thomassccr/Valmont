/**
 * http/router.js — Mini-routeur maison (aucune dépendance type Express).
 *
 * On enregistre des routes « MÉTHODE + motif » où le motif peut contenir des
 * paramètres nommés : `/api/order/:id`. Le routeur retrouve le premier motif
 * correspondant et appelle le gestionnaire avec les paramètres extraits.
 */

/** Transforme `/api/order/:id` en expression régulière + liste de paramètres. */
function compilerMotif(motif) {
  const noms = [];
  const source = motif
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      noms.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), noms };
}

export function creerRouteur() {
  const routes = [];

  /** Enregistre une route. */
  function ajouter(methode, motif, gestionnaire) {
    routes.push({ methode, ...compilerMotif(motif), gestionnaire, motif });
  }

  return {
    get: (motif, gestionnaire) => ajouter('GET', motif, gestionnaire),
    post: (motif, gestionnaire) => ajouter('POST', motif, gestionnaire),
    /**
     * Cherche la route correspondant à une requête.
     * @returns {{gestionnaire: Function, params: Record<string,string>}|null}
     */
    resoudre(methode, chemin) {
      for (const route of routes) {
        if (route.methode !== methode) continue;
        const correspondance = route.regex.exec(chemin);
        if (!correspondance) continue;
        const params = {};
        route.noms.forEach((nom, index) => {
          params[nom] = decodeURIComponent(correspondance[index + 1]);
        });
        return { gestionnaire: route.gestionnaire, params };
      }
      return null;
    },
    /** Liste des routes exposées (utile pour la page d'accueil de l'API). */
    lister: () => routes.map((route) => `${route.methode} ${route.motif}`),
  };
}

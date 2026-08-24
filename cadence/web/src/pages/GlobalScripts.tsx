import ScriptLibrary from '../components/ScriptLibrary';

/**
 * Bibliothèque globale : les scripts sans modèle, visibles depuis tous les
 * modèles sans duplication.
 */
export default function GlobalScripts() {
  return (
    <div className="page-enter">
      <ScriptLibrary scope="global" />
    </div>
  );
}

import { useMemo, useState } from 'react';
import { formatMoney } from '../../../shared/scripts';
import type { ModelSummary, Script, ScriptInput } from '../../../shared/types';
import { api } from '../api';
import ScriptEditor from './ScriptEditor';
import {
  Badge,
  Empty,
  Spinner,
  StarButton,
  formatDate,
  useAsync,
  useDebounced,
  useToast,
} from './ui';

interface Props {
  /** Modèle courant ; null = bibliothèque globale. */
  modelId?: string | null;
  /** 'all' : scripts du modèle + globaux · 'global' : globaux seuls · 'model' : modèle seul. */
  scope?: 'all' | 'global' | 'model';
  /** Restreint aux favoris (section Favorites). */
  favoritesOnly?: boolean;
  /** Scripts fournis par le parent (Favorites) au lieu d'être chargés ici. */
  provided?: Script[] | null;
  onChanged?: () => void;
}

export default function ScriptLibrary({
  modelId = null,
  scope = 'global',
  favoritesOnly = false,
  provided = null,
  onChanged,
}: Props) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(favoritesOnly);
  const [onlyRecent, setOnlyRecent] = useState(false);
  const [editing, setEditing] = useState<{ script: Script | null; defaults?: Partial<ScriptInput> } | null>(
    null,
  );
  const debouncedSearch = useDebounced(search);

  const categories = useAsync(() => api.scriptCategories(), []);
  const models = useAsync(() => api.models(), []);
  const tags = useAsync(() => api.scriptTags(), []);

  const loaded = useAsync(
    () =>
      provided
        ? Promise.resolve(provided)
        : api.scripts({
            model_id: modelId,
            scope,
            search: debouncedSearch,
            category,
            tag,
            favorites: onlyFavorites,
            recent: onlyRecent,
          }),
    [provided, modelId, scope, debouncedSearch, category, tag, onlyFavorites, onlyRecent],
  );

  const refresh = () => {
    loaded.reload();
    tags.reload();
    onChanged?.();
  };

  const toggleFavorite = async (script: Script) => {
    await api.toggleFavorite('script', script.id);
    refresh();
  };

  const copy = async (script: Script) => {
    // La copie est l'action réelle de l'opérateur : c'est elle qui compte comme
    // une utilisation, ce qui alimente les statistiques sans saisie manuelle.
    await navigator.clipboard.writeText(script.content).catch(() => undefined);
    await api.recordScriptUsage(script.id).catch(() => undefined);
    toast('Script copié');
    refresh();
  };

  const duplicate = async (script: Script) => {
    const copyScript = await api.duplicateScript(script.id);
    toast('Script dupliqué');
    refresh();
    setEditing({ script: copyScript });
  };

  const remove = async (script: Script) => {
    if (!confirm(`Supprimer « ${script.name} » ?`)) return;
    await api.deleteScript(script.id);
    toast('Script supprimé');
    refresh();
  };

  const visibleTags = useMemo(() => (tags.data ?? []).slice(0, 12), [tags.data]);
  const scripts = loaded.data ?? [];

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Rechercher un script, un tag, un contenu…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">Toutes catégories</option>
          {categories.data?.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          className={`filter-chip${onlyFavorites ? ' on' : ''}`}
          onClick={() => setOnlyFavorites((value) => !value)}
          disabled={favoritesOnly}
        >
          ★ Favorites
        </button>
        <button
          className={`filter-chip${onlyRecent ? ' on' : ''}`}
          onClick={() => setOnlyRecent((value) => !value)}
        >
          Recently used
        </button>
        <button
          className="btn primary"
          onClick={() =>
            setEditing({
              script: null,
              defaults: { model_id: scope === 'global' ? null : modelId },
            })
          }
        >
          + New Script
        </button>
      </div>

      {visibleTags.length ? (
        <div className="filter-row">
          {visibleTags.map((item) => (
            <button
              key={item.slug}
              className={`filter-chip${tag === item.slug ? ' on' : ''}`}
              onClick={() => setTag(tag === item.slug ? '' : item.slug)}
            >
              {item.label} <span className="faint">{item.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {loaded.loading ? <Spinner /> : null}

      {!loaded.loading && !scripts.length ? (
        <Empty
          title="Aucun script"
          hint={
            search || category || tag || onlyFavorites || onlyRecent
              ? 'Aucun résultat pour ces filtres.'
              : 'Crée un premier script pour cette bibliothèque.'
          }
        />
      ) : null}

      <div className="grid auto">
        {scripts.map((script) => (
          <article className="script-card" key={script.id}>
            <div className="head">
              <div className="grow">
                <div className="name" onClick={() => setEditing({ script })}>
                  {script.name}
                </div>
                <div className="row wrap" style={{ gap: 5, marginTop: 5 }}>
                  <Badge tone="accent">{script.category_label}</Badge>
                  {script.model_id ? (
                    <Badge>{script.model_name}</Badge>
                  ) : (
                    <Badge tone="success">Global</Badge>
                  )}
                </div>
              </div>
              <StarButton on={script.is_favorite} onToggle={() => toggleFavorite(script)} />
            </div>

            {script.description ? <p className="desc">{script.description}</p> : null}
            <div className="excerpt">{script.content || '—'}</div>

            {script.tags.length ? (
              <div className="row wrap" style={{ gap: 4 }}>
                {script.tags.slice(0, 4).map((label) => (
                  <span className="chip" key={label}>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="foot">
              <div className="stats">
                <span title="Utilisations">↻ {script.usage_count}</span>
                {script.revenue_cents ? <span title="Revenu">{formatMoney(script.revenue_cents)}</span> : null}
                <span title="Dernière modification">{formatDate(script.updated_at)}</span>
              </div>
              <div className="actions">
                <button className="btn ghost sm" title="Edit" onClick={() => setEditing({ script })}>
                  Edit
                </button>
                <button className="btn ghost sm" title="Duplicate" onClick={() => duplicate(script)}>
                  ⧉
                </button>
                <button className="btn ghost sm" title="Delete" onClick={() => remove(script)}>
                  ✕
                </button>
                <button className="btn sm" onClick={() => copy(script)}>
                  Copy
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {editing ? (
        <ScriptEditor
          script={editing.script}
          defaults={editing.defaults}
          categories={categories.data ?? []}
          models={models.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

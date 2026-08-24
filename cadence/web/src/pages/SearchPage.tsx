import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import ScriptLibrary from '../components/ScriptLibrary';
import {
  Avatar,
  Badge,
  Empty,
  Spinner,
  formatDateTime,
  useAsync,
  useDebounced,
} from '../components/ui';

/** Recherche globale : modèles, scripts, templates et historique en un seul écran. */
export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const query = useDebounced(params.get('q') ?? '', 200);
  const results = useAsync(() => api.search(query), [query]);

  if (!query.trim()) {
    return <Empty title="Recherche" hint="Tape un modèle, une catégorie, un tag ou un contenu." />;
  }
  if (results.loading) return <Spinner />;
  const data = results.data;
  const total =
    (data?.models.length ?? 0) +
    (data?.scripts.length ?? 0) +
    (data?.templates.length ?? 0) +
    (data?.generations.length ?? 0);

  return (
    <div className="page-enter">
      <p className="faint" style={{ marginBottom: 18 }}>
        {total} résultat(s) pour « {query} »
      </p>

      {!total ? <Empty title="Aucun résultat" hint="Essaie un autre terme." /> : null}

      {data?.models.length ? (
        <>
          <div className="section-title">Modèles</div>
          <div className="grid auto" style={{ marginBottom: 24 }}>
            {data.models.map((model) => (
              <div
                className="card interactive"
                key={model.id}
                onClick={() => navigate(`/models/${model.id}`)}
              >
                <div className="row">
                  <Avatar name={model.name} url={model.avatar_url} color={model.accent_color} />
                  <div className="grow">
                    <strong>{model.name}</strong>
                    <div className="faint">
                      {model.script_count} scripts · {model.archived ? 'Inactive' : 'Active'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {data?.scripts.length ? (
        <>
          <div className="section-title">Scripts</div>
          <div style={{ marginBottom: 24 }}>
            <ScriptLibrary provided={data.scripts} onChanged={() => results.reload()} />
          </div>
        </>
      ) : null}

      {data?.templates.length ? (
        <>
          <div className="section-title">Prompt templates</div>
          <div style={{ marginBottom: 24 }}>
            {data.templates.map((template) => (
              <div className="list-row" key={template.id} onClick={() => navigate('/settings')}>
                <div className="grow">
                  <div className="list-title">{template.name}</div>
                  <div className="list-sub">{template.description || template.body.slice(0, 90)}</div>
                </div>
                <Badge>{template.category}</Badge>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {data?.generations.length ? (
        <>
          <div className="section-title">Historique de génération</div>
          {data.generations.map((item) => (
            <div className="list-row" key={item.id} onClick={() => navigate('/history')}>
              <div className="grow">
                <div className="list-title">{item.creator_name}</div>
                <div className="list-sub">{item.subscriber_message || item.objective || '—'}</div>
              </div>
              <span className="faint">{formatDateTime(item.created_at)}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

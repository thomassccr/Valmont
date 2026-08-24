import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import ScriptLibrary from '../components/ScriptLibrary';
import {
  Avatar,
  Badge,
  CopyButton,
  Empty,
  Spinner,
  StarButton,
  formatDateTime,
  useAsync,
  useToast,
} from '../components/ui';

export default function Favorites({ onChanged }: { onChanged?: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const favorites = useAsync(() => api.favorites(), []);

  const unfavorite = async (type: 'model' | 'generation', entityId: string) => {
    await api.toggleFavorite(type, entityId);
    toast('Retiré des favoris');
    favorites.reload();
    onChanged?.();
  };

  if (favorites.loading) return <Spinner />;
  const data = favorites.data;
  const empty =
    !data || (!data.scripts.length && !data.models.length && !data.generations.length);

  return (
    <div className="page-enter">
      {empty ? (
        <Empty
          title="Aucun favori"
          hint="Marque un script, un modèle ou une génération avec l’étoile pour le retrouver ici."
        />
      ) : null}

      {data?.models.length ? (
        <>
          <div className="section-title">Modèles favoris</div>
          <div className="grid auto" style={{ marginBottom: 26 }}>
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
                    <div className="faint">{model.script_count} scripts</div>
                  </div>
                  <StarButton on onToggle={() => unfavorite('model', model.id)} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {data?.generations.length ? (
        <>
          <div className="section-title">Prompts favoris</div>
          <div style={{ marginBottom: 26 }}>
            {data.generations.map((item) => (
              <div className="card" key={item.id} style={{ marginBottom: 10 }}>
                <div className="card-head">
                  <div className="row">
                    <strong>{item.creator_name}</strong>
                    <Badge>{item.scenario_name ?? 'Libre'}</Badge>
                    <span className="faint">{formatDateTime(item.created_at)}</span>
                  </div>
                  <StarButton on onToggle={() => unfavorite('generation', item.id)} />
                </div>
                {item.suggestions.slice(0, 2).map((suggestion) => (
                  <div className="row" key={suggestion.id} style={{ padding: '5px 0', gap: 10 }}>
                    <div className="grow suggestion-text">{suggestion.text}</div>
                    <CopyButton text={suggestion.text} className="btn ghost sm" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="section-title">Scripts favoris</div>
      <ScriptLibrary favoritesOnly provided={data?.scripts ?? []} onChanged={() => favorites.reload()} />
    </div>
  );
}

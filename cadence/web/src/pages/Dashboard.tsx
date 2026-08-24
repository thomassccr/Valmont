import { Link, useNavigate } from 'react-router-dom';
import { formatMoney } from '../../../shared/scripts';
import { api } from '../api';
import {
  Avatar,
  Badge,
  Empty,
  Meter,
  Spinner,
  Stat,
  formatDateTime,
  useAsync,
} from '../components/ui';

export default function Dashboard() {
  const navigate = useNavigate();
  const stats = useAsync(() => api.stats(), []);
  const models = useAsync(() => api.models(), []);
  const analytics = useAsync(() => api.analytics(), []);
  const health = useAsync(() => api.health(), []);

  if (stats.loading) return <Spinner />;
  if (!stats.data) return <Empty title="Statistiques indisponibles" hint={stats.error ?? undefined} />;

  const data = stats.data;

  return (
    <div className="page-enter">
      <div className="toolbar">
        <div className="search row wrap">
          {health.data ? (
            <>
              <Badge tone={health.data.provider === 'local' ? 'warn' : 'success'}>
                {health.data.provider === 'local' ? 'mode local (sans IA)' : health.data.provider}
              </Badge>
              <span className="faint">{health.data.model}</span>
            </>
          ) : null}
        </div>
        <Link className="btn" to="/scripts">
          Global Scripts
        </Link>
        <Link className="btn primary" to="/generator">
          ✦ Nouvelle génération
        </Link>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 22 }}>
        <Stat value={data.generations_today} label="Générations aujourd’hui" />
        <Stat value={data.generations_week} label="Sur 7 jours" />
        <Stat value={models.data?.length ?? data.creators_active} label="Modèles" />
        <Stat
          value={analytics.data ? formatMoney(analytics.data.totals.revenue_cents) : '—'}
          label="Revenu attribué (14 j)"
          hint={
            analytics.data
              ? `${analytics.data.totals.scripts_total} scripts en bibliothèque`
              : undefined
          }
        />
      </div>

      <div className="section-title">Modèles</div>
      <div className="grid auto" style={{ marginBottom: 26 }}>
        {models.data?.slice(0, 6).map((model) => (
          <div
            className="card interactive"
            key={model.id}
            onClick={() => navigate(`/models/${model.id}`)}
          >
            <div className="row">
              <Avatar name={model.name} url={model.avatar_url} color={model.accent_color} size="lg" />
              <div className="grow">
                <div className="row">
                  <strong>{model.name}</strong>
                  <span className={`status-dot${model.archived ? ' off' : ''}`} />
                </div>
                <div className="faint">{model.script_count} scripts</div>
                <div style={{ marginTop: 6 }}>
                  <Meter value={model.performance.score / 100} />
                </div>
              </div>
            </div>
          </div>
        ))}
        {models.data && !models.data.length ? (
          <div className="card">
            <p className="faint">Aucun modèle. Commence par en créer un.</p>
            <Link className="btn primary sm" to="/models" style={{ marginTop: 10 }}>
              + Add Model
            </Link>
          </div>
        ) : null}
      </div>

      <div className="split wide-left">
        <div className="card">
          <div className="card-head">
            <span className="card-title">Dernières générations</span>
            <Link className="btn ghost sm" to="/history">
              Tout voir
            </Link>
          </div>
          {data.recent.length ? (
            data.recent.map((item) => (
              <div
                key={item.id}
                className="row"
                style={{ justifyContent: 'space-between', padding: '7px 0', gap: 12 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 550 }}>{item.creator_name}</div>
                  <div className="list-sub">{item.subscriber_message || item.objective || '—'}</div>
                </div>
                <span className="faint">{formatDateTime(item.created_at)}</span>
              </div>
            ))
          ) : (
            <p className="faint">Rien pour l’instant.</p>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Scénarios les plus utilisés</span>
            <span className="card-hint">7 jours</span>
          </div>
          {data.top_scenarios.length ? (
            data.top_scenarios.map((scenario) => (
              <div key={scenario.name} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{scenario.name}</span>
                  <span className="faint nums">{scenario.count}</span>
                </div>
                <Meter value={scenario.count / (data.top_scenarios[0].count || 1)} />
              </div>
            ))
          ) : (
            <p className="faint">Aucune génération sur la période.</p>
          )}
        </div>
      </div>
    </div>
  );
}

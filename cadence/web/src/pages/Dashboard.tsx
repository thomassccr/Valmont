import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, Empty, Spinner, useAsync } from '../components/ui';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const stats = useAsync(() => api.stats(), []);
  const health = useAsync(() => api.health(), []);

  if (stats.loading) return <Spinner />;
  if (!stats.data) return <Empty title="Statistiques indisponibles" hint={stats.error ?? undefined} />;

  const data = stats.data;

  return (
    <>
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
        <Link className="btn primary" to="/console">
          ✦ Nouvelle génération
        </Link>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <Stat value={data.generations_today} label="Générations aujourd’hui" />
        <Stat value={data.generations_week} label="Sur 7 jours" />
        <Stat value={data.creators_active} label="Créateurs actifs" />
        <Stat value={`${data.avg_latency_ms} ms`} label="Latence moyenne" />
      </div>

      <div className="split">
        <div className="card">
          <div className="card-head">
            <span className="card-title">Scénarios les plus utilisés</span>
            <span className="card-hint">7 derniers jours</span>
          </div>
          {data.top_scenarios.length ? (
            data.top_scenarios.map((scenario) => {
              const max = data.top_scenarios[0].count || 1;
              return (
                <div key={scenario.name} style={{ marginBottom: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{scenario.name}</span>
                    <span className="faint">{scenario.count}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg)', borderRadius: 4, marginTop: 4 }}>
                    <div
                      style={{
                        width: `${(scenario.count / max) * 100}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="faint">Aucune génération sur la période.</p>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Dernières générations</span>
            <Link className="btn ghost sm" to="/history">
              Tout voir
            </Link>
          </div>
          {data.recent.length ? (
            data.recent.map((item) => (
              <div key={item.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 550 }}>{item.creator_name}</div>
                  <div className="list-sub">{item.subscriber_message || item.objective || '—'}</div>
                </div>
                <span className="faint">{formatDate(item.created_at)}</span>
              </div>
            ))
          ) : (
            <p className="faint">Rien pour l’instant.</p>
          )}
        </div>
      </div>
    </>
  );
}

import { useNavigate } from 'react-router-dom';
import { formatMoney } from '../../../shared/scripts';
import { api } from '../api';
import { Avatar, Badge, Empty, Meter, Spinner, Stat, formatDate, useAsync } from '../components/ui';

export default function Analytics() {
  const navigate = useNavigate();
  const analytics = useAsync(() => api.analytics(), []);

  if (analytics.loading) return <Spinner />;
  if (!analytics.data) return <Empty title="Analytics indisponibles" hint={analytics.error ?? undefined} />;

  const data = analytics.data;
  const maxDay = Math.max(1, ...data.by_day.map((day) => day.generations + day.usages));

  return (
    <div className="page-enter">
      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <Stat value={data.totals.generations_week} label="Générations (7 j)" />
        <Stat value={data.totals.scripts_total} label="Scripts en bibliothèque" />
        <Stat
          value={data.totals.scripts_used_week}
          label="Scripts utilisés (14 j)"
          hint={`${Math.round(data.totals.conversion_rate * 100)} % de conversion`}
        />
        <Stat value={formatMoney(data.totals.revenue_cents)} label="Revenu attribué (14 j)" />
      </div>

      <div className="split wide-left">
        <div className="card">
          <div className="card-head">
            <span className="card-title">Activité</span>
            <span className="card-hint">14 derniers jours · générations + utilisations</span>
          </div>
          <div className="bars">
            {data.by_day.map((day) => {
              const total = day.generations + day.usages;
              return (
                <div
                  className="bar"
                  key={day.date}
                  title={`${day.date} · ${day.generations} générations · ${day.usages} utilisations`}
                  style={{ height: '100%' }}
                >
                  <span style={{ height: `${(total / maxDay) * 100}%`, marginTop: 'auto' }} />
                </div>
              );
            })}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className="faint">{data.by_day[0]?.date}</span>
            <span className="faint">{data.by_day[data.by_day.length - 1]?.date}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Par catégorie</span>
          </div>
          {data.by_category.length ? (
            data.by_category.map((row) => (
              <div key={row.category} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{row.category}</span>
                  <span className="faint nums">
                    {row.usage_count} · {formatMoney(row.revenue_cents)}
                  </span>
                </div>
                <Meter value={row.usage_count / Math.max(1, data.by_category[0].usage_count)} />
              </div>
            ))
          ) : (
            <p className="faint">Aucune utilisation enregistrée sur la période.</p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <span className="card-title">Scripts les plus performants</span>
          <span className="card-hint">Classés par revenu attribué</span>
        </div>
        {data.top_scripts.length ? (
          <table className="data">
            <thead>
              <tr>
                <th>Script</th>
                <th>Bibliothèque</th>
                <th>Catégorie</th>
                <th className="num">Usage</th>
                <th className="num">Conversion</th>
                <th className="num">Revenu</th>
                <th style={{ width: 130 }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {data.top_scripts.map((script) => (
                <tr key={script.id}>
                  <td>{script.name}</td>
                  <td>
                    {script.model_id ? (
                      <Badge>{script.model_name}</Badge>
                    ) : (
                      <Badge tone="success">Global</Badge>
                    )}
                  </td>
                  <td className="faint">{script.category_label}</td>
                  <td className="num nums">{script.usage_count}</td>
                  <td className="num nums">{Math.round(script.conversion_rate * 100)} %</td>
                  <td className="num nums">{formatMoney(script.revenue_cents)}</td>
                  <td>
                    <div className="row">
                      <Meter value={script.performance_score / 100} tone="success" />
                      <span className="faint nums">{script.performance_score}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="Pas encore de données"
            hint="Copier un script depuis la bibliothèque compte comme une utilisation ; enregistrer une conversion ajoute le revenu."
          />
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <span className="card-title">Modèles</span>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Modèle</th>
              <th>Statut</th>
              <th className="num">Scripts</th>
              <th className="num">Usage</th>
              <th className="num">Conversion</th>
              <th className="num">Revenu</th>
              <th className="num">Dernière</th>
              <th style={{ width: 130 }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((model) => (
              <tr
                key={model.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/models/${model.id}`)}
              >
                <td>
                  <div className="row">
                    <Avatar name={model.name} url={model.avatar_url} color={model.accent_color} />
                    <span>{model.name}</span>
                  </div>
                </td>
                <td>
                  <Badge tone={model.archived ? 'default' : 'success'}>
                    {model.archived ? 'Inactive' : 'Active'}
                  </Badge>
                </td>
                <td className="num nums">{model.script_count}</td>
                <td className="num nums">{model.performance.usage_count}</td>
                <td className="num nums">{Math.round(model.performance.conversion_rate * 100)} %</td>
                <td className="num nums">{formatMoney(model.performance.revenue_cents)}</td>
                <td className="num faint">{formatDate(model.performance.last_used_at)}</td>
                <td>
                  <div className="row">
                    <Meter value={model.performance.score / 100} />
                    <span className="faint nums">{model.performance.score}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

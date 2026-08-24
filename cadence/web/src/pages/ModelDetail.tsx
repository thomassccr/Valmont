import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatMoney } from '../../../shared/scripts';
import type { CreatorInput, Script } from '../../../shared/types';
import { api } from '../api';
import GeneratorPanel from '../components/GeneratorPanel';
import ModelProfileForm, { toModelInput } from '../components/ModelProfileForm';
import ScriptLibrary from '../components/ScriptLibrary';
import {
  Avatar,
  Badge,
  Empty,
  Field,
  Meter,
  Modal,
  Spinner,
  StarButton,
  Stat,
  Tabs,
  formatDate,
  useAsync,
  useToast,
} from '../components/ui';

type Tab = 'overview' | 'profile' | 'scripts' | 'generator' | 'performance';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'profile', label: 'Profile' },
  { key: 'scripts', label: 'Scripts' },
  { key: 'generator', label: 'Prompt Generator' },
  { key: 'performance', label: 'Performance' },
];

export default function ModelDetail({ onChanged }: { onChanged?: () => void }) {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (next: Tab) => setParams({ tab: next }, { replace: true });

  const model = useAsync(() => api.model(id), [id]);
  const scripts = useAsync(() => api.scripts({ model_id: id, scope: 'all' }), [id, tab]);
  const history = useAsync(() => api.history({ creator_id: id, limit: 6 }), [id]);

  const [draft, setDraft] = useState<CreatorInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [logging, setLogging] = useState<Script | null>(null);

  if (model.loading) return <Spinner />;
  if (!model.data) return <Empty title="Modèle introuvable" hint={model.error ?? undefined} />;

  const data = model.data;
  const profileDraft = draft ?? toModelInput(data);
  const modelScripts = (scripts.data ?? []).filter((script) => script.model_id === id);
  const usedScripts = (scripts.data ?? []).filter((script) => script.usage_count > 0);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.updateCreator(id, profileDraft);
      toast('Profil enregistré');
      setDraft(null);
      model.reload();
      onChanged?.();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Enregistrement impossible', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={tab === 'generator' ? '' : 'page-enter'}>
      <header className="model-header">
        <Avatar name={data.name} url={data.avatar_url} color={data.accent_color} size="xl" />
        <div className="grow">
          <div className="title">
            <h1>{data.name}</h1>
            {data.age ? <Badge>{data.age} ans</Badge> : null}
            <Badge tone={data.archived ? 'default' : 'success'}>
              {data.archived ? 'Inactive' : 'Active'}
            </Badge>
            <StarButton
              on={data.is_favorite}
              onToggle={async () => {
                await api.toggleFavorite('model', id);
                model.reload();
                onChanged?.();
              }}
            />
          </div>
          <div className="sub">
            {data.handle ? `${data.handle} · ` : ''}
            {data.script_count} scripts · {data.performance.usage_count} utilisations ·{' '}
            {formatMoney(data.performance.revenue_cents)}
          </div>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setTab('generator')}>
            ✦ Generate
          </button>
          <button
            className="btn danger sm"
            onClick={async () => {
              if (!confirm(`Supprimer définitivement « ${data.name} » et ses scripts ?`)) return;
              await api.deleteCreator(id);
              toast('Modèle supprimé');
              onChanged?.();
              navigate('/models');
            }}
          >
            Supprimer
          </button>
        </div>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ───────────  Overview  ─────────── */}
      {tab === 'overview' ? (
        <>
          <div className="grid cols-4" style={{ marginBottom: 20 }}>
            <Stat value={data.script_count} label="Scripts du modèle" />
            <Stat value={data.performance.usage_count} label="Utilisations" />
            <Stat
              value={`${Math.round(data.performance.conversion_rate * 100)} %`}
              label="Taux de conversion"
            />
            <Stat
              value={formatMoney(data.performance.revenue_cents)}
              label="Revenu attribué"
              hint={`Score ${data.performance.score}/100`}
            />
          </div>

          <div className="split wide-left">
            <div className="card">
              <div className="card-head">
                <span className="card-title">Profil</span>
                <button className="btn ghost sm" onClick={() => setTab('profile')}>
                  Modifier
                </button>
              </div>
              {[
                ['Personality', data.personality],
                ['Tone of voice', data.tone],
                ['Writing style', data.writing_style],
                ['Target audience', data.audience_type],
                ['Content style', data.content_style],
                ['Interests', data.interests.join(', ')],
                ['Things to mention', data.preferred_topics.join(', ')],
                ['Things to avoid', data.guardrails.banned_topics.join(', ')],
                ['Custom instructions', data.custom_instructions],
              ].map(([label, value]) => (
                <div key={label} style={{ marginBottom: 10 }}>
                  <div className="field-label">{label}</div>
                  <div className={value ? 'muted' : 'faint'}>{value || 'Non renseigné'}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-head">
                  <span className="card-title">Scripts récents</span>
                  <button className="btn ghost sm" onClick={() => setTab('scripts')}>
                    Tout voir
                  </button>
                </div>
                {modelScripts.slice(0, 5).map((script) => (
                  <div key={script.id} className="row" style={{ padding: '6px 0', gap: 10 }}>
                    <div className="grow truncate">{script.name}</div>
                    <Badge>{script.category_label}</Badge>
                  </div>
                ))}
                {!modelScripts.length ? (
                  <p className="faint">
                    Aucun script propre à ce modèle. Les scripts globaux restent accessibles.
                  </p>
                ) : null}
              </div>

              <div className="card">
                <div className="card-head">
                  <span className="card-title">Dernières générations</span>
                </div>
                {history.data?.length ? (
                  history.data.map((item) => (
                    <div key={item.id} className="row" style={{ padding: '6px 0', gap: 10 }}>
                      <div className="grow truncate faint">
                        {item.subscriber_message || item.objective || '—'}
                      </div>
                      <span className="faint">{formatDate(item.created_at)}</span>
                    </div>
                  ))
                ) : (
                  <p className="faint">Aucune génération pour ce modèle.</p>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* ───────────  Profile  ─────────── */}
      {tab === 'profile' ? (
        <div className="content-narrow">
          <div className="alert info" style={{ marginBottom: 18 }}>
            Ces informations sont injectées automatiquement dans le prompt système à chaque
            génération pour ce modèle.
          </div>
          <ModelProfileForm
            draft={profileDraft}
            onChange={(partial) => setDraft({ ...profileDraft, ...partial })}
          />
          <div className="btn-row" style={{ marginTop: 20 }}>
            <button className="btn primary" onClick={saveProfile} disabled={saving || !draft}>
              {saving ? <Spinner /> : null} Enregistrer le profil
            </button>
            {draft ? (
              <button className="btn ghost" onClick={() => setDraft(null)}>
                Annuler les modifications
              </button>
            ) : (
              <span className="faint">Aucune modification en attente.</span>
            )}
          </div>
        </div>
      ) : null}

      {/* ───────────  Scripts  ─────────── */}
      {tab === 'scripts' ? (
        <ScriptLibrary
          modelId={id}
          scope="all"
          onChanged={() => {
            scripts.reload();
            model.reload();
          }}
        />
      ) : null}

      {/* ───────────  Prompt Generator  ─────────── */}
      {tab === 'generator' ? (
        <GeneratorPanel lockedModelId={id} embedded />
      ) : null}

      {/* ───────────  Performance  ─────────── */}
      {tab === 'performance' ? (
        <>
          <div className="grid cols-4" style={{ marginBottom: 20 }}>
            <Stat value={data.performance.usage_count} label="Utilisations" />
            <Stat
              value={`${Math.round(data.performance.conversion_rate * 100)} %`}
              label="Conversion"
            />
            <Stat value={formatMoney(data.performance.revenue_cents)} label="Revenu" />
            <Stat
              value={formatDate(data.performance.last_used_at)}
              label="Dernière utilisation"
              hint={`Score global ${data.performance.score}/100`}
            />
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">Performance par script</span>
              <span className="card-hint">
                Scripts du modèle et globaux utilisés pour ce modèle
              </span>
            </div>
            {usedScripts.length ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>Script</th>
                    <th>Catégorie</th>
                    <th className="num">Usage</th>
                    <th className="num">Conversion</th>
                    <th className="num">Revenu</th>
                    <th className="num">Dernière</th>
                    <th style={{ width: 120 }}>Score</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {usedScripts
                    .slice()
                    .sort((a, b) => b.performance_score - a.performance_score)
                    .map((script) => (
                      <tr key={script.id}>
                        <td>{script.name}</td>
                        <td>
                          <Badge>{script.category_label}</Badge>
                        </td>
                        <td className="num nums">{script.usage_count}</td>
                        <td className="num nums">{Math.round(script.conversion_rate * 100)} %</td>
                        <td className="num nums">{formatMoney(script.revenue_cents)}</td>
                        <td className="num faint">{formatDate(script.last_used_at)}</td>
                        <td>
                          <div className="row">
                            <Meter value={script.performance_score / 100} tone="success" />
                            <span className="faint nums">{script.performance_score}</span>
                          </div>
                        </td>
                        <td>
                          <button className="btn ghost sm" onClick={() => setLogging(script)}>
                            Log
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <Empty
                title="Aucune donnée d’usage"
                hint="Les statistiques se remplissent dès qu’un script est copié depuis la bibliothèque."
              />
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head">
              <span className="card-title">Enregistrer une conversion</span>
              <span className="card-hint">Après un achat déclenché par un script</span>
            </div>
            <div className="row wrap">
              {(scripts.data ?? []).slice(0, 12).map((script) => (
                <button key={script.id} className="chip" onClick={() => setLogging(script)}>
                  {script.name}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {logging ? (
        <LogUsageModal
          script={logging}
          onClose={() => setLogging(null)}
          onSaved={() => {
            setLogging(null);
            scripts.reload();
            model.reload();
            toast('Utilisation enregistrée');
          }}
        />
      ) : null}
    </div>
  );
}

/** Saisie manuelle d'une conversion : ce qui rend les statistiques réelles. */
function LogUsageModal({
  script,
  onClose,
  onSaved,
}: {
  script: Script;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [converted, setConverted] = useState(true);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.recordScriptUsage(script.id, {
        converted,
        revenue_cents: Math.round((Number(amount.replace(',', '.')) || 0) * 100),
        note,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Utilisation — ${script.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="faint">Alimente le score de performance du script et du modèle.</span>
          <div className="btn-row">
            <button className="btn ghost" onClick={onClose}>
              Annuler
            </button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : null} Enregistrer
            </button>
          </div>
        </>
      }
    >
      <label className="checkbox" style={{ marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={converted}
          onChange={(event) => setConverted(event.target.checked)}
        />
        A débouché sur un achat
      </label>
      <Field label="Montant (€)">
        <input
          type="text"
          value={amount}
          placeholder="15"
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label="Note">
        <input type="text" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </Modal>
  );
}

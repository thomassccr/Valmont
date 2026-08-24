import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '../../../shared/scripts';
import type { CreatorInput } from '../../../shared/types';
import { api } from '../api';
import ModelProfileForm, { BLANK_MODEL } from '../components/ModelProfileForm';
import {
  Avatar,
  Badge,
  Empty,
  Meter,
  Modal,
  Spinner,
  StarButton,
  useAsync,
  useToast,
} from '../components/ui';

export default function Models({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const models = useAsync(() => api.models(), []);
  const [creating, setCreating] = useState<CreatorInput | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!creating?.name.trim()) {
      toast('Le nom est obligatoire', true);
      return;
    }
    setSaving(true);
    try {
      const model = await api.createCreator(creating);
      toast('Modèle créé');
      setCreating(null);
      models.reload();
      onChanged?.();
      navigate(`/models/${model.id}`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Création impossible', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-enter">
      <div className="toolbar">
        <div className="search faint">
          Chaque modèle possède son profil, sa bibliothèque de scripts et ses statistiques.
        </div>
        <button className="btn primary" onClick={() => setCreating({ ...BLANK_MODEL })}>
          + Add Model
        </button>
      </div>

      {models.loading ? <Spinner /> : null}
      {models.data && !models.data.length ? (
        <Empty title="Aucun modèle" hint="Crée un premier modèle pour commencer." />
      ) : null}

      <div className="grid auto">
        {models.data?.map((model) => (
          <div
            className="card interactive"
            key={model.id}
            onClick={() => navigate(`/models/${model.id}`)}
          >
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Avatar name={model.name} url={model.avatar_url} color={model.accent_color} size="lg" />
              <div className="grow" style={{ marginLeft: 4 }}>
                <div className="row">
                  <strong style={{ fontSize: 15 }}>{model.name}</strong>
                  {model.age ? <span className="faint">{model.age} ans</span> : null}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 3 }}>
                  <span className={`status-dot${model.archived ? ' off' : ''}`} />
                  <span className="faint">{model.archived ? 'Inactive' : 'Active'}</span>
                  <span className="faint">· {model.script_count} scripts</span>
                </div>
              </div>
              <StarButton
                on={model.is_favorite}
                onToggle={async () => {
                  await api.toggleFavorite('model', model.id);
                  models.reload();
                  onChanged?.();
                }}
              />
            </div>

            <p className="faint" style={{ marginTop: 12, minHeight: 32 }}>
              {model.tone || model.personality || 'Profil à compléter'}
            </p>

            <div className="row" style={{ gap: 10, marginTop: 8 }}>
              <div className="grow">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="faint">Performance</span>
                  <span className="faint nums">{model.performance.score}/100</span>
                </div>
                <Meter value={model.performance.score / 100} />
              </div>
              {model.performance.revenue_cents ? (
                <Badge tone="success">{formatMoney(model.performance.revenue_cents)}</Badge>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {creating ? (
        <Modal
          title="Nouveau modèle"
          onClose={() => setCreating(null)}
          footer={
            <>
              <span className="faint">
                Le profil complet se remplit ensuite dans l’onglet Profile.
              </span>
              <div className="btn-row">
                <button className="btn ghost" onClick={() => setCreating(null)}>
                  Annuler
                </button>
                <button className="btn primary" onClick={create} disabled={saving}>
                  {saving ? <Spinner /> : null} Créer le modèle
                </button>
              </div>
            </>
          }
        >
          <ModelProfileForm
            compact
            draft={creating}
            onChange={(partial) => setCreating((current) => ({ ...current!, ...partial }))}
          />
        </Modal>
      ) : null}
    </div>
  );
}

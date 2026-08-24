import { useState } from 'react';
import { SCENARIO_CATEGORY_LABELS } from '../../../shared/scenarios';
import type { Scenario, ScenarioCategory, ScenarioInput } from '../../../shared/types';
import { api } from '../api';
import { Badge, Empty, Field, Modal, Spinner, TagInput, useAsync, useToast } from '../components/ui';

const BLANK: ScenarioInput = {
  key: '',
  name: '',
  category: 'custom',
  description: '',
  goal: '',
  beats: [],
  do_list: [],
  dont_list: [],
  suggested_familiarity: null,
};

const toInput = (scenario: Scenario): ScenarioInput => ({
  key: scenario.key,
  name: scenario.name,
  category: scenario.category,
  description: scenario.description,
  goal: scenario.goal,
  beats: scenario.beats,
  do_list: scenario.do_list,
  dont_list: scenario.dont_list,
  suggested_familiarity: scenario.suggested_familiarity,
});

export default function Scenarios() {
  const toast = useToast();
  const scenarios = useAsync(() => api.scenarios(), []);
  const [editing, setEditing] = useState<{
    id: string | null;
    system: boolean;
    draft: ScenarioInput;
  } | null>(null);

  const patch = (partial: Partial<ScenarioInput>) =>
    setEditing((current) =>
      current ? { ...current, draft: { ...current.draft, ...partial } } : current,
    );

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await api.updateScenario(editing.id, editing.draft);
      else await api.createScenario(editing.draft);
      toast('Scénario enregistré');
      setEditing(null);
      scenarios.reload();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Enregistrement impossible', true);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Supprimer ce scénario ?')) return;
    try {
      await api.deleteScenario(id);
      toast('Scénario supprimé');
      setEditing(null);
      scenarios.reload();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Suppression impossible', true);
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="search faint">
          Les scénarios structurent le message : étapes attendues, à faire, à éviter.
        </div>
        <button
          className="btn primary"
          onClick={() => setEditing({ id: null, system: false, draft: BLANK })}
        >
          + Nouveau scénario
        </button>
      </div>

      {scenarios.loading ? <Spinner /> : null}
      {scenarios.data && !scenarios.data.scenarios.length ? <Empty title="Aucun scénario" /> : null}

      <div className="grid cols-2">
        {scenarios.data?.scenarios.map((scenario) => (
          <div
            className="card"
            key={scenario.id}
            style={{ cursor: 'pointer' }}
            onClick={() =>
              setEditing({ id: scenario.id, system: scenario.is_system, draft: toInput(scenario) })
            }
          >
            <div className="card-head">
              <span className="card-title">{scenario.name}</span>
              <Badge tone={scenario.is_system ? 'accent' : 'default'}>
                {SCENARIO_CATEGORY_LABELS[scenario.category]}
              </Badge>
            </div>
            <p className="faint" style={{ marginBottom: 10 }}>
              {scenario.description}
            </p>
            <div className="muted" style={{ fontSize: 12.5 }}>
              <strong>But :</strong> {scenario.goal}
            </div>
            <div className="row wrap" style={{ marginTop: 10, gap: 5 }}>
              {scenario.beats.map((beat, index) => (
                <Badge key={index}>{beat}</Badge>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing ? (
        <Modal
          title={editing.id ? `Scénario — ${editing.draft.name}` : 'Nouveau scénario'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <div>
                {editing.id && !editing.system ? (
                  <button className="btn danger" onClick={() => remove(editing.id!)}>
                    Supprimer
                  </button>
                ) : editing.system ? (
                  <span className="faint">Scénario livré avec l’outil — modifiable, non supprimable.</span>
                ) : null}
              </div>
              <div className="btn-row">
                <button className="btn ghost" onClick={() => setEditing(null)}>
                  Annuler
                </button>
                <button className="btn primary" onClick={save}>
                  Enregistrer
                </button>
              </div>
            </>
          }
        >
          <div className="split">
            <Field label="Nom">
              <input
                type="text"
                value={editing.draft.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </Field>
            <Field label="Clé technique" hint="Identifiant stable, non modifiable après création.">
              <input
                type="text"
                value={editing.draft.key}
                disabled={Boolean(editing.id)}
                placeholder="relance_48h"
                onChange={(event) => patch({ key: event.target.value })}
              />
            </Field>
          </div>

          <div className="split">
            <Field label="Catégorie">
              <select
                value={editing.draft.category}
                onChange={(event) => patch({ category: event.target.value as ScenarioCategory })}
              >
                {Object.entries(SCENARIO_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Familiarité suggérée">
              <select
                value={editing.draft.suggested_familiarity ?? ''}
                onChange={(event) =>
                  patch({ suggested_familiarity: (event.target.value || null) as never })
                }
              >
                <option value="">Aucune</option>
                <option value="nouveau">Nouvel abonné</option>
                <option value="occasionnel">Occasionnel</option>
                <option value="regulier">Régulier</option>
                <option value="fidele">Fidèle</option>
              </select>
            </Field>
          </div>

          <Field label="Description">
            <textarea
              rows={2}
              value={editing.draft.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>

          <Field label="But de l’échange">
            <input
              type="text"
              value={editing.draft.goal}
              onChange={(event) => patch({ goal: event.target.value })}
            />
          </Field>

          <Field label="Structure attendue du message" hint="Une étape par entrée, dans l’ordre.">
            <TagInput values={editing.draft.beats} onChange={(beats) => patch({ beats })} />
          </Field>

          <div className="split">
            <Field label="À faire">
              <TagInput values={editing.draft.do_list} onChange={(do_list) => patch({ do_list })} />
            </Field>
            <Field label="À ne pas faire">
              <TagInput
                values={editing.draft.dont_list}
                onChange={(dont_list) => patch({ dont_list })}
              />
            </Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

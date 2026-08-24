import { useState } from 'react';
import { DEFAULT_GUARDRAILS, DEFAULT_LEXICON } from '../../../shared/defaults';
import type { Creator, CreatorInput } from '../../../shared/types';
import { api } from '../api';
import { Empty, Field, Modal, Spinner, TagInput, useAsync, useToast } from '../components/ui';
import { useAuth } from '../auth';

const BLANK: CreatorInput = {
  name: '',
  handle: '',
  accent_color: '#7c5cff',
  personality: '',
  traits: [],
  tone: '',
  interests: [],
  writing_style: '',
  audience_type: '',
  preferred_topics: [],
  objectives: [],
  lexicon: DEFAULT_LEXICON,
  guardrails: DEFAULT_GUARDRAILS,
  notes: '',
  archived: false,
};

const toInput = (creator: Creator): CreatorInput => ({
  name: creator.name,
  handle: creator.handle,
  accent_color: creator.accent_color,
  personality: creator.personality,
  traits: creator.traits,
  tone: creator.tone,
  interests: creator.interests,
  writing_style: creator.writing_style,
  audience_type: creator.audience_type,
  preferred_topics: creator.preferred_topics,
  objectives: creator.objectives,
  lexicon: creator.lexicon,
  guardrails: creator.guardrails,
  notes: creator.notes,
  archived: creator.archived,
});

export default function Creators() {
  const { user } = useAuth();
  const toast = useToast();
  const creators = useAsync(() => api.creators(), []);
  const [editing, setEditing] = useState<{ id: string | null; draft: CreatorInput } | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (partial: Partial<CreatorInput>) =>
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...partial } } : current));

  const patchLexicon = (partial: Partial<CreatorInput['lexicon']>) =>
    patch({ lexicon: { ...editing!.draft.lexicon, ...partial } });

  const patchGuardrails = (partial: Partial<CreatorInput['guardrails']>) =>
    patch({ guardrails: { ...editing!.draft.guardrails, ...partial } });

  const save = async () => {
    if (!editing) return;
    if (!editing.draft.name.trim()) {
      toast('Le nom est obligatoire', true);
      return;
    }
    setSaving(true);
    try {
      if (editing.id) await api.updateCreator(editing.id, editing.draft);
      else await api.createCreator(editing.draft);
      toast('Fiche enregistrée');
      setEditing(null);
      creators.reload();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Enregistrement impossible', true);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (creator: Creator) => {
    if (!confirm(`Supprimer définitivement la fiche « ${creator.name} » ?`)) return;
    try {
      await api.deleteCreator(creator.id);
      toast('Fiche supprimée');
      setEditing(null);
      creators.reload();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Suppression impossible', true);
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="search" />
        <button className="btn primary" onClick={() => setEditing({ id: null, draft: BLANK })}>
          + Nouveau créateur
        </button>
      </div>

      {creators.loading ? <Spinner /> : null}
      {creators.data && !creators.data.length ? (
        <Empty title="Aucun créateur" hint="Crée une première fiche pour utiliser la console." />
      ) : null}

      {creators.data?.map((creator) => (
        <div
          className="list-row"
          key={creator.id}
          onClick={() => setEditing({ id: creator.id, draft: toInput(creator) })}
        >
          <span className="dot" style={{ background: creator.accent_color }} />
          <div className="grow">
            <div className="list-title">
              {creator.name} <span className="faint">{creator.handle}</span>
            </div>
            <div className="list-sub">
              {creator.tone || 'Ton non défini'} · {creator.traits.join(', ') || 'aucun trait'}
            </div>
          </div>
          <span className="faint">{creator.lexicon.typical_message_length}</span>
        </div>
      ))}

      {editing ? (
        <Modal
          wide
          title={editing.id ? `Fiche — ${editing.draft.name}` : 'Nouvelle fiche créateur'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <div>
                {editing.id && user?.role === 'admin' ? (
                  <button
                    className="btn danger"
                    onClick={() => {
                      const target = creators.data?.find((item) => item.id === editing.id);
                      if (target) void remove(target);
                    }}
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>
              <div className="btn-row">
                <button className="btn ghost" onClick={() => setEditing(null)}>
                  Annuler
                </button>
                <button className="btn primary" onClick={save} disabled={saving}>
                  {saving ? <Spinner /> : null} Enregistrer
                </button>
              </div>
            </>
          }
        >
          <div className="section-title">Identité</div>
          <div className="split">
            <Field label="Nom affiché">
              <input
                type="text"
                value={editing.draft.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </Field>
            <Field label="Handle / plateforme">
              <input
                type="text"
                value={editing.draft.handle}
                placeholder="@pseudo"
                onChange={(event) => patch({ handle: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Personnalité" hint="Comment ce créateur se comporte en conversation.">
            <textarea
              rows={3}
              value={editing.draft.personality}
              onChange={(event) => patch({ personality: event.target.value })}
            />
          </Field>

          <div className="split">
            <Field label="Traits de caractère">
              <TagInput values={editing.draft.traits} onChange={(traits) => patch({ traits })} />
            </Field>
            <Field label="Centres d’intérêt">
              <TagInput
                values={editing.draft.interests}
                onChange={(interests) => patch({ interests })}
              />
            </Field>
          </div>

          <div className="split">
            <Field label="Ton de communication">
              <input
                type="text"
                value={editing.draft.tone}
                placeholder="chaleureux, complice, jamais vulgaire"
                onChange={(event) => patch({ tone: event.target.value })}
              />
            </Field>
            <Field label="Type d’audience">
              <input
                type="text"
                value={editing.draft.audience_type}
                placeholder="hommes 30-45, francophones"
                onChange={(event) => patch({ audience_type: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Style d’écriture">
            <textarea
              rows={2}
              value={editing.draft.writing_style}
              placeholder="phrases courtes, minuscules, peu de ponctuation"
              onChange={(event) => patch({ writing_style: event.target.value })}
            />
          </Field>

          <div className="section-title">Sujets & objectifs</div>
          <div className="split">
            <Field label="Sujets à privilégier">
              <TagInput
                values={editing.draft.preferred_topics}
                onChange={(preferred_topics) => patch({ preferred_topics })}
              />
            </Field>
            <Field label="Sujets à éviter" hint="Bloquant : une suggestion qui les aborde est signalée.">
              <TagInput
                values={editing.draft.guardrails.banned_topics}
                onChange={(banned_topics) => patchGuardrails({ banned_topics })}
              />
            </Field>
          </div>

          <Field label="Objectifs de conversation habituels">
            <TagInput
              values={editing.draft.objectives}
              onChange={(objectives) => patch({ objectives })}
            />
          </Field>

          <div className="section-title">Vocabulaire & forme</div>
          <div className="split">
            <Field label="Mots à privilégier">
              <TagInput
                values={editing.draft.lexicon.preferred_words}
                onChange={(preferred_words) => patchLexicon({ preferred_words })}
              />
            </Field>
            <Field label="Mots interdits" hint="Bloquant à la validation.">
              <TagInput
                values={editing.draft.lexicon.banned_words}
                onChange={(banned_words) => patchLexicon({ banned_words })}
              />
            </Field>
          </div>

          <div className="split">
            <Field label="Expressions signature">
              <TagInput
                values={editing.draft.lexicon.signature_phrases}
                onChange={(signature_phrases) => patchLexicon({ signature_phrases })}
              />
            </Field>
            <Field label="Emojis habituels">
              <TagInput
                values={editing.draft.lexicon.favorite_emojis}
                onChange={(favorite_emojis) => patchLexicon({ favorite_emojis })}
              />
            </Field>
          </div>

          <div className="grid cols-4">
            <Field label="Emojis">
              <select
                value={editing.draft.lexicon.emoji_style}
                onChange={(event) => patchLexicon({ emoji_style: event.target.value as never })}
              >
                <option value="aucun">Aucun</option>
                <option value="rare">Rare</option>
                <option value="modere">Modéré</option>
                <option value="intensif">Intensif</option>
              </select>
            </Field>
            <Field label="Ponctuation">
              <select
                value={editing.draft.lexicon.punctuation}
                onChange={(event) => patchLexicon({ punctuation: event.target.value as never })}
              >
                <option value="sobre">Sobre</option>
                <option value="standard">Standard</option>
                <option value="expressive">Expressive</option>
              </select>
            </Field>
            <Field label="Casse">
              <select
                value={editing.draft.lexicon.capitalization}
                onChange={(event) => patchLexicon({ capitalization: event.target.value as never })}
              >
                <option value="standard">Standard</option>
                <option value="minuscules">Minuscules</option>
              </select>
            </Field>
            <Field label="Longueur">
              <select
                value={editing.draft.lexicon.typical_message_length}
                onChange={(event) =>
                  patchLexicon({ typical_message_length: event.target.value as never })
                }
              >
                <option value="court">Court</option>
                <option value="moyen">Moyen</option>
                <option value="long">Long</option>
              </select>
            </Field>
          </div>

          <div className="section-title">Garde-fous</div>
          <Field label="Règles propres à ce créateur" hint="Injectées telles quelles dans le prompt système.">
            <TagInput
              values={editing.draft.guardrails.hard_rules}
              onChange={(hard_rules) => patchGuardrails({ hard_rules })}
              placeholder="ex. ne jamais donner de ville"
            />
          </Field>

          <div className="grid cols-3">
            <Field label="Longueur max (caractères)">
              <input
                type="number"
                min={80}
                max={2000}
                value={editing.draft.guardrails.max_message_chars}
                onChange={(event) =>
                  patchGuardrails({ max_message_chars: Number(event.target.value) })
                }
              />
            </Field>
            <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 18 }}>
              <input
                type="checkbox"
                checked={editing.draft.guardrails.no_promises}
                onChange={(event) => patchGuardrails({ no_promises: event.target.checked })}
              />
              Aucune promesse
            </label>
            <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 18 }}>
              <input
                type="checkbox"
                checked={editing.draft.guardrails.no_personal_facts}
                onChange={(event) => patchGuardrails({ no_personal_facts: event.target.checked })}
              />
              Aucun fait personnel inventé
            </label>
          </div>

          <Field label="Notes internes">
            <textarea
              rows={2}
              value={editing.draft.notes}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>

          <div className="split">
            <Field label="Couleur">
              <input
                type="text"
                value={editing.draft.accent_color}
                onChange={(event) => patch({ accent_color: event.target.value })}
              />
            </Field>
            <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 18 }}>
              <input
                type="checkbox"
                checked={editing.draft.archived}
                onChange={(event) => patch({ archived: event.target.checked })}
              />
              Archiver (masqué dans la console)
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

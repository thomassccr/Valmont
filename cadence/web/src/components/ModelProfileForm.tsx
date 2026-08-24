import { DEFAULT_GUARDRAILS, DEFAULT_LEXICON } from '../../../shared/defaults';
import type { Creator, CreatorInput } from '../../../shared/types';
import { Field, TagInput } from './ui';

export const BLANK_MODEL: CreatorInput = {
  name: '',
  handle: '',
  accent_color: '#7b6cf6',
  avatar_url: '',
  age: 0,
  personality: '',
  traits: [],
  tone: '',
  interests: [],
  writing_style: '',
  audience_type: '',
  preferred_topics: [],
  objectives: [],
  content_style: '',
  custom_instructions: '',
  lexicon: DEFAULT_LEXICON,
  guardrails: DEFAULT_GUARDRAILS,
  notes: '',
  archived: false,
};

export const toModelInput = (model: Creator): CreatorInput => ({
  name: model.name,
  handle: model.handle,
  accent_color: model.accent_color,
  avatar_url: model.avatar_url,
  age: model.age,
  personality: model.personality,
  traits: model.traits,
  tone: model.tone,
  interests: model.interests,
  writing_style: model.writing_style,
  audience_type: model.audience_type,
  preferred_topics: model.preferred_topics,
  objectives: model.objectives,
  content_style: model.content_style,
  custom_instructions: model.custom_instructions,
  lexicon: model.lexicon,
  guardrails: model.guardrails,
  notes: model.notes,
  archived: model.archived,
});

/**
 * Formulaire de profil d'un modèle.
 * Utilisé à l'identique dans la modale de création et dans l'onglet Profile :
 * tout champ ajouté ici alimente automatiquement les deux, et le prompt système.
 */
export default function ModelProfileForm({
  draft,
  onChange,
  compact = false,
}: {
  draft: CreatorInput;
  onChange: (partial: Partial<CreatorInput>) => void;
  /** Mode création : seuls les champs essentiels sont affichés. */
  compact?: boolean;
}) {
  const patchLexicon = (partial: Partial<CreatorInput['lexicon']>) =>
    onChange({ lexicon: { ...draft.lexicon, ...partial } });
  const patchGuardrails = (partial: Partial<CreatorInput['guardrails']>) =>
    onChange({ guardrails: { ...draft.guardrails, ...partial } });

  return (
    <>
      <div className="section-title">Identité</div>
      <div className="split">
        <Field label="Name">
          <input
            type="text"
            value={draft.name}
            placeholder="Emma"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>
        <div className="split" style={{ gap: 10 }}>
          <Field label="Age">
            <input
              type="number"
              min={0}
              max={120}
              value={draft.age || ''}
              placeholder="24"
              onChange={(event) => onChange({ age: Number(event.target.value) || 0 })}
            />
          </Field>
          <Field label="Handle">
            <input
              type="text"
              value={draft.handle}
              placeholder="@emma"
              onChange={(event) => onChange({ handle: event.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="split">
        <Field label="Avatar (URL)" hint="Laisser vide pour afficher les initiales.">
          <input
            type="text"
            value={draft.avatar_url}
            placeholder="https://…"
            onChange={(event) => onChange({ avatar_url: event.target.value })}
          />
        </Field>
        <div className="split" style={{ gap: 10 }}>
          <Field label="Couleur">
            <input
              type="text"
              value={draft.accent_color}
              onChange={(event) => onChange({ accent_color: event.target.value })}
            />
          </Field>
          <Field label="Statut">
            <select
              value={draft.archived ? 'inactive' : 'active'}
              onChange={(event) => onChange({ archived: event.target.value === 'inactive' })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>
      </div>

      <Field label="Personality">
        <textarea
          rows={3}
          value={draft.personality}
          placeholder="Douce et taquine, curieuse des gens, pose beaucoup de questions."
          onChange={(event) => onChange({ personality: event.target.value })}
        />
      </Field>

      <div className="split">
        <Field label="Tone of voice">
          <input
            type="text"
            value={draft.tone}
            placeholder="Chaleureux, complice, jamais vulgaire"
            onChange={(event) => onChange({ tone: event.target.value })}
          />
        </Field>
        <Field label="Target audience">
          <input
            type="text"
            value={draft.audience_type}
            placeholder="Hommes 30-45, francophones"
            onChange={(event) => onChange({ audience_type: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Writing style">
        <textarea
          rows={2}
          value={draft.writing_style}
          placeholder="Phrases courtes, minuscules, peu de ponctuation"
          onChange={(event) => onChange({ writing_style: event.target.value })}
        />
      </Field>

      <div className="split">
        <Field label="Traits">
          <TagInput values={draft.traits} onChange={(traits) => onChange({ traits })} />
        </Field>
        <Field label="Interests">
          <TagInput values={draft.interests} onChange={(interests) => onChange({ interests })} />
        </Field>
      </div>

      <Field label="Content style" hint="Type de contenu produit : photos, vidéos, customs…">
        <input
          type="text"
          value={draft.content_style}
          placeholder="Photos et vidéos douces, customs sur demande"
          onChange={(event) => onChange({ content_style: event.target.value })}
        />
      </Field>

      {compact ? null : (
        <>
          <div className="section-title">Sujets & objectifs</div>
          <div className="split">
            <Field label="Things to mention">
              <TagInput
                values={draft.preferred_topics}
                onChange={(preferred_topics) => onChange({ preferred_topics })}
              />
            </Field>
            <Field label="Things to avoid" hint="Bloquant : une suggestion qui les aborde est signalée.">
              <TagInput
                values={draft.guardrails.banned_topics}
                onChange={(banned_topics) => patchGuardrails({ banned_topics })}
              />
            </Field>
          </div>

          <Field label="Objectifs de conversation habituels">
            <TagInput values={draft.objectives} onChange={(objectives) => onChange({ objectives })} />
          </Field>

          <div className="section-title">Vocabulary & forme</div>
          <div className="split">
            <Field label="Mots à privilégier">
              <TagInput
                values={draft.lexicon.preferred_words}
                onChange={(preferred_words) => patchLexicon({ preferred_words })}
              />
            </Field>
            <Field label="Mots interdits" hint="Bloquant à la validation.">
              <TagInput
                values={draft.lexicon.banned_words}
                onChange={(banned_words) => patchLexicon({ banned_words })}
              />
            </Field>
          </div>

          <div className="split">
            <Field label="Expressions signature">
              <TagInput
                values={draft.lexicon.signature_phrases}
                onChange={(signature_phrases) => patchLexicon({ signature_phrases })}
              />
            </Field>
            <Field label="Emojis habituels">
              <TagInput
                values={draft.lexicon.favorite_emojis}
                onChange={(favorite_emojis) => patchLexicon({ favorite_emojis })}
              />
            </Field>
          </div>

          <div className="grid cols-4">
            <Field label="Emojis">
              <select
                value={draft.lexicon.emoji_style}
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
                value={draft.lexicon.punctuation}
                onChange={(event) => patchLexicon({ punctuation: event.target.value as never })}
              >
                <option value="sobre">Sobre</option>
                <option value="standard">Standard</option>
                <option value="expressive">Expressive</option>
              </select>
            </Field>
            <Field label="Casse">
              <select
                value={draft.lexicon.capitalization}
                onChange={(event) => patchLexicon({ capitalization: event.target.value as never })}
              >
                <option value="standard">Standard</option>
                <option value="minuscules">Minuscules</option>
              </select>
            </Field>
            <Field label="Longueur">
              <select
                value={draft.lexicon.typical_message_length}
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

          <div className="section-title">Custom instructions & garde-fous</div>
          <Field
            label="Custom instructions"
            hint="Injectées telles quelles dans le prompt système de ce modèle."
          >
            <textarea
              rows={3}
              value={draft.custom_instructions}
              placeholder="Toujours finir par une question. Ne jamais parler de rendez-vous."
              onChange={(event) => onChange({ custom_instructions: event.target.value })}
            />
          </Field>

          <Field label="Règles strictes">
            <TagInput
              values={draft.guardrails.hard_rules}
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
                value={draft.guardrails.max_message_chars}
                onChange={(event) =>
                  patchGuardrails({ max_message_chars: Number(event.target.value) })
                }
              />
            </Field>
            <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 20 }}>
              <input
                type="checkbox"
                checked={draft.guardrails.no_promises}
                onChange={(event) => patchGuardrails({ no_promises: event.target.checked })}
              />
              Aucune promesse
            </label>
            <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 20 }}>
              <input
                type="checkbox"
                checked={draft.guardrails.no_personal_facts}
                onChange={(event) => patchGuardrails({ no_personal_facts: event.target.checked })}
              />
              Aucun fait personnel inventé
            </label>
          </div>

          <Field label="Notes internes">
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
            />
          </Field>
        </>
      )}
    </>
  );
}

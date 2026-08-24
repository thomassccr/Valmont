import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FAMILIARITY_LABELS } from '../../../shared/scenarios';
import type {
  Familiarity,
  GenerationRequest,
  GenerationResult,
  ScriptInput,
  Suggestion,
  SuggestionWarning,
} from '../../../shared/types';
import { api } from '../api';
import ScriptEditor from './ScriptEditor';
import { Badge, CopyButton, Empty, Field, Spinner, StarButton, useAsync, useToast } from './ui';

const STORAGE_KEY = 'cadence:generator:draft';

const EMPTY: GenerationRequest = {
  creator_id: '',
  scenario_id: null,
  template_id: null,
  subscriber_alias: '',
  subscriber_message: '',
  conversation_history: '',
  conversation_context: '',
  objective: '',
  familiarity: 'nouveau',
  tone_override: '',
  extra_instructions: '',
  price: '',
  content_type: '',
  variant_count: 3,
};

const loadDraft = (): GenerationRequest => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
};

export function WarningLine({ warning }: { warning: SuggestionWarning }) {
  const tone = warning.severity === 'block' ? 'block' : warning.severity === 'warn' ? 'warn' : 'info';
  return (
    <div className={`alert ${tone}`} style={{ marginTop: 8 }}>
      <span>{warning.severity === 'block' ? '⛔' : warning.severity === 'warn' ? '⚠' : 'ℹ'}</span>
      <span>{warning.message}</span>
    </div>
  );
}

/**
 * Console de génération.
 * `lockedModelId` : utilisée dans l'onglet Prompt Generator d'un modèle, où le
 * modèle est imposé ; sans lui, l'opérateur choisit le modèle dans la liste.
 */
export default function GeneratorPanel({
  lockedModelId,
  embedded,
}: {
  lockedModelId?: string;
  /** Intégrée dans un onglet : la page porte le défilement. */
  embedded?: boolean;
}) {
  const toast = useToast();
  const location = useLocation();
  const prefill = (location.state as { prefill?: Partial<GenerationRequest> } | null)?.prefill;

  const models = useAsync(() => api.models(), []);
  const scenarios = useAsync(() => api.scenarios(), []);
  const templates = useAsync(() => api.templates(), []);
  const categories = useAsync(() => api.scriptCategories(), []);

  const [form, setForm] = useState<GenerationRequest>(() => ({
    ...loadDraft(),
    ...prefill,
    ...(lockedModelId ? { creator_id: lockedModelId } : {}),
  }));
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [used, setUsed] = useState<string | null>(null);
  const [favorited, setFavorited] = useState(false);
  const [saveAs, setSaveAs] = useState<Partial<ScriptInput> | null>(null);

  const set = <K extends keyof GenerationRequest>(key: K, value: GenerationRequest[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...form, subscriber_message: '' }));
  }, [form]);

  useEffect(() => {
    if (lockedModelId) set('creator_id', lockedModelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedModelId]);

  useEffect(() => {
    if (!lockedModelId && !form.creator_id && models.data?.length) {
      set('creator_id', models.data[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.data]);

  const scenario = useMemo(
    () => scenarios.data?.scenarios.find((item) => item.id === form.scenario_id) ?? null,
    [scenarios.data, form.scenario_id],
  );

  const applyScenario = (scenarioId: string) => {
    const picked = scenarios.data?.scenarios.find((item) => item.id === scenarioId) ?? null;
    setForm((current) => ({
      ...current,
      scenario_id: scenarioId || null,
      objective: current.objective || picked?.goal || '',
      familiarity: picked?.suggested_familiarity ?? current.familiarity,
    }));
  };

  const generate = async () => {
    if (!form.creator_id) {
      toast('Sélectionne un modèle', true);
      return;
    }
    setBusy(true);
    setError(null);
    setUsed(null);
    setFavorited(false);
    try {
      const generated = await api.generate({
        ...form,
        subscriber_alias: form.subscriber_alias || undefined,
        tone_override: form.tone_override || undefined,
        extra_instructions: form.extra_instructions || undefined,
        price: form.price || undefined,
        content_type: form.content_type || undefined,
      });
      setResult(generated);
      if (!generated.suggestions.length) toast('Génération bloquée : voir les avertissements', true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Génération impossible');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void generate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const markUsed = async (suggestionId: string) => {
    setUsed(suggestionId);
    if (result) await api.feedback(result.id, { used_suggestion_id: suggestionId }).catch(() => {});
  };

  const toggleFavorite = async () => {
    if (!result) return;
    const { is_favorite } = await api.toggleFavorite('generation', result.id);
    setFavorited(is_favorite);
  };

  const saveAsScript = (suggestion: Suggestion) => {
    setSaveAs({
      model_id: form.creator_id,
      name: suggestion.label,
      content: suggestion.text,
      objective: form.objective,
      tone: form.tone_override || '',
      trigger: scenario?.name ?? '',
      category_key: categories.data?.[0]?.key ?? 'first_message',
      description: `Généré depuis la console le ${new Date().toLocaleDateString('fr-FR')}`,
      tags: [],
      variables: [],
    });
  };

  const currentModel = models.data?.find((model) => model.id === form.creator_id);

  return (
    <div className={`console${embedded ? ' embedded' : ''}`}>
      {/* ─── Formulaire ─── */}
      <div className="console-form">
        <div className="section-title">Contexte</div>

        {lockedModelId ? (
          <Field label="Model">
            <input type="text" value={currentModel?.name ?? '…'} disabled />
          </Field>
        ) : (
          <Field label="Model">
            <select value={form.creator_id} onChange={(event) => set('creator_id', event.target.value)}>
              <option value="">— Sélectionner —</option>
              {models.data?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="split" style={{ gap: 10 }}>
          <Field label="Situation">
            <select value={form.scenario_id ?? ''} onChange={(event) => applyScenario(event.target.value)}>
              <option value="">Libre</option>
              {scenarios.data?.scenarios.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Familiarité">
            <select
              value={form.familiarity}
              onChange={(event) => set('familiarity', event.target.value as Familiarity)}
            >
              {Object.entries(FAMILIARITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Objective" hint={scenario ? `But du scénario : ${scenario.goal}` : undefined}>
          <input
            type="text"
            value={form.objective}
            placeholder="Re-engage subscriber"
            onChange={(event) => set('objective', event.target.value)}
          />
        </Field>

        <div className="section-title">Conversation</div>

        <Field label="Message reçu">
          <textarea
            rows={3}
            value={form.subscriber_message}
            placeholder="Colle ici le dernier message de l’abonné"
            onChange={(event) => set('subscriber_message', event.target.value)}
          />
        </Field>

        <Field label="Historique récent" hint="Du plus ancien au plus récent.">
          <textarea
            rows={3}
            value={form.conversation_history}
            placeholder={'Abonné : salut\nCréateur : coucou toi'}
            onChange={(event) => set('conversation_history', event.target.value)}
          />
        </Field>

        <Field label="Context" hint="Tout ce que le modèle n’a pas le droit d’inventer va ici.">
          <textarea
            rows={2}
            value={form.conversation_context}
            placeholder="Subscriber has not purchased"
            onChange={(event) => set('conversation_context', event.target.value)}
          />
        </Field>

        <div className="section-title">Réglages</div>

        <div className="split" style={{ gap: 10 }}>
          <Field label="Subscriber">
            <input
              type="text"
              value={form.subscriber_alias ?? ''}
              placeholder="marc_92"
              onChange={(event) => set('subscriber_alias', event.target.value)}
            />
          </Field>
          <Field label="Variantes">
            <select
              value={form.variant_count}
              onChange={(event) => set('variant_count', Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="split" style={{ gap: 10 }}>
          <Field label="Prix" hint="Alimente {{price}}.">
            <input
              type="text"
              value={form.price ?? ''}
              placeholder="15 €"
              onChange={(event) => set('price', event.target.value)}
            />
          </Field>
          <Field label="Type de contenu" hint="Alimente {{content_type}}.">
            <input
              type="text"
              value={form.content_type ?? ''}
              placeholder="vidéo custom"
              onChange={(event) => set('content_type', event.target.value)}
            />
          </Field>
        </div>

        <Field label="Tone (surcharge)" hint="Vide = ton du profil du modèle.">
          <input
            type="text"
            value={form.tone_override ?? ''}
            placeholder="Playful"
            onChange={(event) => set('tone_override', event.target.value)}
          />
        </Field>

        <Field label="Template de prompt">
          <select
            value={form.template_id ?? ''}
            onChange={(event) => set('template_id', event.target.value || null)}
          >
            <option value="">Standard</option>
            {templates.data?.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Additional instructions">
          <textarea
            rows={2}
            value={form.extra_instructions ?? ''}
            placeholder="Rester très court, ne pas parler du live"
            onChange={(event) => set('extra_instructions', event.target.value)}
          />
        </Field>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={generate} disabled={busy}>
            {busy ? <Spinner /> : '✦'} Generate
          </button>
          <kbd>⌘/Ctrl + ↵</kbd>
          <button
            className="btn ghost sm"
            onClick={() => {
              setForm({ ...EMPTY, creator_id: form.creator_id });
              setResult(null);
            }}
          >
            Vider
          </button>
        </div>
      </div>

      {/* ─── Résultats ─── */}
      <div className="console-output">
        {error ? <div className="alert block">{error}</div> : null}

        {!result && !busy && !error ? (
          <Empty
            title="Aucune génération pour l’instant"
            hint="Renseigne le contexte à gauche, puis lance la génération."
          />
        ) : null}

        {busy ? (
          <div className="empty">
            <Spinner />
            <div style={{ marginTop: 10 }}>Rédaction des propositions…</div>
          </div>
        ) : null}

        {result ? (
          <>
            <div className="row wrap" style={{ marginBottom: 12 }}>
              <Badge tone="accent">{result.suggestions.length} proposition(s)</Badge>
              <Badge>{result.provider === 'blocked' ? 'bloqué' : result.model}</Badge>
              <Badge>{result.latency_ms} ms</Badge>
              <StarButton on={favorited} onToggle={toggleFavorite} title="Mettre en favori" />
              <div className="spacer" />
              <button className="btn ghost sm" onClick={() => setShowPrompt((value) => !value)}>
                {showPrompt ? 'Masquer le prompt' : 'Voir le prompt'}
              </button>
              <button className="btn sm" onClick={generate} disabled={busy}>
                ↻ Regenerate
              </button>
            </div>

            {result.warnings.map((warning) => (
              <WarningLine key={warning.code} warning={warning} />
            ))}

            {showPrompt ? (
              <div className="card" style={{ margin: '12px 0' }}>
                <div className="card-head">
                  <span className="card-title">Prompt système</span>
                  <CopyButton text={result.system_prompt} className="btn ghost sm" />
                </div>
                <div className="preview">{result.system_prompt}</div>
                <div className="card-head" style={{ marginTop: 14 }}>
                  <span className="card-title">Prompt utilisateur</span>
                  <CopyButton text={result.user_prompt} className="btn ghost sm" />
                </div>
                <div className="preview">{result.user_prompt}</div>
              </div>
            ) : null}

            <div style={{ marginTop: 14 }}>
              {result.suggestions.map((suggestion, index) => (
                <article
                  className={`suggestion${used === suggestion.id ? ' used' : ''}`}
                  key={suggestion.id}
                >
                  <div className="suggestion-head">
                    <div className="row">
                      <Badge tone="accent">{index + 1}</Badge>
                      <strong>{suggestion.label}</strong>
                    </div>
                    <span className="faint">{suggestion.char_count} car.</span>
                  </div>

                  <div className="suggestion-text">{suggestion.text}</div>

                  {suggestion.warnings.map((warning, position) => (
                    <WarningLine key={`${warning.code}-${position}`} warning={warning} />
                  ))}

                  <div className="suggestion-foot">
                    <span className="suggestion-why">{suggestion.rationale}</span>
                    <div className="btn-row">
                      <button className="btn ghost sm" onClick={() => saveAsScript(suggestion)}>
                        Save as Script
                      </button>
                      <CopyButton
                        text={suggestion.text}
                        label="Copy"
                        className="btn primary sm"
                        onCopied={() => {
                          void markUsed(suggestion.id);
                          toast('Message copié');
                        }}
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {saveAs ? (
        <ScriptEditor
          script={null}
          defaults={saveAs}
          categories={categories.data ?? []}
          models={models.data ?? []}
          onClose={() => setSaveAs(null)}
          onSaved={() => {
            setSaveAs(null);
            toast('Script enregistré dans la bibliothèque');
          }}
        />
      ) : null}
    </div>
  );
}

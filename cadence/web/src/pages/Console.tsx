import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FAMILIARITY_LABELS } from '../../../shared/scenarios';
import type {
  Familiarity,
  GenerationRequest,
  GenerationResult,
  SuggestionWarning,
} from '../../../shared/types';
import { api } from '../api';
import { Badge, CopyButton, Empty, Field, Spinner, useAsync, useToast } from '../components/ui';

const STORAGE_KEY = 'cadence:console:draft';

const EMPTY_FORM: GenerationRequest = {
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
  variant_count: 3,
};

const loadDraft = (): GenerationRequest => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY_FORM, ...JSON.parse(raw) } : EMPTY_FORM;
  } catch {
    return EMPTY_FORM;
  }
};

function WarningLine({ warning }: { warning: SuggestionWarning }) {
  const tone = warning.severity === 'block' ? 'block' : warning.severity === 'warn' ? 'warn' : 'info';
  return (
    <div className={`alert ${tone}`} style={{ marginTop: 8 }}>
      <span>{warning.severity === 'block' ? '⛔' : warning.severity === 'warn' ? '⚠' : 'ℹ'}</span>
      <span>{warning.message}</span>
    </div>
  );
}

export default function Console() {
  const toast = useToast();
  const location = useLocation();
  const prefill = (location.state as { prefill?: Partial<GenerationRequest> } | null)?.prefill;

  const creators = useAsync(() => api.creators(), []);
  const scenarios = useAsync(() => api.scenarios(), []);
  const templates = useAsync(() => api.templates(), []);

  const [form, setForm] = useState<GenerationRequest>(() => ({ ...loadDraft(), ...prefill }));
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [used, setUsed] = useState<string | null>(null);

  const set = <K extends keyof GenerationRequest>(key: K, value: GenerationRequest[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Le créateur sélectionné est mémorisé : l'opérateur enchaîne les conversations.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...form, subscriber_message: '' }));
  }, [form]);

  useEffect(() => {
    if (!form.creator_id && creators.data?.length) set('creator_id', creators.data[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creators.data]);

  const scenario = useMemo(
    () => scenarios.data?.scenarios.find((item) => item.id === form.scenario_id) ?? null,
    [scenarios.data, form.scenario_id],
  );

  // Un scénario propose un objectif et un niveau de familiarité par défaut.
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
      toast('Sélectionne un créateur', true);
      return;
    }
    setBusy(true);
    setError(null);
    setUsed(null);
    try {
      const generated = await api.generate({
        ...form,
        subscriber_alias: form.subscriber_alias || undefined,
        tone_override: form.tone_override || undefined,
        extra_instructions: form.extra_instructions || undefined,
      });
      setResult(generated);
      if (!generated.suggestions.length) {
        toast('Génération bloquée : voir les avertissements', true);
      }
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

  return (
    <div className="console">
      {/* ─────────  Formulaire  ───────── */}
      <div className="console-form">
        <div className="section-title">Contexte</div>

        <Field label="Créateur">
          <select value={form.creator_id} onChange={(event) => set('creator_id', event.target.value)}>
            <option value="">— Sélectionner —</option>
            {creators.data?.map((creator) => (
              <option key={creator.id} value={creator.id}>
                {creator.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="split" style={{ gap: 10 }}>
          <Field label="Scénario">
            <select
              value={form.scenario_id ?? ''}
              onChange={(event) => applyScenario(event.target.value)}
            >
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

        <Field label="Objectif de ce message" hint={scenario ? `But du scénario : ${scenario.goal}` : undefined}>
          <input
            type="text"
            value={form.objective}
            placeholder="ex. faire parler l’abonné de sa semaine"
            onChange={(event) => set('objective', event.target.value)}
          />
        </Field>

        <div className="section-title">Conversation</div>

        <Field label="Message reçu de l’abonné">
          <textarea
            value={form.subscriber_message}
            rows={3}
            placeholder="Colle ici le dernier message reçu"
            onChange={(event) => set('subscriber_message', event.target.value)}
          />
        </Field>

        <Field label="Historique récent" hint="Du plus ancien au plus récent, une ligne par message.">
          <textarea
            value={form.conversation_history}
            rows={4}
            placeholder={'Abonné : salut\nCréateur : coucou toi'}
            onChange={(event) => set('conversation_history', event.target.value)}
          />
        </Field>

        <Field label="Contexte / notes" hint="Tout ce que le modèle n’a pas le droit d’inventer doit figurer ici.">
          <textarea
            value={form.conversation_context}
            rows={2}
            placeholder="ex. a acheté le pack photo hier, a raté le live"
            onChange={(event) => set('conversation_context', event.target.value)}
          />
        </Field>

        <div className="section-title">Réglages</div>

        <div className="split" style={{ gap: 10 }}>
          <Field label="Abonné (alias)">
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

        <Field label="Ton (surcharge ponctuelle)" hint="Vide = ton de la fiche créateur.">
          <input
            type="text"
            value={form.tone_override ?? ''}
            placeholder="ex. plus sobre que d’habitude"
            onChange={(event) => set('tone_override', event.target.value)}
          />
        </Field>

        <Field label="Template de prompt">
          <select
            value={form.template_id ?? ''}
            onChange={(event) => set('template_id', event.target.value || null)}
          >
            <option value="">Standard (console)</option>
            {templates.data?.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Consignes additionnelles">
          <textarea
            value={form.extra_instructions ?? ''}
            rows={2}
            placeholder="ex. rester très court, ne pas parler du live"
            onChange={(event) => set('extra_instructions', event.target.value)}
          />
        </Field>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={generate} disabled={busy}>
            {busy ? <Spinner /> : '✦'} Générer
          </button>
          <kbd>⌘/Ctrl + ↵</kbd>
          <button
            className="btn ghost sm"
            onClick={() => {
              setForm({ ...EMPTY_FORM, creator_id: form.creator_id });
              setResult(null);
            }}
          >
            Vider
          </button>
        </div>
      </div>

      {/* ─────────  Résultats  ───────── */}
      <div className="console-output">
        {error ? <div className="alert block">{error}</div> : null}

        {!result && !busy && !error ? (
          <Empty
            title="Aucune génération pour l’instant"
            hint="Renseigne le message reçu à gauche, puis lance la génération."
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
              <button className="btn ghost sm" onClick={() => setShowPrompt((value) => !value)}>
                {showPrompt ? 'Masquer le prompt' : 'Voir le prompt envoyé'}
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
                  className="suggestion"
                  key={suggestion.id}
                  style={
                    used === suggestion.id
                      ? { borderColor: 'var(--success)', boxShadow: '0 0 0 1px var(--success)' }
                      : undefined
                  }
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
                      <button
                        className="btn ghost sm"
                        onClick={() => markUsed(suggestion.id)}
                        title="Marquer comme envoyée (statistiques d’équipe)"
                      >
                        {used === suggestion.id ? '✓ Envoyée' : 'Marquer envoyée'}
                      </button>
                      <CopyButton
                        text={suggestion.text}
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
    </div>
  );
}

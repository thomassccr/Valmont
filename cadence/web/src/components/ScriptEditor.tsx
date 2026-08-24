import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelSummary, Script, ScriptCategory, ScriptInput, Variation } from '../../../shared/types';
import { api } from '../api';
import {
  Badge,
  CopyButton,
  Field,
  Modal,
  Spinner,
  TagInput,
  formatDateTime,
  useAsync,
  useDebounced,
  useToast,
} from './ui';

const BLANK: ScriptInput = {
  model_id: null,
  category_key: 'first_message',
  name: '',
  description: '',
  objective: '',
  tone: '',
  trigger: '',
  content: '',
  tags: [],
  variables: [],
};

const toInput = (script: Script): ScriptInput => ({
  model_id: script.model_id,
  category_key: script.category_key,
  name: script.name,
  description: script.description,
  objective: script.objective,
  tone: script.tone,
  trigger: script.trigger,
  content: script.content,
  tags: script.tags,
  variables: script.variables,
});

/** Valeurs d'exemple de l'aperçu : montrent le rendu réel des variables. */
const PREVIEW_REQUEST = {
  subscriber_alias: 'Marc',
  subscriber_message: 'salut, tu fais quoi ce soir ?',
  conversation_history: 'Abonné : hello\nCréateur : coucou toi',
  conversation_context: 'Abonné inscrit depuis 3 jours',
  objective: 'relancer la conversation',
  familiarity: 'occasionnel' as const,
  price: '15 €',
  content_type: 'vidéo custom',
  variant_count: 3,
};

export default function ScriptEditor({
  script,
  defaults,
  categories,
  models,
  onClose,
  onSaved,
}: {
  script: Script | null;
  defaults?: Partial<ScriptInput>;
  categories: ScriptCategory[];
  models: ModelSummary[];
  onClose: () => void;
  onSaved: (saved: Script) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<ScriptInput>(
    script ? toInput(script) : { ...BLANK, ...defaults },
  );
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<'preview' | 'variations' | 'versions'>('preview');
  const [variations, setVariations] = useState<Variation[]>([]);
  const [varyBusy, setVaryBusy] = useState(false);
  const [varyInstructions, setVaryInstructions] = useState('');
  const [preview, setPreview] = useState<{ rendered: string; missing: string[] } | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const variables = useAsync(() => api.variables(), []);
  const versions = useAsync(
    () => (script ? api.scriptVersions(script.id) : Promise.resolve([])),
    [script?.id],
  );

  const debouncedContent = useDebounced(draft.content, 250);

  useEffect(() => {
    let alive = true;
    api
      .preview({
        body: debouncedContent,
        creator_id: draft.model_id,
        request: PREVIEW_REQUEST,
        overrides: Object.fromEntries(
          draft.variables.filter((v) => v.default_value).map((v) => [v.name, v.default_value]),
        ),
      })
      .then((result) => alive && setPreview(result))
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [debouncedContent, draft.model_id, draft.variables]);

  const patch = (partial: Partial<ScriptInput>) => setDraft((current) => ({ ...current, ...partial }));

  const insert = (name: string) => {
    const token = `{{${name}}}`;
    const textarea = contentRef.current;
    if (!textarea) {
      patch({ content: draft.content + token });
      return;
    }
    const { selectionStart, selectionEnd, value } = textarea;
    patch({ content: `${value.slice(0, selectionStart)}${token}${value.slice(selectionEnd)}` });
    requestAnimationFrame(() => {
      textarea.focus();
      const position = selectionStart + token.length;
      textarea.setSelectionRange(position, position);
    });
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast('Le nom du script est obligatoire', true);
      return;
    }
    setSaving(true);
    try {
      const saved = script
        ? await api.updateScript(script.id, draft)
        : await api.createScript(draft);
      toast('Script enregistré');
      onSaved(saved);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Enregistrement impossible', true);
    } finally {
      setSaving(false);
    }
  };

  const generateVariations = async () => {
    if (!script) {
      toast('Enregistre le script avant de générer des variations', true);
      return;
    }
    setPanel('variations');
    setVaryBusy(true);
    try {
      setVariations(
        await api.scriptVariations(script.id, { count: 3, instructions: varyInstructions || undefined }),
      );
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Génération impossible', true);
    } finally {
      setVaryBusy(false);
    }
  };

  const saveVariationAsScript = async (variation: Variation) => {
    try {
      const created = await api.createScript({
        ...draft,
        name: `${draft.name} — ${variation.label}`,
        content: variation.content,
      });
      toast('Variante enregistrée comme nouveau script');
      onSaved(created);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Enregistrement impossible', true);
    }
  };

  const usedVariables = useMemo(
    () => [...new Set([...draft.content.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))],
    [draft.content],
  );

  return (
    <Modal
      wide
      title={script ? `${script.name}` : 'Nouveau script'}
      onClose={onClose}
      footer={
        <>
          <div className="btn-row">
            {script ? (
              <>
                <Badge>v{script.version}</Badge>
                <button
                  className="btn danger sm"
                  onClick={async () => {
                    if (!confirm(`Supprimer « ${script.name} » ?`)) return;
                    await api.deleteScript(script.id);
                    toast('Script supprimé');
                    onSaved(script);
                  }}
                >
                  Delete
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    const copy = await api.duplicateScript(script.id);
                    toast('Script dupliqué');
                    onSaved(copy);
                  }}
                >
                  Duplicate
                </button>
              </>
            ) : null}
            <CopyButton text={draft.content} label="Copy" className="btn sm" />
          </div>
          <div className="btn-row">
            <button className="btn ghost" onClick={onClose}>
              Annuler
            </button>
            <button className="btn" onClick={generateVariations} disabled={varyBusy || !script}>
              {varyBusy ? <Spinner /> : '✦'} Generate Variations
            </button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : null} Save Script
            </button>
          </div>
        </>
      }
    >
      <div className="split">
        {/* ─── Champs ─── */}
        <div>
          <Field label="Script Name">
            <input
              type="text"
              value={draft.name}
              autoFocus
              placeholder="PPV Follow-up — sans achat"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>

          <div className="split" style={{ gap: 10 }}>
            <Field label="Category">
              <select
                value={draft.category_key}
                onChange={(event) => patch({ category_key: event.target.value })}
              >
                {categories.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bibliothèque" hint="Global = accessible à tous les modèles.">
              <select
                value={draft.model_id ?? ''}
                onChange={(event) => patch({ model_id: event.target.value || null })}
              >
                <option value="">Global Scripts</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Description">
            <input
              type="text"
              value={draft.description}
              placeholder="À quoi sert ce script, en une ligne"
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>

          <div className="split" style={{ gap: 10 }}>
            <Field label="Objective">
              <input
                type="text"
                value={draft.objective}
                placeholder="Rouvrir la conversation"
                onChange={(event) => patch({ objective: event.target.value })}
              />
            </Field>
            <Field label="Tone">
              <input
                type="text"
                value={draft.tone}
                placeholder="Playful"
                onChange={(event) => patch({ tone: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Trigger" hint="Dans quelle situation utiliser ce script.">
            <input
              type="text"
              value={draft.trigger}
              placeholder="24 h après un PPV non acheté"
              onChange={(event) => patch({ trigger: event.target.value })}
            />
          </Field>

          <Field label="Tags">
            <TagInput values={draft.tags} onChange={(tags) => patch({ tags })} />
          </Field>

          <Field label="Script Content" hint="Clique une variable pour l’insérer au curseur.">
            <textarea
              ref={contentRef}
              rows={9}
              className="mono"
              value={draft.content}
              placeholder="hey {{subscriber_name}}, ..."
              onChange={(event) => patch({ content: event.target.value })}
            />
          </Field>

          <div className="row wrap" style={{ gap: 4 }}>
            {variables.data?.map((variable) => (
              <button
                key={variable.name}
                type="button"
                className="chip mono"
                title={variable.description}
                onClick={() => insert(variable.name)}
              >
                {`{{${variable.name}}}`}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Panneau droit ─── */}
        <div>
          <div className="tabs" style={{ marginBottom: 14 }}>
            <button
              className={`tab${panel === 'preview' ? ' active' : ''}`}
              onClick={() => setPanel('preview')}
            >
              Aperçu
            </button>
            <button
              className={`tab${panel === 'variations' ? ' active' : ''}`}
              onClick={() => setPanel('variations')}
            >
              Variations
            </button>
            <button
              className={`tab${panel === 'versions' ? ' active' : ''}`}
              onClick={() => setPanel('versions')}
            >
              Versions
            </button>
          </div>

          {panel === 'preview' ? (
            <>
              <div className="preview">{preview?.rendered || '—'}</div>
              {usedVariables.length ? (
                <div className="row wrap" style={{ gap: 4, marginTop: 10 }}>
                  <span className="faint">Variables utilisées :</span>
                  {usedVariables.map((name) => (
                    <span key={name} className="chip mono">{`{{${name}}}`}</span>
                  ))}
                </div>
              ) : null}
              {preview?.missing.length ? (
                <div className="alert warn" style={{ marginTop: 10 }}>
                  Sans valeur dans cet aperçu : {preview.missing.join(', ')}. Elles seront remplies
                  à la génération si l’information est disponible.
                </div>
              ) : null}
            </>
          ) : null}

          {panel === 'variations' ? (
            <>
              <Field label="Consigne pour les variations">
                <input
                  type="text"
                  value={varyInstructions}
                  placeholder="ex. plus court, sans emoji"
                  onChange={(event) => setVaryInstructions(event.target.value)}
                />
              </Field>
              <button className="btn" onClick={generateVariations} disabled={varyBusy || !script}>
                {varyBusy ? <Spinner /> : '✦'} Générer 3 variations
              </button>
              {!script ? (
                <div className="alert info" style={{ marginTop: 12 }}>
                  Enregistre d’abord le script : les variations partent du contenu sauvegardé.
                </div>
              ) : null}
              <div style={{ marginTop: 14 }}>
                {variations.map((variation) => (
                  <article className="suggestion" key={variation.id}>
                    <div className="suggestion-head">
                      <strong>{variation.label}</strong>
                      <CopyButton text={variation.content} className="btn sm" />
                    </div>
                    <div className="suggestion-text">{variation.content}</div>
                    {variation.warnings.map((warning, index) => (
                      <div
                        key={index}
                        className={`alert ${warning.severity === 'block' ? 'block' : warning.severity === 'warn' ? 'warn' : 'info'}`}
                        style={{ marginTop: 8 }}
                      >
                        {warning.message}
                      </div>
                    ))}
                    <div className="suggestion-foot">
                      <span className="suggestion-why">{variation.rationale}</span>
                      <div className="btn-row">
                        <button
                          className="btn ghost sm"
                          onClick={() => patch({ content: variation.content })}
                        >
                          Remplacer
                        </button>
                        <button
                          className="btn sm"
                          onClick={() => saveVariationAsScript(variation)}
                        >
                          Save as Script
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : null}

          {panel === 'versions' ? (
            <>
              {versions.data?.length ? (
                versions.data.map((version) => (
                  <div className="list-row" key={version.id} style={{ cursor: 'default' }}>
                    <Badge>v{version.version}</Badge>
                    <div className="grow">
                      <div className="list-title">{version.name}</div>
                      <div className="list-sub">
                        {formatDateTime(version.created_at)}
                        {version.author_name ? ` · ${version.author_name}` : ''}
                      </div>
                    </div>
                    <button
                      className="btn ghost sm"
                      onClick={() => patch({ content: version.content, name: version.name })}
                    >
                      Restaurer
                    </button>
                  </div>
                ))
              ) : (
                <p className="faint">Aucune version enregistrée pour l’instant.</p>
              )}
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

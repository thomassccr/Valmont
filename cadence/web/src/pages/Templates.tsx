import { useEffect, useMemo, useRef, useState } from 'react';
import type { PromptTemplate, PromptTemplateInput } from '../../../shared/types';
import { api } from '../api';
import {
  Badge,
  CopyButton,
  Empty,
  Field,
  Modal,
  Spinner,
  TagInput,
  useAsync,
  useDebounced,
  useToast,
} from '../components/ui';

const BLANK: PromptTemplateInput = {
  name: '',
  description: '',
  category: 'Général',
  tags: [],
  body: '',
  variables: [],
  scenario_id: null,
  creator_id: null,
  is_favorite: false,
};

const toInput = (template: PromptTemplate): PromptTemplateInput => ({
  name: template.name,
  description: template.description,
  category: template.category,
  tags: template.tags,
  body: template.body,
  variables: template.variables,
  scenario_id: template.scenario_id,
  creator_id: template.creator_id,
  is_favorite: template.is_favorite,
});

export default function Templates() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const debouncedSearch = useDebounced(search);

  const templates = useAsync(
    () => api.templates({ search: debouncedSearch, category }),
    [debouncedSearch, category],
  );
  const categories = useAsync(() => api.templateCategories(), []);
  const creators = useAsync(() => api.creators(), []);
  const scenarios = useAsync(() => api.scenarios(), []);
  const variables = useAsync(() => api.variables(), []);

  const [editing, setEditing] = useState<{ id: string | null; draft: PromptTemplateInput } | null>(
    null,
  );
  const [previewCreator, setPreviewCreator] = useState('');
  const [preview, setPreview] = useState<{ rendered: string; missing: string[] } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const debouncedBody = useDebounced(editing?.draft.body ?? '', 250);

  // Aperçu temps réel : rendu serveur, avec les vraies valeurs du créateur choisi.
  useEffect(() => {
    if (!editing) return;
    let alive = true;
    api
      .preview({
        body: debouncedBody,
        creator_id: previewCreator || creators.data?.[0]?.id || null,
        scenario_id: editing.draft.scenario_id,
        request: {
          subscriber_message: 'salut, tu fais quoi ce soir ?',
          conversation_history: 'Abonné : hello\nCréateur : coucou toi',
          conversation_context: 'Abonné inscrit depuis 3 jours',
          objective: 'faire parler l’abonné',
          familiarity: 'occasionnel',
          variant_count: 3,
          subscriber_alias: 'marc_92',
        },
      })
      .then((result) => alive && setPreview(result))
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedBody, previewCreator, editing?.draft.scenario_id]);

  const patch = (partial: Partial<PromptTemplateInput>) =>
    setEditing((current) =>
      current ? { ...current, draft: { ...current.draft, ...partial } } : current,
    );

  const insertVariable = (name: string) => {
    const textarea = bodyRef.current;
    const token = `{{${name}}}`;
    if (!textarea || !editing) {
      patch({ body: `${editing?.draft.body ?? ''}${token}` });
      return;
    }
    const { selectionStart, selectionEnd, value } = textarea;
    const next = `${value.slice(0, selectionStart)}${token}${value.slice(selectionEnd)}`;
    patch({ body: next });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart + token.length, selectionStart + token.length);
    });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.draft.name.trim()) {
      toast('Le nom est obligatoire', true);
      return;
    }
    try {
      if (editing.id) await api.updateTemplate(editing.id, editing.draft);
      else await api.createTemplate(editing.draft);
      toast('Template enregistré');
      setEditing(null);
      templates.reload();
      categories.reload();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Enregistrement impossible', true);
    }
  };

  const duplicate = async (template: PromptTemplate) => {
    const copy = await api.duplicateTemplate(template.id);
    toast('Template dupliqué');
    templates.reload();
    setEditing({ id: copy.id, draft: toInput(copy) });
  };

  const remove = async (template: PromptTemplate) => {
    if (!confirm(`Supprimer « ${template.name} » ?`)) return;
    await api.deleteTemplate(template.id);
    toast('Template supprimé');
    setEditing(null);
    templates.reload();
  };

  const grouped = useMemo(() => {
    const map = new Map<string, PromptTemplate[]>();
    for (const template of templates.data ?? []) {
      const list = map.get(template.category) ?? [];
      list.push(template);
      map.set(template.category, list);
    }
    return [...map.entries()];
  }, [templates.data]);

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          type="text"
          placeholder="Rechercher un template, un tag, un contenu…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          style={{ width: 180 }}
        >
          <option value="">Toutes catégories</option>
          {categories.data?.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          onClick={async () => {
            const { body } = await api.defaultTemplateBody();
            setEditing({ id: null, draft: { ...BLANK, body } });
          }}
        >
          + Nouveau template
        </button>
      </div>

      {templates.loading ? <Spinner /> : null}
      {templates.data && !templates.data.length ? (
        <Empty title="Aucun template" hint="Change la recherche ou crée un nouveau template." />
      ) : null}

      {grouped.map(([groupName, items]) => (
        <section key={groupName} style={{ marginBottom: 22 }}>
          <div className="section-title">{groupName}</div>
          {items.map((template) => (
            <div
              className="list-row"
              key={template.id}
              onClick={() => setEditing({ id: template.id, draft: toInput(template) })}
            >
              <div className="grow">
                <div className="list-title">
                  {template.is_favorite ? '★ ' : ''}
                  {template.name}
                </div>
                <div className="list-sub">{template.description || template.body.slice(0, 110)}</div>
              </div>
              <div className="row wrap">
                {template.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
              <button
                className="btn ghost sm"
                onClick={(event) => {
                  event.stopPropagation();
                  void duplicate(template);
                }}
              >
                Dupliquer
              </button>
            </div>
          ))}
        </section>
      ))}

      {editing ? (
        <Modal
          wide
          title={editing.id ? `Template — ${editing.draft.name}` : 'Nouveau template'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <div className="btn-row">
                {editing.id ? (
                  <button
                    className="btn danger"
                    onClick={() => {
                      const target = templates.data?.find((item) => item.id === editing.id);
                      if (target) void remove(target);
                    }}
                  >
                    Supprimer
                  </button>
                ) : null}
                <CopyButton text={editing.draft.body} label="Copier le prompt" className="btn sm" />
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
            <Field label="Catégorie">
              <input
                type="text"
                list="template-categories"
                value={editing.draft.category}
                onChange={(event) => patch({ category: event.target.value })}
              />
              <datalist id="template-categories">
                {categories.data?.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="split">
            <Field label="Description">
              <input
                type="text"
                value={editing.draft.description}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </Field>
            <Field label="Tags">
              <TagInput values={editing.draft.tags} onChange={(tags) => patch({ tags })} />
            </Field>
          </div>

          <div className="split">
            <Field label="Scénario associé">
              <select
                value={editing.draft.scenario_id ?? ''}
                onChange={(event) => patch({ scenario_id: event.target.value || null })}
              >
                <option value="">Aucun</option>
                {scenarios.data?.scenarios.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Réservé à un créateur">
              <select
                value={editing.draft.creator_id ?? ''}
                onChange={(event) => patch({ creator_id: event.target.value || null })}
              >
                <option value="">Tous</option>
                {creators.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="checkbox" style={{ marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={editing.draft.is_favorite}
              onChange={(event) => patch({ is_favorite: event.target.checked })}
            />
            Épingler en haut de la bibliothèque
          </label>

          <div className="section-title">Prompt</div>
          <div className="split">
            <div>
              <Field label="Corps du template" hint="Clique une variable pour l’insérer au curseur.">
                <textarea
                  ref={bodyRef}
                  rows={16}
                  className="mono"
                  value={editing.draft.body}
                  onChange={(event) => patch({ body: event.target.value })}
                />
              </Field>
              <div className="row wrap" style={{ gap: 5 }}>
                {variables.data?.map((variable) => (
                  <button
                    key={variable.name}
                    type="button"
                    className="chip"
                    title={variable.description}
                    onClick={() => insertVariable(variable.name)}
                  >
                    {`{{${variable.name}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Field label="Aperçu en temps réel" hint="Rendu avec des valeurs d’exemple.">
                <select
                  value={previewCreator}
                  onChange={(event) => setPreviewCreator(event.target.value)}
                >
                  <option value="">Créateur : premier de la liste</option>
                  {creators.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="preview">{preview?.rendered || '—'}</div>
              {preview?.missing.length ? (
                <div className="alert warn" style={{ marginTop: 10 }}>
                  Variables sans valeur : {preview.missing.join(', ')}
                </div>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

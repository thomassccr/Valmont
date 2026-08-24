import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FAMILIARITY_LABELS } from '../../../shared/scenarios';
import type { GenerationHistoryItem } from '../../../shared/types';
import { api } from '../api';
import {
  Badge,
  CopyButton,
  Empty,
  Modal,
  Spinner,
  useAsync,
  useDebounced,
  useToast,
} from '../components/ui';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function History() {
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [creatorId, setCreatorId] = useState('');
  const debouncedSearch = useDebounced(search);

  const creators = useAsync(() => api.creators(), []);
  const history = useAsync(
    () => api.history({ search: debouncedSearch, creator_id: creatorId, limit: 200 }),
    [debouncedSearch, creatorId],
  );
  const [open, setOpen] = useState<GenerationHistoryItem | null>(null);

  const replay = (item: GenerationHistoryItem) => {
    navigate('/console', {
      state: {
        prefill: {
          creator_id: item.creator_id,
          scenario_id: item.scenario_id,
          subscriber_alias: item.subscriber_alias ?? '',
          subscriber_message: item.subscriber_message,
          objective: item.objective,
          familiarity: item.familiarity,
        },
      },
    });
  };

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          type="text"
          placeholder="Rechercher dans les messages et les suggestions…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          value={creatorId}
          onChange={(event) => setCreatorId(event.target.value)}
          style={{ width: 200 }}
        >
          <option value="">Tous les créateurs</option>
          {creators.data?.map((creator) => (
            <option key={creator.id} value={creator.id}>
              {creator.name}
            </option>
          ))}
        </select>
      </div>

      {history.loading ? <Spinner /> : null}
      {history.data && !history.data.length ? (
        <Empty title="Aucune génération" hint="L’historique se remplit dès la première génération." />
      ) : null}

      {history.data?.map((item) => (
        <div className="list-row" key={item.id} onClick={() => setOpen(item)}>
          <div className="grow">
            <div className="list-title">
              {item.creator_name}
              {item.subscriber_alias ? <span className="faint"> · {item.subscriber_alias}</span> : null}
            </div>
            <div className="list-sub">{item.subscriber_message || item.objective || '—'}</div>
          </div>
          <Badge>{item.scenario_name ?? 'Libre'}</Badge>
          {item.used_suggestion_id ? <Badge tone="success">envoyée</Badge> : null}
          <span className="faint">{formatDate(item.created_at)}</span>
        </div>
      ))}

      {open ? (
        <Modal
          wide
          title={`${open.creator_name} — ${formatDate(open.created_at)}`}
          onClose={() => setOpen(null)}
          footer={
            <>
              <span className="faint">
                {open.operator_name ?? 'opérateur inconnu'} · {open.model} · {open.latency_ms} ms
              </span>
              <div className="btn-row">
                <button className="btn" onClick={() => replay(open)}>
                  Rejouer dans la console
                </button>
                <button className="btn ghost" onClick={() => setOpen(null)}>
                  Fermer
                </button>
              </div>
            </>
          }
        >
          <div className="row wrap" style={{ marginBottom: 14 }}>
            <Badge tone="accent">{open.scenario_name ?? 'Libre'}</Badge>
            <Badge>{FAMILIARITY_LABELS[open.familiarity]}</Badge>
            {open.objective ? <Badge>{open.objective}</Badge> : null}
          </div>

          <div className="section-title">Message reçu</div>
          <div className="preview">{open.subscriber_message || '—'}</div>

          <div className="section-title">Propositions</div>
          {open.suggestions.length ? (
            open.suggestions.map((suggestion) => (
              <article className="suggestion" key={suggestion.id}>
                <div className="suggestion-head">
                  <strong>{suggestion.label}</strong>
                  <div className="row">
                    {open.used_suggestion_id === suggestion.id ? (
                      <Badge tone="success">envoyée</Badge>
                    ) : null}
                    <CopyButton
                      text={suggestion.text}
                      className="btn sm"
                      onCopied={() => toast('Message copié')}
                    />
                  </div>
                </div>
                <div className="suggestion-text">{suggestion.text}</div>
              </article>
            ))
          ) : (
            <div className="alert block">
              Génération bloquée par les garde-fous — aucune proposition n’a été produite.
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}

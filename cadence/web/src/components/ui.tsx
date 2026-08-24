import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ─────────────────────────  Champs de formulaire  ───────────────────────── */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Saisie de listes : Entrée ou virgule valide une valeur, Retour arrière supprime la dernière. */
export function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const value = raw.trim().replace(/,$/, '');
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft('');
  };

  return (
    <div className="tag-input">
      {values.map((value) => (
        <span className="chip" key={value}>
          {value}
          <button
            type="button"
            aria-label={`Retirer ${value}`}
            onClick={() => onChange(values.filter((item) => item !== value))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={placeholder ?? 'Ajouter…'}
        onChange={(event) => {
          const next = event.target.value;
          if (next.endsWith(',')) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(draft);
          } else if (event.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

/* ─────────────────────────  Affichage  ───────────────────────── */

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'warn' | 'danger';
}) {
  return <span className={`badge ${tone === 'default' ? '' : tone}`}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint ? <div>{hint}</div> : null}
    </div>
  );
}

export const Spinner = () => <span className="spinner" />;

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ─────────────────────────  Copie  ───────────────────────── */

export function CopyButton({
  text,
  label = 'Copier',
  className = 'btn sm',
  onCopied,
}: {
  text: string;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Contexte non sécurisé (http) : repli sur la sélection manuelle.
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    onCopied?.();
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? '✓ Copié' : label}
    </button>
  );
}

/* ─────────────────────────  Notifications  ───────────────────────── */

interface Toast {
  id: number;
  message: string;
  error?: boolean;
}

const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, error?: boolean) => {
    const toast = { id: Date.now() + Math.random(), message, error };
    setToasts((current) => [...current, toast]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== toast.id)),
      error ? 5200 : 2600,
    );
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast${toast.error ? ' error' : ''}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ─────────────────────────  Chargement de données  ───────────────────────── */

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader()
      .then((result) => {
        if (alive) {
          setData(result);
          setError(null);
        }
      })
      .catch((cause: Error) => alive && setError(cause.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return useMemo(() => ({ data, loading, error, reload, setData }), [data, loading, error, reload]);
}

/** Valeur retardée : évite un appel réseau à chaque frappe (recherche, aperçu). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ─────────────────────────  Avatar & identité  ───────────────────────── */

const initials = (name: string): string =>
  name
    // On ignore la ponctuation : « Lina (exemple) » doit donner « L », pas « L( ».
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

export function Avatar({
  name,
  url,
  color,
  size,
}: {
  name: string;
  url?: string;
  color?: string;
  size?: 'sm' | 'lg' | 'xl';
}) {
  const className = `avatar${size && size !== 'sm' ? ` ${size}` : ''}`;
  if (url) return <img className={className} src={url} alt={name} />;
  return (
    <span className={className} style={{ background: color || 'var(--accent)' }}>
      {initials(name)}
    </span>
  );
}

/* ─────────────────────────  Onglets  ───────────────────────── */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={tab.key === active}
          className={`tab${tab.key === active ? ' active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="faint"> {tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────  Favori  ───────────────────────── */

export function StarButton({
  on,
  onToggle,
  title = 'Favori',
}: {
  on: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`star${on ? ' on' : ''}`}
      title={title}
      aria-pressed={on}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

/* ─────────────────────────  Statistiques  ───────────────────────── */

export function Stat({
  value,
  label,
  hint,
}: {
  value: string | number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-value nums">{value}</div>
      <div className="stat-label">{label}</div>
      {hint ? <div className="stat-trend">{hint}</div> : null}
    </div>
  );
}

export function Meter({ value, tone }: { value: number; tone?: 'success' }) {
  return (
    <div className={`meter${tone ? ` ${tone}` : ''}`}>
      <div style={{ width: `${Math.min(Math.max(value, 0), 1) * 100}%` }} />
    </div>
  );
}

/* ─────────────────────────  Dates  ───────────────────────── */

export const formatDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })
    : '—';

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

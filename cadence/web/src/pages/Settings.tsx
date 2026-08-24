import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Field, Spinner, Stat, Tabs, formatDate, useAsync, useToast } from '../components/ui';
import Scenarios from './Scenarios';
import Templates from './Templates';

type Tab = 'general' | 'templates' | 'scenarios' | 'team';

const TABS: { key: Tab; label: string }[] = [
  { key: 'general', label: 'Général' },
  { key: 'templates', label: 'Prompt Templates' },
  { key: 'scenarios', label: 'Scénarios' },
  { key: 'team', label: 'Équipe' },
];

export default function Settings({
  theme,
  onToggleTheme,
}: {
  theme: string;
  onToggleTheme: () => void;
}) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('general');

  return (
    <div className="page-enter">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'general' ? <General theme={theme} onToggleTheme={onToggleTheme} /> : null}
      {tab === 'templates' ? <Templates /> : null}
      {tab === 'scenarios' ? <Scenarios /> : null}
      {tab === 'team' ? <Team isAdmin={user?.role === 'admin'} /> : null}
    </div>
  );
}

function General({ theme, onToggleTheme }: { theme: string; onToggleTheme: () => void }) {
  const health = useAsync(() => api.health(), []);
  const variables = useAsync(() => api.variables(), []);
  const categories = useAsync(() => api.scriptCategories(), []);

  return (
    <div className="content-narrow">
      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        <Stat
          value={health.data?.provider === 'local' ? 'Mode local' : (health.data?.provider ?? '—')}
          label="Fournisseur de génération"
          hint={health.data?.model}
        />
        <Stat value={categories.data?.length ?? '—'} label="Catégories de scripts" />
        <Stat value={variables.data?.length ?? '—'} label="Variables disponibles" />
      </div>

      {health.data?.provider === 'local' ? (
        <div className="alert warn" style={{ marginBottom: 20 }}>
          Aucune clé API configurée : l’outil compose des ébauches hors ligne. Renseigne
          ANTHROPIC_API_KEY dans le fichier .env du serveur pour activer la génération complète.
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span className="card-title">Apparence</span>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Thème de l’interface</span>
          <button className="btn" onClick={onToggleTheme}>
            {theme === 'dark' ? '☾ Sombre' : '☀ Clair'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Variables dynamiques</span>
          <span className="card-hint">Utilisables dans les scripts et les templates</span>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Description</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {variables.data?.map((variable) => (
              <tr key={variable.name}>
                <td className="mono">{`{{${variable.name}}}`}</td>
                <td className="muted">{variable.description}</td>
                <td>
                  <Badge>{variable.source}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Team({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const users = useAsync(() => (isAdmin ? api.users() : Promise.resolve([])), [isAdmin]);
  const [draft, setDraft] = useState({ email: '', name: '', password: '', role: 'operator' });
  const [saving, setSaving] = useState(false);

  if (!isAdmin) {
    return <div className="alert info">La gestion de l’équipe est réservée aux administrateurs.</div>;
  }

  const create = async () => {
    setSaving(true);
    try {
      await api.createUser(draft);
      toast('Compte créé');
      setDraft({ email: '', name: '', password: '', role: 'operator' });
      users.reload();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Création impossible', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="content-narrow">
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span className="card-title">Opérateurs</span>
          <span className="card-hint">{users.data?.length ?? 0} comptes</span>
        </div>
        {users.loading ? <Spinner /> : null}
        <table className="data">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Email</th>
              <th>Rôle</th>
              <th className="num">Créé le</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((account) => (
              <tr key={account.id}>
                <td>{account.name}</td>
                <td className="muted">{account.email}</td>
                <td>
                  <Badge tone={account.role === 'admin' ? 'accent' : 'default'}>{account.role}</Badge>
                </td>
                <td className="num faint">{formatDate(account.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Ajouter un opérateur</span>
        </div>
        <div className="split">
          <Field label="Nom">
            <input
              type="text"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </Field>
        </div>
        <div className="split">
          <Field label="Mot de passe" hint="8 caractères minimum.">
            <input
              type="password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
          </Field>
          <Field label="Rôle">
            <select
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            >
              <option value="operator">Opérateur</option>
              <option value="admin">Administrateur</option>
            </select>
          </Field>
        </div>
        <button className="btn primary" onClick={create} disabled={saving}>
          {saving ? <Spinner /> : null} Créer le compte
        </button>
      </div>
    </div>
  );
}

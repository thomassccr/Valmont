import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { Field } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connexion impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: '0 0 20px' }}>
          <div className="brand-mark" />
          <div>
            <div className="brand-name">Cadence</div>
            <div className="brand-sub">Studio de messaging</div>
          </div>
        </div>

        <Field label="Email">
          <input
            type="email"
            value={email}
            autoFocus
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Mot de passe">
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {error ? (
          <div className="alert block" style={{ marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}

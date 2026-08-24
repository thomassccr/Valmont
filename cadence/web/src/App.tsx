import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Spinner } from './components/ui';
import Console from './pages/Console';
import Creators from './pages/Creators';
import Dashboard from './pages/Dashboard';
import History from './pages/History';
import Login from './pages/Login';
import Scenarios from './pages/Scenarios';
import Templates from './pages/Templates';

interface NavItem {
  to: string;
  icon: string;
  label: string;
  title: string;
  subtitle: string;
  tight?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', icon: '◧', label: 'Dashboard', title: 'Dashboard', subtitle: "Activité de l'équipe" },
  {
    to: '/console',
    icon: '✎',
    label: 'Console',
    title: 'Console de messaging',
    subtitle: 'Générer des propositions de réponse',
    tight: true,
  },
  {
    to: '/creators',
    icon: '☺',
    label: 'Créateurs',
    title: 'Profils créateurs',
    subtitle: 'Personnalité, ton, vocabulaire, garde-fous',
  },
  {
    to: '/scenarios',
    icon: '⌘',
    label: 'Scénarios',
    title: 'Scénarios de conversation',
    subtitle: 'Structures réutilisables par situation',
  },
  {
    to: '/templates',
    icon: '❏',
    label: 'Templates',
    title: 'Templates de prompt',
    subtitle: 'Bibliothèque de prompts variabilisés',
  },
  {
    to: '/history',
    icon: '≡',
    label: 'Historique',
    title: 'Historique des générations',
    subtitle: 'Traçabilité et réutilisation',
  },
];

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('cadence:theme') ?? 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cadence:theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')) };
}

export default function App() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const { theme, toggle } = useTheme();

  if (loading) {
    return (
      <div className="login-shell">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Login />;

  const active =
    NAV.find((item) => item.to !== '/' && location.pathname.startsWith(item.to)) ?? NAV[0];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-name">Cadence</div>
            <div className="brand-sub">Studio de messaging</div>
          </div>
        </div>

        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}

        <div className="nav-spacer" />

        <div className="sidebar-foot">
          <div className="row" style={{ padding: '4px 10px' }}>
            <div className="grow" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--text)', fontWeight: 600 }}>{user.name}</div>
              <div>{user.role === 'admin' ? 'Administrateur' : 'Opérateur'}</div>
            </div>
          </div>
          <div className="row">
            <button className="btn ghost sm" onClick={toggle}>
              {theme === 'dark' ? '☾ Sombre' : '☀ Clair'}
            </button>
            <button className="btn ghost sm" onClick={logout}>
              Déconnexion
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{active.title}</h1>
            <div className="topbar-sub">{active.subtitle}</div>
          </div>
        </header>

        <div className={`content${active.tight ? ' tight' : ''}`}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/console" element={<Console />} />
            <Route path="/creators" element={<Creators />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/history" element={<History />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

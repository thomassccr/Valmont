import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { Avatar, Spinner, useAsync } from './components/ui';
import Analytics from './pages/Analytics';
import Dashboard from './pages/Dashboard';
import Favorites from './pages/Favorites';
import Generator from './pages/Generator';
import GlobalScripts from './pages/GlobalScripts';
import History from './pages/History';
import Login from './pages/Login';
import ModelDetail from './pages/ModelDetail';
import Models from './pages/Models';
import SearchPage from './pages/SearchPage';
import Settings from './pages/Settings';

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
    to: '/models',
    icon: '☺',
    label: 'Models',
    title: 'Models',
    subtitle: 'Profils, scripts et performance par modèle',
  },
  {
    to: '/scripts',
    icon: '❏',
    label: 'Global Scripts',
    title: 'Global Scripts',
    subtitle: 'Bibliothèque partagée par tous les modèles',
  },
  {
    to: '/favorites',
    icon: '★',
    label: 'Favorites',
    title: 'Favorites',
    subtitle: 'Scripts, modèles et prompts épinglés',
  },
  {
    to: '/generator',
    icon: '✦',
    label: 'Prompt Generator',
    title: 'Prompt Generator',
    subtitle: 'Générer des réponses pour un modèle',
    tight: true,
  },
  {
    to: '/analytics',
    icon: '◈',
    label: 'Analytics',
    title: 'Analytics',
    subtitle: 'Ce qui fonctionne, par script et par modèle',
  },
  {
    to: '/settings',
    icon: '⚙',
    label: 'Settings',
    title: 'Settings',
    subtitle: 'Templates, scénarios, équipe et variables',
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
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  const models = useAsync(() => (user ? api.models() : Promise.resolve([])), [user?.id]);
  const [modelFilter, setModelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const filteredModels = useMemo(() => {
    const needle = modelFilter.trim().toLowerCase();
    const list = models.data ?? [];
    if (!needle) return list;
    return list.filter((model) =>
      `${model.name} ${model.handle} ${model.tone}`.toLowerCase().includes(needle),
    );
  }, [models.data, modelFilter]);

  if (loading) {
    return (
      <div className="login-shell">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Login />;

  const active =
    NAV.slice(1).find((item) => location.pathname.startsWith(item.to)) ??
    (location.pathname === '/' ? NAV[0] : null);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (search.trim()) navigate(`/search?q=${encodeURIComponent(search.trim())}`);
  };

  return (
    <div className="app">
      {menuOpen ? <div className="scrim" onClick={() => setMenuOpen(false)} /> : null}

      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-name">Cadence</div>
            <div className="brand-sub">MESSAGING STUDIO</div>
          </div>
        </div>

        <div className="nav-group">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.to === '/models' && models.data ? (
                <span className="nav-count">{models.data.length}</span>
              ) : null}
            </NavLink>
          ))}
        </div>

        <div className="nav-label">Models</div>
        <div className="sidebar-search">
          <input
            type="search"
            placeholder="Filtrer les modèles…"
            value={modelFilter}
            onChange={(event) => setModelFilter(event.target.value)}
          />
        </div>

        <div className="sidebar-scroll">
          {filteredModels.map((model) => (
            <div
              key={model.id}
              className={`model-link${location.pathname === `/models/${model.id}` ? ' active' : ''}${
                model.archived ? ' inactive' : ''
              }`}
              onClick={() => navigate(`/models/${model.id}`)}
            >
              <Avatar name={model.name} url={model.avatar_url} color={model.accent_color} />
              <span className="name">{model.name}</span>
              {model.is_favorite ? <span className="meta">★</span> : null}
              <span className="meta">{model.script_count}</span>
              <span className={`status-dot${model.archived ? ' off' : ''}`} />
            </div>
          ))}
          {!filteredModels.length ? (
            <p className="faint" style={{ padding: '4px 12px' }}>
              {modelFilter ? 'Aucun modèle trouvé.' : 'Aucun modèle pour l’instant.'}
            </p>
          ) : null}
          <button className="nav-link" onClick={() => navigate('/models')}>
            <span className="nav-icon">+</span> Add Model
          </button>
        </div>

        <div className="sidebar-foot">
          <div className="user-row">
            <Avatar name={user.name} color="var(--surface-hover)" />
            <div className="grow">
              <div className="name">{user.name}</div>
              <div className="role">{user.role === 'admin' ? 'Administrateur' : 'Opérateur'}</div>
            </div>
          </div>
          <div className="row">
            <button className="btn ghost sm" onClick={toggle}>
              {theme === 'dark' ? '☾' : '☀'}
            </button>
            <button className="btn ghost sm" onClick={() => navigate('/history')}>
              Historique
            </button>
            <button className="btn ghost sm" onClick={logout}>
              Quitter
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-btn" onClick={() => setMenuOpen(true)}>
            ☰
          </button>
          <div>
            <h1>{active?.title ?? 'Cadence'}</h1>
            <div className="topbar-sub">{active?.subtitle ?? ''}</div>
          </div>
          <form className="topbar-search" onSubmit={submitSearch}>
            <span className="icon">⌕</span>
            <input
              type="search"
              placeholder="Rechercher partout : PPV, follow up, Emma, high spender…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </form>
        </header>

        <div className={`content${active?.tight ? ' tight' : ''}`}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/models" element={<Models onChanged={models.reload} />} />
            <Route path="/models/:id" element={<ModelRoute onChanged={models.reload} />} />
            <Route path="/scripts" element={<GlobalScripts />} />
            <Route path="/favorites" element={<Favorites onChanged={models.reload} />} />
            <Route path="/generator" element={<Generator />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings theme={theme} onToggleTheme={toggle} />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/history" element={<History />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

/** Remonte l'espace du modèle à chaque changement d'identifiant. */
function ModelRoute({ onChanged }: { onChanged: () => void }) {
  const { id } = useParams();
  return <ModelDetail key={id} onChanged={onChanged} />;
}

/* ============================================================================
   VALMONT — Tracking Links + Analytics
   Module autonome : il ne modifie aucune fonctionnalité existante. Il crée ses
   propres vues (#v-tracking, #v-tracking-link, #v-tracking-models,
   #v-tracking-model) et s'appuie sur showV() pour la navigation.

   Deux modes de fonctionnement, choisis automatiquement :
     • CLOUD  — l'utilisateur est connecté via Supabase et le schéma
                tracking/schema.sql est installé : liens, clics, visiteurs,
                conversions et attribution sont réels, protégés par la RLS.
     • LOCAL  — pas de backend : les liens sont conservés dans le navigateur
                (clés vm_tl_*, synchronisées par le mécanisme existant).
                Aucune donnée de performance n'est inventée : les compteurs
                restent à zéro tant qu'aucun clic réel n'est enregistré.
                Un jeu de démonstration explicitement étiqueté peut être
                chargé à la demande, jamais automatiquement.
   ========================================================================== */
(function () {
  'use strict';

  /* ─── Configuration ─────────────────────────────────────────────────── */

  const CFG = window.VALMONT_TRACKING || {};
  // Domaine public de redirection (celui servi par tracking/worker.js)
  const BASE = String(CFG.redirectBase || 'https://mydomain.com').replace(/\/+$/, '');
  const API_URL = String(CFG.apiUrl || (BASE + '/api/conversions'));

  const SOURCES = [
    { code: 'instagram', label: 'Instagram' },
    { code: 'tiktok',    label: 'TikTok' },
    { code: 'twitter',   label: 'Twitter / X' },
    { code: 'reddit',    label: 'Reddit' },
    { code: 'other',     label: 'Other' },
  ];
  const SOURCE_LABEL = SOURCES.reduce((a, s) => (a[s.code] = s.label, a), {});
  const WINDOWS = [7, 14, 30, 60, 90];
  const SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
  const RESERVED = ['api', 'app', 'admin', 'assets', 'auth', 'cdn', 'dashboard', 'favicon.ico',
    'health', 'index', 'login', 'logout', 'manifest.json', 'robots.txt', 'settings', 'signup',
    'site', 'sitemap.xml', 'static', 'support', 'tracking', 'www'];

  /* ─── Utilitaires ───────────────────────────────────────────────────── */

  const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function money(n, currency) {
    const v = Number(n || 0);
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: currency || 'USD',
        minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2,
      }).format(v);
    } catch (e) { return '$' + v.toFixed(2); }
  }
  function pct(n) { return (Math.round(Number(n || 0) * 100) / 100).toFixed(2) + '%'; }
  function dateLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
  }
  function dayKey(d) { return new Date(d).toISOString().slice(0, 10); }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  }
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function publicUrl(slug) { return BASE + '/' + slug; }

  function validateSlug(slug) {
    if (!slug) return 'Le slug est obligatoire.';
    if (!SLUG_RE.test(slug)) return 'Slug invalide : minuscules, chiffres, « - », « _ » ou « . », 2 à 48 caractères.';
    if (RESERVED.indexOf(slug) !== -1) return `« ${slug} » est un slug réservé.`;
    return null;
  }
  function validateDestination(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return 'URL de destination invalide.'; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Seules les URL http(s) sont acceptées.';
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || /\.local$/.test(h) || h.indexOf('.') === -1) return 'Hôte de destination interdit.';
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
      return 'Hôte de destination interdit (adresse privée).';
    }
    if (u.href.length > 1000) return 'URL de destination trop longue.';
    return null;
  }

  function toast(msg) {
    let el = document.getElementById('vtl-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vtl-toast'; el.className = 'vtl-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('on'), 2600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Lien copié'); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Lien copié'); } catch (e2) { toast('Copie impossible'); }
      ta.remove();
    }
  }

  /* ─── Stockage local (mode sans backend) ────────────────────────────── */

  const LS = {
    get(key, def) {
      try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : def; }
      catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
      if (window.VMB && VMB.schedulePush) { try { VMB.schedulePush(); } catch (e) {} }
    },
  };
  const K = {
    links: 'vm_tl_links', models: 'vm_tl_models', campaigns: 'vm_tl_campaigns',
    clicks: 'vm_tl_clicks', conversions: 'vm_tl_conversions', demo: 'vm_tl_demo',
  };

  function emptyStats() {
    return {
      clicks: 0, unique_visitors: 0, clicks_today: 0, clicks_7d: 0, clicks_30d: 0,
      conversions: 0, fans: 0, revenue: 0, conversion_rate: 0,
      revenue_per_visitor: 0, revenue_per_fan: 0,
    };
  }

  // Calcule les statistiques d'un lien à partir des clics et conversions bruts.
  // Une conversion ne compte QUE si elle est attribuée.
  function computeStats(linkId, clicks, conversions) {
    const s = emptyStats();
    const today = dayKey(new Date());
    const now = Date.now();
    const visitors = new Set(), fans = new Set();
    clicks.forEach(c => {
      if (c.link_id !== linkId) return;
      s.clicks++;
      if (c.visitor_id) visitors.add(c.visitor_id);
      const t = new Date(c.occurred_at).getTime();
      if (dayKey(c.occurred_at) === today) s.clicks_today++;
      if (now - t <= 7 * 864e5) s.clicks_7d++;
      if (now - t <= 30 * 864e5) s.clicks_30d++;
    });
    conversions.forEach(v => {
      if (v.link_id !== linkId || v.status !== 'attributed') return;
      s.conversions++;
      s.revenue += Number(v.amount || 0);
      if (v.fan_id_hash) fans.add(v.fan_id_hash);
    });
    s.unique_visitors = visitors.size;
    s.fans = fans.size;
    s.conversion_rate = s.unique_visitors ? round2(100 * s.conversions / s.unique_visitors) : 0;
    s.revenue_per_visitor = s.unique_visitors ? round2(s.revenue / s.unique_visitors) : 0;
    s.revenue_per_fan = s.fans ? round2(s.revenue / s.fans) : 0;
    s.revenue = round2(s.revenue);
    return s;
  }
  function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

  const LocalStore = {
    mode: 'local',
    async listModels() {
      const models = LS.get(K.models, []);
      const links = LS.get(K.links, []).filter(l => !l.deleted_at);
      const clicks = LS.get(K.clicks, []), convs = LS.get(K.conversions, []);
      return models.map(m => {
        const own = links.filter(l => l.model_id === m.id);
        const agg = emptyStats();
        own.forEach(l => {
          const st = computeStats(l.id, clicks, convs);
          agg.clicks += st.clicks; agg.unique_visitors += st.unique_visitors;
          agg.conversions += st.conversions; agg.fans += st.fans; agg.revenue += st.revenue;
        });
        agg.conversion_rate = agg.unique_visitors ? round2(100 * agg.conversions / agg.unique_visitors) : 0;
        return Object.assign({}, m, { links: own.length, stats: agg });
      });
    },
    async createModel(data) {
      const models = LS.get(K.models, []);
      const name = String(data.name || '').trim();
      if (!name) throw new Error('Nom du modèle obligatoire.');
      if (models.some(m => m.name.toLowerCase() === name.toLowerCase())) throw new Error('Ce modèle existe déjà.');
      const m = { id: uuid(), name: name, handle: (data.handle || '').trim() || null, status: 'active', created_at: new Date().toISOString() };
      models.push(m); LS.set(K.models, models);
      return m;
    },
    async listCampaigns() { return LS.get(K.campaigns, []); },
    async createCampaign(name) {
      const list = LS.get(K.campaigns, []);
      const n = String(name || '').trim();
      if (!n) return null;
      const found = list.find(c => c.name.toLowerCase() === n.toLowerCase());
      if (found) return found;
      const c = { id: uuid(), name: n, created_at: new Date().toISOString() };
      list.push(c); LS.set(K.campaigns, list);
      return c;
    },
    async listLinks() {
      const links = LS.get(K.links, []).filter(l => !l.deleted_at);
      const models = LS.get(K.models, []), camps = LS.get(K.campaigns, []);
      const clicks = LS.get(K.clicks, []), convs = LS.get(K.conversions, []);
      return links.map(l => Object.assign({}, l, {
        model_name: (models.find(m => m.id === l.model_id) || {}).name || null,
        campaign_name: (camps.find(c => c.id === l.campaign_id) || {}).name || null,
        stats: computeStats(l.id, clicks, convs),
      })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },
    async getLink(id) { return (await this.listLinks()).find(l => l.id === id) || null; },
    async slugTaken(slug, exceptId) {
      return LS.get(K.links, []).some(l => !l.deleted_at && l.slug === slug && l.id !== exceptId);
    },
    async createLink(data) {
      const links = LS.get(K.links, []);
      const l = {
        id: uuid(), model_id: data.model_id || null, campaign_id: data.campaign_id || null,
        name: data.name, slug: data.slug, destination_url: data.destination_url,
        source_code: data.source_code || 'other', status: data.status || 'active',
        attribution_window_days: data.attribution_window_days || 30,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
        demo: !!data.demo,
      };
      links.push(l); LS.set(K.links, links);
      return l;
    },
    async updateLink(id, patch) {
      const links = LS.get(K.links, []);
      const i = links.findIndex(l => l.id === id);
      if (i === -1) throw new Error('Lien introuvable.');
      links[i] = Object.assign({}, links[i], patch, { updated_at: new Date().toISOString() });
      LS.set(K.links, links);
      return links[i];
    },
    async deleteLink(id) {
      LS.set(K.links, LS.get(K.links, []).filter(l => l.id !== id));
      LS.set(K.clicks, LS.get(K.clicks, []).filter(c => c.link_id !== id));
      LS.set(K.conversions, LS.get(K.conversions, []).filter(c => c.link_id !== id));
    },
    async daily(linkId, days) {
      const clicks = LS.get(K.clicks, []).filter(c => c.link_id === linkId);
      const convs = LS.get(K.conversions, []).filter(c => c.link_id === linkId && c.status === 'attributed');
      const map = {};
      const add = (d, field, v) => {
        const k = dayKey(d);
        (map[k] = map[k] || { day: k, clicks: 0, conversions: 0, revenue: 0 })[field] += v;
      };
      clicks.forEach(c => add(c.occurred_at, 'clicks', 1));
      convs.forEach(c => { add(c.occurred_at, 'conversions', 1); add(c.occurred_at, 'revenue', Number(c.amount || 0)); });
      return Object.values(map).sort((a, b) => a.day < b.day ? -1 : 1);
    },
    async sources(linkId) {
      const clicks = LS.get(K.clicks, []).filter(c => c.link_id === linkId);
      const map = {};
      clicks.forEach(c => {
        const key = c.source_code || 'other';
        map[key] = (map[key] || 0) + 1;
      });
      return Object.keys(map).map(k => ({ source_code: k, clicks: map[k] })).sort((a, b) => b.clicks - a.clicks);
    },
    async conversions(linkId, limit) {
      return LS.get(K.conversions, [])
        .filter(c => (!linkId || c.link_id === linkId))
        .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
        .slice(0, limit || 50);
    },
    async listKeys() { return []; },
    async createKey() { throw new Error('Les clés d’API nécessitent le backend Supabase.'); },
    async revokeKey() { throw new Error('Les clés d’API nécessitent le backend Supabase.'); },
    async importConversions() { throw new Error('L’import de conversions nécessite le backend Supabase.'); },
    async reattribute() { throw new Error('L’attribution serveur nécessite le backend Supabase.'); },
  };

  /* ─── Stockage cloud (Supabase + RLS) ───────────────────────────────── */

  function sb() { return (window.VMB && window.VMB.client) || null; }

  const CloudStore = {
    mode: 'cloud',
    userId: null,
    async _rows(query) {
      const res = await query;
      if (res.error) throw new Error(res.error.message || 'Erreur backend');
      return res.data || [];
    },
    async listModels() {
      const [models, stats] = await Promise.all([
        this._rows(sb().from('tl_models').select('*').order('name')),
        this._rows(sb().from('tl_model_stats').select('*')),
      ]);
      const byId = {};
      stats.forEach(s => (byId[s.model_id] = s));
      return models.map(m => {
        const s = byId[m.id] || {};
        return Object.assign({}, m, {
          links: Number(s.links || 0),
          stats: Object.assign(emptyStats(), {
            clicks: Number(s.clicks || 0), unique_visitors: Number(s.unique_visitors || 0),
            fans: Number(s.fans || 0), revenue: Number(s.revenue || 0),
            conversion_rate: Number(s.conversion_rate || 0),
          }),
        });
      });
    },
    async createModel(data) {
      const rows = await this._rows(sb().from('tl_models').insert({
        owner_id: this.userId, name: String(data.name || '').trim(),
        handle: (data.handle || '').trim() || null,
      }).select());
      return rows[0];
    },
    async listCampaigns() { return this._rows(sb().from('tl_campaigns').select('*').order('name')); },
    async createCampaign(name) {
      const n = String(name || '').trim();
      if (!n) return null;
      const existing = await this._rows(sb().from('tl_campaigns').select('*').ilike('name', n));
      if (existing.length) return existing[0];
      const rows = await this._rows(sb().from('tl_campaigns').insert({ owner_id: this.userId, name: n }).select());
      return rows[0];
    },
    async listLinks() {
      const [links, stats] = await Promise.all([
        this._rows(sb().from('tl_links')
          .select('*, model:tl_models(id,name), campaign:tl_campaigns(id,name)')
          .is('deleted_at', null).order('created_at', { ascending: false })),
        this._rows(sb().from('tl_link_stats').select('*')),
      ]);
      const byId = {};
      stats.forEach(s => (byId[s.link_id] = s));
      return links.map(l => {
        const s = byId[l.id] || {};
        return Object.assign({}, l, {
          model_name: l.model ? l.model.name : null,
          campaign_name: l.campaign ? l.campaign.name : null,
          stats: Object.assign(emptyStats(), {
            clicks: Number(s.clicks || 0), unique_visitors: Number(s.unique_visitors || 0),
            clicks_today: Number(s.clicks_today || 0), clicks_7d: Number(s.clicks_7d || 0),
            clicks_30d: Number(s.clicks_30d || 0), conversions: Number(s.conversions || 0),
            fans: Number(s.fans || 0), revenue: Number(s.revenue || 0),
            conversion_rate: Number(s.conversion_rate || 0),
            revenue_per_visitor: Number(s.revenue_per_visitor || 0),
            revenue_per_fan: Number(s.revenue_per_fan || 0),
          }),
        });
      });
    },
    async getLink(id) { return (await this.listLinks()).find(l => l.id === id) || null; },
    async slugTaken(slug, exceptId) {
      // Le slug est unique sur tout le domaine : un conflit peut venir d'un
      // autre compte, auquel cas la RLS ne le montre pas — l'insertion
      // renverra alors une erreur d'unicité, traitée à la création.
      const rows = await this._rows(sb().from('tl_links').select('id').eq('slug', slug).is('deleted_at', null));
      return rows.some(r => r.id !== exceptId);
    },
    async createLink(data) {
      const rows = await this._rows(sb().from('tl_links').insert({
        owner_id: this.userId, model_id: data.model_id || null, campaign_id: data.campaign_id || null,
        name: data.name, slug: data.slug, destination_url: data.destination_url,
        source_code: data.source_code || 'other', status: data.status || 'active',
        attribution_window_days: data.attribution_window_days || 30,
      }).select());
      return rows[0];
    },
    async updateLink(id, patch) {
      const rows = await this._rows(sb().from('tl_links').update(patch).eq('id', id).select());
      return rows[0];
    },
    async deleteLink(id) {
      // Suppression logique : les clics et conversions historiques restent
      // cohérents, le slug est immédiatement réutilisable.
      await this._rows(sb().from('tl_links').update({ deleted_at: new Date().toISOString() }).eq('id', id).select());
    },
    async daily(linkId, days) {
      let q = sb().from('tl_link_daily').select('*').eq('link_id', linkId).order('day');
      if (days) q = q.gte('day', dayKey(Date.now() - days * 864e5));
      const rows = await this._rows(q);
      return rows.map(r => ({
        day: String(r.day).slice(0, 10), clicks: Number(r.clicks || 0),
        conversions: Number(r.conversions || 0), revenue: Number(r.revenue || 0),
      }));
    },
    async sources(linkId) {
      const rows = await this._rows(sb().from('tl_link_sources').select('*').eq('link_id', linkId));
      return rows.map(r => ({ source_code: r.source_code, clicks: Number(r.clicks || 0) }))
        .sort((a, b) => b.clicks - a.clicks);
    },
    async conversions(linkId, limit) {
      let q = sb().from('tl_conversions').select('*').order('occurred_at', { ascending: false }).limit(limit || 50);
      if (linkId) q = q.eq('link_id', linkId);
      return this._rows(q);
    },
    async listKeys() {
      return this._rows(sb().from('tl_ingest_keys')
        .select('id,name,prefix,created_at,last_used_at,revoked_at').order('created_at', { ascending: false }));
    },
    async createKey(name) {
      const res = await sb().rpc('tl_create_ingest_key', { p_name: name || 'API key' });
      if (res.error) throw new Error(res.error.message);
      if (!res.data || !res.data.ok) throw new Error((res.data && res.data.error) || 'Création impossible');
      return res.data;
    },
    async revokeKey(id) {
      await this._rows(sb().from('tl_ingest_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).select());
    },
    async importConversions(rows) {
      const res = await sb().rpc('tl_import_conversions', { p_rows: rows });
      if (res.error) throw new Error(res.error.message);
      if (!res.data || !res.data.ok) throw new Error((res.data && res.data.error) || 'Import impossible');
      return res.data;
    },
    async reattribute() {
      const res = await sb().rpc('tl_reattribute_pending');
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
  };

  let Store = LocalStore;
  let backendIssue = null;   // message expliquant pourquoi on est retombé en local

  async function pickStore() {
    const client = sb();
    if (!client || !window.VMB || !window.VMB.enabled) {
      backendIssue = null;
      Store = LocalStore;
      return Store;
    }
    try {
      const s = await client.auth.getSession();
      const user = s.data.session && s.data.session.user;
      if (!user) { backendIssue = null; Store = LocalStore; return Store; }
      // Le schéma est-il installé ?
      const probe = await client.from('tl_links').select('id').limit(1);
      if (probe.error) {
        backendIssue = /relation|does not exist|schema cache/i.test(probe.error.message || '')
          ? 'schema'
          : (probe.error.message || 'backend');
        Store = LocalStore;
        return Store;
      }
      CloudStore.userId = user.id;
      backendIssue = null;
      Store = CloudStore;
    } catch (e) {
      backendIssue = e.message || 'backend';
      Store = LocalStore;
    }
    return Store;
  }

  /* ─── État de l'interface ───────────────────────────────────────────── */

  const UI = {
    links: [], models: [], campaigns: [],
    filters: { q: '', model: '', source: '', campaign: '', status: '', range: 'all' },
    sort: { key: 'created_at', dir: 'desc' },
    detail: { link: null, metric: 'clicks', range: 30, daily: [], sources: [], conversions: [] },
    model: null,
    loading: false,
    loaded: false,   // les données ont déjà été lues au moins une fois
  };

  const ICONS = {
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor" style="width:15px;height:15px;"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 8-8"/><path d="m16 6 2 2"/><path d="m19 3 2 2"/></svg>',
  };

  /* ─── Création des vues (injectées une seule fois) ──────────────────── */

  function ensureViews() {
    const main = document.querySelector('.main');
    if (!main || document.getElementById('v-tracking')) return;
    ['tracking', 'tracking-link', 'tracking-models', 'tracking-model'].forEach(id => {
      const v = document.createElement('div');
      v.id = 'v-' + id;
      v.className = 'view';
      main.appendChild(v);
    });
    // Redimensionnement : le graphique est retracé à la nouvelle largeur
    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        const v = document.getElementById('v-tracking-link');
        if (!v || !v.classList.contains('on') || !UI.detail.link) return;
        renderChartInto(v.querySelector('#vtl-chart'),
          seriesFor(UI.detail.daily, UI.detail.range), UI.detail.metric);
      }, 180);
    });

    // Fermeture des menus contextuels
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      closeMenus();
      const open = document.querySelector('.vtl-modal.open');
      if (open) open.classList.remove('open');
    });
  }

  function goto(view) {
    ensureViews();
    if (typeof showV === 'function') showV(view);
    const btn = document.getElementById('nb-tracking');
    if (btn) btn.classList.add('active');
  }

  /* ─── Bandeau explicatif selon le mode ──────────────────────────────── */

  function modeNote() {
    if (Store.mode === 'cloud') return '';
    const why = backendIssue === 'schema'
      ? 'Le schéma <b>tracking/schema.sql</b> n’est pas encore installé sur le projet Supabase.'
      : (window.VMB && window.VMB.enabled
        ? 'Aucune session cloud active : connecte-toi avec un compte Supabase pour activer le suivi réel.'
        : 'Le backend Supabase n’est pas configuré (voir <b>tracking/README.md</b>).');
    return `<div class="vtl-note warn">${ICONS.info}<div><b>Mode local</b> — ${why}
      Les liens créés ici sont conservés dans le navigateur : ils ne redirigent pas encore et
      <b>aucun clic, revenu ou fan n’est mesuré</b>. Les compteurs restent volontairement à zéro plutôt
      que d’afficher des chiffres inventés.</div></div>`;
  }

  /* ─── Filtres, tri, agrégats ────────────────────────────────────────── */

  function applyFilters(links) {
    const f = UI.filters;
    const q = f.q.trim().toLowerCase();
    const minDate = f.range === 'all' ? null : Date.now() - Number(f.range) * 864e5;
    return links.filter(l => {
      if (q) {
        const hay = [l.name, l.slug, l.model_name, l.campaign_name, l.destination_url]
          .filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (f.model && l.model_id !== f.model) return false;
      if (f.source && l.source_code !== f.source) return false;
      if (f.campaign && l.campaign_id !== f.campaign) return false;
      if (f.status && l.status !== f.status) return false;
      if (minDate && new Date(l.created_at).getTime() < minDate) return false;
      return true;
    });
  }

  function sortLinks(links) {
    const { key, dir } = UI.sort;
    const val = l => {
      if (key === 'created_at') return new Date(l.created_at).getTime();
      if (key === 'name') return String(l.name || '').toLowerCase();
      return Number(l.stats[key] || 0);
    };
    return links.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      return (x > y ? 1 : -1) * (dir === 'asc' ? 1 : -1);
    });
  }

  function totals(links) {
    const t = { clicks: 0, unique_visitors: 0, conversions: 0, fans: 0, revenue: 0, active: 0 };
    links.forEach(l => {
      t.clicks += l.stats.clicks; t.unique_visitors += l.stats.unique_visitors;
      t.conversions += l.stats.conversions; t.fans += l.stats.fans; t.revenue += l.stats.revenue;
      if (l.status === 'active') t.active++;
    });
    t.conversion_rate = t.unique_visitors ? round2(100 * t.conversions / t.unique_visitors) : 0;
    return t;
  }

  /* ─── Vue principale : Tracking Links ───────────────────────────────── */

  // `refresh` force une relecture. Filtrer, chercher ou trier se fait sur les
  // données déjà en mémoire : aucune requête réseau à chaque frappe.
  async function renderList(refresh) {
    ensureViews();
    const view = document.getElementById('v-tracking');
    if (!view) return;
    if (!UI.loaded && !UI.loading) view.innerHTML = skeleton('Tracking Links');
    if (refresh || !UI.loaded) await reload();

    const filtered = sortLinks(applyFilters(UI.links));
    const t = totals(UI.links);
    const hasData = t.clicks > 0 || t.revenue > 0;

    view.innerHTML = `
      <div class="vtl-head">
        <div class="vtl-head-row">
          <div>
            <div class="vtl-title">${ICONS.link}Tracking Links</div>
            <div class="vtl-sub">Un lien court par modèle et par plateforme — placé en bio, il redirige vers la page
              d’abonnement et mesure clics, visiteurs uniques et conversions attribuées.</div>
          </div>
          <div style="display:flex;gap:9px;flex-wrap:wrap;">
            <button class="vtl-btn" data-act="models">${ICONS.users}Models</button>
            <button class="vtl-btn" data-act="integration">${ICONS.key}Attribution &amp; API</button>
            <button class="vtl-btn vtl-btn-primary" data-act="create">${ICONS.plus}Create Link</button>
          </div>
        </div>
      </div>
      <div class="vtl-scroll">
        ${modeNote()}
        <div class="vtl-kpis">
          ${kpi('Total clicks', num(t.clicks))}
          ${kpi('Unique visitors', num(t.unique_visitors))}
          ${kpi('Revenue attributed', hasData || t.revenue ? money(t.revenue) : '—', t.revenue ? '' : 'En attente d’une source de conversion')}
          ${kpi('Fans attributed', t.fans ? num(t.fans) : '—', t.fans ? '' : 'En attente d’une source de conversion')}
          ${kpi('Conversion rate', pct(t.conversion_rate), `${num(t.active)} lien(s) actif(s) sur ${num(UI.links.length)}`)}
        </div>

        <div class="vtl-filters">
          <div class="vtl-search">${ICONS.search}
            <input class="vtl-input" id="vtl-q" type="search" placeholder="Rechercher un lien, un slug, une modèle…" value="${esc(UI.filters.q)}">
          </div>
          ${select('vtl-f-model', 'Model', UI.models.map(m => ({ v: m.id, l: m.name })), UI.filters.model)}
          ${select('vtl-f-source', 'Source', SOURCES.map(s => ({ v: s.code, l: s.label })), UI.filters.source)}
          ${select('vtl-f-campaign', 'Campaign', UI.campaigns.map(c => ({ v: c.id, l: c.name })), UI.filters.campaign)}
          ${select('vtl-f-status', 'Status', [{ v: 'active', l: 'Active' }, { v: 'paused', l: 'Paused' }], UI.filters.status)}
          ${select('vtl-f-range', 'Date', [{ v: '7', l: '7 derniers jours' }, { v: '30', l: '30 derniers jours' }, { v: '90', l: '90 derniers jours' }], UI.filters.range === 'all' ? '' : UI.filters.range, 'Toutes les dates')}
          <select class="vtl-select" id="vtl-sort">
            ${[['created_at', 'Trier : Created date'], ['revenue', 'Trier : Revenue'], ['fans', 'Trier : Fans'],
               ['clicks', 'Trier : Clicks'], ['conversion_rate', 'Trier : Conversion rate']]
              .map(([v, l]) => `<option value="${v}" ${UI.sort.key === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>

        ${filtered.length ? linksTable(filtered) : emptyState(UI.links.length > 0)}
      </div>`;

    wireList(view);
  }

  function skeleton(title) {
    return `<div class="vtl-head"><div class="vtl-title">${ICONS.link}${esc(title)}</div></div>
            <div class="vtl-scroll"><div class="vtl-empty"><p>Chargement…</p></div></div>`;
  }

  function kpi(label, value, hint) {
    return `<div class="vtl-kpi">
      <div class="vtl-kpi-label">${esc(label)}</div>
      <div class="vtl-kpi-value${value === '—' ? ' vtl-muted' : ''}">${value}</div>
      ${hint ? `<div class="vtl-kpi-hint">${esc(hint)}</div>` : ''}
    </div>`;
  }

  function select(id, label, options, value, allLabel) {
    return `<select class="vtl-select" id="${id}">
      <option value="">${esc(allLabel || 'Tous : ' + label)}</option>
      ${options.map(o => `<option value="${esc(o.v)}" ${String(value) === String(o.v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}
    </select>`;
  }

  function statusPill(status) {
    return `<span class="vtl-pill ${status === 'active' ? 'active' : 'paused'}">${status === 'active' ? 'Active' : 'Paused'}</span>`;
  }

  function th(label, key, numeric) {
    const on = UI.sort.key === key;
    return `<th class="${numeric ? 'vtl-num ' : ''}vtl-sortable" data-sort="${key}" style="${numeric ? 'text-align:right;' : ''}">
      ${esc(label)}${on ? `<span class="vtl-sort-mark">${UI.sort.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`;
  }

  function linksTable(links) {
    return `<div class="vtl-table-wrap"><table class="vtl-table">
      <thead><tr>
        ${th('Link', 'name')}
        ${th('Created', 'created_at')}
        ${th('Clicks', 'clicks', true)}
        ${th('Unique visitors', 'unique_visitors', true)}
        ${th('Conversion rate', 'conversion_rate', true)}
        <th>Status</th>
        ${th('Revenue', 'revenue', true)}
        ${th('Fans', 'fans', true)}
        <th></th>
      </tr></thead>
      <tbody>${links.map(rowHtml).join('')}</tbody>
    </table></div>`;
  }

  function rowHtml(l) {
    const s = l.stats;
    return `<tr data-link="${esc(l.id)}">
      <td>
        <div class="vtl-link-cell">
          <div class="vtl-avatar">${esc(initials(l.model_name || l.name))}</div>
          <div>
            <div class="vtl-link-name">${esc(l.model_name || l.name)}
              ${l.demo ? '<span class="vtl-tag vtl-demo-tag" style="margin-left:6px;">DEMO</span>' : ''}</div>
            <div class="vtl-link-slug">/${esc(l.slug)}${l.model_name ? ' · ' + esc(l.name) : ''}</div>
          </div>
        </div>
      </td>
      <td>${esc(dateLabel(l.created_at))}</td>
      <td class="vtl-num">${num(s.clicks)}</td>
      <td class="vtl-num">${num(s.unique_visitors)}</td>
      <td class="vtl-num">${pct(s.conversion_rate)}</td>
      <td>${statusPill(l.status)}</td>
      <td class="vtl-num">${s.revenue ? money(s.revenue) : '<span style="color:var(--vtl-text-3)">—</span>'}</td>
      <td class="vtl-num">${s.fans ? num(s.fans) : '<span style="color:var(--vtl-text-3)">—</span>'}</td>
      <td class="vtl-row-actions"><button class="vtl-dots" data-menu="${esc(l.id)}" title="Actions">${ICONS.dots}</button></td>
    </tr>`;
  }

  function emptyState(filtered) {
    if (filtered) {
      return `<div class="vtl-card"><div class="vtl-empty">
        <div class="vtl-empty-icon">${ICONS.search}</div>
        <h3>Aucun lien ne correspond</h3>
        <p>Modifie la recherche ou les filtres pour retrouver tes liens de tracking.</p>
        <button class="vtl-btn" data-act="reset-filters">Réinitialiser les filtres</button>
      </div></div>`;
    }
    return `<div class="vtl-card"><div class="vtl-empty">
      <div class="vtl-empty-icon">${ICONS.link}</div>
      <h3>Aucun lien de tracking</h3>
      <p>Crée un lien court par modèle et par plateforme — par exemple <code>${esc(publicUrl('emma'))}</code> —
         à placer en bio Instagram ou TikTok.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="vtl-btn vtl-btn-primary" data-act="create">${ICONS.plus}Create Link</button>
        ${Store.mode === 'local' ? '<button class="vtl-btn vtl-btn-ghost" data-act="demo">Charger un jeu de démonstration</button>' : ''}
      </div>
    </div></div>`;
  }

  function wireList(view) {
    view.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const act = b.getAttribute('data-act');
      if (act === 'create') openLinkModal(null);
      else if (act === 'models') openModels();
      else if (act === 'integration') openIntegrationModal();
      else if (act === 'demo') seedDemo();
      else if (act === 'reset-filters') {
        UI.filters = { q: '', model: '', source: '', campaign: '', status: '', range: 'all' };
        renderList();
      }
    }));

    const q = view.querySelector('#vtl-q');
    if (q) {
      let t;
      q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          UI.filters.q = q.value;
          const pos = q.selectionStart;
          renderList().then(() => {
            const nq = document.getElementById('vtl-q');
            if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) {} }
          });
        }, 220);
      });
    }
    const bind = (id, key) => {
      const el = view.querySelector('#' + id);
      if (el) el.addEventListener('change', () => {
        UI.filters[key] = el.value || (key === 'range' ? 'all' : '');
        renderList();
      });
    };
    bind('vtl-f-model', 'model'); bind('vtl-f-source', 'source');
    bind('vtl-f-campaign', 'campaign'); bind('vtl-f-status', 'status'); bind('vtl-f-range', 'range');

    const sort = view.querySelector('#vtl-sort');
    if (sort) sort.addEventListener('change', () => {
      UI.sort = { key: sort.value, dir: sort.value === 'name' ? 'asc' : 'desc' };
      renderList();
    });

    view.querySelectorAll('th[data-sort]').forEach(h => h.addEventListener('click', () => {
      const key = h.getAttribute('data-sort');
      UI.sort = UI.sort.key === key
        ? { key: key, dir: UI.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key: key, dir: key === 'name' ? 'asc' : 'desc' };
      renderList();
    }));

    view.querySelectorAll('tr[data-link]').forEach(tr => tr.addEventListener('click', () => {
      openLink(tr.getAttribute('data-link'));
    }));

    view.querySelectorAll('[data-menu]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      openMenu(btn, UI.links.find(l => l.id === btn.getAttribute('data-menu')));
    }));
  }

  async function reload() {
    UI.loading = true;
    try {
      const [links, models, campaigns] = await Promise.all([
        Store.listLinks(), Store.listModels(), Store.listCampaigns(),
      ]);
      UI.links = links; UI.models = models; UI.campaigns = campaigns;
      UI.loaded = true;
    } catch (e) {
      console.warn('[tracking] chargement impossible', e);
      toast('Chargement impossible : ' + (e.message || 'erreur'));
    }
    UI.loading = false;
  }

  /* ─── Menu d'actions d'un lien ──────────────────────────────────────── */

  function closeMenus() {
    document.querySelectorAll('.vtl-menu.open').forEach(m => m.remove());
  }

  function openMenu(anchor, link) {
    closeMenus();
    if (!link) return;
    const menu = document.createElement('div');
    menu.className = 'vtl-menu open';
    menu.innerHTML = `
      <button data-a="copy">Copy link</button>
      <button data-a="open">Open destination</button>
      <div class="vtl-menu-sep"></div>
      <button data-a="edit">Edit</button>
      <button data-a="toggle">${link.status === 'active' ? 'Pause' : 'Activate'}</button>
      <button data-a="duplicate">Duplicate</button>
      <div class="vtl-menu-sep"></div>
      <button data-a="delete" class="vtl-danger">Delete</button>`;
    document.body.appendChild(menu);

    const r = anchor.getBoundingClientRect();
    const w = 190, h = menu.offsetHeight || 220;
    menu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';

    menu.addEventListener('click', async e => {
      e.stopPropagation();
      const btn = e.target.closest('button');
      if (!btn) return;
      closeMenus();
      await linkAction(btn.getAttribute('data-a'), link);
    });
  }

  async function linkAction(action, link) {
    try {
      if (action === 'copy') return copy(publicUrl(link.slug));
      if (action === 'open') return window.open(link.destination_url, '_blank', 'noopener,noreferrer');
      if (action === 'edit') return openLinkModal(link);
      if (action === 'toggle') {
        await Store.updateLink(link.id, { status: link.status === 'active' ? 'paused' : 'active' });
        toast(link.status === 'active' ? 'Lien mis en pause' : 'Lien activé');
      } else if (action === 'duplicate') {
        let slug = (link.slug + '-copy').slice(0, 48), i = 2;
        while (await Store.slugTaken(slug)) slug = (link.slug + '-copy' + i++).slice(0, 48);
        await Store.createLink({
          model_id: link.model_id, campaign_id: link.campaign_id,
          name: link.name + ' (copie)', slug: slug, destination_url: link.destination_url,
          source_code: link.source_code, status: 'paused',
          attribution_window_days: link.attribution_window_days,
        });
        toast('Lien dupliqué (en pause)');
      } else if (action === 'delete') {
        if (!confirm(`Supprimer le lien « ${link.name} » (/${link.slug}) ?\n\nLes statistiques associées ne seront plus affichées.`)) return;
        await Store.deleteLink(link.id);
        toast('Lien supprimé');
      }
    } catch (e) {
      toast('Action impossible : ' + (e.message || 'erreur'));
      return;
    }
    // Les données en mémoire viennent de changer : on les relit avant de
    // réafficher la vue courante.
    await reload();
    const onDetail = document.getElementById('v-tracking-link').classList.contains('on');
    const onModel = document.getElementById('v-tracking-model').classList.contains('on');
    if (action === 'delete') {
      if (onModel && UI.model) return openModel(UI.model.id);
      goto('tracking');
      return renderList();
    }
    if (onDetail) return openLink(link.id);
    if (onModel && UI.model) return openModel(UI.model.id);
    renderList();
  }

  /* ─── Page détail d'un lien ─────────────────────────────────────────── */

  async function openLink(id) {
    goto('tracking-link');
    const view = document.getElementById('v-tracking-link');
    view.innerHTML = skeleton('Tracking Link');
    if (!UI.loaded) await reload();

    let link = UI.links.find(l => l.id === id);
    if (!link) { try { link = await Store.getLink(id); } catch (e) {} }
    if (!link) { toast('Lien introuvable'); return renderList().then(() => goto('tracking')); }

    let daily = [], sources = [], convs = [];
    try {
      [daily, sources, convs] = await Promise.all([
        Store.daily(link.id, null), Store.sources(link.id), Store.conversions(link.id, 50),
      ]);
    } catch (e) { console.warn('[tracking] détail incomplet', e); }

    UI.detail = { link, metric: UI.detail.metric || 'clicks', range: UI.detail.range || 30, daily, sources, convs };
    renderDetail();
  }

  function renderDetail() {
    const view = document.getElementById('v-tracking-link');
    const { link, metric, range, daily, sources, convs } = UI.detail;
    const s = link.stats;
    const points = seriesFor(daily, range);
    const sum = {
      clicks: points.reduce((a, p) => a + p.clicks, 0),
      conversions: points.reduce((a, p) => a + p.conversions, 0),
      revenue: round2(points.reduce((a, p) => a + p.revenue, 0)),
    };
    const totalSourceClicks = sources.reduce((a, x) => a + x.clicks, 0);

    view.innerHTML = `
      <div class="vtl-head">
        <button class="vtl-back" data-act="back">${ICONS.back}Tracking Links</button>
        <div class="vtl-head-row">
          <div>
            <div class="vtl-title">${esc(link.model_name || link.name)}
              <span style="color:var(--vtl-text-3);font-weight:400;">/</span>
              <span style="font-size:15px;color:var(--vtl-text-2);font-weight:500;">${esc(link.name)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;margin-top:9px;flex-wrap:wrap;">
              <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--vtl-accent-2);">${esc(publicUrl(link.slug))}</code>
              ${statusPill(link.status)}
              <span class="vtl-tag">${esc(SOURCE_LABEL[link.source_code] || 'Other')}</span>
              ${link.campaign_name ? `<span class="vtl-tag">${esc(link.campaign_name)}</span>` : ''}
              <span class="vtl-tag">Fenêtre d’attribution : ${Number(link.attribution_window_days)} j</span>
            </div>
          </div>
          <div style="display:flex;gap:9px;flex-wrap:wrap;">
            <button class="vtl-btn" data-a="copy">Copy link</button>
            <button class="vtl-btn" data-a="open">Open destination</button>
            <button class="vtl-btn" data-a="edit">Edit</button>
            <button class="vtl-btn" data-a="toggle">${link.status === 'active' ? 'Pause' : 'Activate'}</button>
            <button class="vtl-btn" data-a="duplicate">Duplicate</button>
            <button class="vtl-btn vtl-btn-danger" data-a="delete">Delete</button>
          </div>
        </div>
      </div>

      <div class="vtl-scroll">
        ${modeNote()}
        ${attributionNote(s)}

        <div class="vtl-kpis vtl-kpis-lg">
          ${kpi('Clicks', num(s.clicks), `${num(s.unique_visitors)} visiteurs uniques`)}
          ${kpi('Fans', s.fans ? num(s.fans) : '—', s.fans ? 'attribués' : 'aucune conversion reçue')}
          ${kpi('Revenue', s.revenue ? money(s.revenue) : '—', s.revenue ? 'attribué' : 'aucune conversion reçue')}
          ${kpi('Conversion rate', pct(s.conversion_rate), 'conversions / visiteurs uniques')}
        </div>

        <div class="vtl-card">
          <div class="vtl-card-head">
            <div><div class="vtl-card-title">Performance</div>
              <div class="vtl-card-sub">Clics, conversions attribuées et revenu attribué, jour par jour.</div></div>
            <div class="vtl-chart-tabs">
              ${[[7, '7D'], [30, '30D'], [90, '90D'], [0, 'All time']].map(([v, l]) =>
                `<button data-range="${v}" class="${range === v ? 'on' : ''}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="vtl-metrics">
            <button class="vtl-metric ${metric === 'clicks' ? 'on' : ''}" data-metric="clicks">
              <div class="l">Clicks</div><div class="v">${num(sum.clicks)}</div></button>
            <button class="vtl-metric ${metric === 'conversions' ? 'on' : ''}" data-metric="conversions">
              <div class="l">Conversions</div><div class="v">${num(sum.conversions)}</div></button>
            <button class="vtl-metric ${metric === 'revenue' ? 'on' : ''}" data-metric="revenue">
              <div class="l">Revenue</div><div class="v">${sum.revenue ? money(sum.revenue) : '—'}</div></button>
          </div>
          <div class="vtl-chart" id="vtl-chart"></div>
        </div>

        <div class="vtl-grid-2">
          <div class="vtl-card">
            <div class="vtl-card-head"><div><div class="vtl-card-title">Traffic sources</div>
              <div class="vtl-card-sub">Répartition des clics par plateforme.</div></div></div>
            <div class="vtl-card-body">
              ${totalSourceClicks ? `<div class="vtl-bars">${sources.map(x => `
                <div class="vtl-bar-row">
                  <div>${esc(SOURCE_LABEL[x.source_code] || x.source_code)}</div>
                  <div class="vtl-bar-track"><div class="vtl-bar-fill" style="width:${Math.round(100 * x.clicks / totalSourceClicks)}%"></div></div>
                  <div class="vtl-bar-val">${num(x.clicks)}<span>${Math.round(100 * x.clicks / totalSourceClicks)}%</span></div>
                </div>`).join('')}</div>`
                : `<div style="font-size:13px;color:var(--vtl-text-3);">Aucun clic enregistré pour l’instant.</div>`}
            </div>
          </div>

          <div class="vtl-card">
            <div class="vtl-card-head"><div><div class="vtl-card-title">Revenue</div>
              <div class="vtl-card-sub">Uniquement le revenu reçu d’une source autorisée et attribué à ce lien.</div></div></div>
            <div class="vtl-card-body">
              <div class="vtl-kv"><span class="k">Revenue attributed</span><span class="v">${s.revenue ? money(s.revenue) : '—'}</span></div>
              <div class="vtl-kv"><span class="k">Average revenue per fan</span><span class="v">${s.revenue_per_fan ? money(s.revenue_per_fan) : '—'}</span></div>
              <div class="vtl-kv"><span class="k">Average revenue per visitor</span><span class="v">${s.revenue_per_visitor ? money(s.revenue_per_visitor) : '—'}</span></div>
              <div class="vtl-kv"><span class="k">Conversions attribuées</span><span class="v">${num(s.conversions)}</span></div>
            </div>
          </div>
        </div>

        <div class="vtl-card">
          <div class="vtl-card-head">
            <div><div class="vtl-card-title">Conversions</div>
              <div class="vtl-card-sub">Conversions attribuées à ce lien. Aucune donnée personnelle n’est stockée ni affichée.</div></div>
            <button class="vtl-btn vtl-btn-sm" data-act="integration">${ICONS.key}Source de conversion</button>
          </div>
          ${convs.length ? `<div class="vtl-table-wrap" style="border:0;border-radius:0;">
            <table class="vtl-table" style="min-width:640px;">
              <thead><tr><th>Date</th><th class="vtl-num" style="text-align:right;">Amount</th><th>Currency</th><th>Source</th><th>Tracking link</th><th>Status</th></tr></thead>
              <tbody>${convs.map(c => `<tr style="cursor:default;">
                <td>${esc(dateLabel(c.occurred_at))}</td>
                <td class="vtl-num">${money(c.amount, c.currency)}</td>
                <td>${esc(c.currency)}</td>
                <td>${esc(c.source === 'api' ? 'API' : c.source === 'import' ? 'Import' : 'Manuel')}</td>
                <td><span class="vtl-link-slug">/${esc(link.slug)}</span></td>
                <td>${c.status === 'attributed' ? '<span class="vtl-pill active">Attributed</span>' : '<span class="vtl-pill">Unattributed</span>'}</td>
              </tr>`).join('')}</tbody>
            </table></div>`
            : `<div class="vtl-empty" style="padding:36px 24px;">
                <p>Aucune conversion reçue pour ce lien. Le revenu et les fans ne peuvent pas être déduits des clics :
                   ils proviennent uniquement d’une source autorisée (API ou import).</p>
                <button class="vtl-btn" data-act="integration">Configurer la source de conversion</button>
              </div>`}
        </div>
      </div>`;

    view.querySelector('[data-act="back"]').addEventListener('click', () => { goto('tracking'); renderList(); });
    view.querySelectorAll('[data-act="integration"]').forEach(b => b.addEventListener('click', openIntegrationModal));
    view.querySelectorAll('[data-a]').forEach(b =>
      b.addEventListener('click', () => linkAction(b.getAttribute('data-a'), link)));
    view.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
      UI.detail.range = Number(b.getAttribute('data-range'));
      renderDetail();
    }));
    view.querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => {
      UI.detail.metric = b.getAttribute('data-metric');
      renderDetail();
    }));
    renderChartInto(view.querySelector('#vtl-chart'), points, metric);
  }

  function attributionNote(s) {
    if (s.clicks && !s.conversions) {
      return `<div class="vtl-note">${ICONS.info}<div><b>Attribution en attente.</b> Les clics sont mesurés côté serveur,
        mais le revenu et les fans ne peuvent pas être déduits d’un clic. Ils apparaîtront dès qu’une source autorisée
        enverra ses conversions à l’API d’attribution.</div></div>`;
    }
    return '';
  }

  /* ─── Séries et graphique ───────────────────────────────────────────── */

  // Complète les jours manquants pour éviter un graphique trompeur.
  function seriesFor(daily, days) {
    const byDay = {};
    daily.forEach(r => (byDay[r.day] = r));
    let start, end = new Date();
    if (days) {
      start = new Date(Date.now() - (days - 1) * 864e5);
    } else {
      const first = daily.length ? daily[0].day : dayKey(Date.now() - 29 * 864e5);
      start = new Date(first);
      if ((end - start) / 864e5 > 400) start = new Date(Date.now() - 400 * 864e5);
    }
    const out = [];
    for (let d = new Date(dayKey(start)); d <= end; d = new Date(d.getTime() + 864e5)) {
      const k = dayKey(d);
      const r = byDay[k];
      out.push({ day: k, clicks: r ? r.clicks : 0, conversions: r ? r.conversions : 0, revenue: r ? r.revenue : 0 });
    }
    // Au-delà de 120 points, on agrège par semaine pour rester lisible.
    if (out.length > 120) {
      const weeks = [];
      for (let i = 0; i < out.length; i += 7) {
        const chunk = out.slice(i, i + 7);
        weeks.push({
          day: chunk[0].day,
          clicks: chunk.reduce((a, p) => a + p.clicks, 0),
          conversions: chunk.reduce((a, p) => a + p.conversions, 0),
          revenue: round2(chunk.reduce((a, p) => a + p.revenue, 0)),
          span: chunk.length,
        });
      }
      return weeks;
    }
    return out;
  }

  const CH = { w: 860, h: 250, l: 52, r: 14, t: 16, b: 26 };

  // Le graphique est tracé à la largeur réelle du conteneur : pas d'étirement
  // du texte ni des traits, quelle que soit la taille de la fenêtre.
  function renderChartInto(box, points, metric) {
    if (!box) return;
    const w = Math.max(520, Math.round(box.clientWidth - 16));
    box.innerHTML = chartSVG(points, metric, w) + '<div class="vtl-chart-tip" id="vtl-tip"></div>';
    wireChart(box, points, metric, w);
  }

  function chartSVG(points, metric, width) {
    const W = width || CH.w;
    const vals = points.map(p => Number(p[metric] || 0));
    const max = niceMax(Math.max.apply(null, vals.concat([0])));
    const innerW = W - CH.l - CH.r, innerH = CH.h - CH.t - CH.b;
    const x = i => CH.l + (points.length <= 1 ? innerW / 2 : innerW * i / (points.length - 1));
    const y = v => CH.t + innerH - (max ? innerH * v / max : 0);

    const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(vals.length - 1).toFixed(1)},${(CH.t + innerH).toFixed(1)} L${x(0).toFixed(1)},${(CH.t + innerH).toFixed(1)} Z`;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const v = max * f, yy = y(v);
      return `<line x1="${CH.l}" y1="${yy.toFixed(1)}" x2="${W - CH.r}" y2="${yy.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
              <text x="${CH.l - 10}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#5d5a68">${axisLabel(v, metric)}</text>`;
    }).join('');

    const step = Math.max(1, Math.ceil(points.length / 6));
    const xLabels = points.map((p, i) =>
      (i % step === 0 || i === points.length - 1)
        ? `<text x="${x(i).toFixed(1)}" y="${CH.h - 6}" text-anchor="middle" font-size="10.5" fill="#5d5a68">${shortDay(p.day)}</text>`
        : '').join('');

    return `<svg viewBox="0 0 ${W} ${CH.h}" preserveAspectRatio="none" role="img" aria-label="Évolution ${metric}">
      <defs><linearGradient id="vtlGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3d8ef0" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#3d8ef0" stop-opacity="0"/>
      </linearGradient></defs>
      ${ticks}${xLabels}
      ${vals.length ? `<path d="${area}" fill="url(#vtlGrad)"/><path d="${line}" fill="none" stroke="#3d8ef0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      <circle id="vtl-dot" r="3.5" fill="#3d8ef0" stroke="#050308" stroke-width="2" style="display:none"/>
      <line id="vtl-vline" y1="${CH.t}" y2="${CH.t + innerH}" stroke="rgba(255,255,255,0.16)" stroke-width="1" style="display:none"/>
    </svg>`;
  }

  function niceMax(v) {
    if (!v || v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil(v / mag * 2) / 2 * mag;
  }
  function axisLabel(v, metric) {
    if (metric === 'revenue') return v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v);
    return v >= 1000 ? Math.round(v / 100) / 10 + 'k' : String(Math.round(v));
  }
  function shortDay(day) {
    const d = new Date(day);
    return `${MONTHS[d.getMonth()].replace('.', '')} ${d.getDate()}`;
  }
  function metricValue(p, metric) {
    return metric === 'revenue' ? money(p.revenue) : num(p[metric]);
  }

  function wireChart(box, points, metric, width) {
    const W = width || CH.w;
    if (!box || !points.length) return;
    const svg = box.querySelector('svg');
    const tip = box.querySelector('#vtl-tip');
    const dot = box.querySelector('#vtl-dot');
    const vline = box.querySelector('#vtl-vline');
    const innerW = W - CH.l - CH.r, innerH = CH.h - CH.t - CH.b;
    const max = niceMax(Math.max.apply(null, points.map(p => Number(p[metric] || 0)).concat([0])));

    function move(ev) {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * W;
      let i = Math.round((px - CH.l) / (points.length <= 1 ? innerW : innerW / (points.length - 1)));
      i = Math.max(0, Math.min(points.length - 1, i));
      const p = points[i];
      const cx = CH.l + (points.length <= 1 ? innerW / 2 : innerW * i / (points.length - 1));
      const cy = CH.t + innerH - (max ? innerH * Number(p[metric] || 0) / max : 0);
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.style.display = '';
      vline.setAttribute('x1', cx); vline.setAttribute('x2', cx); vline.style.display = '';
      tip.innerHTML = `<div class="d">${esc(dateLabel(p.day))}${p.span ? ` · ${p.span} j` : ''}</div>
        <b>${metricValue(p, metric)}</b> ${metric === 'revenue' ? 'attribué' : metric}`;
      tip.style.display = 'block';
      const left = rect.left + cx / W * rect.width - box.getBoundingClientRect().left;
      tip.style.left = Math.max(4, Math.min(left - tip.offsetWidth / 2, box.clientWidth - tip.offsetWidth - 4)) + 'px';
      tip.style.top = Math.max(0, cy / CH.h * rect.height - tip.offsetHeight - 12) + 'px';
    }
    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', () => {
      tip.style.display = 'none'; dot.style.display = 'none'; vline.style.display = 'none';
    });
  }

  /* ─── Pages modèles ─────────────────────────────────────────────────── */

  async function openModels() {
    goto('tracking-models');
    const view = document.getElementById('v-tracking-models');
    view.innerHTML = skeleton('Models');
    if (!UI.loaded) await reload();

    view.innerHTML = `
      <div class="vtl-head">
        <button class="vtl-back" data-act="back">${ICONS.back}Tracking Links</button>
        <div class="vtl-head-row">
          <div>
            <div class="vtl-title">${ICONS.users}Models</div>
            <div class="vtl-sub">Chaque modèle regroupe ses propres liens de tracking et ses performances attribuées.</div>
          </div>
          <button class="vtl-btn vtl-btn-primary" data-act="add">${ICONS.plus}Add model</button>
        </div>
      </div>
      <div class="vtl-scroll">
        ${modeNote()}
        ${UI.models.length ? `<div class="vtl-models">${UI.models.map(m => `
          <div class="vtl-model-card" data-model="${esc(m.id)}">
            <div class="vtl-model-top">
              <div class="vtl-avatar">${esc(initials(m.name))}</div>
              <div><div class="vtl-model-name">${esc(m.name)}</div>
                <div class="vtl-model-meta">${num(m.links)} lien(s)${m.handle ? ' · ' + esc(m.handle) : ''}</div></div>
            </div>
            <div class="vtl-model-stats">
              <div class="vtl-model-stat"><div class="l">Clicks</div><div class="v">${num(m.stats.clicks)}</div></div>
              <div class="vtl-model-stat"><div class="l">Fans</div><div class="v">${m.stats.fans ? num(m.stats.fans) : '—'}</div></div>
              <div class="vtl-model-stat"><div class="l">Revenue</div><div class="v">${m.stats.revenue ? money(m.stats.revenue) : '—'}</div></div>
            </div>
          </div>`).join('')}</div>`
        : `<div class="vtl-card"><div class="vtl-empty">
            <div class="vtl-empty-icon">${ICONS.users}</div>
            <h3>Aucune modèle</h3>
            <p>Ajoute une modèle pour regrouper ses liens de tracking et suivre ses performances.</p>
            <button class="vtl-btn vtl-btn-primary" data-act="add">${ICONS.plus}Add model</button>
          </div></div>`}
      </div>`;

    view.querySelector('[data-act="back"]').addEventListener('click', () => { goto('tracking'); renderList(); });
    view.querySelectorAll('[data-act="add"]').forEach(b => b.addEventListener('click', () => openModelModal()));
    view.querySelectorAll('[data-model]').forEach(c =>
      c.addEventListener('click', () => openModel(c.getAttribute('data-model'))));
  }

  async function openModel(id) {
    goto('tracking-model');
    const view = document.getElementById('v-tracking-model');
    view.innerHTML = skeleton('Model');
    if (!UI.loaded) await reload();

    const model = UI.models.find(m => m.id === id);
    if (!model) { toast('Modèle introuvable'); return openModels(); }
    UI.model = model;
    const links = UI.links.filter(l => l.model_id === id);
    const s = model.stats;

    view.innerHTML = `
      <div class="vtl-head">
        <button class="vtl-back" data-act="back">${ICONS.back}Models</button>
        <div class="vtl-head-row">
          <div>
            <div class="vtl-title">${esc(model.name)}</div>
            <div class="vtl-sub">${model.handle ? esc(model.handle) + ' · ' : ''}${num(links.length)} lien(s) de tracking.</div>
          </div>
          <button class="vtl-btn vtl-btn-primary" data-act="create">${ICONS.plus}Create Link</button>
        </div>
      </div>
      <div class="vtl-scroll">
        ${modeNote()}
        <div class="vtl-kpis vtl-kpis-lg">
          ${kpi('Clicks', num(s.clicks), `${num(s.unique_visitors)} visiteurs uniques`)}
          ${kpi('Fans', s.fans ? num(s.fans) : '—', s.fans ? 'attribués' : 'aucune conversion reçue')}
          ${kpi('Revenue', s.revenue ? money(s.revenue) : '—', s.revenue ? 'attribué' : 'aucune conversion reçue')}
          ${kpi('Conversion rate', pct(s.conversion_rate), 'conversions / visiteurs uniques')}
        </div>

        <div class="vtl-card">
          <div class="vtl-card-head"><div><div class="vtl-card-title">Tracking Links</div>
            <div class="vtl-card-sub">Uniquement les liens appartenant à ${esc(model.name)}.</div></div></div>
          ${links.length ? `<div class="vtl-table-wrap" style="border:0;border-radius:0;">
            <table class="vtl-table" style="min-width:720px;">
              <thead><tr><th>Link</th><th>Source</th><th class="vtl-num" style="text-align:right;">Clicks</th>
                <th class="vtl-num" style="text-align:right;">Fans</th><th class="vtl-num" style="text-align:right;">Revenue</th>
                <th class="vtl-num" style="text-align:right;">Conversion</th><th>Status</th><th></th></tr></thead>
              <tbody>${links.map(l => `<tr data-link="${esc(l.id)}">
                <td><div class="vtl-link-name">${esc(l.name)}</div><div class="vtl-link-slug">/${esc(l.slug)}</div></td>
                <td>${esc(SOURCE_LABEL[l.source_code] || l.source_code)}</td>
                <td class="vtl-num">${num(l.stats.clicks)}</td>
                <td class="vtl-num">${l.stats.fans ? num(l.stats.fans) : '—'}</td>
                <td class="vtl-num">${l.stats.revenue ? money(l.stats.revenue) : '—'}</td>
                <td class="vtl-num">${pct(l.stats.conversion_rate)}</td>
                <td>${statusPill(l.status)}</td>
                <td class="vtl-row-actions"><button class="vtl-dots" data-menu="${esc(l.id)}">${ICONS.dots}</button></td>
              </tr>`).join('')}</tbody></table></div>`
            : `<div class="vtl-empty" style="padding:36px 24px;">
                <p>Aucun lien pour cette modèle.</p>
                <button class="vtl-btn vtl-btn-primary" data-act="create">${ICONS.plus}Create Link</button></div>`}
        </div>
      </div>`;

    view.querySelector('[data-act="back"]').addEventListener('click', openModels);
    view.querySelectorAll('[data-act="create"]').forEach(b =>
      b.addEventListener('click', () => openLinkModal(null, model.id)));
    view.querySelectorAll('tr[data-link]').forEach(tr => tr.addEventListener('click', () => openLink(tr.getAttribute('data-link'))));
    view.querySelectorAll('[data-menu]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      openMenu(btn, UI.links.find(l => l.id === btn.getAttribute('data-menu')));
    }));
  }

  /* ─── Modales ───────────────────────────────────────────────────────── */

  function modal(id, html, wide) {
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'vtl-modal open';
    el.innerHTML = `<div class="vtl-modal-box${wide ? ' wide' : ''}">${html}</div>`;
    el.addEventListener('click', e => { if (e.target === el) el.remove(); });
    document.body.appendChild(el);
    return el;
  }

  function openLinkModal(link, presetModelId) {
    const editing = !!link;
    const modelOptions = UI.models.map(m =>
      `<option value="${esc(m.id)}" ${(link ? link.model_id : presetModelId) === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

    const el = modal('vtl-link-modal', `
      <div class="vtl-modal-head">
        <h3>${editing ? 'Modifier le lien' : 'Nouveau tracking link'}</h3>
        <p>Le lien public est de la forme <code>${esc(BASE)}/slug</code>. Le slug est unique et ne peut pas être un mot réservé.</p>
      </div>
      <div class="vtl-modal-body">
        <div class="vtl-field">
          <label>Model</label>
          <select class="vtl-select" id="vtl-m-model">
            <option value="">— Aucune —</option>
            ${modelOptions}
            <option value="__new">＋ Nouvelle modèle…</option>
          </select>
          <input class="vtl-input" id="vtl-m-model-new" placeholder="Nom de la modèle" style="display:none;margin-top:8px;">
        </div>
        <div class="vtl-field">
          <label>Link name</label>
          <input class="vtl-input" id="vtl-m-name" placeholder="Instagram Bio" value="${esc(link ? link.name : '')}">
          <div class="vtl-field-hint">Nom interne, visible uniquement dans ce tableau de bord.</div>
        </div>
        <div class="vtl-field">
          <label>Slug</label>
          <div class="vtl-prefix"><span>${esc(BASE.replace(/^https?:\/\//, ''))}/</span>
            <input id="vtl-m-slug" placeholder="emma" value="${esc(link ? link.slug : '')}"></div>
          <div class="vtl-field-hint" id="vtl-m-preview">${esc(publicUrl(link ? link.slug : 'emma'))}</div>
        </div>
        <div class="vtl-field">
          <label>Destination URL</label>
          <input class="vtl-input" id="vtl-m-dest" placeholder="https://…" value="${esc(link ? link.destination_url : '')}">
          <div class="vtl-field-hint">Page d’abonnement de la modèle. Seules les URL http(s) publiques sont acceptées.</div>
        </div>
        <div class="vtl-field-row">
          <div class="vtl-field">
            <label>Source</label>
            <select class="vtl-select" id="vtl-m-source">
              ${SOURCES.map(s => `<option value="${s.code}" ${link && link.source_code === s.code ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </div>
          <div class="vtl-field">
            <label>Status</label>
            <select class="vtl-select" id="vtl-m-status">
              <option value="active" ${!link || link.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="paused" ${link && link.status === 'paused' ? 'selected' : ''}>Paused</option>
            </select>
          </div>
        </div>
        <div class="vtl-field-row">
          <div class="vtl-field">
            <label>Campaign <span style="text-transform:none;letter-spacing:0;">(optionnel)</span></label>
            <input class="vtl-input" id="vtl-m-campaign" list="vtl-campaign-list" placeholder="Summer drop"
                   value="${esc(link ? (link.campaign_name || '') : '')}">
            <datalist id="vtl-campaign-list">${UI.campaigns.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
          </div>
          <div class="vtl-field">
            <label>Fenêtre d’attribution</label>
            <select class="vtl-select" id="vtl-m-window">
              ${WINDOWS.map(w => `<option value="${w}" ${(link ? link.attribution_window_days : 30) === w ? 'selected' : ''}>${w} jours</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="vtl-error" id="vtl-m-err"></div>
      </div>
      <div class="vtl-modal-foot">
        <button class="vtl-btn vtl-btn-ghost" data-close>Annuler</button>
        <button class="vtl-btn vtl-btn-primary" id="vtl-m-save">${editing ? 'Enregistrer' : 'Créer le lien'}</button>
      </div>`);

    const $ = s => el.querySelector(s);
    const slugInput = $('#vtl-m-slug');
    let slugTouched = editing;

    $('#vtl-m-model').addEventListener('change', e => {
      $('#vtl-m-model-new').style.display = e.target.value === '__new' ? 'block' : 'none';
      if (e.target.value === '__new') $('#vtl-m-model-new').focus();
      else if (!slugTouched) {
        const m = UI.models.find(x => x.id === e.target.value);
        if (m) { slugInput.value = slugify(m.name); updatePreview(); }
      }
    });
    $('#vtl-m-model-new').addEventListener('input', e => {
      if (!slugTouched) { slugInput.value = slugify(e.target.value); updatePreview(); }
    });
    $('#vtl-m-name').addEventListener('input', e => {
      if (!slugTouched && !slugInput.value) { slugInput.value = slugify(e.target.value); updatePreview(); }
    });
    slugInput.addEventListener('input', () => { slugTouched = true; updatePreview(); });
    function updatePreview() {
      $('#vtl-m-preview').textContent = publicUrl(slugify(slugInput.value) || 'slug');
    }

    el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => el.remove()));
    $('#vtl-m-save').addEventListener('click', () => saveLink(el, link));
    setTimeout(() => $('#vtl-m-name').focus(), 30);
  }

  async function saveLink(el, link) {
    const $ = s => el.querySelector(s);
    const err = $('#vtl-m-err');
    const fail = msg => { err.textContent = msg; err.classList.add('on'); };
    err.classList.remove('on');

    const name = $('#vtl-m-name').value.trim();
    const slug = slugify($('#vtl-m-slug').value);
    const dest = $('#vtl-m-dest').value.trim();
    if (!name) return fail('Le nom du lien est obligatoire.');
    const slugErr = validateSlug(slug);
    if (slugErr) return fail(slugErr);
    const destErr = validateDestination(dest);
    if (destErr) return fail(destErr);

    const save = $('#vtl-m-save');
    save.disabled = true; save.textContent = 'Enregistrement…';
    try {
      if (await Store.slugTaken(slug, link ? link.id : null)) throw new Error(`Le slug « ${slug} » est déjà utilisé.`);

      let modelId = $('#vtl-m-model').value || null;
      if (modelId === '__new') {
        const newName = $('#vtl-m-model-new').value.trim();
        if (!newName) throw new Error('Renseigne le nom de la nouvelle modèle.');
        modelId = (await Store.createModel({ name: newName })).id;
      }

      let campaignId = null;
      const campaignName = $('#vtl-m-campaign').value.trim();
      if (campaignName) {
        const c = await Store.createCampaign(campaignName);
        campaignId = c ? c.id : null;
      }

      const payload = {
        model_id: modelId, campaign_id: campaignId, name: name, slug: slug,
        destination_url: dest, source_code: $('#vtl-m-source').value,
        status: $('#vtl-m-status').value,
        attribution_window_days: Number($('#vtl-m-window').value) || 30,
      };
      if (link) await Store.updateLink(link.id, payload);
      else await Store.createLink(payload);

      el.remove();
      toast(link ? 'Lien mis à jour' : 'Lien créé — ' + publicUrl(slug));
      await renderList(true);
      if (link && document.getElementById('v-tracking-link').classList.contains('on')) openLink(link.id);
      else goto('tracking');
    } catch (e) {
      const msg = /duplicate key|unique/i.test(e.message || '')
        ? `Le slug « ${slug} » est déjà utilisé.` : (e.message || 'Enregistrement impossible.');
      fail(msg);
      save.disabled = false; save.textContent = link ? 'Enregistrer' : 'Créer le lien';
    }
  }

  function openModelModal() {
    const el = modal('vtl-model-modal', `
      <div class="vtl-modal-head"><h3>Nouvelle modèle</h3>
        <p>Regroupe les liens de tracking et leurs performances attribuées.</p></div>
      <div class="vtl-modal-body">
        <div class="vtl-field"><label>Nom</label><input class="vtl-input" id="vtl-mm-name" placeholder="Emma"></div>
        <div class="vtl-field"><label>Handle <span style="text-transform:none;letter-spacing:0;">(optionnel)</span></label>
          <input class="vtl-input" id="vtl-mm-handle" placeholder="@emma"></div>
        <div class="vtl-error" id="vtl-mm-err"></div>
      </div>
      <div class="vtl-modal-foot">
        <button class="vtl-btn vtl-btn-ghost" data-close>Annuler</button>
        <button class="vtl-btn vtl-btn-primary" id="vtl-mm-save">Ajouter</button>
      </div>`);
    el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => el.remove()));
    el.querySelector('#vtl-mm-save').addEventListener('click', async () => {
      const err = el.querySelector('#vtl-mm-err');
      try {
        await Store.createModel({
          name: el.querySelector('#vtl-mm-name').value,
          handle: el.querySelector('#vtl-mm-handle').value,
        });
        el.remove(); toast('Modèle ajoutée');
        await reload();
        openModels();
      } catch (e) {
        err.textContent = e.message || 'Ajout impossible.'; err.classList.add('on');
      }
    });
    setTimeout(() => el.querySelector('#vtl-mm-name').focus(), 30);
  }

  /* ─── Attribution & API ─────────────────────────────────────────────── */

  const PAYLOAD_EXAMPLE = `{
  "external_id":  "cv_8842",          // identifiant de la conversion chez la source
  "tracking_link_id": "…",            // ou "slug": "emma"
  "visitor_id":   "visitor_8f32…",    // identifiant anonyme émis au clic
  "fan_id_hash":  "b7f1c0d9e2",       // identifiant de fan haché par la source
  "amount":       49.90,
  "currency":     "USD",
  "created_at":   "2026-08-24T10:12:00Z"
}`;

  async function openIntegrationModal() {
    const cloud = Store.mode === 'cloud';
    let keys = [];
    if (cloud) { try { keys = await Store.listKeys(); } catch (e) {} }

    const el = modal('vtl-integration-modal', `
      <div class="vtl-modal-head">
        <h3>Attribution &amp; API de conversion</h3>
        <p>Un clic ne permet jamais de connaître à lui seul le revenu ou le nombre de fans.
           Les conversions doivent provenir d’une source autorisée : API, ou import d’un export officiel.</p>
      </div>
      <div class="vtl-modal-body">
        <div class="vtl-field">
          <label>Endpoint</label>
          <code class="vtl-code">POST ${esc(API_URL)}
Authorization: Bearer &lt;clé d’ingestion&gt;
Content-Type: application/json

${esc(PAYLOAD_EXAMPLE)}</code>
          <div class="vtl-field-hint">Une conversion n’est comptée comme <b>attribuée</b> que si un clic correspondant
            existe dans la fenêtre d’attribution du lien. Sinon elle est conservée en « unattributed ».</div>
        </div>

        <div class="vtl-field">
          <label>Clés d’ingestion</label>
          ${cloud ? `
            <div id="vtl-keys">${keys.length ? keys.map(k => `
              <div class="vtl-kv">
                <span class="k"><b style="color:var(--vtl-text)">${esc(k.name)}</b>
                  <span style="font-family:'DM Mono',monospace;"> ${esc(k.prefix)}…</span>
                  ${k.revoked_at ? '<span class="vtl-tag" style="margin-left:6px;">révoquée</span>' : ''}
                  <br><span style="font-size:11.5px;color:var(--vtl-text-3)">créée le ${esc(dateLabel(k.created_at))}${k.last_used_at ? ' · utilisée le ' + esc(dateLabel(k.last_used_at)) : ' · jamais utilisée'}</span>
                </span>
                ${k.revoked_at ? '' : `<button class="vtl-btn vtl-btn-sm vtl-btn-danger" data-revoke="${esc(k.id)}">Révoquer</button>`}
              </div>`).join('') : '<div style="font-size:12.5px;color:var(--vtl-text-3);">Aucune clé pour l’instant.</div>'}</div>
            <div style="display:flex;gap:9px;margin-top:12px;">
              <input class="vtl-input" id="vtl-key-name" placeholder="Nom de la source (ex. plateforme)" style="flex:1;">
              <button class="vtl-btn" id="vtl-key-create">Créer une clé</button>
            </div>
            <div id="vtl-key-out" style="margin-top:12px;display:none;"></div>`
            : `<div class="vtl-note warn" style="margin:0;">${ICONS.info}<div>Les clés d’ingestion et l’import nécessitent
                 le backend Supabase (voir <b>tracking/README.md</b>).</div></div>`}
        </div>

        ${cloud ? `<div class="vtl-field">
          <label>Import d’un export autorisé (CSV ou JSON)</label>
          <textarea class="vtl-textarea" id="vtl-import" placeholder="external_id,slug,fan_id_hash,amount,currency,created_at
cv_8842,emma,b7f1c0d9e2,49.90,USD,2026-08-24T10:12:00Z"></textarea>
          <div class="vtl-field-hint">Colonnes reconnues : external_id (ou conversion_id), tracking_link_id ou slug,
            visitor_id, fan_id_hash, amount, currency, created_at. Les doublons sont ignorés.</div>
          <div style="display:flex;gap:9px;margin-top:11px;flex-wrap:wrap;">
            <button class="vtl-btn vtl-btn-primary" id="vtl-import-run">Importer</button>
            <button class="vtl-btn" id="vtl-reattr">Relancer l’attribution</button>
          </div>
          <div id="vtl-import-out" style="margin-top:11px;font-size:12.5px;color:var(--vtl-text-2);"></div>
        </div>` : ''}
      </div>
      <div class="vtl-modal-foot"><button class="vtl-btn vtl-btn-ghost" data-close>Fermer</button></div>`, true);

    el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => el.remove()));
    if (!cloud) return;

    el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Révoquer cette clé ? Les appels qui l’utilisent seront refusés immédiatement.')) return;
      try { await Store.revokeKey(b.getAttribute('data-revoke')); el.remove(); openIntegrationModal(); }
      catch (e) { toast(e.message || 'Révocation impossible'); }
    }));

    el.querySelector('#vtl-key-create').addEventListener('click', async () => {
      const out = el.querySelector('#vtl-key-out');
      try {
        const res = await Store.createKey(el.querySelector('#vtl-key-name').value.trim());
        out.style.display = 'block';
        out.innerHTML = `<div class="vtl-field-hint" style="margin-bottom:7px;">
            Copie cette clé maintenant : elle ne sera plus affichée.</div>
          <code class="vtl-code">${esc(res.key)}</code>`;
      } catch (e) {
        out.style.display = 'block';
        out.innerHTML = `<div class="vtl-error on">${esc(e.message || 'Création impossible')}</div>`;
      }
    });

    el.querySelector('#vtl-import-run').addEventListener('click', async () => {
      const out = el.querySelector('#vtl-import-out');
      const raw = el.querySelector('#vtl-import').value.trim();
      if (!raw) { out.textContent = 'Colle d’abord un export CSV ou JSON.'; return; }
      let rows;
      try { rows = parseConversions(raw); }
      catch (e) { out.innerHTML = `<span style="color:#e5675a">${esc(e.message)}</span>`; return; }
      out.textContent = `Import de ${rows.length} ligne(s)…`;
      try {
        const r = await Store.importConversions(rows);
        out.innerHTML = `${r.imported} importée(s) · ${r.attributed} attribuée(s) · ${r.duplicates} doublon(s) · ${r.errors} erreur(s)`;
        await renderList(true);
      } catch (e) {
        out.innerHTML = `<span style="color:#e5675a">${esc(e.message || 'Import impossible')}</span>`;
      }
    });

    el.querySelector('#vtl-reattr').addEventListener('click', async () => {
      const out = el.querySelector('#vtl-import-out');
      try {
        const r = await Store.reattribute();
        out.textContent = `${(r && r.attributed) || 0} conversion(s) nouvellement attribuée(s).`;
        await renderList(true);
      } catch (e) { out.innerHTML = `<span style="color:#e5675a">${esc(e.message)}</span>`; }
    });
  }

  // Accepte un tableau JSON ou un CSV avec en-tête.
  function parseConversions(raw) {
    const text = raw.trim();
    if (text[0] === '[' || text[0] === '{') {
      const data = JSON.parse(text);
      const rows = Array.isArray(data) ? data : [data];
      if (!rows.length) throw new Error('Aucune ligne à importer.');
      return rows;
    }
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV incomplet : une ligne d’en-tête puis au moins une ligne de données.');
    const head = splitCsv(lines[0]).map(h => h.trim().toLowerCase());
    const rows = lines.slice(1).map(l => {
      const cells = splitCsv(l);
      const o = {};
      head.forEach((h, i) => { if (cells[i] !== undefined && cells[i] !== '') o[h] = cells[i].trim(); });
      return o;
    });
    if (!head.includes('external_id') && !head.includes('conversion_id')) {
      throw new Error('Colonne external_id (ou conversion_id) manquante.');
    }
    return rows;
  }

  function splitCsv(line) {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',' || c === ';') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  /* ─── Jeu de démonstration (mode local uniquement, jamais automatique) ─ */

  async function seedDemo() {
    if (Store.mode !== 'local') { toast('Le jeu de démonstration est réservé au mode local.'); return; }
    if (!confirm('Charger un jeu de données de démonstration ?\n\nCes données sont fictives et clairement étiquetées « DEMO ». Elles restent dans ce navigateur.')) return;

    // Si une modèle du même nom existe déjà, on la réutilise plutôt que d'en créer un doublon.
    const existingModels = LS.get(K.models, []);
    const byName = n => existingModels.find(m => m.name.toLowerCase() === n.toLowerCase());
    const models = [
      byName('Emma')  || { id: uuid(), name: 'Emma',  handle: '@emma',  status: 'active', created_at: iso(-120), demo: true },
      byName('Sofia') || { id: uuid(), name: 'Sofia', handle: '@sofia', status: 'active', created_at: iso(-95),  demo: true },
    ];
    const newModels = models.filter(m => !byName(m.name));
    const campaigns = [{ id: uuid(), name: 'Summer drop', created_at: iso(-60), demo: true }];
    const defs = [
      { m: 0, name: 'Instagram Bio', slug: 'emma',            src: 'instagram', days: 60, base: 46, cvr: 0.044, aov: 72, camp: null },
      { m: 0, name: 'TikTok Bio',    slug: 'emma-tiktok',     src: 'tiktok',    days: 45, base: 28, cvr: 0.021, aov: 58, camp: 0 },
      { m: 1, name: 'Instagram Bio', slug: 'sofia',           src: 'instagram', days: 75, base: 68, cvr: 0.013, aov: 61, camp: null },
      { m: 1, name: 'Reddit',        slug: 'sofia-reddit',    src: 'reddit',    days: 30, base: 12, cvr: 0.009, aov: 44, camp: 0 },
    ];

    const links = [], clicks = [], convs = [];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

    defs.forEach(d => {
      const link = {
        id: uuid(), model_id: models[d.m].id, campaign_id: d.camp === null ? null : campaigns[d.camp].id,
        name: d.name, slug: d.slug, destination_url: 'https://example-platform.com/' + d.slug,
        source_code: d.src, status: 'active', attribution_window_days: 30,
        created_at: iso(-d.days), updated_at: iso(-d.days), deleted_at: null, demo: true,
      };
      links.push(link);
      for (let day = d.days; day >= 0; day--) {
        const weekend = [0, 6].includes(new Date(Date.now() - day * 864e5).getDay());
        const n = Math.max(0, Math.round(d.base * (0.55 + rnd() * 0.9) * (weekend ? 1.25 : 1)));
        for (let i = 0; i < n; i++) {
          const at = iso(-day, Math.floor(rnd() * 24));
          const visitor = 'visitor_' + Math.floor(rnd() * 1e9).toString(16);
          clicks.push({
            id: uuid(), link_id: link.id, visitor_id: rnd() < 0.78 ? visitor : 'visitor_ret_' + (i % 40),
            occurred_at: at, source_code: rnd() < 0.82 ? d.src : 'other', demo: true,
          });
          if (rnd() < d.cvr) {
            convs.push({
              id: uuid(), external_id: 'demo_' + uuid().slice(0, 8), source: 'import',
              link_id: link.id, visitor_id: visitor, fan_id_hash: 'fan_' + Math.floor(rnd() * 1e10).toString(16),
              amount: round2(d.aov * (0.5 + rnd() * 1.6)), currency: 'USD',
              occurred_at: at, status: 'attributed', demo: true,
            });
          }
        }
      }
    });

    LS.set(K.models, existingModels.concat(newModels));
    LS.set(K.campaigns, LS.get(K.campaigns, []).concat(campaigns));
    LS.set(K.links, LS.get(K.links, []).concat(links));
    LS.set(K.clicks, LS.get(K.clicks, []).concat(clicks));
    LS.set(K.conversions, LS.get(K.conversions, []).concat(convs));
    LS.set(K.demo, true);
    toast('Jeu de démonstration chargé');
    renderList(true);
  }

  function clearDemo() {
    LS.set(K.models, LS.get(K.models, []).filter(x => !x.demo));
    LS.set(K.campaigns, LS.get(K.campaigns, []).filter(x => !x.demo));
    LS.set(K.links, LS.get(K.links, []).filter(x => !x.demo));
    LS.set(K.clicks, LS.get(K.clicks, []).filter(x => !x.demo));
    LS.set(K.conversions, LS.get(K.conversions, []).filter(x => !x.demo));
    LS.set(K.demo, false);
    toast('Données de démonstration supprimées');
    renderList(true);
  }

  function iso(dayOffset, hour) {
    const d = new Date(Date.now() + dayOffset * 864e5);
    if (hour !== undefined) d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
    return d.toISOString();
  }

  /* ─── API publique du module ────────────────────────────────────────── */

  async function open() {
    ensureViews();
    await pickStore();
    goto('tracking');
    await renderList(true);
  }

  window.VTL = {
    open: open,
    openLink: openLink,
    openModels: openModels,
    openModel: openModel,
    refresh: () => renderList(true),
    seedDemo: seedDemo,
    clearDemo: clearDemo,
    // Exposé pour les tests : fonctions pures du module
    _internals: {
      validateSlug, validateDestination, slugify, computeStats, seriesFor,
      applyFilters, sortLinks, totals, parseConversions, splitCsv, niceMax, UI,
      LocalStore, CloudStore, pickStore,
      setStore: s => { Store = s; },
      currentStore: () => Store,
      backendIssue: () => backendIssue,
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureViews);
  else ensureViews();
})();

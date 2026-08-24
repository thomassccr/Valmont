-- ═══════════════════════════════════════════════════════════════════════════
--  VALMONT — Module « Custom Tracking Links + Analytics »
--  Schéma Supabase / PostgreSQL — indépendant du reste de l'application.
--
--  À exécuter UNE SEULE FOIS dans le SQL Editor du projet Supabase.
--  Ne touche à aucune table existante (tout est préfixé « tl_ »).
--
--  Principes :
--   • aucune donnée personnelle : pas d'IP, pas de user-agent brut, pas
--     d'e-mail de fan — uniquement des identifiants anonymes / hachés ;
--   • RLS partout : un utilisateur ne voit QUE ses propres liens, clics,
--     visiteurs et conversions ;
--   • les écritures de tracking (clics) passent par des fonctions
--     SECURITY DEFINER réservées au rôle `service_role` (le Worker) ;
--   • une conversion n'est « attribuée » que si une correspondance valide
--     existe dans la fenêtre d'attribution du lien.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Référentiels
-- ───────────────────────────────────────────────────────────────────────────

-- Sources de trafic (référentiel statique, lisible par tous les connectés)
create table if not exists public.tl_traffic_sources (
  code       text primary key,
  label      text not null,
  sort_order int  not null default 100
);

insert into public.tl_traffic_sources (code, label, sort_order) values
  ('instagram', 'Instagram',  10),
  ('tiktok',    'TikTok',     20),
  ('twitter',   'Twitter / X',30),
  ('reddit',    'Reddit',     40),
  ('other',     'Other',      90)
on conflict (code) do nothing;

-- Slugs interdits (routes techniques / pages du site)
create table if not exists public.tl_reserved_slugs (
  slug text primary key
);

insert into public.tl_reserved_slugs (slug) values
  ('api'), ('app'), ('admin'), ('assets'), ('auth'), ('cdn'), ('dashboard'),
  ('favicon.ico'), ('health'), ('index'), ('login'), ('logout'), ('manifest.json'),
  ('robots.txt'), ('settings'), ('signup'), ('site'), ('sitemap.xml'), ('static'),
  ('support'), ('tracking'), ('www')
on conflict (slug) do nothing;

-- Modèles / créateurs
create table if not exists public.tl_models (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  handle     text check (char_length(handle) <= 80),
  status     text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now()
);
create unique index if not exists tl_models_owner_name_uq
  on public.tl_models (owner_id, lower(btrim(name)));

-- Campagnes
create table if not exists public.tl_campaigns (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index if not exists tl_campaigns_owner_name_uq
  on public.tl_campaigns (owner_id, lower(btrim(name)));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Liens de tracking
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.tl_links (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  model_id      uuid references public.tl_models(id)    on delete set null,
  campaign_id   uuid references public.tl_campaigns(id) on delete set null,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  slug          text not null,
  destination_url text not null,
  source_code   text not null default 'other' references public.tl_traffic_sources(code),
  status        text not null default 'active' check (status in ('active','paused')),
  attribution_window_days int not null default 30
                check (attribution_window_days in (7,14,30,60,90)),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  -- Slug : minuscules, chiffres, tiret / point / underscore. 2 à 48 caractères.
  constraint tl_links_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9._-]{1,47}$'),
  -- Destination : uniquement http(s), longueur bornée.
  constraint tl_links_destination_format
    check (destination_url ~* '^https?://[^\s<>"]{3,}$'
           and char_length(destination_url) <= 1000)
);

-- Le slug est unique sur tout le domaine de redirection (mydomain.com/<slug>)
create unique index if not exists tl_links_slug_uq
  on public.tl_links (slug) where deleted_at is null;
create index if not exists tl_links_owner_idx    on public.tl_links (owner_id) where deleted_at is null;
create index if not exists tl_links_model_idx    on public.tl_links (model_id) where deleted_at is null;

-- Garde-fous supplémentaires impossibles à exprimer en CHECK
create or replace function public.tl_links_guard()
returns trigger language plpgsql as $$
declare
  host text;
begin
  new.slug := lower(btrim(new.slug));
  new.name := btrim(new.name);
  new.updated_at := now();

  if exists (select 1 from public.tl_reserved_slugs r where r.slug = new.slug) then
    raise exception 'slug_reserved: « % » est réservé', new.slug
      using errcode = 'check_violation';
  end if;

  -- Destination : on refuse les hôtes locaux / privés (anti-SSRF côté redirection)
  host := lower(split_part(split_part(regexp_replace(new.destination_url, '^https?://', '', 'i'), '/', 1), ':', 1));
  if host = '' or host = 'localhost' or host like '%.local'
     or host ~ '^127\.' or host ~ '^10\.' or host ~ '^192\.168\.'
     or host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.' or host ~ '^169\.254\.'
     or host = '0.0.0.0' or host ~ '^\[' then
    raise exception 'destination_not_allowed: hôte de destination interdit (%)', host
      using errcode = 'check_violation';
  end if;

  -- Le modèle et la campagne doivent appartenir au même propriétaire
  if new.model_id is not null and not exists (
      select 1 from public.tl_models m where m.id = new.model_id and m.owner_id = new.owner_id) then
    raise exception 'model_not_owned' using errcode = 'check_violation';
  end if;
  if new.campaign_id is not null and not exists (
      select 1 from public.tl_campaigns c where c.id = new.campaign_id and c.owner_id = new.owner_id) then
    raise exception 'campaign_not_owned' using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists tl_links_guard_trg on public.tl_links;
create trigger tl_links_guard_trg
  before insert or update on public.tl_links
  for each row execute function public.tl_links_guard();

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Visiteurs anonymes + clics
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.tl_visitors (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  -- Empreinte anonyme (cookie first-party aléatoire ou hash tournant).
  -- Jamais d'IP ni de user-agent en clair.
  visitor_key   text not null check (char_length(visitor_key) between 8 and 128),
  -- Identifiant exposé aux intégrations : « visitor_8f32… »
  public_id     text not null,
  first_link_id uuid references public.tl_links(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create unique index if not exists tl_visitors_key_uq       on public.tl_visitors (owner_id, visitor_key);
create unique index if not exists tl_visitors_public_id_uq on public.tl_visitors (public_id);

create table if not exists public.tl_clicks (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  link_id       uuid not null references public.tl_links(id)   on delete cascade,
  visitor_id    uuid          references public.tl_visitors(id) on delete set null,
  occurred_at   timestamptz not null default now(),
  is_unique     boolean not null default false,
  source_code   text,
  utm_source    text, utm_medium text, utm_campaign text,
  utm_content   text, utm_term   text,
  referrer_host text,          -- hôte uniquement, jamais l'URL complète
  country       char(2),       -- géo pays, fourni par l'edge (facultatif)
  device        text check (device in ('mobile','desktop','tablet','other'))
);
create index if not exists tl_clicks_link_time_idx    on public.tl_clicks (link_id, occurred_at desc);
create index if not exists tl_clicks_visitor_time_idx on public.tl_clicks (visitor_id, occurred_at desc);
create index if not exists tl_clicks_owner_time_idx   on public.tl_clicks (owner_id, occurred_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Conversions + attribution
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.tl_conversions (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  -- Identifiant de la conversion chez la source autorisée (idempotence)
  external_id  text not null check (char_length(external_id) between 1 and 128),
  source       text not null default 'api' check (source in ('api','import','manual')),
  link_id      uuid references public.tl_links(id)    on delete set null,
  visitor_id   uuid references public.tl_visitors(id) on delete set null,
  -- Identifiant de fan haché par la source : jamais de nom, e-mail ou pseudo
  fan_id_hash  text check (fan_id_hash ~ '^[A-Za-z0-9_-]{6,128}$'),
  amount       numeric(14,2) not null check (amount >= 0),
  currency     char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  occurred_at  timestamptz not null default now(),
  status       text not null default 'unattributed'
               check (status in ('attributed','unattributed')),
  created_at   timestamptz not null default now()
);
create unique index if not exists tl_conversions_external_uq
  on public.tl_conversions (owner_id, external_id);
create index if not exists tl_conversions_link_time_idx
  on public.tl_conversions (link_id, occurred_at desc) where status = 'attributed';

-- Trace d'attribution : pourquoi une conversion a été rattachée à un lien
create table if not exists public.tl_attribution_events (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  conversion_id uuid not null references public.tl_conversions(id) on delete cascade,
  link_id       uuid not null references public.tl_links(id)       on delete cascade,
  visitor_id    uuid references public.tl_visitors(id) on delete set null,
  click_id      bigint references public.tl_clicks(id) on delete set null,
  model         text not null default 'last_click',
  matched_on    text not null check (matched_on in ('visitor','click','link')),
  window_days   int  not null,
  created_at    timestamptz not null default now()
);
create unique index if not exists tl_attr_conversion_uq
  on public.tl_attribution_events (conversion_id);

-- Clés d'ingestion (une source autorisée → une clé). Seul le hash est stocké.
create table if not exists public.tl_ingest_keys (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  prefix       text not null,           -- 8 premiers caractères, pour reconnaître la clé
  key_hash     text not null unique,    -- sha256(clé)
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists tl_ingest_keys_owner_idx on public.tl_ingest_keys (owner_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Row Level Security
-- ───────────────────────────────────────────────────────────────────────────

alter table public.tl_models            enable row level security;
alter table public.tl_campaigns         enable row level security;
alter table public.tl_links             enable row level security;
alter table public.tl_visitors          enable row level security;
alter table public.tl_clicks            enable row level security;
alter table public.tl_conversions       enable row level security;
alter table public.tl_attribution_events enable row level security;
alter table public.tl_ingest_keys       enable row level security;
alter table public.tl_traffic_sources   enable row level security;
alter table public.tl_reserved_slugs    enable row level security;

-- Référentiels : lecture seule pour les utilisateurs connectés
drop policy if exists tl_sources_read on public.tl_traffic_sources;
create policy tl_sources_read on public.tl_traffic_sources
  for select to authenticated using (true);

drop policy if exists tl_reserved_read on public.tl_reserved_slugs;
create policy tl_reserved_read on public.tl_reserved_slugs
  for select to authenticated using (true);

-- Données possédées : CRUD complet, uniquement sur ses propres lignes
do $$
declare t text;
begin
  foreach t in array array['tl_models','tl_campaigns','tl_links'] loop
    execute format('drop policy if exists %I on public.%I', t||'_own_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_own_insert', t);
    execute format('drop policy if exists %I on public.%I', t||'_own_update', t);
    execute format('drop policy if exists %I on public.%I', t||'_own_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = owner_id)', t||'_own_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (auth.uid() = owner_id)', t||'_own_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id)', t||'_own_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (auth.uid() = owner_id)', t||'_own_delete', t);
  end loop;
end $$;

-- Données de tracking : lecture seule côté application.
-- Les écritures passent exclusivement par les fonctions SECURITY DEFINER
-- appelées par le Worker (rôle service_role, qui contourne la RLS).
do $$
declare t text;
begin
  foreach t in array array['tl_visitors','tl_clicks','tl_attribution_events'] loop
    execute format('drop policy if exists %I on public.%I', t||'_own_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = owner_id)', t||'_own_select', t);
  end loop;
end $$;

-- Conversions : lecture + suppression manuelle. L'insertion passe par les RPC
-- (API autorisée ou import), qui gèrent l'idempotence et l'attribution.
drop policy if exists tl_conversions_own_select on public.tl_conversions;
create policy tl_conversions_own_select on public.tl_conversions
  for select to authenticated using (auth.uid() = owner_id);
drop policy if exists tl_conversions_own_delete on public.tl_conversions;
create policy tl_conversions_own_delete on public.tl_conversions
  for delete to authenticated using (auth.uid() = owner_id);

-- Clés d'ingestion : lecture des métadonnées + révocation. Jamais le hash.
drop policy if exists tl_keys_own_select on public.tl_ingest_keys;
create policy tl_keys_own_select on public.tl_ingest_keys
  for select to authenticated using (auth.uid() = owner_id);
drop policy if exists tl_keys_own_update on public.tl_ingest_keys;
create policy tl_keys_own_update on public.tl_ingest_keys
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists tl_keys_own_delete on public.tl_ingest_keys;
create policy tl_keys_own_delete on public.tl_ingest_keys
  for delete to authenticated using (auth.uid() = owner_id);

revoke select on public.tl_ingest_keys from authenticated;
grant  select (id, owner_id, name, prefix, created_at, last_used_at, revoked_at)
  on public.tl_ingest_keys to authenticated;
grant  update (revoked_at), delete on public.tl_ingest_keys to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Vues analytiques (héritent de la RLS des tables : security_invoker)
-- ───────────────────────────────────────────────────────────────────────────

-- Statistiques agrégées par lien
create or replace view public.tl_link_stats
with (security_invoker = on) as
with c as (
  select link_id, owner_id,
         count(*)                                                            as clicks,
         count(distinct visitor_id)                                          as unique_visitors,
         count(*) filter (where occurred_at >= date_trunc('day', now()))     as clicks_today,
         count(*) filter (where occurred_at >= now() - interval '7 days')    as clicks_7d,
         count(*) filter (where occurred_at >= now() - interval '30 days')   as clicks_30d,
         max(occurred_at)                                                    as last_click_at
  from public.tl_clicks
  group by link_id, owner_id
),
v as (
  select link_id, owner_id,
         count(*)                              as conversions,
         count(distinct fan_id_hash)           as fans,
         coalesce(sum(amount), 0)::numeric     as revenue
  from public.tl_conversions
  where status = 'attributed' and link_id is not null
  group by link_id, owner_id
)
select
  l.id                                   as link_id,
  l.owner_id,
  coalesce(c.clicks, 0)                  as clicks,
  coalesce(c.unique_visitors, 0)         as unique_visitors,
  coalesce(c.clicks_today, 0)            as clicks_today,
  coalesce(c.clicks_7d, 0)               as clicks_7d,
  coalesce(c.clicks_30d, 0)              as clicks_30d,
  c.last_click_at,
  coalesce(v.conversions, 0)             as conversions,
  coalesce(v.fans, 0)                    as fans,
  coalesce(v.revenue, 0)::numeric        as revenue,
  -- Taux de conversion = conversions attribuées / visiteurs uniques
  case when coalesce(c.unique_visitors, 0) > 0
       then round(100.0 * coalesce(v.conversions, 0) / c.unique_visitors, 2)
       else 0 end                        as conversion_rate,
  case when coalesce(c.unique_visitors, 0) > 0
       then round(coalesce(v.revenue, 0) / c.unique_visitors, 2)
       else 0 end                        as revenue_per_visitor,
  case when coalesce(v.fans, 0) > 0
       then round(coalesce(v.revenue, 0) / v.fans, 2)
       else 0 end                        as revenue_per_fan
from public.tl_links l
left join c on c.link_id = l.id
left join v on v.link_id = l.id
where l.deleted_at is null;

-- Série temporelle par jour et par lien (clics / conversions / revenu)
create or replace view public.tl_link_daily
with (security_invoker = on) as
select owner_id, link_id, day,
       sum(clicks)::bigint          as clicks,
       sum(unique_visitors)::bigint as unique_visitors,
       sum(conversions)::bigint     as conversions,
       sum(revenue)::numeric        as revenue
from (
  select owner_id, link_id, (occurred_at at time zone 'UTC')::date as day,
         count(*)::bigint                  as clicks,
         count(distinct visitor_id)::bigint as unique_visitors,
         0::bigint                          as conversions,
         0::numeric                         as revenue
  from public.tl_clicks
  group by 1, 2, 3
  union all
  select owner_id, link_id, (occurred_at at time zone 'UTC')::date as day,
         0::bigint, 0::bigint,
         count(*)::bigint,
         coalesce(sum(amount), 0)::numeric
  from public.tl_conversions
  where status = 'attributed' and link_id is not null
  group by 1, 2, 3
) s
group by owner_id, link_id, day;

-- Répartition des sources de trafic par lien
create or replace view public.tl_link_sources
with (security_invoker = on) as
select owner_id, link_id,
       coalesce(nullif(source_code, ''), nullif(lower(utm_source), ''), 'other') as source_code,
       count(*)::bigint                                                          as clicks,
       count(distinct visitor_id)::bigint                                        as unique_visitors
from public.tl_clicks
group by 1, 2, 3;

-- Agrégat par modèle
create or replace view public.tl_model_stats
with (security_invoker = on) as
select m.id as model_id, m.owner_id,
       count(l.id)                            as links,
       coalesce(sum(s.clicks), 0)::bigint     as clicks,
       coalesce(sum(s.unique_visitors), 0)::bigint as unique_visitors,
       coalesce(sum(s.fans), 0)::bigint       as fans,
       coalesce(sum(s.revenue), 0)::numeric   as revenue,
       case when coalesce(sum(s.unique_visitors), 0) > 0
            then round(100.0 * coalesce(sum(s.conversions), 0) / sum(s.unique_visitors), 2)
            else 0 end                        as conversion_rate
from public.tl_models m
left join public.tl_links l on l.model_id = m.id and l.deleted_at is null
left join public.tl_link_stats s on s.link_id = l.id
group by m.id, m.owner_id;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Redirection + enregistrement du clic (réservé au Worker / service_role)
-- ───────────────────────────────────────────────────────────────────────────

-- Résolution seule : sert au cache edge (réponse en une requête, sans écriture)
create or replace function public.tl_resolve(p_slug text)
returns table (link_id uuid, destination_url text, source_code text, status text)
language sql security definer stable set search_path = public as $$
  select l.id, l.destination_url, l.source_code, l.status
  from public.tl_links l
  where l.slug = lower(btrim(p_slug)) and l.deleted_at is null
  limit 1;
$$;

-- Enregistrement d'un clic : crée/rafraîchit le visiteur anonyme puis insère
-- le clic. Renvoie aussi la destination pour permettre au Worker de tout
-- faire en un seul aller-retour lors d'un cache miss.
create or replace function public.tl_record_click(
  p_slug          text,
  p_visitor_key   text,
  p_source        text default null,
  p_utm           jsonb default '{}'::jsonb,
  p_referrer_host text default null,
  p_country       text default null,
  p_device        text default null
) returns table (destination_url text, link_id uuid, visitor_public_id text)
language plpgsql security definer set search_path = public as $$
declare
  v_link      public.tl_links%rowtype;
  v_visitor   uuid;
  v_public_id text;
  v_is_new    boolean := false;
  v_key       text := left(btrim(coalesce(p_visitor_key, '')), 128);
begin
  select * into v_link from public.tl_links
   where slug = lower(btrim(p_slug)) and deleted_at is null limit 1;
  if not found or v_link.status <> 'active' then
    return;
  end if;

  if char_length(v_key) >= 8 then
    select id, public_id into v_visitor, v_public_id
      from public.tl_visitors
     where owner_id = v_link.owner_id and visitor_key = v_key;

    if v_visitor is null then
      v_public_id := 'visitor_' || encode(gen_random_bytes(8), 'hex');
      insert into public.tl_visitors (owner_id, visitor_key, public_id, first_link_id)
      values (v_link.owner_id, v_key, v_public_id, v_link.id)
      on conflict (owner_id, visitor_key) do update set last_seen_at = now()
      returning id, public_id into v_visitor, v_public_id;
      v_is_new := true;
    else
      update public.tl_visitors set last_seen_at = now() where id = v_visitor;
    end if;
  end if;

  -- « Unique » = premier clic de ce visiteur sur CE lien
  if v_visitor is not null and not v_is_new then
    v_is_new := not exists (
      select 1 from public.tl_clicks c
       where c.link_id = v_link.id and c.visitor_id = v_visitor);
  end if;

  insert into public.tl_clicks (
    owner_id, link_id, visitor_id, is_unique, source_code,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    referrer_host, country, device)
  values (
    v_link.owner_id, v_link.id, v_visitor, coalesce(v_is_new, false),
    coalesce(nullif(left(lower(btrim(p_source)), 40), ''), v_link.source_code),
    left(p_utm->>'source', 80), left(p_utm->>'medium', 80), left(p_utm->>'campaign', 80),
    left(p_utm->>'content', 80), left(p_utm->>'term', 80),
    left(lower(nullif(btrim(coalesce(p_referrer_host, '')), '')), 120),
    nullif(upper(left(coalesce(p_country, ''), 2)), ''),
    case when p_device in ('mobile','desktop','tablet') then p_device else 'other' end);

  destination_url := v_link.destination_url;
  link_id         := v_link.id;
  visitor_public_id := v_public_id;
  return next;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Attribution
-- ───────────────────────────────────────────────────────────────────────────

-- Rattache une conversion à un lien SI — et seulement si — une correspondance
-- valide existe : un clic du même visiteur (ou sur le lien annoncé) antérieur
-- à la conversion et compris dans la fenêtre d'attribution du lien.
create or replace function public.tl_attribute_conversion(p_conversion uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_conv     public.tl_conversions%rowtype;
  v_window   int;
  v_click_id bigint;
  v_link_id  uuid;
  v_visitor  uuid;
  v_matched  text;
begin
  select * into v_conv from public.tl_conversions where id = p_conversion;
  if not found or v_conv.status = 'attributed' then return false; end if;

  -- 1) Lien annoncé explicitement par la source autorisée
  if v_conv.link_id is not null then
    select attribution_window_days into v_window
      from public.tl_links
     where id = v_conv.link_id and owner_id = v_conv.owner_id and deleted_at is null;

    if v_window is not null then
      if v_conv.visitor_id is not null then
        select id into v_click_id from public.tl_clicks
         where link_id = v_conv.link_id and visitor_id = v_conv.visitor_id
           and occurred_at <= v_conv.occurred_at
           and occurred_at >= v_conv.occurred_at - make_interval(days => v_window)
         order by occurred_at desc limit 1;
        v_matched := 'click';
      else
        select id into v_click_id from public.tl_clicks
         where link_id = v_conv.link_id
           and occurred_at <= v_conv.occurred_at
           and occurred_at >= v_conv.occurred_at - make_interval(days => v_window)
         order by occurred_at desc limit 1;
        v_matched := 'link';
      end if;
      if v_click_id is not null then
        v_link_id := v_conv.link_id;
      end if;
    end if;
  end if;

  -- 2) Sinon : dernier clic du visiteur, dans la fenêtre du lien cliqué
  if v_link_id is null and v_conv.visitor_id is not null then
    select c.id, c.link_id into v_click_id, v_link_id
      from public.tl_clicks c
      join public.tl_links l on l.id = c.link_id and l.deleted_at is null
     where c.visitor_id = v_conv.visitor_id
       and c.occurred_at <= v_conv.occurred_at
       and c.occurred_at >= v_conv.occurred_at - make_interval(days => l.attribution_window_days)
     order by c.occurred_at desc limit 1;
    if v_link_id is not null then
      v_matched := 'visitor';
      select attribution_window_days into v_window from public.tl_links where id = v_link_id;
    end if;
  end if;

  if v_link_id is null then return false; end if;

  select visitor_id into v_visitor from public.tl_clicks where id = v_click_id;

  update public.tl_conversions
     set link_id    = v_link_id,
         visitor_id = coalesce(visitor_id, v_visitor),
         status     = 'attributed'
   where id = v_conv.id;

  insert into public.tl_attribution_events
    (owner_id, conversion_id, link_id, visitor_id, click_id, model, matched_on, window_days)
  values
    (v_conv.owner_id, v_conv.id, v_link_id, coalesce(v_conv.visitor_id, v_visitor),
     v_click_id, 'last_click', v_matched, coalesce(v_window, 30))
  on conflict (conversion_id) do nothing;

  return true;
end $$;

-- Insertion normalisée d'une conversion (usage interne aux deux points d'entrée)
create or replace function public.tl_insert_conversion(
  p_owner uuid, p_payload jsonb, p_source text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid;
  v_link      uuid;
  v_visitor   uuid;
  v_external  text := nullif(btrim(coalesce(p_payload->>'external_id', p_payload->>'conversion_id', '')), '');
  v_amount    numeric;
  v_currency  text := upper(coalesce(nullif(btrim(coalesce(p_payload->>'currency','')), ''), 'USD'));
  v_when      timestamptz;
  v_fan       text := nullif(btrim(coalesce(p_payload->>'fan_id_hash', '')), '');
  v_attr      boolean;
begin
  if v_external is null then
    return jsonb_build_object('ok', false, 'error', 'external_id_required');
  end if;

  begin
    v_amount := coalesce((p_payload->>'amount')::numeric, 0);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'amount_invalid');
  end;
  if v_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'amount_invalid');
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'error', 'currency_invalid');
  end if;
  if v_fan is not null and v_fan !~ '^[A-Za-z0-9_-]{6,128}$' then
    return jsonb_build_object('ok', false, 'error', 'fan_id_hash_invalid');
  end if;

  begin
    v_when := coalesce((p_payload->>'created_at')::timestamptz,
                       (p_payload->>'occurred_at')::timestamptz, now());
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'date_invalid');
  end;

  -- Lien : par id, ou par slug — toujours restreint au propriétaire
  if (p_payload->>'tracking_link_id') is not null then
    begin
      select id into v_link from public.tl_links
       where id = (p_payload->>'tracking_link_id')::uuid
         and owner_id = p_owner and deleted_at is null;
    exception when others then
      v_link := null;
    end;
  elsif (p_payload->>'slug') is not null then
    select id into v_link from public.tl_links
     where slug = lower(btrim(p_payload->>'slug')) and owner_id = p_owner and deleted_at is null;
  end if;

  -- Visiteur : identifiant anonyme « visitor_… » émis lors du clic
  if (p_payload->>'visitor_id') is not null then
    select id into v_visitor from public.tl_visitors
     where public_id = btrim(p_payload->>'visitor_id') and owner_id = p_owner;
  end if;

  insert into public.tl_conversions
    (owner_id, external_id, source, link_id, visitor_id, fan_id_hash, amount, currency, occurred_at)
  values
    (p_owner, v_external, p_source, v_link, v_visitor, v_fan, v_amount, v_currency, v_when)
  on conflict (owner_id, external_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  v_attr := public.tl_attribute_conversion(v_id);
  return jsonb_build_object('ok', true, 'id', v_id, 'attributed', v_attr);
end $$;

-- Point d'entrée API : appelé par le Worker avec le hash de la clé d'ingestion
create or replace function public.tl_ingest_conversion(p_key_hash text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.tl_ingest_keys
   where key_hash = p_key_hash and revoked_at is null;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  update public.tl_ingest_keys set last_used_at = now() where key_hash = p_key_hash;
  return public.tl_insert_conversion(v_owner, p_payload, 'api');
end $$;

-- Import manuel (CSV / copier-coller) depuis l'application, pour l'utilisateur connecté
create or replace function public.tl_import_conversions(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_row   jsonb;
  v_res   jsonb;
  v_ok    int := 0; v_dup int := 0; v_err int := 0; v_attr int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'rows_must_be_array');
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    return jsonb_build_object('ok', false, 'error', 'too_many_rows');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_res := public.tl_insert_conversion(v_owner, v_row, 'import');
    if (v_res->>'ok')::boolean is not true then
      v_err := v_err + 1;
      if jsonb_array_length(v_errors) < 20 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'external_id', v_row->>'external_id', 'error', v_res->>'error'));
      end if;
    elsif (v_res->>'duplicate')::boolean then
      v_dup := v_dup + 1;
    else
      v_ok := v_ok + 1;
      if (v_res->>'attributed')::boolean then v_attr := v_attr + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'imported', v_ok, 'duplicates', v_dup,
                            'errors', v_err, 'attributed', v_attr, 'details', v_errors);
end $$;

-- Relance l'attribution sur les conversions encore non attribuées
-- (utile après un import de clics/conversions dans le désordre)
create or replace function public.tl_reattribute_pending()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid; v_n int := 0;
begin
  if v_owner is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  for v_id in select id from public.tl_conversions
               where owner_id = v_owner and status = 'unattributed'
               order by occurred_at desc limit 2000 loop
    if public.tl_attribute_conversion(v_id) then v_n := v_n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'attributed', v_n);
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 9. Clés d'ingestion : génération côté serveur, clé en clair affichée 1 fois
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.tl_create_ingest_key(p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_key   text;
  v_id    uuid;
begin
  if v_owner is null then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
  if (select count(*) from public.tl_ingest_keys where owner_id = v_owner and revoked_at is null) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_keys');
  end if;

  v_key := 'vtl_' || encode(gen_random_bytes(24), 'hex');
  insert into public.tl_ingest_keys (owner_id, name, prefix, key_hash)
  values (v_owner, left(btrim(coalesce(p_name, 'API key')), 60), left(v_key, 12),
          encode(digest(v_key, 'sha256'), 'hex'))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key, 'prefix', left(v_key, 12));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 10. Droits d'exécution
-- ───────────────────────────────────────────────────────────────────────────

-- Fonctions de tracking : Worker uniquement (service_role)
revoke all on function public.tl_resolve(text)                          from public, anon, authenticated;
revoke all on function public.tl_record_click(text,text,text,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.tl_ingest_conversion(text,jsonb)          from public, anon, authenticated;
revoke all on function public.tl_insert_conversion(uuid,jsonb,text)     from public, anon, authenticated;
revoke all on function public.tl_attribute_conversion(uuid)             from public, anon, authenticated;
grant execute on function public.tl_resolve(text)                       to service_role;
grant execute on function public.tl_record_click(text,text,text,jsonb,text,text,text) to service_role;
grant execute on function public.tl_ingest_conversion(text,jsonb)       to service_role;

-- Fonctions applicatives : utilisateur connecté uniquement
revoke all on function public.tl_import_conversions(jsonb)   from public, anon;
revoke all on function public.tl_reattribute_pending()       from public, anon;
revoke all on function public.tl_create_ingest_key(text)     from public, anon;
grant execute on function public.tl_import_conversions(jsonb) to authenticated;
grant execute on function public.tl_reattribute_pending()     to authenticated;
grant execute on function public.tl_create_ingest_key(text)   to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 11. Droits sur les tables et les vues (explicites, en plus de la RLS)
-- ───────────────────────────────────────────────────────────────────────────

-- Le rôle « anon » (visiteur non connecté) n'a strictement aucun accès direct :
-- la redirection publique passe uniquement par le Worker (service_role).
revoke all on public.tl_models, public.tl_campaigns, public.tl_links,
              public.tl_visitors, public.tl_clicks, public.tl_conversions,
              public.tl_attribution_events, public.tl_ingest_keys,
              public.tl_traffic_sources, public.tl_reserved_slugs,
              public.tl_link_stats, public.tl_link_daily,
              public.tl_link_sources, public.tl_model_stats
  from anon;

grant select, insert, update, delete
  on public.tl_models, public.tl_campaigns, public.tl_links to authenticated;

grant select
  on public.tl_visitors, public.tl_clicks, public.tl_attribution_events,
     public.tl_traffic_sources, public.tl_reserved_slugs,
     public.tl_link_stats, public.tl_link_daily,
     public.tl_link_sources, public.tl_model_stats to authenticated;

grant select, delete on public.tl_conversions to authenticated;

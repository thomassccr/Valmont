-- Harnais de test : reproduit le minimum de Supabase sur un PostgreSQL nu
-- (rôles anon / authenticated / service_role, schéma auth, auth.uid()).
-- À exécuter AVANT schema.sql sur une base de test — jamais sur Supabase,
-- où tout cela existe déjà.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin;          end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin;  end if;
end $$;

create extension if not exists pgcrypto;
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Sur Supabase, auth.uid() lit le JWT. Ici on lit un paramètre de session,
-- que les tests positionnent avec `set local request.jwt.claim.sub = '…'`.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════
-- Schéma Supabase pour VALMONT
-- À exécuter UNE SEULE FOIS dans le SQL Editor de ton projet
-- (supabase.com → ton projet → SQL Editor → coller → Run)
-- ═══════════════════════════════════════════════════════════

-- Une ligne par utilisateur : snapshot JSON de toutes ses données
-- (sessions de trading, comptes du dashboard, trades, avatar, plan…)
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Sécurité : chaque utilisateur ne peut lire/écrire QUE sa propre ligne
alter table public.user_data enable row level security;

create policy "select own data" on public.user_data
  for select using (auth.uid() = user_id);

create policy "insert own data" on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "update own data" on public.user_data
  for update using (auth.uid() = user_id);

create policy "delete own data" on public.user_data
  for delete using (auth.uid() = user_id);

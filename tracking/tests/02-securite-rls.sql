\set ON_ERROR_STOP on
-- Les droits sont désormais posés par schema.sql (section 11) : rien à faire ici.

\echo '=== fonctions applicatives sous identité utilisateur A ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select (public.tl_create_ingest_key('Plateforme') ->> 'key') like 'vtl_%' as key_format_ok;
  select public.tl_import_conversions('[{"external_id":"imp_1","amount":"12.5","slug":"emma"},{"external_id":"imp_bad","amount":"abc"}]'::jsonb);
  select public.tl_reattribute_pending();
  \echo '--- A voit ses liens / clics ---'
  select count(*) as links_visibles_A from public.tl_links;
  select count(*) as clics_visibles_A from public.tl_clicks;
  select count(*) as cles_visibles_A  from public.tl_ingest_keys;
commit;

\echo '=== isolation : utilisateur B ne doit rien voir ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  select count(*) as links_visibles_B from public.tl_links;
  select count(*) as clics_visibles_B from public.tl_clicks;
  select count(*) as conversions_visibles_B from public.tl_conversions;
  select count(*) as stats_visibles_B from public.tl_link_stats;
  \echo '--- B tente de créer un lien au nom de A (doit échouer) ---'
  do $$ begin
    insert into public.tl_links (owner_id, name, slug, destination_url)
    values ('11111111-1111-1111-1111-111111111111','pirate','pirate','https://evil.example.com');
    raise notice 'FAIL: insertion croisée acceptée';
  exception when insufficient_privilege then raise notice 'OK: insertion croisée bloquée par la RLS'; end $$;
commit;

\echo '=== anon ne doit pas pouvoir appeler les fonctions de tracking ==='
begin;
  set local role anon;
  do $$ begin
    perform public.tl_record_click('emma','hack-key');
    raise notice 'FAIL: anon a pu enregistrer un clic';
  exception when insufficient_privilege then raise notice 'OK: anon bloqué sur tl_record_click'; end $$;
  do $$ begin
    perform public.tl_ingest_conversion('deadbeef','{}'::jsonb);
    raise notice 'FAIL: anon a pu ingérer une conversion';
  exception when insufficient_privilege then raise notice 'OK: anon bloqué sur tl_ingest_conversion'; end $$;
commit;

\echo '=== mauvaise clé d ingestion (service_role) ==='
begin;
  set local role service_role;
  select public.tl_ingest_conversion(encode(digest('vtl_fake','sha256'),'hex'), '{"external_id":"x","amount":"1"}'::jsonb);
commit;

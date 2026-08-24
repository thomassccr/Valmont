\set ON_ERROR_STOP on
-- utilisateur de test
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','a@x.io') on conflict do nothing;
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','b@x.io') on conflict do nothing;

insert into public.tl_models (id, owner_id, name) values
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','Emma') on conflict do nothing;

insert into public.tl_links (id, owner_id, model_id, name, slug, destination_url, source_code, attribution_window_days)
values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333','Instagram Bio','emma','https://sub.example.com/emma','instagram',30)
on conflict do nothing;

\echo '--- slug réservé (doit échouer) ---'
do $$ begin
  insert into public.tl_links (owner_id, name, slug, destination_url)
  values ('11111111-1111-1111-1111-111111111111','x','api','https://ok.example.com');
  raise notice 'FAIL: slug réservé accepté';
exception when check_violation then raise notice 'OK: slug réservé refusé'; end $$;

\echo '--- destination locale (doit échouer) ---'
do $$ begin
  insert into public.tl_links (owner_id, name, slug, destination_url)
  values ('11111111-1111-1111-1111-111111111111','x','localtest','http://127.0.0.1:8080/x');
  raise notice 'FAIL: destination locale acceptée';
exception when check_violation then raise notice 'OK: destination locale refusée'; end $$;

\echo '--- modèle d''un autre propriétaire (doit échouer) ---'
do $$ begin
  insert into public.tl_links (owner_id, name, slug, destination_url, model_id)
  values ('22222222-2222-2222-2222-222222222222','x','other1','https://ok.example.com','33333333-3333-3333-3333-333333333333');
  raise notice 'FAIL: modèle d''un autre propriétaire accepté';
exception when check_violation then raise notice 'OK: modèle croisé refusé'; end $$;

\echo '--- clics ---'
select destination_url, visitor_public_id is not null as has_visitor
  from public.tl_record_click('emma','visitorkey-aaaa','instagram','{"campaign":"summer"}'::jsonb,'instagram.com','FR','mobile');
select destination_url from public.tl_record_click('emma','visitorkey-aaaa','instagram','{}'::jsonb,null,'FR','mobile'); -- même visiteur
select destination_url from public.tl_record_click('emma','visitorkey-bbbb','tiktok','{}'::jsonb,null,'US','desktop');
\echo '--- slug inconnu -> aucune ligne ---'
select count(*) as rows_for_unknown_slug from public.tl_record_click('nope','visitorkey-cccc');

select clicks, unique_visitors, clicks_today, clicks_7d from public.tl_link_stats where link_id='44444444-4444-4444-4444-444444444444';

\echo '--- conversion attribuée via visitor_id ---'
select public.tl_insert_conversion('11111111-1111-1111-1111-111111111111',
  jsonb_build_object('external_id','cv_1','visitor_id',(select public_id from public.tl_visitors where visitor_key='visitorkey-aaaa'),
                     'fan_id_hash','fan_abc123','amount','49.90','currency','usd'), 'api');

\echo '--- idempotence (même external_id) ---'
select public.tl_insert_conversion('11111111-1111-1111-1111-111111111111',
  jsonb_build_object('external_id','cv_1','amount','49.90'), 'api');

\echo '--- conversion sans correspondance -> non attribuée ---'
select public.tl_insert_conversion('11111111-1111-1111-1111-111111111111',
  jsonb_build_object('external_id','cv_2','amount','20','fan_id_hash','fan_zzz999'), 'api');

\echo '--- conversion hors fenêtre (100 jours avant) -> non attribuée ---'
select public.tl_insert_conversion('11111111-1111-1111-1111-111111111111',
  jsonb_build_object('external_id','cv_3','amount','30','slug','emma','occurred_at',(now()-interval '100 days')::text), 'api');

\echo '--- stats finales ---'
select clicks, unique_visitors, conversions, fans, revenue, conversion_rate, revenue_per_visitor, revenue_per_fan
  from public.tl_link_stats where link_id='44444444-4444-4444-4444-444444444444';
select status, count(*) from public.tl_conversions group by status order by 1;
select matched_on, model, window_days from public.tl_attribution_events;
\echo '--- série quotidienne + sources ---'
select day, clicks, unique_visitors, conversions, revenue from public.tl_link_daily order by day;
select source_code, clicks from public.tl_link_sources order by clicks desc;
-- Les fonctions réservées à l'utilisateur connecté (clés d'API, import,
-- ré-attribution) sont testées dans 02-securite-rls.sql, sous identité.

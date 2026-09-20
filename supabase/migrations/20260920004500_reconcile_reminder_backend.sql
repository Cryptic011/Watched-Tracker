-- Reconcile the live reminder backend with the repository schema and make
-- the production scheduler reproducible.
--
-- This migration is intentionally safe to apply to the existing production
-- reminder tables. Existing rows were validated before adding these checks.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'watchlog_push_subscriptions_endpoint_length_check') then
    alter table public.watchlog_push_subscriptions
      add constraint watchlog_push_subscriptions_endpoint_length_check
      check (char_length(endpoint) between 1 and 4096);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watchlog_push_subscriptions_p256dh_length_check') then
    alter table public.watchlog_push_subscriptions
      add constraint watchlog_push_subscriptions_p256dh_length_check
      check (char_length(p256dh) between 1 and 512);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watchlog_push_subscriptions_auth_length_check') then
    alter table public.watchlog_push_subscriptions
      add constraint watchlog_push_subscriptions_auth_length_check
      check (char_length(auth) between 1 and 256);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watchlog_push_subscriptions_expiration_check') then
    alter table public.watchlog_push_subscriptions
      add constraint watchlog_push_subscriptions_expiration_check
      check (expiration_time is null or expiration_time >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watchlog_push_subscriptions_timezone_length_check') then
    alter table public.watchlog_push_subscriptions
      add constraint watchlog_push_subscriptions_timezone_length_check
      check (char_length(time_zone) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watchlog_push_subscriptions_locale_length_check') then
    alter table public.watchlog_push_subscriptions
      add constraint watchlog_push_subscriptions_locale_length_check
      check (char_length(locale) between 1 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watchlog_push_deliveries_attempts_check') then
    alter table public.watchlog_push_deliveries
      add constraint watchlog_push_deliveries_attempts_check check (attempts >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watchlog_push_tests_attempts_check') then
    alter table public.watchlog_push_tests
      add constraint watchlog_push_tests_attempts_check check (attempts >= 0);
  end if;
end
$$;

-- Remove superseded live-only indexes and normalize the account lookup index
-- to the definition in the canonical create_push_backend migration.
drop index if exists public.watchlog_push_deliveries_retry_idx;
drop index if exists public.watchlog_push_tests_due_idx;
drop index if exists public.watchlog_push_subscriptions_account_idx;
create index if not exists watchlog_push_subscriptions_account_idx
  on public.watchlog_push_subscriptions (account_id);

-- The scheduler uses pg_cron and pg_net. No VAPID or cron secret is stored in
-- source control; the helper reads the generated secret at execution time.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.watchlog_trigger_reminder_scan()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_id bigint;
  secret_value text;
begin
  select cron_secret
    into secret_value
    from public.watchlog_push_config
   where singleton = true;

  if secret_value is null then
    raise exception 'WatchLog reminder cron secret is missing';
  end if;

  select net.http_post(
    url := 'https://okkwteywtgfsnlrjdyhv.supabase.co/functions/v1/watchlog-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-WatchLog-Cron', secret_value
    ),
    body := jsonb_build_object('action', 'process'),
    timeout_milliseconds := 10000
  ) into request_id;

  return request_id;
end;
$function$;

revoke all on function public.watchlog_trigger_reminder_scan() from public;
revoke all on function public.watchlog_trigger_reminder_scan() from anon;
revoke all on function public.watchlog_trigger_reminder_scan() from authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'watchlog-background-reminders'
  order by jobid
  limit 1;

  if existing_job is null then
    perform cron.schedule(
      'watchlog-background-reminders',
      '* * * * *',
      'select public.watchlog_trigger_reminder_scan();'
    );
  else
    update cron.job
       set schedule = '* * * * *',
           command = 'select public.watchlog_trigger_reminder_scan();',
           active = true
     where jobid = existing_job;
  end if;
end
$$;

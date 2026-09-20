-- Reproducible schema for Watched Logger's background reminder service.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.watchlog_push_config (
  singleton boolean primary key default true check (singleton),
  vapid_public_key text,
  vapid_private_key text,
  cron_secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  last_scan_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

insert into public.watchlog_push_config (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.watchlog_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.watchlog_pin_accounts(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  time_zone text not null default 'UTC',
  locale text not null default 'en',
  enabled boolean not null default true,
  last_seen_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (char_length(endpoint) between 1 and 4096),
  check (char_length(p256dh) between 1 and 512),
  check (char_length(auth) between 1 and 256),
  check (expiration_time is null or expiration_time >= 0),
  check (char_length(time_zone) between 1 and 80),
  check (char_length(locale) between 1 and 40)
);

create index if not exists watchlog_push_subscriptions_account_idx
  on public.watchlog_push_subscriptions (account_id);
create index if not exists watchlog_push_subscriptions_enabled_idx
  on public.watchlog_push_subscriptions (enabled)
  where enabled;

create table if not exists public.watchlog_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.watchlog_push_subscriptions(id) on delete cascade,
  account_id uuid not null references public.watchlog_pin_accounts(id) on delete cascade,
  item_id text not null,
  event_key text not null,
  scheduled_for timestamp with time zone not null,
  status text not null default 'pending'
    check (status in ('pending', 'retry', 'sent', 'expired')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamp with time zone,
  sent_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (subscription_id, event_key)
);

create index if not exists watchlog_push_deliveries_pending_idx
  on public.watchlog_push_deliveries (status, next_attempt_at)
  where status in ('pending', 'retry');
create index if not exists watchlog_push_deliveries_account_idx
  on public.watchlog_push_deliveries (account_id);

create table if not exists public.watchlog_push_tests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.watchlog_pin_accounts(id) on delete cascade,
  title text not null,
  body text not null,
  due_at timestamp with time zone not null,
  status text not null default 'pending'
    check (status in ('pending', 'retry', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamp with time zone,
  sent_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists watchlog_push_tests_pending_idx
  on public.watchlog_push_tests (status, due_at, next_attempt_at)
  where status in ('pending', 'retry');
create index if not exists watchlog_push_tests_account_idx
  on public.watchlog_push_tests (account_id);

alter table public.watchlog_push_config enable row level security;
alter table public.watchlog_push_subscriptions enable row level security;
alter table public.watchlog_push_deliveries enable row level security;
alter table public.watchlog_push_tests enable row level security;

revoke all on table public.watchlog_push_config from public, anon, authenticated;
revoke all on table public.watchlog_push_subscriptions from public, anon, authenticated;
revoke all on table public.watchlog_push_deliveries from public, anon, authenticated;
revoke all on table public.watchlog_push_tests from public, anon, authenticated;
grant all on table public.watchlog_push_config to service_role;
grant all on table public.watchlog_push_subscriptions to service_role;
grant all on table public.watchlog_push_deliveries to service_role;
grant all on table public.watchlog_push_tests to service_role;

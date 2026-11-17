-- Shredbound clipper dashboard (Supabase project "shredbound", yptfcpxaihfboteltuhq).
-- Migrations "clipper_leaderboard" (2026-11-16) and supabase/migrations/0002_clipper_access.sql
-- (2026-11-17); this file is the resulting state of the clipper tables. The
-- access-system changes of 0002 (access_codes.revoked_reason,
-- access_devices.last_played_at, access_credit) are kept in the Shredbound
-- repo's Tools/online/access/schema.sql.
--
-- Every table is closed to clients (RLS on, no policies): the "clippers" edge
-- function, with the service role, is the only way in.
--
-- No shared secret is stored in plain text: the clipper code, the owner code
-- (both lowercased) and the scan's admin secret are kept only as sha256 hashes
-- in clipper_config, inserted by hand (never in a migration or a committed
-- file). A clipper's own game code is kept in plain text in clipper_accounts
-- (closed table) so the dashboard can show it to them.

create table if not exists public.clipper_accounts (
  username text primary key check (username ~ '^[a-z0-9_.]{2,24}$'),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  -- Their game code (10 digits) and its row in public.access_codes (name "@<username>").
  game_code text check (game_code ~ '^[0-9]{10}$'),
  game_code_id bigint references public.access_codes (id) on delete set null,
  -- When the owner last gave access back (the 3 days start again from there),
  -- and when the 3-day rule last took it.
  access_restored_at timestamptz,
  lost_access_at timestamptz
);
create unique index if not exists clipper_accounts_game_code on public.clipper_accounts (game_code);
alter table public.clipper_accounts enable row level security;

-- One daily reading of one profile. ok=false keeps the reason (not_found,
-- private, no_data, blocked). last_video_at is the newest post's upload time.
create table if not exists public.clipper_snapshots (
  id bigint generated always as identity primary key,
  username text not null references public.clipper_accounts(username) on delete cascade,
  taken_at timestamptz not null default now(),
  ok boolean not null default true,
  error text check (char_length(error) <= 40),
  followers bigint check (followers >= 0),
  likes bigint check (likes >= 0),
  videos int check (videos >= 0),
  views bigint check (views >= 0),
  last_video_at timestamptz
);
create index if not exists clipper_snapshots_user_time on public.clipper_snapshots (username, taken_at desc);
alter table public.clipper_snapshots enable row level security;

-- A clipper's reason for not posting. While one runs, the 3-day rule waits.
-- ended_by 'owner' = turned down (counts as never given).
create table if not exists public.clipper_reasons (
  id bigint generated always as identity primary key,
  username text not null references public.clipper_accounts (username) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now(),
  until timestamptz not null,
  ended_at timestamptz,
  ended_by text check (ended_by in ('clipper', 'owner'))
);
create index if not exists clipper_reasons_user on public.clipper_reasons (username, created_at desc);
alter table public.clipper_reasons enable row level security;

-- Events the owner writes; every clipper sees them.
create table if not exists public.clipper_events (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 80),
  details text not null default '' check (char_length(details) <= 2000),
  prize text not null default '' check (char_length(prize) <= 120),
  starts_at timestamptz,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clipper_events enable row level security;

create table if not exists public.clipper_config (
  id int primary key default 1 check (id = 1),
  join_code_sha256 text not null check (join_code_sha256 ~ '^[0-9a-f]{64}$'),
  owner_code_sha256 text not null check (owner_code_sha256 ~ '^[0-9a-f]{64}$'),
  admin_secret_sha256 text not null check (admin_secret_sha256 ~ '^[0-9a-f]{64}$'),
  token_secret text not null check (char_length(token_secret) >= 32)
);
alter table public.clipper_config enable row level security;

-- Failed codes per IP, for a simple rate limit.
create table if not exists public.clipper_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists clipper_failures_ip_at on public.clipper_failures (ip, at desc);
alter table public.clipper_failures enable row level security;

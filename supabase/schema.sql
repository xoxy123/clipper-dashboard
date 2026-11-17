-- Shredbound clipper leaderboard (Supabase project "shredbound", yptfcpxaihfboteltuhq).
-- Applied as migration "clipper_leaderboard"; this file is the resulting state.
--
-- Clippers join on the dashboard with the shared join code and their TikTok
-- username. Once a week a scan reads each public TikTok profile and records a
-- snapshot (followers, likes, video count, total views). Every table is closed
-- to clients (RLS on, no policies): the "clippers" edge function, with the
-- service role, is the only way in.
--
-- No plain secret is stored: the join code and the admin secret are kept only
-- as sha256 hashes in clipper_config, inserted by hand (never in a migration or
-- a committed file).

create table if not exists public.clipper_accounts (
  username text primary key check (username ~ '^[a-z0-9_.]{2,24}$'),
  joined_at timestamptz not null default now(),
  removed_at timestamptz
);
alter table public.clipper_accounts enable row level security;

-- One weekly reading of one profile. ok=false keeps the reason (not_found,
-- private, no_data) so the dashboard can say why a week is missing.
create table if not exists public.clipper_snapshots (
  id bigint generated always as identity primary key,
  username text not null references public.clipper_accounts(username) on delete cascade,
  taken_at timestamptz not null default now(),
  ok boolean not null default true,
  error text check (char_length(error) <= 40),
  followers bigint check (followers >= 0),
  likes bigint check (likes >= 0),
  videos int check (videos >= 0),
  views bigint check (views >= 0)
);
create index if not exists clipper_snapshots_user_time on public.clipper_snapshots (username, taken_at desc);
alter table public.clipper_snapshots enable row level security;

create table if not exists public.clipper_config (
  id int primary key default 1 check (id = 1),
  join_code_sha256 text not null check (join_code_sha256 ~ '^[0-9a-f]{64}$'),
  admin_secret_sha256 text not null check (admin_secret_sha256 ~ '^[0-9a-f]{64}$'),
  token_secret text not null check (char_length(token_secret) >= 32)
);
alter table public.clipper_config enable row level security;

-- Failed join codes per IP, for a simple rate limit.
create table if not exists public.clipper_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists clipper_failures_ip_at on public.clipper_failures (ip, at desc);
alter table public.clipper_failures enable row level security;

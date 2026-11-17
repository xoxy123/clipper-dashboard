-- 2026-11-17: personal game codes for clippers, the 3-day clipping rule,
-- reasons, events, owner login. Applied to project "shredbound".

-- Access system (Shredbound repo Tools/online/access/schema.sql keeps the same state).
alter table public.access_codes add column if not exists revoked_reason text
  check (revoked_reason in ('inactive'));
alter table public.access_devices add column if not exists last_played_at timestamptz;

create or replace function public.access_credit(
  p_device text, p_seconds int, p_min_gap int, p_map text)
returns int
language plpgsql volatile security invoker set search_path = public as $$
declare
  previous_beat timestamptz;
  credit int;
begin
  select d.last_beat_at into previous_beat
  from public.access_devices d
  where d.device_id = p_device
  for update;
  if not found then
    return null;
  end if;

  if previous_beat is not null and previous_beat > now() - make_interval(secs => p_min_gap) then
    update public.access_devices set last_seen = now() where device_id = p_device;
    return 0;
  end if;

  credit := greatest(0, least(
    p_seconds,
    coalesce(floor(extract(epoch from now() - previous_beat))::int, p_seconds)));
  update public.access_devices d
     set play_seconds = d.play_seconds + credit,
         last_beat_at = now(),
         last_seen = now(),
         last_played_at = case when credit > 0 then now() else d.last_played_at end,
         last_map = case when coalesce(p_map, '') <> '' then p_map else d.last_map end
   where d.device_id = p_device;
  if credit > 0 then
    insert into public.play_days as p (device_id, day, seconds)
    values (p_device, (now() at time zone 'utc')::date, credit)
    on conflict (device_id, day) do update set seconds = p.seconds + excluded.seconds;
  end if;

  return credit;
end;
$$;
revoke all on function public.access_credit(text, int, int, text) from public, anon, authenticated;
grant execute on function public.access_credit(text, int, int, text) to service_role;

-- Clippers.
alter table public.clipper_config add column if not exists owner_code_sha256 text
  check (owner_code_sha256 ~ '^[0-9a-f]{64}$');

alter table public.clipper_accounts
  add column if not exists game_code text check (game_code ~ '^[0-9]{10}$'),
  add column if not exists game_code_id bigint references public.access_codes (id) on delete set null,
  add column if not exists access_restored_at timestamptz,
  add column if not exists lost_access_at timestamptz;
create unique index if not exists clipper_accounts_game_code on public.clipper_accounts (game_code);

alter table public.clipper_snapshots add column if not exists last_video_at timestamptz;

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

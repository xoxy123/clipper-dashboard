-- The daily clipper scan runs on Supabase itself (William, 2026-11-23: "make sure
-- its not like dependent on claude"). pg_cron posts {action:"cron.scan"} to the
-- clippers function once a day with x-cron-secret; the function reads every
-- clipper's public TikTok (profile + embed page) and Instagram (embed page),
-- records one snapshot each and applies the 3-day rule (see scan.js).

-- Instagram half of a reading: ig_ok/ig_error/ig_last_post_at come from 0003.
alter table public.clipper_snapshots
  add column if not exists ig_followers bigint check (ig_followers >= 0),
  add column if not exists ig_posts integer check (ig_posts >= 0),
  -- Running total of likes on the posts the scan has seen (Instagram shows no
  -- view counts without a login).
  add column if not exists ig_likes bigint check (ig_likes >= 0),
  add column if not exists source text check (source in ('browser', 'server'));

-- The newest videos/posts each reading saw, with their count at that reading
-- (TikTok views, Instagram likes), so the next reading adds only what they gained.
create table if not exists public.clipper_videos (
  platform text not null check (platform in ('tiktok', 'instagram')),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  username text not null,
  posted_at timestamptz,
  value bigint not null default 0 check (value >= 0),
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (platform, video_id)
);
create index if not exists clipper_videos_username on public.clipper_videos (username);
alter table public.clipper_videos enable row level security;
revoke all on public.clipper_videos from anon, authenticated;

-- The cron's secret. Only the database and the function know it.
alter table public.clipper_config add column if not exists scan_cron_secret text;
update public.clipper_config
  set scan_cron_secret = encode(extensions.gen_random_bytes(32), 'hex')
  where scan_cron_secret is null;

-- Every day at 17:00 UTC (10:00 in New Mexico, 18:00 in Sweden).
select cron.unschedule('clipper-daily-scan') where exists (select 1 from cron.job where jobname = 'clipper-daily-scan');
select cron.schedule('clipper-daily-scan', '0 17 * * *', $cron$
  select net.http_post(
    url := 'https://yptfcpxaihfboteltuhq.supabase.co/functions/v1/clippers',
    body := '{"action":"cron.scan"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select scan_cron_secret from public.clipper_config where id = 1)),
    timeout_milliseconds := 150000)
$cron$);

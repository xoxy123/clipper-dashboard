-- Each clipper's posts with their own numbers, the right TikTok handle, and a
-- fresher scan (William, 2026-11-26: clippers post but the dashboard said they
-- had not, so their videos were never analysed; he wants each clipper's total
-- views and every video's numbers when he clicks their profile).

-- The TikTok handle the scan reads, when it is not the username the clipper
-- joined with (one clipper typed their TikTok display name, which no TikTok
-- profile has, so every reading failed). Null means: read the username.
-- tiktok_set_at restarts the 3-day clock: while their profile could not be
-- read, the dashboard could not show them when their next video was due.
alter table public.clipper_accounts
  add column if not exists tiktok text check (tiktok ~ '^[a-z0-9_.]{2,24}$'),
  add column if not exists tiktok_set_at timestamptz;

-- Every post the scan has seen, with its own numbers. "value" stays the count
-- the last reading saw (TikTok views, Instagram likes) for the running totals.
alter table public.clipper_videos
  add column if not exists handle text check (char_length(handle) <= 40),
  add column if not exists caption text check (char_length(caption) <= 400),
  add column if not exists kind text check (kind in ('video', 'photo', 'carousel', 'image')),
  add column if not exists views bigint check (views >= 0),
  add column if not exists likes bigint check (likes >= 0),
  add column if not exists comments bigint check (comments >= 0),
  add column if not exists shares bigint check (shares >= 0),
  add column if not exists saves bigint check (saves >= 0),
  add column if not exists duration_s integer check (duration_s >= 0),
  -- When the post's own page (likes, comments, shares, saves) was last read.
  add column if not exists detail_at timestamptz,
  add column if not exists last_seen_at timestamptz;

-- Readings between the daily ones: "refresh" (every 2 hours, no rule) and
-- "manual" (the owner's or the clipper's "check now"). The daily 17:00 reading
-- stays "server" and is the only one that applies the 3-day rule.
alter table public.clipper_snapshots drop constraint if exists clipper_snapshots_source_check;
alter table public.clipper_snapshots add constraint clipper_snapshots_source_check
  check (source in ('browser', 'server', 'refresh', 'manual'));

-- Every 2 hours at :30, so a new post shows within 2 hours instead of a day.
select cron.unschedule('clipper-refresh-scan') where exists (select 1 from cron.job where jobname = 'clipper-refresh-scan');
select cron.schedule('clipper-refresh-scan', '30 */2 * * *', $cron$
  select net.http_post(
    url := 'https://yptfcpxaihfboteltuhq.supabase.co/functions/v1/clippers',
    body := '{"action":"cron.scan","enforce":false}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select scan_cron_secret from public.clipper_config where id = 1)),
    timeout_milliseconds := 150000)
$cron$);

-- 2026-11-18: clippers give their Instagram too; a post on TikTok or Instagram
-- counts for the 3-day rule; the owner can mark someone a playtester, whom the
-- rule never touches (only the owner removes a playtester's access).
-- William, 2026-11-18: "we should be able to see their username and whats their
-- tiktok and insta acc ... INCASE they are playtesters, then theyre access should
-- never be removed incase i remove it."
alter table public.clipper_accounts
  add column if not exists instagram text check (instagram ~ '^[a-z0-9_.]{1,30}$'),
  add column if not exists playtester boolean not null default false;

-- One daily reading also holds the Instagram half: ig_ok null = no Instagram
-- given; ig_last_post_at = newest post or reel the profile page shows.
alter table public.clipper_snapshots
  add column if not exists ig_ok boolean,
  add column if not exists ig_error text check (char_length(ig_error) <= 40),
  add column if not exists ig_last_post_at timestamptz;

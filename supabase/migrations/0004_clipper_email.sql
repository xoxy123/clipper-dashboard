-- 2026-11-18: clippers give an email when they join and get a welcome mail with
-- their game code, the dashboard link and how to put it on the iPhone home screen.
-- William: "they should get the code by mail and link to dashboard and instructions".
alter table public.clipper_accounts
  add column if not exists email text check (char_length(email) <= 254),
  add column if not exists welcome_mailed_at timestamptz,
  add column if not exists welcome_error text check (char_length(welcome_error) <= 200);

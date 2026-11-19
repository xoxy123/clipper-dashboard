-- 2026-11-19: joining is an application; the owner approves it in the dashboard,
-- and only then the clipper gets a game code and the welcome mail.
-- William: "i can see applications of those who have applied and i can click approve
-- and then they get sent on mail that they got approved and then the instructions".
alter table public.clipper_accounts
  add column if not exists status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  add column if not exists applied_at timestamptz,
  add column if not exists decided_at timestamptz;

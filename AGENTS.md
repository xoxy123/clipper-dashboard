# Clipper dashboard: handoff for Codex (2026-11-18)

Claude built this dashboard and it is live at https://xoxy123.github.io/clipper-dashboard/
(GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`).
William wants Codex to continue it, mainly the **design**. Everything below already works:
keep the behaviour, change the look.

**This repo is PUBLIC.** Never commit codes, passwords, keys or secrets. The login codes are
stored only as sha256 hashes in the database. William has them in a private file on his Desktop.

## What it is

A dashboard for Shredbound's TikTok clippers.
- **Clippers** log in with the shared clipper code plus their TikTok username. On a new device
  they log in with their own 10-digit game code.
- **The owner (William)** logs in with the owner code.

Sections (hash routing in `src/app.js`, `TABS` in `src/view.js`):
- **Leaderboard** (everyone): top 3 by total TikTok views, and top 3 "most improved" (views
  gained over about 7 days). A "show all" table sits under each board.
- **My account** (clippers):
  - their personal game access code, with a copy button, and its status (Active, Lost access,
    Access taken);
  - "post your next video before …", their last video and last play;
  - a form to give a reason for not posting (up to 30 days);
  - their TikTok stats with weekly change, and a views chart (inline SVG).
- **Events** (everyone sees them; only the owner writes): title, prize, details, optional start,
  end, with a live countdown.
- **Applications** (owner only): joining with the clipper code is an application (TikTok + email).
  Approve makes the game code and mails it (approved + code + dashboard link + iPhone home-screen
  steps); Reject turns them down. `owner.approve` / `owner.reject`.
- **Playtesters** (owner only): every game code that is not a clipper's. Buyers are added by
  themselves: a paid Stripe checkout makes a code and mails it within a minute (the `store-orders`
  function in the Shredbound repo). Shown: name, email, type (Bought or Playtester), game code,
  in-game name, paid amount, code mail status, devices and last seen, with Take access / Give access
  back. The 3-day rule never touches these.
- **Clippers** (owner only): a table of every clipper with game code, status, last video, last
  played, next video due, reason and devices. Buttons: Give access back, Take access, Turn down
  reason, Remove.

## Files

- `src/index.html`, `src/style.css`: the page. Plain HTML, CSS and ES modules; no framework,
  no build step except copying.
- `src/view.js`: pure HTML builders (tested). **Most design work happens here and in style.css.**
- `src/app.js`: login, tabs, click and submit handling.
- `src/api.js`: calls the backend.
- `src/config.js`: the Supabase URL and the public anon key (public by design).
- `scripts/build.mjs`: copies `src/` to `dist/` and fails if a secret-looking string is in it.
- `tests/board.test.mjs`: `npm test` (node --test), covering the rule maths and the views.
  Keep them passing.
- `supabase/functions/clippers/`:
  - `index.ts`: the edge function, the only backend;
  - `board.js`: leaderboard maths and the 3-day rule `clipRule`, shared with the tests.
- `supabase/schema.sql`, `supabase/migrations/`: the database state.
- `scripts/tiktok-extract.js`: runs in a browser tab on a TikTok profile and reads followers,
  likes, videos, total views and the newest upload time (from the post id: `id >> 32` = Unix
  seconds).
- `scripts/clippers.mjs`: admin CLI for the daily scan (`list`, `record`, `remove`). It reads
  the admin secret from `~/.config/shredbound/clipper-admin-secret`. Never print that secret.

## Backend

Supabase project `yptfcpxaihfboteltuhq` (shared with the Shredbound game), edge function
`clippers`. Deploy it with:
`supabase functions deploy clippers --project-ref yptfcpxaihfboteltuhq --use-api`.

All requests are POST JSON `{action, ...}`; see the header comment in `index.ts`:
- `join`, `state`, `reason`, `reason.end`
- `owner.access`, `owner.remove`, `owner.code` (a playtester's or buyer's code on/off), `owner.reason.end`, `owner.event.save`, `owner.event.delete`
- `admin.list`, `admin.record`, `admin.remove`

The tables are `clipper_accounts`, `clipper_snapshots`, `clipper_reasons`, `clipper_events`,
`clipper_config` and `clipper_failures`. All have RLS on and no policies, so the function is
the only way in. Never select `clipper_config` or `access_config` whole: they hold secrets.

Each clipper gets a row in `public.access_codes` (the game's access system), named
`@username`. The game checks codes through the `access` function (Shredbound repo,
`Tools/online/access`).

## The 3-day rule

A clipper loses game access when all three are true:
1. no video in the last 72 h;
2. they played Shredbound in those 72 h (`access_devices.last_played_at`, set by
   `access_credit` when a beat credits play time);
3. they have no running reason.

Not playing at all excuses them. The clock restarts at the newest of: last video, joining, the
owner giving access back, and the end of a reason. A reason the owner turned down counts for
nothing.

Taking access sets `access_codes.revoked_reason = 'inactive'`. The game then shows: "YOU LOST
ACCESS TO SHREDBOUND FOR NOT CLIPPING FOR 3 DAYS. DM willll0838 ON DISCORD OR SEND A MAIL TO
shredboundofficial@gmail.com TO APPEAL." Appeal: the owner presses Give access back.

The rule runs only inside `admin.record`, on fresh readings. A failed scan never takes access.

## Scan

Since 2026-11-23 the scan runs on Supabase itself (pg_cron, `cron.scan` in `index.ts`, parsers in
`scan.js`); since 2026-11-26 every 2 hours for readings and once a day (17:00 UTC) for the 3-day
rule. See README.md, "Scan". It reads `clipper_accounts.tiktok` when set (a clipper whose TikTok
username was typed wrong), else the username. Every post seen is kept in `clipper_videos` with its
own views, likes, comments, shares and saves; the owner's clipper profile (`#clipper/<username>`,
action `profile`) shows them. The old Claude desktop task `clipper-weekly-scan` is paused; keep it
only as a manual fallback.

## Unfinished: William asked for it on 2026-11-18, then paused it

Migration `supabase/migrations/0003_players.sql` is **applied to the database but not
committed**, and no code uses it yet. It adds:
- `clipper_accounts.instagram` and `clipper_accounts.playtester`;
- `clipper_snapshots.ig_ok`, `ig_error` and `ig_last_post_at`.

What William wants:
1. Clippers enter their Instagram username too (join form, editable in My account).
2. The owner view shows, for every private game code: the in-game username
   (`rider_profiles.username` where `rider_profiles.code_id` = the code), TikTok and Instagram.
   This includes codes that are not clippers' (buyers in `store_orders.code_id`, playtest codes
   made in the Shredbound dashboard's Koder tab).
3. A post on TikTok **or** Instagram counts for the 3-day rule.
   - Instagram's newest post time comes from the shortcodes in the profile page's
     `/p/` and `/reel/` links: decode the base64 alphabet
     `A-Za-z0-9-_` to an id, then `(id >> 23) + 1314220021721` ms. Checked against a real post:
     22 s off.
   - Read only what the page shows. Calling Instagram's internal API was refused, so don't.
4. **Playtesters**: an owner switch per person. The rule never removes a playtester's access;
   only the owner can. Buyers must never be removed by the rule either.

## Design notes

- Dark theme. The palette is CSS tokens in `:root` (gold accent `#d9b45f`), with Cinzel,
  Spectral and IBM Plex Mono from Google Fonts. It matches the Shredbound dashboard.
- It must work at phone width (no horizontal page scroll; wide tables scroll inside `.scroll`).
- English UI.

## Related

- The Shredbound dashboard (`~/Projects/shredbound-dashboard`, https://xoxy123.github.io/shredbound-dashboard/)
  has sales (Stripe), the funnel and codes. Its `funnel` function reads `clipper_snapshots`.
- Game: `~/Dev/shredbound`.

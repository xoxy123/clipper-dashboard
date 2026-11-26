# Shredbound Clippers

Dashboard for Shredbound's TikTok clippers, published on GitHub Pages at
`https://xoxy123.github.io/clipper-dashboard/`.


## Scan (on Supabase, since 2026-11-23; every 2 hours since 2026-11-26)

The scan needs no Claude, browser or Mac. Two pg_cron jobs post to the `clippers` function with `x-cron-secret` (`clipper_config.scan_cron_secret`): `clipper-daily-scan` at 17:00 UTC (`{action:"cron.scan"}`, the only scan that applies the 3-day rule) and `clipper-refresh-scan` every 2 hours at :30 (`{action:"cron.scan", enforce:false}`, reads only). See `supabase/migrations/0006_server_scan.sql` and `0007_posts_and_handles.sql`.

For each approved clipper the function reads:
- the public TikTok profile page (followers, likes, video count);
- the TikTok embed page (the 10 newest videos with play counts and captions; a video id holds its upload time);
- each new or due post's own page (`tiktok.com/@<handle>/video/<id>`: views, likes, comments, shares, saves, length), at most 60 a scan: a new post at once, a post under 3 days old every 2 hours, older ones once a day;
- the Instagram profile embed when the clipper gave an Instagram username (followers, posts, the 6 newest posts with likes, comments and captions; Instagram answers it only to a phone user agent and shows no view counts).

Every post seen is kept in `clipper_videos` with its own numbers, so the owner's profile page shows each clipper's posts (and a clipper sees their own in My account). A caption that names the game (`#shredbound`, `@shredbound.official`, "shrebound") marks a Shredbound clip. Parsers and the running view/like totals are in `supabase/functions/clippers/scan.js`; `postView` and `postStats` in `board.js`. A post on Instagram counts for the 3-day rule like a TikTok. The rule runs only on complete readings: a failed TikTok (or Instagram, when given) reading never takes a code. Readings between the daily ones (`source` `refresh` and `manual`) are deleted after 2 days; the daily ones stay.

**The TikTok handle.** The scan reads `clipper_accounts.tiktok` when the owner set one, else the username they joined with. On 2026-11-26 one clipper had joined with their TikTok display name: no such profile existed, every reading said `not_found`, and none of their posts were seen. Applying now refuses a username TikTok answers "no such user" for (`tiktok_not_found`); the owner fixes an existing one with **Change TikTok** on the clipper's profile (`owner.tiktok`), which restarts that clipper's 3 days (`tiktok_set_at`) and reads them at once.

**Check now.** The owner's profile page reads a clipper at once (`owner.scan`); a clipper's My account has "Just posted? Check now" (`scan.me`, at most every 10 minutes). Neither applies the rule.

Clippers set their Instagram in My account; the owner can set it in the Clippers tab or on the profile. `scripts/clippers.mjs` and `scripts/tiktok-extract.js` (the old browser scan) still work as a manual fallback.

## Logging in

One code field (plus the TikTok username for a first join):

- **Clipper code + TikTok username**: a new clipper joins and gets their own
  game access code (10 digits). A username can join only once.
- **Their game code**: logs that clipper in on a new device.
- **Owner code**: the owner. No username.

The codes themselves are not in this repo. Their sha256 hashes live in
`public.clipper_config`; to change one, set `join_code_sha256` or
`owner_code_sha256` to the sha256 of the new lowercased code (a new owner code
also logs old owner sessions out).

## Sections

- **Leaderboard**: top 3 by total views, and top 3 most improved (views gained
  in the last 7 days).
- **My account** (clippers): their game code with a copy button, whether it is
  active, when their next video is due, last video and last play, a form to give
  a reason for not posting, and their TikTok numbers with weekly change.
- **Events**: everyone sees them; only the owner can add, edit and delete
  (title, prize, details, optional start, end).
- **Clippers** (owner): every clipper's game code, status, total views, posts
  since joining, last video, last play, due time and reason, with Give access
  back, Take access, Turn down reason and Remove. A click on a clipper opens
  their **profile** (`#clipper/<username>`): status and due time, TikTok and
  Instagram numbers with a views chart, what their posts add up to (posts since
  joining, Shredbound clips, views on them, average views) and every post with
  its date, views, likes, comments, shares, saves, engagement and length.
  Leaderboard names open the profile too.

## The 3-day rule

A clipper who has not posted a video for 3 days, has given no running reason,
and played Shredbound in those 3 days loses game access. Not playing excuses
them. The clock starts at the newest of their last video, joining, the owner
giving access back, the owner correcting their TikTok handle, and the end of
their last reason; a reason the owner turned down counts for nothing. The rule
runs only in the daily 17:00 UTC scan, on a fresh reading of the clipper (a
failed scan never takes a code). Code:
`supabase/functions/clippers/board.js` `clipRule`.

Taking access revokes the clipper's row in `public.access_codes` with
`revoked_reason = 'inactive'`. The game's access function then answers
`revoked` with reason `inactive`, and the game shows how to appeal (DM
willll0838 on Discord or mail shredboundofficial@gmail.com). That text is in
the Shredbound repo (`Assets/Shredbound/Runtime/Online/AccessGateFlow.cs`);
builds made before it show ACCESS REMOVED. "Played" means a beat that credited
play time (`access_devices.last_played_at`).

## How it works

- `src/` is the static page. It talks only to the `clippers` edge function on
  Shredbound's Supabase project (`yptfcpxaihfboteltuhq`) with the public anon key.
- `supabase/functions/clippers/` is the edge function; `board.js` holds the
  leaderboard and rule maths and is shared with the tests. `supabase/schema.sql`
  is the database state (tables closed to clients; RLS on, no policies).
- Wrong codes are rate limited per IP (15 per 10 minutes).

## Old browser scan (manual fallback)

The scheduled task `clipper-weekly-scan` (paused) (now daily at about 18:00, Claude
desktop app) lists the clippers, opens each public profile at
`https://www.tiktok.com/@<username>`, runs `scripts/tiktok-extract.js` in the
page, and records the results:

```sh
node scripts/clippers.mjs list
node scripts/clippers.mjs record < snapshots.json
node scripts/clippers.mjs remove <username>
```

The admin secret lives in `~/.config/shredbound/clipper-admin-secret` (chmod 600)
and is sent only as the `x-admin-secret` header. Never print or commit it.

Followers, likes and video count come exact from the profile page's data block.
Views are the sum of each video's play count (exact from TikTok's own responses
where caught, otherwise the rounded grid label such as "12.3K"). The newest
post's upload time comes from the post ids (the top 32 bits are Unix seconds;
checked against TikTok's own createTime). The scan only reads public profiles;
it never logs in as, posts, follows or likes anything.

## Development

```sh
npm test
npm run dev   # http://127.0.0.1:4319/
supabase functions deploy clippers --project-ref yptfcpxaihfboteltuhq --use-api
```

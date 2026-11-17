# Shredbound Clippers

Dashboard for Shredbound's TikTok clippers, published on GitHub Pages at
`https://xoxy123.github.io/clipper-dashboard/`.

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
- **Clippers** (owner): every clipper's game code, status, last video, last
  play, due time and reason, with Give access back, Take access, Turn down
  reason and Remove.

## The 3-day rule

A clipper who has not posted a video for 3 days, has given no running reason,
and played Shredbound in those 3 days loses game access. Not playing excuses
them. The clock starts at the newest of their last video, joining, the owner
giving access back, and the end of their last reason; a reason the owner turned
down counts for nothing. The rule runs when the daily scan records a fresh
reading of the clipper (a failed scan never takes a code). Code:
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

## Daily scan

The scheduled task `clipper-weekly-scan` (now daily at about 18:00, Claude
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

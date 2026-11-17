# Shredbound Clippers

Leaderboard for Shredbound's TikTok clippers, published on GitHub Pages at
`https://xoxy123.github.io/clipper-dashboard/`.

A clipper opens the page, enters the clipper code and their TikTok username, and
then sees:

- **Most views**: top 3 by total views on all videos on their profile.
- **Most improved**: top 3 by views gained since the previous weekly scan (ties
  broken by followers gained). Needs two scans at least 5 days apart.
- **My account**: their place on both boards, and views, followers, likes and
  video count with the change since last week, plus a views-per-scan chart.

## How it works

- `src/` is the static page. It talks only to the `clippers` edge function on
  Shredbound's Supabase project (`yptfcpxaihfboteltuhq`) with the public anon key.
- `supabase/functions/clippers/` is the edge function; `board.js` holds the
  leaderboard maths and is shared with the tests. `supabase/schema.sql` is the
  database state (tables closed to clients; RLS on, no policies).
- The join code and the admin secret are stored only as sha256 hashes in
  `public.clipper_config`. A join returns a signed token kept in the browser's
  localStorage. To change the join code, update `join_code_sha256` with the
  sha256 of the new code.
- Wrong codes are rate limited per IP (15 per 10 minutes).

## Weekly scan

The scheduled task `clipper-weekly-scan` (Sundays about 18:00, Claude desktop app)
lists the clippers, opens each public profile at `https://www.tiktok.com/@<username>`,
runs `scripts/tiktok-extract.js` in the page, and records the results:

```sh
node scripts/clippers.mjs list
node scripts/clippers.mjs record < snapshots.json
node scripts/clippers.mjs remove <username>
```

The admin secret lives in `~/.config/shredbound/clipper-admin-secret` (chmod 600)
and is sent only as the `x-admin-secret` header. Never print or commit it.

Followers, likes and video count come exact from the profile page's data block.
Views are the sum of each video's play count (exact from TikTok's own responses
where caught, otherwise the rounded grid label such as "12.3K"). The scan only
reads public profiles; it never logs in as, posts, follows or likes anything.

## Development

```sh
npm test
npm run dev   # http://127.0.0.1:4319/
supabase functions deploy clippers --project-ref yptfcpxaihfboteltuhq --use-api
```

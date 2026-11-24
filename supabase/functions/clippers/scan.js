// The daily clipper scan, run by Supabase itself (pg_cron, action "cron.scan"):
// no browser, no Claude, no Mac. William, 2026-11-23: "make sure its not like
// dependent on claude ... it watches like once a day".
//
// Pure parsers for the public pages the scan reads, so the tests can run them:
// - TikTok profile  https://www.tiktok.com/@<user>         followers, likes, video count
// - TikTok embed    https://www.tiktok.com/embed/@<user>   the 10 newest videos with play counts
// - Instagram embed https://www.instagram.com/<user>/embed/ followers, post count, the 6 newest posts
// Instagram answers the embed with its data only to a phone browser's user agent;
// it shows no view counts there, so Instagram is tracked by posts and likes.
//
// Views are a running total. The embed shows only the newest 10 videos, so each
// reading adds what those videos gained since the last reading (their counts are
// kept in clipper_videos) plus the full count of videos posted since then. The
// first reading of a new clipper starts from the sum of their newest videos; a
// clipper the old browser scan already read starts from that total.


/** A TikTok video id holds its upload time: the top 32 bits are Unix seconds. */
export function tiktokPostedAt(id) {
  try {
    const seconds = Number(BigInt(String(id)) >> 32n);
    return seconds > 1_400_000_000 ? new Date(seconds * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function scriptJson(html, id) {
  const m = String(html).match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

const n = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));

/** TikTok profile page: exact followers, likes and video count. */
export function parseTikTokProfile(html) {
  const data = scriptJson(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
  const detail = data?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
  const info = detail?.userInfo;
  if (!info?.user) {
    const code = Number(detail?.statusCode);
    return { ok: false, error: code === 10221 || code === 10202 ? 'not_found' : data ? 'no_data' : 'blocked' };
  }
  if (info.user.privateAccount) return { ok: false, error: 'private' };
  const s = info.statsV2 || info.stats || {};
  return { ok: true, followers: n(s.followerCount), likes: n(s.heartCount ?? s.heart), videos: n(s.videoCount) };
}

/** TikTok embed page: the newest videos (id, views, upload time) and the user's counts. */
export function parseTikTokEmbed(html, username) {
  const data = scriptJson(html, '__FRONTITY_CONNECT_STATE__');
  const pages = data?.source?.data;
  if (!pages) return { ok: false, error: 'blocked' };
  const page = pages[`/embed/@${username}`] ?? Object.values(pages).find(p => p && typeof p === 'object' && ('videoList' in p || 'isError' in p));
  if (!page) return { ok: false, error: 'no_data' };
  if (page.isError) {
    const code = Number(page.errorCode);
    return { ok: false, error: code === 10221 ? 'not_found' : code === 10222 || code === 10223 ? 'private' : 'no_data' };
  }
  const u = page.userInfo || {};
  if (u.privateAccount) return { ok: false, error: 'private' };
  const items = (Array.isArray(page.videoList) ? page.videoList : [])
    .filter(v => v && /^\d{6,25}$/.test(String(v.id)) && !v.privateItem)
    .map(v => ({ id: String(v.id), value: n(v.playCount) ?? 0, postedAt: tiktokPostedAt(v.id) }));
  return { ok: true, followers: n(u.followerCount), likes: n(u.heartCount), items };
}

/** Instagram profile embed: followers, post count and the newest posts with likes. */
export function parseInstagramEmbed(html, handle) {
  const page = String(html);
  const m = page.match(/"contextJSON":"((?:\\.|[^"\\])*)"/);
  // A missing (or banned) account gets an empty embed: no context, "EmbedBroken".
  if (!m) return { ok: false, error: /"contextJSON":null/.test(page) && /EmbedBroken/.test(page) ? 'not_found' : 'blocked' };
  let ctx;
  try {
    ctx = JSON.parse(JSON.parse(`"${m[1]}"`))?.context;
  } catch {
    return { ok: false, error: 'no_data' };
  }
  if (!ctx?.username || String(ctx.username).toLowerCase() !== String(handle).toLowerCase()) return { ok: false, error: 'not_found' };
  if (ctx.is_private) return { ok: false, error: 'private' };
  const items = (Array.isArray(ctx.graphql_media) ? ctx.graphql_media : [])
    .map(g => g?.shortcode_media || g)
    .filter(p => p && /^[A-Za-z0-9_-]{5,40}$/.test(String(p.shortcode)) && p.taken_at_timestamp)
    .map(p => ({ id: String(p.shortcode), value: n(p.edge_liked_by?.count) ?? 0, postedAt: new Date(p.taken_at_timestamp * 1000).toISOString() }));
  return { ok: true, followers: n(ctx.followers_count), posts: n(ctx.posts_count), items };
}

/** The newest upload time among the items, or null. */
export const newest = items => items.reduce((m, i) => (i.postedAt && (!m || i.postedAt > m) ? i.postedAt : m), null);

/**
 * Running total (TikTok views, Instagram likes) from the newest items.
 * prevTotal: the last reading's total (null for a first reading).
 * lastReadAt: when that reading was taken. known: item id -> value at the last reading.
 */
export function rollTotal({ prevTotal, lastReadAt, known, items }) {
  if (prevTotal == null) return items.reduce((s, i) => s + i.value, 0);
  let total = prevTotal;
  const since = lastReadAt ? Date.parse(lastReadAt) : null;
  for (const i of items) {
    if (known.has(i.id)) total += Math.max(0, i.value - known.get(i.id));
    // New since the last reading: counted in full. An older one entering the
    // window (a newer video was deleted) is already in the total.
    else if (since == null || (i.postedAt && Date.parse(i.postedAt) > since)) total += i.value;
  }
  return total;
}

/** Instagram usernames: letters, digits, _ and ., up to 30; stored lowercase without @. */
export function cleanInstagram(input) {
  const u = String(input ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?].*$/, '').toLowerCase();
  return /^[a-z0-9_.]{1,30}$/.test(u) ? u : null;
}

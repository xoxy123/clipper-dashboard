// Leaderboard maths, shared by the edge function and the tests. Pure: takes
// rows, returns the board. No I/O.
//
// "Most views" ranks by total views on the profile at the latest scan.
// "Most improved" ranks by views gained in the last week: since the newest ok
// snapshot taken at least MIN_GAP_DAYS before the latest one (scans run daily,
// so that is the one about 7 days back), ties broken by followers gained. A
// clipper without a scan that old has no week yet and is not on that board.

export const MIN_GAP_DAYS = 6.5;
const DAY = 86400000;

const diff = (a, b) => (a == null || b == null ? null : a - b);

export function summarize(accounts, snapshots) {
  const byUser = new Map(accounts.map(a => [a.username, []]));
  for (const s of snapshots) byUser.get(s.username)?.push(s);
  const rows = [];
  for (const a of accounts) {
    const all = byUser.get(a.username).slice().sort((x, y) => Date.parse(y.taken_at) - Date.parse(x.taken_at));
    const good = all.filter(s => s.ok);
    const latest = good[0] || null;
    const prev = latest ? good.find(s => Date.parse(latest.taken_at) - Date.parse(s.taken_at) >= MIN_GAP_DAYS * DAY) || null : null;
    rows.push({
      username: a.username,
      handle: a.tiktok || a.username,
      joinedAt: a.joined_at,
      lastError: all[0] && !all[0].ok ? all[0].error || 'no_data' : null,
      latest: latest && pick(latest),
      previous: prev && pick(prev),
      gained: prev ? {
        views: diff(latest.views, prev.views),
        followers: diff(latest.followers, prev.followers),
        likes: diff(latest.likes, prev.likes),
        videos: diff(latest.videos, prev.videos),
      } : null,
      history: daily(good, HISTORY_DAYS).map(pick),
    });
  }
  const views = rows.filter(r => r.latest?.views != null)
    .sort((a, b) => b.latest.views - a.latest.views || a.username.localeCompare(b.username));
  const improved = rows.filter(r => r.gained?.views != null)
    .sort((a, b) => b.gained.views - a.gained.views || (b.gained.followers ?? 0) - (a.gained.followers ?? 0) || a.username.localeCompare(b.username));
  views.forEach((r, i) => (r.viewsRank = i + 1));
  improved.forEach((r, i) => (r.improvedRank = i + 1));
  const lastScan = snapshots.reduce((m, s) => (!m || Date.parse(s.taken_at) > Date.parse(m) ? s.taken_at : m), null);
  return { rows, views, improved, lastScan, total: rows.length };
}

function pick(s) {
  return { takenAt: s.taken_at, followers: s.followers, likes: s.likes, videos: s.videos, views: s.views };
}

// The scan reads every 2 hours, so a chart takes the last reading of each UTC
// day: newest-first readings in, oldest-first days out, at most `days` of them.
export const HISTORY_DAYS = 60;
export function daily(newestFirst, days = HISTORY_DAYS) {
  const out = [], seen = new Set();
  for (const s of newestFirst) {
    const day = new Date(s.taken_at).toISOString().slice(0, 10);
    if (seen.has(day)) continue;
    seen.add(day);
    out.push(s);
    if (out.length >= days) break;
  }
  return out.reverse();
}

const brief = r => ({ username: r.username, handle: r.handle, views: r.latest?.views ?? null, gained: r.gained?.views ?? null, followersGained: r.gained?.followers ?? null });

// What one clipper sees: both top-3 boards, everyone's place, and their own account.
export function boardFor(username, summary) {
  const me = summary.rows.find(r => r.username === username) || null;
  return {
    lastScan: summary.lastScan,
    total: summary.total,
    topViews: summary.views.slice(0, 3).map(brief),
    topImproved: summary.improved.slice(0, 3).map(brief),
    viewsBoard: summary.views.map(brief),
    improvedBoard: summary.improved.map(brief),
    me: me && {
      username: me.username,
      handle: me.handle,
      joinedAt: me.joinedAt,
      lastError: me.lastError,
      latest: me.latest,
      previous: me.previous,
      gained: me.gained,
      history: me.history,
      viewsRank: me.viewsRank ?? null,
      improvedRank: me.improvedRank ?? null,
      viewsRanked: summary.views.length,
      improvedRanked: summary.improved.length,
    },
  };
}

// TikTok usernames: letters, digits, _ and ., 2-24 long; stored lowercase without @.
export function cleanUsername(input) {
  const u = String(input ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '').replace(/[/?].*$/, '').toLowerCase();
  return /^[a-z0-9_.]{2,24}$/.test(u) ? u : null;
}

// The 3-day clipping rule (William, 2026-11-17): a clipper who has not posted
// a video for 3 days, has given no reason, and played Shredbound in those 3
// days loses game access. Not playing at all excuses them.
//
// The clock starts at the newest of: their last video, when they joined, when
// the owner gave access back, and when their last reason ended. While a reason
// runs, the rule waits. A reason the owner turned down counts for nothing. "Played" is a beat that credited play time
// (access_devices.last_played_at) within the last 3 days.
export const RULE_MS = 72 * 3600 * 1000;

const ms = v => (v == null || v === '' ? null : typeof v === 'number' ? v : Date.parse(v));

/** @param {{ now: any, lastVideoAt?: any, joinedAt?: any, restoredAt?: any, reasons?: any[], lastPlayedAt?: any }} o */
export function clipRule({ now, lastVideoAt, joinedAt, restoredAt, reasons = [], lastPlayedAt }) {
  const n = ms(now);
  let since = Math.max(...[lastVideoAt, joinedAt, restoredAt].map(ms).filter(v => v != null && !Number.isNaN(v)), 0);
  let excuse = null;
  for (const r of reasons) {
    // A reason the owner ended is turned down: as if never given.
    if ((r.ended_by ?? r.endedBy) === 'owner') continue;
    const start = ms(r.created_at ?? r.createdAt);
    const end = Math.min(ms(r.until), ms(r.ended_at ?? r.endedAt) ?? Infinity);
    if (start <= n && n < end) {
      if (!excuse || end > excuse.end) excuse = { ...r, end };
    } else if (end <= n) {
      since = Math.max(since, end);
    }
  }
  const dueAt = since + RULE_MS;
  const played = ms(lastPlayedAt) != null && ms(lastPlayedAt) >= n - RULE_MS;
  return {
    since: new Date(since).toISOString(),
    dueAt: new Date(dueAt).toISOString(),
    excusedUntil: excuse ? new Date(excuse.end).toISOString() : null,
    playedRecently: played,
    revoke: !excuse && n >= dueAt && played,
  };
}

// Game access as a clipper sees it, from their code row.
export function accessStatus(code, removedAt) {
  if (removedAt) return 'removed';
  if (!code) return 'none';
  if (!code.revoked_at) return 'active';
  return code.revoked_reason === 'inactive' ? 'lost' : 'taken';
}

// ------------------------------------------------------------------ posts

const SHREDBOUND = /shre?d?bound/i;

/** One stored post (a clipper_videos row) as the dashboard shows it. */
export function postView(r) {
  const tiktok = r.platform === 'tiktok';
  const handle = r.handle || r.username;
  const views = r.views ?? (tiktok ? r.value : null);
  const likes = r.likes ?? (tiktok ? null : r.value);
  return {
    platform: r.platform,
    id: r.video_id,
    url: tiktok ? `https://www.tiktok.com/@${handle}/${r.kind === 'photo' ? 'photo' : 'video'}/${r.video_id}` : `https://www.instagram.com/p/${r.video_id}/`,
    postedAt: r.posted_at ?? null,
    caption: r.caption ?? null,
    shredbound: SHREDBOUND.test(r.caption ?? ''),
    kind: r.kind ?? null,
    views: views == null ? null : Number(views),
    likes: likes == null ? null : Number(likes),
    comments: r.comments == null ? null : Number(r.comments),
    shares: r.shares == null ? null : Number(r.shares),
    saves: r.saves == null ? null : Number(r.saves),
    durationS: r.duration_s ?? null,
    readAt: r.detail_at ?? r.updated_at ?? null,
  };
}

/**
 * What a clipper's posts add up to. Views are TikTok's (Instagram shows none
 * without a login); likes and comments count both platforms. "Since joining"
 * is what they posted as a clipper; "Shredbound" is a post whose caption names
 * the game.
 */
export function postStats(posts, joinedAt) {
  const since = joinedAt ? Date.parse(joinedAt) : null;
  const sum = (list, k) => list.reduce((s, p) => s + (Number(p[k]) || 0), 0);
  const withViews = posts.filter(p => p.views != null);
  const mine = posts.filter(p => since != null && p.postedAt && Date.parse(p.postedAt) >= since);
  const sb = posts.filter(p => p.shredbound);
  const newest = list => list.reduce((m, p) => (p.postedAt && (!m || p.postedAt > m) ? p.postedAt : m), null);
  const best = withViews.reduce((b, p) => (!b || p.views > b.views ? p : b), null);
  return {
    posts: posts.length,
    tiktok: posts.filter(p => p.platform === 'tiktok').length,
    instagram: posts.filter(p => p.platform === 'instagram').length,
    sinceJoining: mine.length,
    shredbound: sb.length,
    shredboundSinceJoining: sb.filter(p => mine.includes(p)).length,
    views: sum(withViews, 'views'),
    viewsSinceJoining: sum(mine.filter(p => p.views != null), 'views'),
    shredboundViews: sum(sb.filter(p => p.views != null), 'views'),
    likes: sum(posts, 'likes'),
    comments: sum(posts, 'comments'),
    shares: sum(posts, 'shares'),
    saves: sum(posts, 'saves'),
    averageViews: withViews.length ? Math.round(sum(withViews, 'views') / withViews.length) : null,
    best: best && { url: best.url, views: best.views, postedAt: best.postedAt, caption: best.caption },
    lastPostAt: newest(posts),
    lastShredboundAt: newest(sb),
  };
}

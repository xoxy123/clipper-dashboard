// Leaderboard maths, shared by the edge function and the tests. Pure: takes
// rows, returns the board. No I/O.
//
// "Most views" ranks by total views on the profile at the latest scan.
// "Most improved" ranks by views gained since the previous weekly scan (the
// newest ok snapshot taken at least MIN_GAP_DAYS before the latest one), ties
// broken by followers gained. A clipper with only one scan has no week yet and
// is not on the improved board.

export const MIN_GAP_DAYS = 5;
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
      history: good.slice(0, 12).reverse().map(pick),
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

const brief = r => ({ username: r.username, views: r.latest?.views ?? null, gained: r.gained?.views ?? null, followersGained: r.gained?.followers ?? null });

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

// Pure HTML builders for the dashboard. No DOM access, so the tests can run them.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const full = new Intl.NumberFormat('en-US');
const short = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const num = v => (v == null ? '—' : v >= 100000 ? short.format(v) : full.format(v));
export const signed = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '±') + num(Math.abs(v)));
export const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export const date = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const profile = u => `https://www.tiktok.com/@${encodeURIComponent(u)}`;

function podium(rows, me, value, sub) {
  if (!rows.length) return '';
  return `<ol class="podium">${rows.map((r, i) => `<li class="p${i + 1}${r.username === me ? ' me' : ''}"><span class="place">${i + 1}</span><span class="name"><a href="${profile(r.username)}" target="_blank" rel="noopener">@${esc(r.username)}</a>${r.username === me ? ' <span class="muted">(you)</span>' : ''}</span><span class="value">${value(r)}<small>${sub(r)}</small></span></li>`).join('')}</ol>`;
}

function fullTable(rows, me, cols) {
  if (rows.length <= 3) return '';
  return `<details class="all"><summary>Show all ${rows.length}</summary><table><thead><tr><th>#</th><th>Clipper</th>${cols.map(c => `<th class="n">${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr${r.username === me ? ' class="me"' : ''}><td>${i + 1}</td><td>@${esc(r.username)}</td>${cols.map(c => `<td class="n">${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
}

export function boards(b) {
  const me = b.me?.username;
  const views = podium(b.topViews, me, r => num(r.views), () => 'total views')
    || '<p class="empty">No scan yet. The first weekly scan fills this in.</p>';
  const improved = podium(b.topImproved, me, r => signed(r.gained), r => r.followersGained == null ? 'views this week' : `${signed(r.followersGained)} followers`)
    || '<p class="empty">Needs two weekly scans. Check back after next week\'s scan.</p>';
  return `<section aria-labelledby="lb"><div class="section-head"><h1 id="lb">Leaderboard</h1><span class="eyebrow">${b.total} clipper${b.total === 1 ? '' : 's'} · updated weekly</span></div>
<div class="boards"><article class="board"><h2>Most views</h2><p class="rule muted">Total views on all videos on the profile.</p>${views}${fullTable(b.viewsBoard, me, [['Views', r => num(r.views)]])}</article>
<article class="board"><h2>Most improved</h2><p class="rule muted">Most views gained since last week's scan.</p>${improved}${fullTable(b.improvedBoard, me, [['Gained', r => signed(r.gained)]])}</article></div></section>`;
}

function stat(label, value, gain) {
  const cls = gain == null ? 'flat' : gain > 0 ? 'up' : gain < 0 ? 'down' : 'flat';
  return `<div class="stat"><div class="label">${label}</div><div class="num">${num(value)}</div><div class="delta ${cls}">${gain == null ? 'no week yet' : signed(gain) + ' this week'}</div></div>`;
}

const errorText = { not_found: "TikTok couldn't find this username. Check the spelling, then switch account and join again.", private: 'Your profile is private, so its numbers cannot be read. Make it public to be on the leaderboard.', no_data: 'The last scan could not read your profile. It will try again next week.', blocked: 'TikTok blocked the last scan. It will try again next week.' };

export function myAccount(m) {
  if (!m) return '';
  const rank = (r, of, label) => `<div class="rank"><b>${r ? ordinal(r) : '—'}</b><span>${label}${r ? ` of ${of}` : ''}</span></div>`;
  const l = m.latest, g = m.gained;
  const body = l
    ? `<div class="stats">${stat('Views', l.views, g?.views)}${stat('Followers', l.followers, g?.followers)}${stat('Likes', l.likes, g?.likes)}${stat('Videos', l.videos, g?.videos)}</div>
${m.previous ? `<p class="note">This week = ${date(m.previous.takenAt)} to ${date(l.takenAt)}.</p>` : `<p class="note">First scan ${date(l.takenAt)}. Your weekly gains show after the next scan.</p>`}
${chart(m.history)}`
    : `<p class="note">You're in. Your numbers appear after the next weekly scan.</p>`;
  return `<section aria-labelledby="mine"><div class="section-head"><h1 id="mine">My account</h1><a class="eyebrow handle" href="${profile(m.username)}" target="_blank" rel="noopener">@${esc(m.username)} ↗</a></div>
<div class="ranks">${rank(m.viewsRank, m.viewsRanked, 'Most views')}${rank(m.improvedRank, m.improvedRanked, 'Most improved')}</div>
${m.lastError ? `<p class="note error">${esc(errorText[m.lastError] || errorText.no_data)}</p>` : ''}${body}</section>`;
}

// Total views at each weekly scan, one line. Needs two points.
export function chart(history, { width = 900, height = 200 } = {}) {
  const pts = (history || []).filter(h => h.views != null);
  if (pts.length < 2) return '';
  const pad = { l: 56, r: 14, t: 14, b: 26 }, w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const lo = Math.min(...pts.map(p => p.views)), hi = Math.max(...pts.map(p => p.views)), span = hi - lo || 1;
  const x = i => pad.l + (i / (pts.length - 1)) * w, y = v => pad.t + h - ((v - lo) / span) * h;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.views).toFixed(1)}`).join('');
  const ticks = [lo, hi].map(v => `<line class="chart-grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`).join('');
  const dots = pts.map((p, i) => `<circle class="chart-dot" cx="${x(i)}" cy="${y(p.views)}" r="3.5"><title>${date(p.takenAt)}: ${full.format(p.views)} views</title></circle>`).join('');
  const labels = pts.map((p, i) => i === 0 || i === pts.length - 1 ? `<text class="chart-axis" x="${x(i)}" y="${height - 6}" text-anchor="${i ? 'end' : 'start'}">${date(p.takenAt)}</text>` : '').join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Total views per weekly scan">${ticks}<path class="chart-line" d="${line}"/>${dots}${labels}</svg>`;
}

export const joinForm = (error = '') => `<section class="join" aria-labelledby="join-title"><div><p class="eyebrow">Shredbound clippers</p><h1 id="join-title">Join the leaderboard</h1></div>
<form id="join" novalidate><label>Clipper code<input name="code" type="password" autocomplete="off" required></label><label>TikTok username<input name="username" placeholder="@yourname" autocomplete="off" autocapitalize="none" spellcheck="false" required></label><p class="error" id="join-error">${esc(error)}</p><button class="primary" type="submit">Join</button></form>
<p class="muted">Your public TikTok profile is read once a week: followers, likes and views. Nothing is posted or changed.</p></section>`;

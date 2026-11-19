// Pure HTML builders for the dashboard. No DOM access, so the tests can run them.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const full = new Intl.NumberFormat('en-US');
const short = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const num = v => (v == null ? '—' : v >= 100000 ? short.format(v) : full.format(v));
export const signed = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '±') + num(Math.abs(v)));
export const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export const date = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dateTime = iso => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

// "in 2 days", "3 hours ago", "in 25 minutes".
export function rel(iso, now = Date.now()) {
  if (!iso) return '—';
  const d = Date.parse(iso) - now, a = Math.abs(d);
  const [n, unit] = a >= 2 * 86400e3 ? [Math.round(a / 86400e3), 'day'] : a >= 2 * 3600e3 ? [Math.round(a / 3600e3), 'hour'] : [Math.max(1, Math.round(a / 60e3)), 'minute'];
  const s = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return d >= 0 ? `in ${s}` : `${s} ago`;
}
// "3d 4h" left, for event countdowns.
export function left(iso, now = Date.now()) {
  const d = Date.parse(iso) - now;
  if (!(d > 0)) return '';
  const days = Math.floor(d / 86400e3), hours = Math.floor((d % 86400e3) / 3600e3), mins = Math.floor((d % 3600e3) / 60e3);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${Math.max(1, mins)}m`;
}

const profile = u => `https://www.tiktok.com/@${encodeURIComponent(u)}`;
export const APPEAL = 'To appeal, DM <b>willll0838</b> on Discord or mail <a href="mailto:shredboundofficial@gmail.com">shredboundofficial@gmail.com</a>.';

// ------------------------------------------------------------------ frame

export const TABS = { clipper: [['board', 'Leaderboard'], ['account', 'My account'], ['events', 'Events']], owner: [['board', 'Leaderboard'], ['events', 'Events'], ['clippers', 'Clippers'], ['playtesters', 'Playtesters']] };
export const nav = (role, current) => TABS[role].map(([id, label]) => `<a href="#${id}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');

// ------------------------------------------------------------------ leaderboard

function podium(rows, me, value, sub) {
  if (!rows.length) return '';
  return `<ol class="podium">${rows.map((r, i) => `<li class="p${i + 1}${r.username === me ? ' me' : ''}"><span class="place">${i + 1}</span><span class="name"><a href="${profile(r.username)}" target="_blank" rel="noopener">@${esc(r.username)}</a>${r.username === me ? ' <span class="muted">(you)</span>' : ''}</span><span class="value">${value(r)}<small>${sub(r)}</small></span></li>`).join('')}</ol>`;
}

function fullTable(rows, me, cols) {
  if (rows.length <= 3) return '';
  return `<details class="all"><summary>Show all ${rows.length}</summary><div class="scroll"><table><thead><tr><th>#</th><th>Clipper</th>${cols.map(c => `<th class="n">${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr${r.username === me ? ' class="me"' : ''}><td>${i + 1}</td><td>@${esc(r.username)}</td>${cols.map(c => `<td class="n">${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

export function boards(b, me = '') {
  const views = podium(b.topViews, me, r => num(r.views), () => 'total views')
    || '<p class="empty">No scan yet. The daily scan fills this in.</p>';
  const improved = podium(b.topImproved, me, r => signed(r.gained), r => r.followersGained == null ? 'views this week' : `${signed(r.followersGained)} followers`)
    || '<p class="empty">Needs a week of scans. Check back in a few days.</p>';
  return `<section aria-labelledby="lb"><div class="section-head"><h1 id="lb">Leaderboard</h1><span class="eyebrow">${b.total} clipper${b.total === 1 ? '' : 's'} · updated daily</span></div>
<div class="boards"><article class="board"><h2>Most views</h2><p class="rule muted">Total views on all videos on the profile.</p>${views}${fullTable(b.viewsBoard, me, [['Views', r => num(r.views)]])}</article>
<article class="board"><h2>Most improved</h2><p class="rule muted">Most views gained in the last 7 days.</p>${improved}${fullTable(b.improvedBoard, me, [['Gained', r => signed(r.gained)]])}</article></div></section>`;
}

// ------------------------------------------------------------------ my account

function stat(label, value, gain) {
  const cls = gain == null ? 'flat' : gain > 0 ? 'up' : gain < 0 ? 'down' : 'flat';
  return `<div class="stat"><div class="label">${label}</div><div class="num">${num(value)}</div><div class="delta ${cls}">${gain == null ? 'no week yet' : signed(gain) + ' this week'}</div></div>`;
}

const scanError = { not_found: "TikTok couldn't find this username. Message willll0838 on Discord to fix it.", private: 'Your profile is private, so its numbers cannot be read. Make it public to be on the leaderboard.', no_data: 'The last scan could not read your profile. It tries again tomorrow.', blocked: 'TikTok blocked the last scan. It tries again tomorrow.' };

const STATUS = {
  active: ['ok', 'Active', 'Your code works in the game.'],
  lost: ['bad', 'Lost access', 'You played without posting a video for 3 days.'],
  taken: ['bad', 'Access taken', 'The owner took your access.'],
  none: ['bad', 'No code', 'Message willll0838 on Discord.'],
};

export function gameAccess(a, now = Date.now()) {
  if (!a) return '';
  const [cls, word, line] = STATUS[a.status] || STATUS.none;
  const blocked = a.status === 'lost' || a.status === 'taken';
  let rule = '';
  if (!blocked) {
    if (a.excusedUntil) {
      rule = `<p class="due ok-text">Excused until <b>${esc(dateTime(a.excusedUntil))}</b>. The 3 days start again after that.</p>`;
    } else if (Date.parse(a.dueAt) > now) {
      rule = `<p class="due">Post your next video before <b>${esc(dateTime(a.dueAt))}</b> <span class="muted">(${rel(a.dueAt, now)})</span>.</p>`;
    } else {
      rule = `<p class="due warn-text"><b>Your 3 days are up.</b> Post a video before you play again, or give a reason below.</p>`;
    }
  }
  const reason = a.reason
    ? `<div class="reason-now"><p><span class="eyebrow">Your reason</span><br>${esc(a.reason.reason)}</p><p class="muted">Until ${esc(dateTime(a.reason.until))}</p><button class="text-button" data-act="reason-end">End my reason</button></div>`
    : blocked ? '' : `<details class="reason-form"><summary>Can't post for a while? Give a reason</summary><form id="reason" class="stack"><label>Why can't you post?<textarea name="reason" maxlength="500" required minlength="3" placeholder="Sick, travelling, exams…"></textarea></label><label>Until<input type="date" name="until" required min="${esc(isoDay(now + 86400e3))}" max="${esc(isoDay(now + 30 * 86400e3))}"></label><button class="primary" type="submit">Send reason</button></form></details>`;
  return `<article class="card access ${cls}"><div class="access-top"><div><p class="eyebrow">Game access code</p><p class="code" id="game-code">${esc(a.code || '—')}</p><button class="chip-button" data-act="copy" data-copy="${esc(a.code || '')}">Copy code</button></div><div class="status ${cls}"><b>${word}</b><span>${line}</span></div></div>
${blocked ? `<p class="appeal">${APPEAL}</p>` : rule}
<dl class="facts"><div><dt>Last video</dt><dd>${a.lastVideoAt ? `${rel(a.lastVideoAt, now)}` : 'none seen yet'}</dd></div><div><dt>Last played</dt><dd>${a.lastPlayedAt ? rel(a.lastPlayedAt, now) : 'not yet'}</dd></div></dl>
<p class="rulebox"><b>The rule:</b> post a TikTok at least every 3 days. If you play Shredbound and haven't posted for 3 days, your code stops working. Not playing at all? Then you're fine.</p>
${reason}</article>`;
}
const isoDay = t => new Date(t - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

export function myAccount(m, now = Date.now()) {
  if (!m) return '';
  const rank = (r, of, label) => `<div class="rank"><b>${r ? ordinal(r) : '—'}</b><span>${label}${r ? ` of ${of}` : ''}</span></div>`;
  const l = m.latest, g = m.gained;
  const body = l
    ? `<div class="stats">${stat('Views', l.views, g?.views)}${stat('Followers', l.followers, g?.followers)}${stat('Likes', l.likes, g?.likes)}${stat('Videos', l.videos, g?.videos)}</div>
${m.previous ? `<p class="note">This week = ${date(m.previous.takenAt)} to ${date(l.takenAt)}.</p>` : `<p class="note">First scan ${date(l.takenAt)}. Weekly gains show after a week of scans.</p>`}
${chart(m.history)}`
    : `<p class="note">Your TikTok numbers appear after the next daily scan.</p>`;
  return `<section aria-labelledby="mine"><div class="section-head"><h1 id="mine">My account</h1><a class="eyebrow handle" href="${profile(m.username)}" target="_blank" rel="noopener">@${esc(m.username)} ↗</a></div>
${gameAccess(m.access, now)}
<h2 class="sub">TikTok</h2>
<div class="ranks">${rank(m.viewsRank, m.viewsRanked, 'Most views')}${rank(m.improvedRank, m.improvedRanked, 'Most improved')}</div>
${m.lastError ? `<p class="note error">${esc(scanError[m.lastError] || scanError.no_data)}</p>` : ''}${body}</section>`;
}

// Total views at each scan, one line. Needs two points.
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
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Total views per scan">${ticks}<path class="chart-line" d="${line}"/>${dots}${labels}</svg>`;
}

// ------------------------------------------------------------------ events

export function eventPhase(e, now = Date.now()) {
  if (Date.parse(e.endsAt) <= now) return 'ended';
  if (e.startsAt && Date.parse(e.startsAt) > now) return 'upcoming';
  return 'live';
}

function eventCard(e, owner, now) {
  const phase = eventPhase(e, now);
  const when = phase === 'live' ? `Ends ${esc(dateTime(e.endsAt))} · <b>${left(e.endsAt, now)} left</b>`
    : phase === 'upcoming' ? `Starts ${esc(dateTime(e.startsAt))} (${rel(e.startsAt, now)}) · ends ${esc(dateTime(e.endsAt))}`
    : `Ended ${esc(date(e.endsAt))}`;
  return `<article class="card event ${phase}"><div class="event-head"><span class="pill ${phase}">${phase === 'live' ? 'Live' : phase === 'upcoming' ? 'Upcoming' : 'Ended'}</span>${e.prize ? `<span class="prize">${esc(e.prize)}</span>` : ''}</div>
<h2>${esc(e.title)}</h2>${e.details ? `<p class="details">${esc(e.details)}</p>` : ''}<p class="when">${when}</p>
${owner ? `<div class="row-actions"><button class="text-button" data-act="event-edit" data-id="${esc(e.id)}">Edit</button><button class="text-button danger" data-act="event-delete" data-id="${esc(e.id)}">Delete</button></div>` : ''}</article>`;
}

const local = iso => (iso ? new Date(Date.parse(iso) - new Date(iso).getTimezoneOffset() * 60e3).toISOString().slice(0, 16) : '');
export function eventForm(e = null) {
  return `<form id="event-form" class="card stack event-form" data-id="${esc(e?.id ?? '')}"><h2>${e ? 'Edit event' : 'New event'}</h2>
<label>Title<input name="title" maxlength="80" required value="${esc(e?.title ?? '')}" placeholder="Most views this week"></label>
<label><span>Prize <span class="muted">(optional)</span></span><input name="prize" maxlength="120" value="${esc(e?.prize ?? '')}" placeholder="$50 to the winner"></label>
<label><span>Details <span class="muted">(optional)</span></span><textarea name="details" maxlength="2000" placeholder="Rules, how to win…">${esc(e?.details ?? '')}</textarea></label>
<div class="two"><label><span>Starts <span class="muted">(optional)</span></span><input type="datetime-local" name="startsAt" value="${esc(local(e?.startsAt))}"></label><label>Ends<input type="datetime-local" name="endsAt" required value="${esc(local(e?.endsAt))}"></label></div>
<div class="row-actions"><button class="primary" type="submit">${e ? 'Save' : 'Add event'}</button><button class="text-button" type="button" data-act="event-cancel">Cancel</button></div></form>`;
}

export function events(list, owner, now = Date.now(), editing = null) {
  const by = { live: [], upcoming: [], ended: [] };
  for (const e of list) by[eventPhase(e, now)].push(e);
  by.live.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
  by.upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  by.ended.sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt));
  const open = [...by.live, ...by.upcoming];
  const form = owner ? (editing === 'new' ? eventForm() : editing ? eventForm(list.find(e => String(e.id) === String(editing))) : `<button class="primary" data-act="event-new">+ New event</button>`) : '';
  return `<section aria-labelledby="ev"><div class="section-head"><h1 id="ev">Events</h1>${owner ? '<span class="eyebrow">Only you can write here</span>' : ''}</div>
${form}
<div class="events">${open.length ? open.map(e => eventCard(e, owner, now)).join('') : '<p class="empty">No events right now. Check back soon.</p>'}</div>
${by.ended.length ? `<details class="all"><summary>Ended (${by.ended.length})</summary><div class="events">${by.ended.map(e => eventCard(e, owner, now)).join('')}</div></details>` : ''}</section>`;
}

// ------------------------------------------------------------------ owner: clippers

const statusCell = a => {
  const [cls, word] = STATUS[a.status] || ['bad', a.status === 'removed' ? 'Removed' : a.status];
  return `<span class="pill ${a.status === 'removed' ? 'ended' : cls}">${a.status === 'removed' ? 'Removed' : word}</span>`;
};

export function clippersAdmin(list, now = Date.now()) {
  const live = list.filter(c => !c.removedAt), removed = list.filter(c => c.removedAt);
  const lost = live.filter(c => c.access.status === 'lost').length;
  const row = c => {
    const a = c.access, r = a.reason;
    const due = a.status !== 'active' ? '—' : a.excusedUntil ? `excused till ${esc(date(a.excusedUntil))}` : Date.parse(a.dueAt) > now ? rel(a.dueAt, now) : '<b class="warn-text">overdue</b>';
    const acts = c.removedAt ? '' : [
      a.status === 'active' ? `<button class="text-button" data-act="take" data-user="${esc(c.username)}">Take access</button>` : `<button class="text-button" data-act="give" data-user="${esc(c.username)}">Give access back</button>`,
      r ? `<button class="text-button" data-act="reason-turn-down" data-id="${esc(r.id)}">Turn down reason</button>` : '',
      c.email ? `<button class="text-button" data-act="welcome" data-user="${esc(c.username)}">Mail code again</button>` : '',
      `<button class="text-button danger" data-act="remove" data-user="${esc(c.username)}">Remove</button>`,
    ].join('');
    return `<tr><td><a href="${profile(c.username)}" target="_blank" rel="noopener">@${esc(c.username)}</a>${c.email ? `<br><small class="muted">${esc(c.email)}</small>` : ''}${c.welcome ? `<br><small class="${c.welcome === 'sent' ? 'ok-text' : 'warn-text'}">code mail: ${esc(c.welcome)}</small>` : ''}${c.lastScanError ? `<br><small class="error">scan: ${esc(c.lastScanError)}</small>` : ''}</td>
<td class="mono">${esc(a.code || '—')}</td><td>${statusCell(c.removedAt ? { status: 'removed' } : a)}</td>
<td>${a.lastVideoAt ? rel(a.lastVideoAt, now) : 'none'}</td><td>${a.lastPlayedAt ? rel(a.lastPlayedAt, now) : 'never'}</td><td>${due}</td>
<td class="reason-cell">${r ? `${esc(r.reason)}<br><small class="muted">until ${esc(date(r.until))}</small>` : '—'}</td>
<td class="n">${a.devices}</td><td class="actions">${acts}</td></tr>`;
  };
  return `<section aria-labelledby="cl"><div class="section-head"><h1 id="cl">Clippers</h1><span class="eyebrow">${live.length} active · ${lost} lost access</span></div>
<p class="note">Everyone joins with the clipper code and gets their own game code. The daily scan takes the game code of anyone who played without posting for 3 days, unless they gave a reason.</p>
${live.length ? `<div class="scroll"><table class="admin"><thead><tr><th>Clipper</th><th>Game code</th><th>Status</th><th>Last video</th><th>Last played</th><th>Next video due</th><th>Reason</th><th class="n">Devices</th><th></th></tr></thead><tbody>${live.map(row).join('')}</tbody></table></div>` : '<p class="empty">Nobody has joined yet.</p>'}
${removed.length ? `<details class="all"><summary>Removed (${removed.length})</summary><div class="scroll"><table class="admin"><tbody>${removed.map(row).join('')}</tbody></table></div></details>` : ''}</section>`;
}

// ------------------------------------------------------------------ owner: playtesters and buyers

const money = (cents, cur) => (cents == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(cents / 100));

// Everyone with a game code who is not a clipper: buyers (added by themselves when they pay)
// and playtest codes made by hand. The 3-day rule never touches them.
export function playtestersAdmin(list, now = Date.now()) {
  const active = list.filter(p => p.active), off = list.filter(p => !p.active);
  const buyers = active.filter(p => p.type === 'buyer').length;
  const row = p => `<tr><td><b>${esc(p.buyer?.name || p.name)}</b>${p.buyer?.email ? `<br><small class="muted">${esc(p.buyer.email)}</small>` : ''}</td>
<td><span class="pill ${p.type === 'buyer' ? 'upcoming' : 'ok'}">${p.type === 'buyer' ? 'Bought' : 'Playtester'}</span></td>
<td class="mono">${esc(p.code || '—')}</td>
<td>${p.gameNames.length ? p.gameNames.map(esc).join(', ') : '<span class="muted">not yet</span>'}</td>
<td>${p.buyer ? `${money(p.buyer.amount, p.buyer.currency)}<br><small class="muted">${esc(date(p.buyer.paidAt))}${p.buyer.country ? ' · ' + esc(p.buyer.country) : ''}</small>` : '—'}</td>
<td>${p.buyer ? (p.buyer.mail === 'sent' ? '<span class="ok-text">sent</span>' : `<span class="warn-text">${esc(p.buyer.mail)}</span>`) : '—'}</td>
<td class="n">${p.devices}${p.maxDevices ? ` / ${p.maxDevices}` : ''}</td>
<td>${p.lastSeen ? rel(p.lastSeen, now) : 'never'}</td>
<td class="actions">${p.active ? `<button class="text-button danger" data-act="code-off" data-id="${esc(p.id)}">Take access</button>` : `<button class="text-button" data-act="code-on" data-id="${esc(p.id)}">Give access back</button>`}</td></tr>`;
  const table = rows => `<div class="scroll"><table class="admin"><thead><tr><th>Who</th><th>Type</th><th>Game code</th><th>In-game name</th><th>Paid</th><th>Code mail</th><th class="n">Devices</th><th>Last seen</th><th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>`;
  return `<section aria-labelledby="pt"><div class="section-head"><h1 id="pt">Playtesters</h1><span class="eyebrow">${active.length} with access · ${buyers} bought</span></div>
<p class="note">Buyers are added by themselves: when someone pays on the website they get a code by mail within a minute and show up here. The 3-day clipping rule never removes these; only you can.</p>
${active.length ? table(active) : '<p class="empty">Nobody yet.</p>'}
${off.length ? `<details class="all"><summary>No access (${off.length})</summary>${table(off)}</details>` : ''}</section>`;
}

// ------------------------------------------------------------------ login

export const joinForm = (error = '') => `<section class="join" aria-labelledby="join-title"><div><p class="eyebrow">Shredbound clippers</p><h1 id="join-title">Clipper dashboard</h1></div>
<form id="join" novalidate><label>Code<input name="code" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required></label><label>TikTok username<input name="username" placeholder="@yourname" autocomplete="off" autocapitalize="none" spellcheck="false"></label><label>Email <span class="muted">(first time: your code is mailed here)</span><input name="email" type="email" placeholder="you@mail.com" autocomplete="email" autocapitalize="none" spellcheck="false"></label><p class="hint muted">First time? Use the clipper code, your TikTok username and your email: your own code comes by mail. After that, your own code is all you need.</p><p class="error" id="join-error">${esc(error)}</p><button class="primary" type="submit">Enter</button></form>
<p class="muted">Your public TikTok profile is read once a day: followers, likes, views and when you last posted. Nothing is posted or changed.</p></section>`;

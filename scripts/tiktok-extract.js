// Run in a TikTok profile tab (https://www.tiktok.com/@<username>) with the
// browser tool's javascript_exec. Read-only: it scrolls the page and reads what
// the page already shows. Returns one snapshot for scripts/record.mjs.
//
// Followers, likes and video count come exact from the page's own data block.
// Views are the sum of every video's play count: exact from TikTok's item_list
// responses where caught, else parsed from the grid label ("12.3K").
// lastVideoAt is the newest post's upload time, read from the post ids; the
// 3-day clipping rule needs it.
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const parse = s => {
    const m = String(s || '').trim().replace(',', '.').match(/^([\d.]+)\s*([KMB])?$/i);
    if (!m) return null;
    return Math.round(Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1));
  };
  const plays = new Map();
  const take = body => { for (const it of body?.itemList || []) if (it?.id && it.stats) plays.set(String(it.id), Number(it.statsV2?.playCount ?? it.stats.playCount) || 0); };
  if (!window.__clipperHooked) {
    window.__clipperHooked = true;
    const f = window.fetch;
    window.fetch = async (...a) => { const r = await f(...a); try { if (String(a[0]?.url || a[0]).includes('/api/post/item_list')) r.clone().json().then(b => (window.__clipperPlays ||= []).push(b)).catch(() => {}); } catch {} return r; };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) { if (String(u).includes('/api/post/item_list')) this.addEventListener('load', () => { try { (window.__clipperPlays ||= []).push(JSON.parse(this.responseText)); } catch {} }); return open.call(this, m, u, ...rest); };
  }
  const username = (location.pathname.match(/^\/@([^/?]+)/) || [])[1]?.toLowerCase() || null;
  let user = null;
  try { user = JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__').textContent).__DEFAULT_SCOPE__['webapp.user-detail']?.userInfo; } catch {}
  const text = document.body.innerText;
  if (!user?.user) {
    const why = /couldn't find this account|Det gick inte att hitta kontot|hitta det här kontot/i.test(text) ? 'not_found' : /private|privat/i.test(text) ? 'private' : 'no_data';
    return { username, ok: false, error: why };
  }
  const s = user.statsV2 || user.stats || {};
  const videoCount = Number(s.videoCount) || 0;
  // Scroll until every video tile is on the page, or nothing new loads for 3 rounds.
  let last = -1, still = 0;
  for (let i = 0; i < 200 && still < 3; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await wait(1500);
    const n = document.querySelectorAll('[data-e2e=user-post-item]').length;
    if (n >= videoCount) break;
    still = n === last ? still + 1 : 0; last = n;
  }
  for (const b of window.__clipperPlays || []) take(b);
  let views = 0, exact = 0, tiles = 0, newest = 0;
  for (const el of document.querySelectorAll('[data-e2e=user-post-item]')) {
    const id = (el.querySelector('a[href*="/video/"],a[href*="/photo/"]')?.href.match(/\/(?:video|photo)\/(\d+)/) || [])[1];
    tiles++;
    // A TikTok post id starts with its upload time: the top 32 bits are Unix seconds.
    if (id) { const t = Number(BigInt(id) >> 32n) * 1000; if (t > newest && t <= Date.now() + 864e5) newest = t; }
    if (id && plays.has(id)) { views += plays.get(id); exact++; }
    else views += parse(el.querySelector('[data-e2e=video-views]')?.textContent) || 0;
  }
  return {
    username: String(user.user.uniqueId || username).toLowerCase(),
    ok: true,
    followers: Number(s.followerCount) || 0,
    likes: Number(s.heartCount ?? s.heart) || 0,
    videos: videoCount,
    views,
    lastVideoAt: newest ? new Date(newest).toISOString() : null,
    viewsCounted: tiles,
    viewsExact: exact,
    private: !!user.user.privateAccount,
  };
})()

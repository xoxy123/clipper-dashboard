import { call } from './api.js';
import { boards, myAccount, events, clippersAdmin, playtestersAdmin, applicationsAdmin, clipperProfile, joinForm, nav, date, TABS } from './view.js';
const $ = id => document.getElementById(id);
const main = $('main'), who = $('who'), logout = $('logout'), scan = $('scan'), tabs = $('tabs'), toast = $('toast');
const KEY = 'clippers.token';
const store = { get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }, set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} } };
let token = store.get(), data = null, editing = null;
// Clipper profiles the owner opened (#clipper/<username>), by username.
const profiles = new Map();

function say(msg) { toast.textContent = msg; toast.classList.add('show'); clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove('show'), 2600); }
const tab = () => { const t = location.hash.slice(1), ids = TABS[data?.role || 'clipper'].map(x => x[0]); return t.startsWith('clipper/') && data?.role === 'owner' ? 'clippers' : ids.includes(t) ? t : ids[0]; };
// The clipper whose profile is open, or null.
const profileUser = () => { const t = location.hash.slice(1); if (!t.startsWith('clipper/') || data?.role !== 'owner') return null; try { return decodeURIComponent(t.slice(8)); } catch { return null; } };

async function openProfile(user) {
  try {
    const r = await call('profile', { token, username: user });
    profiles.set(user, r.profile);
  } catch (x) {
    if (profileUser() === user) main.innerHTML = `<p class="error">${x.message}</p><p><a href="#clippers">← Clippers</a></p>`;
    return;
  }
  if (profileUser() === user) render();
}
// After a scan or a TikTok change: say what the reading found.
const readWords = r => !r ? 'Read.' : r.tiktok === 'ok' ? `Read @${r.handle}: ${r.details} post${r.details === 1 ? '' : 's'} updated.` : r.tiktok === 'not_found' ? `TikTok has no profile @${r.handle}.` : `TikTok: ${r.tiktok.replace('_', ' ')}. Try again later.`;

function showJoin(error = '') {
  data = null; who.textContent = ''; logout.hidden = true; scan.textContent = ''; tabs.innerHTML = ''; tabs.hidden = true;
  main.innerHTML = joinForm(error);
  const form = $('join');
  form.code.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button'), err = $('join-error');
    btn.disabled = true; err.textContent = '';
    try {
      const r = await call('join', { code: form.code.value, username: form.username.value, email: form.email.value });
      if (r.pending) { main.innerHTML = `<section class="join"><h1>Application sent</h1><p>Thanks @${r.username}! You'll get a mail as soon as you're approved, with your own code and how to log in.</p></section>`; return; }
      token = r.token; store.set(token); location.hash = r.role === 'owner' ? '#clippers' : '#account'; await load();
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  });
}

function render() {
  if (!data) return;
  const t = tab(), owner = data.role === 'owner', user = profileUser();
  tabs.hidden = false; tabs.innerHTML = nav(data.role, t);
  if (user) {
    const p = profiles.get(user);
    main.innerHTML = p ? clipperProfile(p) : '<div class="loading">Loading profile…</div>';
    return;
  }
  const html = t === 'account' ? myAccount(data.me) : t === 'events' ? events(data.events, owner, Date.now(), editing) : t === 'clippers' ? clippersAdmin(data.clippers || []) : t === 'playtesters' ? playtestersAdmin(data.playtesters || []) : t === 'applications' ? applicationsAdmin(data.applications || []) : boards(data.board, data.me?.username, owner);
  main.innerHTML = html;
  if (t === 'events' && editing) $('event-form')?.querySelector('input')?.focus();
}

async function load(quiet = false) {
  if (!token) return showJoin();
  try {
    data = await call('state', { token });
    who.textContent = data.role === 'owner' ? 'Owner' : '@' + data.me.username; logout.hidden = false;
    scan.textContent = data.board.lastScan ? 'Last scan ' + date(data.board.lastScan) : 'No scan yet';
    render();
    const user = profileUser();
    if (user) openProfile(user);
  } catch (x) {
    if (x.code === 'invalid') { token = ''; store.set(''); return showJoin(); }
    if (quiet) return say(x.message);
    main.innerHTML = `<p class="error">${x.message}</p><p><button class="primary" id="retry">Try again</button></p>`;
    $('retry').onclick = () => load();
  }
}

// One action, then fresh data. Buttons stay disabled while it runs.
async function act(button, action, payload, done) {
  if (button) button.disabled = true;
  try { await call(action, { token, ...payload }); if (done) say(done); await load(true); }
  catch (x) { say(x.message); if (button) button.disabled = false; }
}

main.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act, user = b.dataset.user;
  if (a === 'copy') {
    try { await navigator.clipboard.writeText(b.dataset.copy); say('Code copied. Paste it in the game with Cmd/Ctrl+V.'); }
    catch { const r = document.createRange(); r.selectNodeContents($('game-code')); getSelection().removeAllRanges(); getSelection().addRange(r); say('Select and copy the code.'); }
  }
  else if (a === 'reason-end') act(b, 'reason.end', {}, 'Reason ended.');
  else if (a === 'event-new') { editing = 'new'; render(); }
  else if (a === 'event-edit') { editing = b.dataset.id; render(); }
  else if (a === 'event-cancel') { editing = null; render(); }
  else if (a === 'event-delete') { if (confirm('Delete this event?')) act(b, 'owner.event.delete', { id: Number(b.dataset.id) }, 'Event deleted.'); }
  else if (a === 'give') act(b, 'owner.access', { username: user, active: true }, `@${user} can play again. Their 3 days start now.`);
  else if (a === 'take') { if (confirm(`Take @${user}'s game access?`)) act(b, 'owner.access', { username: user, active: false }, 'Access taken.'); }
  else if (a === 'reason-turn-down') { if (confirm('Turn down this reason? The 3-day rule applies again right away.')) act(b, 'owner.reason.end', { id: Number(b.dataset.id) }, 'Reason turned down.'); }
  else if (a === 'code-off') { if (confirm('Take this game code? It stops working in the game.')) act(b, 'owner.code', { id: Number(b.dataset.id), active: false }, 'Access taken.'); }
  else if (a === 'code-on') act(b, 'owner.code', { id: Number(b.dataset.id), active: true }, 'Access given back.');
  else if (a === 'welcome') act(b, 'owner.welcome', { username: user }, 'Code mail sent again.');
  else if (a === 'approve') act(b, 'owner.approve', { username: user }, `@${user} approved. Code mail sent.`);
  else if (a === 'reject') { if (confirm(`Reject @${user}?`)) act(b, 'owner.reject', { username: user }, `@${user} rejected.`); }
  else if (a === 'ig-set') {
    const typed = prompt(`Instagram username for @${user} (empty to remove):`, b.dataset.ig || '');
    if (typed !== null) {
      await act(b, 'owner.instagram', { username: user, instagram: typed }, typed.trim() ? 'Instagram saved. The next scan reads it, or press Check now.' : 'Instagram removed.');
      if (profileUser() === user) openProfile(user);
    }
  }
  else if (a === 'scan-now' || a === 'tiktok-set') {
    let payload = { username: user }, action = 'owner.scan';
    if (a === 'tiktok-set') {
      const typed = prompt(`@${user}'s real TikTok username (the @name under their name on their TikTok profile). Empty = @${user}.\nTheir 3 days start again now.`, b.dataset.tiktok || user);
      if (typed === null) return;
      payload = { username: user, tiktok: typed }; action = 'owner.tiktok';
    }
    b.disabled = true; say('Reading TikTok…');
    try {
      const r = await call(action, { token, ...payload });
      profiles.set(user, r.profile); say(readWords(r.result));
      await load(true);
    } catch (x) { say(x.message); b.disabled = false; }
  }
  else if (a === 'scan-me') {
    b.disabled = true; say('Reading your profile…');
    try {
      const r = await call('scan.me', { token });
      say(r.skipped ? 'Checked less than 10 minutes ago. Try again in a bit.' : readWords(r.result));
      await load(true);
    } catch (x) { say(x.message); b.disabled = false; }
  }
  else if (a === 'remove') { if (confirm(`Remove @${user}? Their game code stops working and they cannot join again.`)) act(b, 'owner.remove', { username: user }, `@${user} removed.`); }
});

main.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id === 'reason') {
    e.preventDefault();
    const until = new Date(f.elements.until.value + 'T23:59:59');
    act(f.querySelector('button'), 'reason', { reason: f.elements.reason.value, until: until.toISOString() }, 'Reason sent. The 3-day rule waits until then.');
  } else if (f.id === 'instagram') {
    e.preventDefault();
    const typed = f.elements.instagram.value;
    act(f.querySelector('button'), 'instagram', { instagram: typed }, typed.trim() ? 'Instagram saved. The next daily scan reads it.' : 'Instagram removed.');
  } else if (f.id === 'event-form') {
    e.preventDefault();
    const iso = v => (v ? new Date(v).toISOString() : null);
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      // f.elements, not f.title: a form's own title property hides a field named "title".
      const v = n => f.elements[n].value;
      await call('owner.event.save', { token, id: f.dataset.id ? Number(f.dataset.id) : undefined, title: v('title'), prize: v('prize'), details: v('details'), startsAt: iso(v('startsAt')), endsAt: iso(v('endsAt')) });
      editing = null; say('Event saved.'); await load(true);
    } catch (x) { say(x.message); btn.disabled = false; }
  }
});

addEventListener('hashchange', () => { editing = null; render(); const user = profileUser(); if (user) openProfile(user); });
logout.onclick = () => { token = ''; store.set(''); location.hash = ''; showJoin(); };
load();

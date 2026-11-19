import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, boardFor, cleanUsername } from '../supabase/functions/clippers/board.js';
import { boards, myAccount, chart, num, signed, ordinal, events, clippersAdmin, gameAccess, eventPhase, rel, left, joinForm } from '../src/view.js';

const acc = u => ({ username: u, joined_at: '2026-11-01T00:00:00Z' });
const snap = (u, day, views, followers = 0, ok = true) => ({ username: u, taken_at: `2026-11-${String(day).padStart(2, '0')}T18:00:00Z`, ok, error: ok ? null : 'private', followers, likes: views / 10, videos: 5, views });

test('cleanUsername accepts @, links and case; refuses junk', () => {
  assert.equal(cleanUsername('@Shred.Clips_1'), 'shred.clips_1');
  assert.equal(cleanUsername('https://www.tiktok.com/@abc_de?lang=en'), 'abc_de');
  assert.equal(cleanUsername('a'), null);
  assert.equal(cleanUsername('bad name'), null);
  assert.equal(cleanUsername('<script>'), null);
});

test('most views ranks by latest total; most improved by views gained in a week', () => {
  const accounts = ['big', 'fast', 'new', 'priv'].map(acc);
  const snaps = [
    snap('big', 2, 900000), snap('big', 9, 950000),       // +50k
    snap('fast', 2, 100000), snap('fast', 9, 300000, 40), // +200k
    snap('new', 9, 500000),                                // one scan only
    snap('priv', 9, 0, 0, false),
  ];
  const s = summarize(accounts, snaps);
  assert.deepEqual(s.views.map(r => r.username), ['big', 'new', 'fast']);
  assert.deepEqual(s.improved.map(r => r.username), ['fast', 'big']);
  const b = boardFor('fast', s);
  assert.equal(b.me.viewsRank, 3);
  assert.equal(b.me.improvedRank, 1);
  assert.equal(b.me.gained.views, 200000);
  assert.equal(b.me.gained.followers, 40);
  assert.equal(b.topViews.length, 3);
  const p = boardFor('priv', s).me;
  assert.equal(p.lastError, 'private');
  assert.equal(p.viewsRank, null);
});

test('a scan less than 5 days after the previous does not count as a week', () => {
  const s = summarize([acc('a')], [snap('a', 7, 100), snap('a', 9, 150)]);
  assert.equal(s.rows[0].gained, null);
  const t = summarize([acc('a')], [snap('a', 2, 80), snap('a', 7, 100), snap('a', 9, 150)]);
  assert.equal(t.rows[0].gained.views, 70);
});

test('views render escaped and readable', () => {
  const s = summarize([acc('a'), acc('b')], [snap('a', 2, 10), snap('a', 9, 1500), snap('b', 9, 300)]);
  const b = boardFor('a', s);
  const html = boards(b, 'a') + myAccount({ ...b.me, access: { code: '0123456789', status: 'active', dueAt: '2099-01-01T00:00:00Z', lastVideoAt: null, lastPlayedAt: null, reason: null, excusedUntil: null } });
  assert.match(html, /Most views/);
  assert.match(html, /\+1,490 this week/);
  assert.match(html, /1st/);
  assert.match(html, /0123456789/);
  assert.match(html, /Post your next video before/);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.equal(num(1234567), '1.2M');
  assert.equal(signed(-5), '−5');
  assert.equal(ordinal(22), '22nd');
  assert.equal(chart([{ views: 1, takenAt: '2026-11-01' }]), '');
});

test('empty boards say why', () => {
  const html = boards(boardFor('', summarize([acc('a')], [])));
  assert.match(html, /No scan yet/);
  assert.match(html, /Needs a week of scans/);
});

test('game access says the status, the rule and how to appeal', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const base = { code: '4821773091', lastVideoAt: '2026-11-19T12:00:00Z', lastPlayedAt: '2026-11-20T10:00:00Z', reason: null, excusedUntil: null, dueAt: '2026-11-22T12:00:00Z' };
  const active = gameAccess({ ...base, status: 'active' }, now);
  assert.match(active, /Active/);
  assert.match(active, /in 2 days/);
  assert.match(active, /Give a reason/);
  const lost = gameAccess({ ...base, status: 'lost' }, now);
  assert.match(lost, /Lost access/);
  assert.match(lost, /willll0838/);
  assert.match(lost, /shredboundofficial@gmail\.com/);
  assert.doesNotMatch(lost, /Give a reason/);
  const overdue = gameAccess({ ...base, status: 'active', dueAt: '2026-11-19T12:00:00Z' }, now);
  assert.match(overdue, /3 days are up/);
  const excused = gameAccess({ ...base, status: 'active', excusedUntil: '2026-11-25T12:00:00Z', reason: { id: 1, reason: '<b>sick</b>', until: '2026-11-25T12:00:00Z' } }, now);
  assert.match(excused, /Excused until/);
  assert.match(excused, /&lt;b&gt;sick/);
});

test('events: live, upcoming and ended; only the owner gets the editor', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const list = [
    { id: 1, title: 'Live one', details: '', prize: '$50', startsAt: null, endsAt: '2026-11-23T16:00:00Z' },
    { id: 2, title: 'Later', details: 'x', prize: '', startsAt: '2026-11-25T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' },
    { id: 3, title: 'Done', details: '', prize: '', startsAt: null, endsAt: '2026-11-10T00:00:00Z' },
  ];
  assert.deepEqual(list.map(e => eventPhase(e, now)), ['live', 'upcoming', 'ended']);
  assert.equal(left('2026-11-23T16:00:00Z', now), '3d 4h');
  const clipper = events(list, false, now);
  assert.match(clipper, /3d 4h left/);
  assert.match(clipper, /Ended \(1\)/);
  assert.doesNotMatch(clipper, /New event|data-act="event-edit"/);
  const owner = events(list, true, now);
  assert.match(owner, /New event/);
  assert.match(events(list, true, now, '1'), /Edit event/);
  assert.match(events([], false, now), /No events right now/);
});

test('owner table lists codes, status and actions', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const access = { code: '4821773091', status: 'lost', lastVideoAt: null, lastPlayedAt: '2026-11-20T10:00:00Z', dueAt: '2026-11-18T00:00:00Z', excusedUntil: null, reason: null, devices: 2 };
  const html = clippersAdmin([{ username: 'a_b', access, removedAt: null, lastScanError: null }, { username: 'gone', access: { ...access, status: 'taken' }, removedAt: '2026-11-19T00:00:00Z' }], now);
  assert.match(html, /4821773091/);
  assert.match(html, /Give access back/);
  assert.match(html, /1 lost access/);
  assert.match(html, /Removed \(1\)/);
  assert.equal(rel('2026-11-20T09:00:00Z', now), '3 hours ago');
  assert.match(joinForm("x"), /your own code comes by mail/);
});

import { clipRule, accessStatus, RULE_MS } from '../supabase/functions/clippers/board.js';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const ago = h => new Date(NOW - h * 3600e3).toISOString();

test('3-day rule: played without a video for 3 days loses access', () => {
  assert.equal(clipRule({ now: NOW, joinedAt: ago(120), lastPlayedAt: ago(5) }).revoke, true, 'never posted, played today');
  assert.equal(clipRule({ now: NOW, joinedAt: ago(200), lastVideoAt: ago(80), lastPlayedAt: ago(1) }).revoke, true, 'last video 80 h ago');
});

test('3-day rule: not playing excuses, and a video, a new account or a restore restarts the clock', () => {
  assert.equal(clipRule({ now: NOW, joinedAt: ago(500), lastPlayedAt: null }).revoke, false, 'never played');
  assert.equal(clipRule({ now: NOW, joinedAt: ago(500), lastVideoAt: ago(100), lastPlayedAt: ago(80) }).revoke, false, 'played only before the 3 days');
  assert.equal(clipRule({ now: NOW, joinedAt: ago(500), lastVideoAt: ago(70), lastPlayedAt: ago(1) }).revoke, false, 'posted 70 h ago');
  assert.equal(clipRule({ now: NOW, joinedAt: ago(48), lastPlayedAt: ago(1) }).revoke, false, 'joined 2 days ago');
  assert.equal(clipRule({ now: NOW, joinedAt: ago(500), restoredAt: ago(24), lastPlayedAt: ago(1) }).revoke, false, 'access given back yesterday');
  const r = clipRule({ now: NOW, joinedAt: ago(500), lastVideoAt: ago(30), lastPlayedAt: ago(1) });
  assert.equal(Date.parse(r.dueAt), NOW - 30 * 3600e3 + RULE_MS);
  assert.equal(r.playedRecently, true);
});

test('3-day rule: a running reason holds it; an ended reason restarts the 3 days', () => {
  const reason = (fromH, untilH, endedH) => ({ created_at: ago(fromH), until: ago(untilH), ended_at: endedH == null ? null : ago(endedH) });
  const running = clipRule({ now: NOW, joinedAt: ago(500), lastPlayedAt: ago(1), reasons: [reason(100, -48)] });
  assert.equal(running.revoke, false);
  assert.equal(Date.parse(running.excusedUntil), NOW + 48 * 3600e3);
  assert.equal(clipRule({ now: NOW, joinedAt: ago(500), lastPlayedAt: ago(1), reasons: [reason(100, 24)] }).revoke, false, 'ended a day ago');
  assert.equal(clipRule({ now: NOW, joinedAt: ago(500), lastPlayedAt: ago(1), reasons: [reason(200, 100)] }).revoke, true, 'ended 100 h ago');
  assert.equal(clipRule({ now: NOW, joinedAt: ago(500), lastPlayedAt: ago(1), reasons: [reason(100, -48, 80)] }).revoke, true, 'cancelled 80 h ago');
  assert.equal(clipRule({ now: NOW, joinedAt: ago(500), lastPlayedAt: ago(1), reasons: [{ ...reason(100, -48, 2), ended_by: 'owner' }] }).revoke, true, 'turned down by the owner');
});

test('access status words', () => {
  assert.equal(accessStatus({ revoked_at: null }, null), 'active');
  assert.equal(accessStatus({ revoked_at: 'x', revoked_reason: 'inactive' }, null), 'lost');
  assert.equal(accessStatus({ revoked_at: 'x', revoked_reason: null }, null), 'taken');
  assert.equal(accessStatus({ revoked_at: null }, 'x'), 'removed');
});

import { playtestersAdmin } from '../src/view.js';
test('playtesters tab lists buyers and playtest codes apart from clippers', () => {
  const html = playtestersAdmin([
    { id: 31, name: 'Köp jenna burke', type: 'buyer', active: true, code: 'SB-1234', buyer: { name: 'jenna burke', email: 'a@b.c', country: 'CA', amount: 1900, currency: 'usd', paidAt: '2026-11-18T22:01:36Z', mail: 'pending', checkout: true }, gameNames: [], devices: 0, maxDevices: 1, lastSeen: null },
    { id: 28, name: 'Jack', type: 'playtester', active: true, code: null, buyer: null, gameNames: ['jackrides'], devices: 1, maxDevices: 1, lastSeen: '2026-11-18T20:00:00Z' },
    { id: 1, name: 'SBtemp1', type: 'playtester', active: false, code: null, buyer: null, gameNames: [], devices: 21, maxDevices: null, lastSeen: null },
  ], Date.parse('2026-11-19T00:00:00Z'));
  assert.match(html, /2 with access · 1 bought/);
  assert.match(html, /\$19\.00/);
  assert.match(html, /<th>Code delivery<\/th>/);
  assert.match(html, /<span class="ok-text">Checkout<\/span>/);
  assert.match(html, /a@b\.c/);
  assert.match(html, /jackrides/);
  assert.match(html, /No access \(1\)/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

import { applicationsAdmin } from '../src/view.js';
test('applications tab: approve or reject who applied', () => {
  const html = applicationsAdmin([{ username: 'new_one', email: 'n@x.se', appliedAt: '2026-11-19T10:00:00Z', status: 'pending' }, { username: 'no', email: null, appliedAt: null, status: 'rejected' }], Date.parse('2026-11-19T12:00:00Z'));
  assert.match(html, /1 waiting/);
  assert.match(html, /data-act="approve" data-user="new_one"/);
  assert.match(html, /Rejected \(1\)/);
});

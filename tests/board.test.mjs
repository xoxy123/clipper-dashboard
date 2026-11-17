import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, boardFor, cleanUsername } from '../supabase/functions/clippers/board.js';
import { boards, myAccount, chart, num, signed, ordinal } from '../src/view.js';

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
  const html = boards(boardFor('a', s)) + myAccount(boardFor('a', s).me);
  assert.match(html, /Most views/);
  assert.match(html, /\+1,490 this week/);
  assert.match(html, /1st/);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.equal(num(1234567), '1.2M');
  assert.equal(signed(-5), '−5');
  assert.equal(ordinal(22), '22nd');
  assert.equal(chart([{ views: 1, takenAt: '2026-11-01' }]), '');
});

test('empty boards say why', () => {
  const html = boards(boardFor('a', summarize([acc('a')], [])));
  assert.match(html, /No scan yet/);
  assert.match(html, /Needs two weekly scans/);
});

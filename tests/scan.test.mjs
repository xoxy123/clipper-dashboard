import test from 'node:test';
import assert from 'node:assert/strict';
import { tiktokPostedAt, parseTikTokProfile, parseTikTokEmbed, parseInstagramEmbed, newest, rollTotal, cleanInstagram } from '../supabase/functions/clippers/scan.js';

const script = (id, data) => `<html><body><script id="${id}" type="application/json">${JSON.stringify(data)}</script></body></html>`;

test('a TikTok video id carries its upload time', () => {
  assert.equal(tiktokPostedAt('7710681094630247702'), '2026-11-21T17:40:42.000Z');
  assert.equal(tiktokPostedAt('abc'), null);
  assert.equal(tiktokPostedAt('12'), null);
});

test('TikTok profile: exact counts, private and missing accounts', () => {
  const ok = parseTikTokProfile(script('__UNIVERSAL_DATA_FOR_REHYDRATION__', { __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: { user: { uniqueId: 'a' }, stats: { followerCount: 1060, heartCount: 24900, videoCount: 56 } } } } }));
  assert.deepEqual(ok, { ok: true, followers: 1060, likes: 24900, videos: 56 });
  assert.equal(parseTikTokProfile(script('__UNIVERSAL_DATA_FOR_REHYDRATION__', { __DEFAULT_SCOPE__: { 'webapp.user-detail': { statusCode: 10221 } } })).error, 'not_found');
  assert.equal(parseTikTokProfile(script('__UNIVERSAL_DATA_FOR_REHYDRATION__', { __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: { user: { privateAccount: true } } } } })).error, 'private');
  assert.equal(parseTikTokProfile('<html>captcha</html>').error, 'blocked');
});

test('TikTok embed: newest videos with views and upload time; errors', () => {
  const page = { userInfo: { uniqueId: 'powwdurr', followerCount: 6, heartCount: 1319 }, videoList: [
    { id: '7710681094630247702', playCount: 763 },
    { id: '7710372051055414550', playCount: 848 },
    { id: '7709907583938727190', playCount: 5, privateItem: true },
  ] };
  const r = parseTikTokEmbed(script('__FRONTITY_CONNECT_STATE__', { source: { data: { '/embed/@powwdurr': page } } }), 'powwdurr');
  assert.equal(r.ok, true);
  assert.equal(r.followers, 6);
  assert.deepEqual(r.items.map(i => [i.id, i.value]), [['7710681094630247702', 763], ['7710372051055414550', 848]]);
  assert.equal(newest(r.items), '2026-11-21T17:40:42.000Z');
  const missing = parseTikTokEmbed(script('__FRONTITY_CONNECT_STATE__', { source: { data: { '/embed/@lewat3r': { isError: true, errorCode: 10221 } } } }), 'lewat3r');
  assert.deepEqual(missing, { ok: false, error: 'not_found' });
  assert.equal(parseTikTokEmbed('<html></html>', 'x').error, 'blocked');
});

test('Instagram embed: followers, posts and the newest posts with likes', () => {
  const ctx = { context: { username: 'shredbound.game', followers_count: 820, posts_count: 111, graphql_media: [
    { shortcode_media: { shortcode: 'DgE51p2BTl9', taken_at_timestamp: 1795420939, edge_liked_by: { count: 39 } } },
    { shortcode_media: { shortcode: 'DgEDyoDORlt', taken_at_timestamp: 1795392540, edge_liked_by: { count: 563 } } },
  ] } };
  const html = `<script>{"contextJSON":${JSON.stringify(JSON.stringify(ctx))}}</script>`;
  const r = parseInstagramEmbed(html, 'Shredbound.Game');
  assert.equal(r.ok, true);
  assert.equal(r.followers, 820);
  assert.equal(r.posts, 111);
  assert.deepEqual(r.items.map(i => [i.id, i.value]), [['DgE51p2BTl9', 39], ['DgEDyoDORlt', 563]]);
  assert.equal(newest(r.items), new Date(1795420939 * 1000).toISOString());
  assert.equal(parseInstagramEmbed(html, 'someone_else').error, 'not_found');
  assert.equal(parseInstagramEmbed('<html>login</html>', 'x').error, 'blocked');
  assert.equal(parseInstagramEmbed('<script>{"contextJSON":null}</script><div class="EmbedBroken"></div>', 'x').error, 'not_found');
});

test('running total: first reading sums, later readings add gains and new videos only', () => {
  const at = '2026-11-20T00:00:00Z';
  const item = (id, value, postedAt) => ({ id, value, postedAt });
  // First reading of a new clipper.
  assert.equal(rollTotal({ prevTotal: null, lastReadAt: null, known: new Map(), items: [item('a', 10, at), item('b', 5, at)] }), 15);
  // The old browser scan read every video (total 1000): only videos posted after it are added.
  assert.equal(rollTotal({ prevTotal: 1000, lastReadAt: at, known: new Map(), items: [item('old', 400, '2026-11-19T00:00:00Z'), item('new', 30, '2026-11-21T00:00:00Z')] }), 1030);
  // Known videos add what they gained; a count that went down never subtracts.
  const known = new Map([['a', 10], ['b', 50]]);
  assert.equal(rollTotal({ prevTotal: 100, lastReadAt: at, known, items: [item('a', 25, at), item('b', 40, at), item('c', 7, '2026-11-22T00:00:00Z')] }), 100 + 15 + 0 + 7);
});

test('Instagram usernames are cleaned like TikTok ones', () => {
  assert.equal(cleanInstagram('@Shredbound.Game'), 'shredbound.game');
  assert.equal(cleanInstagram('https://www.instagram.com/some_user/?hl=en'), 'some_user');
  assert.equal(cleanInstagram('bad name'), null);
  assert.equal(cleanInstagram(''), null);
});

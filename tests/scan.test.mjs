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

import { parseTikTokVideo, detailDue, isShredbound } from '../supabase/functions/clippers/scan.js';

test('a TikTok post page gives its views, likes, comments, shares, saves and length', () => {
  const item = { id: '7710681094630247702', desc: 'Rail sesh in  Shredbound\n#shredbound', createTime: 1795282879,
    stats: { playCount: 784, diggCount: 5, commentCount: 0, shareCount: 1, collectCount: 2 },
    statsV2: { playCount: '3000000000', diggCount: '5', commentCount: '0', shareCount: '1', collectCount: '2' }, video: { duration: 18 } };
  const r = parseTikTokVideo(script('__UNIVERSAL_DATA_FOR_REHYDRATION__', { __DEFAULT_SCOPE__: { 'webapp.video-detail': { statusCode: 0, itemInfo: { itemStruct: item } } } }));
  assert.equal(r.ok, true);
  assert.equal(r.views, 3000000000, 'statsV2 is exact past 2^31');
  assert.deepEqual([r.likes, r.comments, r.shares, r.saves, r.durationS, r.kind], [5, 0, 1, 2, 18, 'video']);
  assert.equal(r.caption, 'Rail sesh in Shredbound #shredbound');
  const photo = parseTikTokVideo(script('__UNIVERSAL_DATA_FOR_REHYDRATION__', { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { ...item, imagePost: { images: [] } } } } } }));
  assert.equal(photo.kind, 'photo');
  assert.equal(parseTikTokVideo(script('__UNIVERSAL_DATA_FOR_REHYDRATION__', { __DEFAULT_SCOPE__: { 'webapp.video-detail': { statusCode: 10204 } } })).error, 'not_found');
  assert.equal(parseTikTokVideo('<html>captcha</html>').error, 'blocked');
});

test('the embed and Instagram give each post its caption; Instagram its comments', () => {
  const page = { userInfo: {}, videoList: [{ id: '7711063988712394006', playCount: 272, desc: 'shrebounds has got some New updates #shredbound @Shredbound ' }] };
  const r = parseTikTokEmbed(script('__FRONTITY_CONNECT_STATE__', { source: { data: { '/embed/@real.handle': page } } }), 'real.handle');
  assert.equal(r.items[0].caption, 'shrebounds has got some New updates #shredbound @Shredbound');
  const ctx = { context: { username: 'x', graphql_media: [{ shortcode_media: { shortcode: 'DgAB1nPPINp', is_video: true, taken_at_timestamp: 1795430158, edge_liked_by: { count: 42 }, edge_media_to_comment: { count: 1 }, edge_media_to_caption: { edges: [{ node: { text: '@shredbound.game best game ever' } }] } } }] } };
  const ig = parseInstagramEmbed(`<script>{"contextJSON":${JSON.stringify(JSON.stringify(ctx))}}</script>`, 'x');
  assert.deepEqual([ig.items[0].value, ig.items[0].comments, ig.items[0].kind, ig.items[0].caption], [42, 1, 'video', '@shredbound.game best game ever']);
});

test('a post page is read when new, every 2 hours while fresh, then daily', () => {
  const now = Date.parse('2026-11-26T08:00:00Z');
  assert.equal(detailDue({ detailAt: null, postedAt: null }, now), true);
  assert.equal(detailDue({ detailAt: '2026-11-26T07:00:00Z', postedAt: '2026-11-25T00:00:00Z' }, now), false, 'fresh, read an hour ago');
  assert.equal(detailDue({ detailAt: '2026-11-26T06:10:00Z', postedAt: '2026-11-25T00:00:00Z' }, now), true, 'fresh, read 110 minutes ago');
  assert.equal(detailDue({ detailAt: '2026-11-25T13:00:00Z', postedAt: '2026-10-01T00:00:00Z' }, now), false, 'old, read 19 hours ago');
  assert.equal(detailDue({ detailAt: '2026-11-25T11:00:00Z', postedAt: '2026-10-01T00:00:00Z' }, now), true, 'old, read 21 hours ago');
});

test('a Shredbound clip is one whose caption names the game', () => {
  for (const c of ['#shredbound', 'Rail sesh in Shredbound', '@shredbound.official', 'shrebounds has got some New updates']) assert.equal(isShredbound(c), true, c);
  for (const c of ['#shredsauce #cork7', 'aleksib #goat', '', null]) assert.equal(isShredbound(c), false, String(c));
});

// Shredbound clipper dashboard. Clippers log in on the dashboard (GitHub Pages)
// with the shared clipper code and their TikTok username, and get a personal
// game access code. A daily scan records each public TikTok profile; the
// 3-day clipping rule (board.js clipRule) takes the game code of a clipper who
// played without posting for 3 days. The owner logs in with the owner code and
// writes events, gives access back and removes clippers.
//
// Deployed as the "clippers" edge function (verify_jwt on): the dashboard sends
// the project's anon key. The tables (supabase/schema.sql) are closed to
// clients; this function is the only way in, with the service role. It writes
// public.access_codes directly for the clippers' game codes (the "access"
// function, Shredbound repo Tools/online/access, checks them in the game).
//
// The shared clipper code, the owner code and the scan's admin secret are
// stored only as sha256 hashes in clipper_config (shared and owner codes are
// lowercased first). A clipper's game code is kept in plain text in
// clipper_accounts, so the dashboard can show it; it also logs that clipper in.
//
// Tokens: clipper "v1.<username>.<HMAC>", owner "o1.<HMAC>" (signed with
// clipper_config.token_secret; the owner's covers the owner code's hash, so a
// new owner code logs the old owner sessions out).
//
// POST JSON {action, ...}:
//   join {code, username?, email?} -> {ok, token, role, username?, mailed?}  (a new clipper gives an email and gets the welcome mail)
//   owner.welcome {token, username}  mails a clipper's welcome again
//   owner.approve {token, username} | owner.reject {token, username}   an application (join makes one: {ok, pending:true})
//   state {token}                 -> {ok, role, board, events, me? | clippers?}
//   reason {token, reason, until} (clipper) | reason.end {token} (clipper)
//   owner.access {token, username, active} | owner.remove {token, username}
//   owner.reason.end {token, id} | owner.code {token, id, active}   (a playtester's or buyer's code)
//   owner.event.save {token, id?, title, details, prize, startsAt, endsAt}
//   owner.event.delete {token, id}
//   admin.list | admin.record {snapshots} | admin.remove {username}   (x-admin-secret: the old browser scan)
//   admin.state | admin.profile {username}   (x-admin-secret) what the owner sees, for checks and scripts
//   cron.scan {enforce?}          the scan on Supabase (x-cron-secret from pg_cron, or x-admin-secret); see scan.js.
//                                 Daily at 17:00 UTC it applies the 3-day rule; every 2 hours ({enforce:false}) it only reads.
//   instagram {token, instagram}  (clipper) | owner.instagram {token, username, instagram}   set or clear ("") the Instagram username
//   profile {token, username?}    -> {ok, profile}  one clipper's numbers and every post the scan has seen (a clipper: their own)
//   scan.me {token}               (clipper) read their TikTok and Instagram now (at most every 10 minutes; never applies the rule)
//   owner.scan {token, username}  read one clipper now (never applies the rule) -> {ok, result, profile}
//   owner.tiktok {token, username, tiktok}  the TikTok handle to read when it is not their username ("" = their username);
//                                 restarts their 3 days and reads them now -> {ok, result, profile}
//   refusals: {ok:false, error:"bad_code"|"bad_username"|"tiktok_not_found"|"taken"|"removed"|"invalid"|"forbidden"|"limited"|"bad_request"}
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { accessStatus, boardFor, cleanUsername, clipRule, daily, postStats, postView, summarize } from "./board.js";
import { cleanEmail, sendMail } from "./mail.ts";
import { cleanInstagram, detailDue, newest, parseInstagramEmbed, parseTikTokEmbed, parseTikTokProfile, parseTikTokVideo, rollTotal } from "./scan.js";
import { WELCOME_SUBJECT, welcomeMailText } from "./welcome.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DASHBOARD_ORIGIN = "https://xoxy123.github.io";
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
// The website (Lovable) shows the dashboard too: quantativestudios.com and Lovable's preview hosts.
const SITE_ORIGIN = /^https:\/\/((www\.)?quantativestudios\.com|[a-z0-9-]+\.(lovable\.app|lovableproject\.com|lovable\.dev))$/;
const MAX_BODY_BYTES = 200_000;
const FAILS_PER_IP = 15;
const FAIL_WINDOW_MS = 10 * 60_000;
const MAX_REASON_DAYS = 30;
const SCAN_ERRORS = new Set(["not_found", "private", "no_data", "blocked"]);
const DAY = 86_400_000;

interface Config {
  join_code_sha256: string;
  owner_code_sha256: string;
  admin_secret_sha256: string;
  token_secret: string;
}
type Who = { role: "owner" } | { role: "clipper"; username: string };

let config: Config | null = null;
let configAt = 0;
async function getConfig(): Promise<Config> {
  if (config && Date.now() - configAt < 60_000) return config;
  const { data, error } = await supabase.from("clipper_config").select("*").eq("id", 1).single();
  if (error || !data) throw new Error("config");
  config = data as Config;
  configAt = Date.now();
  return config;
}

// ------------------------------------------------------------------ crypto

const enc = new TextEncoder();
async function sha256(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
async function clipperToken(username: string) {
  return `v1.${username}.${await hmac((await getConfig()).token_secret, "clipper:" + username)}`;
}
async function ownerToken() {
  const c = await getConfig();
  return `o1.${await hmac(c.token_secret, "owner:" + c.owner_code_sha256)}`;
}
async function who(token: unknown): Promise<Who | null> {
  const t = String(token ?? "");
  const c = await getConfig();
  const o = t.match(/^o1\.([A-Za-z0-9_-]{43})$/);
  if (o) return same(await hmac(c.token_secret, "owner:" + c.owner_code_sha256), o[1]) ? { role: "owner" } : null;
  const m = t.match(/^v1\.([a-z0-9_.]{2,24})\.([A-Za-z0-9_-]{43})$/);
  if (m && same(await hmac(c.token_secret, "clipper:" + m[1]), m[2])) return { role: "clipper", username: m[1] };
  return null;
}

// A personal game code: 10 digits, so case and look-alike letters never matter.
function newGameCode() {
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  return [...bytes].map(b => String(b % 10)).join("");
}

// ------------------------------------------------------------------ http

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allow = origin === DASHBOARD_ORIGIN || LOCAL_ORIGIN.test(origin) || SITE_ORIGIN.test(origin) ? origin : DASHBOARD_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-admin-secret, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });

const ip = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
async function limited(req: Request) {
  const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
  const { count } = await supabase.from("clipper_failures").select("id", { count: "exact", head: true }).eq("ip", ip(req)).gte("at", since);
  return (count ?? 0) >= FAILS_PER_IP;
}
async function fail(req: Request) {
  await supabase.from("clipper_failures").insert({ ip: ip(req) });
  await supabase.from("clipper_failures").delete().lt("at", new Date(Date.now() - DAY).toISOString());
}
async function isAdmin(req: Request) {
  const secret = req.headers.get("x-admin-secret") || "";
  return !!secret && same(await sha256(secret), (await getConfig()).admin_secret_sha256);
}

const count = (v: unknown) => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n);
};
const when = (v: unknown) => (typeof v === "string" && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const text = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

// ------------------------------------------------------------------ data

interface Account {
  username: string;
  joined_at: string;
  removed_at: string | null;
  game_code: string | null;
  game_code_id: number | null;
  access_restored_at: string | null;
  lost_access_at: string | null;
  email: string | null;
  welcome_mailed_at: string | null;
  welcome_error: string | null;
  instagram: string | null;
  tiktok: string | null;
  tiktok_set_at: string | null;
}
interface CodeRow { id: number; revoked_at: string | null; revoked_reason: string | null }
interface DeviceRow { code_id: number; last_played_at: string | null; play_seconds: number }
interface ReasonRow { id: number; username: string; reason: string; created_at: string; until: string; ended_at: string | null; ended_by: string | null }

async function accounts(includeRemoved = false): Promise<Account[]> {
  let q = supabase.from("clipper_accounts").select("username, joined_at, removed_at, game_code, game_code_id, access_restored_at, lost_access_at, email, welcome_mailed_at, welcome_error, instagram, tiktok, tiktok_set_at");
  if (!includeRemoved) q = q.is("removed_at", null);
  // Applicants waiting for (or turned down by) the owner are not clippers yet.
  q = q.eq("status", "approved");
  return (must(await q.order("username")) ?? []) as Account[];
}
async function snapshots(sinceDays = 120, usernames?: string[]) {
  let q = supabase.from("clipper_snapshots")
    .select("username, taken_at, ok, error, followers, likes, videos, views, last_video_at, ig_ok, ig_error, ig_last_post_at, ig_followers, ig_posts, ig_likes, source")
    .gte("taken_at", new Date(Date.now() - sinceDays * DAY).toISOString());
  if (usernames) q = q.in("username", usernames);
  return must(await q.order("taken_at", { ascending: false }).limit(20000)) ?? [];
}
// Every post the scan has seen for these clippers, newest first.
const POST_COLUMNS = "platform, video_id, username, handle, posted_at, value, views, likes, comments, shares, saves, caption, kind, duration_s, detail_at, updated_at";
async function postRows(usernames: string[]): Promise<Record<string, any>[]> {
  if (!usernames.length) return [];
  return (must(await supabase.from("clipper_videos").select(POST_COLUMNS).in("username", usernames)
    .order("posted_at", { ascending: false, nullsFirst: false }).limit(10000)) ?? []) as Record<string, any>[];
}

// The TikTok handle the scan reads: the one the owner set, else the username they joined with.
const handleOf = (a: { username: string; tiktok?: string | null }) => a.tiktok || a.username;
// The 3 days start again when the owner gives access back or corrects their TikTok handle.
const restartedAt = (a: Account) => [a.access_restored_at, a.tiktok_set_at].filter(Boolean).sort().pop() ?? null;
async function codes(ids: number[]): Promise<Map<number, CodeRow>> {
  if (!ids.length) return new Map();
  const rows = must(await supabase.from("access_codes").select("id, revoked_at, revoked_reason").in("id", ids)) as CodeRow[];
  return new Map(rows.map(r => [Number(r.id), r]));
}
async function devices(ids: number[]): Promise<Map<number, { lastPlayedAt: string | null; devices: number; playSeconds: number }>> {
  const out = new Map<number, { lastPlayedAt: string | null; devices: number; playSeconds: number }>();
  if (!ids.length) return out;
  const rows = must(await supabase.from("access_devices").select("code_id, last_played_at, play_seconds").in("code_id", ids)) as DeviceRow[];
  for (const r of rows) {
    const id = Number(r.code_id), o = out.get(id) ?? { lastPlayedAt: null, devices: 0, playSeconds: 0 };
    o.devices++;
    o.playSeconds += Number(r.play_seconds) || 0;
    if (r.last_played_at && (!o.lastPlayedAt || r.last_played_at > o.lastPlayedAt)) o.lastPlayedAt = r.last_played_at;
    out.set(id, o);
  }
  return out;
}
async function reasons(usernames?: string[]): Promise<ReasonRow[]> {
  let q = supabase.from("clipper_reasons").select("id, username, reason, created_at, until, ended_at, ended_by")
    .gte("until", new Date(Date.now() - 60 * DAY).toISOString());
  if (usernames) q = q.in("username", usernames);
  return (must(await q.order("created_at", { ascending: false })) ?? []) as ReasonRow[];
}
async function events() {
  const rows = must(await supabase.from("clipper_events").select("id, title, details, prize, starts_at, ends_at, created_at")
    .gte("ends_at", new Date(Date.now() - 60 * DAY).toISOString()).order("ends_at")) ?? [];
  return rows.map((e: Record<string, unknown>) => ({ id: e.id, title: e.title, details: e.details, prize: e.prize, startsAt: e.starts_at, endsAt: e.ends_at }));
}

// The newest post a scan has seen for each clipper (a deleted video still counts as posted):
// the readings' newest video, and every post kept in clipper_videos.
// A post or reel on their Instagram counts as clipping too (William, 2026-11-23).
function lastVideos(snaps: { username: string; last_video_at: string | null; ig_last_post_at?: string | null }[], posts: Record<string, any>[] = []) {
  const out = new Map<string, string>();
  const see = (u: string, t: string | null | undefined) => {
    if (!t) return;
    const iso = new Date(t).toISOString();
    if (!out.has(u) || iso > out.get(u)!) out.set(u, iso);
  };
  for (const s of snaps) { see(s.username, s.last_video_at); see(s.username, s.ig_last_post_at); }
  for (const p of posts) see(p.username, p.posted_at);
  return out;
}

// One clipper's Instagram as the dashboard shows it: the newest reading, the one
// at least a week before it (for "this week"), and the last error.
type Snap = Record<string, any>;
function instagramView(handle: string | null, snaps: Snap[], username: string) {
  if (!handle) return { handle: null };
  const mine = snaps.filter(s => s.username === username && s.ig_ok != null);
  const good = mine.filter(s => s.ig_ok);
  const latest = good[0] ?? null;
  const prev = latest ? good.find(s => Date.parse(latest.taken_at) - Date.parse(s.taken_at) >= 6.5 * DAY) ?? null : null;
  const pick = (s: Snap | null) => s && { takenAt: s.taken_at, followers: s.ig_followers, posts: s.ig_posts, likes: s.ig_likes, lastPostAt: s.ig_last_post_at };
  const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
  return {
    handle,
    error: mine[0] && !mine[0].ig_ok ? mine[0].ig_error || "no_data" : null,
    latest: pick(latest),
    previous: pick(prev),
    gained: prev ? { followers: diff(latest.ig_followers, prev.ig_followers), posts: diff(latest.ig_posts, prev.ig_posts), likes: diff(latest.ig_likes, prev.ig_likes) } : null,
  };
}

const activeReason = (rs: ReasonRow[], now = Date.now()) =>
  rs.find(r => !r.ended_at && Date.parse(r.created_at) <= now && Date.parse(r.until) > now) ?? null;
const reasonView = (r: ReasonRow | null) => r && { id: r.id, reason: r.reason, createdAt: r.created_at, until: r.until };

// One clipper's game access: the code, its status, and where the rule stands.
function accessView(a: Account, code: CodeRow | undefined, dev: { lastPlayedAt: string | null; devices: number; playSeconds: number } | undefined, lastVideoAt: string | null, rs: ReasonRow[]) {
  const rule = clipRule({ now: Date.now(), lastVideoAt, joinedAt: a.joined_at, restoredAt: restartedAt(a), reasons: rs, lastPlayedAt: dev?.lastPlayedAt ?? null });
  return {
    code: a.game_code,
    status: accessStatus(code ?? null, a.removed_at),
    lostAt: code?.revoked_reason === "inactive" ? (a.lost_access_at ?? code.revoked_at) : null,
    lastVideoAt,
    lastPlayedAt: dev?.lastPlayedAt ?? null,
    dueAt: rule.dueAt,
    excusedUntil: rule.excusedUntil,
    reason: reasonView(activeReason(rs)),
    devices: dev?.devices ?? 0,
    playSeconds: dev?.playSeconds ?? 0,
  };
}

// Every game code that is not a clipper's: buyers (store_orders) and playtest
// codes made by hand. The 3-day rule never touches these; only the owner does.
async function playtesters(clipperCodeIds: number[]) {
  const all = (must(await supabase.from("access_codes").select("id, name, note, created_at, revoked_at, max_devices").order("id", { ascending: false })) ?? []) as
    { id: number; name: string; note: string | null; created_at: string; revoked_at: string | null; max_devices: number | null }[];
  const codes = all.filter(c => !clipperCodeIds.includes(Number(c.id)));
  const ids = codes.map(c => Number(c.id));
  if (!ids.length) return [];
  const [orders, devs, riders] = await Promise.all([
    supabase.from("store_orders").select("code_id, buyer_name, email, country, amount_total, currency, paid_at, code_text, mail_status, checkout_delivery").in("code_id", ids),
    supabase.from("access_devices").select("code_id, last_seen, play_seconds").in("code_id", ids),
    supabase.from("rider_profiles").select("code_id, username").in("code_id", ids),
  ]);
  const order = new Map(((must(orders) ?? []) as Record<string, unknown>[]).map(o => [Number(o.code_id), o]));
  return codes.map(c => {
    const id = Number(c.id), o = order.get(id) as Record<string, unknown> | undefined;
    const d = ((must(devs) ?? []) as { code_id: number; last_seen: string; play_seconds: number }[]).filter(x => Number(x.code_id) === id);
    return {
      id,
      name: c.name,
      type: o ? "buyer" : "playtester",
      active: !c.revoked_at,
      createdAt: c.created_at,
      code: o ? o.code_text : null,
      buyer: o ? {
        name: o.buyer_name, email: o.email, country: o.country, amount: o.amount_total,
        currency: o.currency, paidAt: o.paid_at, mail: o.mail_status, checkout: o.checkout_delivery === true,
      } : null,
      gameNames: ((must(riders) ?? []) as { code_id: number; username: string }[]).filter(r => Number(r.code_id) === id).map(r => r.username),
      devices: d.length,
      maxDevices: c.max_devices,
      lastSeen: d.reduce((m: string | null, x) => (!m || x.last_seen > m ? x.last_seen : m), null),
      playSeconds: d.reduce((n, x) => n + (Number(x.play_seconds) || 0), 0),
    };
  });
}

async function state(w: Who) {
  const accs = await accounts(w.role === "owner");
  const snaps = await snapshots();
  const live = accs.filter(a => !a.removed_at);
  const summary = summarize(live, snaps);
  const board = boardFor(w.role === "clipper" ? w.username : "", summary);
  delete (board as Record<string, unknown>).me;
  const out: Record<string, unknown> = { ok: true, role: w.role, board, events: await events() };
  const rows = await postRows(w.role === "clipper" ? [w.username] : accs.map(a => a.username));
  const videos = lastVideos(snaps, rows);
  const postsOf = (u: string) => rows.filter(r => r.username === u).map(postView);
  if (w.role === "clipper") {
    const a = accs.find(x => x.username === w.username);
    if (!a) return null;
    const id = a.game_code_id ? [Number(a.game_code_id)] : [];
    const [cs, ds, rs] = await Promise.all([codes(id), devices(id), reasons([a.username])]);
    const posts = postsOf(a.username);
    out.me = {
      ...boardFor(a.username, summary).me,
      handle: handleOf(a),
      access: accessView(a, cs.get(id[0]), ds.get(id[0]), videos.get(a.username) ?? null, rs),
      instagram: instagramView(a.instagram, snaps, a.username),
      posts,
      stats: postStats(posts, a.joined_at),
    };
  } else {
    const ids = accs.map(a => Number(a.game_code_id)).filter(Boolean);
    const [cs, ds, rs] = await Promise.all([codes(ids), devices(ids), reasons()]);
    out.playtesters = await playtesters(ids);
    out.applications = ((must(await supabase.from("clipper_accounts").select("username, email, applied_at, status").in("status", ["pending", "rejected"]).order("applied_at", { ascending: false })) ?? []) as
      { username: string; email: string | null; applied_at: string | null; status: string }[]).map(a => ({ username: a.username, email: a.email, appliedAt: a.applied_at, status: a.status }));
    out.clippers = accs.map(a => {
      const row = summary.rows.find(r => r.username === a.username);
      const mine = rs.filter(r => r.username === a.username);
      return {
        username: a.username,
        tiktok: handleOf(a),
        email: a.email,
        welcome: a.welcome_mailed_at ? "sent" : a.welcome_error ? "failed: " + a.welcome_error : a.email ? "not sent" : null,
        joinedAt: a.joined_at,
        removedAt: a.removed_at,
        lastScanError: row?.lastError ?? null,
        instagram: instagramView(a.instagram, snaps, a.username),
        views: row?.latest?.views ?? null,
        gained: row?.gained?.views ?? null,
        stats: postStats(postsOf(a.username), a.joined_at),
        access: accessView(a, cs.get(Number(a.game_code_id)), ds.get(Number(a.game_code_id)), videos.get(a.username) ?? null, mine),
        reasons: mine.slice(0, 5).map(r => ({ ...reasonView(r), endedAt: r.ended_at, endedBy: r.ended_by })),
      };
    });
  }
  return out;
}

// One clipper's profile: game access, their TikTok and Instagram numbers over
// time, and every post the scan has seen with its own numbers. The owner sees
// anyone's (with their email and reasons); a clipper sees their own.
async function profile(username: string, owner: boolean) {
  const a = (await accounts(owner)).find(x => x.username === username);
  if (!a) return null;
  const id = a.game_code_id ? [Number(a.game_code_id)] : [];
  const [snaps, rows, cs, ds, rs] = await Promise.all([snapshots(120, [username]), postRows([username]), codes(id), devices(id), reasons([username])]);
  const row = summarize([a], snaps).rows[0];
  const posts = rows.map(postView);
  const good = snaps.filter((x: Snap) => x.ok);
  return {
    username: a.username,
    tiktok: handleOf(a),
    tiktokSetAt: a.tiktok ? a.tiktok_set_at : null,
    email: owner ? a.email : undefined,
    joinedAt: a.joined_at,
    removedAt: a.removed_at,
    access: accessView(a, cs.get(id[0]), ds.get(id[0]), lastVideos(snaps, rows).get(a.username) ?? null, rs),
    reasons: owner ? rs.slice(0, 10).map(r => ({ ...reasonView(r), endedAt: r.ended_at, endedBy: r.ended_by })) : undefined,
    tiktokStats: { lastError: row.lastError, lastReadAt: snaps[0]?.taken_at ?? null, latest: row.latest, previous: row.previous, gained: row.gained, history: row.history },
    instagram: instagramView(a.instagram, snaps, a.username),
    instagramHistory: daily(snaps.filter((x: Snap) => x.ig_ok)).map((x: Snap) => ({ takenAt: x.taken_at, followers: x.ig_followers, likes: x.ig_likes, posts: x.ig_posts })),
    readings: good.length,
    stats: postStats(posts, a.joined_at),
    posts,
  };
}

// ------------------------------------------------------------------ actions

async function join(req: Request, body: Record<string, unknown>) {
  if (await limited(req)) return json(req, { ok: false, error: "limited" }, 429);
  const c = await getConfig();
  const typed = String(body.code ?? "").trim();
  const lower = typed.toLowerCase();
  if (typed && same(await sha256(lower), c.owner_code_sha256)) {
    return json(req, { ok: true, role: "owner", token: await ownerToken() });
  }
  // A clipper's own game code logs them in on a new device.
  if (/^\d{10}$/.test(typed)) {
    const { data } = await supabase.from("clipper_accounts").select("username, removed_at").eq("game_code", typed).maybeSingle();
    if (data && !data.removed_at) return json(req, { ok: true, role: "clipper", username: data.username, token: await clipperToken(data.username) });
    if (data?.removed_at) return json(req, { ok: false, error: "removed" });
  }
  // Applying needs no code (William, 2026-11-19): an empty code with a TikTok
  // username and an email is an application; the owner approves it.
  if (typed && !same(await sha256(lower), c.join_code_sha256)) {
    await fail(req);
    return json(req, { ok: false, error: "bad_code" });
  }
  const username = cleanUsername(body.username);
  if (!username) return json(req, { ok: false, error: "bad_username" });
  // Email: asked by the dashboard; an older copy of the page without the field still joins.
  const typedEmail = String(body.email ?? "").trim();
  const email = typedEmail ? cleanEmail(typedEmail) : null;
  if (typedEmail && !email) return json(req, { ok: false, error: "bad_email" });
  const { data: existing } = await supabase.from("clipper_accounts").select("username, removed_at, status").eq("username", username).maybeSingle();
  if (existing?.removed_at || existing?.status === "rejected") return json(req, { ok: false, error: "removed" });
  if (existing?.status === "pending") return json(req, { ok: false, error: "pending" });
  if (existing) return json(req, { ok: false, error: "taken" });

  // A new clipper applies: the owner approves in the dashboard, and only then the
  // game code is made and mailed (owner.approve).
  if (!email) return json(req, { ok: false, error: "bad_email" });
  // The TikTok username must be a real profile: one clipper typed their display
  // name, every scan failed, and none of their posts were ever seen. Only a
  // clear "no such user" refuses; a blocked or slow TikTok lets them apply.
  if (parseTikTokProfile(await page(`https://www.tiktok.com/@${username}`, DESKTOP_UA)).error === "not_found") {
    return json(req, { ok: false, error: "tiktok_not_found" });
  }
  const { error } = await supabase.from("clipper_accounts").insert({ username, email, status: "pending", applied_at: new Date().toISOString() });
  if (error) {
    if ((error as { code?: string }).code === "23505") return json(req, { ok: false, error: "taken" });
    throw error;
  }
  return json(req, { ok: true, pending: true, username });
}

// Makes an approved clipper's own game code and stores it on their account.
async function makeGameCode(username: string): Promise<string> {
  let codeId = 0, gameCode = "";
  for (let i = 0; i < 5 && !codeId; i++) {
    gameCode = newGameCode();
    const { data, error } = await supabase.from("access_codes")
      .insert({ code_hash: await sha256(gameCode), name: "@" + username, note: "clipper (clipper dashboard)" })
      .select("id").single();
    if (!error && data) codeId = Number(data.id);
    else if (error && (error as { code?: string }).code !== "23505") throw error;
  }
  if (!codeId) throw new Error("no free game code");
  const now = new Date().toISOString();
  const { error } = await supabase.from("clipper_accounts")
    .update({ game_code: gameCode, game_code_id: codeId, status: "approved", decided_at: now, joined_at: now })
    .eq("username", username).eq("status", "pending");
  if (error) {
    await supabase.from("access_codes").delete().eq("id", codeId);
    throw error;
  }
  return gameCode;
}

// Mails a clipper their code, the dashboard link and the home-screen steps.
// Never fails the caller: the result is kept on the account for the owner to see.
async function sendWelcome(username: string, email: string, code: string): Promise<boolean> {
  const password = (Deno.env.get("MAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
  const user = (Deno.env.get("MAIL_USER") ?? "shredboundofficial@gmail.com").trim();
  let error: string | null = password ? null : "no mail password";
  if (password) {
    try {
      await sendMail({ user, password, fromName: "Shredbound" }, { to: email, subject: WELCOME_SUBJECT, text: welcomeMailText(username, code) });
    } catch (e) {
      error = String((e as Error)?.message ?? e).slice(0, 200);
    }
  }
  await supabase.from("clipper_accounts").update(error ? { welcome_error: error } : { welcome_mailed_at: new Date().toISOString(), welcome_error: null }).eq("username", username);
  return !error;
}

async function setAccess(username: string, active: boolean) {
  const { data: a } = await supabase.from("clipper_accounts").select("game_code_id, removed_at").eq("username", username).maybeSingle();
  if (!a?.game_code_id || a.removed_at) return false;
  const now = new Date().toISOString();
  if (active) {
    must(await supabase.from("access_codes").update({ revoked_at: null, revoked_reason: null }).eq("id", a.game_code_id));
    // The 3 days start again from now.
    must(await supabase.from("clipper_accounts").update({ access_restored_at: now, lost_access_at: null }).eq("username", username));
  } else {
    must(await supabase.from("access_codes").update({ revoked_at: now, revoked_reason: null }).eq("id", a.game_code_id).is("revoked_at", null));
  }
  return true;
}

// After a scan: take the game code of every clipper the rule says lost it.
async function enforce3Days(usernames: string[]) {
  if (!usernames.length) return [];
  const accs = (await accounts()).filter(a => usernames.includes(a.username) && a.game_code_id);
  const ids = accs.map(a => Number(a.game_code_id));
  const [cs, ds, rs, snaps, rows] = await Promise.all([codes(ids), devices(ids), reasons(accs.map(a => a.username)), snapshots(30), postRows(accs.map(a => a.username))]);
  const videos = lastVideos(snaps, rows);
  const lost: string[] = [];
  for (const a of accs) {
    const code = cs.get(Number(a.game_code_id));
    if (!code || code.revoked_at) continue;
    const rule = clipRule({
      now: Date.now(),
      lastVideoAt: videos.get(a.username) ?? null,
      joinedAt: a.joined_at,
      restoredAt: restartedAt(a),
      reasons: rs.filter(r => r.username === a.username),
      lastPlayedAt: ds.get(Number(a.game_code_id))?.lastPlayedAt ?? null,
    });
    if (!rule.revoke) continue;
    const now = new Date().toISOString();
    must(await supabase.from("access_codes").update({ revoked_at: now, revoked_reason: "inactive" }).eq("id", code.id).is("revoked_at", null));
    must(await supabase.from("clipper_accounts").update({ lost_access_at: now }).eq("username", a.username));
    lost.push(a.username);
  }
  return lost;
}

// Sets (or clears, with "") a clipper's Instagram username. The next daily scan reads it.
async function setInstagram(username: string, input: unknown) {
  const typed = String(input ?? "").trim();
  const handle = typed ? cleanInstagram(typed) : null;
  if (typed && !handle) return { ok: false, error: "bad_instagram" };
  const { data } = await supabase.from("clipper_accounts").update({ instagram: handle }).eq("username", username).select("username");
  return data?.length ? { ok: true, instagram: handle } : { ok: false, error: "bad_username" };
}

// ------------------------------------------------------------------ daily scan

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// Instagram sends its embed data only to a phone browser.
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function page(url: string, ua: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html" }, signal: AbortSignal.timeout(20_000) });
    return await r.text();
  } catch {
    return "";
  }
}

const SPECIFIC = new Set(["not_found", "private"]);
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

// Reads every approved clipper (or only some) once and records one snapshot
// each: their TikTok profile and newest videos, each new or due post's own page
// (likes, comments, shares, saves), and their Instagram when given. Only the
// daily scan (enforce) runs the 3-day rule, and only on complete readings: a
// clipper whose TikTok (or, when given, Instagram) could not be read never
// loses their code over it.
const DETAILS_PER_SCAN = 60;
async function runScan({ enforce = true, only = null as string[] | null, source = "server" } = {}) {
  let accs = await accounts();
  if (only) accs = accs.filter(a => only.includes(a.username));
  const names = accs.map(a => a.username);
  const snaps = (names.length ? await snapshots(60, names) : []) as Snap[];
  const known = new Map<string, Map<string, number>>();
  const stored = new Map<string, { detailAt: string | null; postedAt: string | null }>();
  if (names.length) {
    const rows = (must(await supabase.from("clipper_videos").select("platform, video_id, username, value, posted_at, detail_at").in("username", names)) ?? []) as
      { platform: string; video_id: string; username: string; value: number; posted_at: string | null; detail_at: string | null }[];
    for (const r of rows) {
      const k = r.platform + ":" + r.username;
      if (!known.has(k)) known.set(k, new Map());
      known.get(k)!.set(r.video_id, Number(r.value) || 0);
      stored.set(r.platform + ":" + r.video_id, { detailAt: r.detail_at, postedAt: r.posted_at });
    }
  }
  const lastGood = (u: string) => snaps.find(s => s.username === u && s.ok) ?? null;
  const lastIg = (u: string) => snaps.find(s => s.username === u && s.ig_ok) ?? null;

  const takenAt = new Date().toISOString();
  const now = Date.parse(takenAt);
  const rows: Record<string, unknown>[] = [];
  // Three groups, each with the same keys, so an upsert never clears a column
  // another group filled: what every reading sees, then each post's own page.
  const seenRows: Record<string, unknown>[] = [];
  const tiktokDetails: Record<string, unknown>[] = [];
  const instagramDetails: Record<string, unknown>[] = [];
  const results: { username: string; tiktok: string; handle: string; instagram: string | null; details: number }[] = [];
  let budget = DETAILS_PER_SCAN;

  for (const a of accs) {
    const u = a.username, handle = handleOf(a);
    const [profileHtml, embedHtml] = await Promise.all([
      page(`https://www.tiktok.com/@${handle}`, DESKTOP_UA),
      page(`https://www.tiktok.com/embed/@${handle}`, DESKTOP_UA),
    ]);
    const profile = parseTikTokProfile(profileHtml);
    const embed = parseTikTokEmbed(embedHtml, handle);
    const prev = lastGood(u);
    const row: Record<string, unknown> = { username: u, taken_at: takenAt, source };
    let details = 0;
    if (embed.ok) {
      const mine = known.get("tiktok:" + u) ?? new Map();
      const fresh = embed.items.filter((i: { id: string }) => !mine.has(i.id)).length;
      Object.assign(row, {
        ok: true, error: null,
        followers: profile.ok ? profile.followers : embed.followers,
        likes: profile.ok ? profile.likes : embed.likes,
        videos: profile.ok ? profile.videos : prev?.videos != null ? Number(prev.videos) + fresh : embed.items.length,
        views: rollTotal({ prevTotal: prev?.views ?? null, lastReadAt: prev?.taken_at ?? null, known: mine, items: embed.items }),
        last_video_at: newest(embed.items),
      });
      for (const i of embed.items) {
        seenRows.push({ platform: "tiktok", video_id: i.id, username: u, handle, posted_at: i.postedAt, value: i.value, views: i.value, caption: i.caption, updated_at: takenAt, last_seen_at: takenAt });
      }
      // Each new or due post's own page: likes, comments, shares, saves, length.
      const due = embed.items.filter((i: { id: string; postedAt: string | null }) =>
        detailDue(stored.get("tiktok:" + i.id) ?? { detailAt: null, postedAt: i.postedAt }, now)).slice(0, Math.max(0, budget));
      budget -= due.length;
      const pages = await inBatches(due, 3, (i: { id: string }) => page(`https://www.tiktok.com/@${handle}/video/${i.id}`, DESKTOP_UA));
      due.forEach((i: { id: string; value: number; caption: string | null }, k: number) => {
        const d = parseTikTokVideo(pages[k]);
        if (!d.ok || d.id !== i.id) return;
        details++;
        tiktokDetails.push({
          platform: "tiktok", video_id: i.id, username: u,
          views: d.views ?? i.value, likes: d.likes, comments: d.comments, shares: d.shares, saves: d.saves,
          duration_s: d.durationS, kind: d.kind, detail_at: takenAt,
        });
      });
    } else {
      const error = String((SPECIFIC.has(String(profile.error)) ? profile.error : embed.error) ?? "no_data");
      Object.assign(row, { ok: false, error: SCAN_ERRORS.has(error) ? error : "no_data" });
    }

    if (a.instagram) {
      const ig = parseInstagramEmbed(await page(`https://www.instagram.com/${a.instagram}/embed/`, PHONE_UA), a.instagram);
      if (ig.ok) {
        const prevIg = lastIg(u);
        const mine = known.get("instagram:" + u) ?? new Map();
        Object.assign(row, {
          ig_ok: true, ig_error: null,
          ig_followers: ig.followers, ig_posts: ig.posts,
          ig_likes: rollTotal({ prevTotal: prevIg?.ig_likes ?? null, lastReadAt: prevIg?.taken_at ?? null, known: mine, items: ig.items }),
          ig_last_post_at: newest(ig.items),
        });
        for (const i of ig.items) {
          seenRows.push({ platform: "instagram", video_id: i.id, username: u, handle: a.instagram, posted_at: i.postedAt, value: i.value, views: null, caption: i.caption, updated_at: takenAt, last_seen_at: takenAt });
          instagramDetails.push({ platform: "instagram", video_id: i.id, username: u, likes: i.value, comments: i.comments, kind: i.kind, detail_at: takenAt });
        }
      } else {
        Object.assign(row, { ig_ok: false, ig_error: ig.error });
      }
    }
    rows.push(row);
    results.push({ username: u, handle, tiktok: row.ok ? "ok" : String(row.error), instagram: a.instagram ? (row.ig_ok ? "ok" : String(row.ig_error)) : null, details });
    if (accs.length > 1) await pause(700 + Math.random() * 800);
  }

  if (rows.length) must(await supabase.from("clipper_snapshots").insert(rows));
  for (const group of [seenRows, tiktokDetails, instagramDetails]) {
    if (group.length) must(await supabase.from("clipper_videos").upsert(group, { onConflict: "platform,video_id" }));
  }
  // The readings between the daily ones are kept for 2 days; the daily ones for good.
  await supabase.from("clipper_snapshots").delete().in("source", ["refresh", "manual"]).lt("taken_at", new Date(now - 2 * DAY).toISOString());
  const complete = rows.filter(r => r.ok && (r.ig_ok === undefined || r.ig_ok)).map(r => String(r.username));
  const lostAccess = enforce ? await enforce3Days(complete) : [];
  return { scanned: rows.length, read: rows.filter(r => r.ok).length, enforced: enforce, lostAccess, results };
}

// Runs fn over the list, `size` at a time, and keeps the order.
async function inBatches<T, R>(list: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += size) out.push(...await Promise.all(list.slice(i, i + size).map(fn)));
  return out;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "bad_request" }, 405);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(req, { ok: false, error: "bad_request" }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json(req, { ok: false, error: "bad_request" }, 400); }
  const action = String(body.action || "");
  try {
    if (action === "join") return await join(req, body);

    if (action.startsWith("admin.")) {
      if (await limited(req)) return json(req, { ok: false, error: "limited" }, 429);
      if (!(await isAdmin(req))) { await fail(req); return json(req, { ok: false, error: "unauthorized" }, 401); }
      if (action === "admin.list") {
        return json(req, { ok: true, usernames: (await accounts()).map(a => a.username) });
      }
      if (action === "admin.state") return json(req, await state({ role: "owner" }));
      if (action === "admin.profile") {
        const username = cleanUsername(body.username);
        const p = username ? await profile(username, true) : null;
        return p ? json(req, { ok: true, profile: p }) : json(req, { ok: false, error: "not_found" }, 404);
      }
      if (action === "admin.record") {
        const list = Array.isArray(body.snapshots) ? body.snapshots as Record<string, unknown>[] : [];
        const known = new Set((await accounts()).map(a => a.username));
        const rows = [];
        for (const s of list) {
          const username = cleanUsername(s?.username);
          if (!username || !known.has(username)) continue;
          const ok = s.ok !== false;
          rows.push({
            username, ok,
            error: ok ? null : (SCAN_ERRORS.has(String(s.error)) ? String(s.error) : "no_data"),
            taken_at: when(s.takenAt) ?? new Date().toISOString(),
            followers: ok ? count(s.followers) : null,
            likes: ok ? count(s.likes) : null,
            videos: ok ? count(s.videos) : null,
            views: ok ? count(s.views) : null,
            last_video_at: ok ? when(s.lastVideoAt) : null,
          });
        }
        if (rows.length) must(await supabase.from("clipper_snapshots").insert(rows));
        // The rule runs only on fresh readings: a failed scan never takes a code.
        const lost = await enforce3Days(rows.filter(r => r.ok && !body.noEnforce).map(r => r.username));
        return json(req, { ok: true, recorded: rows.length, skipped: list.length - rows.length, lostAccess: lost });
      }
      if (action === "admin.remove") {
        const username = cleanUsername(body.username);
        if (!username) return json(req, { ok: false, error: "bad_username" });
        await setAccess(username, false);
        must(await supabase.from("clipper_accounts").update({ removed_at: new Date().toISOString() }).eq("username", username));
        return json(req, { ok: true });
      }
      return json(req, { ok: false, error: "bad_request" }, 400);
    }

    if (action === "cron.scan") {
      const cronSecret = req.headers.get("x-cron-secret") || "";
      const stored = String((await getConfig() as unknown as Record<string, unknown>).scan_cron_secret ?? "");
      const byCron = !!cronSecret && !!stored && same(await sha256(cronSecret), await sha256(stored));
      if (!byCron && !(await isAdmin(req))) { await fail(req); return json(req, { ok: false, error: "unauthorized" }, 401); }
      // The daily scan applies the 3-day rule; the 2-hourly one ({enforce:false}) only reads.
      const enforce = body.enforce !== false;
      return json(req, { ok: true, ...(await runScan({ enforce, source: enforce ? "server" : "refresh" })) });
    }

    const w = await who(body.token);
    if (!w) return json(req, { ok: false, error: "invalid" });

    if (action === "state") {
      const s = await state(w);
      return s ? json(req, s) : json(req, { ok: false, error: "invalid" });
    }

    if (action === "reason" || action === "reason.end") {
      if (w.role !== "clipper") return json(req, { ok: false, error: "forbidden" }, 403);
      const now = Date.now();
      const open = (await reasons([w.username])).filter(r => !r.ended_at && Date.parse(r.until) > now);
      for (const r of open) must(await supabase.from("clipper_reasons").update({ ended_at: new Date(now).toISOString(), ended_by: "clipper" }).eq("id", r.id));
      if (action === "reason") {
        const reason = text(body.reason, 500);
        const until = when(body.until);
        if (reason.length < 3 || !until || Date.parse(until) <= now || Date.parse(until) > now + MAX_REASON_DAYS * DAY) {
          return json(req, { ok: false, error: "bad_request" }, 400);
        }
        must(await supabase.from("clipper_reasons").insert({ username: w.username, reason, until }));
      }
      return json(req, { ok: true });
    }

    if (action === "instagram") {
      if (w.role !== "clipper") return json(req, { ok: false, error: "forbidden" }, 403);
      return json(req, await setInstagram(w.username, body.instagram));
    }

    if (action === "profile") {
      const username = w.role === "owner" ? cleanUsername(body.username) : w.username;
      const p = username ? await profile(username, w.role === "owner") : null;
      return p ? json(req, { ok: true, profile: p }) : json(req, { ok: false, error: "not_found" }, 404);
    }

    if (action === "scan.me") {
      // "I just posted": read their TikTok and Instagram now, at most every 10
      // minutes. It never applies the rule; only the daily scan does.
      if (w.role !== "clipper") return json(req, { ok: false, error: "forbidden" }, 403);
      const { data: last } = await supabase.from("clipper_snapshots").select("taken_at").eq("username", w.username).order("taken_at", { ascending: false }).limit(1).maybeSingle();
      const recent = last && Date.now() - Date.parse(last.taken_at) < 10 * 60_000;
      const scan = recent ? null : await runScan({ only: [w.username], enforce: false, source: "manual" });
      return json(req, { ok: true, skipped: !!recent, result: scan?.results?.[0] ?? null, profile: await profile(w.username, false) });
    }

    if (action.startsWith("owner.")) {
      if (w.role !== "owner") return json(req, { ok: false, error: "forbidden" }, 403);
      if (action === "owner.instagram") {
        const username = cleanUsername(body.username);
        if (!username) return json(req, { ok: false, error: "bad_username" });
        return json(req, await setInstagram(username, body.instagram));
      }
      if (action === "owner.scan") {
        const username = cleanUsername(body.username);
        if (!username) return json(req, { ok: false, error: "bad_username" });
        const scan = await runScan({ only: [username], enforce: false, source: "manual" });
        if (!scan.scanned) return json(req, { ok: false, error: "not_found" }, 404);
        return json(req, { ok: true, result: scan.results[0], profile: await profile(username, true) });
      }
      if (action === "owner.tiktok") {
        // The TikTok handle to read, when the clipper joined with a name that is not
        // their TikTok username. Their 3 days start again: until now the dashboard
        // could not show them when their next video was due.
        const username = cleanUsername(body.username);
        const typed = String(body.tiktok ?? "").trim();
        const handle = typed ? cleanUsername(typed) : null;
        if (!username || (typed && !handle)) return json(req, { ok: false, error: "bad_username" });
        const { data } = await supabase.from("clipper_accounts")
          .update({ tiktok: handle && handle !== username ? handle : null, tiktok_set_at: new Date().toISOString() })
          .eq("username", username).eq("status", "approved").select("username");
        if (!data?.length) return json(req, { ok: false, error: "not_found" }, 404);
        const scan = await runScan({ only: [username], enforce: false, source: "manual" });
        return json(req, { ok: true, result: scan.results[0] ?? null, profile: await profile(username, true) });
      }
      if (action === "owner.access" || action === "owner.remove") {
        const username = cleanUsername(body.username);
        if (!username) return json(req, { ok: false, error: "bad_username" });
        if (action === "owner.remove") {
          await setAccess(username, false);
          must(await supabase.from("clipper_accounts").update({ removed_at: new Date().toISOString() }).eq("username", username));
        } else if (!(await setAccess(username, body.active === true))) {
          return json(req, { ok: false, error: "not_found" }, 404);
        }
        return json(req, { ok: true });
      }
      if (action === "owner.code") {
        // Turn a playtester's or buyer's code on or off. Clipper codes go through owner.access.
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return json(req, { ok: false, error: "bad_request" }, 400);
        const { data: mine } = await supabase.from("clipper_accounts").select("username").eq("game_code_id", id).maybeSingle();
        if (mine) return json(req, { ok: false, error: "bad_request" }, 400);
        must(await supabase.from("access_codes").update({ revoked_at: body.active === true ? null : new Date().toISOString(), revoked_reason: null }).eq("id", id));
        return json(req, { ok: true });
      }
      if (action === "owner.approve" || action === "owner.reject") {
        const username = cleanUsername(body.username);
        const { data: a } = await supabase.from("clipper_accounts").select("username, email, status").eq("username", username ?? "").maybeSingle();
        if (!a || a.status !== "pending") return json(req, { ok: false, error: "not_found" }, 404);
        if (action === "owner.reject") {
          must(await supabase.from("clipper_accounts").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("username", a.username));
          return json(req, { ok: true });
        }
        const code = await makeGameCode(a.username);
        const mailed = a.email ? await sendWelcome(a.username, a.email, code) : false;
        return json(req, { ok: true, mailed });
      }
      if (action === "owner.welcome") {
        const username = cleanUsername(body.username);
        const { data: a } = await supabase.from("clipper_accounts").select("username, email, game_code").eq("username", username ?? "").maybeSingle();
        if (!a?.email || !a.game_code) return json(req, { ok: false, error: "not_found" }, 404);
        return json(req, { ok: await sendWelcome(a.username, a.email, a.game_code) });
      }
      if (action === "owner.reason.end") {
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return json(req, { ok: false, error: "bad_request" }, 400);
        must(await supabase.from("clipper_reasons").update({ ended_at: new Date().toISOString(), ended_by: "owner" }).eq("id", id).is("ended_at", null));
        return json(req, { ok: true });
      }
      if (action === "owner.event.save") {
        const title = text(body.title, 80);
        const endsAt = when(body.endsAt);
        const startsAt = body.startsAt ? when(body.startsAt) : null;
        if (!title || !endsAt || (body.startsAt && !startsAt) || (startsAt && startsAt >= endsAt)) {
          return json(req, { ok: false, error: "bad_request" }, 400);
        }
        const row = { title, details: text(body.details, 2000), prize: text(body.prize, 120), starts_at: startsAt, ends_at: endsAt, updated_at: new Date().toISOString() };
        const id = Number(body.id);
        if (Number.isSafeInteger(id) && id > 0) must(await supabase.from("clipper_events").update(row).eq("id", id));
        else must(await supabase.from("clipper_events").insert(row));
        return json(req, { ok: true });
      }
      if (action === "owner.event.delete") {
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return json(req, { ok: false, error: "bad_request" }, 400);
        must(await supabase.from("clipper_events").delete().eq("id", id));
        return json(req, { ok: true });
      }
    }
    return json(req, { ok: false, error: "bad_request" }, 400);
  } catch (e) {
    console.error(action, e);
    return json(req, { ok: false, error: "server" }, 500);
  }
});

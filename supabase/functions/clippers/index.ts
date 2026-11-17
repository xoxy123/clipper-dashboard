// Shredbound clipper leaderboard. Clippers join on the dashboard (GitHub Pages)
// with the shared join code and their TikTok username; a weekly scan records a
// snapshot of each public profile; everyone who joined sees the top-3 boards
// and their own account.
//
// Deployed as the "clippers" edge function (verify_jwt on): the dashboard sends
// the project's anon key. The tables (supabase/schema.sql) are closed to
// clients; this function is the only way in, with the service role.
//
// The join code and the admin secret are stored only as sha256 hashes in
// clipper_config. A join hands back a token "v1.<username>.<HMAC>" signed with
// clipper_config.token_secret; the dashboard keeps it in localStorage.
//
// POST JSON {action, ...}:
//   join  {code, username}   -> {ok, token, username}
//   board {token}            -> {ok, ...boardFor()}
//   refusals: {ok:false, error:"bad_code"|"bad_username"|"invalid"|"limited"}
//   admin.list                       (x-admin-secret) -> {ok, usernames}
//   admin.record {snapshots:[...]}   (x-admin-secret) -> {ok, recorded}
//   admin.remove {username}          (x-admin-secret) -> {ok}
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { boardFor, cleanUsername, summarize } from "./board.js";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DASHBOARD_ORIGIN = "https://xoxy123.github.io";
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const MAX_BODY_BYTES = 200_000;
const FAILS_PER_IP = 15;
const FAIL_WINDOW_MS = 10 * 60_000;
const ERRORS = new Set(["not_found", "private", "no_data", "blocked"]);

interface Config { join_code_sha256: string; admin_secret_sha256: string; token_secret: string }
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
async function makeToken(username: string) {
  return `v1.${username}.${await hmac((await getConfig()).token_secret, "clipper:" + username)}`;
}
async function readToken(token: unknown) {
  const m = String(token ?? "").match(/^v1\.([a-z0-9_.]{2,24})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  return same(await hmac((await getConfig()).token_secret, "clipper:" + m[1]), m[2]) ? m[1] : null;
}

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allow = origin === DASHBOARD_ORIGIN || LOCAL_ORIGIN.test(origin) ? origin : DASHBOARD_ORIGIN;
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
  // Old rows are never needed again.
  await supabase.from("clipper_failures").delete().lt("at", new Date(Date.now() - 24 * 3600_000).toISOString());
}

async function isAdmin(req: Request) {
  const secret = req.headers.get("x-admin-secret") || "";
  return !!secret && same(await sha256(secret), (await getConfig()).admin_secret_sha256);
}

const count = (v: unknown) => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n);
};

async function loadSummary() {
  const { data: accounts, error: e1 } = await supabase.from("clipper_accounts").select("username, joined_at").is("removed_at", null);
  if (e1) throw e1;
  const { data: snaps, error: e2 } = await supabase.from("clipper_snapshots")
    .select("username, taken_at, ok, error, followers, likes, videos, views")
    .gte("taken_at", new Date(Date.now() - 120 * 86400_000).toISOString())
    .order("taken_at", { ascending: false }).limit(10000);
  if (e2) throw e2;
  return summarize(accounts ?? [], snaps ?? []);
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
    if (action === "join") {
      if (await limited(req)) return json(req, { ok: false, error: "limited" }, 429);
      const code = String(body.code ?? "").trim();
      if (!code || !same(await sha256(code), (await getConfig()).join_code_sha256)) {
        await fail(req);
        return json(req, { ok: false, error: "bad_code" });
      }
      const username = cleanUsername(body.username);
      if (!username) return json(req, { ok: false, error: "bad_username" });
      const { error } = await supabase.from("clipper_accounts")
        .upsert({ username, removed_at: null }, { onConflict: "username", ignoreDuplicates: false });
      if (error) throw error;
      return json(req, { ok: true, username, token: await makeToken(username) });
    }
    if (action === "board") {
      const username = await readToken(body.token);
      if (!username) return json(req, { ok: false, error: "invalid" });
      const summary = await loadSummary();
      if (!summary.rows.some(r => r.username === username)) return json(req, { ok: false, error: "invalid" });
      return json(req, { ok: true, ...boardFor(username, summary) });
    }
    if (action.startsWith("admin.")) {
      if (await limited(req)) return json(req, { ok: false, error: "limited" }, 429);
      if (!(await isAdmin(req))) { await fail(req); return json(req, { ok: false, error: "unauthorized" }, 401); }
      if (action === "admin.list") {
        const { data, error } = await supabase.from("clipper_accounts").select("username").is("removed_at", null).order("username");
        if (error) throw error;
        return json(req, { ok: true, usernames: (data ?? []).map(r => r.username) });
      }
      if (action === "admin.record") {
        const list = Array.isArray(body.snapshots) ? body.snapshots : [];
        const rows = [];
        for (const s of list as Record<string, unknown>[]) {
          const username = cleanUsername(s?.username);
          if (!username) continue;
          const ok = s.ok !== false;
          const error = ok ? null : (ERRORS.has(String(s.error)) ? String(s.error) : "no_data");
          rows.push({
            username, ok, error,
            taken_at: typeof s.takenAt === "string" && !Number.isNaN(Date.parse(s.takenAt)) ? new Date(s.takenAt).toISOString() : new Date().toISOString(),
            followers: ok ? count(s.followers) : null,
            likes: ok ? count(s.likes) : null,
            videos: ok ? count(s.videos) : null,
            views: ok ? count(s.views) : null,
          });
        }
        if (!rows.length) return json(req, { ok: false, error: "bad_request" }, 400);
        const { data: known } = await supabase.from("clipper_accounts").select("username").in("username", rows.map(r => r.username));
        const ok = new Set((known ?? []).map(r => r.username));
        const keep = rows.filter(r => ok.has(r.username));
        if (keep.length) { const { error } = await supabase.from("clipper_snapshots").insert(keep); if (error) throw error; }
        return json(req, { ok: true, recorded: keep.length, skipped: rows.length - keep.length });
      }
      if (action === "admin.remove") {
        const username = cleanUsername(body.username);
        if (!username) return json(req, { ok: false, error: "bad_username" });
        const { error } = await supabase.from("clipper_accounts").update({ removed_at: new Date().toISOString() }).eq("username", username);
        if (error) throw error;
        return json(req, { ok: true });
      }
    }
    return json(req, { ok: false, error: "bad_request" }, 400);
  } catch (e) {
    console.error(action, e);
    return json(req, { ok: false, error: "server" }, 500);
  }
});

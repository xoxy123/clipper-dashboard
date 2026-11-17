#!/usr/bin/env node
// Admin calls to the "clippers" edge function for the weekly scan.
//   node scripts/clippers.mjs list                 -> prints usernames, one per line
//   node scripts/clippers.mjs record < snaps.json  -> records snapshots (JSON array)
//   node scripts/clippers.mjs remove <username>
// The admin secret is read from ~/.config/shredbound/clipper-admin-secret and
// sent only in the x-admin-secret header. It is never printed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { supabaseUrl, supabaseAnonKey } from '../src/config.js';

const secret = readFileSync(homedir() + '/.config/shredbound/clipper-admin-secret', 'utf8').trim();
const [cmd, arg] = process.argv.slice(2);
async function call(action, payload = {}) {
  const res = await fetch(supabaseUrl + '/functions/v1/clippers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + supabaseAnonKey, apikey: supabaseAnonKey, 'x-admin-secret': secret },
    body: JSON.stringify({ ...payload, action }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) { console.error(`${action} failed: HTTP ${res.status} ${body?.error || ''}`); process.exit(1); }
  return body;
}
if (cmd === 'list') console.log((await call('admin.list')).usernames.join('\n'));
else if (cmd === 'record') {
  const snapshots = JSON.parse(readFileSync(0, 'utf8'));
  const r = await call('admin.record', { snapshots: Array.isArray(snapshots) ? snapshots : [snapshots] });
  console.log(`recorded ${r.recorded}, skipped ${r.skipped}`);
} else if (cmd === 'remove' && arg) { await call('admin.remove', { username: arg }); console.log('removed ' + arg); }
else { console.error('usage: list | record < snapshots.json | remove <username>'); process.exit(2); }

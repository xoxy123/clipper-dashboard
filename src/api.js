import { supabaseUrl, supabaseAnonKey } from './config.js';
const url = supabaseUrl.replace(/\/$/, '') + '/functions/v1/clippers';
const text = {
  bad_code: 'Wrong code.',
  pending: 'You already applied. You get a mail when you are approved.',
  bad_email: 'That email does not look right.',
  bad_username: 'Type your TikTok username (letters, numbers, _ and . only).',
  taken: 'That TikTok username already joined. Log in with your game code instead (or DM willll0838 on Discord).',
  removed: 'This account was not approved or was removed. DM willll0838 on Discord.',
  invalid: 'Please log in again.',
  forbidden: 'Only the owner can do that.',
  limited: 'Too many tries. Wait 10 minutes.',
  bad_request: 'Check the fields and try again.',
  not_found: 'Not found. Refresh the page.',
  server: 'Server error. Try again.',
};
export class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
export async function call(action, payload = {}, fetcher = fetch) {
  let res;
  try { res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + supabaseAnonKey, apikey: supabaseAnonKey }, body: JSON.stringify({ ...payload, action }) }); }
  catch { throw new ApiError('offline', 'No connection. Try again.'); }
  let body = null; try { body = await res.json(); } catch {}
  if (!res.ok || !body?.ok) { const code = body?.error || 'server'; throw new ApiError(code, text[code] || text.server); }
  return body;
}

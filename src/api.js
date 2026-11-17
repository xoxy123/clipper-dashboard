import { supabaseUrl, supabaseAnonKey } from './config.js';
const url = supabaseUrl.replace(/\/$/, '') + '/functions/v1/clippers';
const text = { bad_code: 'Wrong clipper code.', bad_username: 'That is not a TikTok username. Letters, numbers, _ and . only.', invalid: 'Please join again.', limited: 'Too many tries. Wait 10 minutes.', server: 'Server error. Try again.' };
export class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
export async function call(action, payload = {}, fetcher = fetch) {
  let res;
  try { res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + supabaseAnonKey, apikey: supabaseAnonKey }, body: JSON.stringify({ ...payload, action }) }); }
  catch { throw new ApiError('offline', 'No connection. Try again.'); }
  let body = null; try { body = await res.json(); } catch {}
  if (!res.ok || !body?.ok) { const code = body?.error || 'server'; throw new ApiError(code, text[code] || text.server); }
  return body;
}

import { call } from './api.js';
import { boards, myAccount, joinForm, date } from './view.js';
const main = document.getElementById('main'), who = document.getElementById('who'), logout = document.getElementById('logout'), scan = document.getElementById('scan');
const KEY = 'clippers.token';
const store = { get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }, set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} } };
let token = store.get();

function showJoin(error = '') {
  who.textContent = ''; logout.hidden = true; scan.textContent = '';
  main.innerHTML = joinForm(error);
  const form = document.getElementById('join');
  form.code.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button'), err = document.getElementById('join-error');
    btn.disabled = true; err.textContent = '';
    try {
      const r = await call('join', { code: form.code.value, username: form.username.value });
      token = r.token; store.set(token); await load();
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  });
}

async function load() {
  if (!token) return showJoin();
  try {
    const b = await call('board', { token });
    who.textContent = '@' + b.me.username; logout.hidden = false;
    scan.textContent = b.lastScan ? 'Last scan ' + date(b.lastScan) : 'No scan yet';
    main.innerHTML = boards(b) + myAccount(b.me);
  } catch (x) {
    if (x.code === 'invalid') { token = ''; store.set(''); return showJoin(); }
    main.innerHTML = `<p class="error">${x.message}</p><p><button class="primary" id="retry">Try again</button></p>`;
    document.getElementById('retry').onclick = load;
  }
}
logout.onclick = () => { token = ''; store.set(''); showJoin(); };
load();

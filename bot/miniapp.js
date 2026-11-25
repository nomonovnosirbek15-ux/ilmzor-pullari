
// ---- 📱 Telegram Mini App: /app (oʻquvchi sahifasi Telegram ichida) ----
const APP_URL = 'https://ilmzor-test-bot.nomonovnosirbek15.workers.dev';
const APP_BOOT = `<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script>
(function(){
  var W=window.Telegram&&Telegram.WebApp, ID=W&&W.initData||'';
  window.__TGI=ID;
  try{W.ready();W.expand();W.setHeaderColor('#0e223a');W.setBackgroundColor('#f2f5f8');}catch(e){}
  var code='';
  if(ID){try{var x=new XMLHttpRequest();x.open('POST','/app/auth',false);x.setRequestHeader('content-type','application/json');x.send(JSON.stringify({initData:ID}));var j=JSON.parse(x.responseText||'{}');code=j.code||'';}catch(e){}}
  try{code?localStorage.setItem('ilmzor_code',code):localStorage.removeItem('ilmzor_code');}catch(e){}
  var of=window.fetch.bind(window);
  window.fetch=function(u,o){o=o||{};if(typeof u==='string'&&u.indexOf('/api/s/')===0){o.headers=Object.assign({},o.headers||{},{'x-tg-init':ID});}return of(u,o);};
  function say(m){try{W.showAlert(m);}catch(_){alert(m);}}
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';
    if(h.indexOf('/api/s/card.png')>=0){e.preventDefault();var p=(h.match(/[?&]p=(\\w+)/)||[])[1]||'month';
      of('/app/card',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:ID,p:p})}).then(function(r){return r.json();}).then(function(j){
        if(j.ok){try{W.HapticFeedback.notificationOccurred('success');}catch(_){}say('🖼 Karta bot chatiga yuborildi. Ota-onangizga ham yuboring!');}else say(j.error||'Xatolik');}).catch(function(){say('Internetni tekshiring');});return;}
    if(W&&/^https:\\/\\/t\\.me\\//.test(a.href)){e.preventDefault();W.openTelegramLink(a.href);}
  },true);
})();
</script>`;
const appJson = (o, s) => new Response(JSON.stringify(o), {status: s || 200, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
async function appRaw(env, path, init) { return env.BAHO ? env.BAHO.fetch('https://baho' + path, init) : fetch(BAHO_URL + path, init); }
async function appDb(env) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS appcfg (k TEXT PRIMARY KEY, v TEXT)').run(); await vzDb(env); }
async function tgInitUser(env, initData) {
  if (!initData || !env.BOT_TOKEN) return null;
  const p = new URLSearchParams(String(initData)); const hash = p.get('hash'); if (!hash) return null; p.delete('hash');
  const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const enc = new TextEncoder(), H = {name: 'HMAC', hash: 'SHA-256'};
  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), H, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', k1, enc.encode(cleanToken(env.BOT_TOKEN)));
  const k2 = await crypto.subtle.importKey('raw', secret, H, false, ['sign']);
  const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', k2, enc.encode(dcs)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
  try { const u = JSON.parse(p.get('user') || 'null'); return u && u.id ? u : null; } catch (e) { return null; }
}
async function appFails(env, uid, add) {
  const k = 'af:' + uid; const r = await env.DB.prepare('SELECT v FROM appcfg WHERE k = ?').bind(k).first();
  let o = r ? JSON.parse(r.v) : {n: 0, t: Date.now()}; if (Date.now() - o.t > 3600000) o = {n: 0, t: Date.now()};
  if (add) { o.n++; await env.DB.prepare('INSERT OR REPLACE INTO appcfg(k, v) VALUES(?, ?)').bind(k, JSON.stringify(o)).run(); }
  return o.n;
}
async function appLinked(env, uid) { const r = await env.DB.prepare('SELECT code FROM baho_link WHERE uid = ?').bind(String(uid)).first(); return r ? r.code : ''; }
async function miniApp(request, url, env) {
  const p = url.pathname, M = request.method;
  if (M === 'GET' && (p === '/app' || p === '/app/')) {
    const r = await appRaw(env, '/men');
    const h = (await r.text()).replace('<head>', '<head>\n' + APP_BOOT);
    return new Response(h, {headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}});
  }
  if (M === 'POST' && (p === '/app/auth' || p === '/app/card')) {
    const b = await request.json().catch(() => ({}));
    const user = await tgInitUser(env, b.initData); if (!user) return appJson({error: 'Ilovani botdan qayta oching'}, 403);
    await appDb(env); const code = await appLinked(env, user.id);
    if (p === '/app/auth') return appJson({code});
    if (!code) return appJson({error: 'Avval kodingiz bilan kiring'}, 404);
    const per = b.p === 'week' ? 'week' : b.p === 'oylik' ? 'oylik' : 'month';
    await vzCard(env, user.id, code, per); return appJson({ok: true});
  }
  if (M === 'GET' && (p.startsWith('/fonts/') || p.startsWith('/brand/') || p === '/reyting' || p === '/reyting/' || p.startsWith('/api/public/'))) {
    const r = await appRaw(env, p + url.search); return new Response(r.body, {status: r.status, headers: r.headers});
  }
  if ((M === 'GET' || M === 'POST') && p.startsWith('/api/s/')) {
    const user = await tgInitUser(env, request.headers.get('x-tg-init'));
    if (!user) return appJson({error: 'Ilovani botdan qayta oching'}, 403);
    await appDb(env);
    let code = await appLinked(env, user.id), fresh = false;
    if (p === '/api/s/me' && code && !(await bahoMe(env, code).catch(() => true))) { await env.DB.prepare('DELETE FROM baho_link WHERE uid = ?').bind(String(user.id)).run(); code = ''; }
    if (!code) { // hali bogʻlanmagan: oʻquvchi kodini qoʻlda kiritadi
      if ((await appFails(env, user.id, false)) >= 6) return appJson({error: 'Juda koʻp urinish. 1 soatdan keyin qayta urinib koʻring yoki botda «📝 Vazifalarim» ga ism-familiyangizni yozing.'}, 429);
      code = String(request.headers.get('x-code') || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); fresh = true;
      if (code.length !== 6) return appJson({error: 'Kod notoʻgʻri'}, 404);
    }
    const h = new Headers({'x-code': code}); const ct = request.headers.get('content-type'); if (ct) h.set('content-type', ct);
    const q = new URLSearchParams(url.search); q.delete('code'); const qs = q.toString();
    const r = await appRaw(env, p + (qs ? '?' + qs : ''), {method: M, headers: h, body: M === 'POST' ? await request.arrayBuffer() : undefined});
    if (fresh) {
      if (r.status === 200) await env.DB.prepare('INSERT OR REPLACE INTO baho_link(uid, code, created) VALUES(?, ?, ?)').bind(String(user.id), code, Date.now()).run();
      else if (r.status === 404) await appFails(env, user.id, true);
    }
    return new Response(r.body, {status: r.status, headers: r.headers});
  }
  return null;
}
async function appMenu(env) {
  await appDb(env);
  const r = await env.DB.prepare("SELECT v FROM appcfg WHERE k = 'menu'").first(); if (r && r.v === 'v1') return;
  const t = await tg(env, 'setChatMenuButton', {menu_button: {type: 'web_app', text: '📱 Ilova', web_app: {url: APP_URL + '/app'}}});
  if (t && t.ok) await env.DB.prepare("INSERT OR REPLACE INTO appcfg(k, v) VALUES('menu', 'v1')").run();
}

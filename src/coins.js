/* ================= 💰 Ilmzor puli ================= */
const isSeller=()=>!!(window.__ME&&window.__ME.role==='seller');
S.coin={data:null,loading:false,tab:null,sel:new Set(),reason:'',amount:'',hist:null,q:''};
async function coinLoad(){S.coin.loading=true;try{const [d,b]=await Promise.all([window.__api('GET','/api/coins'),window.__api('GET','/api/budgets').catch(()=>null)]);S.coin.data=d;S.coin.budg=b;}catch(e){toast(e.message);}S.coin.loading=false;if(S.view==='coin')render();}
document.addEventListener('me-ready',()=>{
  const nav=document.getElementById('nav');const a=document.createElement('a');a.href='#coin';a.dataset.v='coin';a.textContent='💰 Ilmzor puli';
  const ref=nav.querySelector('[data-v="oquvchilar"]');ref&&ref.nextSibling?nav.insertBefore(a,ref.nextSibling):nav.appendChild(a);
  if(isSeller()){[...nav.querySelectorAll('a')].forEach(x=>{if(x.dataset.v!=='coin')x.style.display='none';});a.textContent='💰 Ilmzor puli';if(location.hash!=='#coin')location.hash='#coin';}
});
const cfmt=n=>(n>0?'+':'')+n;
const coinCol=n=>n>0?'var(--good)':n<0?'var(--crit)':'var(--muted)';
const WHO=id=>{const w=S.coin&&S.coin.data&&S.coin.data.who&&S.coin.data.who[id];return w?w.name:'';};
const BYL=r=>{if(r.kind==='auto')return '';const n=WHO(r.by_user);return n?` · ${r.kind==='sotuv'?'🛍 sotdi':'👤'}: <b>${esc(n)}</b>`:'';};
const KIND={auto:'⚙️',bonus:'🎁',jarima:'⚠️',sotuv:'🛍',tuzatish:'✏️'};
function coinDate(ts){const d=new Date(ts);return `${d.getDate()}-${MONTHS[d.getMonth()].slice(0,3)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function viewCoins(){
  const D=S.coin.data;
  if(!D){if(!S.coin.loading)coinLoad();return '<div class="empty">Yuklanmoqda…</div>';}
  const seller=isSeller(),admin=isAdmin();
  const tabs=[...(seller?[]:[['berish','💰 Pul berish']]),['dokon','🛍 Do‘kon'],...((seller||admin)?[['limit','👩‍🏫 Ustozlarga limit']]:[]),...(seller?[['balans','🏆 Balanslar']]:[]),...(admin?[['qoida','⚙️ Qoidalar']]:[])];
  if(!S.coin.tab||!tabs.some(t=>t[0]===S.coin.tab))S.coin.tab=tabs[0][0];
  const studs=activeStudents().filter(x=>inGroup(x)).sort((a,b)=>(a.group||'').localeCompare(b.group||'')||a.name.localeCompare(b.name));
  const bal=id=>D.balances[id]||0;
  const ms=D.monthStart;const inScope=new Set(studs.map(x=>x.id));
  const mrows=D.rows.filter(r=>r.ts>=ms&&inScope.has(r.student_id));
  const given=mrows.filter(r=>r.amount>0).reduce((a,r)=>a+r.amount,0),spent=-mrows.filter(r=>r.kind==='sotuv').reduce((a,r)=>a+r.amount,0);
  const totalBal=studs.reduce((a,x)=>a+bal(x.id),0);const top=studs.slice().sort((a,b)=>bal(b.id)-bal(a.id))[0];
  let h=`<div class="strip">
    <div class="sitem"><div class="sl">💰 Bu oy berilgan</div><div class="sv" style="color:var(--good)">${given}</div><div class="ss">pul · ${mrows.filter(r=>r.amount>0).length} marta</div></div>
    <div class="sitem"><div class="sl">🏦 O‘quvchilardagi jami</div><div class="sv">${totalBal}</div><div class="ss">${studs.length} o‘quvchi${S.group!=='all'?' · '+esc(S.group):''}</div></div>
    <div class="sitem"><div class="sl">🛍 Bu oy sotildi</div><div class="sv">${spent}</div><div class="ss">pullik mahsulot</div></div>
    <div class="sitem"><div class="sl">🥇 Eng ko‘p puli bor</div><div class="sv" style="font-size:22px">${top&&bal(top.id)>0?esc(top.name.split(' ').slice(0,2).join(' ')):'—'}</div><div class="ss">${top&&bal(top.id)>0?bal(top.id)+' pul':''}</div></div></div>
  <div class="seg" style="margin-bottom:14px">${tabs.map(t=>`<button class="${S.coin.tab===t[0]?'on':''}" data-ca="tab" data-v="${t[0]}">${t[1]}</button>`).join('')}</div>`;
  if(S.coin.tab==='berish') h+=coinGiveView(D,studs,bal);
  else if(S.coin.tab==='dokon') h+=coinShopView(D,studs,bal);
  else if(S.coin.tab==='balans') h+=coinBalanceView(D,studs,bal);
  else if(S.coin.tab==='limit') h+=coinLimitView();
  else h+=coinRulesView(D);
  return h;
}
function coinGiveView(D,studs,bal){
  const R=D.settings;const sel=S.coin.sel;
  const byG={};studs.forEach(x=>(byG[x.group||'Guruhsiz']=byG[x.group||'Guruhsiz']||[]).push(x));
  const ranked=studs.slice().sort((a,b)=>bal(b.id)-bal(a.id));
  const ms=D.monthStart;const monthOf=id=>D.rows.filter(r=>r.student_id===id&&r.ts>=ms&&r.amount>0).reduce((a,r)=>a+r.amount,0);
  const recent=D.rows.filter(r=>studs.some(x=>x.id===r.student_id)).slice(0,25);
  return `<div class="grid2">
   <div class="card"><h2>🎁 Ilmzor puli berish</h2>
    <p class="muted" style="font-size:12.5px;margin-top:-4px">Vazifa uchun Ilmzor puli <b>o‘zi tushadi</b> (baho qo‘yilganda). Bu yerda xulq, davomat, faollik kabi qo‘shimcha pul beriladi.</p>
    ${(()=>{const m=S.coin.budg&&S.coin.budg.mine;if(!m)return isAdmin()?'<div class="notice" style="font-size:13px">👑 Rahbar sifatida limitsiz berasiz.</div>':'';const p=m.allocated?Math.round(m.left/m.allocated*100):0;
      return `<div style="background:${m.left>0?'#e6f7ee':'#fde8e8'};border-radius:10px;padding:10px 12px;margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-weight:700"><span>💼 Sizning limitingiz</span><span>${m.left} / ${m.allocated}</span></div><div class="pbar" style="margin-top:6px"><i style="width:${Math.max(0,p)}%;background:${m.left>0?'var(--good)':'var(--crit)'}"></i></div><div class="muted" style="font-size:12px;margin-top:4px">${m.left>0?`Yana ${m.left} Ilmzor puli bera olasiz. Berilgani: ${m.spent}.`:'Limit tugagan. Sotuvchidan qo‘shimcha limit so‘rang.'}</div></div>`;})()}
    <label class="f">Sabab</label><div class="chips">${R.reasons.map((x,i)=>`<span class="chip ${S.coin.reason===x.name?'on':''}" data-ca="reason" data-i="${i}">${esc(x.name)} ${x.amount>0?'+':''}${x.amount}</span>`).join('')}</div>
    <div class="row"><div><label class="f">Miqdori (minus — jarima)</label><input class="inp" id="cg_amt" type="number" value="${esc(S.coin.amount)}" placeholder="masalan 2"></div><div><label class="f">Izoh</label><input class="inp" id="cg_reason" value="${esc(S.coin.reason)}" placeholder="Xulq"></div></div>
    <label class="f">O‘quvchilar <span class="muted">(${sel.size} ta tanlandi)</span> <a href="#" data-ca="selAll">hammasi</a> · <a href="#" data-ca="selNone">hech kim</a></label>
    <div class="stlist">${Object.entries(byG).map(([g,l])=>`<div class="gh">${esc(g)} <a href="#" data-ca="selG" data-g="${esc(g)}" style="text-transform:none">tanlash</a></div>${l.map(x=>`<label><input type="checkbox" data-ca="sel" data-id="${x.id}" ${sel.has(x.id)?'checked':''}> ${esc(x.name)} <span class="muted" style="margin-left:auto">${bal(x.id)} 🪙</span></label>`).join('')}`).join('')||'<div class="muted">O‘quvchi yo‘q</div>'}</div>
    <button class="btn pri" style="width:100%;margin-top:10px;padding:10px" data-ca="give">💰 Berish</button>
    <p class="muted" style="font-size:12px">Ustoz o‘z limitidan ortiq bera olmaydi, bir martada ko‘pi bilan ${R.maxGive}. O‘zingiz bergan pulni 2 kun ichida bekor qilsangiz, limitga qaytadi. Vazifa uchun avtomatik tushadigan pul limitdan yechilmaydi.</p>
   </div>
   <div>
    <div class="card"><h2>🏆 Ilmzor puli reytingi</h2><div style="overflow-x:auto"><table><thead><tr><th>#</th><th>O‘quvchi</th><th>Balans</th><th>Bu oy</th></tr></thead><tbody>
     ${ranked.map((x,i)=>`<tr class="click" data-ca="hist" data-id="${x.id}"><td class="muted">${bal(x.id)>0?i+1:'—'}</td><td><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.group||'Guruhsiz')}</div></td><td><b style="font-size:16px">${bal(x.id)}</b> 🪙</td><td style="color:var(--good);font-weight:700">${monthOf(x.id)?'+'+monthOf(x.id):'<span class="muted">—</span>'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">O‘quvchi yo‘q</td></tr>'}
     </tbody></table></div></div>
    <div class="card" style="margin-top:14px"><h2>🕘 Oxirgi harakatlar</h2>${recent.length?`<table><tbody>${recent.map(r=>{const st=S.stuById[r.student_id];const own=r.id.startsWith('m:')&&r.kind!=='sotuv'&&(isAdmin()||(r.by_user===window.__ME.id&&Date.now()-r.ts<2*86400e3));
      return `<tr><td style="width:24px">${KIND[r.kind]||''}</td><td><b>${esc(st?st.name:'—')}</b><div class="muted" style="font-size:12px">${esc(r.reason||'')} · ${coinDate(r.ts)}${BYL(r)}</div></td><td style="text-align:right;font-weight:800;color:${coinCol(r.amount)}">${cfmt(r.amount)}</td><td style="width:34px">${own?`<button class="btn sm" data-ca="undo" data-id="${r.id}" title="Bekor qilish">✖</button>`:''}</td></tr>`;}).join('')}</tbody></table>`:'<div class="empty">Hali harakat yo‘q</div>'}</div>
   </div></div>`;
}
function coinShopView(D,studs,bal){
  const canSell=isAdmin()||isSeller();const items=D.shop;
  const sales=D.rows.filter(r=>r.kind==='sotuv').slice(0,20);
  const all=activeStudents().sort((a,b)=>a.name.localeCompare(b.name));
  return `<div class="grid2">
   <div>${canSell?`<div class="card"><h2>🛒 Sotish</h2>
     <label class="f">O‘quvchi</label><input class="inp" id="sh_stu" list="sh_stul" placeholder="Ism yozing…" autocomplete="off"><datalist id="sh_stul">${all.map(x=>`<option value="${esc(x.name)} · ${esc(x.group||'Guruhsiz')}">`).join('')}</datalist>
     <div id="sh_bal" class="muted" style="font-size:13px;margin-top:4px"></div>
     <label class="f">Mahsulot</label><select class="inp" id="sh_item" style="width:100%">${items.filter(i=>i.active&&i.stock>0).map(i=>`<option value="${i.id}">${esc(i.name)} — ${i.price} 🪙 (${i.stock} ta)</option>`).join('')||'<option value="">Mahsulot yo‘q</option>'}</select>
     <div class="row"><div><label class="f">Soni</label><input class="inp" id="sh_qty" type="number" value="1" min="1"></div><div style="display:flex;align-items:flex-end"><button class="btn pri" style="width:100%;padding:9px" data-ca="sell">✅ Sotish</button></div></div>
    </div>
    <div class="card" style="margin-top:14px"><h2>➕ Yangi mahsulot</h2>
     <label class="f">Nomi</label><input class="inp" id="si_name" placeholder="Daftar, ruchka, kitob…">
     <div class="row"><div><label class="f">Narxi (Ilmzor puli)</label><input class="inp" id="si_price" type="number" min="1"></div><div><label class="f">Soni (omborda)</label><input class="inp" id="si_stock" type="number" min="0" value="10"></div></div>
     <label class="f">Turi</label><input class="inp" id="si_cat" list="si_catl" placeholder="Kanstovar"><datalist id="si_catl"><option value="Kanstovar"><option value="Kitob"><option value="O‘yin"><option value="Sovg‘a"></datalist>
     <button class="btn pri" style="width:100%;margin-top:10px" data-ca="addItem">Qo‘shish</button></div>`:`<div class="card"><h2>🛍 Do‘kon</h2><p class="muted">O‘quvchilar Ilmzor pulini do‘konda shu mahsulotlarga almashtiradi. Sotish — sotuvchi yoki rahbar orqali.</p></div>`}
   </div>
   <div><div class="card"><h2>📦 Mahsulotlar</h2><div style="overflow-x:auto"><table><thead><tr><th>Mahsulot</th><th>Narxi</th><th>Omborda</th>${canSell?'<th></th>':''}</tr></thead><tbody>
     ${items.map(i=>`<tr style="${i.active?'':'opacity:.5'}"><td><b>${esc(i.name)}</b><div class="muted" style="font-size:12px">${esc(i.category||'')}</div></td>
      <td>${canSell?`<input class="inp" style="width:80px" type="number" data-ca-edit="price" data-id="${i.id}" value="${i.price}">`:`<b>${i.price}</b> 🪙`}</td>
      <td>${canSell?`<input class="inp" style="width:70px" type="number" data-ca-edit="stock" data-id="${i.id}" value="${i.stock}">`:i.stock}</td>
      ${canSell?`<td style="white-space:nowrap"><button class="btn sm" data-ca="toggleItem" data-id="${i.id}" data-on="${i.active?1:0}">${i.active?'Yashirish':'Qaytarish'}</button> <button class="btn sm danger" data-ca="delItem" data-id="${i.id}" title="O‘chirish">🗑</button></td>`:''}</tr>`).join('')||`<tr><td colspan="4" class="empty">Hali mahsulot qo‘shilmagan</td></tr>`}
     </tbody></table></div></div>
    <div class="card" style="margin-top:14px"><h2>🧾 Oxirgi sotuvlar</h2>${(()=>{const ms=D.monthStart||0;const by={};D.rows.filter(r=>r.kind==='sotuv'&&r.ts>=ms).forEach(r=>{const k=r.by_user||'?';(by[k]=by[k]||{n:0,s:0}).n++;by[k].s+=-r.amount;});const ks=Object.keys(by);return ks.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin:-2px 0 10px">${ks.map(k=>`<span class="tag" style="font-size:12.5px">🛍 ${esc(WHO(k)||'—')}: <b>${by[k].n}</b> ta · ${by[k].s} 🪙 <span class="muted">(bu oy)</span></span>`).join('')}</div>`:'';})()}${sales.length?`<table><tbody>${sales.map(r=>{const st=S.stuById[r.student_id];return `<tr><td><b>${esc(st?st.name:'—')}</b><div class="muted" style="font-size:12px">${esc(r.reason)} · ${coinDate(r.ts)}${BYL(r)}</div></td><td style="text-align:right;font-weight:800;color:var(--crit)">${r.amount}</td><td style="width:34px">${isAdmin()||(isSeller()&&r.by_user===window.__ME.id&&Date.now()-r.ts<2*86400e3)?`<button class="btn sm" data-ca="undo" data-id="${r.id}" title="Sotuvni bekor qilish">✖</button>`:''}</td></tr>`;}).join('')}</tbody></table>`:'<div class="empty">Hali sotuv yo‘q</div>'}</div></div></div>`;
}
function coinLimitView(){
  const B=S.coin.budg;if(!B||!B.teachers)return '<div class="empty">Yuklanmoqda…</div>';
  const T=B.teachers.filter(t=>t.active&&t.role!=='admin').sort((a,b)=>a.name.localeCompare(b.name));const nm=id=>{const u=B.teachers.find(t=>t.id===id)||(S.users||[]).find(u=>u.id===id);return u?u.name:'—';};
  const tot=T.reduce((a,t)=>a+t.allocated,0),sp=T.reduce((a,t)=>a+t.spent,0);
  return `<div class="card"><h2>👩‍🏫 Ustozlarga Ilmzor puli limiti <span class="muted" style="font-weight:500">— jami ajratilgan ${tot}, berilgan ${sp}</span></h2>
   <p class="muted" style="font-size:12.5px;margin-top:-4px">Ustoz o‘quvchilarga xulq, davomat, faollik uchun faqat shu limit ichida pul beradi. Vazifa uchun avtomatik tushadigan pul limitdan yechilmaydi. Minus yozsangiz — limit kamayadi.</p>
   <div style="overflow-x:auto"><table><thead><tr><th>Ustoz</th><th>Ajratilgan</th><th>Berdi</th><th>Qoldi</th><th style="width:34%">Limit qo‘shish</th></tr></thead><tbody>
   ${T.map(t=>{const p=t.allocated?Math.round(t.left/t.allocated*100):0;return `<tr><td><b>${esc(t.name)}</b>${t.role==='admin'?' <span class="muted" style="font-size:12px">rahbar · limitsiz</span>':''}</td><td>${t.allocated}</td><td>${t.spent}</td>
     <td><b style="color:${t.left>0?'var(--good)':'var(--crit)'}">${t.left}</b><div class="pbar" style="max-width:90px"><i style="width:${Math.max(0,p)}%;background:${t.left>0?'var(--good)':'var(--crit)'}"></i></div></td>
     <td><div style="display:flex;gap:6px"><input class="inp" type="number" id="bd_${t.id}" placeholder="masalan 100" style="max-width:120px"><button class="btn sm pri" data-ca="budget" data-id="${t.id}">Berish</button></div></td></tr>`;}).join('')}
   </tbody></table></div></div>
   <div class="card" style="margin-top:14px"><h2>🕘 Limit tarixi</h2>${B.rows.length?`<table><tbody>${B.rows.slice(0,40).map(r=>`<tr><td><b>${esc(nm(r.teacher_id))}</b><div class="muted" style="font-size:12px">${coinDate(r.ts)} · ${esc(nm(r.by_user))}${r.note?' · '+esc(r.note):''}</div></td><td style="text-align:right;font-weight:800;color:${coinCol(r.amount)}">${cfmt(r.amount)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Hali limit ajratilmagan</div>'}</div>`;
}
function coinBalanceView(D,studs,bal){
  const q=(S.coin.q||'').toLowerCase().trim();const list=studs.filter(x=>!q||x.name.toLowerCase().includes(q)).sort((a,b)=>bal(b.id)-bal(a.id));
  return `<div class="card"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h2 style="margin:0">🏆 O‘quvchilar balansi</h2><input class="inp" id="cb_q" placeholder="🔎 Ism bo‘yicha qidirish" value="${esc(S.coin.q||'')}" style="max-width:260px;margin-left:auto"></div>
   <div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>#</th><th>O‘quvchi</th><th>Guruh</th><th>Balans</th></tr></thead><tbody>
   ${list.map((x,i)=>`<tr class="click" data-ca="hist" data-id="${x.id}"><td class="muted">${i+1}</td><td><b>${esc(x.name)}</b></td><td class="muted">${esc(x.group||'Guruhsiz')}</td><td><b style="font-size:16px">${bal(x.id)}</b> 🪙</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Topilmadi</td></tr>'}
   </tbody></table></div></div>`;
}
function coinRulesView(D){
  const R=D.settings;const n=(id,v)=>`<input class="inp" id="${id}" type="number" value="${v}" style="width:90px">`;
  return `<div class="grid2"><div class="card"><h2>⚙️ Vazifa uchun avtomatik Ilmzor puli</h2>
    <p class="muted" style="font-size:12.5px;margin-top:-4px">Ustoz baho qo‘yishi bilan o‘quvchiga shu miqdorda Ilmzor puli tushadi. Bahoni o‘zgartirsa — pul ham o‘zgaradi.</p>
    <table><tbody><tr><td>✅ 100% bajardi</td><td>${n('cr_full',R.full)}</td></tr><tr><td>🟢 80–99% (A‘lo)</td><td>${n('cr_alo',R.alo)}</td></tr><tr><td>🟡 50–79% (O‘rta)</td><td>${n('cr_orta',R.orta)}</td></tr><tr><td>🔴 50% dan past</td><td>${n('cr_past',R.past)}</td></tr></tbody></table>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="cr_late" ${R.lateHalf?'checked':''}> Kech topshirilgan vazifaga pulning yarmi</label>
    <h2 style="margin-top:16px">🗓 Oylik test (guruhdagi o‘rin)</h2>
    <table><tbody><tr><td>🥇 1-o‘rin</td><td>${n('cr_o1',R.oylik[0]||0)}</td></tr><tr><td>🥈 2-o‘rin</td><td>${n('cr_o2',R.oylik[1]||0)}</td></tr><tr><td>🥉 3-o‘rin</td><td>${n('cr_o3',R.oylik[2]||0)}</td></tr></tbody></table>
    <label class="f">Ustoz bir martada ko‘pi bilan beradigan pul</label>${n('cr_max',R.maxGive)}
   </div>
   <div class="card"><h2>🎁 Qo‘shimcha pul sabablari</h2><p class="muted" style="font-size:12.5px;margin-top:-4px">Ustoz «Pul berish»da shu tugmalarni ko‘radi. Minus — jarima.</p>
    <div id="cr_reasons">${R.reasons.map((x,i)=>`<div class="row" style="margin-bottom:6px"><input class="inp" data-rn="${i}" value="${esc(x.name)}"><input class="inp" data-ra="${i}" type="number" value="${x.amount}" style="max-width:90px"></div>`).join('')}
    <div class="row"><input class="inp" data-rn="new" placeholder="Yangi sabab"><input class="inp" data-ra="new" type="number" placeholder="pul" style="max-width:90px"></div></div>
    <button class="btn pri" style="width:100%;margin-top:14px;padding:10px" data-ca="saveRules">💾 Saqlash</button>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <p class="muted" style="font-size:12.5px">Ilmzor puli tizimga yangi qo‘shildi. Shu oyda allaqachon qo‘yilgan baholar uchun ham pul berilsinmi?</p>
    <button class="btn" data-ca="recalc">⚙️ Shu oy baholari uchun pul hisoblash</button>
    <p class="muted" style="font-size:12.5px;margin-top:12px">Eski Ilmzor puli ilovasidagi balanslarni ko‘chirish: «Pul berish» bo‘limida o‘quvchini tanlab, sababga «Boshlang‘ich balans» deb yozing.</p>
   </div></div>`;
}
async function coinHist(id){
  const st=S.stuById[id];const m=document.getElementById('modal');m.className='open';m.innerHTML='<div class="mbox"><div class="empty">Yuklanmoqda…</div></div>';
  try{const j=await window.__api('GET','/api/coins/student/'+id);const b=(S.coin.data.balances[id]||0);
    m.innerHTML=`<div class="mbox"><h2>💰 ${esc(st.name)} — <span style="color:var(--good)">${b} Ilmzor puli</span></h2><div style="max-height:60vh;overflow:auto"><table><tbody>${j.rows.map(r=>`<tr><td style="width:24px">${KIND[r.kind]||''}</td><td>${esc(r.reason||'')}<div class="muted" style="font-size:12px">${coinDate(r.ts)}${BYL(r)}</div></td><td style="text-align:right;font-weight:800;color:${coinCol(r.amount)}">${cfmt(r.amount)}</td></tr>`).join('')||'<tr><td class="empty">Hali Ilmzor puli yo‘q</td></tr>'}</tbody></table></div><div style="text-align:right;margin-top:10px"><button class="btn" data-ca="closeM">Yopish</button></div></div>`;
  }catch(e){m.innerHTML=`<div class="mbox"><div class="empty">${esc(e.message)}</div><button class="btn" data-ca="closeM">Yopish</button></div>`;}
}
function findStuByLabel(v){const all=activeStudents();return all.find(x=>`${x.name} · ${x.group||'Guruhsiz'}`===v)||all.filter(x=>x.name.toLowerCase()===String(v).toLowerCase().trim())[0];}
document.addEventListener('input',ev=>{const t=ev.target;if(t.id==='sh_stu'){const x=findStuByLabel(t.value);const el=document.getElementById('sh_bal');if(el)el.innerHTML=x?`Balans: <b>${S.coin.data.balances[x.id]||0}</b> 🪙`:'';}
  if(t.id==='cb_q'){S.coin.q=t.value;const pos=t.selectionStart;render();const n=document.getElementById('cb_q');if(n){n.focus();n.setSelectionRange(pos,pos);}return;}
  if(t.id==='cg_amt')S.coin.amount=t.value;if(t.id==='cg_reason')S.coin.reason=t.value;});
document.addEventListener('change',async ev=>{const t=ev.target;
  if(t.dataset&&t.dataset.ca==='sel'){t.checked?S.coin.sel.add(t.dataset.id):S.coin.sel.delete(t.dataset.id);render();return;}
  if(t.dataset&&t.dataset.caEdit){try{await window.__api('PATCH','/api/shop/'+t.dataset.id,{[t.dataset.caEdit]:Number(t.value)});toast('Saqlandi ✓');coinLoad();}catch(e){toast(e.message);}}});
document.addEventListener('click',async ev=>{
  const el=ev.target.closest('[data-ca]');if(!el)return;const a=el.dataset.ca;if(a==='sel')return;ev.preventDefault();const C=S.coin,D=C.data;
  const studs=()=>activeStudents().filter(x=>inGroup(x));
  if(a==='tab'){C.tab=el.dataset.v;render();return;}
  if(a==='reason'){const r=D.settings.reasons[+el.dataset.i];C.reason=r.name;C.amount=String(r.amount);render();return;}
  if(a==='selAll'){studs().forEach(x=>C.sel.add(x.id));render();return;}
  if(a==='selNone'){C.sel.clear();render();return;}
  if(a==='selG'){studs().filter(x=>(x.group||'Guruhsiz')===el.dataset.g).forEach(x=>C.sel.add(x.id));render();return;}
  if(a==='hist'){coinHist(el.dataset.id);return;}
  if(a==='closeM'){const m=document.getElementById('modal');m.className='';m.innerHTML='';return;}
  if(a==='give'){const amt=Math.round(Number(document.getElementById('cg_amt').value));const reason=document.getElementById('cg_reason').value.trim();
    if(!C.sel.size)return toast('O‘quvchini tanlang');if(!amt)return toast('Miqdorini yozing');
    el.disabled=true;try{const kind=/boshlang/i.test(reason)?'start':undefined;const j=await window.__api('POST','/api/coins',{studentIds:[...C.sel],amount:amt,reason,kind});toast(`${j.n} ta o‘quvchiga ${cfmt(amt)} Ilmzor puli ✓`);C.sel.clear();await coinLoad();}catch(e){toast(e.message);el.disabled=false;}return;}
  if(a==='undo'){if(!confirm('Bekor qilinsinmi?'))return;try{await window.__api('DELETE','/api/coins/'+el.dataset.id);toast('Bekor qilindi');coinLoad();}catch(e){toast(e.message);}return;}
  if(a==='addItem'){const b={name:document.getElementById('si_name').value.trim(),price:Number(document.getElementById('si_price').value),stock:Number(document.getElementById('si_stock').value),category:document.getElementById('si_cat').value.trim()||'Boshqa'};
    try{await window.__api('POST','/api/shop',b);toast('Qo‘shildi ✓');coinLoad();}catch(e){toast(e.message);}return;}
  if(a==='budget'){const inp=document.getElementById('bd_'+el.dataset.id);const v=Math.round(Number(inp.value));if(!v)return toast('Miqdorni yozing');
    el.disabled=true;try{const j=await window.__api('POST','/api/budgets',{teacherId:el.dataset.id,amount:v});toast(`Limit ${cfmt(v)} ✓ Qoldi: ${j.budget.left}`);await coinLoad();}catch(e){toast(e.message);el.disabled=false;}return;}
  if(a==='delItem'){if(!confirm('Mahsulot o‘chirilsinmi? (Sotuvlar tarixi saqlanadi)'))return;try{await window.__api('DELETE','/api/shop/'+el.dataset.id);toast('O‘chirildi');coinLoad();}catch(e){toast(e.message);}return;}
  if(a==='toggleItem'){try{await window.__api('PATCH','/api/shop/'+el.dataset.id,{active:el.dataset.on!=='1'});coinLoad();}catch(e){toast(e.message);}return;}
  if(a==='sell'){const x=findStuByLabel(document.getElementById('sh_stu').value);const it=document.getElementById('sh_item').value;const q=Number(document.getElementById('sh_qty').value)||1;
    if(!x)return toast('O‘quvchini ro‘yxatdan tanlang');if(!it)return toast('Mahsulot tanlang');
    const item=D.shop.find(i=>i.id===it);if(!confirm(`${x.name}: ${item.name}${q>1?' × '+q:''} — ${item.price*q} Ilmzor puli. Sotilsinmi?`))return;
    el.disabled=true;try{const j=await window.__api('POST','/api/shop/sell',{studentId:x.id,itemId:it,qty:q});toast(`Sotildi ✓ Qolgan balans: ${j.balance}`);await coinLoad();}catch(e){toast(e.message);el.disabled=false;}return;}
  if(a==='saveRules'){const g=id=>Number(document.getElementById(id).value);const reasons=[];
    document.querySelectorAll('[data-rn]').forEach(i=>{const k=i.dataset.rn;const am=document.querySelector(`[data-ra="${k}"]`);if(i.value.trim()&&Number(am.value))reasons.push({name:i.value.trim(),amount:Number(am.value)});});
    try{await window.__api('PUT','/api/coin-settings',{full:g('cr_full'),alo:g('cr_alo'),orta:g('cr_orta'),past:g('cr_past'),lateHalf:document.getElementById('cr_late').checked,oylik:[g('cr_o1'),g('cr_o2'),g('cr_o3')],maxGive:g('cr_max'),reasons});toast('Qoidalar saqlandi ✓');coinLoad();}catch(e){toast(e.message);}return;}
  if(a==='recalc'){if(!confirm('Shu oyda qo‘yilgan barcha baholar uchun Ilmzor puli hisoblansinmi?'))return;const d=new Date();try{const j=await window.__api('POST','/api/coins/recalc',{from:`${d.getFullYear()}-${pad(d.getMonth()+1)}-01`});toast(`${j.tasks} ta vazifa uchun Ilmzor puli hisoblandi ✓`);coinLoad();}catch(e){toast(e.message);}return;}
});

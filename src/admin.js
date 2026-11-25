
/* ================= Rahbar: ustozlar va guruhlar ================= */
const isAdmin=()=>!!(window.__ME&&window.__ME.role==='admin');
S.users=[];S.newPw=null;
async function loadUsers(){try{S.users=await window.__users();}catch(e){S.users=[];}render();}
document.addEventListener('me-ready',()=>{if(isAdmin()){const nav=document.getElementById('nav');const a=document.createElement('a');a.href='#ustozlar';a.dataset.v='ustozlar';a.textContent='👥 Ustozlar va xodimlar';nav.appendChild(a);loadUsers();}
  const r=document.createElement('a');r.href='/reyting';r.target='_blank';r.textContent='🏆 Reyting';document.getElementById('nav').appendChild(r);
  if(!isAdmin())loadUsers();route();});
const tName=id=>{const u=(S.users||[]).find(x=>x.id===id);return u?u.name:'';};
function credText(name,phone,pw){return `Ilmzor — vazifalar va ballar tizimi\nManzil: ${location.origin}/\nTelefon: ${phone}\nParol: ${pw}\n\nKirgandan keyin 🔑 tugmasi orqali parolni o‘zgartirishingiz mumkin.`;}
function fmtPhone(p){const d=String(p||'').replace(/\D/g,'');return d.length===9?`+998 ${d.slice(0,2)} ${d.slice(2,5)} ${d.slice(5,7)} ${d.slice(7)}`:p;}
function viewAdmin(){
  if(!isAdmin()) return '<div class="card empty">Bu bo‘lim faqat rahbar uchun</div>';
  const teachers=S.users.filter(u=>u.role==='teacher');
  // groups by (teacher, name)
  const gmap={};S.students.forEach(x=>{if(x.archived)return;const k=(x.teacherId||'')+'|'+(x.group||'Guruhsiz');(gmap[k]=gmap[k]||{t:x.teacherId,g:x.group||'Guruhsiz',n:0}).n++;});
  const glist=Object.values(gmap).sort((a,b)=>tName(a.t).localeCompare(tName(b.t))||a.g.localeCompare(b.g));
  const opts=sel=>S.users.filter(u=>u.active&&u.role!=='seller').map(u=>`<option value="${u.id}" ${u.id===sel?'selected':''}>${esc(u.name)}${u.role==='admin'?' (rahbar)':''}</option>`).join('');
  // per-teacher result this month
  const [ms,me]=range(today(),'month');const rows=rowsIn(ms,me,{group:'all'});
  const tstat=id=>stats(rows.filter(r=>r.st.teacherId===id));
  return `${S.newPw?`<div class="notice" style="border:2px solid var(--good)"><b>✅ ${esc(S.newPw.name)} uchun kirish ma’lumotlari</b> — nusxalab ustozga yuboring (parol faqat hozir ko‘rinadi):
     <pre style="white-space:pre-wrap;background:var(--card);padding:10px;border-radius:8px;margin:8px 0">${esc(S.newPw.text)}</pre><button class="btn pri sm" data-act="copyPw">📋 Nusxalash</button> <button class="btn sm" data-act="closePw">Yopish</button></div>`:''}
   ${teacherBoard()}
   <div class="grid2"><div class="card"><h2>➕ Ustoz yoki xodim qo‘shish</h2>
     <label class="f" for="t_name">Ism familiya</label><input class="inp" id="t_name" data-tf="name" value="${esc(S.tform?.name||'')}">
     <label class="f" for="t_phone">Telefon raqam</label><input class="inp" id="t_phone" data-tf="phone" inputmode="tel" placeholder="+998 90 123 45 67" value="${esc(S.tform?.phone||'')}">
     <label class="f">Lavozimi</label><select class="inp" id="t_role" style="width:100%"><option value="teacher">👩‍🏫 Ustoz</option><option value="seller">🧑‍💼 Xodim — Ilmzor puli sotuvchisi</option></select>
     <div style="margin-top:10px"><button class="btn pri" style="width:100%" data-act="addTeacher">Qo‘shish va parol yaratish</button></div>
     <p class="muted" style="font-size:12.5px;margin-top:10px"><b>Ustoz</b> faqat o‘z guruhlarini ko‘radi: guruh yaratadi, o‘quvchi qo‘shadi, vazifa beradi va baholaydi.<br><b>Xodim (sotuvchi)</b> faqat Ilmzor pulini boshqaradi: do‘kon, ustozlarga limit, sotish.</p></div>
   <div><div class="card"><h2>👩‍🏫 Ustozlar — ${teachers.length} nafar</h2>
     ${S.users.length?`<div style="overflow-x:auto"><table><thead><tr><th>Ism</th><th>Telefon</th><th>Bu oy natija</th><th></th></tr></thead><tbody>
     ${S.users.filter(u=>u.role!=='seller').map(u=>{const st=tstat(u.id);return `<tr style="${u.active?'':'opacity:.5'}"><td><b>${esc(u.name)}</b> <span class="muted" style="font-size:12px">${u.role==='admin'?'rahbar':`<select class="inp" data-role="${u.id}" style="padding:2px 6px;font-size:12px"><option value="teacher" ${u.role==='teacher'?'selected':''}>ustoz</option><option value="seller" ${u.role==='seller'?'selected':''}>sotuvchi</option></select>`}${u.active?'':' · o‘chirilgan'}</span></td><td>${esc(fmtPhone(u.phone))}</td>
       <td>${st.total?`<span class="pcell" style="background:${st.pct==null?'transparent':pcolor(st.pct)};color:${st.pct==null?'var(--muted)':'#fff'}">${fmtP(st.pct)}</span> <span class="muted" style="font-size:12px">${st.tasks} vazifa</span>`:'<span class="muted">—</span>'}</td>
       <td style="white-space:nowrap;text-align:right">${u.id===window.__ME.id?'<span class="muted" style="font-size:12px">siz</span>':`<button class="btn sm pri" data-act="viewAs" data-id="${u.id}" title="Ustozga qanday ko‘rinsa, shunday ochish">👁 Ko‘rish</button> <button class="btn sm" data-act="resetPw" data-id="${u.id}">🔑 Yangi parol</button> <button class="btn sm ${u.active?'danger':''}" data-act="toggleUser" data-id="${u.id}" data-on="${u.active?0:1}">${u.active?'O‘chirish':'Faollashtirish'}</button>`}</td></tr>`;}).join('')}
     </tbody></table></div>`:'<div class="empty">Yuklanmoqda…</div>'}</div>
   <div class="card" style="margin-top:14px"><h2>🧑‍💼 Xodimlar — Ilmzor puli sotuvchilari (${S.users.filter(u=>u.role==='seller').length})</h2>
     <p class="muted" style="font-size:12.5px;margin-top:-4px">Faqat 💰 Ilmzor puli bo‘limini ko‘radi: do‘kon, ustozlarga limit, o‘quvchilarga sotish. Baholar va vazifalar ularga ko‘rinmaydi.</p>
     ${S.users.some(u=>u.role==='seller')?`<table><tbody>${S.users.filter(u=>u.role==='seller').map(u=>`<tr style="${u.active?'':'opacity:.5'}"><td><b>${esc(u.name)}</b> <span class="muted" style="font-size:12px"><select class="inp" data-role="${u.id}" style="padding:2px 6px;font-size:12px"><option value="seller" selected>xodim</option><option value="teacher">ustoz</option></select>${u.active?'':' · o‘chirilgan'}</span></td><td>${esc(fmtPhone(u.phone))}</td>
       <td style="white-space:nowrap;text-align:right"><button class="btn sm pri" data-act="viewAs" data-id="${u.id}" title="Xodimga qanday ko‘rinsa, shunday ochish">👁 Ko‘rish</button> <button class="btn sm" data-act="resetPw" data-id="${u.id}">🔑 Yangi parol</button> <button class="btn sm ${u.active?'danger':''}" data-act="toggleUser" data-id="${u.id}" data-on="${u.active?0:1}">${u.active?'O‘chirish':'Faollashtirish'}</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Hali xodim yo‘q — chapdagi formada «Lavozimi: Xodim» ni tanlang</div>'}</div></div></div>
   <div class="card" style="margin-top:14px"><h2>🏫 Guruhlar va ustozlar</h2><p class="muted" style="font-size:12.5px;margin-top:-4px">Guruhni boshqa ustozga o‘tkazsangiz, uning o‘quvchilari va vazifalari ham o‘tadi. Har xil ustozlar guruhlariga har xil nom bering (masalan «3-sinf Se-Pa 15:00»).</p>
     ${glist.length?`<table><thead><tr><th>Guruh</th><th>O‘quvchilar</th><th>Ustoz</th></tr></thead><tbody>${glist.map(g=>`<tr><td><b>${esc(g.g)}</b></td><td>${g.n}</td><td><select class="inp" data-assign="${esc(g.g)}" data-from="${g.t||''}">${opts(g.t)}</select></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Guruh yo‘q</div>'}
     <p style="margin-top:12px">🏆 O‘quvchilar reytingi sahifasi (hammaga ochiq): <a href="/reyting" target="_blank">${location.origin}/reyting</a> <button class="btn sm" data-act="copyRank">📋</button></p></div>`;
}
async function adminAction(a,el){
  if(a==='addTeacher'){const f=S.tform||{};if(!(f.name||'').trim()||String(f.phone||'').replace(/\D/g,'').length<9){toast('Ism va to‘liq telefon raqamni yozing');return;}
    el.disabled=true;try{const j=await window.__api('POST','/api/users',{name:f.name.trim(),phone:f.phone,role:(document.getElementById('t_role')||{}).value||'teacher'});S.newPw={name:f.name.trim(),text:credText(f.name.trim(),fmtPhone(String(f.phone).replace(/\D/g,'').slice(-9)),j.password)};S.tform={};await loadUsers();}catch(e){toast(e.message);}el.disabled=false;return;}
  if(a==='resetPw'){const u=S.users.find(x=>x.id===el.dataset.id);if(!u)return;el.disabled=true;try{const j=await window.__api('POST','/api/users/'+u.id+'/reset',{});S.newPw={name:u.name,text:credText(u.name,fmtPhone(u.phone),j.password)};render();window.scrollTo(0,0);}catch(e){toast(e.message);}el.disabled=false;return;}
  if(a==='toggleUser'){try{await window.__api('PATCH','/api/users/'+el.dataset.id,{active:el.dataset.on==='1'});await loadUsers();}catch(e){toast(e.message);}return;}
  if(a==='viewAs'){const u=S.users.find(x=>x.id===el.dataset.id);if(!u)return;try{sessionStorage.setItem('viewAs',u.id);sessionStorage.setItem('viewAsName',u.name);sessionStorage.setItem('viewAsRole',u.role==='seller'?'seller':'teacher');}catch(e){}location.hash=u.role==='seller'?'#coin':'#bugun';location.reload();return;}
  if(a==='copyPw'){try{await navigator.clipboard.writeText(S.newPw.text);toast('Nusxalandi ✓');}catch(e){toast('Nusxalab bo‘lmadi — qo‘lda belgilang');}return;}
  if(a==='closePw'){S.newPw=null;render();return;}
  if(a==='copyRank'){try{await navigator.clipboard.writeText(location.origin+'/reyting');toast('Havola nusxalandi ✓');}catch(e){}return;}
}
/* ---- Rahbar paneli: har bir ustozning natijasi ---- */
function teacherBoard(){
  if(!isAdmin()) return '';
  const t=today();
  const [ws,we]=range(t,'week'),[ms,me]=range(t,'month'),[ps,pe]=range(shifted(-1,t,'month'),'month');
  const W=rowsIn(ws,we,{group:'all'}),M=rowsIn(ms,me,{group:'all'}),P=rowsIn(ps,pe,{group:'all'}),O=rowsIn(ms,me,{group:'all',oyl:true});
  const pend=pendingTasks('all'),att=attention('all');
  const wr=weekRanges(6,parse(t)).map(([s,f])=>({s,f,rows:rowsIn(s,f,{group:'all'})}));
  const list=(S.users||[]).filter(u=>u.active&&u.role!=='seller').map(u=>{
    const mine=r=>r.st.teacherId===u.id;
    const studs=S.students.filter(x=>isActive(x)&&x.teacherId===u.id);
    const grs=new Set(studs.map(x=>x.group||'Guruhsiz'));
    const w=stats(W.filter(mine)),m=stats(M.filter(mine)),p=stats(P.filter(mine)),o=stats(O.filter(mine));
    const pc=pend.reduce((a,x)=>a+x.ids.filter(id=>(S.stuById[id]||{}).teacherId===u.id).length,0);
    const ac=att.filter(a=>a.x.teacherId===u.id).length;
    const series=wr.map(x=>({s:x.s,f:x.f,pct:stats(x.rows.filter(mine)).pct}));
    return {u,studs:studs.length,grs:grs.size,w,m,p,o,pc,ac,series};
  }).sort((a,b)=>(b.m.pct??-1)-(a.m.pct??-1)||b.studs-a.studs||a.u.name.localeCompare(b.u.name));
  const active=list.filter(x=>x.studs);
  const cpct=stats(M.filter(r=>r.st.teacherId)).pct;
  const cell=p=>p==null?'<span class="muted">—</span>':`<span class="pcell" style="background:${pcolor(p)};color:#fff">${fmtP(p)}</span>`;
  const dl=(a,b)=>(a!=null&&b!=null)?(d=>`<span class="mini" style="color:${d>0?'var(--good)':d<0?'var(--crit)':'var(--muted)'}">${d>0?'▲ +':d<0?'▼ ':'• '}${d}%</span>`)(Math.round(a-b)):'';
  let pos=0;
  return `<div class="card"><h2>👩‍🏫 Ustozlar natijalari <span class="muted" style="font-weight:500">— ${MONTHS_CAP[ms.getMonth()]}, markaz o‘rtachasi ${fmtP(cpct)}</span></h2>
   <p class="muted" style="font-size:12.5px;margin-top:-4px">Foiz — ustoz guruhlaridagi o‘quvchilarning vazifalarni bajarish foizi. 👁 — ustoz sahifasini u ko‘rgandek ochish.</p>
   <div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Ustoz</th><th>Guruh / o‘quvchi</th><th style="width:22%">Bu oy</th><th>Bu hafta</th><th title="Bu oygi oylik test o‘rtachasi">🗓 Oylik test</th><th title="Oxirgi 6 hafta">📈 6 hafta</th><th title="Bu oy berilgan vazifalar">Vazifa</th><th title="Hali baholanmagan">⏳</th><th title="E’tibor talab o‘quvchilar">🚩</th><th></th></tr></thead><tbody>
   ${list.map(x=>x.studs?`<tr><td class="muted">${x.m.pct==null?'—':++pos}</td><td><b>${esc(x.u.name)}</b>${x.u.role==='admin'?' <span class="muted" style="font-size:12px">rahbar</span>':''}</td><td>${x.grs} / ${x.studs}</td>
     <td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1">${pbar(x.m.pct)}</div><b style="min-width:38px;text-align:right">${fmtP(x.m.pct)}</b></div>${x.p.pct!=null?`<div style="font-size:12px">${dl(x.m.pct,x.p.pct)} <span class="muted">o‘tgan oyga</span></div>`:''}</td>
     <td>${cell(x.w.pct)}</td><td>${cell(x.o.pct)}</td><td>${spark(x.series)}</td><td>${x.m.tasks}</td>
     <td>${x.pc?`<b style="color:#c2620a">${x.pc}</b>`:'<span style="color:var(--good)">0</span>'}</td><td>${x.ac?`<b style="color:#c33">${x.ac}</b>`:'<span style="color:var(--good)">0</span>'}</td>
     <td>${x.u.id===window.__ME.id?'':`<button class="btn sm" data-act="viewAs" data-id="${x.u.id}">👁</button>`}</td></tr>`
     :`<tr style="opacity:.55"><td></td><td>${esc(x.u.name)}</td><td colspan="8" class="muted">hali guruh yo‘q</td><td>${x.u.id===window.__ME.id?'':`<button class="btn sm" data-act="viewAs" data-id="${x.u.id}">👁</button>`}</td></tr>`).join('')}
   </tbody></table></div>${active.length?'':'<div class="empty">Ustozlar guruh yaratgach natijalar shu yerda chiqadi</div>'}</div>`;
}
/* ---- O'quvchi «Bajardim» deb topshirganlar ---- */
function subsList(){
  const out=[];
  for(const tk of S.tasks){const sb=tk.submitted||{};for(const sid of Object.keys(sb)){
    const st=S.stuById[sid];if(!st||!isActive(st)||!inGroup(st))continue;
    const v=(tk.scores||{})[sid];if(v!==undefined&&v!==null&&v!=='')continue;if((tk.absent||{})[sid])continue;
    out.push({tk,st,ts:sb[sid],late:ymd(new Date(sb[sid]))>deadlineOf(tk.date)});}}
  return out.sort((a,b)=>a.ts-b.ts);
}
function subsCard(){
  const L=subsList();if(!L.length)return '';
  return `<div class="card" style="margin-top:14px;border:2px solid #1d4fb8"><h2>🙋 Topshirishga kelganlar <span class="muted" style="font-weight:500">— ${L.length} ta. O‘quvchi «Bajardim» deb belgiladi: ishini tekshirib foizini yozing</span></h2>
   <div style="overflow-x:auto"><table><tbody>${L.map(x=>`<tr><td><a href="#" data-act="openStuR" data-id="${x.st.id}"><b>${esc(x.st.name)}</b></a><div class="muted" style="font-size:12px">${esc(x.st.group||'Guruhsiz')}</div></td>
     <td>${esc(x.tk.title)}<div class="muted" style="font-size:12px">${shortDate(x.tk.date)} · ${esc(x.tk.type||'')}${x.late?' · <b style="color:#b42318">kech</b>':''}</div></td>
     <td style="width:110px"><input class="inp" data-subg="${x.tk.id}" data-subs="${x.st.id}" placeholder="% yoki 7/10" style="padding:7px 9px" autocomplete="off"></td>
     <td style="width:40px"><button class="btn sm" data-act="subDismiss" data-t="${x.tk.id}" data-s="${x.st.id}" title="Ro‘yxatdan olib tashlash (topshirmadi)">✖</button></td></tr>`).join('')}</tbody></table></div></div>`;
}
document.addEventListener('change',e=>{const t=e.target;if(!t.dataset||t.dataset.subg==null)return;const raw=t.value.trim();if(!raw)return;
  t.disabled=true;Promise.resolve(saveCell(t.dataset.subg,t.dataset.subs,raw)).then(()=>{toast('Ball qo‘yildi ✓');}).catch(()=>{t.disabled=false;});},true);
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.subg!=null){e.preventDefault();e.target.blur();}},true);
/* ---- O'quvchi shaxsiy kodlari ---- */
S.codes=null;S.codesOpen=false;
function codesBlock(){
  const base=location.origin;
  if(!S.codesOpen) return `<div class="card" style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>🔑 O‘quvchilar kabineti</b><span class="muted" style="font-size:13px">— o‘quvchi @ilmzor_test_bot → «📝 Vazifalarim» ga ism-familiyasini yozib kiradi (kodni bot beradi); sayt: <a href="/men" target="_blank">${base}/men</a></span><button class="btn sm pri" data-act="codesOpen" style="margin-left:auto">Kodlarni ko‘rsatish</button></div>`;
  if(!S.codes) return `<div class="card empty">Kodlar yuklanmoqda…</div>`;
  const list=activeStudents().filter(x=>inGroup(x)&&S.codes[x.id]).sort((a,b)=>(a.group||'').localeCompare(b.group||'')||a.name.localeCompare(b.name));
  return `<div class="card" style="margin-bottom:14px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h2 style="margin:0">🔑 Shaxsiy kodlar <span class="muted" style="font-weight:500">(${list.length})</span></h2>
    <button class="btn sm pri" data-act="codesCopyAll" style="margin-left:auto">📋 Hammasini nusxalash</button><button class="btn sm" data-act="codesClose">Yopish</button></div>
    <p style="font-size:13px;background:#e6f7ee;border-radius:8px;padding:8px 10px">✅ Kod berish shart emas: o‘quvchi <b>@ilmzor_test_bot</b> → «📝 Vazifalarim» ga <b>ism-familiyasini</b> yozadi — bot kodini o‘zi beradi. Har o‘quvchi bitta Telegram’ga bog‘lanadi; boshqa telefondan kirish kerak bo‘lsa — 🔄 bosing.</p>
    <p class="muted" style="font-size:12.5px">Xohlasangiz kodni o‘zingiz ham berishingiz mumkin. Kod bilan: Telegram <b>@ilmzor_test_bot</b> → «📝 Vazifalarim» yoki sayt <a href="/men" target="_blank">${base}/men</a>. Kod boshqaga o‘tib qolsa — 🔄 bilan yangilang (eskisi ishlamay qoladi).</p>
    <table><tbody>${list.map(x=>`<tr><td><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.group||'Guruhsiz')}</div></td><td><code style="font-size:17px;font-weight:800;letter-spacing:2px">${S.codes[x.id]}</code></td><td>${S.linked&&S.linked.has(x.id)?'<span style="color:var(--good);font-weight:700;font-size:13px">📱 Telegram ulangan</span>':'<span class="muted" style="font-size:13px">hali kirmagan</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-act="codeCopy" data-id="${x.id}">📋 Xabar</button> <button class="btn sm" data-act="codeReset" data-id="${x.id}" title="Yangi kod va Telegram bog‘lanishini yangilash">🔄</button></td></tr>`).join('')}</tbody></table></div>`;
}
function codeMsg(x){return `Ilmzor — ${x.name}\nShaxsiy kod: ${S.codes[x.id]}\n\nVazifalaringizni ko‘rish va «Bajardim» deb belgilash:\n• Telegram: @ilmzor_test_bot → «📝 Vazifalarim»\n• Sayt: ${location.origin}/men?kod=${S.codes[x.id]}`;}
async function codesAction(a,el){
  if(a==='codesOpen'){S.codesOpen=true;render();try{const j=await window.__api('GET','/api/codes');S.codes=j.codes;S.linked=new Set(j.linked||[]);}catch(e){toast(e.message);S.codesOpen=false;}render();return;}
  if(a==='codesClose'){S.codesOpen=false;render();return;}
  if(a==='codeCopy'){const x=S.stuById[el.dataset.id];try{await navigator.clipboard.writeText(codeMsg(x));toast('Nusxalandi ✓ — o‘quvchiga yuboring');}catch(e){toast('Nusxalab bo‘lmadi');}return;}
  if(a==='codesCopyAll'){const list=activeStudents().filter(x=>inGroup(x)&&S.codes[x.id]).sort((a,b)=>a.name.localeCompare(b.name));
    const txt=`Ilmzor — o‘quvchilar shaxsiy kodlari\nTelegram: @ilmzor_test_bot → «📝 Vazifalarim» · Sayt: ${location.origin}/men\n\n`+list.map(x=>`${x.name} (${x.group||'Guruhsiz'}) — ${S.codes[x.id]}`).join('\n');
    try{await navigator.clipboard.writeText(txt);toast('Hammasi nusxalandi ✓');}catch(e){toast('Nusxalab bo‘lmadi');}return;}
  if(a==='codeReset'){const x=S.stuById[el.dataset.id];if(!confirm(x.name+' uchun yangi kod berilsinmi? Eski kod ishlamay qoladi va Telegram bog‘lanishi o‘chadi — o‘quvchi botga ism-familiyasini qayta yozib kiradi.'))return;
    try{const j=await window.__api('POST','/api/codes/reset',{id:x.id});Object.assign(S.codes,j.codes);S.linked&&S.linked.delete(x.id);render();toast('Yangi kod: '+j.codes[x.id]);}catch(e){toast(e.message);}return;}
  if(a==='subDismiss'){try{await window.__api('DELETE','/api/subs',{taskId:el.dataset.t,studentId:el.dataset.s});window.__refreshAll();toast('Olib tashlandi');}catch(e){toast(e.message);}return;}
}
/* ---- Hisobot: oylik testlar — barcha oylar bir joyda ---- */
function oylikBoard(){
  const by={},months=new Set();
  for(const tk of S.tasks){ if(tk.type!==OYL||!tk.date||tk.date>today()) continue; const max=Number(tk.max)||0; if(!max) continue;
    const ym=tk.date.slice(0,7); const sc=tk.scores||{};
    for(const id of (tk.studentIds||[])){ const st=S.stuById[id]; if(!st||!isActive(st)||!inGroup(st)) continue; const v=sc[id]; if(v===undefined||v===null||v==='') continue;
      months.add(ym); const k=(by[id]=by[id]||{})[ym]=(by[id][ym]||{s:0,n:0}); k.s+=Math.min(100,Number(v)/max*100); k.n++; } }
  const M=[...months].sort().slice(-9);
  if(!M.length) return `<div class="card"><h2>🗓 Oylik testlar</h2><div class="empty">Hali oylik test kiritilmagan. Vazifa berishda turini <b>«Oylik test»</b> qilib tanlang.</div></div>`;
  const val=(id,ym)=>{const k=(by[id]||{})[ym];return k?k.s/k.n:null;};
  const lab=ym=>{const [y,m]=ym.split('-');return MONTHS[+m-1].slice(0,3)+(M[0].slice(0,4)!==M[M.length-1].slice(0,4)?` ${y.slice(2)}`:'');};
  const rows=Object.keys(by).map(id=>{const vals=M.map(ym=>val(id,ym));const have=vals.map((v,i)=>[v,i]).filter(x=>x[0]!=null);
    const last=have.length?have[have.length-1]:null,prev=have.length>1?have[have.length-2]:null;
    return {x:S.stuById[id],vals,last:last?last[0]:null,lastI:last?last[1]:-1,d:last&&prev?last[0]-prev[0]:null};})
    .sort((a,b)=>(b.lastI-a.lastI)||((b.last??-1)-(a.last??-1))||a.x.name.localeCompare(b.x.name));
  const avg=M.map((ym,i)=>{const v=rows.map(r=>r.vals[i]).filter(x=>x!=null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;});
  const up=rows.filter(r=>r.d!=null&&r.d>=5).sort((a,b)=>b.d-a.d),down=rows.filter(r=>r.d!=null&&r.d<=-5).sort((a,b)=>a.d-b.d);
  const cell=p=>p==null?'<span class="muted">—</span>':`<span class="pcell" style="background:${pcolor(p)};color:#fff">${fmtP(p)}</span>`;
  const dch=d=>d==null?'<span class="muted">—</span>':`<b style="color:${d>=5?'var(--good)':d<=-5?'var(--crit)':'var(--muted)'}">${d>0?'▲ +':d<0?'▼ ':'• '}${Math.round(d)}%</b>`;
  const chip=(r,c)=>`<a href="#" data-act="openStuR" data-id="${r.x.id}" class="chip" style="cursor:pointer;border-color:${c};color:${c}">${esc(r.x.name.split(' ').slice(0,2).join(' '))} ${r.d>0?'+':''}${Math.round(r.d)}%</a>`;
  const ag=avg[avg.length-1],ap=avg.length>1?avg[avg.length-2]:null;
  // group average mini chart
  const bars=avg.map((a,i)=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:34px"><b style="font-size:12px">${a==null?'—':Math.round(a)+'%'}</b><div style="width:100%;max-width:46px;height:70px;background:var(--grid);border-radius:8px;display:flex;align-items:flex-end;overflow:hidden"><i style="display:block;width:100%;height:${a==null?0:Math.max(4,a)}%;background:${a==null?'transparent':pcolor(a)};border-radius:8px"></i></div><span class="muted" style="font-size:12px">${lab(M[i])}</span></div>`).join('');
  return `<div class="card"><h2>🗓 Oylik testlar <span class="muted" style="font-weight:500">— barcha oylar bir joyda${S.group!=='all'?' · '+esc(S.group):''}. Vazifa foiziga qo‘shilmaydi</span></h2>
   <div class="grid2" style="gap:14px;align-items:stretch">
    <div style="background:var(--bg);border-radius:12px;padding:12px"><div class="muted" style="font-size:12.5px;font-weight:700;margin-bottom:6px">Guruh o‘rtachasi oyma-oy ${ap!=null&&ag!=null?dch(ag-ap):''}</div><div style="display:flex;gap:8px;align-items:flex-end">${bars}</div></div>
    <div style="background:var(--bg);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px">
      <div><div style="font-size:13px;font-weight:700;color:var(--good);margin-bottom:6px">📈 Ko‘tarildi (${up.length})</div>${up.length?`<div style="display:flex;flex-wrap:wrap;gap:6px">${up.map(r=>chip(r,'var(--good)')).join('')}</div>`:'<span class="muted" style="font-size:13px">yo‘q</span>'}</div>
      <div><div style="font-size:13px;font-weight:700;color:var(--crit);margin-bottom:6px">📉 Pastladi (${down.length})</div>${down.length?`<div style="display:flex;flex-wrap:wrap;gap:6px">${down.map(r=>chip(r,'var(--crit)')).join('')}</div>`:'<span class="muted" style="font-size:13px">yo‘q</span>'}</div>
      <div class="muted" style="font-size:12px">Oxirgi ikki natija solishtiriladi; 5% dan ortiq o‘zgarish hisobga olinadi.</div></div>
   </div>
   <div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>#</th><th>O‘quvchi</th>${M.map(ym=>`<th style="text-align:center">${lab(ym)}</th>`).join('')}<th>O‘zgarish</th></tr></thead><tbody>
   ${rows.map((r,i)=>`<tr class="click" data-act="openStu" data-id="${r.x.id}"><td class="muted">${i+1}</td><td><b>${esc(r.x.name)}</b><div class="muted" style="font-size:12px">${esc(r.x.group||'Guruhsiz')}</div></td>${r.vals.map(v=>`<td style="text-align:center">${cell(v)}</td>`).join('')}<td>${dch(r.d)}</td></tr>`).join('')}
   <tr style="background:var(--bg)"><td></td><td><b>Guruh o‘rtachasi</b></td>${avg.map(a=>`<td style="text-align:center">${cell(a)}</td>`).join('')}<td>${ap!=null&&ag!=null?dch(ag-ap):''}</td></tr>
   </tbody></table></div></div>`;
}

document.addEventListener('change',async ev=>{const t=ev.target;if(!t.dataset||!t.dataset.role)return;const u=S.users.find(x=>x.id===t.dataset.role);
  if(!confirm(`${u?u.name:''} lavozimi «${t.value==='seller'?'sotuvchi':'ustoz'}» qilinsinmi? U qayta kirishi kerak bo‘ladi.`)){t.value=u.role;return;}
  try{await window.__api('PATCH','/api/users/'+t.dataset.role,{role:t.value});toast('Lavozim o‘zgardi ✓');loadUsers();}catch(e){toast(e.message);t.value=u.role;}});

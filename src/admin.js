
/* ================= Rahbar: ustozlar va guruhlar ================= */
const isAdmin=()=>!!(window.__ME&&window.__ME.role==='admin');
S.users=[];S.newPw=null;
async function loadUsers(){try{S.users=await window.__users();}catch(e){S.users=[];}render();}
document.addEventListener('me-ready',()=>{if(isAdmin()){const nav=document.getElementById('nav');const a=document.createElement('a');a.href='#ustozlar';a.dataset.v='ustozlar';a.textContent='👩‍🏫 Ustozlar';nav.appendChild(a);loadUsers();}
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
  const opts=sel=>S.users.filter(u=>u.active).map(u=>`<option value="${u.id}" ${u.id===sel?'selected':''}>${esc(u.name)}${u.role==='admin'?' (rahbar)':''}</option>`).join('');
  // per-teacher result this month
  const [ms,me]=range(today(),'month');const rows=rowsIn(ms,me,{group:'all'});
  const tstat=id=>stats(rows.filter(r=>r.st.teacherId===id));
  return `${S.newPw?`<div class="notice" style="border:2px solid var(--good)"><b>✅ ${esc(S.newPw.name)} uchun kirish ma’lumotlari</b> — nusxalab ustozga yuboring (parol faqat hozir ko‘rinadi):
     <pre style="white-space:pre-wrap;background:var(--card);padding:10px;border-radius:8px;margin:8px 0">${esc(S.newPw.text)}</pre><button class="btn pri sm" data-act="copyPw">📋 Nusxalash</button> <button class="btn sm" data-act="closePw">Yopish</button></div>`:''}
   ${teacherBoard()}
   <div class="grid2"><div class="card"><h2>➕ Ustoz qo‘shish</h2>
     <label class="f" for="t_name">Ism familiya</label><input class="inp" id="t_name" data-tf="name" value="${esc(S.tform?.name||'')}">
     <label class="f" for="t_phone">Telefon raqam</label><input class="inp" id="t_phone" data-tf="phone" inputmode="tel" placeholder="+998 90 123 45 67" value="${esc(S.tform?.phone||'')}">
     <div style="margin-top:10px"><button class="btn pri" style="width:100%" data-act="addTeacher">Qo‘shish va parol yaratish</button></div>
     <p class="muted" style="font-size:12.5px;margin-top:10px">Ustoz shu telefon raqam va parol bilan kiradi, faqat o‘z guruhlarini ko‘radi: guruh yaratadi, o‘quvchi qo‘shadi, vazifa beradi va baholaydi.</p></div>
   <div class="card"><h2>👩‍🏫 Ustozlar — ${teachers.length} nafar</h2>
     ${S.users.length?`<div style="overflow-x:auto"><table><thead><tr><th>Ism</th><th>Telefon</th><th>Bu oy natija</th><th></th></tr></thead><tbody>
     ${S.users.map(u=>{const st=tstat(u.id);return `<tr style="${u.active?'':'opacity:.5'}"><td><b>${esc(u.name)}</b> <span class="muted" style="font-size:12px">${u.role==='admin'?'rahbar':'ustoz'}${u.active?'':' · o‘chirilgan'}</span></td><td>${esc(fmtPhone(u.phone))}</td>
       <td>${st.total?`<span class="pcell" style="background:${st.pct==null?'transparent':pcolor(st.pct)};color:${st.pct==null?'var(--muted)':'#fff'}">${fmtP(st.pct)}</span> <span class="muted" style="font-size:12px">${st.tasks} vazifa</span>`:'<span class="muted">—</span>'}</td>
       <td style="white-space:nowrap;text-align:right">${u.id===window.__ME.id?'<span class="muted" style="font-size:12px">siz</span>':`<button class="btn sm pri" data-act="viewAs" data-id="${u.id}" title="Ustozga qanday ko‘rinsa, shunday ochish">👁 Ko‘rish</button> <button class="btn sm" data-act="resetPw" data-id="${u.id}">🔑 Yangi parol</button> <button class="btn sm ${u.active?'danger':''}" data-act="toggleUser" data-id="${u.id}" data-on="${u.active?0:1}">${u.active?'O‘chirish':'Faollashtirish'}</button>`}</td></tr>`;}).join('')}
     </tbody></table></div>`:'<div class="empty">Yuklanmoqda…</div>'}</div></div>
   <div class="card" style="margin-top:14px"><h2>🏫 Guruhlar va ustozlar</h2><p class="muted" style="font-size:12.5px;margin-top:-4px">Guruhni boshqa ustozga o‘tkazsangiz, uning o‘quvchilari va vazifalari ham o‘tadi. Har xil ustozlar guruhlariga har xil nom bering (masalan «3-sinf Se-Pa 15:00»).</p>
     ${glist.length?`<table><thead><tr><th>Guruh</th><th>O‘quvchilar</th><th>Ustoz</th></tr></thead><tbody>${glist.map(g=>`<tr><td><b>${esc(g.g)}</b></td><td>${g.n}</td><td><select class="inp" data-assign="${esc(g.g)}" data-from="${g.t||''}">${opts(g.t)}</select></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Guruh yo‘q</div>'}
     <p style="margin-top:12px">🏆 O‘quvchilar reytingi sahifasi (hammaga ochiq): <a href="/reyting" target="_blank">${location.origin}/reyting</a> <button class="btn sm" data-act="copyRank">📋</button></p></div>`;
}
async function adminAction(a,el){
  if(a==='addTeacher'){const f=S.tform||{};if(!(f.name||'').trim()||String(f.phone||'').replace(/\D/g,'').length<9){toast('Ism va to‘liq telefon raqamni yozing');return;}
    el.disabled=true;try{const j=await window.__api('POST','/api/users',{name:f.name.trim(),phone:f.phone,role:'teacher'});S.newPw={name:f.name.trim(),text:credText(f.name.trim(),fmtPhone(String(f.phone).replace(/\D/g,'').slice(-9)),j.password)};S.tform={};await loadUsers();}catch(e){toast(e.message);}el.disabled=false;return;}
  if(a==='resetPw'){const u=S.users.find(x=>x.id===el.dataset.id);if(!u)return;el.disabled=true;try{const j=await window.__api('POST','/api/users/'+u.id+'/reset',{});S.newPw={name:u.name,text:credText(u.name,fmtPhone(u.phone),j.password)};render();window.scrollTo(0,0);}catch(e){toast(e.message);}el.disabled=false;return;}
  if(a==='toggleUser'){try{await window.__api('PATCH','/api/users/'+el.dataset.id,{active:el.dataset.on==='1'});await loadUsers();}catch(e){toast(e.message);}return;}
  if(a==='viewAs'){const u=S.users.find(x=>x.id===el.dataset.id);if(!u)return;try{sessionStorage.setItem('viewAs',u.id);sessionStorage.setItem('viewAsName',u.name);}catch(e){}location.hash='#bugun';location.reload();return;}
  if(a==='copyPw'){try{await navigator.clipboard.writeText(S.newPw.text);toast('Nusxalandi ✓');}catch(e){toast('Nusxalab bo‘lmadi — qo‘lda belgilang');}return;}
  if(a==='closePw'){S.newPw=null;render();return;}
  if(a==='copyRank'){try{await navigator.clipboard.writeText(location.origin+'/reyting');toast('Havola nusxalandi ✓');}catch(e){}return;}
}
/* ---- Rahbar paneli: har bir ustozning natijasi ---- */
function teacherBoard(){
  if(!isAdmin()) return '';
  const t=today();
  const [ws,we]=range(t,'week'),[ms,me]=range(t,'month'),[ps,pe]=range(shifted(-1,t,'month'),'month');
  const W=rowsIn(ws,we,{group:'all'}),M=rowsIn(ms,me,{group:'all'}),P=rowsIn(ps,pe,{group:'all'});
  const pend=pendingTasks('all'),att=attention('all');
  const wr=weekRanges(6,parse(t)).map(([s,f])=>({s,f,rows:rowsIn(s,f,{group:'all'})}));
  const list=(S.users||[]).filter(u=>u.active).map(u=>{
    const mine=r=>r.st.teacherId===u.id;
    const studs=S.students.filter(x=>isActive(x)&&x.teacherId===u.id);
    const grs=new Set(studs.map(x=>x.group||'Guruhsiz'));
    const w=stats(W.filter(mine)),m=stats(M.filter(mine)),p=stats(P.filter(mine));
    const pc=pend.reduce((a,x)=>a+x.ids.filter(id=>(S.stuById[id]||{}).teacherId===u.id).length,0);
    const ac=att.filter(a=>a.x.teacherId===u.id).length;
    const series=wr.map(x=>({s:x.s,f:x.f,pct:stats(x.rows.filter(mine)).pct}));
    return {u,studs:studs.length,grs:grs.size,w,m,p,pc,ac,series};
  }).sort((a,b)=>(b.m.pct??-1)-(a.m.pct??-1)||b.studs-a.studs||a.u.name.localeCompare(b.u.name));
  const active=list.filter(x=>x.studs);
  const cpct=stats(M.filter(r=>r.st.teacherId)).pct;
  const cell=p=>p==null?'<span class="muted">—</span>':`<span class="pcell" style="background:${pcolor(p)};color:#fff">${fmtP(p)}</span>`;
  const dl=(a,b)=>(a!=null&&b!=null)?(d=>`<span class="mini" style="color:${d>0?'var(--good)':d<0?'var(--crit)':'var(--muted)'}">${d>0?'▲ +':d<0?'▼ ':'• '}${d}%</span>`)(Math.round(a-b)):'';
  let pos=0;
  return `<div class="card"><h2>👩‍🏫 Ustozlar natijalari <span class="muted" style="font-weight:500">— ${MONTHS_CAP[ms.getMonth()]}, markaz o‘rtachasi ${fmtP(cpct)}</span></h2>
   <p class="muted" style="font-size:12.5px;margin-top:-4px">Foiz — ustoz guruhlaridagi o‘quvchilarning vazifalarni bajarish foizi. 👁 — ustoz sahifasini u ko‘rgandek ochish.</p>
   <div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Ustoz</th><th>Guruh / o‘quvchi</th><th style="width:22%">Bu oy</th><th>Bu hafta</th><th title="Oxirgi 6 hafta">📈 6 hafta</th><th title="Bu oy berilgan vazifalar">Vazifa</th><th title="Hali baholanmagan">⏳</th><th title="E’tibor talab o‘quvchilar">🚩</th><th></th></tr></thead><tbody>
   ${list.map(x=>x.studs?`<tr><td class="muted">${x.m.pct==null?'—':++pos}</td><td><b>${esc(x.u.name)}</b>${x.u.role==='admin'?' <span class="muted" style="font-size:12px">rahbar</span>':''}</td><td>${x.grs} / ${x.studs}</td>
     <td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1">${pbar(x.m.pct)}</div><b style="min-width:38px;text-align:right">${fmtP(x.m.pct)}</b></div>${x.p.pct!=null?`<div style="font-size:12px">${dl(x.m.pct,x.p.pct)} <span class="muted">o‘tgan oyga</span></div>`:''}</td>
     <td>${cell(x.w.pct)}</td><td>${spark(x.series)}</td><td>${x.m.tasks}</td>
     <td>${x.pc?`<b style="color:#c2620a">${x.pc}</b>`:'<span style="color:var(--good)">0</span>'}</td><td>${x.ac?`<b style="color:#c33">${x.ac}</b>`:'<span style="color:var(--good)">0</span>'}</td>
     <td>${x.u.id===window.__ME.id?'':`<button class="btn sm" data-act="viewAs" data-id="${x.u.id}">👁</button>`}</td></tr>`
     :`<tr style="opacity:.55"><td></td><td>${esc(x.u.name)}</td><td colspan="7" class="muted">hali guruh yo‘q</td><td>${x.u.id===window.__ME.id?'':`<button class="btn sm" data-act="viewAs" data-id="${x.u.id}">👁</button>`}</td></tr>`).join('')}
   </tbody></table></div>${active.length?'':'<div class="empty">Ustozlar guruh yaratgach natijalar shu yerda chiqadi</div>'}</div>`;
}

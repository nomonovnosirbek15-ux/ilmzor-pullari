
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
   <div class="grid2"><div class="card"><h2>➕ Ustoz qo‘shish</h2>
     <label class="f" for="t_name">Ism familiya</label><input class="inp" id="t_name" data-tf="name" value="${esc(S.tform?.name||'')}">
     <label class="f" for="t_phone">Telefon raqam</label><input class="inp" id="t_phone" data-tf="phone" inputmode="tel" placeholder="+998 90 123 45 67" value="${esc(S.tform?.phone||'')}">
     <div style="margin-top:10px"><button class="btn pri" style="width:100%" data-act="addTeacher">Qo‘shish va parol yaratish</button></div>
     <p class="muted" style="font-size:12.5px;margin-top:10px">Ustoz shu telefon raqam va parol bilan kiradi, faqat o‘z guruhlarini ko‘radi: guruh yaratadi, o‘quvchi qo‘shadi, vazifa beradi va baholaydi.</p></div>
   <div class="card"><h2>👩‍🏫 Ustozlar — ${teachers.length} nafar</h2>
     ${S.users.length?`<div style="overflow-x:auto"><table><thead><tr><th>Ism</th><th>Telefon</th><th>Bu oy natija</th><th></th></tr></thead><tbody>
     ${S.users.map(u=>{const st=tstat(u.id);return `<tr style="${u.active?'':'opacity:.5'}"><td><b>${esc(u.name)}</b> <span class="muted" style="font-size:12px">${u.role==='admin'?'rahbar':'ustoz'}${u.active?'':' · o‘chirilgan'}</span></td><td>${esc(fmtPhone(u.phone))}</td>
       <td>${st.total?`<span class="pcell" style="background:${st.pct==null?'transparent':pcolor(st.pct)};color:${st.pct==null?'var(--muted)':'#fff'}">${fmtP(st.pct)}</span> <span class="muted" style="font-size:12px">${st.tasks} vazifa</span>`:'<span class="muted">—</span>'}</td>
       <td style="white-space:nowrap;text-align:right">${u.id===window.__ME.id?'<span class="muted" style="font-size:12px">siz</span>':`<button class="btn sm" data-act="resetPw" data-id="${u.id}">🔑 Yangi parol</button> <button class="btn sm ${u.active?'danger':''}" data-act="toggleUser" data-id="${u.id}" data-on="${u.active?0:1}">${u.active?'O‘chirish':'Faollashtirish'}</button>`}</td></tr>`;}).join('')}
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
  if(a==='copyPw'){try{await navigator.clipboard.writeText(S.newPw.text);toast('Nusxalandi ✓');}catch(e){toast('Nusxalab bo‘lmadi — qo‘lda belgilang');}return;}
  if(a==='closePw'){S.newPw=null;render();return;}
  if(a==='copyRank'){try{await navigator.clipboard.writeText(location.origin+'/reyting');toast('Havola nusxalandi ✓');}catch(e){}return;}
}

import json,base64,re
src=open('/home/claude/vazifalar/index.html').read()
shim=open('/home/claude/baho/src/shim.html').read()
admin=open('/home/claude/baho/src/admin.js').read()
s=src
def rep(a,b,cnt=1):
    global s
    n=s.count(a); assert n==cnt,(n,a[:100]); s=s.replace(a,b)
rep('family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">','family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">\n'+shim)
rep("/* ---------- render ---------- */",admin+"\n/* ---------- render ---------- */")
rep("""    (S.view==='bugun'?viewToday():S.view==='vazifalar'?viewTasks():S.view==='oquvchilar'?viewStudents():viewPanel());""",
    """    (S.view==='bugun'?viewToday():S.view==='ustozlar'?viewAdmin():S.view==='vazifalar'?viewTasks():S.view==='oquvchilar'?viewStudents():viewPanel());""")
rep("S.view=['bugun','panel','vazifalar','oquvchilar'].includes(h)?h:'bugun';","S.view=['bugun','panel','vazifalar','oquvchilar','ustozlar'].includes(h)?h:'bugun';")
rep("const showPeriod=S.view!=='oquvchilar'&&S.view!=='bugun';","const showPeriod=S.view!=='oquvchilar'&&S.view!=='bugun'&&S.view!=='ustozlar';")
rep("""  if(a==='parentCard'){openParentCard(el.dataset.id);return;}""","""  if(['addTeacher','resetPw','toggleUser','copyPw','closePw','copyRank'].includes(a)){await adminAction(a,el);return;}
  if(a==='parentCard'){openParentCard(el.dataset.id);return;}""")
rep("""  if(t.dataset.f){S.form[t.dataset.f]=t.value;}
  else if(t.dataset.it){const it=""","""  if(t.dataset.tf){S.tform=S.tform||{};S.tform[t.dataset.tf]=t.value;return;}
  if(t.dataset.f){S.form[t.dataset.f]=t.value;}
  else if(t.dataset.it){const it=""")
rep("""  if(t.id==='groupPick'){S.group=t.value;render();}""","""  if(t.dataset.assign!=null){const to=t.value,from=t.dataset.from;if(to===from)return;t.disabled=true;window.__api('POST','/api/assign-group',{group:t.dataset.assign,from,to}).then(j=>{toast(`Guruh o‘tkazildi ✓ (${j.students} o‘quvchi)`);window.__refreshAll();}).catch(e=>{toast(e.message);t.disabled=false;});return;}
  if(t.dataset.sf==='teacherId'){S.sform.teacherId=t.value;return;}
  if(t.id==='groupPick'){S.group=t.value;render();}""")
# admin: choose teacher when adding students
rep("""   <label class="f" for="s_group">Guruh</label><input class="inp" id="s_group" list="glist" data-sf="group" value="${esc(SF.group)}" placeholder="Masalan: 3-sinf toq kunlar 15:00">""",
"""   <label class="f" for="s_group">Guruh</label><input class="inp" id="s_group" list="glist" data-sf="group" value="${esc(SF.group)}" placeholder="Masalan: 3-sinf toq kunlar 15:00">
   ${isAdmin()?`<label class="f" for="s_teacher">Ustoz</label><select class="inp" style="width:100%" id="s_teacher" data-sf="teacherId">${(S.users||[]).filter(u=>u.active).map(u=>`<option value="${u.id}" ${(SF.teacherId||window.__ME.id)===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select>`:''}""")
rep("""    if(await write(db=>db.collection('students').add({name,group,created:Date.now()}))){S.sform.name='';""","""    if(await write(db=>db.collection('students').add({name,group,created:Date.now(),...(isAdmin()&&S.sform.teacherId?{teacherId:S.sform.teacherId}:{})}))){S.sform.name='';""")
rep("""    el.disabled=true;let n=0;for(const name of names){if(await write(db=>db.collection('students').add({name,group,created:Date.now()})))n++;else break;}""","""    el.disabled=true;let n=0;for(const name of names){if(await write(db=>db.collection('students').add({name,group,created:Date.now(),...(isAdmin()&&S.sform.teacherId?{teacherId:S.sform.teacherId}:{})})))n++;else break;}""")
rep("""  return `<tr><td><b>${esc(x.name)}</b></td><td class="muted">${esc(x.group||'Guruhsiz')}</td><td style="white-space:nowrap;text-align:right"><button class="btn sm" data-act="editStu\"""","""  return `<tr><td><b>${esc(x.name)}</b></td><td class="muted">${esc(x.group||'Guruhsiz')}${isAdmin()&&x.teacherId?` · ${esc(tName(x.teacherId))}`:''}</td><td style="white-space:nowrap;text-align:right"><button class="btn sm" data-act="editStu\"""")
s=s.replace("Sahifani claude.ai’da tizimga kirgan holda oching.","Internetni tekshirib, sahifani yangilang.").replace("sahifani claude.ai’da oching.","sahifani yangilang.")
s=s.replace("<title>Ilmzor — Vazifalar va ballar</title>","<title>Ilmzor — Vazifalar va ballar</title>\n<link rel=\"icon\" href=\"/brand/logo-belgi.png\">")
open('/home/claude/baho/dist/app.html','w').write(s)
# assets
A={}
for p,t in [('brand/logo-gorizontal.png','image/png'),('brand/logo-belgi.png','image/png'),('fonts/Satoshi-Medium.woff2','font/woff2'),('fonts/Satoshi-Bold.woff2','font/woff2'),('fonts/Satoshi-Black.woff2','font/woff2')]:
    A['/'+p]={'type':t,'b64':base64.b64encode(open('/home/claude/vazifalar/'+p,'rb').read()).decode()}
w=open('/home/claude/baho/src/worker.js').read()
head='const APP_HTML = '+json.dumps(s,ensure_ascii=False)+';\nconst RANK_HTML = '+json.dumps(open('/home/claude/baho/src/reyting.html').read(),ensure_ascii=False)+';\nconst ASSETS = '+json.dumps(A)+';\n'
w=w.replace('/*__ASSETS__*/',head)
open('/home/claude/baho/dist/worker.js','w').write(w)
print(len(w)//1024,'KB')

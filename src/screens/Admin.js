import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { supabase, q, rpc, createAccount, cleanLogin } from '../supabase';
import {
  C, Bars, Btn, Card, Check, Chip, Coin, Empty, ErrorBox, Field, H2, ListRow, Loading, P, Page, ROLE_NAMES, Row, Search, Segment, Sheet, Stat, fmt, useLoad, useUI,
} from '../ui';
import { History, Ratings } from '../shared';
import { Items, TopUp } from './Seller';
import { useMyGroups } from './Student';

const norm = (x) => (x || '').toLowerCase();
const ROLES = ['student', 'teacher', 'seller', 'admin'];

/* ---------- Statistika (infografika) ---------- */
function Stats() {
  const d = useLoad(() => rpc('admin_stats'), []);
  if (d.error) return <Page><ErrorBox text={d.error} onRetry={d.reload} /></Page>;
  if (!d.data) return <Page><Loading /></Page>;
  const x = d.data;
  return (
    <Page onRefresh={d.reload} refreshing={d.loading}>
      <Row style={{ flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <Stat icon="👦" label="O'quvchilar" value={x.students} color={C.blue} />
        <Stat icon="👩‍🏫" label="O'qituvchilar" value={x.teachers} color={C.primary} />
        <Stat icon="⭐" label="Shu hafta berildi" value={x.given_week} color={C.gold} coin />
        <Stat icon="📅" label="Shu oy berildi" value={x.given_month} color={C.success} coin />
        <Stat icon="🛍️" label="Shu oy sarflandi" value={x.spent_month} color={C.danger} coin />
        <Stat icon="👛" label="O'quvchilarda jami" value={x.student_money} color={C.primaryDark} coin />
      </Row>
      <Card>
        <H2 style={{ marginBottom: 12 }}>Pul oqimi (shu oy)</H2>
        <Bars data={[{ label: '⭐ Berildi', value: x.given_month }, { label: '🛍️ Sarflandi', value: x.spent_month }]} color={C.primary} />
        <P muted style={{ marginTop: 10, fontSize: 13 }}>O'qituvchilar hisobida berilmagan: {fmt(x.teacher_money)} 🪙</P>
      </Card>
      <Card>
        <H2 style={{ marginBottom: 12 }}>Nima uchun berildi (shu oy)</H2>
        <Bars data={x.by_reason.map((r) => ({ label: r.name, value: r.total }))} color={C.gold} />
      </Card>
      <Card>
        <H2 style={{ marginBottom: 12 }}>O'qituvchilar faolligi (shu oy)</H2>
        <Bars data={x.by_teacher.map((r) => ({ label: r.name, value: r.total }))} color={C.primary} />
      </Card>
      <Card>
        <H2 style={{ marginBottom: 12 }}>Eng ko'p olingan mahsulotlar</H2>
        <Bars data={x.top_items.map((r) => ({ label: r.name, value: r.qty }))} color={C.blue} unit=" dona" />
      </Card>
    </Page>
  );
}

/* ---------- Odamlar ---------- */
function People({ me }) {
  const { notify, ask } = useUI();
  const d = useLoad(async () => {
    const [people, groups, members] = await Promise.all([
      q(supabase.from('profiles').select('*').order('full_name')),
      q(supabase.from('groups').select('id,name').order('name')),
      q(supabase.from('group_members').select('*')),
    ]);
    return { people, groups, members };
  }, []);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(null);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);

  if (d.error) return <Page><ErrorBox text={d.error} onRetry={d.reload} /></Page>;
  if (!d.data) return <Page><Loading /></Page>;
  const { people, groups, members } = d.data;
  const pending = people.filter((p) => p.role === 'pending');
  const list = people.filter((p) => (filter === 'all' || p.role === filter) && (norm(p.full_name).includes(norm(search)) || norm(p.username).includes(norm(search))));
  const groupsOf = (id) => members.filter((m) => m.student_id === id).map((m) => m.group_id);

  const create = async () => {
    const c = creating;
    const login = cleanLogin(c.login);
    if (!c.fullName.trim()) return notify('Ism familiyani kiriting', 'err');
    if (login.length < 3) return notify("Login kamida 3 ta belgi (lotin harflari, raqam)", 'err');
    if (c.password.length < 6) return notify('Parol kamida 6 belgi', 'err');
    setBusy(true);
    try {
      const id = await createAccount({ login, password: c.password, fullName: c.fullName.trim(), role: c.role });
      if (c.role === 'student' && c.groups.length) await q(supabase.from('group_members').insert(c.groups.map((g) => ({ group_id: g, student_id: id }))));
      notify(`Akkaunt ochildi. Login: ${login}`);
      setCreating(null); d.reload();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };

  const e = editId && people.find((p) => p.id === editId);

  return (
    <Page onRefresh={d.reload} refreshing={d.loading}>
      <Btn title="Yangi akkaunt" icon="➕" onPress={() => setCreating({ fullName: '', login: '', password: '', role: 'student', groups: [] })} style={{ marginBottom: 12 }} />
      {!!pending.length && (
        <Card style={{ backgroundColor: C.goldLight, borderColor: '#FCD34D' }}>
          <H2>⏳ Rol berilmaganlar: {pending.length}</H2>
          <P muted style={{ fontSize: 13 }}>Ularni bosib rol bering.</P>
        </Card>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
        {[['all', 'Hammasi'], ...ROLES.map((r) => [r, ROLE_NAMES[r]]), ['pending', 'Kutilmoqda']].map(([v, l]) => (
          <Chip key={v} label={`${l} (${v === 'all' ? people.length : people.filter((p) => p.role === v).length})`} active={filter === v} onPress={() => setFilter(v)} />
        ))}
      </ScrollView>
      <Search value={search} onChange={setSearch} placeholder="Ism yoki login" />
      <Card>
        {!list.length ? <Empty /> : list.map((p) => (
          <ListRow key={p.id}
            title={(p.active ? '' : '🚫 ') + (p.full_name || '(ismsiz)')}
            sub={`@${p.username} · ${ROLE_NAMES[p.role]}${p.role === 'student' ? ' · ' + groupsOf(p.id).map((g) => groups.find((x) => x.id === g)?.name).filter(Boolean).join(', ') : ''}`}
            right={(p.role === 'student' || p.role === 'teacher') ? <Coin value={p.balance} size={14} color={C.muted} /> : null}
            onPress={() => setEditId(p.id)} />
        ))}
      </Card>

      <Sheet visible={!!creating} onClose={() => setCreating(null)} title="Yangi akkaunt">
        {creating && (
          <>
            <Field label="Ism familiya" value={creating.fullName} onChangeText={(v) => setCreating({ ...creating, fullName: v })} autoCapitalize="words" placeholder="Aliyev Ali" />
            <Field label="Login" value={creating.login} onChangeText={(v) => setCreating({ ...creating, login: cleanLogin(v) })} placeholder="ali2015" hint="Faqat lotin harflari, raqam, nuqta" />
            <Field label="Parol" value={creating.password} onChangeText={(v) => setCreating({ ...creating, password: v })} placeholder="kamida 6 belgi" />
            <P style={{ fontWeight: '600', marginBottom: 6 }}>Rol</P>
            <Row style={{ flexWrap: 'wrap' }}>{ROLES.map((r) => <Chip key={r} label={ROLE_NAMES[r]} active={creating.role === r} onPress={() => setCreating({ ...creating, role: r })} />)}</Row>
            {creating.role === 'student' && (
              <>
                <P style={{ fontWeight: '600', marginVertical: 6 }}>Guruhlari</P>
                <Row style={{ flexWrap: 'wrap' }}>
                  {!groups.length && <P muted>Avval "Guruhlar" bo'limida guruh oching</P>}
                  {groups.map((g) => {
                    const on = creating.groups.includes(g.id);
                    return <Chip key={g.id} label={g.name} active={on} onPress={() => setCreating({ ...creating, groups: on ? creating.groups.filter((x) => x !== g.id) : [...creating.groups, g.id] })} />;
                  })}
                </Row>
              </>
            )}
            <Card style={{ backgroundColor: C.primaryLight, borderColor: C.primaryLight, marginTop: 8 }}>
              <P style={{ fontSize: 13 }}>Login va parolni yozib oling va egasiga bering. Parolni keyin "Parolni yangilash" orqali o'zgartirish mumkin.</P>
            </Card>
            <Btn title="Akkaunt ochish" onPress={create} loading={busy} />
          </>
        )}
      </Sheet>

      <Sheet visible={!!e} onClose={() => setEditId(null)} title={e ? (e.full_name || '@' + e.username) : ''}>
        {e && <EditPerson me={me} p={e} groups={groups} memberOf={groupsOf(e.id)} onChanged={d.reload} notify={notify} ask={ask} />}
      </Sheet>
    </Page>
  );
}

function EditPerson({ me, p, groups, memberOf, onChanged, notify, ask }) {
  const [name, setName] = useState(p.full_name);
  const [role, setRole] = useState(p.role === 'pending' ? 'student' : p.role);
  const [pw, setPw] = useState('');
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const run = async (key, fn, msg) => {
    setBusy(key);
    try { await fn(); if (msg) notify(msg); onChanged(); } catch (err) { notify(err.message, 'err'); }
    setBusy('');
  };
  const isMe = p.id === me.id;

  return (
    <>
      <P muted style={{ marginBottom: 10 }}>Login: @{p.username} · Hisob: {fmt(p.balance)} 🪙</P>
      <Field label="Ism familiya" value={name} onChangeText={setName} autoCapitalize="words" />
      <P style={{ fontWeight: '600', marginBottom: 6 }}>Rol</P>
      <Row style={{ flexWrap: 'wrap' }}>{ROLES.map((r) => <Chip key={r} label={ROLE_NAMES[r]} active={role === r} onPress={() => !isMe && setRole(r)} />)}</Row>
      <Btn title="Saqlash" loading={busy === 'save'} onPress={() => run('save', () => rpc('admin_setup_user', { p_user: p.id, p_role: role, p_full_name: name.trim() }), 'Saqlandi')} style={{ marginBottom: 16 }} />

      {p.role === 'student' && (
        <Card>
          <H2 style={{ marginBottom: 8 }}>Guruhlari</H2>
          {!groups.length ? <P muted>Guruh yo'q</P> : groups.map((g) => {
            const on = memberOf.includes(g.id);
            return (
              <Check key={g.id} label={g.name} checked={on} onPress={() => run('g', () => on
                ? q(supabase.from('group_members').delete().eq('group_id', g.id).eq('student_id', p.id))
                : q(supabase.from('group_members').insert({ group_id: g.id, student_id: p.id })))} />
            );
          })}
        </Card>
      )}

      {p.role === 'teacher' && <P muted style={{ marginBottom: 12 }}>O'qituvchi hisobini to'ldirish: "Do'kon" → "Pul ajratish".</P>}

      {(p.role === 'student' || p.role === 'teacher') && (
        <Card>
          <H2 style={{ marginBottom: 4 }}>Hisobni tuzatish</H2>
          <P muted style={{ fontSize: 13, marginBottom: 10 }}>Xato kiritilgan pulni to'g'rilash uchun. Ayirish uchun minus bilan yozing: -10</P>
          <Row style={{ gap: 10 }}>
            <Field style={{ flex: 1 }} label="Summa (+/−)" value={delta} onChangeText={(v) => setDelta(v.replace(/[^\d-]/g, ''))} keyboardType="numbers-and-punctuation" />
            <Field style={{ flex: 2 }} label="Sabab" value={note} onChangeText={setNote} autoCapitalize="sentences" />
          </Row>
          <Btn kind="ghost" title="Tuzatish" loading={busy === 'adj'} onPress={() => {
            const n = parseInt(delta, 10);
            if (!n) return notify('Summani kiriting', 'err');
            if (!note.trim()) return notify('Sababini yozing', 'err');
            run('adj', () => rpc('adjust_balance', { p_user: p.id, p_delta: n, p_note: note.trim() }), 'Hisob tuzatildi').then(() => { setDelta(''); setNote(''); });
          }} />
        </Card>
      )}

      <Card>
        <H2 style={{ marginBottom: 8 }}>Parolni yangilash</H2>
        <Field value={pw} onChangeText={setPw} placeholder="Yangi parol (kamida 6 belgi)" />
        <Btn kind="ghost" title="Parolni o'rnatish" loading={busy === 'pw'} onPress={() => run('pw', () => rpc('admin_reset_password', { p_user: p.id, p_password: pw }), 'Parol yangilandi').then(() => setPw(''))} />
      </Card>

      {!isMe && (
        <Btn kind={p.active ? 'danger' : 'primary'} title={p.active ? "Akkauntni o'chirish (bloklash)" : 'Akkauntni qayta yoqish'} loading={busy === 'act'}
          onPress={async () => {
            if (p.active && !(await ask("Bloklansinmi?", `${p.full_name} tizimga kira olmaydi. Tarix saqlanib qoladi.`, 'Bloklash'))) return;
            run('act', () => rpc('admin_set_active', { p_user: p.id, p_active: !p.active }), p.active ? 'Bloklandi' : 'Yoqildi');
          }} />
      )}
      <View style={{ height: 30 }} />
    </>
  );
}

/* ---------- Guruhlar ---------- */
function Groups() {
  const { notify, ask } = useUI();
  const d = useLoad(async () => {
    const [groups, teachers, students, members] = await Promise.all([
      q(supabase.from('groups').select('*').order('name')),
      q(supabase.from('profiles').select('id,full_name').eq('role', 'teacher').eq('active', true).order('full_name')),
      q(supabase.from('profiles').select('id,full_name,username').eq('role', 'student').eq('active', true).order('full_name')),
      q(supabase.from('group_members').select('*')),
    ]);
    return { groups, teachers, students, members };
  }, []);
  const [edit, setEdit] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  if (d.error) return <Page><ErrorBox text={d.error} onRetry={d.reload} /></Page>;
  if (!d.data) return <Page><Loading /></Page>;
  const { groups, teachers, students, members } = d.data;
  const tName = (id) => teachers.find((t) => t.id === id)?.full_name || "o'qituvchi yo'q";
  const count = (gid) => members.filter((m) => m.group_id === gid).length;

  const save = async () => {
    if (!edit.name.trim()) return notify('Guruh nomini kiriting', 'err');
    setBusy(true);
    try {
      const row = { name: edit.name.trim(), teacher_id: edit.teacher_id || null };
      if (edit.id) await q(supabase.from('groups').update(row).eq('id', edit.id));
      else {
        const [g] = await q(supabase.from('groups').insert(row).select());
        setEdit({ ...edit, id: g.id });
      }
      notify('Saqlandi'); d.reload();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  const toggle = async (sid, on) => {
    try {
      if (on) await q(supabase.from('group_members').delete().eq('group_id', edit.id).eq('student_id', sid));
      else await q(supabase.from('group_members').insert({ group_id: edit.id, student_id: sid }));
      d.reload();
    } catch (e) { notify(e.message, 'err'); }
  };
  const remove = async () => {
    if (!(await ask("Guruh o'chirilsinmi?", "O'quvchilar o'chmaydi, faqat guruh ro'yxati o'chadi.", "O'chirish"))) return;
    try { await q(supabase.from('groups').delete().eq('id', edit.id)); setEdit(null); d.reload(); notify("O'chirildi"); } catch (e) { notify(e.message, 'err'); }
  };

  const inGroup = edit?.id ? members.filter((m) => m.group_id === edit.id).map((m) => m.student_id) : [];
  const shown = students.filter((x) => norm(x.full_name).includes(norm(search)) || norm(x.username).includes(norm(search)))
    .sort((a, b) => (inGroup.includes(b.id) ? 1 : 0) - (inGroup.includes(a.id) ? 1 : 0));

  return (
    <Page onRefresh={d.reload} refreshing={d.loading}>
      <Btn title="Yangi guruh" icon="➕" onPress={() => { setSearch(''); setEdit({ name: '', teacher_id: teachers[0]?.id || null }); }} style={{ marginBottom: 12 }} />
      {!groups.length ? <Empty text="Guruh oching va o'qituvchi biriktiring" /> : (
        <Card>
          {groups.map((g) => <ListRow key={g.id} title={g.name} sub={`${tName(g.teacher_id)} · ${count(g.id)} o'quvchi`} onPress={() => { setSearch(''); setEdit({ ...g }); }} />)}
        </Card>
      )}
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Guruh' : 'Yangi guruh'}>
        {edit && (
          <>
            <Field label="Guruh nomi" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} autoCapitalize="sentences" placeholder="Masalan: Matematika 3-sinf A" />
            <P style={{ fontWeight: '600', marginBottom: 6 }}>O'qituvchisi</P>
            <Row style={{ flexWrap: 'wrap' }}>
              {!teachers.length && <P muted>Avval o'qituvchi akkauntini oching</P>}
              {teachers.map((t) => <Chip key={t.id} label={t.full_name} active={edit.teacher_id === t.id} onPress={() => setEdit({ ...edit, teacher_id: t.id })} />)}
            </Row>
            <Btn title="Saqlash" onPress={save} loading={busy} style={{ marginVertical: 12 }} />
            {edit.id && (
              <>
                <H2 style={{ marginBottom: 8 }}>O'quvchilar ({inGroup.length})</H2>
                <Search value={search} onChange={setSearch} />
                <Card>
                  {!shown.length ? <P muted>O'quvchi topilmadi</P> : shown.map((x) => {
                    const on = inGroup.includes(x.id);
                    return <Check key={x.id} label={x.full_name} sub={'@' + x.username} checked={on} onPress={() => toggle(x.id, on)} />;
                  })}
                </Card>
                <Btn kind="danger" title="Guruhni o'chirish" onPress={remove} />
                <View style={{ height: 30 }} />
              </>
            )}
          </>
        )}
      </Sheet>
    </Page>
  );
}

/* ---------- Sabablar va summalar ---------- */
function Reasons() {
  const { notify } = useUI();
  const d = useLoad(() => q(supabase.from('reasons').select('*').order('sort').order('id')), []);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit.name.trim()) return notify('Nomini kiriting', 'err');
    const amt = edit.amount.trim() ? parseInt(edit.amount, 10) : null;
    if (edit.amount.trim() && !(amt > 0)) return notify("Summa musbat son bo'lsin yoki bo'sh qoldiring", 'err');
    setBusy(true);
    try {
      const row = { name: edit.name.trim(), fixed_amount: amt, active: edit.active, sort: parseInt(edit.sort || '0', 10) || 0 };
      if (edit.id) await q(supabase.from('reasons').update(row).eq('id', edit.id));
      else await q(supabase.from('reasons').insert(row));
      notify('Saqlandi'); setEdit(null); d.reload();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <Page onRefresh={d.reload} refreshing={d.loading && !!d.data}>
      <Card style={{ backgroundColor: C.primaryLight, borderColor: C.primaryLight }}>
        <P style={{ fontWeight: '700' }}>Summa qanday ishlaydi?</P>
        <P style={{ marginTop: 6, fontSize: 14 }}>🔒 Summa yozilsa — <Text style={{ fontWeight: '700' }}>qat'iy</Text>: o'qituvchi aynan shu summani beradi, o'zgartira olmaydi.</P>
        <P style={{ marginTop: 4, fontSize: 14 }}>✏️ Summa bo'sh qolsa — <Text style={{ fontWeight: '700' }}>erkin</Text>: o'qituvchi har safar o'zi yozadi.</P>
      </Card>
      <Btn title="Yangi sabab" icon="➕" onPress={() => setEdit({ name: '', amount: '', active: true, sort: '' })} style={{ marginBottom: 12 }} />
      {d.error ? <ErrorBox text={d.error} onRetry={d.reload} /> : !d.data ? <Loading /> : (
        <Card>
          {d.data.map((r) => (
            <ListRow key={r.id} title={(r.active ? '' : '🚫 ') + r.name}
              sub={r.fixed_amount ? "🔒 Qat'iy summa" : "✏️ Erkin — o'qituvchi yozadi"}
              right={r.fixed_amount ? <Coin value={r.fixed_amount} /> : <Text style={{ color: C.muted }}>erkin</Text>}
              onPress={() => setEdit({ ...r, amount: r.fixed_amount ? String(r.fixed_amount) : '', sort: String(r.sort) })} />
          ))}
        </Card>
      )}
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Sababni tahrirlash' : 'Yangi sabab'}>
        {edit && (
          <>
            <Field label="Nomi" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} autoCapitalize="sentences" placeholder="Masalan: Olimpiadada qatnashgani" />
            <Field label="Qat'iy summa (🪙)" value={edit.amount} onChangeText={(v) => setEdit({ ...edit, amount: v.replace(/\D/g, '') })} keyboardType="number-pad"
              placeholder="Bo'sh = erkin" hint={edit.amount ? `🔒 Qat'iy: har doim ${edit.amount} 🪙` : "✏️ Erkin: o'qituvchi summani o'zi yozadi"} />
            <Field label="Tartib raqami" value={edit.sort} onChangeText={(v) => setEdit({ ...edit, sort: v.replace(/\D/g, '') })} keyboardType="number-pad" hint="Ro'yxatda qaysi o'rinda turishi" />
            <Row style={{ marginBottom: 14 }}>
              <Chip label="Faol" active={edit.active} onPress={() => setEdit({ ...edit, active: true })} />
              <Chip label="O'chirilgan" active={!edit.active} color={C.danger} onPress={() => setEdit({ ...edit, active: false })} />
            </Row>
            <Btn title="Saqlash" onPress={save} loading={busy} />
          </>
        )}
      </Sheet>
    </Page>
  );
}

function Shop({ me }) {
  const [tab, setTab] = useState('items');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, width: '100%', maxWidth: 672, alignSelf: 'center' }}>
        <Segment options={[['items', 'Mahsulotlar'], ['topup', 'Pul ajratish'], ['hist', 'Tarix']]} value={tab} onChange={setTab} />
      </View>
      {tab === 'items' ? <Items /> : tab === 'topup' ? <TopUp /> : <History me={me} />}
    </View>
  );
}

function AdminRatings({ me }) {
  const g = useMyGroups(me);
  if (!g.data) return <Page>{g.error ? <ErrorBox text={g.error} onRetry={g.reload} /> : <Loading />}</Page>;
  return <Ratings me={me} groups={g.data} />;
}

export function adminTabs(me) {
  return [
    { key: 'stats', icon: '📊', label: 'Statistika', render: () => <Stats /> },
    { key: 'people', icon: '👥', label: 'Odamlar', render: () => <People me={me} /> },
    { key: 'groups', icon: '🏫', label: 'Guruhlar', render: () => <Groups /> },
    { key: 'reasons', icon: '⭐', label: 'Sabablar', render: () => <Reasons /> },
    { key: 'shop', icon: '🛍️', label: "Do'kon", render: () => <Shop me={me} /> },
    { key: 'rating', icon: '🏆', label: 'Reyting', render: () => <AdminRatings me={me} /> },
  ];
}

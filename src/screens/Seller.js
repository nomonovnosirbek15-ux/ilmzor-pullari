import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { supabase, q, rpc } from '../supabase';
import { C, Btn, Card, Chip, Coin, Empty, ErrorBox, Field, H2, ListRow, Loading, P, Page, Row, Search, Sheet, fmt, useLoad, useUI } from '../ui';
import { History } from '../shared';

const norm = (x) => (x || '').toLowerCase();

/* ---------- Sotish ---------- */
function Sell() {
  const { notify, ask } = useUI();
  const data = useLoad(async () => {
    const [students, items] = await Promise.all([
      q(supabase.from('profiles').select('id,full_name,username,balance').eq('role', 'student').eq('active', true).order('full_name')),
      q(supabase.from('shop_items').select('*').eq('active', true).gt('stock', 0).order('name')),
    ]);
    return { students, items };
  }, []);
  const [search, setSearch] = useState('');
  const [student, setStudent] = useState(null);
  const [item, setItem] = useState(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  if (data.error) return <Page><ErrorBox text={data.error} onRetry={data.reload} /></Page>;
  if (!data.data) return <Page><Loading /></Page>;

  const st = student && data.data.students.find((x) => x.id === student);
  const it = item && data.data.items.find((x) => x.id === item);
  const total = it ? it.price * qty : 0;
  const filtered = data.data.students.filter((x) => norm(x.full_name).includes(norm(search)) || norm(x.username).includes(norm(search))).slice(0, 30);

  const submit = async () => {
    const ok = await ask('Sotilsinmi?', `${st.full_name}\n${it.name} × ${qty} = ${fmt(total)} ilmzor\nQoladi: ${fmt(st.balance - total)} ilmzor`, 'Sotish');
    if (!ok) return;
    setBusy(true);
    try {
      await rpc('sell_item', { p_student: st.id, p_item: it.id, p_qty: qty });
      notify(`Sotildi: ${it.name} × ${qty}`);
      setItem(null); setQty(1); setStudent(null); setSearch('');
      data.reload();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <Page onRefresh={data.reload} refreshing={data.loading}>
      <H2 style={{ marginBottom: 8 }}>1. O'quvchi</H2>
      {st ? (
        <Card style={{ backgroundColor: C.primaryLight, borderColor: C.primary }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.primaryDark }}>{st.full_name}</Text>
              <Text style={{ color: C.primaryDark }}>Hisobida: {fmt(st.balance)} ilmzor</Text>
            </View>
            <Btn small kind="ghost" title="Almashtirish" onPress={() => setStudent(null)} />
          </Row>
        </Card>
      ) : (
        <>
          <Search value={search} onChange={setSearch} placeholder="Ism yoki login" />
          <Card>
            {!filtered.length ? <P muted>Topilmadi</P> : filtered.map((x) => (
              <ListRow key={x.id} title={x.full_name} sub={'@' + x.username} onPress={() => setStudent(x.id)} right={<Coin value={x.balance} size={14} color={C.muted} />} />
            ))}
          </Card>
        </>
      )}

      {st && (
        <>
          <H2 style={{ marginVertical: 8 }}>2. Mahsulot</H2>
          {!data.data.items.length ? <Empty text="Omborda mahsulot yo'q" /> : (
            <Card>
              {data.data.items.map((x) => {
                const can = st.balance >= x.price;
                return (
                  <Pressable key={x.id} onPress={() => { setItem(x.id); setQty(1); }}
                    style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, backgroundColor: item === x.id ? C.goldLight : 'transparent', opacity: can ? 1 : 0.45 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '600' }}>{x.name}</Text>
                      <Text style={{ color: C.muted, fontSize: 13 }}>{x.category} · omborda {x.stock}</Text>
                    </View>
                    <Coin value={x.price} />
                  </Pressable>
                );
              })}
            </Card>
          )}
        </>
      )}

      {st && it && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <P>Miqdor</P>
            <Row style={{ gap: 10 }}>
              <Btn small kind="light" title="−" onPress={() => setQty(Math.max(1, qty - 1))} />
              <Text style={{ fontSize: 20, fontWeight: '800', minWidth: 30, textAlign: 'center' }}>{qty}</Text>
              <Btn small kind="light" title="+" onPress={() => setQty(Math.min(it.stock, qty + 1))} />
            </Row>
          </Row>
          <Row style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <P>Jami</P><Coin value={total} size={20} color={total > st.balance ? C.danger : C.text} />
          </Row>
          {total > st.balance && <P style={{ color: C.danger, marginTop: 6 }}>O'quvchida yetarli pul yo'q</P>}
          <Btn title="Sotish" icon="🛍️" style={{ marginTop: 14 }} onPress={submit} loading={busy} disabled={total > st.balance} />
        </Card>
      )}
    </Page>
  );
}

/* ---------- Mahsulotlar (admin va sotuvchi) ---------- */
export function Items() {
  const { notify } = useUI();
  const data = useLoad(() => q(supabase.from('shop_items').select('*').order('active', { ascending: false }).order('category').order('name')), []);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = (x) => setEdit(x ? { ...x, price: String(x.price), stock: String(x.stock) } : { name: '', category: '', price: '', stock: '', active: true });

  const save = async () => {
    const row = { name: edit.name.trim(), category: edit.category.trim() || 'Boshqa', price: parseInt(edit.price, 10), stock: parseInt(edit.stock || '0', 10), active: edit.active };
    if (!row.name) return notify('Nomini kiriting', 'err');
    if (!(row.price > 0)) return notify("Narx musbat son bo'lsin", 'err');
    setBusy(true);
    try {
      if (edit.id) await q(supabase.from('shop_items').update(row).eq('id', edit.id));
      else await q(supabase.from('shop_items').insert(row));
      notify('Saqlandi'); setEdit(null); data.reload();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };

  const cats = [...new Set((data.data || []).map((x) => x.category))];
  return (
    <Page onRefresh={data.reload} refreshing={data.loading && !!data.data}>
      <Btn title="Yangi mahsulot" icon="➕" onPress={() => open(null)} style={{ marginBottom: 12 }} />
      {data.error ? <ErrorBox text={data.error} onRetry={data.reload} /> : !data.data ? <Loading /> : !data.data.length ? <Empty text="Mahsulot qo'shing: daftar, ruchka, kitob, o'yinlar..." /> : (
        <Card>
          {data.data.map((x) => (
            <ListRow key={x.id} title={(x.active ? '' : '🚫 ') + x.name} sub={`${x.category} · omborda ${x.stock}`} onPress={() => open(x)} right={<Coin value={x.price} />} />
          ))}
        </Card>
      )}
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot'}>
        {edit && (
          <>
            <Field label="Nomi" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} autoCapitalize="sentences" placeholder="Masalan: Daftar 48 varaq" />
            <Field label="Turi" value={edit.category} onChangeText={(v) => setEdit({ ...edit, category: v })} autoCapitalize="sentences" placeholder="O'quv qurollari, Kitoblar, O'yinlar..." />
            {!!cats.length && <Row style={{ flexWrap: 'wrap', marginTop: -4, marginBottom: 8 }}>{cats.map((c) => <Chip key={c} label={c} active={edit.category === c} onPress={() => setEdit({ ...edit, category: c })} />)}</Row>}
            <Row style={{ gap: 12 }}>
              <Field style={{ flex: 1 }} label="Narxi (ilmzor)" value={edit.price} onChangeText={(v) => setEdit({ ...edit, price: v.replace(/\D/g, '') })} keyboardType="number-pad" />
              <Field style={{ flex: 1 }} label="Omborda (dona)" value={edit.stock} onChangeText={(v) => setEdit({ ...edit, stock: v.replace(/\D/g, '') })} keyboardType="number-pad" />
            </Row>
            <Row style={{ marginBottom: 14 }}>
              <Chip label="Sotuvda" active={edit.active} onPress={() => setEdit({ ...edit, active: true })} />
              <Chip label="Yashirilgan" active={!edit.active} color={C.danger} onPress={() => setEdit({ ...edit, active: false })} />
            </Row>
            <Btn title="Saqlash" onPress={save} loading={busy} />
          </>
        )}
      </Sheet>
    </Page>
  );
}

/* ---------- O'qituvchilarga pul ajratish ---------- */
export function TopUp() {
  const { notify, ask } = useUI();
  const data = useLoad(() => q(supabase.from('profiles').select('id,full_name,balance').eq('role', 'teacher').eq('active', true).order('full_name')), []);
  const [sel, setSel] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const t = sel && (data.data || []).find((x) => x.id === sel);

  const submit = async () => {
    const n = parseInt(amount, 10);
    if (!(n > 0)) return notify('Summani kiriting', 'err');
    if (!(await ask("Pul ajratilsinmi?", `${t.full_name} hisobiga ${fmt(n)} ilmzor`, 'Ajratish'))) return;
    setBusy(true);
    try {
      await rpc('allocate_to_teacher', { p_teacher: t.id, p_amount: n, p_note: note.trim() || null });
      notify(`${t.full_name}: +${fmt(n)} ilmzor`);
      setAmount(''); setNote(''); setSel(null); data.reload();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <Page onRefresh={data.reload} refreshing={data.loading && !!data.data}>
      <P muted style={{ marginBottom: 12 }}>O'qituvchilar o'quvchilarga faqat o'z hisobidagi puldan bera oladi. Bu yerda ularning hisobini to'ldirasiz.</P>
      {data.error ? <ErrorBox text={data.error} onRetry={data.reload} /> : !data.data ? <Loading /> : !data.data.length ? <Empty text="O'qituvchi yo'q" /> : (
        <Card>
          {data.data.map((x) => (
            <ListRow key={x.id} title={x.full_name} onPress={() => setSel(x.id)} right={<Coin value={x.balance} color={C.primaryDark} />} />
          ))}
        </Card>
      )}
      <Sheet visible={!!t} onClose={() => setSel(null)} title={t ? t.full_name : ''}>
        {t && (
          <>
            <P style={{ marginBottom: 12 }}>Hozirgi hisobi: <Text style={{ fontWeight: '800' }}>{fmt(t.balance)} ilmzor</Text></P>
            <Row style={{ flexWrap: 'wrap' }}>{[100, 200, 500, 1000].map((v) => <Chip key={v} label={'+' + v} active={amount === String(v)} onPress={() => setAmount(String(v))} />)}</Row>
            <Field label="Summa" value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" />
            <Field label="Izoh (ixtiyoriy)" value={note} onChangeText={setNote} placeholder="Masalan: noyabr oyi uchun" autoCapitalize="sentences" />
            <Btn title="Ajratish" icon="💼" onPress={submit} loading={busy} />
          </>
        )}
      </Sheet>
    </Page>
  );
}

export function sellerTabs(me) {
  return [
    { key: 'sell', icon: '🛍️', label: 'Sotish', render: () => <Sell /> },
    { key: 'items', icon: '📦', label: 'Mahsulot', render: () => <Items /> },
    { key: 'topup', icon: '💼', label: "Pul ajratish", render: () => <TopUp /> },
    { key: 'hist', icon: '📜', label: 'Tarix', render: () => <History me={me} /> },
  ];
}

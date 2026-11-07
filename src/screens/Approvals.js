import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { supabase, q, rpc } from '../supabase';
import { C, Btn, Card, Chip, H2, P, Row, Sheet, fmtDate, useLoad, useUI } from '../ui';

// Ro'yxatdan o'tgan, hali tasdiqlanmagan o'quvchilar
export function usePending(me) {
  return useLoad(async () => {
    let gq = supabase.from('groups').select('id,name').order('name');
    if (me.role === 'teacher') gq = gq.eq('teacher_id', me.id);
    const [people, groups] = await Promise.all([
      q(supabase.from('profiles').select('id,full_name,username,requested_group,created_at').eq('role', 'pending').eq('active', true).order('created_at')),
      q(gq),
    ]);
    const mine = new Set(groups.map((g) => g.id));
    // o'qituvchi faqat o'z guruhiga yozilganlarni ko'radi
    const list = me.role === 'admin' ? people : people.filter((p) => mine.has(p.requested_group));
    return { list, groups };
  }, [me.id, me.role]);
}

export function PendingBanner({ me }) {
  const d = usePending(me);
  const [open, setOpen] = useState(false);
  const n = d.data?.list.length || 0;
  if (!n) return null;
  return (
    <>
      <Card style={{ backgroundColor: C.goldLight, borderColor: '#FCD34D' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <H2>🙋 Yangi o'quvchilar: {n}</H2>
            <P muted style={{ fontSize: 13 }}>Ro'yxatdan o'tib, tasdiqlashingizni kutmoqda</P>
          </View>
          <Btn small title="Ko'rish" onPress={() => setOpen(true)} />
        </Row>
      </Card>
      <Sheet visible={open} onClose={() => { setOpen(false); d.reload(); }} title="Ro'yxatdan o'tish so'rovlari">
        <Approvals data={d.data} reload={d.reload} />
      </Sheet>
    </>
  );
}

function Approvals({ data, reload }) {
  const { notify, ask } = useUI();
  const [chosen, setChosen] = useState({});
  const [busy, setBusy] = useState('');
  if (!data) return null;
  const { list, groups } = data;
  if (!list.length) return <P muted style={{ textAlign: 'center', padding: 20 }}>Hamma so'rovlar ko'rib chiqildi ✅</P>;

  const approve = async (p) => {
    const g = chosen[p.id] ?? p.requested_group;
    if (!g) return notify('Guruhni tanlang', 'err');
    setBusy(p.id + 'ok');
    try { await rpc('approve_registration', { p_user: p.id, p_group: g }); notify(`${p.full_name} qo'shildi`); reload(); }
    catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };
  const reject = async (p) => {
    if (!(await ask('Rad etilsinmi?', `${p.full_name} (@${p.username}) akkaunti o'chiriladi.`, 'Rad etish'))) return;
    setBusy(p.id + 'no');
    try { await rpc('reject_registration', { p_user: p.id }); notify('Rad etildi'); reload(); }
    catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };

  return (
    <View>
      <P muted style={{ marginBottom: 10, fontSize: 13 }}>Haqiqatan sizning o'quvchingiz ekanini tekshirib, tasdiqlang. Tanimasangiz — rad eting.</P>
      {list.map((p) => {
        const g = chosen[p.id] ?? p.requested_group;
        return (
          <Card key={p.id}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>{p.full_name || '(ism yozilmagan)'}</Text>
            <P muted style={{ fontSize: 13, marginBottom: 8 }}>@{p.username} · {fmtDate(p.created_at)}</P>
            <Row style={{ flexWrap: 'wrap' }}>
              {groups.map((x) => <Chip key={x.id} label={x.name} active={g === x.id} onPress={() => setChosen({ ...chosen, [p.id]: x.id })} />)}
            </Row>
            <Row style={{ gap: 10, marginTop: 4 }}>
              <Btn small kind="ghost" title="✖ Rad etish" onPress={() => reject(p)} loading={busy === p.id + 'no'} style={{ flex: 1 }} />
              <Btn small title="✅ Tasdiqlash" onPress={() => approve(p)} loading={busy === p.id + 'ok'} disabled={!g} style={{ flex: 1.3 }} />
            </Row>
          </Card>
        );
      })}
    </View>
  );
}

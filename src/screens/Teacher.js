import React, { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { supabase, q, rpc } from '../supabase';
import { C, Btn, Card, Check, Chip, Coin, Empty, ErrorBox, Field, H2, Loading, P, Page, Row, fmt, useLoad, useUI } from '../ui';
import { History, Ratings } from '../shared';
import { useMyGroups } from './Student';

function Give({ me, refreshMe }) {
  const { notify, ask } = useUI();
  const data = useLoad(async () => {
    const [groups, reasons] = await Promise.all([
      q(supabase.from('groups').select('id,name, group_members(student:profiles(id,full_name,balance,active,role))').eq('teacher_id', me.id).order('name')),
      q(supabase.from('reasons').select('*').eq('active', true).order('sort').order('id')),
    ]);
    return { groups, reasons };
  }, [me.id]);

  const [groupId, setGroupId] = useState(null);
  const [picked, setPicked] = useState({});
  const [reasonId, setReasonId] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const groups = data.data?.groups || [];
  const reasons = data.data?.reasons || [];
  useEffect(() => { if (!groupId && groups[0]) setGroupId(groups[0].id); }, [groups, groupId]);

  const group = groups.find((g) => g.id === groupId);
  const students = useMemo(() => (group?.group_members || []).map((m) => m.student)
    .filter((st) => st && st.active && st.role === 'student')
    .sort((a, b) => a.full_name.localeCompare(b.full_name)), [group]);
  const reason = reasons.find((r) => r.id === reasonId);
  const ids = students.filter((st) => picked[st.id]).map((st) => st.id);
  const per = reason ? (reason.fixed_amount || parseInt(amount, 10) || 0) : 0;
  const total = per * ids.length;
  const allPicked = students.length > 0 && ids.length === students.length;

  const toggleAll = () => {
    const next = {};
    if (!allPicked) students.forEach((st) => { next[st.id] = true; });
    setPicked(next);
  };

  const submit = async () => {
    if (!ids.length) return notify("O'quvchini tanlang", 'err');
    if (!reason) return notify('Sababni tanlang', 'err');
    if (per <= 0) return notify('Summani kiriting', 'err');
    if (total > me.balance) return notify(`Hisobingizda yetarli pul yo'q (kerak: ${fmt(total)})`, 'err');
    const ok = await ask('Pul berilsinmi?', `${ids.length} ta o'quvchiga ${fmt(per)} 🪙 dan.\nSabab: ${reason.name}\nJami: ${fmt(total)} 🪙`, 'Berish');
    if (!ok) return;
    setBusy(true);
    try {
      await rpc('give_reward', { p_students: ids, p_reason: reason.id, p_amount: reason.fixed_amount ? null : per, p_note: note.trim() || null });
      notify(`${ids.length} ta o'quvchiga ${fmt(total)} 🪙 berildi`);
      setPicked({}); setNote(''); if (!reason.fixed_amount) setAmount('');
      refreshMe(); data.reload();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };

  if (data.error) return <Page><ErrorBox text={data.error} onRetry={data.reload} /></Page>;
  if (!data.data) return <Page><Loading /></Page>;

  return (
    <Page onRefresh={() => { refreshMe(); data.reload(); }} refreshing={data.loading}>
      <Card style={{ backgroundColor: C.primaryDark, borderColor: C.primaryDark }}>
        <Text style={{ color: '#99F6E4' }}>Berish uchun hisobingizda</Text>
        <Text style={{ color: '#fff', fontSize: 36, fontWeight: '900' }}>{fmt(me.balance)} 🪙</Text>
      </Card>

      {!groups.length ? <Empty text="Sizga hali guruh biriktirilmagan. Adminga murojaat qiling." /> : (
        <>
          <H2 style={{ marginBottom: 8 }}>1. Guruh</H2>
          <Row style={{ flexWrap: 'wrap' }}>
            {groups.map((g) => <Chip key={g.id} label={g.name} active={g.id === groupId} onPress={() => { setGroupId(g.id); setPicked({}); }} />)}
          </Row>

          <H2 style={{ marginVertical: 8 }}>2. O'quvchilar ({ids.length}/{students.length})</H2>
          <Card>
            {!students.length ? <P muted>Guruhda o'quvchi yo'q</P> : (
              <>
                <Check checked={allPicked} label="Hammasini belgilash" onPress={toggleAll} />
                {students.map((st) => (
                  <Check key={st.id} checked={!!picked[st.id]} label={st.full_name}
                    onPress={() => setPicked((p) => ({ ...p, [st.id]: !p[st.id] }))}
                    right={<Coin value={st.balance} size={14} color={C.muted} />} />
                ))}
              </>
            )}
          </Card>

          <H2 style={{ marginVertical: 8 }}>3. Nima uchun?</H2>
          <Row style={{ flexWrap: 'wrap' }}>
            {reasons.map((r) => (
              <Chip key={r.id} label={`${r.name} · ${r.fixed_amount ? r.fixed_amount + ' 🪙' : 'erkin'}`}
                active={r.id === reasonId} onPress={() => setReasonId(r.id)} color={C.gold} />
            ))}
          </Row>

          {reason && (
            <Card>
              {reason.fixed_amount ? (
                <P>Summa admin tomonidan belgilangan: <Text style={{ fontWeight: '800' }}>{reason.fixed_amount} 🪙</Text></P>
              ) : (
                <Field label="Har bir o'quvchiga summa" value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Masalan: 15" />
              )}
              <Field label="Izoh (ixtiyoriy)" value={note} onChangeText={setNote} placeholder="Masalan: 20 ta so'z yodladi" style={{ marginBottom: 0, marginTop: reason.fixed_amount ? 12 : 0 }} />
            </Card>
          )}

          <Btn title={total ? `Berish · jami ${fmt(total)} 🪙` : 'Berish'} icon="⭐" onPress={submit} loading={busy}
            disabled={!ids.length || !reason || per <= 0} />
          {total > me.balance && <P style={{ color: C.danger, marginTop: 8, textAlign: 'center' }}>Hisobingizda yetarli pul yo'q</P>}
        </>
      )}
    </Page>
  );
}

function TeacherRatings({ me }) {
  const g = useMyGroups(me);
  if (!g.data) return <Page>{g.error ? <ErrorBox text={g.error} onRetry={g.reload} /> : <Loading />}</Page>;
  return <Ratings me={me} groups={g.data} />;
}

export function teacherTabs(me, refreshMe) {
  return [
    { key: 'give', icon: '⭐', label: 'Pul berish', render: () => <Give me={me} refreshMe={refreshMe} /> },
    { key: 'hist', icon: '📜', label: 'Tarix', render: () => <History me={me} /> },
    { key: 'rating', icon: '🏆', label: 'Reyting', render: () => <TeacherRatings me={me} /> },
  ];
}

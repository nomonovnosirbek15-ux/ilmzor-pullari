import React from 'react';
import { Text, View } from 'react-native';
import { supabase, q } from '../supabase';
import { CURRENCY } from '../config';
import { Banknotes, C, Card, ErrorBox, H2, P, Page, Row, fmt, useLoad } from '../ui';
import { Ratings, ShopCatalog, TxList, useTx } from '../shared';
import { StudentTasks } from './Tasks';

export function useMyGroups(me) {
  return useLoad(async () => {
    if (me.role === 'student') {
      const rows = await q(supabase.from('group_members').select('group:groups(id,name)').eq('student_id', me.id));
      return rows.map((r) => r.group).filter(Boolean);
    }
    if (me.role === 'teacher') return q(supabase.from('groups').select('id,name').eq('teacher_id', me.id).order('name'));
    return q(supabase.from('groups').select('id,name').order('name'));
  }, [me.id, me.role]);
}

function Wallet({ me, refreshMe }) {
  const tx = useTx({ userId: me.id, limit: 200 });
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const month = (tx.data || []).filter((t) => new Date(t.created_at) >= monthStart);
  const earned = month.filter((t) => t.type === 'reward').reduce((a, t) => a + t.amount, 0);
  const spent = month.filter((t) => t.type === 'purchase').reduce((a, t) => a + t.amount, 0);
  const reload = () => { refreshMe(); tx.reload(); };

  return (
    <Page onRefresh={reload} refreshing={tx.loading && !!tx.data}>
      <Card style={{ backgroundColor: C.primary, borderColor: C.primary, paddingVertical: 24, alignItems: 'center' }}>
        <Text style={{ color: '#D3F5E6', fontSize: 15 }}>Mening hisobim</Text>
        <Text style={{ color: '#fff', fontSize: 52, fontWeight: '900', marginVertical: 4 }}>{fmt(me.balance)}</Text>
        <Text style={{ color: '#FDE68A', fontSize: 15, fontWeight: '700' }}>{CURRENCY}</Text>
      </Card>
      <Card>
        <H2 style={{ marginBottom: 12 }}>Mening pullarim</H2>
        <Banknotes amount={me.balance} />
      </Card>
      <Row style={{ gap: 12, marginBottom: 12 }}>
        <View style={{ flex: 1, backgroundColor: C.successLight, borderRadius: 14, padding: 14 }}>
          <Text style={{ color: C.success, fontSize: 13 }}>Shu oy topdim</Text>
          <Text style={{ color: C.success, fontSize: 24, fontWeight: '800' }}>+{fmt(earned)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: C.dangerLight, borderRadius: 14, padding: 14 }}>
          <Text style={{ color: C.danger, fontSize: 13 }}>Shu oy sarfladim</Text>
          <Text style={{ color: C.danger, fontSize: 24, fontWeight: '800' }}>−{fmt(spent)}</Text>
        </View>
      </Row>
      <H2 style={{ marginBottom: 8 }}>Tarix</H2>
      {tx.error ? <ErrorBox text={tx.error} onRetry={tx.reload} /> : <TxList items={tx.data} viewerId={me.id} />}
      <P muted style={{ textAlign: 'center', fontSize: 12 }}>Pastga tortib yangilang</P>
    </Page>
  );
}

export function studentTabs(me, refreshMe) {
  return [
    { key: 'wallet', icon: '👛', label: 'Hisobim', render: () => <Wallet me={me} refreshMe={refreshMe} /> },
    { key: 'tasks', icon: '📝', label: 'Vazifalar', render: () => <StudentTasks me={me} refreshMe={refreshMe} /> },
    { key: 'shop', icon: '🛍️', label: "Do'kon", render: () => <ShopCatalog balance={me.balance} /> },
    { key: 'rating', icon: '🏆', label: 'Reyting', render: () => <StudentRatings me={me} /> },
  ];
}

function StudentRatings({ me }) {
  const g = useMyGroups(me);
  if (!g.data) return <Page>{g.error ? <ErrorBox text={g.error} onRetry={g.reload} /> : null}</Page>;
  return <Ratings me={me} groups={g.data} />;
}

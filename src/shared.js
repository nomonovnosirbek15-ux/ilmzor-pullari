import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { supabase, rpc, q } from './supabase';
import { C, Card, Chip, Coin, Empty, ErrorBox, H2, ListRow, Loading, P, Page, Row, Segment, fmt, fmtDate, s, useLoad } from './ui';

const MEDAL = ['🥇', '🥈', '🥉'];
const PERIODS = [['week', 'Hafta'], ['month', 'Oy'], ['all', 'Umumiy']];

/* ---------- Reyting ---------- */
// groups: foydalanuvchiga ko'rinadigan guruhlar [{id,name}]
export function Ratings({ me, groups }) {
  const [scope, setScope] = useState(groups && groups.length ? 'group' : 'center');
  const [period, setPeriod] = useState('month');
  const [groupId, setGroupId] = useState(groups && groups[0] ? groups[0].id : null);
  const gid = scope === 'group' ? groupId : null;
  const { data, loading, error, reload } = useLoad(
    () => (scope === 'group' && !gid ? Promise.resolve([]) : rpc('leaderboard', { p_period: period, p_group: gid })),
    [scope, period, gid],
  );
  const mine = data && data.find((r) => r.student_id === me.id);

  return (
    <Page onRefresh={reload} refreshing={loading && !!data}>
      <Segment options={[['group', 'Guruh'], ['center', 'Markaz']]} value={scope} onChange={setScope} />
      {scope === 'group' && (
        groups && groups.length ? (
          <Row style={{ flexWrap: 'wrap' }}>
            {groups.map((g) => <Chip key={g.id} label={g.name} active={groupId === g.id} onPress={() => setGroupId(g.id)} />)}
          </Row>
        ) : <P muted style={{ marginBottom: 12 }}>Guruh yo'q</P>
      )}
      <Segment options={PERIODS} value={period} onChange={setPeriod} />

      {mine && (
        <Card style={{ backgroundColor: C.primaryDark, borderColor: C.primaryDark }}>
          <Text style={{ color: '#8EE8BF', fontSize: 14 }}>Sizning o'rningiz</Text>
          <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ color: '#fff', fontSize: 34, fontWeight: '900' }}>{MEDAL[mine.place - 1] || ''} {mine.place}-o'rin</Text>
            <Text style={{ color: '#FDE68A', fontSize: 16, fontWeight: '700' }}>{data.length} ta o'quvchidan</Text>
          </Row>
          <Text style={{ color: '#fff', marginTop: 4 }}>Topilgan: {fmt(mine.earned)} ilmzor</Text>
        </Card>
      )}

      {error ? <ErrorBox text={error} onRetry={reload} /> : !data ? <Loading /> : !data.length ? <Empty /> : (
        <Card>
          {data.map((r) => {
            const isMe = r.student_id === me.id;
            return (
              <View key={r.student_id} style={[s.listRow, isMe && { backgroundColor: C.goldLight, borderRadius: 10, paddingHorizontal: 8 }]}>
                <Text style={{ width: 44, fontSize: r.place <= 3 ? 24 : 16, fontWeight: '800', color: C.muted, textAlign: 'center' }}>
                  {MEDAL[r.place - 1] || r.place}
                </Text>
                <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>{r.full_name}{isMe ? ' (siz)' : ''}</Text>
                <Coin value={r.earned} color={C.primaryDark} />
              </View>
            );
          })}
        </Card>
      )}
      <P muted style={{ textAlign: 'center', fontSize: 12 }}>Reyting tanlangan davrda topilgan pul bo'yicha. Xarid reytingni kamaytirmaydi.</P>
    </Page>
  );
}

/* ---------- Tranzaksiyalar tarixi ---------- */
const TX_SELECT = '*, reason:reasons(name), item:shop_items(name), sender:profiles!transactions_from_id_fkey(full_name), receiver:profiles!transactions_to_id_fkey(full_name)';

export function useTx({ userId, types, limit = 100 }) {
  return useLoad(async () => {
    let query = supabase.from('transactions').select(TX_SELECT).order('created_at', { ascending: false }).limit(limit);
    if (userId) query = query.or(`from_id.eq.${userId},to_id.eq.${userId}`);
    if (types) query = query.in('type', types);
    return q(query);
  }, [userId, (types || []).join(), limit]);
}

export function txView(t, viewerId) {
  const name = (p) => (p && p.full_name) || '—';
  switch (t.type) {
    case 'reward':
      if (t.assignment_id) return { icon: '📝', title: `Vazifa: ${t.note || ''}`, sub: `${name(t.sender)} → ${name(t.receiver)}`, plus: t.from_id !== viewerId, hideNote: true };
      return { icon: '⭐', title: t.reason?.name || "Rag'bat", sub: `${name(t.sender)} → ${name(t.receiver)}`, plus: t.from_id !== viewerId };
    case 'purchase':
      return { icon: '🛍️', title: `${t.item?.name || 'Mahsulot'}${t.quantity > 1 ? ' × ' + t.quantity : ''}`, sub: `Xarid: ${name(t.sender)}`, plus: false };
    case 'allocation':
      return { icon: '💼', title: 'Hisobga pul ajratildi', sub: name(t.receiver), plus: true };
    default:
      return { icon: '🛠️', title: 'Tuzatish (admin)', sub: name(t.receiver || t.sender), plus: !!t.to_id };
  }
}

export function TxList({ items, viewerId }) {
  if (!items) return <Loading />;
  if (!items.length) return <Empty text="Hali amallar yo'q" />;
  return (
    <Card>
      {items.map((t) => {
        const v = txView(t, viewerId);
        return (
          <ListRow
            key={t.id}
            left={<Text style={{ fontSize: 24 }}>{v.icon}</Text>}
            title={v.title}
            sub={`${v.sub}${t.note && !v.hideNote ? ' · ' + t.note : ''}\n${fmtDate(t.created_at)}`}
            right={<Coin value={t.amount} sign={v.plus ? '+' : '−'} color={v.plus ? C.success : C.danger} />}
          />
        );
      })}
    </Card>
  );
}

export function History({ me, types, title }) {
  const { data, error, reload, loading } = useTx({ userId: me.role === 'admin' || me.role === 'seller' ? null : me.id, types });
  return (
    <Page onRefresh={reload} refreshing={loading && !!data}>
      {!!title && <H2 style={{ marginBottom: 12 }}>{title}</H2>}
      {error ? <ErrorBox text={error} onRetry={reload} /> : <TxList items={data} viewerId={me.role === 'admin' || me.role === 'seller' ? null : me.id} />}
    </Page>
  );
}

/* ---------- Do'kon katalogi (o'quvchi uchun) ---------- */
export function ShopCatalog({ balance }) {
  const { data, error, reload, loading } = useLoad(() => q(supabase.from('shop_items').select('*').eq('active', true).order('category').order('price')), []);
  const [cat, setCat] = useState('Hammasi');
  const cats = ['Hammasi', ...new Set((data || []).map((i) => i.category))];
  const list = (data || []).filter((i) => cat === 'Hammasi' || i.category === cat);
  return (
    <Page onRefresh={reload} refreshing={loading && !!data}>
      <Card style={{ backgroundColor: C.goldLight, borderColor: '#FCD34D' }}>
        <P>Sizda: <Text style={{ fontWeight: '800' }}>{fmt(balance)} ilmzor</Text></P>
        <P muted style={{ marginTop: 4, fontSize: 13 }}>Narsa olish uchun do'kondagi sotuvchiga murojaat qiling.</P>
      </Card>
      <Row style={{ flexWrap: 'wrap' }}>{cats.map((c) => <Chip key={c} label={c} active={cat === c} onPress={() => setCat(c)} />)}</Row>
      {error ? <ErrorBox text={error} onRetry={reload} /> : !data ? <Loading /> : !list.length ? <Empty text="Do'konda hozircha narsa yo'q" /> : (
        <Card>
          {list.map((i) => {
            const can = balance >= i.price;
            return (
              <ListRow
                key={i.id}
                title={i.name}
                sub={`${i.category} · ${i.stock > 0 ? `Omborda: ${i.stock}` : 'Tugagan'}${!can && i.stock > 0 ? ` · Yana ${fmt(i.price - balance)} ilmzor kerak` : ''}`}
                right={<Coin value={i.price} color={can && i.stock > 0 ? C.success : C.muted} />}
              />
            );
          })}
        </Card>
      )}
    </Page>
  );
}

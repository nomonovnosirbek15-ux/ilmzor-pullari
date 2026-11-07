import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { supabase, q, rpc, askAI } from '../supabase';
import { useSettings } from '../settings';
import { pickDocument, pickPhoto, uploadAsset, signedUrl, openFile, kindOf } from '../files';
import {
  C, Btn, Card, Chip, Coin, Empty, ErrorBox, Field, H2, ListRow, Loading, P, Page, Row, Segment, Sheet, fmt, fmtDate, s, useLoad, useUI,
} from '../ui';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const STATUS = {
  pending: ['⏳ Tekshirilmoqda', C.gold],
  rejected: ['↩️ Qaytarildi', C.danger],
  unpaid: ["💤 To'lov kutilmoqda", C.blue],
  paid: ['✅ Bajarildi', C.success],
};

const rewardText = (a) => a.kind === 'task' ? `${fmt(a.reward_amount)} ilmzor`
  : a.reward_mode === 'per_correct' ? `har to'g'ri javobga ${fmt(a.per_correct)} ilmzor`
    : `${a.threshold_pct}% dan oshsa ${fmt(a.reward_amount)} ilmzor`;
const maxReward = (a) => a.kind === 'task' ? a.reward_amount : a.reward_mode === 'per_correct' ? a.per_correct * a.question_count : a.reward_amount;
const expired = (a) => a.deadline && new Date(a.deadline) < new Date();

/* ---------- Umumiy: fayl ko'rinishi ---------- */
function FileView({ bucket, path, type }) {
  const { notify } = useUI();
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let ok = true;
    if (path && type !== 'pdf') signedUrl(bucket, path).then((u) => ok && setUrl(u)).catch(() => {});
    return () => { ok = false; };
  }, [bucket, path, type]);
  if (!path) return null;
  const open = () => openFile(bucket, path).catch((e) => notify(e.message, 'err'));
  if (type === 'pdf') return <Btn kind="light" icon="📄" title="PDF faylni ochish" onPress={open} style={{ marginBottom: 12 }} />;
  return (
    <Pressable onPress={open} style={{ marginBottom: 12 }}>
      {url ? <Image source={{ uri: url }} style={{ width: '100%', height: 360, borderRadius: 12, backgroundColor: '#E2E8F0' }} resizeMode="contain" />
        : <View style={{ height: 120, borderRadius: 12, backgroundColor: '#E2E8F0' }} />}
      <Text style={[s.small, { textAlign: 'center', marginTop: 4 }]}>Kattalashtirish uchun bosing</Text>
    </Pressable>
  );
}

/* ---------- Umumiy: javoblar jadvali ---------- */
function AnswerGrid({ count, options, value, onChange, results, keyAnswers, highlight, onAsk }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <Row key={i} style={{ paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: highlight?.[i] ? C.goldLight : 'transparent', borderRadius: 8 }}>
          <Text style={{ width: 40, fontWeight: '800', color: C.text, paddingLeft: 4 }}>{i + 1}.</Text>
          <Row style={{ flex: 1, flexWrap: 'wrap', gap: 6 }}>
            {LETTERS.slice(0, options).map((L) => {
              const on = value[i] === L;
              const isKey = keyAnswers && keyAnswers[i] === L;
              const bad = results && on && !results[i];
              const bg = bad ? C.danger : on ? C.primary : isKey ? C.successLight : '#fff';
              return (
                <Pressable key={L} disabled={!onChange} onPress={() => { const v = [...value]; v[i] = on ? '' : L; onChange(v); }}
                  style={{ width: 40, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
                    borderColor: isKey ? C.success : on ? bg : C.border, backgroundColor: bg }}>
                  <Text style={{ fontWeight: '800', color: on || bad ? '#fff' : C.text }}>{L}</Text>
                </Pressable>
              );
            })}
          </Row>
          {results && (onAsk && !results[i] ? (
            <Pressable onPress={() => onAsk(i + 1)} style={{ backgroundColor: '#EDE9FE', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#6D28D9' }}>🤖 Yordam</Text>
            </Pressable>
          ) : <Text style={{ fontSize: 20, width: 30, textAlign: 'center' }}>{results[i] ? '✅' : '❌'}</Text>)}
        </Row>
      ))}
    </View>
  );
}

/* =====================================================================
   O'QITUVCHI / ADMIN
   ===================================================================== */
export function ManageTasks({ me }) {
  const { notify } = useUI();
  const { can } = useSettings();
  const canUpload = me.role === 'admin' || can('teacher_upload_tasks');
  const isAdmin = me.role === 'admin';
  const d = useLoad(async () => {
    let aq = supabase.from('assignments').select('*, assignment_groups(group_id), submissions(id,status)').order('created_at', { ascending: false });
    if (!isAdmin) aq = aq.eq('created_by', me.id);
    let gq = supabase.from('groups').select('id,name').order('name');
    if (!isAdmin) gq = gq.eq('teacher_id', me.id);
    const [assignments, groups] = await Promise.all([q(aq), q(gq)]);
    return { assignments, groups };
  }, [me.id, isAdmin]);
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [paying, setPaying] = useState(false);

  if (d.error) return <Page><ErrorBox text={d.error} onRetry={d.reload} /></Page>;
  if (!d.data) return <Page><Loading /></Page>;
  const { assignments, groups } = d.data;
  const gName = (id) => groups.find((g) => g.id === id)?.name;
  const pending = assignments.reduce((n, a) => n + a.submissions.filter((x) => x.status === 'pending').length, 0);
  const unpaid = assignments.reduce((n, a) => n + a.submissions.filter((x) => x.status === 'unpaid').length, 0);
  const current = assignments.find((a) => a.id === openId);

  const payAll = async () => {
    setPaying(true);
    try { const n = await rpc('pay_pending'); notify(n ? `${n} ta javob to'landi` : "Hisobingizda yetarli pul yo'q", n ? 'ok' : 'err'); d.reload(); }
    catch (e) { notify(e.message, 'err'); }
    setPaying(false);
  };

  return (
    <Page onRefresh={d.reload} refreshing={d.loading}>
      {canUpload ? <Btn title="Yangi test yoki vazifa" icon="➕" onPress={() => setEditing({})} style={{ marginBottom: 12 }} disabled={!groups.length} />
        : <Card style={{ backgroundColor: C.dangerLight, borderColor: 'transparent' }}><P>⛔ Vazifa yuklash admin tomonidan yopilgan.</P></Card>}
      {!groups.length && <P muted style={{ marginBottom: 12 }}>Avval sizga guruh biriktirilishi kerak.</P>}
      {pending > 0 && (
        <Card style={{ backgroundColor: C.goldLight, borderColor: '#FCD34D' }}>
          <H2>⏳ Tekshirish kutilmoqda: {pending}</H2>
          <P muted style={{ fontSize: 13 }}>Rasmli vazifalarni ochib, qabul qiling yoki qaytaring.</P>
        </Card>
      )}
      {unpaid > 0 && (
        <Card style={{ backgroundColor: '#DBEAFE', borderColor: '#93C5FD' }}>
          <H2>💤 To'lanmagan: {unpaid} ta javob</H2>
          <P muted style={{ fontSize: 13, marginBottom: 10 }}>Hisobingizda pul yetmagani uchun o'quvchilarga hali tushmagan. Hisob to'ldirilgach "To'lash"ni bosing.</P>
          <Btn small title="To'lash" onPress={payAll} loading={paying} style={{ alignSelf: 'flex-start' }} />
        </Card>
      )}
      {!assignments.length ? <Empty text="Hali vazifa yo'q. Test yoki rasmli vazifa yuklang — o'quvchilar bajarib pul ishlaydi." /> : (
        <Card>
          {assignments.map((a) => {
            const p = a.submissions.filter((x) => x.status === 'pending').length;
            return (
              <ListRow key={a.id}
                left={<Text style={{ fontSize: 24 }}>{a.kind === 'test' ? '📝' : '📸'}</Text>}
                title={(a.active ? '' : '🚫 ') + a.title}
                sub={`${a.assignment_groups.map((g) => gName(g.group_id)).filter(Boolean).join(', ') || '—'} · ${a.submissions.length} javob${p ? ` · ⏳ ${p}` : ''}${a.deadline ? `\n⏰ ${fmtDate(a.deadline)}${expired(a) ? ' (tugagan)' : ''}` : ''}`}
                onPress={() => setOpenId(a.id)} />
            );
          })}
        </Card>
      )}

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Tahrirlash' : 'Yangi test yoki vazifa'}>
        {editing && <Editor me={me} initial={editing} groups={groups} onDone={() => { setEditing(null); d.reload(); }} />}
      </Sheet>
      <Sheet visible={!!current} onClose={() => setOpenId(null)} title={current?.title || ''}>
        {current && <Detail a={current} gName={gName} onEdit={async () => {
          let answers = null;
          if (current.kind === 'test') {
            const k = await q(supabase.from('assignment_keys').select('answers').eq('assignment_id', current.id).maybeSingle());
            answers = k?.answers || null;
          }
          setOpenId(null); setEditing({ ...current, answers });
        }} onChanged={d.reload} onClosed={() => { setOpenId(null); d.reload(); }} />}
      </Sheet>
    </Page>
  );
}

const DEADLINES = [[null, 'Muddatsiz'], [0, 'Bugun'], [2, '3 kun'], [6, '1 hafta'], [13, '2 hafta']];
const endOfDay = (plusDays) => { const d = new Date(); d.setDate(d.getDate() + plusDays); d.setHours(23, 59, 0, 0); return d.toISOString(); };

function Editor({ initial, groups, onDone }) {
  const { notify } = useUI();
  const [f, setF] = useState(() => ({
    title: initial.title || '', description: initial.description || '', kind: initial.kind || 'test',
    n: initial.question_count ? String(initial.question_count) : '10', options: initial.option_count || 4,
    answers: initial.answers || [], keyText: '',
    mode: initial.reward_mode || 'per_correct', per: initial.per_correct ? String(initial.per_correct) : '2',
    pct: initial.threshold_pct ? String(initial.threshold_pct) : '80', amount: initial.reward_amount ? String(initial.reward_amount) : '',
    deadline: initial.deadline || null, groups: initial.assignment_groups ? initial.assignment_groups.map((g) => g.group_id) : (groups.length === 1 ? [groups[0].id] : []),
    active: initial.active !== false,
    attempts: initial.id ? (initial.max_attempts ?? null) : 3, showKey: initial.show_key !== false,
  }));
  const [asset, setAsset] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const n = Math.min(200, Math.max(0, parseInt(f.n, 10) || 0));
  const answers = useMemo(() => Array.from({ length: n }, (_, i) => f.answers[i] || ''), [n, f.answers]);
  const filled = answers.filter(Boolean).length;

  const applyKeyText = (t) => {
    set('keyText', t);
    const letters = t.toUpperCase().replace(/[^A-F]/g, '').split('').filter((L) => LETTERS.indexOf(L) < f.options);
    if (letters.length) set('answers', letters.slice(0, n));
  };

  const choose = async () => {
    try { const a = await pickDocument(); if (a) setAsset(a); } catch (e) { notify(e.message, 'err'); }
  };

  const save = async () => {
    if (!f.title.trim()) return notify('Sarlavhani kiriting', 'err');
    if (!f.groups.length) return notify('Guruhni tanlang', 'err');
    if (f.kind === 'test' && filled < n) return notify(`Javob kaliti to'liq emas (${filled}/${n})`, 'err');
    setBusy(true);
    try {
      let path = null; let type = null;
      if (asset) { path = await uploadAsset('assignments', 'files', asset); type = kindOf(asset); }
      await rpc('save_assignment', {
        p_id: initial.id || null, p_title: f.title.trim(), p_description: f.description.trim() || null, p_kind: f.kind,
        p_file_path: path, p_file_type: type,
        p_question_count: f.kind === 'test' ? n : null, p_option_count: f.options,
        p_answers: f.kind === 'test' ? answers : null,
        p_reward_mode: f.kind === 'test' ? f.mode : null,
        p_per_correct: parseInt(f.per, 10) || null, p_threshold_pct: parseInt(f.pct, 10) || null, p_reward_amount: parseInt(f.amount, 10) || null,
        p_deadline: f.deadline, p_groups: f.groups, p_active: f.active,
        p_max_attempts: f.kind === 'test' ? f.attempts : null, p_show_key: f.showKey,
      });
      notify(initial.id ? 'Saqlandi' : "Yuklandi — o'quvchilar ko'ra oladi");
      onDone();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };

  const max = f.kind === 'task' ? parseInt(f.amount, 10) || 0 : f.mode === 'per_correct' ? (parseInt(f.per, 10) || 0) * n : parseInt(f.amount, 10) || 0;

  return (
    <>
      <Segment options={[['test', '📝 Test (avtomatik)'], ['task', '📸 Vazifa (rasm)']]} value={f.kind} onChange={(v) => set('kind', v)} />
      <P muted style={{ fontSize: 13, marginBottom: 12 }}>
        {f.kind === 'test' ? "O'quvchi javoblarni belgilaydi, ilova kalit bo'yicha darhol tekshirib pul beradi."
          : "O'quvchi yechimini rasmga olib yuboradi, siz ko'rib qabul qilsangiz pul tushadi."}
      </P>
      <Field label="Sarlavha" value={f.title} onChangeText={(v) => set('title', v)} autoCapitalize="sentences" placeholder="Masalan: Kasrlar — 1-test" />
      <Field label="Izoh (ixtiyoriy)" value={f.description} onChangeText={(v) => set('description', v)} autoCapitalize="sentences" multiline placeholder="Masalan: 5-10 misollarni yeching" />

      <P style={{ fontWeight: '600', marginBottom: 6 }}>Fayl (PDF yoki rasm)</P>
      <Card>
        {asset ? <P>📎 {asset.name || 'Tanlangan fayl'} ({kindOf(asset) === 'pdf' ? 'PDF' : 'rasm'})</P>
          : initial.file_path ? <P>📎 Avval yuklangan fayl saqlanadi</P> : <P muted>Fayl tanlanmagan</P>}
        <Btn small kind="ghost" title={asset || initial.file_path ? 'Boshqa fayl tanlash' : 'Fayl tanlash'} onPress={choose} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
      </Card>

      <P style={{ fontWeight: '600', marginBottom: 6 }}>Qaysi guruhlarga</P>
      <Row style={{ flexWrap: 'wrap' }}>
        {groups.map((g) => {
          const on = f.groups.includes(g.id);
          return <Chip key={g.id} label={g.name} active={on} onPress={() => set('groups', on ? f.groups.filter((x) => x !== g.id) : [...f.groups, g.id])} />;
        })}
      </Row>

      {f.kind === 'test' && (
        <>
          <Row style={{ gap: 12 }}>
            <Field style={{ flex: 1 }} label="Savollar soni" value={f.n} onChangeText={(v) => set('n', v.replace(/\D/g, ''))} keyboardType="number-pad" />
            <View style={{ flex: 1, marginBottom: 12 }}>
              <Text style={s.label}>Variantlar</Text>
              <Row style={{ flexWrap: 'wrap' }}>{[3, 4, 5].map((o) => <Chip key={o} label={String(o)} active={f.options === o} onPress={() => set('options', o)} />)}</Row>
            </View>
          </Row>
          <H2 style={{ marginBottom: 6 }}>Javob kaliti ({filled}/{n})</H2>
          <Field value={f.keyText} onChangeText={applyKeyText} autoCapitalize="characters" placeholder="Tezkor: ABCDA BCDAB ..." hint="Harflarni ketma-ket yozsangiz, pastdagi jadval o'zi to'ladi" />
          {n > 0 && <Card><AnswerGrid count={n} options={f.options} value={answers} onChange={(v) => set('answers', v)} /></Card>}

          <H2 style={{ marginBottom: 6 }}>Mukofot</H2>
          <Segment options={[['per_correct', "Har to'g'ri javobga"], ['threshold', 'Foizdan oshsa']]} value={f.mode} onChange={(v) => set('mode', v)} />
          {f.mode === 'per_correct' ? (
            <Field label="Har bir to'g'ri javob uchun (ilmzor)" value={f.per} onChangeText={(v) => set('per', v.replace(/\D/g, ''))} keyboardType="number-pad" />
          ) : (
            <Row style={{ gap: 12 }}>
              <Field style={{ flex: 1 }} label="Kamida (%)" value={f.pct} onChangeText={(v) => set('pct', v.replace(/\D/g, ''))} keyboardType="number-pad" />
              <Field style={{ flex: 1 }} label="Mukofot (ilmzor)" value={f.amount} onChangeText={(v) => set('amount', v.replace(/\D/g, ''))} keyboardType="number-pad" />
            </Row>
          )}
        </>
      )}
      {f.kind === 'task' && (
        <Field label="Qabul qilinsa beriladigan pul (ilmzor)" value={f.amount} onChangeText={(v) => set('amount', v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Masalan: 20" />
      )}
      {max > 0 && <P muted style={{ marginTop: -4, marginBottom: 12, fontSize: 13 }}>Bitta o'quvchi ko'pi bilan {fmt(max)} ilmzor oladi. Pul sizning hisobingizdan ayriladi.</P>}

      {f.kind === 'test' && (
        <>
          <P style={{ fontWeight: '600', marginBottom: 6 }}>Necha marta ishlash mumkin</P>
          <Row style={{ flexWrap: 'wrap' }}>
            {[[1, '1'], [2, '2'], [3, '3'], [5, '5'], [null, 'Cheksiz']].map(([v, l]) => <Chip key={l} label={l} active={f.attempts === v} onPress={() => set('attempts', v)} />)}
          </Row>
          <P muted style={{ fontSize: 13, marginBottom: 8 }}>Pul faqat eng yuqori natija uchun beriladi — qayta ishlab, ortiqcha pul olib bo'lmaydi.</P>
          <Row style={{ marginBottom: 12 }}>
            <Chip label="Oxirida to'g'ri javoblarni ko'rsatish" active={f.showKey} onPress={() => set('showKey', !f.showKey)} />
          </Row>
        </>
      )}
      <P style={{ fontWeight: '600', marginBottom: 6 }}>Muddat</P>
      <Row style={{ flexWrap: 'wrap' }}>
        {DEADLINES.map(([v, l]) => {
          const val = v === null ? null : endOfDay(v);
          const on = v === null ? !f.deadline : f.deadline && new Date(f.deadline).toDateString() === new Date(val).toDateString();
          return <Chip key={l} label={l} active={!!on} onPress={() => set('deadline', val)} />;
        })}
      </Row>
      {f.deadline && <P muted style={{ fontSize: 13, marginBottom: 10 }}>⏰ {fmtDate(f.deadline)} gacha</P>}

      {initial.id && (
        <Row style={{ marginBottom: 12 }}>
          <Chip label="Faol" active={f.active} onPress={() => set('active', true)} />
          <Chip label="Yashirilgan" active={!f.active} color={C.danger} onPress={() => set('active', false)} />
        </Row>
      )}
      <Btn title={initial.id ? 'Saqlash' : 'Yuklash'} icon="📤" onPress={save} loading={busy} />
      <View style={{ height: 30 }} />
    </>
  );
}

function Detail({ a, gName, onEdit, onChanged, onClosed }) {
  const { notify, ask } = useUI();
  const subs = useLoad(() => q(supabase.from('submissions').select('*, student:profiles!submissions_student_id_fkey(full_name)')
    .eq('assignment_id', a.id).order('status').order('created_at', { ascending: false })), [a.id]);
  const [review, setReview] = useState(null);
  const [aiQ, setAiQ] = useState(null);
  const [aiNum, setAiNum] = useState('1');

  const del = async () => {
    if (!(await ask("O'chirilsinmi?", "Javoblar to'langan bo'lsa, vazifa faqat yashiriladi (tarix saqlanadi).", "O'chirish"))) return;
    try { await rpc('delete_assignment', { p_id: a.id }); notify("O'chirildi"); onClosed(); } catch (e) { notify(e.message, 'err'); }
  };

  const list = subs.data || [];
  const done = list.filter((x) => x.status === 'paid' || x.status === 'unpaid');
  const avg = a.kind === 'test' && done.length ? Math.round(done.reduce((t, x) => t + (x.correct / x.total) * 100, 0) / done.length) : null;
  const paid = list.filter((x) => x.status === 'paid').reduce((t, x) => t + x.reward, 0);

  return (
    <>
      <P muted style={{ marginBottom: 8 }}>
        {a.kind === 'test' ? `📝 Test · ${a.question_count} savol` : '📸 Rasmli vazifa'} · {rewardText(a)}
        {'\n'}Guruhlar: {a.assignment_groups.map((g) => gName(g.group_id)).filter(Boolean).join(', ')}
        {a.deadline ? `\n⏰ ${fmtDate(a.deadline)} gacha${expired(a) ? ' (tugagan)' : ''}` : ''}
      </P>
      {!!a.description && <P style={{ marginBottom: 10 }}>{a.description}</P>}
      <FileView bucket="assignments" path={a.file_path} type={a.file_type} />
      <Row style={{ gap: 10, marginBottom: 12 }}>
        <Btn small kind="ghost" title="✏️ Tahrirlash" onPress={onEdit} style={{ flex: 1 }} />
        <Btn small kind="danger" title="O'chirish" onPress={del} style={{ flex: 1 }} />
      </Row>

      <Row style={{ gap: 10, marginBottom: 12 }}>
        <View style={[s.stat, { borderLeftColor: C.blue }]}><Text style={s.small}>Javoblar</Text><Text style={[s.statValue, { color: C.blue }]}>{list.length}</Text></View>
        {avg !== null && <View style={[s.stat, { borderLeftColor: C.gold }]}><Text style={s.small}>O'rtacha natija</Text><Text style={[s.statValue, { color: C.gold }]}>{avg}%</Text></View>}
        <View style={[s.stat, { borderLeftColor: C.success }]}><Text style={s.small}>Berilgan</Text><Text style={[s.statValue, { color: C.success }]}>{fmt(paid)} ilmzor</Text></View>
      </Row>

      {a.kind === 'test' && a.file_path && (
        <Card style={{ backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }}>
          <P style={{ fontWeight: '700', marginBottom: 6 }}>🤖 AI yordamchini sinab ko'ring</P>
          <P muted style={{ fontSize: 13, marginBottom: 8 }}>O'quvchilar xato qilgan savolda "Yordam" bosganda shunday tushuntirish va o'xshash misollar ko'radi.</P>
          <Row style={{ gap: 10 }}>
            <Field style={{ width: 90, marginBottom: 0 }} value={aiNum} onChangeText={(v) => setAiNum(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Savol" />
            <Btn small title="Sinash" onPress={() => { const n = parseInt(aiNum, 10); if (n >= 1 && n <= a.question_count) setAiQ(n); }} style={{ flex: 1 }} />
          </Row>
        </Card>
      )}
      <Sheet visible={!!aiQ} onClose={() => setAiQ(null)} title={aiQ ? `🤖 ${aiQ}-savol (sinov)` : ''}>
        {aiQ && <AiHelp a={a} q={aiQ} />}
      </Sheet>
      <H2 style={{ marginBottom: 8 }}>O'quvchilar javoblari</H2>
      {subs.error ? <ErrorBox text={subs.error} onRetry={subs.reload} /> : !subs.data ? <Loading /> : !list.length ? <Empty text="Hali hech kim topshirmagan" /> : (
        <Card>
          {list.map((x) => (
            <ListRow key={x.id} title={x.student?.full_name || '—'}
              sub={`${STATUS[x.status][0]}${x.total ? ` · eng yaxshi ${x.correct}/${x.total} (${Math.round((x.correct / x.total) * 100)}%)` : ''}${a.kind === 'test' && x.attempts > 1 ? ` · ${x.attempts} urinish` : ''} · ${fmtDate(x.created_at)}`}
              right={x.reward > 0 ? <Coin value={x.reward} size={14} color={x.status === 'paid' ? C.success : C.muted} /> : null}
              onPress={a.kind === 'task' ? () => setReview(x) : undefined} />
          ))}
        </Card>
      )}
      <Sheet visible={!!review} onClose={() => setReview(null)} title={review?.student?.full_name || ''}>
        {review && <Review sub={review} a={a} onDone={() => { setReview(null); subs.reload(); onChanged(); }} />}
      </Sheet>
      <View style={{ height: 30 }} />
    </>
  );
}

function Review({ sub, a, onDone }) {
  const { notify } = useUI();
  const [comment, setComment] = useState(sub.comment || '');
  const [busy, setBusy] = useState('');
  const act = async (approve) => {
    if (!approve && !comment.trim()) return notify("Qaytarish sababini yozing (o'quvchi ko'radi)", 'err');
    setBusy(approve ? 'ok' : 'no');
    try {
      const r = await rpc('review_submission', { p_sub: sub.id, p_approve: approve, p_comment: comment.trim() || null });
      notify(r === 'paid' ? `Qabul qilindi: +${fmt(a.reward_amount)} ilmzor` : r === 'unpaid' ? "Qabul qilindi, lekin hisobingizda pul yetmadi — keyin to'lanadi" : 'Qaytarildi', r === 'unpaid' ? 'err' : 'ok');
      onDone();
    } catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };
  return (
    <>
      <P muted style={{ marginBottom: 8 }}>{STATUS[sub.status][0]} · {fmtDate(sub.created_at)}</P>
      {!!sub.answers?.[0] && <Card><P>💬 {sub.answers[0]}</P></Card>}
      <FileView bucket="submissions" path={sub.file_path} type="image" />
      {sub.status === 'pending' ? (
        <>
          <Field label="Izoh (o'quvchi ko'radi)" value={comment} onChangeText={setComment} autoCapitalize="sentences" placeholder="Masalan: Barakalla! / 3-misolni qayta tekshir" />
          <Row style={{ gap: 10 }}>
            <Btn kind="danger" title="↩️ Qaytarish" onPress={() => act(false)} loading={busy === 'no'} style={{ flex: 1 }} />
            <Btn title={`✅ Qabul (+${fmt(a.reward_amount)})`} onPress={() => act(true)} loading={busy === 'ok'} style={{ flex: 1.4 }} />
          </Row>
        </>
      ) : !!sub.comment && <Card><P>Izoh: {sub.comment}</P></Card>}
      <View style={{ height: 30 }} />
    </>
  );
}

/* =====================================================================
   O'QUVCHI
   ===================================================================== */
export function StudentTasks({ me, refreshMe }) {
  const d = useLoad(async () => {
    const [assignments, subs] = await Promise.all([
      q(supabase.from('assignments').select('*, author:profiles!assignments_created_by_fkey(full_name)').eq('active', true).order('created_at', { ascending: false })),
      q(supabase.from('submissions').select('*').eq('student_id', me.id)),
    ]);
    return { assignments, subs };
  }, [me.id]);
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState('new');

  if (d.error) return <Page><ErrorBox text={d.error} onRetry={d.reload} /></Page>;
  if (!d.data) return <Page><Loading /></Page>;
  const subOf = (id) => d.data.subs.find((x) => x.assignment_id === id);
  const isNew = (a) => { const x = subOf(a.id); return (!x || x.status === 'rejected') && !expired(a); };
  const canImprove = (a) => { const x = subOf(a.id); return a.kind === 'test' && x && !expired(a) && x.correct < x.total && (a.max_attempts == null || x.attempts < a.max_attempts); };
  const list = d.data.assignments.filter((a) => (filter === 'new' ? isNew(a) : !isNew(a)));
  const newCount = d.data.assignments.filter(isNew).length;
  const earned = d.data.subs.filter((x) => x.status === 'paid').reduce((t, x) => t + x.reward, 0);
  const current = d.data.assignments.find((a) => a.id === openId);

  return (
    <Page onRefresh={d.reload} refreshing={d.loading}>
      <Row style={{ gap: 10, marginBottom: 12 }}>
        <View style={[s.stat, { borderLeftColor: C.gold }]}><Text style={s.small}>📌 Bajarish kerak</Text><Text style={[s.statValue, { color: C.gold }]}>{newCount}</Text></View>
        <View style={[s.stat, { borderLeftColor: C.success }]}><Text style={s.small}>💰 Vazifalardan topdim</Text><Text style={[s.statValue, { color: C.success }]}>{fmt(earned)} ilmzor</Text></View>
      </Row>
      <Segment options={[['new', `Yangi (${newCount})`], ['done', 'Topshirilgan']]} value={filter} onChange={setFilter} />
      {!list.length ? <Empty text={filter === 'new' ? "Hozircha yangi vazifa yo'q 🎉" : "Hali hech narsa topshirmagansiz"} /> : (
        <Card>
          {list.map((a) => {
            const x = subOf(a.id);
            return (
              <ListRow key={a.id}
                left={<Text style={{ fontSize: 24 }}>{a.kind === 'test' ? '📝' : '📸'}</Text>}
                title={a.title}
                sub={`${x ? (a.kind === 'test' ? `🏆 ${x.correct}/${x.total}${canImprove(a) ? ' · 🔁 yaxshilash mumkin' : ''}` : STATUS[x.status][0]) : expired(a) ? '⌛ Muddat tugagan' : '🆕 Yangi'} · ${a.author?.full_name || ''}${a.deadline && !x ? `\n⏰ ${fmtDate(a.deadline)} gacha` : ''}`}
                right={x && x.status !== 'rejected' ? <Coin value={x.reward} size={14} color={x.status === 'paid' ? C.success : C.muted} sign={x.reward ? '+' : ''} />
                  : <Text style={{ color: C.gold, fontWeight: '800' }}>≤ {fmt(maxReward(a))} ilmzor</Text>}
                onPress={() => setOpenId(a.id)} />
            );
          })}
        </Card>
      )}
      <Sheet visible={!!current} onClose={() => setOpenId(null)} title={current?.title || ''}>
        {current && <DoTask me={me} a={current} sub={subOf(current.id)} onDone={() => { d.reload(); refreshMe(); }} />}
      </Sheet>
    </Page>
  );
}

function DoTask({ me, a, sub, onDone }) {
  const { notify, ask } = useUI();
  const { can } = useSettings();
  const [aiQ, setAiQ] = useState(null);
  const aiOn = can('ai_help') && !!a.file_path;
  const n = a.question_count || 0;
  const [mode, setMode] = useState(sub && a.kind === 'test' ? 'review' : 'do');
  const [answers, setAnswers] = useState(() => Array(n).fill(''));
  const [focus, setFocus] = useState(null); // qayta ishlashda xato savollar
  const [last, setLast] = useState(null);   // oxirgi topshirish natijasi
  const [photo, setPhoto] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const late = expired(a);
  const attempts = useLoad(() => (a.kind === 'test' && sub
    ? q(supabase.from('test_attempts').select('*').eq('assignment_id', a.id).eq('student_id', me.id).order('created_at', { ascending: false }))
    : Promise.resolve([])), [a.id, me.id, sub?.attempts]);
  const key = useLoad(() => (a.kind === 'test' && sub ? rpc('get_test_key', { p_assignment: a.id }) : Promise.resolve(null)), [a.id, sub?.attempts]);
  const used = sub?.attempts || 0;
  const left = a.max_attempts == null ? null : Math.max(0, a.max_attempts - used);
  const canRetry = !late && (left === null || left > 0);
  const filled = answers.filter(Boolean).length;

  const sendTest = async () => {
    setBusy(true);
    try {
      const r = await rpc('submit_test', { p_assignment: a.id, p_answers: answers });
      setLast({ ...r, answers: [...answers] });
      notify(r.paid_now ? `+${fmt(r.paid_now)} ilmzor — barakalla!` : r.correct > (sub?.correct ?? -1) ? `${r.correct}/${r.total} to'g'ri` : `${r.correct}/${r.total} — avvalgi natijangiz yuqoriroq`);
      setMode('review'); setFocus(null); onDone();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };

  // Xatolar ustida ishlash: to'g'rilari saqlanadi, xatolari tozalanadi
  const retryMistakes = (src) => {
    const prev = src.answers || []; const res = src.results || [];
    setAnswers(Array.from({ length: n }, (_, i) => (res[i] ? prev[i] || '' : '')));
    setFocus(res.map((r) => !r));
    setMode('do');
  };
  const retryAll = () => { setAnswers(Array(n).fill('')); setFocus(null); setMode('do'); };

  const pick = async (cam) => { try { const p = await pickPhoto(cam); if (p) setPhoto(p); } catch (e) { notify(e.message, 'err'); } };
  const sendTask = async () => {
    if (!photo) return notify('Avval yechimingizni rasmga oling', 'err');
    setBusy(true);
    try {
      const path = await uploadAsset('submissions', me.id, photo);
      await rpc('submit_task', { p_assignment: a.id, p_file_path: path, p_comment: comment.trim() || null });
      notify("Yuborildi! O'qituvchi tekshirgach pul tushadi");
      setPhoto(null); onDone();
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };

  const header = (
    <>
      <P muted style={{ marginBottom: 8 }}>
        {a.kind === 'test' ? `📝 Test · ${n} savol` : '📸 Vazifa: yechimni rasmga olib yuboring'}
        {'\n'}💰 {rewardText(a)}
        {a.kind === 'test' ? `\n🔁 ${a.max_attempts == null ? 'Cheksiz urinish' : `${a.max_attempts} ta urinish`} · pul eng yuqori natija uchun` : ''}
        {a.deadline ? `\n⏰ ${fmtDate(a.deadline)} gacha${late ? ' (tugagan)' : ''}` : ''}
      </P>
      {!!a.description && <Card><P>{a.description}</P></Card>}
      <FileView bucket="assignments" path={a.file_path} type={a.file_type} />
    </>
  );

  /* ---------- TEST ---------- */
  if (a.kind === 'test') {
    if (mode === 'review' && (sub || last)) {
      const view = last || attempts.data?.[0] || sub;
      const best = last ? last.best : sub.correct;
      const total = view.total || n;
      const earned = last ? last.best_reward : sub.reward;
      const wrong = (view.results || []).filter((r) => !r).length;
      return (
        <>
          {header}
          <Row style={{ gap: 10, marginBottom: 12 }}>
            <View style={[s.stat, { borderLeftColor: C.blue }]}><Text style={s.small}>🏆 Eng yuqori</Text><Text style={[s.statValue, { color: C.blue }]}>{best}/{total}</Text></View>
            <View style={[s.stat, { borderLeftColor: C.success }]}><Text style={s.small}>💰 Topilgan</Text><Text style={[s.statValue, { color: C.success }]}>{fmt(earned)}</Text></View>
          </Row>
          {last && (
            <Card style={{ backgroundColor: last.paid_now ? C.successLight : C.goldLight, borderColor: 'transparent', alignItems: 'center' }}>
              <Text style={{ color: C.muted }}>Bu urinish</Text>
              <Text style={{ fontSize: 36, fontWeight: '900', color: C.text }}>{last.correct}/{last.total}</Text>
              <Text style={{ fontWeight: '800', color: last.paid_now ? C.success : C.muted, textAlign: 'center' }}>
                {last.paid_now ? `+${fmt(last.paid_now)} ilmzor` : last.correct >= last.best && last.reward > 0 ? "Pul avval olingan" : "Yangi rekord bo'lmadi — pul faqat eng yuqori natija uchun"}
              </Text>
              {last.status === 'unpaid' && <P muted style={{ marginTop: 6, textAlign: 'center' }}>Pul o'qituvchi hisobi to'ldirilgach tushadi</P>}
            </Card>
          )}
          <H2 style={{ marginBottom: 6 }}>{wrong ? `❌ Xatolar: ${wrong} ta` : '🎉 Hammasi to\'g\'ri!'}</H2>
          {wrong > 0 && aiOn && <P muted style={{ fontSize: 13, marginBottom: 8 }}>🤖 "Yordam" ni bosing — sun'iy intellekt xatoni tushuntiradi va o'xshash misollar beradi.</P>}
          <Card><AnswerGrid count={total} options={a.option_count} value={view.answers || []} results={view.results} keyAnswers={key.data} onAsk={aiOn ? setAiQ : undefined} /></Card>
          <Sheet visible={!!aiQ} onClose={() => setAiQ(null)} title={aiQ ? `🤖 ${aiQ}-savol bo'yicha yordam` : ''}>
            {aiQ && <AiHelp a={a} q={aiQ} />}
          </Sheet>
          {key.data && <P muted style={{ fontSize: 13, marginTop: -4, marginBottom: 10 }}>🟢 yashil — to'g'ri javob</P>}
          {canRetry ? (
            <Row style={{ gap: 10, marginBottom: 10 }}>
              {wrong > 0 && <Btn title="Xatolarni qayta ishlash" icon="🔁" onPress={() => retryMistakes(view)} style={{ flex: 1.4 }} />}
              <Btn kind="ghost" title="Boshidan" onPress={retryAll} style={{ flex: 1 }} />
            </Row>
          ) : <P muted style={{ textAlign: 'center', marginBottom: 10 }}>{late ? '⌛ Muddat tugagan' : '🔒 Urinishlar tugagan'}</P>}
          {left !== null && canRetry && <P muted style={{ textAlign: 'center', fontSize: 13 }}>Qolgan urinishlar: {left}</P>}
          {(attempts.data || []).length > 1 && (
            <Card>
              <H2 style={{ marginBottom: 6 }}>Urinishlar tarixi</H2>
              {attempts.data.map((t, i) => (
                <ListRow key={t.id} title={`${attempts.data.length - i}-urinish: ${t.correct}/${t.total}`} sub={fmtDate(t.created_at)}
                  right={<Text style={{ color: C.muted }}>{Math.round((t.correct / t.total) * 100)}%</Text>} />
              ))}
            </Card>
          )}
          <View style={{ height: 30 }} />
        </>
      );
    }
    if (late) return <>{header}<Card><P muted>⌛ Muddat tugagan</P></Card></>;
    return (
      <>
        {header}
        {focus && <Card style={{ backgroundColor: C.goldLight, borderColor: 'transparent' }}><P>🔁 To'g'ri javoblaringiz saqlandi. Faqat <Text style={{ fontWeight: '800' }}>sariq</Text> belgilangan savollarni qayta yeching.</P></Card>}
        <H2 style={{ marginBottom: 8 }}>Javoblaringiz ({filled}/{n})</H2>
        <Card><AnswerGrid count={n} options={a.option_count} value={answers} onChange={setAnswers} highlight={focus} /></Card>
        <Btn title="Topshirish" icon="✅" onPress={sendTest} loading={busy} disabled={!filled} />
        {sub && <Btn kind="ghost" title="Bekor qilish" onPress={() => setMode('review')} style={{ marginTop: 10 }} />}
        <View style={{ height: 30 }} />
      </>
    );
  }

  /* ---------- RASMLI VAZIFA ---------- */
  const canDo = !late && (!sub || sub.status === 'rejected');
  return (
    <>
      {header}
      {sub && sub.status !== 'rejected' ? (
        <>
          <Card style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>{STATUS[sub.status][0]}</Text>
            {sub.status === 'paid' && <Coin value={sub.reward} sign="+" color={C.success} size={22} />}
            {!!sub.comment && <P style={{ marginTop: 8 }}>💬 {sub.comment}</P>}
          </Card>
          <FileView bucket="submissions" path={sub.file_path} type="image" />
        </>
      ) : !canDo ? (
        <Card><P muted>⌛ Muddat tugagan</P></Card>
      ) : (
        <>
          {sub?.status === 'rejected' && (
            <Card style={{ backgroundColor: C.dangerLight, borderColor: 'transparent' }}>
              <P style={{ fontWeight: '700' }}>↩️ O'qituvchi qaytardi</P>
              {!!sub.comment && <P style={{ marginTop: 4 }}>💬 {sub.comment}</P>}
              <P muted style={{ marginTop: 4, fontSize: 13 }}>Tuzatib, qaytadan yuboring.</P>
            </Card>
          )}
          {photo ? (
            <View style={{ marginBottom: 12 }}>
              <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 360, borderRadius: 12, backgroundColor: '#E2E8F0' }} resizeMode="contain" />
              <Btn small kind="ghost" title="Boshqa rasm" onPress={() => setPhoto(null)} style={{ marginTop: 8, alignSelf: 'center' }} />
            </View>
          ) : (
            <Row style={{ gap: 10, marginBottom: 12 }}>
              <Btn kind="light" icon="📷" title="Rasmga olish" onPress={() => pick(true)} style={{ flex: 1 }} />
              <Btn kind="light" icon="🖼️" title="Galereyadan" onPress={() => pick(false)} style={{ flex: 1 }} />
            </Row>
          )}
          <Field label="Izoh (ixtiyoriy)" value={comment} onChangeText={setComment} autoCapitalize="sentences" />
          <Btn title="Yuborish" icon="📤" onPress={sendTask} loading={busy} disabled={!photo} />
        </>
      )}
      <View style={{ height: 30 }} />
    </>
  );
}

/* =====================================================================
   SUN'IY INTELLEKT YORDAMCHISI
   ===================================================================== */
function AiHelp({ a, q: question }) {
  const [tab, setTab] = useState('explain');
  return (
    <>
      <Segment options={[['explain', '💡 Tushuntirish'], ['similar', "✏️ O'xshash misollar"]]} value={tab} onChange={setTab} />
      {tab === 'explain' ? <AiExplain a={a} q={question} /> : <AiSimilar a={a} q={question} />}
      <P muted style={{ fontSize: 11, textAlign: 'center', marginTop: 10 }}>Javoblarni sun'iy intellekt (Google Gemini) tayyorlaydi — ba'zan xato qilishi mumkin. Shubha bo'lsa, o'qituvchingizdan so'rang.</P>
      <View style={{ height: 20 }} />
    </>
  );
}

function AiLoading({ text }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Text style={{ fontSize: 36 }}>🤖</Text>
      <Loading />
      <P muted>{text}</P>
    </Card>
  );
}

function AiExplain({ a, q: question }) {
  const d = useLoad(() => askAI({ assignment_id: a.id, question, mode: 'explain' }), [a.id, question]);
  if (d.loading && !d.data) return <AiLoading text="Savolni o'qib, tushuntirish tayyorlanmoqda..." />;
  if (d.error) return <ErrorBox text={d.error} onRetry={d.reload} />;
  return (
    <Card>
      {(d.data.text || '').split('\n').map((line, i) => {
        const clean = line.replace(/\*\*/g, '').replace(/^#+\s*/, '');
        const head = /^(\d\)|Savol:|Qayerda|Yechish|Javob:|Endi)/.test(clean.trim());
        return clean.trim() ? <Text key={i} style={{ fontSize: 15, lineHeight: 22, color: C.text, fontWeight: head ? '800' : '400', marginTop: head && i ? 8 : 0 }}>{clean}</Text> : null;
      })}
    </Card>
  );
}

function AiSimilar({ a, q: question }) {
  const { notify } = useUI();
  const [fresh, setFresh] = useState(0);
  const d = useLoad(() => askAI({ assignment_id: a.id, question, mode: 'similar', fresh: fresh > 0 }), [a.id, question, fresh]);
  const [picked, setPicked] = useState({});
  useEffect(() => setPicked({}), [d.data]);
  if (d.loading && !d.data) return <AiLoading text="Yangi misollar tuzilmoqda..." />;
  if (d.error) return <ErrorBox text={d.error} onRetry={d.reload} />;
  const probs = d.data.problems || [];
  const done = probs.filter((_, i) => picked[i] !== undefined).length;
  const right = probs.filter((p, i) => picked[i] === p.answer).length;
  return (
    <>
      {!!d.data.topic && <P muted style={{ marginBottom: 8 }}>Mavzu: {d.data.topic}</P>}
      {probs.map((p, i) => {
        const sel = picked[i];
        return (
          <Card key={i}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 10 }}>{i + 1}. {p.q}</Text>
            {p.options.map((o, j) => {
              const isSel = sel === j; const isAns = sel !== undefined && j === p.answer;
              return (
                <Pressable key={j} disabled={sel !== undefined} onPress={() => setPicked({ ...picked, [i]: j })}
                  style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1.5, marginBottom: 6,
                    borderColor: isAns ? C.success : isSel ? C.danger : C.border, backgroundColor: isAns ? C.successLight : isSel ? C.dangerLight : '#fff' }}>
                  <Text style={{ fontWeight: '800', width: 26 }}>{'ABCDEF'[j]})</Text>
                  <Text style={{ flex: 1, fontSize: 15 }}>{String(o).replace(/^\s*[A-Fa-f]\s*[).:]\s*/, '')}</Text>
                  {isAns && <Text>✅</Text>}{isSel && !isAns && <Text>❌</Text>}
                </Pressable>
              );
            })}
            {sel !== undefined && <P style={{ marginTop: 6, fontSize: 14 }}>{sel === p.answer ? '🎉 To\'g\'ri! ' : '💡 '}{p.why}</P>}
          </Card>
        );
      })}
      {done === probs.length && probs.length > 0 && (
        <Card style={{ backgroundColor: right === probs.length ? C.successLight : C.goldLight, borderColor: 'transparent', alignItems: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '900' }}>{right}/{probs.length}</Text>
          <P>{right === probs.length ? "Zo'r! Endi testdagi savolni qayta ishlab ko'ring 💪" : "Yana mashq qiling — yangi misollar oling"}</P>
        </Card>
      )}
      <Btn kind="ghost" icon="🔄" title="Yangi misollar" loading={d.loading} onPress={() => { setFresh(fresh + 1); notify('Yangi misollar tuzilmoqda...'); }} />
    </>
  );
}

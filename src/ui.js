import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, Platform,
} from 'react-native';

export const C = {
  bg: '#F3F6FA', card: '#FFFFFF', primary: '#0F766E', primaryDark: '#134E4A', primaryLight: '#CCFBF1',
  gold: '#F59E0B', goldLight: '#FEF3C7', text: '#0F172A', muted: '#64748B', border: '#E2E8F0',
  danger: '#DC2626', dangerLight: '#FEE2E2', success: '#16A34A', successLight: '#DCFCE7', blue: '#2563EB',
};

export const ROLE_NAMES = { admin: 'Admin', teacher: "O'qituvchi", seller: 'Sotuvchi', student: "O'quvchi", pending: 'Kutilmoqda' };

export const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const fmtDate = (s) => {
  const d = new Date(s);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ---------- Bildirishnoma va tasdiqlash ---------- */
const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

export function UIProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const timer = useRef();
  const notify = useCallback((text, type = 'ok') => {
    clearTimeout(timer.current);
    setToast({ text, type });
    timer.current = setTimeout(() => setToast(null), type === 'err' ? 4500 : 2500);
  }, []);
  const ask = useCallback((title, text, okLabel = 'Ha') =>
    new Promise((resolve) => setConfirm({ title, text, okLabel, resolve })), []);
  const close = (v) => { confirm?.resolve(v); setConfirm(null); };
  return (
    <UICtx.Provider value={{ notify, ask }}>
      {children}
      {toast && (
        <View pointerEvents="none" style={[s.toast, { backgroundColor: toast.type === 'err' ? C.danger : C.primaryDark }]}>
          <Text style={s.toastText}>{toast.type === 'err' ? '⚠️ ' : '✅ '}{toast.text}</Text>
        </View>
      )}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => close(false)}>
        <View style={s.backdrop}>
          <View style={s.dialog}>
            <Text style={s.h2}>{confirm?.title}</Text>
            {!!confirm?.text && <Text style={[s.p, { marginTop: 8 }]}>{confirm.text}</Text>}
            <Row style={{ marginTop: 18, gap: 10 }}>
              <Btn title="Bekor" kind="ghost" onPress={() => close(false)} style={{ flex: 1 }} />
              <Btn title={confirm?.okLabel || 'Ha'} onPress={() => close(true)} style={{ flex: 1 }} />
            </Row>
          </View>
        </View>
      </Modal>
    </UICtx.Provider>
  );
}

/* ---------- Ma'lumot yuklash ---------- */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const alive = useRef(true);
  const reload = useCallback(async () => {
    setState((x) => ({ ...x, loading: true }));
    try {
      const data = await fn();
      if (alive.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (alive.current) setState((x) => ({ ...x, loading: false, error: e.message }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; }; }, [reload]);
  return { ...state, reload };
}

/* ---------- Komponentlar ---------- */
export const Row = ({ style, children }) => <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
export const H1 = ({ children, style }) => <Text style={[s.h1, style]}>{children}</Text>;
export const H2 = ({ children, style }) => <Text style={[s.h2, style]}>{children}</Text>;
export const P = ({ children, style, muted }) => <Text style={[s.p, muted && { color: C.muted }, style]}>{children}</Text>;
export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;

export function Page({ children, onRefresh, refreshing }) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      <View style={s.inner}>{children}</View>
    </ScrollView>
  );
}

export function Btn({ title, onPress, kind = 'primary', disabled, loading, small, style, icon }) {
  const bg = { primary: C.primary, danger: C.danger, gold: C.gold, ghost: 'transparent', light: C.primaryLight }[kind];
  const fg = { primary: '#fff', danger: '#fff', gold: '#fff', ghost: C.primary, light: C.primaryDark }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn, small && s.btnSmall, { backgroundColor: bg },
        kind === 'ghost' && { borderWidth: 1.5, borderColor: C.primary },
        (disabled || loading) && { opacity: 0.45 }, pressed && { opacity: 0.8 }, style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <Text style={[s.btnText, small && { fontSize: 14 }, { color: fg }]}>{icon ? icon + '  ' : ''}{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, style, hint, ...props }) {
  return (
    <View style={[{ marginBottom: 12 }, style]}>
      {!!label && <Text style={s.label}>{label}</Text>}
      <TextInput placeholderTextColor="#94A3B8" style={s.input} autoCapitalize="none" {...props} />
      {!!hint && <Text style={[s.small, { marginTop: 4 }]}>{hint}</Text>}
    </View>
  );
}

export function Chip({ label, active, onPress, color = C.primary }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: color, borderColor: color }]}>
      <Text style={[s.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Segment({ options, value, onChange }) {
  return (
    <View style={s.segment}>
      {options.map(([v, l]) => (
        <Pressable key={String(v)} onPress={() => onChange(v)} style={[s.segItem, value === v && s.segActive]}>
          <Text style={[s.segText, value === v && { color: C.primaryDark, fontWeight: '700' }]}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Check({ checked, label, sub, onPress, right }) {
  return (
    <Pressable onPress={onPress} style={s.listRow}>
      <View style={[s.box, checked && { backgroundColor: C.primary, borderColor: C.primary }]}>
        {checked && <Text style={{ color: '#fff', fontWeight: '900' }}>✓</Text>}
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={s.rowTitle}>{label}</Text>
        {!!sub && <Text style={s.small}>{sub}</Text>}
      </View>
      {right}
    </Pressable>
  );
}

export function ListRow({ title, sub, right, onPress, left }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.listRow, pressed && { backgroundColor: '#F8FAFC' }]}>
      {left}
      <View style={{ flex: 1, marginLeft: left ? 12 : 0 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {!!sub && <Text style={s.small}>{sub}</Text>}
      </View>
      {right}
      {onPress && <Text style={{ color: C.muted, marginLeft: 8, fontSize: 18 }}>›</Text>}
    </Pressable>
  );
}

export const Coin = ({ value, size = 16, color = C.text, sign = '' }) => (
  <Text style={{ fontSize: size, fontWeight: '800', color }}>{sign}{fmt(value)} 🪙</Text>
);

export function Stat({ label, value, color = C.primary, icon, coin }) {
  return (
    <View style={[s.stat, { borderLeftColor: color }]}>
      <Text style={s.small}>{icon} {label}</Text>
      <Text style={[s.statValue, { color }]}>{fmt(value)}{coin ? ' 🪙' : ''}</Text>
    </View>
  );
}

// Oddiy gorizontal bar diagramma
export function Bars({ data, color = C.primary, unit = '' }) {
  if (!data || !data.length) return <P muted>Hozircha ma'lumot yo'q</P>;
  const max = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  const total = data.reduce((a, d) => a + (Number(d.value) || 0), 0) || 1;
  return (
    <View style={{ gap: 10 }}>
      {data.map((d, i) => (
        <View key={i}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={[s.p, { flex: 1 }]} numberOfLines={1}>{d.label}</Text>
            <Text style={[s.p, { fontWeight: '700' }]}>{fmt(d.value)}{unit} · {Math.round((d.value / total) * 100)}%</Text>
          </Row>
          <View style={s.barBg}><View style={[s.bar, { width: `${(d.value / max) * 100}%`, backgroundColor: color }]} /></View>
        </View>
      ))}
    </View>
  );
}

export const Empty = ({ text = "Hozircha hech narsa yo'q" }) => (
  <View style={{ padding: 24, alignItems: 'center' }}><Text style={{ fontSize: 32 }}>📭</Text><P muted style={{ marginTop: 6, textAlign: 'center' }}>{text}</P></View>
);
export const Loading = () => <View style={{ padding: 30 }}><ActivityIndicator color={C.primary} size="large" /></View>;
export const ErrorBox = ({ text, onRetry }) => (
  <Card style={{ backgroundColor: C.dangerLight }}>
    <P style={{ color: C.danger }}>⚠️ {text}</P>
    {onRetry && <Btn small kind="ghost" title="Qayta urinish" onPress={onRetry} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
  </Card>
);

export function Sheet({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetBackdrop}>
        <View style={s.sheet}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <H2 style={{ flex: 1 }}>{title}</H2>
            <Pressable onPress={onClose} hitSlop={12}><Text style={{ fontSize: 24, color: C.muted }}>✕</Text></Pressable>
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function Search({ value, onChange, placeholder = 'Qidirish...' }) {
  return <TextInput value={value} onChangeText={onChange} placeholder={'🔍  ' + placeholder} placeholderTextColor="#94A3B8" style={[s.input, { marginBottom: 12 }]} />;
}

export const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40 },
  inner: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  h1: { fontSize: 26, fontWeight: '800', color: C.text },
  h2: { fontSize: 18, fontWeight: '700', color: C.text },
  p: { fontSize: 15, color: C.text },
  small: { fontSize: 13, color: C.muted },
  label: { fontSize: 13, color: C.muted, marginBottom: 6, fontWeight: '600' },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  btn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  btnText: { fontSize: 16, fontWeight: '700' },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#fff', marginRight: 8, marginBottom: 8 },
  chipText: { fontSize: 14, color: C.text, fontWeight: '600' },
  segment: { flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 12, padding: 4, marginBottom: 12 },
  segItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  segActive: { backgroundColor: '#fff' },
  segText: { fontSize: 14, color: C.muted, fontWeight: '600' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  rowTitle: { fontSize: 16, color: C.text, fontWeight: '600' },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  stat: { flexGrow: 1, flexBasis: '45%', backgroundColor: '#fff', borderRadius: 14, padding: 14, borderLeftWidth: 5, borderWidth: 1, borderColor: C.border },
  statValue: { fontSize: 26, fontWeight: '800', marginTop: 4 },
  barBg: { height: 12, backgroundColor: '#EEF2F7', borderRadius: 6, overflow: 'hidden' },
  bar: { height: 12, borderRadius: 6 },
  toast: { position: 'absolute', left: 16, right: 16, top: 50, padding: 14, borderRadius: 12, zIndex: 999, maxWidth: 560, alignSelf: 'center' },
  toastText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 18, padding: 20, width: '100%', maxWidth: 420, alignSelf: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, maxHeight: '92%', width: '100%', maxWidth: 640, alignSelf: 'center' },
});

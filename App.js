import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from './src/supabase';
import { C, Btn, Card, Coin, H2, LOGO, P, ROLE_NAMES, UIProvider, useUI } from './src/ui';
import Login from './src/screens/Login';
import { studentTabs } from './src/screens/Student';
import { teacherTabs } from './src/screens/Teacher';
import { sellerTabs } from './src/screens/Seller';
import { adminTabs } from './src/screens/Admin';
import { SettingsProvider, useSettings } from './src/settings';

export default function App() {
  return (
    <SafeAreaProvider>
      <UIProvider>
        <SettingsProvider>
          <Root />
        </SettingsProvider>
      </UIProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user?.id;
  const refreshMe = useCallback(async () => {
    if (!uid) { setMe(null); return; }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) setProfileError(error.message);
    else { setProfileError(null); setMe(data); }
  }, [uid]);

  useEffect(() => { refreshMe(); }, [refreshMe]);

  // Balans o'zgarsa darhol yangilash (realtime)
  useEffect(() => {
    if (!uid) return undefined;
    const ch = supabase.channel('me-' + uid)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, (p) => setMe((m) => ({ ...m, ...p.new })))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid]);

  // Tasdiqlashni kutayotganda har 15 soniyada tekshirish
  useEffect(() => {
    if (!me || me.role !== 'pending') return undefined;
    const t = setInterval(refreshMe, 15000);
    return () => clearInterval(t);
  }, [me, refreshMe]);

  const logout = () => { setMe(null); supabase.auth.signOut(); };

  let body;
  if (session === undefined || (session && !me && !profileError)) {
    body = <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color={C.primary} /></View>;
  } else if (!session) {
    body = <Login />;
  } else if (profileError || !me || me.role === 'pending' || !me.active) {
    body = (
      <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <Card style={{ maxWidth: 420, alignSelf: 'center', width: '100%' }}>
          <Text style={{ fontSize: 40, textAlign: 'center' }}>{me && !me.active ? '🚫' : '⏳'}</Text>
          <H2 style={{ textAlign: 'center', marginVertical: 8 }}>
            {profileError ? 'Xatolik' : me && !me.active ? 'Akkaunt bloklangan' : "So'rovingiz yuborildi"}
          </H2>
          <P muted style={{ textAlign: 'center', marginBottom: 16 }}>
            {profileError || (me && !me.active ? 'Markaz administratoriga murojaat qiling.'
              : `${me?.full_name || ''}, o'qituvchingiz tasdiqlagach, ilova o'zi ochiladi. Odatda bu dars paytida bo'ladi.`)}
          </P>
          <Btn title="Qayta tekshirish" onPress={refreshMe} style={{ marginBottom: 10 }} />
          <Btn kind="ghost" title="Chiqish" onPress={logout} />
        </Card>
      </View>
    );
  } else {
    body = <Main me={me} refreshMe={refreshMe} logout={logout} />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: session && me ? C.primaryDark : C.primaryDark }} edges={['top']}>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: C.bg }}>{body}</View>
    </SafeAreaView>
  );
}

function Main({ me, refreshMe, logout }) {
  const { ask } = useUI();
  const { can } = useSettings();
  const tabs = me.role === 'admin' ? adminTabs(me)
    : me.role === 'teacher' ? teacherTabs(me, refreshMe, can)
      : me.role === 'seller' ? sellerTabs(me, can)
        : studentTabs(me, refreshMe, can);
  const [tab, setTab] = useState(tabs[0].key);
  const current = tabs.find((t) => t.key === tab) || tabs[0];
  const showBalance = me.role === 'student' || me.role === 'teacher';

  return (
    <View style={{ flex: 1 }}>
      <View style={{ backgroundColor: C.primaryDark, paddingHorizontal: 16, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <Image source={LOGO} style={{ width: 28, height: 36, marginRight: 10 }} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{me.full_name || me.username}</Text>
            <Text style={{ color: '#8EE8BF', fontSize: 13 }}>{ROLE_NAMES[me.role]} · {current.label}</Text>
          </View>
          {showBalance && (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginRight: 10 }}>
              <Coin value={me.balance} color="#FDE68A" size={16} />
            </View>
          )}
          <Pressable hitSlop={10} onPress={async () => { if (await ask('Chiqasizmi?', '', 'Chiqish')) logout(); }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>Chiqish</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }} key={current.key}>{current.render()}</View>

      <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.border }}>
        <View style={{ flexDirection: 'row', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          {tabs.map((t) => {
            const active = t.key === current.key;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
                <Text style={{ fontSize: 22, opacity: active ? 1 : 0.5 }}>{t.icon}</Text>
                <Text style={{ fontSize: 11, marginTop: 2, color: active ? C.primary : C.muted, fontWeight: active ? '800' : '500' }} numberOfLines={1}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

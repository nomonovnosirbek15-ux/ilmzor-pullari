import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { supabase, loginToEmail, cleanLogin, errText, isConfigured } from '../supabase';
import { CURRENCY } from '../config';
import { C, Btn, Card, Chip, Field, LOGO, P, Row, Segment, useUI } from '../ui';
import { useSettings } from '../settings';

export default function Login() {
  const { notify } = useUI();
  const { can } = useSettings();
  const regOpen = can('self_registration');
  const [mode, setMode] = useState('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [fullName, setFullName] = useState('');
  const [group, setGroup] = useState(null);
  const [groups, setGroups] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'register' || groups) return;
    supabase.rpc('public_groups').then(({ data }) => setGroups(data || []));
  }, [mode, groups]);

  const signIn = async () => {
    if (!cleanLogin(login) || !password) return notify('Login va parolni kiriting', 'err');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
    setBusy(false);
    if (error) notify(errText(error), 'err');
  };

  const signUp = async () => {
    const l = cleanLogin(login);
    if (fullName.trim().split(/\s+/).length < 2) return notify('Ism va familiyangizni to\'liq yozing', 'err');
    if (l.length < 3) return notify('Login kamida 3 ta belgi (lotin harflari, raqam)', 'err');
    if (password.length < 6) return notify('Parol kamida 6 belgi', 'err');
    if (password !== password2) return notify('Parollar bir xil emas', 'err');
    if (!group) return notify('Guruhingizni tanlang', 'err');
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: loginToEmail(l), password,
      options: { data: { full_name: fullName.trim().replace(/\s+/g, ' '), group_id: String(group) } },
    });
    setBusy(false);
    if (error) return notify(errText(error), 'err');
    if (data?.user?.identities && data.user.identities.length === 0) return notify('Bu login band. Boshqa login tanlang', 'err');
    if (!data.session) {
      const r = await supabase.auth.signInWithPassword({ email: loginToEmail(l), password });
      if (r.error) notify(errText(r.error), 'err');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.primaryDark }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center' }}>
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <Image source={LOGO} style={{ width: 72, height: 72 }} resizeMode="contain" />
            <Text style={{ color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 8, letterSpacing: 1 }}>ILMZOR</Text>
            <Text style={{ color: '#8EE8BF', fontSize: 15, marginTop: 2 }}>{CURRENCY} · rag'batlantirish tizimi</Text>
          </View>
          <Card style={{ padding: 20 }}>
            {!isConfigured && <P style={{ color: C.danger, marginBottom: 12 }}>⚠️ Server sozlanmagan (src/config.js)</P>}
            {regOpen && <Segment options={[['login', 'Kirish'], ['register', "Ro'yxatdan o'tish"]]} value={mode} onChange={setMode} />}
            {mode === 'register' && (
              <>
                <Field label="Ism va familiya" value={fullName} onChangeText={setFullName} autoCapitalize="words" placeholder="Aliyev Ali" />
              </>
            )}
            <Field label="Login" value={login} onChangeText={(v) => setLogin(mode === 'register' ? cleanLogin(v) : v)} placeholder="Masalan: ali2015" autoCorrect={false}
              hint={mode === 'register' ? 'Lotin harflari va raqamlar. Eslab qoling!' : undefined} />
            <Field label="Parol" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••"
              onSubmitEditing={mode === 'login' ? signIn : undefined} />
            {mode === 'register' && (
              <>
                <Field label="Parolni takrorlang" value={password2} onChangeText={setPassword2} secureTextEntry placeholder="••••••" />
                <Text style={{ fontSize: 13, color: C.muted, marginBottom: 6, fontWeight: '600' }}>Guruhingiz</Text>
                {!groups ? <P muted>Yuklanmoqda...</P> : !groups.length ? <P muted>Hali guruh yo'q</P> : (
                  <Row style={{ flexWrap: 'wrap', marginBottom: 6 }}>
                    {groups.map((g) => <Chip key={g.id} label={`${g.name}${g.teacher ? ' · ' + g.teacher.split(' ')[0] : ''}`} active={group === g.id} onPress={() => setGroup(g.id)} />)}
                  </Row>
                )}
              </>
            )}
            <Btn title={mode === 'login' ? 'Kirish' : "Ro'yxatdan o'tish"} onPress={mode === 'login' ? signIn : signUp} loading={busy} style={{ marginTop: 4 }} />
            <P muted style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
              {mode === 'register' ? "Ro'yxatdan o'tgach, o'qituvchingiz tasdiqlaydi"
                : regOpen ? "Akkauntingiz yo'qmi? \"Ro'yxatdan o'tish\" ni bosing" : 'Login va parolni markaz administratoridan oling'}
            </P>
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { supabase, loginToEmail, cleanLogin, errText, isConfigured } from '../supabase';
import { CURRENCY } from '../config';
import { C, Btn, Card, Field, LOGO, P, useUI } from '../ui';

export default function Login() {
  const { notify } = useUI();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!cleanLogin(login) || !password) return notify('Login va parolni kiriting', 'err');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
    setBusy(false);
    if (error) notify(errText(error), 'err');
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.primaryDark, justifyContent: 'center', padding: 20 }}>
      <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <Image source={LOGO} style={{ width: 84, height: 84 }} resizeMode="contain" />
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 10, letterSpacing: 1 }}>ILMZOR</Text>
          <Text style={{ color: '#8EE8BF', fontSize: 15, marginTop: 4 }}>{CURRENCY} · rag'batlantirish tizimi</Text>
        </View>
        <Card style={{ padding: 20 }}>
          {!isConfigured && <P style={{ color: C.danger, marginBottom: 12 }}>⚠️ Server sozlanmagan (src/config.js)</P>}
          <Field label="Login" value={login} onChangeText={setLogin} placeholder="Masalan: ali2015" autoCorrect={false} />
          <Field label="Parol" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••" onSubmitEditing={submit} />
          <Btn title="Kirish" onPress={submit} loading={busy} style={{ marginTop: 4 }} />
          <P muted style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>Login va parolni markaz administratoridan oling</P>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}

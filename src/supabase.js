import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_DOMAIN } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

export const isConfigured = !SUPABASE_URL.includes('YOUR-PROJECT');

export const cleanLogin = (s) => (s || '').trim().toLowerCase().replace(/[^a-z0-9._]/g, '');
export const loginToEmail = (login) => `${cleanLogin(login)}@${LOGIN_DOMAIN}`;

const ERRORS = [
  [/Invalid login credentials/i, "Login yoki parol noto'g'ri"],
  [/Email not confirmed/i, "Akkaunt tasdiqlanmagan. Supabase'da \"Confirm email\" ni o'chiring"],
  [/already registered|already been registered/i, "Bu login band. Boshqa login tanlang"],
  [/Password should be at least/i, "Parol kamida 6 belgidan iborat bo'lsin"],
  [/rate limit/i, "Juda ko'p urinish. Bir necha daqiqadan keyin qayta urining"],
  [/Failed to fetch|Network request failed/i, "Internet bilan aloqa yo'q"],
  [/row-level security|permission denied/i, "Bu amal uchun ruxsat yo'q"],
];
export function errText(e) {
  const m = (e && (e.message || e.error_description || String(e))) || 'Xatolik';
  for (const [re, t] of ERRORS) if (re.test(m)) return t;
  return m;
}

// RPC chaqirish — xato bo'lsa tushunarli matn bilan Error tashlaydi
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(errText(error));
  return data;
}

// AI yordamchi (Edge Function: ai-help)
export async function askAI(body) {
  const { data, error } = await supabase.functions.invoke('ai-help', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch (_) { /* ignore */ }
    if (/Failed to send|fetch/i.test(msg)) msg = "AI xizmati bilan aloqa yo'q";
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(errText(error));
  return data;
}

// Admin yangi akkaunt ochadi: alohida (sessiyasiz) klient orqali, admin chiqib ketmasligi uchun
export async function createAccount({ login, password, fullName, role }) {
  const temp = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ilmzor-temp' },
  });
  const { data, error } = await temp.auth.signUp({
    email: loginToEmail(login),
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw new Error(errText(error));
  const id = data?.user?.id;
  if (!id || (data.user.identities && data.user.identities.length === 0)) throw new Error('Bu login band. Boshqa login tanlang');
  await rpc('admin_setup_user', { p_user: id, p_role: role, p_full_name: fullName });
  return id;
}

// Supabase loyihangiz sozlamalari (Project Settings > API).
// "anon public" kalit ochiq kalit — uni ilovaga joylash xavfsiz.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR-ANON-KEY';

// Login'lar shu domen bilan email'ga aylantiriladi: ali -> ali@ilmzor.app
export const LOGIN_DOMAIN = 'ilmzor.app';
export const CURRENCY = 'Ilmzor puli';

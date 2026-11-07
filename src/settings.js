import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Admin panelidagi ruxsatlar (ochiq/yopiq). Yuklanmaguncha hammasi ochiq deb hisoblanadi.
const Ctx = createContext({ perms: {}, can: () => true, reload: () => {} });

export function SettingsProvider({ children }) {
  const [perms, setPerms] = useState({});
  const reload = useCallback(async () => {
    const { data } = await supabase.from('settings').select('key,value');
    if (data) setPerms(Object.fromEntries(data.map((r) => [r.key, r.value])));
  }, []);
  useEffect(() => {
    reload();
    const sub = supabase.auth.onAuthStateChange(() => reload());
    return () => sub.data.subscription.unsubscribe();
  }, [reload]);
  const can = useCallback((key) => perms[key] !== false, [perms]);
  return <Ctx.Provider value={{ perms, can, reload }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBase } from '../config/apiBase';

const EXPO_PUBLIC_API_BASE_URL = getApiBase();

type User = { name: string; email: string; title?: string };
type AuthCtx = {
  user: User | null;
  restored: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
  setTitle: (t: string) => void;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  restored: false,
  signIn: async () => {},
  signOut: () => {},
  setTitle: () => {},
});

const USER_KEY = 'auth:user';
const EMAIL_KEY = 'auth:email';

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [restored, setRestored] = useState(false);

  // Restore persisted user on app start
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(USER_KEY);
        if (raw) {
          const parsed: User = JSON.parse(raw);
          setUser(parsed);
        }
      } catch (e) {
      } finally {
        setRestored(true);
      }
    })();
  }, []);

  async function signIn() {
    // 1) Launch Google OAuth in external browser
    try {
      const base = (EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
      const authUrl = `${base}/google/auth`;

      const can = await Linking.canOpenURL(authUrl);
      if (!can) {
        Alert.alert('Error', 'Cannot open Google sign-in URL.');
        return;
      }
      await Linking.openURL(authUrl);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to launch Google sign-in.');
      return;
    }

    // 2) Poll /google/status until backend reports connected
    try {
      const base = (EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
      const statusUrl = `${base}/google/status`;

      const started = Date.now();
      const timeoutMs = 60000;
      const intervalMs = 2500;

      while (Date.now() - started < timeoutMs) {
        const r = await fetch(statusUrl);
        if (r.ok) {
          const data = await r.json();
          const isConnected =
            data?.connected === true ||
            data?.authenticated === true ||
            data?.authed === true ||
            data?.success === true;

          if (isConnected) {
            const profile = data?.profile || {};
            const name = profile.name || 'Signed User';
            const email = profile.email || 'user@example.com';

            const u: User = { name, email, title: 'Sales Executive' };
            setUser(u);
            await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
            await AsyncStorage.setItem(EMAIL_KEY, email);
            Alert.alert('Signed in', `Welcome ${name}`);
            return;
          }
        }
        await new Promise(res => setTimeout(res, intervalMs));
      }

      Alert.alert('Still waiting', 'Finish Google consent in your browser, then tap again.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to check Google status.');
    }
  }

  async function signOut() {
    try {
      const base = (EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
      await fetch(`${base}/google/revoke`, { method: 'POST' }); // invalidate server token
    } catch {}
    await AsyncStorage.removeItem(USER_KEY);
    await AsyncStorage.removeItem(EMAIL_KEY);
    setUser(null);
  }

  function setTitle(title: string) {
    setUser(u => {
      if (!u) return u;
      const next = { ...u, title };
      AsyncStorage.setItem(USER_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  return (
    <Ctx.Provider value={{ user, restored, signIn, signOut, setTitle }}>
      {children}
    </Ctx.Provider>
  );
};

export function useAuth() {
  return useContext(Ctx);
}
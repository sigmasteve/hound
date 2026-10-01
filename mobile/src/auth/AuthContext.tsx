import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { touchLastActive } from '../notifications/supabaseNotifications';
import { reportAppVersion } from '../admin/appVersions';
import { syncPushRegistration } from '../notifications/pushPermission';
import { reportTimeZone } from '../notifications/timeZone';
import { MisconfiguredScreen } from '../components/MisconfiguredScreen';
import * as mockAuth from './mockAuth';
import * as supabaseAuth from './supabaseAuth';
import type { AuthStatus, AuthUser, SignUpInput } from './types';

// The one place that decides which backend is live. Every function below
// (and every screen, via useAuth()) is written against this shape, not
// against either module directly — see mobile/README.md.
const backend = isSupabaseConfigured ? supabaseAuth : mockAuth;

// mockAuth is a legitimate fallback in local dev/the web preview (no
// .env at all) — __DEV__ is false in every real distributed build
// (TestFlight, the App Store, an EAS internal-distribution link), so
// this only ever trips when one of those shipped without its Supabase
// env vars actually set. That combination must never silently fall
// through to mockAuth's hardcoded demo profile (see
// MisconfiguredScreen.tsx for why that's worse than it sounds).
const isProductionMisconfigured = !__DEV__ && !isSupabaseConfigured;

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  initializing: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  // Merges into the in-memory user right after a successful write
  // elsewhere (e.g. SettingsScreen's username save) — optimistic, not a
  // re-fetch, since the caller already knows the new value it just
  // persisted. Every other field here only ever changes via a fresh
  // sign-in/session restore, so this is deliberately narrow rather than
  // a general "patch anything" escape hatch.
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Only Supabase has a session worth restoring — mock auth never persists
  // anything, so there's nothing to wait on and the app can render
  // immediately (see src/health/HealthContext.tsx for the same shape of
  // "is there something async to resolve before first render" flag).
  const [initializing, setInitializing] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelled = false;

    // Always ends the loading screen, even offline or if the profile read
    // fails (M14 in the security review) — signed out is better than
    // stuck on the splash.
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        if (data.session) setUser(await supabaseAuth.userFromSession(data.session));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });

    // Keeps `user` in sync with token refreshes and with signOut() below
    // (which calls supabase.auth.signOut() and lets this listener clear
    // local state, rather than clearing it twice).
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        supabaseAuth.userFromSession(session).then((u) => {
          if (!cancelled) setUser(u);
        });
      } else if (!cancelled) {
        setUser(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Records "used the app today" for send-login-reminders — fires on a
  // fresh sign-in and on every session restore (a cold app launch with an
  // already-valid session), which is what a plain mount-time effect on
  // `user?.id` gives us here since this provider itself only mounts once
  // per app launch. Never blocks or surfaces an error: a failed write
  // here shouldn't stop anyone from using the app, it just means today's
  // reminder job won't see this open.
  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;
    touchLastActive(user.id).catch(() => {});
    // Which build and update this open is running, for Admin → App
    // versions (0076_app_version_tracking.sql).
    reportAppVersion(user.id);
    // Registers this phone for push once notifications are allowed, and
    // reports the phone's setting (0081_push_permission.sql).
    syncPushRegistration(user.id);
    // So reminders and alerts arrive in this person's own evening
    // (0088_local_time_alerts.sql).
    reportTimeZone(user.id);
  }, [user?.id]);

  // Every method re-throws whatever the backend rejects with, so screens
  // can show it directly (`err.message`) — this context adds no error
  // translation of its own.
  const signInWithGoogle = useCallback(async () => setUser(await backend.signInWithProvider('google')), []);
  const signInWithFacebook = useCallback(async () => setUser(await backend.signInWithProvider('facebook')), []);
  const signInWithApple = useCallback(async () => setUser(await backend.signInWithProvider('apple')), []);
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setUser(await backend.signInWithEmail(email, password));
  }, []);
  const signUpWithEmail = useCallback(async (input: SignUpInput) => {
    setUser(await backend.signUpWithEmail(input));
  }, []);
  const signOut = useCallback(async () => {
    await backend.signOut();
    // Redundant with the onAuthStateChange listener when Supabase is
    // configured, but that's the only backend that has one — mock auth
    // needs this to actually clear state.
    setUser(null);
  }, []);
  // No setUser here — unlike every sign-in method above, this doesn't
  // establish a session on this device; it just triggers an email.
  const resetPasswordForEmail = useCallback((email: string) => backend.resetPasswordForEmail(email), []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: user ? 'signedIn' : 'signedOut',
      user,
      initializing,
      signInWithGoogle,
      signInWithFacebook,
      signInWithApple,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      resetPasswordForEmail,
      updateUser,
    }),
    [
      user,
      initializing,
      signInWithGoogle,
      signInWithFacebook,
      signInWithApple,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      resetPasswordForEmail,
      updateUser,
    ],
  );

  if (isProductionMisconfigured) return <MisconfiguredScreen />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be called within an AuthProvider');
  return ctx;
}

import { initialsFor } from './initials';
import type { AuthProviderId, AuthUser, SignUpInput } from './types';

// Used when no Supabase project is configured (see src/lib/supabase.ts) —
// AuthContext.tsx picks this module or supabaseAuth.ts at import time based
// on isSupabaseConfigured. Every method here has the exact shape the real
// one does (async, can reject with a user-facing message), so neither
// AuthContext.tsx nor any screen needs to know which backend it's talking
// to. See mobile/README.md for what's mocked vs real.

function delay<T>(value: T, ms = 700): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// `id` is a fixed placeholder, not a real identity — nothing on the mock
// path ever reads challenge data keyed by user id (isSupabaseConfigured
// gates all of that), so it only needs to be present for AuthUser's
// shape, not meaningful.
const PROVIDER_PROFILE: Record<Exclude<AuthProviderId, 'email'>, AuthUser> = {
  google: { id: 'mock-google-user', name: 'Stephen Washington', email: 'sigmasteve@gmail.com', initials: 'SW', provider: 'google', isAdmin: false },
  facebook: { id: 'mock-facebook-user', name: 'Jordan Lee', email: 'jordan.lee@fb.example', initials: 'JL', provider: 'facebook', isAdmin: false },
  apple: { id: 'mock-apple-user', name: 'Jordan Lee', email: 'jordan.lee@icloud.com', initials: 'JL', provider: 'apple', isAdmin: false },
};

// A couple of emails a demo can bump into on purpose, so the error states
// (wrong password, email already registered) are actually reachable
// without a real backend to reject them.
const KNOWN_ACCOUNT = { email: 'jordan.lee@gmail.com', password: 'hound123' };

export async function signInWithProvider(provider: Exclude<AuthProviderId, 'email'>): Promise<AuthUser> {
  return delay(PROVIDER_PROFILE[provider], 900);
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  await delay(undefined, 700);
  const normalized = email.trim().toLowerCase();
  if (normalized === KNOWN_ACCOUNT.email && password !== KNOWN_ACCOUNT.password) {
    throw new Error('Incorrect email or password.');
  }
  if (normalized !== KNOWN_ACCOUNT.email && password.length < 6) {
    // No real account exists to check against — mirror the one validation
    // a real backend would still reject on: too-short passwords never
    // match anything.
    throw new Error('Incorrect email or password.');
  }
  const name = normalized === KNOWN_ACCOUNT.email ? 'Jordan Lee' : email.split('@')[0];
  return { id: 'mock-email-user', name, email, initials: initialsFor(name), provider: 'email', isAdmin: false };
}

export async function signUpWithEmail({ name, email, password }: SignUpInput): Promise<AuthUser> {
  await delay(undefined, 700);
  if (email.trim().toLowerCase() === KNOWN_ACCOUNT.email) {
    throw new Error('An account already exists for this email.');
  }
  return { id: 'mock-email-user', name, email, initials: initialsFor(name), provider: 'email', isAdmin: false };
}

export async function signOut(): Promise<void> {
  // Nothing to tear down — there's no session to invalidate anywhere but
  // AuthContext's own in-memory state.
}

export async function resetPasswordForEmail(_email: string): Promise<void> {
  // No real email to send on this path — mirrors signUpWithEmail's own
  // "succeed regardless of the address" shape, since there's no backend
  // here to check it against.
  await delay(undefined, 700);
}

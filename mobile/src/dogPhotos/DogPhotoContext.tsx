import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { friendDogPhotos, signedPhotoUrls } from './dogPhotos';

// The dog photos this phone may show (0191): your own and your friends',
// by the token in their avatar code, as links that last a day. Everyone
// else's avatar shows their hound. Loaded on sign-in, again every half
// hour the app is in front, and after you change your own photo.

interface DogPhotoState {
  urlFor: (token: string | null) => string | null;
  refresh: () => void;
}

const DogPhotoContext = createContext<DogPhotoState>({ urlFor: () => null, refresh: () => {} });

const REFRESH_MS = 30 * 60_000;

export function DogPhotoProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const loadedAt = useRef(0);

  const load = useCallback(async () => {
    if (!user?.id) {
      setUrls(new Map());
      return;
    }
    try {
      const photos = await friendDogPhotos();
      const signed = await signedPhotoUrls(photos.map((p) => p.path));
      const next = new Map<string, string>();
      for (const p of photos) {
        const url = signed.get(p.path);
        if (url) next.set(p.token, url);
      }
      setUrls(next);
      loadedAt.current = Date.now();
    } catch {
      // Before 0191 has run, or offline: everyone shows their hound.
    }
  }, [user?.id]);

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && Date.now() - loadedAt.current > REFRESH_MS) load();
    });
    return () => sub.remove();
  }, [load]);

  const value = useMemo<DogPhotoState>(
    () => ({ urlFor: (token) => (token ? (urls.get(token) ?? null) : null), refresh: () => void load() }),
    [urls, load],
  );
  return <DogPhotoContext.Provider value={value}>{children}</DogPhotoContext.Provider>;
}

export function useDogPhotos(): DogPhotoState {
  return useContext(DogPhotoContext);
}

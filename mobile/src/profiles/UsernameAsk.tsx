import React, { createContext, useCallback, useContext, useState } from 'react';
import { UsernamePrompt } from './UsernamePrompt';

// Asking for a username right where it's needed (joining a club or a
// community challenge, starting a club), instead of sending people to
// Settings with no easy way back. The same form as the setup wizard's
// username step, as a card over the screen; once it's saved, `then`
// carries on with what was being done.

type Ask = (body: string, then?: () => void) => void;

const AskCtx = createContext<Ask>(() => {});

export function UsernameAskProvider({ children }: { children: React.ReactNode }) {
  const [asking, setAsking] = useState<{ body: string; then?: () => void } | null>(null);
  const ask = useCallback<Ask>((body, then) => setAsking({ body, then }), []);
  return (
    <AskCtx.Provider value={ask}>
      {children}
      {asking && (
        <UsernamePrompt
          ask
          body={asking.body}
          dismissLabel="Not now"
          onClose={() => setAsking(null)}
          onSaved={() => asking.then?.()}
        />
      )}
    </AskCtx.Provider>
  );
}

export function useUsernameAsk(): Ask {
  return useContext(AskCtx);
}

export const CLUB_USERNAME_WHY = 'Clubs show usernames, not names, so people you don’t know never see your name. Friends still do.';
export const COMMUNITY_USERNAME_WHY =
  'Community leaderboards show usernames, not names, so people you don’t know never see your name. Friends still do.';

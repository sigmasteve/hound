import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getOrganization } from './supabaseOrganizations';
import { currencyNameOrDefault } from './types';

// The signed-in viewer's own org's name for Bones
// (organizations.currency_name, 0068_org_currency_name.sql). 'Bones' is
// the real, permanent answer for anyone with no org or an org that
// never renamed it — not a loading placeholder — so this starts there
// and only ever upgrades.
export function useCurrencyName(): string {
  const { user } = useAuth();
  const [currencyName, setCurrencyName] = useState('Bones');
  useEffect(() => {
    if (!user?.organizationId) {
      setCurrencyName('Bones');
      return;
    }
    let cancelled = false;
    getOrganization(user.organizationId)
      .then((org) => {
        if (!cancelled) setCurrencyName(currencyNameOrDefault(org?.currencyName));
      })
      .catch(() => {
        // Stay on 'Bones' — same convention every other real-data fetch
        // in this app follows.
      });
    return () => {
      cancelled = true;
    };
  }, [user?.organizationId]);
  return currencyName;
}

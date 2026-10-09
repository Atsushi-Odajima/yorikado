'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Scanned tokens are kept ONLY in memory (React state in the vouchers layout),
 * never in localStorage/sessionStorage. A reload clears them by design.
 */
interface Basket {
  campaignId: string | null;
  tokens: string[];
  set: (campaignId: string, tokens: string[]) => void;
  clear: () => void;
}
const Ctx = createContext<Basket | null>(null);

export function BasketProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ campaignId: string | null; tokens: string[] }>({ campaignId: null, tokens: [] });
  const value = useMemo<Basket>(
    () => ({
      ...state,
      set: (campaignId, tokens) => setState({ campaignId, tokens }),
      clear: () => setState({ campaignId: null, tokens: [] }),
    }),
    [state],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBasket(): Basket {
  const b = useContext(Ctx);
  if (!b) throw new Error('BasketProvider missing');
  return b;
}

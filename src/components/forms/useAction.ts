'use client';

import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useMfa } from '@/components/feedback/MfaProvider';

/** Busy/error state for one server action; prevents double submission. */
export function useAction() {
  const mfa = useMfa();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (busy) return undefined;
      setBusy(true);
      setError(null);
      try {
        return await mfa(fn);
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError('INTERNAL', '処理できませんでした', 0));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [busy, mfa],
  );
  return { busy, error, setError, run, fieldError: (k: string) => error?.fieldErrors?.[k] };
}

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { Button, ui } from '@/components/ui';

type Runner = <T>(fn: () => Promise<T>) => Promise<T>;
const Ctx = createContext<Runner>((fn) => fn());

/**
 * Wraps sensitive operations: when the server answers MFA_REQUIRED, ask for
 * the 6-digit code, verify it, then retry the same request (same idempotency key).
 */
export function MfaProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const ask = () =>
    new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject };
      setCode('');
      setError(null);
      setOpen(true);
    });

  const run: Runner = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') {
        await ask();
        return fn();
      }
      throw e;
    }
  }, []);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/mfa/verify', { body: { code } });
      setOpen(false);
      pending.current?.resolve();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'コードを確認できませんでした');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Ctx.Provider value={run}>
      {children}
      <Dialog.Root
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(false);
            pending.current?.reject(new ApiError('MFA_REQUIRED', '認証コードの入力を中止しました。操作は行われていません', 403));
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={ui.overlay} />
          <Dialog.Content className={ui.dialog}>
            <Dialog.Title className={ui.h1}>本人確認</Dialog.Title>
            <Dialog.Description className={ui.lead}>
              大切な操作のため、認証アプリに表示されている6桁のコードを入力してください。
            </Dialog.Description>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <div className={ui.field}>
                <label className={ui.label} htmlFor="mfa-code">
                  認証コード（6桁）
                </label>
                <input
                  id="mfa-code"
                  className={ui.input}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'mfa-err' : undefined}
                  autoFocus
                />
                {error && (
                  <p id="mfa-err" className={ui.fieldError}>
                    {error}
                  </p>
                )}
              </div>
              <div className={ui.stack}>
                <Button type="submit" busy={busy} busyLabel="確認中です" disabled={code.length !== 6}>
                  確認して続ける
                </Button>
                <Dialog.Close asChild>
                  <button type="button" className={ui.secondary}>
                    やめる（操作しない）
                  </button>
                </Dialog.Close>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}

export function useMfa(): Runner {
  return useContext(Ctx);
}

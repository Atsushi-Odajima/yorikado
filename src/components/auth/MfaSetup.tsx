'use client';

/* eslint-disable @next/next/no-img-element */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, Notice, ui } from '@/components/ui';
import { api } from '@/lib/api-client';
import s from './auth.module.css';

interface Status {
  currentLevel: string | null;
  factors: { id: string; status: string }[];
}

export function MfaSetup() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const load = useAction();
  const act = useAction();

  useEffect(() => {
    void load.run(() => api<Status>('/auth/mfa')).then((r) => r && setStatus(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status) return <p aria-busy="true">確認中です</p>;
  const verified = status.factors.some((f) => f.status === 'verified');

  async function verify() {
    const r = await act.run(() => api<{ next: string }>('/auth/mfa/verify', { body: { factorId: enroll?.factorId, code } }));
    if (r) {
      router.replace(r.next === '/mfa' ? '/o' : r.next);
      router.refresh();
    }
  }

  return (
    <>
      <h1 className={ui.h1}>二段階認証</h1>
      <p className={ui.lead}>事務局の操作・口座の変更には、認証アプリ（Google Authenticator等）の6桁コードが必要です。</p>
      <ErrorNotice error={load.error ?? act.error} />
      {!verified && !enroll && (
        <Button busy={act.busy} onClick={async () => {
          const r = await act.run(() => api<{ factorId: string; qrCode: string; secret: string }>('/auth/mfa/enroll', { body: {} }));
          if (r) setEnroll(r);
        }}>
          認証アプリを登録する
        </Button>
      )}
      {enroll && (
        <div className={ui.stack}>
          <p>1. 認証アプリでこのコードを読み取ってください。</p>
          <img className={s.qr} src={enroll.qrCode} alt="認証アプリ登録用のQRコード" width={232} height={232} />
          <p className={ui.help}>読み取れない場合は次の文字を入力: <span className={s.secret}>{enroll.secret}</span></p>
          <p>2. アプリに表示された6桁を入力してください。</p>
        </div>
      )}
      {(verified || enroll) && (
        <form onSubmit={(e) => { e.preventDefault(); void verify(); }} style={{ marginTop: 16 }}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="code">認証コード（6桁）</label>
            <input id="code" className={ui.input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          <Button type="submit" busy={act.busy} busyLabel="確認中です" disabled={code.length !== 6}>
            確認する
          </Button>
        </form>
      )}
      {verified && status.currentLevel === 'aal2' && <Notice tone="success" title="認証済みです" />}
    </>
  );
}

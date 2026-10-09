'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, Notice, ui } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';

export function ShopCreate({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [f, setF] = useState({ displayName: '', legalName: '', address: '', contactPhone: '', externalCode: '' });
  const key = useRef(newKey());
  const { busy, error, run, fieldError } = useAction();
  const input = (k: keyof typeof f, label: string) => (
    <div className={ui.field} style={{ margin: 0 }}>
      <label className={ui.label} htmlFor={`s-${k}`}>{label}</label>
      <input id={`s-${k}`} className={ui.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-invalid={!!fieldError(k)} />
      {fieldError(k) && <p className={ui.fieldError}>{fieldError(k)}</p>}
    </div>
  );
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => api<{ id: string }>('/shops', { body: { tenantId, ...f }, idempotencyKey: key.current }));
      if (r) router.push(`/o/shops/${r.id}`);
    }}>
      <ErrorNotice error={error} />
      <div className={ui.row} style={{ alignItems: 'flex-end' }}>
        {input('displayName', '店名')}
        {input('legalName', '事業者名')}
        {input('address', '住所')}
        {input('contactPhone', '電話')}
        {input('externalCode', '店舗コード（外部CSV用）')}
        <Button type="submit" inline busy={busy} disabled={!f.displayName.trim()}>登録する</Button>
      </div>
    </form>
  );
}

export function ShopEdit({ shop }: { shop: { id: string; displayName: string; legalName: string; address: string; contactPhone: string; externalCode: string | null; status: string; version: number } }) {
  const router = useRouter();
  const [f, setF] = useState({ displayName: shop.displayName, legalName: shop.legalName, address: shop.address, contactPhone: shop.contactPhone, externalCode: shop.externalCode ?? '', status: shop.status });
  const { busy, error, run } = useAction();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => api(`/shops/${shop.id}`, { method: 'PATCH', body: { ...f, expectedVersion: shop.version } }));
      if (r) router.refresh();
    }}>
      <ErrorNotice error={error} />
      <div className={ui.row} style={{ alignItems: 'flex-end' }}>
        {(['displayName', 'legalName', 'address', 'contactPhone', 'externalCode'] as const).map((k) => (
          <div key={k} className={ui.field} style={{ margin: 0 }}>
            <label className={ui.label} htmlFor={`e-${k}`}>{{ displayName: '店名', legalName: '事業者名', address: '住所', contactPhone: '電話', externalCode: '店舗コード' }[k]}</label>
            <input id={`e-${k}`} className={ui.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </div>
        ))}
        <div className={ui.field} style={{ margin: 0 }}>
          <label className={ui.label} htmlFor="e-status">状態</label>
          <select id="e-status" className={ui.select} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">利用中</option><option value="suspended">停止</option><option value="closed">退会（履歴は残す）</option>
          </select>
        </div>
        <Button type="submit" inline busy={busy}>保存する</Button>
      </div>
    </form>
  );
}

export function InviteForm({ tenantId, shopId, roles }: { tenantId: string; shopId: string | null; roles: [string, string][] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles[0]![0]);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef(newKey());
  const { busy, error, run } = useAction();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => api('/invitations', { body: { tenantId, email, role, shopId }, idempotencyKey: key.current }));
      if (r) { setDone(email); setEmail(''); key.current = newKey(); router.refresh(); }
    }}>
      <ErrorNotice error={error} />
      {done && <Notice tone="success" title="招待メールを送信待ちにしました">{done} に72時間有効・1回限りのリンクが届きます（送信は自動ジョブが行います）。</Notice>}
      <div className={ui.row} style={{ alignItems: 'flex-end' }}>
        <div className={ui.field} style={{ margin: 0, flex: 1, minWidth: 220 }}>
          <label className={ui.label} htmlFor="inv-email">メールアドレス</label>
          <input id="inv-email" type="email" className={ui.input} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className={ui.field} style={{ margin: 0 }}>
          <label className={ui.label} htmlFor="inv-role">役割</label>
          <select id="inv-role" className={ui.select} value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <Button type="submit" inline busy={busy} disabled={!email}>招待する</Button>
      </div>
    </form>
  );
}

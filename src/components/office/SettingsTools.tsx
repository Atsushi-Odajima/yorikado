'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, dt, ui } from '@/components/ui';
import { api } from '@/lib/api-client';
import { ActionButton } from './Actions';

export function TenantSettingsForm({ tenant }: { tenant: { id: string; version: number; contact: string; officeHours: string; replyGuidance: string; emailNotifications: boolean } }) {
  const router = useRouter();
  const [f, setF] = useState(tenant);
  const { busy, error, run } = useAction();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => api(`/tenants/${tenant.id}/settings`, { method: 'PUT', body: { expectedVersion: tenant.version, contact: f.contact, officeHours: f.officeHours, replyGuidance: f.replyGuidance, emailNotifications: f.emailNotifications } }));
      if (r) router.refresh();
    }}>
      <ErrorNotice error={error} />
      {(['contact', 'officeHours', 'replyGuidance'] as const).map((k) => (
        <div key={k} className={ui.field}>
          <label className={ui.label} htmlFor={k}>{{ contact: '問い合わせ先（停止時に店舗へ表示）', officeHours: '受付時間', replyGuidance: '返事の目安' }[k]}</label>
          <input id={k} className={ui.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </div>
      ))}
      <label className={ui.choice} data-checked={f.emailNotifications} style={{ marginBottom: 16 }}>
        <input type="checkbox" checked={f.emailNotifications} onChange={(e) => setF({ ...f, emailNotifications: e.target.checked })} />
        アプリ内通知と同じ内容をメールでも送る（本文に金額・口座などは含めません）
      </label>
      <Button type="submit" inline busy={busy}>保存する</Button>
    </form>
  );
}

const ROLES: [string, string][] = [['office_operator', '担当'], ['office_approver', '承認'], ['auditor', '監査'], ['tenant_admin', '管理者']];

export function MemberRoles({ tenantId, me, members }: { tenantId: string; me: string; members: { id: string; name: string; email: string; roles: string[]; revoked: string[] }[] }) {
  return (
    <table className={ui.table}>
      <thead><tr><th>名前</th><th>メール</th>{ROLES.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.id}>
            <td>{m.name}{m.id === me && '（自分）'}</td>
            <td>{m.email}</td>
            {ROLES.map(([r]) => {
              const has = m.roles.includes(r);
              const known = has || m.revoked.includes(r);
              return (
                <td key={r}>
                  {has ? '✓ ' : ''}
                  {has && <ActionButton path="/memberships" body={{ tenantId, userId: m.id, role: r, status: 'revoked' }} label="外す" variant="secondary" />}
                  {!has && known && m.id !== me && <ActionButton path="/memberships" body={{ tenantId, userId: m.id, role: r, status: 'active' }} label="戻す" variant="secondary" />}
                  {!has && !known && m.id !== me && m.roles.length > 0 && <ActionButton path="/memberships" body={{ tenantId, userId: m.id, role: r, status: 'active' }} label="付与" variant="secondary" />}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ExportPanel({ tenantId, items }: { tenantId: string; items: { id: string; status: string; masked: boolean; createdAt: string; expiresAt: string | null }[] }) {
  const router = useRouter();
  const req = useAction();
  const dl = useAction();
  return (
    <div className={ui.stack}>
      <ErrorNotice error={req.error ?? dl.error} />
      <Button inline busy={req.busy} onClick={async () => { const r = await req.run(() => api('/exports/tenant', { body: { tenantId } })); if (r) router.refresh(); }}>
        出力を作成する
      </Button>
      <ul className={ui.list}>
        {items.map((x) => (
          <li key={x.id} className={ui.listItem} style={{ padding: '8px 0' }}>
            {dt(x.createdAt)}・{x.masked ? 'マスク版' : '完全版'}・{{ queued: '作成中（数分かかります）', ready: '取得できます', failed: '失敗', expired: '期限切れ' }[x.status]}
            {x.status === 'ready' && (
              <Button inline variant="secondary" busy={dl.busy} onClick={async () => {
                const r = await dl.run(() => api<{ url: string }>(`/exports/${x.id}/download`, { body: {} }));
                if (r) window.location.href = r.url;
              }}>ダウンロード（認証コード）</Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

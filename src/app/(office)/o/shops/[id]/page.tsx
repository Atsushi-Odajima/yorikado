import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton, NoteAction } from '@/components/office/Actions';
import { InviteForm, ShopEdit } from '@/components/office/ShopTools';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { dt, StateBadge, ui } from '@/components/ui';
import { nowMs } from '@/lib/time';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '店舗の詳細' };

interface Shop {
  id: string;
  displayName: string;
  legalName: string;
  address: string;
  contactPhone: string;
  externalCode: string | null;
  status: string;
  version: number;
  members: { userId: string; role: string; status: string; displayName: string | null; email: string | null }[];
  invitations: { id: string; email: string; role: string; status: string; expiresAt: string; createdAt: string }[];
  bankAccounts: { id: string; version: number; label: string; status: string; requestedBy: string; createdAt: string; decidedAt: string | null }[];
}
const ROLE: Record<string, string> = { shop_staff: '店員', shop_owner: '店主' };

export default async function OfficeShopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, office, can } = await requireOffice();
  const s = await load<Shop>(db, 'api_shop_get', { p_shop: id });
  const editor = can(['office_operator', 'tenant_admin']);
  return (
    <OfficeShell me={me} office={office} tab="shops">
      <Link href="/o/shops">← 店舗の一覧</Link>
      <h1 className={o.h1} style={{ marginTop: 8 }}>{s.displayName}</h1>
      {editor && <section className={o.section}><h2 className={ui.h2} style={{ marginTop: 0 }}>店舗情報</h2><ShopEdit shop={s} /></section>}
      <section className={o.section}>
        <h2 className={ui.h2} style={{ marginTop: 0 }}>担当者</h2>
        <table className={ui.table}>
          <thead><tr><th>名前</th><th>メール</th><th>役割</th><th>状態</th><th /></tr></thead>
          <tbody>
            {s.members.map((m) => (
              <tr key={`${m.userId}-${m.role}`}>
                <td>{m.displayName ?? '—'}</td><td>{m.email}</td><td>{ROLE[m.role]}</td>
                <td>{m.status === 'active' ? '有効' : '無効'}</td>
                <td>{editor && m.status === 'active' && <ActionButton path="/shop-memberships" body={{ shopId: id, userId: m.userId, role: m.role, status: 'revoked' }} label="無効にする" variant="secondary" confirmText="この担当者の店舗へのアクセスを止めます。よろしいですか？" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {editor && (
          <div style={{ marginTop: 16 }}>
            <h3 className={ui.h2}>店舗の担当者を招待する</h3>
            <InviteForm tenantId={office.tenantId} shopId={id} roles={[['shop_staff', '店員'], ['shop_owner', '店主']]} />
          </div>
        )}
        {s.invitations.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary>招待の履歴</summary>
            <ul>{s.invitations.map((i) => (
              <li key={i.id}>{i.email}・{ROLE[i.role]}・{{ pending: Date.parse(i.expiresAt) < nowMs() ? '期限切れ' : '未使用', used: '使用済み', revoked: '取消' }[i.status]}・期限 {dt(i.expiresAt)}
                {i.status === 'pending' && editor && <> <ActionButton path={`/invitations/${i.id}/revoke`} label="取り消す" variant="secondary" /></>}
              </li>
            ))}</ul>
          </details>
        )}
      </section>
      <section className={o.section}>
        <h2 className={ui.h2} style={{ marginTop: 0 }}>入金先の口座</h2>
        <p className={ui.help}>口座は下4桁以外を表示しません。変更は店主の申請を、申請者とは別の承認者が承認します。</p>
        <table className={ui.table}>
          <thead><tr><th>版</th><th>口座</th><th>状態</th><th>申請</th><th /></tr></thead>
          <tbody>
            {s.bankAccounts.map((b) => (
              <tr key={b.id}>
                <td>{b.version}</td><td>{b.label}</td>
                <td><StateBadge tone={b.status === 'approved' ? 'done' : b.status === 'pending' ? 'todo' : 'error'}>{{ approved: '承認済み', pending: '承認待ち', rejected: '不承認' }[b.status]}</StateBadge></td>
                <td>{dt(b.createdAt)}</td>
                <td>
                  {b.status === 'pending' && can(['office_approver']) && b.requestedBy !== me.userId && (
                    <div className={ui.row}>
                      <NoteAction path={`/bank-change-requests/${b.id}/approve`} field="note" extra={{ approve: true }} label="承認する" variant="primary" noteLabel="本人確認の方法（例: 店主に電話で確認、通帳写しを確認）" />
                      <NoteAction path={`/bank-change-requests/${b.id}/approve`} field="note" extra={{ approve: false }} label="承認しない" noteLabel="理由" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </OfficeShell>
  );
}

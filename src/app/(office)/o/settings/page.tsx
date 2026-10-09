import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ExportPanel, MemberRoles, TenantSettingsForm } from '@/components/office/SettingsTools';
import { InviteForm } from '@/components/office/ShopTools';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { ui } from '@/components/ui';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '組織の設定' };

export default async function SettingsPage() {
  const { db, me, office, can } = await requireOffice();
  if (!can(['tenant_admin', 'auditor'])) redirect('/o');
  const isAdmin = can(['tenant_admin']);
  const [{ data: t }, members, exports] = await Promise.all([
    db.from('tenants').select('*').eq('id', office.tenantId).single(),
    load<{ userId: string; displayName: string | null; email: string | null; roles: string[] | null; revokedRoles: string[] | null }[]>(db, 'api_office_members', { p_tenant: office.tenantId }),
    load<{ id: string; status: string; masked: boolean; createdAt: string; expiresAt: string | null }[]>(db, 'api_exports_list', { p_tenant: office.tenantId }),
  ]);
  return (
    <OfficeShell me={me} office={office} tab={null}>
      <h1 className={o.h1}>組織の設定</h1>
      {isAdmin && t && (
        <section className={o.section}>
          <h2 className={ui.h2} style={{ marginTop: 0 }}>連絡先・通知</h2>
          <TenantSettingsForm tenant={{ id: t.id, version: t.version, contact: t.contact, officeHours: t.office_hours, replyGuidance: t.reply_guidance, emailNotifications: t.email_notifications }} />
        </section>
      )}
      {isAdmin && (
        <section className={o.section}>
          <h2 className={ui.h2} style={{ marginTop: 0 }}>事務局メンバー</h2>
          <p className={ui.help}>権限の変更には認証コードが必要です。自分自身への付与・最後の管理者の削除はできません。新しいメンバーは招待から追加します。</p>
          <MemberRoles tenantId={office.tenantId} me={me.userId} members={members.map((m) => ({ id: m.userId, name: m.displayName ?? '', email: m.email ?? '', roles: m.roles ?? [], revoked: m.revokedRoles ?? [] }))} />
          <h3 className={ui.h2}>事務局メンバーを招待する</h3>
          <InviteForm tenantId={office.tenantId} shopId={null} roles={[['office_operator', '担当'], ['office_approver', '承認'], ['auditor', '監査'], ['tenant_admin', '管理者']]} />
        </section>
      )}
      <section className={o.section} id="export">
        <h2 className={ui.h2} style={{ marginTop: 0 }}>データ出力</h2>
        <p className={ui.help}>この組織のデータだけをJSON/CSV/添付のZIPで出力します。券の生token・暗号鍵・口座番号は含みません。監査担当の出力はマスク版です。取得リンクは60秒、ファイルは24時間で期限切れです。</p>
        <ExportPanel tenantId={office.tenantId} items={exports} />
      </section>
    </OfficeShell>
  );
}

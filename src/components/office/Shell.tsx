import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoBanner } from '@/components/ui';
import type { Me, MeOffice } from '@/server/auth/page';
import { OrgSwitch } from './OrgSwitch';
import o from './office.module.css';

const ROLE: Record<string, string> = { office_operator: '担当', office_approver: '承認', tenant_admin: '管理者', auditor: '監査' };
const TABS = [
  ['queue', '/o', '対応待ち'],
  ['vouchers', '/o/campaigns', '地域券'],
  ['tasks', '/o/tasks', '依頼'],
  ['requests', '/o/requests', '相談'],
  ['shops', '/o/shops', '店舗'],
] as const;
export type OfficeTab = (typeof TABS)[number][0];

export function OfficeShell({ me, office, tab, children }: { me: Me; office: MeOffice; tab: OfficeTab | null; children: ReactNode }) {
  return (
    <>
      <DemoBanner environment={me.environment} />
      <header className={o.top}>
        <div className={o.topInner}>
          <div className={o.org}>
            <OrgSwitch
              current={{ id: office.tenantId, name: office.tenantName }}
              offices={me.offices.map((x) => ({ id: x.tenantId, name: x.tenantName }))}
              canAdmin={office.roles.includes('tenant_admin')}
              canAudit={office.roles.some((r) => ['tenant_admin', 'auditor', 'office_approver'].includes(r))}
              hasShops={me.shops.length > 0}
            />
            <span className={o.roles}>
              {me.profile?.displayName}・{office.roles.map((r) => ROLE[r] ?? r).join('／')}
              {office.tenantStatus !== 'active' && '・利用停止中'}
            </span>
          </div>
          <nav className={o.tabs} aria-label="事務局メニュー">
            {TABS.map(([key, href, label]) => (
              <Link key={key} href={href} className={o.tab} aria-current={tab === key ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className={o.main}>{children}</main>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { MerchantShell } from '@/components/merchant/Shell';
import m from '@/components/merchant/merchant.module.css';
import { Icon, Notice, StateBadge } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: 'ホーム' };

interface Campaign {
  id: string;
  name: string;
  mode: 'owned_qr' | 'paper_count' | 'external_csv';
  status: string;
  usable: boolean;
  reason: string | null;
  externalServiceUrl: string;
}
interface Home {
  environment: string;
  campaigns: Campaign[];
  unansweredCount: number;
  unreadNotifications: number;
}

function primaryAction(campaigns: Campaign[]): { href: string; label: string; sub: string; external?: boolean } | null {
  const usable = campaigns.filter((c) => c.usable);
  const modes = new Set(usable.map((c) => c.mode));
  if (usable.length === 0) return null;
  if (modes.size > 1 || usable.length > 1) return { href: '/m/vouchers', label: '券を受け付ける', sub: `対応中の地域券 ${usable.length}件から選びます` };
  const c = usable[0]!;
  if (c.mode === 'owned_qr') return { href: `/m/vouchers/scan?campaignId=${c.id}`, label: '券を読み取る', sub: `${c.name}を受け付けます` };
  if (c.mode === 'paper_count') return { href: `/m/paper/new?campaignId=${c.id}`, label: '紙券を登録する', sub: `${c.name}の枚数を申告します` };
  if (c.externalServiceUrl) return { href: c.externalServiceUrl, label: '公式の券サービスを開く', sub: `${c.name}（外部のサービスが開きます）`, external: true };
  return null;
}

export default async function MerchantHome() {
  const { db, me, shop } = await requireMerchant();
  const home = await load<Home>(db, 'api_merchant_home', { p_shop: shop.shopId });
  const action = primaryAction(home.campaigns);
  const stopped = home.campaigns.filter((c) => !c.usable && c.reason);
  if (shop.tenantStatus !== 'active') {
    return (
      <MerchantShell shop={shop} environment={me.environment} nav="home">
        <Notice tone="error" title="商店街の利用が停止されています">
          お問い合わせ: {shop.tenantContact || '事務局'}
        </Notice>
      </MerchantShell>
    );
  }
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="home" unread={home.unreadNotifications}>
      <h1 className="sr-only">ホーム</h1>
      {action ? (
        action.external ? (
          <a href={action.href} className={m.primary} target="_blank" rel="noopener noreferrer">
            <Icon name="scan" size={32} />
            <span>
              <span className={m.primaryLabel}>{action.label}</span>
              <br />
              <span className={m.primarySub}>{action.sub}</span>
            </span>
          </a>
        ) : (
          <Link href={action.href} className={m.primary}>
            <Icon name="scan" size={32} />
            <span>
              <span className={m.primaryLabel}>{action.label}</span>
              <br />
              <span className={m.primarySub}>{action.sub}</span>
            </span>
          </Link>
        )
      ) : (
        <div className={m.primaryDisabled} aria-disabled="true">
          <Icon name="scan" size={32} />
          <span>
            <span className={m.primaryLabel}>券の受付</span>
            <br />
            <span className={m.primarySub}>今、この店で受け付けられる地域券はありません</span>
          </span>
        </div>
      )}
      {stopped.map((c) => (
        <Notice key={c.id} tone="warning" title={`${c.name}：受け付けできません`}>
          {c.reason}
        </Notice>
      ))}
      <ul className={m.rows}>
        <li>
          <Link href="/m/tasks" className={m.rowLink}>
            <Icon name="reply" />
            <span className={m.rowText}>報告・返事をする</span>
            {home.unansweredCount > 0 ? <StateBadge tone="todo">あと{home.unansweredCount}件</StateBadge> : <StateBadge tone="done">完了</StateBadge>}
            <Icon name="arrow" />
          </Link>
        </li>
        <li>
          <Link href="/m/requests" className={m.rowLink}>
            <Icon name="office" />
            <span className={m.rowText}>事務局に相談する</span>
            <Icon name="arrow" />
          </Link>
        </li>
      </ul>
      <Link href="/m/settlements" className={m.subLink}>
        地域券の入金予定を見る
      </Link>
    </MerchantShell>
  );
}

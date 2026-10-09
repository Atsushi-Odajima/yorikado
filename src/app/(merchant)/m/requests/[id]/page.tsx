/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next';
import Link from 'next/link';
import { RequestReply } from '@/components/merchant/RequestReply';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import m from '@/components/merchant/merchant.module.css';
import { dt, Notice, StateBadge, ui } from '@/components/ui';
import { CATEGORY_LABEL, REQUEST_STATUS_LABEL, type RequestCategory } from '@/domain/requests/categories';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '相談の詳細' };

export interface RequestDetail {
  id: string;
  requestNumber: string;
  shopName: string;
  category: RequestCategory;
  subject: string;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  reopenableUntil: string | null;
  officeHours: string;
  replyGuidance: string;
  version: number;
  messages: { id: string; authorSide: string; authorName: string | null; visibility: string; body: string; attachmentIds: string[]; createdAt: string }[];
}

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, me, shop } = await requireMerchant();
  const r = await load<RequestDetail>(db, 'api_request_get', { p_req: id });
  const canReopen = r.status !== 'resolved' || (r.reopenableUntil !== null && Date.parse(r.reopenableUntil) > Date.now());
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <BackLink href="/m/requests" label="相談の一覧へ" />
      {sp.sent && <Notice tone="success" title={`受け付けました（受付番号 ${r.requestNumber}）`}>{r.replyGuidance || '事務局からの返事をお待ちください。'}</Notice>}
      <p className={ui.meta}>{r.requestNumber}・{CATEGORY_LABEL[r.category]}</p>
      <h1 className={ui.h1}>{r.subject}</h1>
      <p style={{ marginBottom: 16 }}>
        <StateBadge tone={r.status === 'resolved' ? 'done' : r.status === 'awaiting_shop' ? 'todo' : 'muted'}>{REQUEST_STATUS_LABEL[r.status]}</StateBadge>
      </p>
      {r.status === 'awaiting_shop' && <Notice tone="warning" title="事務局があなたの返事を待っています" />}
      {r.status === 'resolved' && (
        <Notice tone="success" title="完了しました">
          {r.resolutionNote}
          {r.reopenableUntil && <p className={ui.meta}>{dt(r.reopenableUntil)}まで、この相談に返信して再開できます。</p>}
        </Notice>
      )}
      <section aria-label="やりとり">
        {r.messages.map((msg) => (
          <article key={msg.id} className={msg.authorSide === 'office' ? m.msgOffice : m.msg}>
            <p className={ui.meta}>{msg.authorSide === 'office' ? '事務局' : msg.authorName ?? '店舗'}・{dt(msg.createdAt)}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</p>
            {msg.attachmentIds.length > 0 && (
              <div className={m.thumbs}>
                {msg.attachmentIds.map((a, i) => (
                  <a key={a} href={`/api/v1/attachments/${a}/download`} target="_blank" rel="noreferrer">
                    <img className={m.thumb} src={`/api/v1/attachments/${a}/download`} alt={`添付写真${i + 1}`} width={88} height={88} />
                  </a>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
      {canReopen ? (
        <RequestReply requestId={r.id} shopId={shop.shopId} resolved={r.status === 'resolved'} />
      ) : (
        <p>
          この相談は完了から30日を過ぎました。<Link href={`/m/requests/new?related=${r.id}`}>新しい相談として送る</Link>
        </p>
      )}
    </MerchantShell>
  );
}

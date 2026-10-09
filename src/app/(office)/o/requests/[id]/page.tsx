/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfficeReply, RequestStatusPanel } from '@/components/office/RequestTools';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { dt, Notice, ui } from '@/components/ui';
import { CATEGORY_LABEL, type RequestCategory } from '@/domain/requests/categories';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '相談の対応' };

interface Detail {
  id: string;
  requestNumber: string;
  shopName: string;
  category: RequestCategory;
  subject: string;
  status: string;
  assignedTo: string | null;
  resolutionNote: string | null;
  relatedReceiptNumber: string | null;
  relatedRequestId: string | null;
  version: number;
  messages: { id: string; authorSide: string; authorName: string | null; visibility: string; body: string; attachmentIds: string[]; createdAt: string }[];
}

export default async function OfficeRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, office } = await requireOffice();
  const [r, members] = await Promise.all([
    load<Detail>(db, 'api_request_get', { p_req: id }),
    load<{ userId: string; displayName: string; roles: string[] | null }[]>(db, 'api_office_members', { p_tenant: office.tenantId }),
  ]);
  return (
    <OfficeShell me={me} office={office} tab="requests">
      <Link href="/o/requests">← 相談の一覧</Link>
      <h1 className={o.h1} style={{ marginTop: 8 }}>{r.requestNumber}：{r.subject}</h1>
      <p className={ui.lead}>{r.shopName}・{CATEGORY_LABEL[r.category]}{r.relatedReceiptNumber && `・関連する受付番号 ${r.relatedReceiptNumber}`}{r.relatedRequestId && <> ・<Link href={`/o/requests/${r.relatedRequestId}`}>以前の相談</Link></>}</p>
      <div className={o.split}>
        <div>
          {r.messages.map((msg) => (
            <article key={msg.id} className={msg.visibility === 'internal' ? o.memo : msg.authorSide === 'office' ? o.officeMsg : o.shopMsg}>
              <p className={ui.meta}>
                {msg.visibility === 'internal' ? '【内部メモ・店舗には表示されません】' : msg.authorSide === 'office' ? '事務局→店舗' : '店舗'}・{msg.authorName ?? ''}・{dt(msg.createdAt)}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</p>
              {msg.attachmentIds.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {msg.attachmentIds.map((a, i) => (
                    <a key={a} href={`/api/v1/attachments/${a}/download`} target="_blank" rel="noreferrer">
                      <img src={`/api/v1/attachments/${a}/download`} alt={`添付写真${i + 1}`} width={120} height={90} style={{ objectFit: 'cover', border: '1px solid var(--line)' }} />
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
          {r.status === 'resolved' ? (
            <Notice tone="success" title="完了">{r.resolutionNote}（店舗は30日以内なら返信で再開できます）</Notice>
          ) : (
            <OfficeReply requestId={id} tenantId={office.tenantId} />
          )}
        </div>
        <aside className={o.panel}>
          <RequestStatusPanel requestId={id} version={r.version} status={r.status} assignedTo={r.assignedTo} members={members.filter((x) => (x.roles ?? []).length > 0).map((x) => ({ id: x.userId, name: x.displayName }))} />
        </aside>
      </div>
    </OfficeShell>
  );
}

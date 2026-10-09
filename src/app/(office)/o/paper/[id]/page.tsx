/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PaperReview } from '@/components/office/PaperReview';
import { PAPER_STATUS } from '@/components/office/labels';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { d, dt, Notice, ui, yen } from '@/components/ui';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '紙券の原本確認' };

export default async function PaperReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, office, can } = await requireOffice();
  const { data: p } = await db.from('paper_reports').select('*, campaigns(name), shops(display_name)').eq('id', id).eq('tenant_id', office.tenantId).maybeSingle();
  if (!p) notFound();
  return (
    <OfficeShell me={me} office={office} tab="vouchers">
      <Link href={`/o/campaigns/${p.campaign_id}`}>← 事業へ</Link>
      <h1 className={o.h1} style={{ marginTop: 8 }}>紙券の原本確認</h1>
      <div className={o.split}>
        <section className={o.section}>
          <dl className={ui.dl}>
            <dt>店舗</dt><dd>{(p.shops as { display_name: string }).display_name}</dd>
            <dt>事業</dt><dd>{(p.campaigns as { name: string }).name}</dd>
            <dt>受取日</dt><dd>{d(p.received_date)}</dd>
            <dt>枚数</dt><dd>{Object.entries(p.denomination_counts as Record<string, number>).map(([k, n]) => `${yen(Number(k))}×${n}`).join('、')}</dd>
            <dt>申告額</dt><dd className="tabular">{yen(p.claimed_amount)}</dd>
            <dt>束番号</dt><dd>{p.original_bundle_ref || '—'}</dd>
            <dt>状態</dt><dd>{PAPER_STATUS[p.status]}</dd>
            <dt>提出</dt><dd>{dt(p.submitted_at)}</dd>
            {p.verified_amount !== null && (<><dt>確認額</dt><dd className="tabular">{yen(p.verified_amount)}</dd></>)}
            {p.difference_reason && (<><dt>差異の理由</dt><dd>{p.difference_reason}</dd></>)}
            {p.original_present !== null && (<><dt>原本</dt><dd>{p.original_present ? 'あり' : 'なし'}・{p.original_storage || '保管場所未記録'}・{p.original_return_status || '返却状態未記録'}</dd></>)}
          </dl>
          {(p.photo_ids as string[]).length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              {(p.photo_ids as string[]).map((a, i) => (
                <a key={a} href={`/api/v1/attachments/${a}/download`} target="_blank" rel="noreferrer">
                  <img src={`/api/v1/attachments/${a}/download`} alt={`券の写真${i + 1}`} width={160} height={120} style={{ objectFit: 'cover', border: '1px solid var(--line)' }} />
                </a>
              ))}
            </div>
          )}
          <p className={ui.help} style={{ marginTop: 12 }}>写真だけで同一の紙券かは判断できません。必ず原本を確認してください。</p>
        </section>
        <aside className={o.panel}>
          {p.status === 'submitted' && can(['office_operator']) ? (
            <PaperReview id={p.id} claimed={p.claimed_amount} version={p.version} />
          ) : (
            <Notice tone="info" title={PAPER_STATUS[p.status]} />
          )}
        </aside>
      </div>
    </OfficeShell>
  );
}

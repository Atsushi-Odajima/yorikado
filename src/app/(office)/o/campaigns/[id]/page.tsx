import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton, NoteAction } from '@/components/office/Actions';
import { BatchActions, IssuanceForm } from '@/components/office/Issuance';
import { ImportUpload } from '@/components/office/ImportUpload';
import { LiveReadinessForm } from '@/components/office/LiveReadiness';
import { BATCH_STATUS, CAMPAIGN_STATUS, IMPORT_STATUS, MODE_LABEL, PAPER_STATUS } from '@/components/office/labels';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { d, dt, Notice, StateBadge, ui, yen } from '@/components/ui';
import { nowMs } from '@/lib/time';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '地域券事業' };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, office, can } = await requireOffice();
  const { data: c } = await db.from('campaigns').select('*').eq('id', id).eq('tenant_id', office.tenantId).maybeSingle();
  if (!c) notFound();
  const [shops, batches, readiness, paper, imports] = await Promise.all([
    db.from('campaign_shops').select('shop_id, status, shops(display_name)').eq('campaign_id', id),
    db.from('issuance_batches').select('*').eq('campaign_id', id).order('batch_number', { ascending: false }),
    db.from('live_readiness').select('*').eq('campaign_id', id).maybeSingle(),
    db.from('paper_reports').select('id, received_date, claimed_amount, verified_amount, status, original_bundle_ref, submitted_at, shops(display_name)').eq('campaign_id', id).neq('status', 'draft').order('submitted_at', { ascending: false }).limit(100),
    db.from('external_imports').select('id, source_name, file_name, status, summary, created_at').eq('campaign_id', id).order('created_at', { ascending: false }),
  ]);
  const isOp = can(['office_operator']);
  const isApprover = can(['office_approver']);
  return (
    <OfficeShell me={me} office={office} tab="vouchers">
      <Link href="/o/campaigns">← 地域券事業の一覧</Link>
      <div className={o.toolbar} style={{ marginTop: 8 }}>
        <h1 className={o.h1} style={{ margin: 0 }}>{c.name}</h1>
        <StateBadge tone={c.status === 'active' ? 'done' : c.status === 'suspended' ? 'error' : 'muted'}>{CAMPAIGN_STATUS[c.status]}</StateBadge>
      </div>
      <section className={o.section}>
        <div className={o.grid2}>
          <dl className={ui.dl}>
            <dt>環境</dt><dd>{c.environment === 'DEMO' ? '練習(DEMO)・換金不可' : '本番(LIVE)'}</dd>
            <dt>方式</dt><dd>{MODE_LABEL[c.mode]}</dd>
            <dt>期間</dt><dd>{dt(c.starts_at)}〜{dt(c.ends_at)}（終了は含まない）</dd>
            <dt>額面</dt><dd>{(c.denominations as number[]).map((x) => yen(x)).join(' / ') || '—'}</dd>
          </dl>
          <dl className={ui.dl}>
            <dt>規則版</dt><dd>v{c.rules_version}</dd>
            <dt>発行者</dt><dd>{c.issuer || '—'}</dd>
            <dt>対象店舗</dt><dd>{(shops.data ?? []).filter((s) => s.status === 'active').map((s) => (s.shops as unknown as { display_name: string }).display_name).join('、')}</dd>
            {c.suspended_reason && (<><dt>停止理由</dt><dd>{c.suspended_reason}</dd></>)}
          </dl>
        </div>
        {c.rules_text && <p className={ui.help} style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>規則: {c.rules_text}</p>}
        <div className={ui.row} style={{ marginTop: 16 }}>
          {c.status === 'draft' && !c.submitted_at && isOp && <ActionButton path={`/campaigns/${id}/submit`} label="公開を申請する" />}
          {c.status === 'draft' && c.submitted_at && (
            <>
              <span className={ui.meta}>公開申請済み（{dt(c.submitted_at)}）。作成者とは別の承認者が承認します。</span>
              {isApprover && c.submitted_by !== me.userId && c.created_by !== me.userId && <ActionButton path={`/campaigns/${id}/approve`} label="承認して受付を開始する" />}
            </>
          )}
          {c.status === 'active' && (isOp || isApprover || can(['tenant_admin'])) && <NoteAction path={`/campaigns/${id}/suspend`} label="受付を停止する" variant="danger" noteLabel="停止理由（店舗に表示）" />}
          {c.status === 'suspended' && isApprover && <ActionButton path={`/campaigns/${id}/resume`} label="受付を再開する" />}
          {c.status !== 'closed' && isApprover && <ActionButton path={`/campaigns/${id}/close`} label="事業を終了する" variant="secondary" confirmText="事業を終了します。元に戻せません。よろしいですか？" />}
        </div>
      </section>

      {c.environment === 'LIVE' && readiness.data && (
        <section className={o.section}>
          <h2 className={ui.h2}>実券（LIVE）開始条件</h2>
          <LiveReadinessForm campaignId={id} r={readiness.data} canEdit={can(['tenant_admin', 'office_approver'])} />
          {isApprover && !c.live_approved_at && <ActionButton path={`/campaigns/${id}/approve-live`} label="LIVE審査を承認する" />}
        </section>
      )}
      {c.environment === 'DEMO' && <Notice tone="info" title="この事業は練習用(DEMO)です">実際の券・換金には使えません。LIVEは別環境・別データベースで、開始条件の確認と二人承認が必要です。</Notice>}

      {c.mode === 'owned_qr' && (
        <section className={o.section}>
          <h2 className={ui.h2}>券の発行（二段階）</h2>
          <p className={ui.help}>①担当者が発行（全券は無効のまま）→ ②印刷・枚数を確認 → ③別の承認者が有効化。印刷データの取得期限は24時間です。</p>
          {isOp && (c.status === 'draft' || c.status === 'active') && <IssuanceForm campaignId={id} denominations={c.denominations as number[]} startsAt={c.starts_at} endsAt={c.ends_at} />}
          <div className={ui.tableWrap} style={{ marginTop: 16 }}>
            <table className={ui.table}>
              <thead>
                <tr><th>バッチ</th><th>額面×枚数</th><th>有効期間</th><th>状態</th><th>操作</th></tr>
              </thead>
              <tbody>
                {(batches.data ?? []).map((b) => (
                  <tr key={b.id}>
                    <td>B{String(b.batch_number).padStart(4, '0')}<br /><span className={ui.meta}>{dt(b.created_at)}</span></td>
                    <td className={ui.num}>{yen(b.denomination)}×{b.count}</td>
                    <td>{d(b.valid_from)}〜{d(b.valid_until)}</td>
                    <td>
                      {BATCH_STATUS[b.status]}
                      {b.status === 'generated' && (
                        <span className={ui.meta}>
                          <br />取得期限 {dt(b.download_expires_at)}・取得{b.download_count}回{b.receipt_confirmed_at ? '・枚数確認済み' : ''}
                        </span>
                      )}
                      {b.void_reason && <span className={ui.meta}><br />{b.void_reason}</span>}
                    </td>
                    <td>
                      <BatchActions batch={{ id: b.id, status: b.status, count: b.count, createdBy: b.created_by, downloaded: !!b.first_downloaded_at, receiptConfirmed: !!b.receipt_confirmed_at, expired: b.download_expires_at ? Date.parse(b.download_expires_at) < nowMs() : false }} me={me.userId} isOp={isOp} isApprover={isApprover} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {c.mode === 'paper_count' && (
        <section className={o.section}>
          <h2 className={ui.h2}>紙券の申告</h2>
          <p className={ui.help}>「原本確認待ち」は換金対象ではありません。原本を確認してから「確認済み」にします。</p>
          <table className={ui.table}>
            <thead><tr><th>店舗</th><th>受取日</th><th>束番号</th><th className={ui.num}>申告額</th><th className={ui.num}>確認額</th><th>状態</th></tr></thead>
            <tbody>
              {(paper.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/o/paper/${p.id}`}>{(p.shops as unknown as { display_name: string }).display_name}</Link></td>
                  <td>{d(p.received_date)}</td>
                  <td>{p.original_bundle_ref || '—'}</td>
                  <td className={ui.num}>{yen(p.claimed_amount)}</td>
                  <td className={ui.num}>{p.verified_amount === null ? '—' : yen(p.verified_amount)}</td>
                  <td>{PAPER_STATUS[p.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {c.mode === 'external_csv' && (
        <section className={o.section}>
          <h2 className={ui.h2}>外部券の実績CSV</h2>
          <p className={ui.help}>提供元の正式な実績データを取り込みます。これは外部券の決済ではありません。標準列: provider, provider_transaction_id, shop_external_code, amount_jpy, occurred_at, status, original_transaction_id（UTF-8、10MB・10,000行まで）。</p>
          {isOp && <ImportUpload campaignId={id} />}
          <table className={ui.table} style={{ marginTop: 16 }}>
            <thead><tr><th>取込</th><th>提供元</th><th>状態</th><th className={ui.num}>行</th></tr></thead>
            <tbody>
              {(imports.data ?? []).map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/o/imports/${i.id}`}>{i.file_name || '（ファイル名なし）'}</Link><br /><span className={ui.meta}>{dt(i.created_at)}</span></td>
                  <td>{i.source_name}</td>
                  <td>{IMPORT_STATUS[i.status]}</td>
                  <td className={ui.num}>{(i.summary as { rows?: number })?.rows ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </OfficeShell>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui, yen } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';
import { ActionButton, NoteAction } from './Actions';

const ymd = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);

export function IssuanceForm({ campaignId, denominations, startsAt, endsAt }: { campaignId: string; denominations: number[]; startsAt: string; endsAt: string }) {
  const router = useRouter();
  const today = ymd(new Date().toISOString());
  const [denom, setDenom] = useState(denominations[0] ?? 0);
  const [count, setCount] = useState(10);
  const [from, setFrom] = useState(today > ymd(startsAt) ? today : ymd(startsAt));
  const [until, setUntil] = useState(ymd(endsAt));
  const key = useRef(newKey());
  const { busy, error, run } = useAction();
  const toIso = (v: string) => new Date(`${v}T00:00:00+09:00`).toISOString();
  return (
    <form
      className={ui.row}
      style={{ alignItems: 'flex-end' }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api('/campaigns/' + campaignId + '/issuance-batches', { body: { denomination: denom, count, validFrom: toIso(from), validUntil: until === ymd(endsAt) ? endsAt : toIso(until) }, idempotencyKey: key.current }));
        if (r) {
          key.current = newKey();
          router.refresh();
        }
      }}
    >
      <div className={ui.field} style={{ margin: 0 }}>
        <label className={ui.label} htmlFor="denom">額面</label>
        <select id="denom" className={ui.select} value={denom} onChange={(e) => setDenom(Number(e.target.value))}>
          {denominations.map((d) => <option key={d} value={d}>{yen(d)}</option>)}
        </select>
      </div>
      <div className={ui.field} style={{ margin: 0, width: 120 }}>
        <label className={ui.label} htmlFor="count">枚数</label>
        <input id="count" className={ui.input} type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
      </div>
      <div className={ui.field} style={{ margin: 0 }}>
        <label className={ui.label} htmlFor="from">有効開始</label>
        <input id="from" className={ui.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className={ui.field} style={{ margin: 0 }}>
        <label className={ui.label} htmlFor="until">有効終了（この日0時まで）</label>
        <input id="until" className={ui.input} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </div>
      <Button type="submit" inline busy={busy} busyLabel="発行しています" disabled={count < 1 || count > 200}>
        {count}枚を発行する（無効のまま）
      </Button>
      <div style={{ width: '100%' }}><ErrorNotice error={error} /></div>
      <p className={ui.help} style={{ width: '100%' }}>1回200枚まで。発行には認証コードの確認が必要です。</p>
    </form>
  );
}

interface Batch {
  id: string;
  status: string;
  count: number;
  createdBy: string;
  downloaded: boolean;
  receiptConfirmed: boolean;
  expired: boolean;
}

export function BatchActions({ batch, me, isOp, isApprover }: { batch: Batch; me: string; isOp: boolean; isApprover: boolean }) {
  const router = useRouter();
  const [counted, setCounted] = useState('');
  const { busy, error, run } = useAction();
  if (batch.status === 'void' || batch.status === 'draft') return <span className={ui.meta}>—</span>;
  if (batch.status === 'activated') return <NoteAction path={`/issuance-batches/${batch.id}/void`} label="紛失・流出で失効させる" variant="danger" noteLabel="失効の理由（未使用券が無効になります）" />;
  return (
    <div className={ui.stack8}>
      {!batch.expired && (isOp || isApprover) && <Link href={`/o/issuance/${batch.id}/print`} className={`${ui.secondary} ${ui.inline}`}>印刷データを開く</Link>}
      {batch.expired && <span className={ui.meta}>取得期限切れ。破棄して再発行してください。</span>}
      {batch.downloaded && !batch.receiptConfirmed && (isOp || isApprover) && (
        <form
          className={ui.row}
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => api(`/issuance-batches/${batch.id}/confirm-receipt`, { body: { counted: Number(counted) } }));
            if (r) router.refresh();
          }}
        >
          <label className="sr-only" htmlFor={`cnt-${batch.id}`}>印刷物を数えた枚数</label>
          <input id={`cnt-${batch.id}`} className={ui.input} style={{ width: 110 }} inputMode="numeric" placeholder="数えた枚数" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} />
          <Button type="submit" inline variant="secondary" busy={busy} disabled={!counted}>枚数を確認した</Button>
        </form>
      )}
      <ErrorNotice error={error} />
      {batch.receiptConfirmed && isApprover && batch.createdBy !== me && <ActionButton path={`/issuance-batches/${batch.id}/activate`} label={`${batch.count}枚を有効化する`} />}
      {batch.receiptConfirmed && batch.createdBy === me && <span className={ui.meta}>有効化は発行者とは別の承認者が行います</span>}
      <NoteAction path={`/issuance-batches/${batch.id}/void`} label="破棄する" variant="danger" noteLabel="破棄の理由" />
    </div>
  );
}

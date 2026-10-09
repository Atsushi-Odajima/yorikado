'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui, yen } from '@/components/ui';
import { formatTokenForPrint, qrText } from '@/domain/vouchers/tokenFormat';
import { api } from '@/lib/api-client';
import p from './print.module.css';

interface Data {
  batchNumber: number;
  denomination: number;
  count: number;
  validFrom: string;
  validUntil: string;
  campaignName: string;
  issuer: string;
  environment: string;
  coupons: { displayNumber: string; token: string }[];
}

const fmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' });

/**
 * A4 print sheet rendered in the browser (QR as SVG). The decrypted data is
 * fetched by POST (never in a URL), kept only in memory and never cached.
 */
export function PrintSheet({ batchId }: { batchId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [svgs, setSvgs] = useState<string[]>([]);
  const { busy, error, run } = useAction();

  async function load() {
    const r = await run(() => api<Data>(`/issuance-batches/${batchId}/download`, { body: {} }));
    if (r) {
      setData(r);
      setSvgs(await Promise.all(r.coupons.map((c) => QRCode.toString(qrText(c.token), { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }))));
    }
  }

  useEffect(() => {
    const clear = () => {
      setData(null);
      setSvgs([]);
    };
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, []);

  if (!data) {
    return (
      <main style={{ maxWidth: 640, margin: '32px auto', padding: 16 }}>
        <h1 className={ui.h1}>券の印刷データ</h1>
        <p className={ui.help}>取得は記録されます。認証コードの確認が必要です。印刷後は枚数を数えて「枚数を確認した」を登録してください。</p>
        <ErrorNotice error={error} />
        <Button onClick={load} busy={busy} busyLabel="確認中です">印刷データを取得する</Button>
      </main>
    );
  }
  const demo = data.environment !== 'LIVE';
  return (
    <div className={p.page}>
      <div className={`${p.toolbar} no-print`}>
        <strong>B{String(data.batchNumber).padStart(4, '0')}・{yen(data.denomination)}×{data.count}枚</strong>
        <Button inline onClick={() => window.print()}>印刷する（PDF保存も可）</Button>
        <span className={ui.help}>印刷後、実際にスマホで1枚以上読み取れるか確認してください。</span>
      </div>
      <div className={p.grid}>
        {data.coupons.map((c, i) => (
          <article key={c.displayNumber} className={p.ticket}>
            {demo && <p className={p.demo}>練習用・換金不可</p>}
            <p className={p.name}>{data.campaignName}</p>
            <p className={p.amount}>{yen(data.denomination)}</p>
            <div className={p.qr} dangerouslySetInnerHTML={{ __html: svgs[i] ?? '' }} />
            <p className={p.code}>{formatTokenForPrint(c.token)}</p>
            <p className={p.meta}>
              No. {c.displayNumber}
              <br />
              有効 {fmt.format(new Date(data.validFrom))}〜{fmt.format(new Date(Date.parse(data.validUntil) - 1))}
              <br />
              発行: {data.issuer || '—'}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { PhotoPicker } from '@/components/forms/PhotoPicker';
import { useAction } from '@/components/forms/useAction';
import { Button, ui, yen } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export interface PaperInitial {
  id: string;
  version: number;
  receivedDate: string;
  counts: Record<string, number>;
  photoIds: string[];
  bundleRef: string;
}

export function PaperForm({ shopId, campaignId, denominations, initial }: { shopId: string; campaignId: string; denominations: number[]; initial?: PaperInitial }) {
  const router = useRouter();
  const [date, setDate] = useState(initial?.receivedDate ?? todayJst());
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(denominations.map((d) => [String(d), initial?.counts[String(d)] ?? 0])));
  const [photos, setPhotos] = useState<string[]>(initial?.photoIds ?? []);
  const [bundle, setBundle] = useState(initial?.bundleRef ?? '');
  const key = useRef(newKey());
  const { busy, error, run, fieldError } = useAction();
  const total = denominations.reduce((s, d) => s + d * (counts[String(d)] ?? 0), 0);
  const setCount = (d: number, n: number) => setCounts((c) => ({ ...c, [String(d)]: Math.max(0, Math.min(99999, Math.floor(n) || 0)) }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(async () => {
          const saved = await api<{ id: string; version: number }>('/paper-reports', {
            body: { id: initial?.id ?? null, shopId, campaignId, receivedDate: date, counts, photoIds: photos, bundleRef: bundle, expectedVersion: initial?.version ?? null },
            idempotencyKey: initial ? undefined : key.current,
          });
          return api<{ id: string }>(`/paper-reports/${saved.id}/submit`, { body: { expectedVersion: saved.version } });
        });
        if (r) router.replace(`/m/paper/${r.id}?sent=1`);
      }}
    >
      <ErrorNotice error={error} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="date">受け取った日</label>
        <input id="date" className={ui.input} type="date" value={date} max={todayJst()} onChange={(e) => setDate(e.target.value)} aria-invalid={!!fieldError('receivedDate')} />
      </div>
      {denominations.map((d) => (
        <div key={d} className={ui.field}>
          <label className={ui.label} htmlFor={`c${d}`}>{yen(d)}券の枚数</label>
          <div className={ui.row}>
            <button type="button" className={`${ui.secondary} ${ui.inline}`} aria-label={`${yen(d)}券を1枚減らす`} onClick={() => setCount(d, (counts[String(d)] ?? 0) - 1)}>−</button>
            <input id={`c${d}`} className={ui.input} style={{ width: 120, textAlign: 'right' }} inputMode="numeric" value={counts[String(d)] ?? 0} onChange={(e) => setCount(d, Number(e.target.value.replace(/\D/g, '')))} />
            <button type="button" className={`${ui.secondary} ${ui.inline}`} aria-label={`${yen(d)}券を1枚増やす`} onClick={() => setCount(d, (counts[String(d)] ?? 0) + 1)}>＋</button>
          </div>
        </div>
      ))}
      <p style={{ margin: '8px 0 24px' }}>
        合計 <span className={ui.money} style={{ fontSize: 32 }}>{yen(total)}</span>
      </p>
      <PhotoPicker shopId={shopId} purpose="paper_report" value={photos} onChange={setPhotos} label="券の写真（3枚まで）" />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="bundle">原本の束番号</label>
        <input id="bundle" className={ui.input} value={bundle} onChange={(e) => setBundle(e.target.value)} maxLength={60} />
        <p className={ui.help}>券をまとめた封筒や束に書いた番号です。事務局が原本を確認するときに使います。</p>
      </div>
      <Button type="submit" busy={busy} disabled={total <= 0}>
        {yen(total)}分を申告する
      </Button>
    </form>
  );
}

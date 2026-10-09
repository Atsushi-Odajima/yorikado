'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';

export function SettlementGenerate({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const [lastMonth] = useState(() => {
    const j = new Date(Date.now() + 9 * 3600_000);
    const dte = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() - 1, 1));
    return dte.toISOString().slice(0, 7);
  });
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
  const [mode, setMode] = useState<'monthly' | 'explicit'>('monthly');
  const [month, setMonth] = useState(lastMonth);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [pay, setPay] = useState('');
  const key = useRef(newKey());
  const { busy, error, run } = useAction();
  const iso = (v: string) => new Date(`${v}T00:00:00+09:00`).toISOString();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() =>
          api<{ id: string }>('/settlements/generate', {
            body: { campaignId, month: mode === 'monthly' ? month : null, periodStart: mode === 'explicit' ? iso(start) : null, periodEnd: mode === 'explicit' ? iso(end) : null, paymentDate: pay || null },
            idempotencyKey: key.current,
          }),
        );
        if (r) router.push(`/o/settlements/${r.id}`);
      }}
    >
      <ErrorNotice error={error} />
      <div className={ui.row} style={{ alignItems: 'flex-end' }}>
        <div className={ui.field} style={{ margin: 0 }}>
          <label className={ui.label} htmlFor="cmp">事業</label>
          <select id="cmp" className={ui.select} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className={ui.field} style={{ margin: 0 }}>
          <label className={ui.label} htmlFor="mode">締め</label>
          <select id="mode" className={ui.select} value={mode} onChange={(e) => setMode(e.target.value as 'monthly' | 'explicit')}>
            <option value="monthly">月次（JST 1日0時〜翌月1日0時）</option>
            <option value="explicit">期間を指定</option>
          </select>
        </div>
        {mode === 'monthly' ? (
          <div className={ui.field} style={{ margin: 0 }}>
            <label className={ui.label} htmlFor="mon">対象月</label>
            <input id="mon" type="month" className={ui.input} value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        ) : (
          <>
            <div className={ui.field} style={{ margin: 0 }}>
              <label className={ui.label} htmlFor="ps">開始日（含む）</label>
              <input id="ps" type="date" className={ui.input} value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className={ui.field} style={{ margin: 0 }}>
              <label className={ui.label} htmlFor="pe">終了日（含まない）</label>
              <input id="pe" type="date" className={ui.input} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </>
        )}
        <div className={ui.field} style={{ margin: 0 }}>
          <label className={ui.label} htmlFor="pay">振込予定日</label>
          <input id="pay" type="date" className={ui.input} value={pay} onChange={(e) => setPay(e.target.value)} />
        </div>
        <Button type="submit" inline busy={busy} busyLabel="集計しています" disabled={!campaignId}>集計して精算案を作る</Button>
      </div>
      <p className={ui.help}>祝日・銀行営業日は自動で判定しません。振込予定日は事務局で入力してください。</p>
    </form>
  );
}

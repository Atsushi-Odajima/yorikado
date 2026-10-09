'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, Notice, ui, yen } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';

const MODES = [
  ['owned_qr', '独自QR額面券', 'このアプリで発行・受付する固定額面の券'],
  ['paper_count', '紙券（枚数申告）', '一意な番号のない紙の券。店が枚数を申告し、事務局が原本を確認'],
  ['external_csv', '外部券（実績CSV）', '他社の券サービスの実績CSVを取り込む（決済はそのサービス側）'],
] as const;

export function CampaignForm({ tenantId, environment, shops }: { tenantId: string; environment: string; shops: { id: string; name: string }[] }) {
  const router = useRouter();
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [f, setF] = useState({ name: '', mode: 'owned_qr', startsAt: '', endsAt: '', denoms: '500,1000', rulesText: '', issuer: '', externalServiceUrl: '' });
  const [shopIds, setShopIds] = useState<string[]>([]);
  const key = useRef(newKey());
  const { busy, error, run } = useAction();
  const denominations = f.mode === 'external_csv' ? [] : f.denoms.split(/[,、\s]+/).filter(Boolean).map((x) => Number(x.normalize('NFKC')));
  const toIso = (v: string) => (v ? new Date(`${v}T00:00:00+09:00`).toISOString() : '');
  const valid = f.name.trim() && f.startsAt && f.endsAt && f.endsAt > f.startsAt && shopIds.length > 0 && (f.mode === 'external_csv' || (denominations.length >= 1 && denominations.length <= 3 && denominations.every((d) => Number.isInteger(d) && d >= 1 && d <= 100000)));

  if (step === 'review') {
    return (
      <div className={ui.stack} style={{ maxWidth: 720 }}>
        <Notice tone="warning" title="公開後は金額・券方式を直接変更できません">誤りがある場合は停止して新しい事業を作ります。</Notice>
        <dl className={ui.dl}>
          <dt>事業名</dt><dd>{f.name}</dd>
          <dt>方式</dt><dd>{MODES.find((m) => m[0] === f.mode)?.[1]}</dd>
          <dt>環境</dt><dd>{environment === 'LIVE' ? '本番(LIVE)' : '練習(DEMO)'}</dd>
          <dt>期間（JST）</dt><dd>{f.startsAt} 0:00 〜 {f.endsAt} 0:00（終了日は含みません）</dd>
          <dt>額面</dt><dd>{denominations.map((d) => yen(d)).join(' / ') || '—'}</dd>
          <dt>対象店舗</dt><dd>{shops.filter((s) => shopIds.includes(s.id)).map((s) => s.name).join('、')}</dd>
          <dt>発行者</dt><dd>{f.issuer || '—'}</dd>
          <dt>券の規則</dt><dd style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{f.rulesText || '—'}</dd>
          {f.mode === 'external_csv' && (<><dt>公式サービス</dt><dd>{f.externalServiceUrl || '—'}</dd></>)}
        </dl>
        <ErrorNotice error={error} />
        <div className={ui.row}>
          <Button inline busy={busy} onClick={async () => {
            const r = await run(() => api<{ id: string }>('/campaigns', {
              body: { tenantId, name: f.name, mode: f.mode, startsAt: toIso(f.startsAt), endsAt: toIso(f.endsAt), denominations, rulesText: f.rulesText, issuer: f.issuer, externalServiceUrl: f.externalServiceUrl, shopIds },
              idempotencyKey: key.current,
            }));
            if (r) router.push(`/o/campaigns/${r.id}`);
          }}>下書きとして保存する</Button>
          <Button inline variant="secondary" onClick={() => setStep('edit')}>直す</Button>
        </div>
      </div>
    );
  }

  return (
    <form style={{ maxWidth: 720 }} onSubmit={(e) => { e.preventDefault(); setStep('review'); }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="name">事業名</label>
        <input id="name" className={ui.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} />
      </div>
      <fieldset className={ui.field} style={{ border: 0, padding: 0 }}>
        <legend className={ui.label}>券の方式</legend>
        <div className={ui.choices} role="radiogroup">
          {MODES.map(([v, label, help]) => (
            <button key={v} type="button" role="radio" aria-checked={f.mode === v} className={ui.choice} onClick={() => setF({ ...f, mode: v })}>
              <span><strong>{label}</strong><br /><span className={ui.meta}>{help}</span></span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className={ui.row}>
        <div className={ui.field} style={{ flex: 1 }}>
          <label className={ui.label} htmlFor="s">開始日</label>
          <input id="s" type="date" className={ui.input} value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
        </div>
        <div className={ui.field} style={{ flex: 1 }}>
          <label className={ui.label} htmlFor="e">終了日（この日の0時で終了）</label>
          <input id="e" type="date" className={ui.input} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
        </div>
      </div>
      {f.mode !== 'external_csv' && (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="d">額面（円・最大3種類、カンマ区切り）</label>
          <input id="d" className={ui.input} value={f.denoms} onChange={(e) => setF({ ...f, denoms: e.target.value })} inputMode="numeric" />
        </div>
      )}
      {f.mode === 'external_csv' && (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="u">公式の券サービスのURL（店舗のホームから開きます）</label>
          <input id="u" className={ui.input} value={f.externalServiceUrl} onChange={(e) => setF({ ...f, externalServiceUrl: e.target.value })} placeholder="https://" />
        </div>
      )}
      <div className={ui.field}>
        <label className={ui.label} htmlFor="i">発行者（券に印刷）</label>
        <input id="i" className={ui.input} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} maxLength={200} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="r">券の規則（店舗の確認画面に表示）</label>
        <textarea id="r" className={ui.textarea} value={f.rulesText} onChange={(e) => setF({ ...f, rulesText: e.target.value })} maxLength={4000} />
      </div>
      <fieldset className={ui.field} style={{ border: 0, padding: 0 }}>
        <legend className={ui.label}>対象店舗</legend>
        <div className={ui.choices}>
          {shops.map((s) => (
            <label key={s.id} className={ui.choice} aria-checked={shopIds.includes(s.id)}>
              <input type="checkbox" checked={shopIds.includes(s.id)} onChange={(e) => setShopIds(e.target.checked ? [...shopIds, s.id] : shopIds.filter((x) => x !== s.id))} style={{ width: 24, height: 24 }} />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" disabled={!valid}>内容を確認する</Button>
    </form>
  );
}

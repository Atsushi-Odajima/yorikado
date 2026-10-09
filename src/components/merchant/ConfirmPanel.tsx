'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { Button, Notice, ui, yen } from '@/components/ui';
import { api, ApiError, newKey } from '@/lib/api-client';
import { useBasket } from './Basket';
import m from './merchant.module.css';

export interface Draft {
  id: string;
  expiresAt: string;
  status: string;
  shopName: string;
  campaignId: string;
  campaignName: string;
  amount: number;
  rulesVersion: number;
  rulesText: string;
  environment: string;
  operationId: string | null;
  items: { displayNumber: string; faceValue: number }[];
}

interface OperationResult {
  operationId: string | null;
  status: 'pending' | 'confirmed' | 'failed';
}

type Phase = 'ready' | 'sending' | 'checking' | 'unknown' | 'error' | 'expired';

// Only the idempotency key for this draft (no business data) is kept per tab,
// so a reload can recover the result of an in-flight confirmation.
const keyName = (draftId: string) => `yk:idem:${draftId}`;
function readKey(draftId: string): string | null {
  try {
    return sessionStorage.getItem(keyName(draftId));
  } catch {
    return null;
  }
}
function writeKey(draftId: string, key: string | null) {
  try {
    if (key) sessionStorage.setItem(keyName(draftId), key);
    else sessionStorage.removeItem(keyName(draftId));
  } catch {
    /* storage unavailable: recovery after reload falls back to history */
  }
}

export function ConfirmPanel({ draft }: { draft: Draft }) {
  const router = useRouter();
  const basket = useBasket();
  const [phase, setPhase] = useState<Phase>(draft.status === 'expired' ? 'expired' : 'ready');
  const [error, setError] = useState<ApiError | null>(null);
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.round((Date.parse(draft.expiresAt) - Date.now()) / 1000)));
  const keyRef = useRef<string | null>(null);
  const recorded = useRef<'pending' | null>(null);

  const groups = new Map<number, number>();
  for (const it of draft.items) groups.set(it.faceValue, (groups.get(it.faceValue) ?? 0) + 1);

  const done = useCallback(
    (operationId: string) => {
      writeKey(draft.id, null);
      basket.clear();
      router.replace(`/m/receipts/${operationId}`);
    },
    [basket, draft.id, router],
  );

  const check = useCallback(async (): Promise<boolean> => {
    const key = keyRef.current;
    if (!key) return false;
    const r = await api<OperationResult>(`/operations/${key}`).catch(() => null);
    if (r?.status === 'confirmed' && r.operationId) {
      done(r.operationId);
      return true;
    }
    recorded.current = r ? 'pending' : null;
    return false;
  }, [done]);

  // Poll 2,5,10,20s after an unknown outcome; never mark it failed automatically.
  const poll = useCallback(async () => {
    setPhase('checking');
    for (const wait of [2000, 5000, 10000, 20000]) {
      await new Promise((r) => setTimeout(r, wait));
      if (await check()) return;
    }
    setPhase('unknown');
  }, [check]);

  useEffect(() => {
    const existing = readKey(draft.id);
    if (existing) {
      keyRef.current = existing;
      void check().then((ok) => {
        if (!ok) setPhase('unknown');
      });
    }
  }, [check, draft.id]);

  useEffect(() => {
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((Date.parse(draft.expiresAt) - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setPhase((p) => (p === 'ready' ? 'expired' : p));
    }, 1000);
    return () => clearInterval(t);
  }, [draft.expiresAt]);

  async function send() {
    if (phase === 'sending') return;
    if (!keyRef.current) {
      keyRef.current = newKey();
      writeKey(draft.id, keyRef.current);
    }
    setPhase('sending');
    setError(null);
    try {
      const r = await api<OperationResult>('/redemptions', { body: { draftId: draft.id, expectedAmount: draft.amount }, idempotencyKey: keyRef.current, timeoutMs: 15000 });
      if (r.status === 'confirmed' && r.operationId) done(r.operationId);
      else void poll();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('NETWORK_UNKNOWN', '', 0);
      if (err.unknownOutcome || err.status >= 500) {
        void poll();
        return;
      }
      const opId = err.details?.operationId as string | undefined;
      if (opId) {
        done(opId);
        return;
      }
      writeKey(draft.id, null);
      keyRef.current = null;
      setError(err);
      setPhase(err.code === 'EXPIRED' ? 'expired' : 'error');
    }
  }

  const label = `${yen(draft.amount)}を受け取る`;
  return (
    <div className={ui.stack}>
      <section className={m.slip} aria-label="受取の内容">
        <p className={ui.meta}>合計</p>
        <p className={draft.amount >= 1_000_000 ? ui.moneyLong : ui.money}>{yen(draft.amount)}</p>
        <div style={{ marginTop: 12 }}>
          {[...groups.entries()].map(([face, n]) => (
            <div key={face} className={m.slipRow}>
              <span>{yen(face)} × {n}枚</span>
              <span className="tabular">{yen(face * n)}</span>
            </div>
          ))}
        </div>
        <dl className={ui.dl} style={{ marginTop: 16 }}>
          <dt>店舗</dt>
          <dd>{draft.shopName}</dd>
          <dt>地域券</dt>
          <dd>{draft.campaignName}</dd>
          <dt>券番号</dt>
          <dd style={{ fontWeight: 400, fontSize: 16 }}>{draft.items.map((i) => i.displayNumber).join('、')}</dd>
        </dl>
        {draft.rulesText && <p className={ui.help} style={{ marginTop: 12 }}>券の規則: {draft.rulesText}</p>}
      </section>

      {phase === 'ready' && <p className={ui.help}>この確認画面はあと{remaining}秒有効です。額面は変更できません。おつりは出ません。</p>}
      {error && <ErrorNotice error={error} />}

      {(phase === 'ready' || phase === 'sending') && (
        <Button onClick={send} busy={phase === 'sending'} busyLabel="送信しています">
          {label}
        </Button>
      )}

      {phase === 'checking' && (
        <Notice tone="warning" title="結果を確認しています">
          通信が途切れたため、受付が確定したかを確認しています。画面を閉じずにお待ちください。新しく読み取り直さないでください。
        </Notice>
      )}

      {phase === 'unknown' && (
        <>
          <Notice tone="warning" title="受付の結果がまだ確認できません">
            成功・失敗のどちらとも決まっていません。下のボタンで状態を確認してください。
          </Notice>
          <Button onClick={() => void poll()}>もう一度確認する</Button>
          {recorded.current === 'pending' && remaining > 0 && (
            <Button variant="secondary" onClick={send}>
              記録がないため、同じ受付をもう一度送る
            </Button>
          )}
          <Link href="/m/requests/new?category=voucher_payment" className={ui.secondary}>
            事務局へ相談する
          </Link>
        </>
      )}

      {(phase === 'expired' || phase === 'error') && (
        <>
          {phase === 'expired' && <Notice tone="warning" title="確認の有効時間（2分）が過ぎました">受付は確定していません。もう一度読み取ってください。</Notice>}
          <Button onClick={() => { basket.clear(); router.replace(`/m/vouchers/scan?campaignId=${draft.campaignId}`); }}>
            読み直す
          </Button>
        </>
      )}

      {phase === 'ready' && (
        <>
          <Link href={`/m/vouchers/scan?campaignId=${draft.campaignId}`} className={ui.secondary}>
            券を追加・変更する（最大10枚）
          </Link>
          <button type="button" className={ui.linkBtn} onClick={() => { basket.clear(); router.replace('/m'); }}>
            受け取らずにやめる
          </button>
        </>
      )}
    </div>
  );
}

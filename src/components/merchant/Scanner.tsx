'use client';

import type { IScannerControls } from '@zxing/browser';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { itemLabel } from '@/components/forms/ErrorNotice';
import { Button, Notice, ui, yen } from '@/components/ui';
import { normalizeTokenInput } from '@/domain/vouchers/tokenFormat';
import { api, ApiError } from '@/lib/api-client';
import { useBasket } from './Basket';
import m from './merchant.module.css';

interface Quote {
  id: string;
  amount: number;
  items: { index: number; displayNumber: string; faceValue: number }[];
}

type CamState = 'off' | 'starting' | 'on' | 'paused' | 'denied' | 'busy' | 'unsupported';

const MAX = 10;

/**
 * QR / photo / manual-number reader. Video frames are decoded in the browser
 * only (ZXing); nothing but the decoded token text is sent, and only to our API.
 */
export function Scanner({ shopId, shopName, campaignId, campaignName }: { shopId: string; shopName: string; campaignId: string; campaignName: string }) {
  const router = useRouter();
  const basket = useBasket();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const lastText = useRef<{ text: string; at: number } | null>(null);
  const busyRef = useRef(false);
  const [cam, setCam] = useState<CamState>('off');
  const [multi, setMulti] = useState(false);
  const [tokens, setTokens] = useState<string[]>(basket.campaignId === campaignId ? basket.tokens : []);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState<{ tone: 'warning' | 'error' | 'success'; text: string } | null>(null);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  // The camera callback is created once; read current values through refs.
  const tokensRef = useRef(tokens);
  const multiRef = useRef(multi);
  useEffect(() => {
    multiRef.current = multi;
  }, [multi]);
  const updateTokens = (list: string[]) => {
    tokensRef.current = list;
    setTokens(list);
  };

  const stopCamera = useCallback(() => {
    controls.current?.stop();
    controls.current = null;
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && controls.current) {
        stopCamera();
        setCam('paused');
      }
    };
    const onOnline = () => setOnline(navigator.onLine);
    setOnline(navigator.onLine);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', stopCamera);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', stopCamera);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
      stopCamera();
    };
  }, [stopCamera]);

  // Re-quote tokens carried over from the confirm screen ("もう1枚追加")
  useEffect(() => {
    if (tokens.length) void requote(tokens);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requote(list: string[]): Promise<Quote | null> {
    if (!list.length) {
      setQuote(null);
      updateTokens([]);
      basket.set(campaignId, []);
      return null;
    }
    try {
      const q = await api<Quote>('/receipt-drafts', { body: { shopId, campaignId, tokens: list } });
      setQuote(q);
      updateTokens(list);
      basket.set(campaignId, list);
      return q;
    } catch (e) {
      if (e instanceof ApiError) {
        const items = (e.details?.items as { index?: number; code: string }[] | undefined) ?? [];
        if (items.length && items.every((i) => typeof i.index === 'number')) {
          const bad = new Set(items.map((i) => i.index!));
          const keep = list.filter((_, i) => !bad.has(i));
          setMessage({ tone: 'error', text: items.map((i) => `${i.index! + 1}枚目: ${itemLabel(i.code)}`).join(' / ') });
          if (keep.length !== list.length && keep.length > 0) await requote(keep);
          else if (keep.length === 0) {
            setQuote(null);
            updateTokens([]);
            basket.set(campaignId, []);
          }
          return null;
        }
        setMessage({ tone: 'error', text: e.unknownOutcome ? '通信を確認できませんでした。電波の良い場所でもう一度読み取ってください' : e.message });
      }
      return null;
    }
  }

  async function accept(text: string) {
    const now = Date.now();
    if (lastText.current && lastText.current.text === text && now - lastText.current.at < 2500) return;
    lastText.current = { text, at: now };
    if (busyRef.current) return;
    const t = normalizeTokenInput(text);
    if (!t) {
      setMessage({ tone: 'error', text: 'この地域券には対応していません' });
      return;
    }
    const tokens = tokensRef.current;
    if (tokens.includes(t)) {
      setMessage({ tone: 'warning', text: 'この券は読み取り済みです（枚数は増えません）' });
      return;
    }
    if (tokens.length >= MAX) {
      setMessage({ tone: 'warning', text: '1回に受け付けられるのは10枚までです。先に確定してください' });
      return;
    }
    if (!navigator.onLine) {
      setMessage({ tone: 'error', text: '通信が必要です。オフラインでは受け付けできません' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const next = [...tokens, t];
    const q = await requote(next);
    busyRef.current = false;
    setBusy(false);
    if (q) {
      if (navigator.vibrate) navigator.vibrate(60);
      setMessage({ tone: 'success', text: `${next.length}枚目を読み取りました` });
      if (!multiRef.current) {
        stopCamera();
        setCam('off');
        router.push(`/m/vouchers/confirm/${q.id}`);
      }
    }
  }

  async function startCamera() {
    setMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam('unsupported');
      return;
    }
    setCam('starting');
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 600 });
      const video = videoRef.current!;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      controls.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false },
        video,
        (result) => {
          if (result) void accept(result.getText());
        },
      );
      setCam('on');
    } catch (e) {
      const name = (e as { name?: string }).name;
      setCam(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotReadableError' || name === 'AbortError' ? 'busy' : 'unsupported');
      stopCamera();
    }
  }

  async function fromPhoto(file: File) {
    setMessage(null);
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      await accept(result.getText());
    } catch {
      setMessage({ tone: 'error', text: '写真からQRを読み取れませんでした。明るい場所で券全体を撮り直すか、番号を入力してください' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const total = quote?.amount ?? 0;
  const camHelp: Partial<Record<CamState, string>> = {
    denied: 'カメラの使用が許可されていません。iPhoneは「設定 → Safari → カメラ」で「許可」を選ぶか、下の「写真から読み取る」「番号を入力する」を使ってください。',
    busy: '他のアプリがカメラを使っています。そのアプリを閉じてから「カメラを起動する」を押してください。',
    unsupported: 'このブラウザではカメラを使えません。「写真から読み取る」か「番号を入力する」を使ってください。',
    paused: '画面を離れたためカメラを止めました。',
  };

  return (
    <div className={ui.stack}>
      <p className={ui.lead} style={{ margin: 0 }}>
        {shopName}・{campaignName}
      </p>
      {!online && <Notice tone="error" title="通信が必要です">オフラインでは地域券を受け付けできません。後から自動で送られることもありません。</Notice>}
      <div className={m.scanBox}>
        <video ref={videoRef} playsInline muted aria-label="カメラの映像" hidden={cam !== 'on'} />
        {cam === 'on' && <span className={m.scanFrame} aria-hidden="true" />}
        {cam !== 'on' && <span style={{ padding: 16, textAlign: 'center' }}>{cam === 'starting' ? 'カメラを起動しています' : 'QRコードをこの枠に映します'}</span>}
      </div>
      {camHelp[cam] && <Notice tone="warning">{camHelp[cam]}</Notice>}
      {cam !== 'on' && cam !== 'starting' && (
        <Button onClick={startCamera} disabled={!online || tokens.length >= MAX}>
          {cam === 'paused' ? 'カメラを再開する' : 'カメラを起動する'}
        </Button>
      )}
      {cam === 'on' && (
        <Button variant="secondary" onClick={() => { stopCamera(); setCam('off'); }}>
          カメラを止める
        </Button>
      )}
      <label className={ui.choice} aria-checked={multi}>
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} style={{ width: 24, height: 24 }} />
        <span>複数枚をまとめて読み取る（最大10枚）</span>
      </label>
      <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>

      {quote && (
        <section aria-label="読み取った券" className={m.slip}>
          <div className={m.total}>
            <span>{quote.items.length}枚</span>
            <span className={ui.money}>{yen(total)}</span>
          </div>
          <ul className={ui.list}>
            {quote.items.map((it, i) => (
              <li key={it.displayNumber} className={`${ui.listItem} ${ui.row}`} style={{ justifyContent: 'space-between', padding: '8px 0' }}>
                <span>
                  {yen(it.faceValue)} <span className={ui.meta}>{it.displayNumber}</span>
                </span>
                <button type="button" className={ui.linkBtn} onClick={() => void requote(tokens.filter((_, j) => j !== i))}>
                  {i + 1}枚目を外す
                </button>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 16 }}>
            <Button onClick={() => { stopCamera(); router.push(`/m/vouchers/confirm/${quote.id}`); }} disabled={busy}>
              確認へ進む（{yen(total)}）
            </Button>
          </div>
        </section>
      )}

      <details>
        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 700 }}>写真から読み取る・番号を入力する</summary>
        <div className={ui.stack} style={{ marginTop: 12 }}>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="photo">写真から読み取る</label>
            <input id="photo" type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && void fromPhoto(e.target.files[0])} />
            <p className={ui.help}>写真は端末の中だけで読み取り、送信しません。</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void accept(manual).then(() => setManual(''));
            }}
          >
            <div className={ui.field}>
              <label className={ui.label} htmlFor="manual">券の番号（QRの下の26文字）</label>
              <input id="manual" className={ui.input} value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" />
              <p className={ui.help}>ハイフン・空白・全角は自動でそろえます。</p>
            </div>
            <Button type="submit" variant="secondary" disabled={!manual.trim() || busy} busy={busy} busyLabel="確認中です">
              この番号を追加する
            </Button>
          </form>
        </div>
      </details>
    </div>
  );
}

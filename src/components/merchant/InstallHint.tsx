'use client';

import { useSyncExternalStore } from 'react';
import { ui } from '@/components/ui';

const noop = () => () => undefined;
function isIosSafariBrowser(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/** Optional, never forced: iOS has no install prompt, so explain Share -> Add to Home Screen. */
export function InstallHint() {
  const show = useSyncExternalStore(noop, isIosSafariBrowser, () => false);
  if (!show) return null;
  return (
    <details style={{ marginTop: 24 }}>
      <summary className={ui.help} style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        ホーム画面に追加する方法（任意）
      </summary>
      <p className={ui.help}>Safari の下にある共有ボタン（□に↑）→「ホーム画面に追加」→「追加」。アプリのように開けます。</p>
    </details>
  );
}

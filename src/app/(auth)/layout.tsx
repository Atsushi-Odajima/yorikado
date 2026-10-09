/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from 'react';
import s from '@/components/auth/auth.module.css';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const demo = process.env.APP_ENV !== 'live';
  return (
    <>
      {demo && (
        <div role="note" style={{ background: 'var(--badge-surface)', color: 'var(--badge-text)', fontWeight: 700, fontSize: 16, textAlign: 'center', padding: '8px 16px', borderBottom: '2px solid var(--ochre)' }}>
          練習用・実際の券には使えません
        </div>
      )}
      <main className={s.shell}>
        <div className={s.brand}>
          <img src="/brand/logo_horizontal.png" alt="Yorikado" width={148} height={49} />
          <span className={s.tagline}>商店街の窓口</span>
        </div>
        {children}
      </main>
    </>
  );
}

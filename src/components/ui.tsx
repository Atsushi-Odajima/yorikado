import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './ui.module.css';

export { s as ui };

export function yen(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toLocaleString('ja-JP')}円`;
}

const jst = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const jstDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
export function dt(v: string | null | undefined): string {
  return v ? jst.format(new Date(v)) : '—';
}
export function d(v: string | null | undefined): string {
  if (!v) return '—';
  return jstDate.format(new Date(v.length === 10 ? `${v}T00:00:00+09:00` : v));
}

type Icon = 'scan' | 'reply' | 'office' | 'home' | 'history' | 'check' | 'arrow';
const PATHS: Record<Icon, ReactNode> = {
  scan: <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M7 12h10" />,
  reply: (
    <>
      <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z" />
      <path d="M7 9h10M7 13h6" />
    </>
  ),
  office: <path d="M3 21h18M5 21V6h14v15M8 6V3h8v3M10 21v-5h4v5M9 10h.01M15 10h.01" />,
  home: <path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" />,
  history: <path d="M5 3h10l4 4v14H5ZM14 3v5h5M9 12h6M9 16h6" />,
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="m9 5 7 7-7 7" />,
};

/** Operation icons from design-kit/examples/ui-icons.svg. Decorative: always pair with text. */
export function Icon({ name, size = 24, className }: { name: Icon; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[name]}
      </g>
    </svg>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: string; children?: ReactNode }) {
  const mark = { info: 'ⓘ', warning: '注意', error: 'エラー', success: '完了' }[tone];
  return (
    <div className={`${s.notice} ${tone !== 'info' ? s[tone] : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={s.noticeMark} aria-hidden="true">
        {tone === 'success' ? <Icon name="check" /> : mark}
      </span>
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function DemoBanner({ environment }: { environment: string | null | undefined }) {
  if (environment === 'LIVE') return null;
  return (
    <div className={s.demo} role="note">
      練習用・実際の券には使えません
    </div>
  );
}

export function Money({ value, label }: { value: number; label?: string }) {
  const text = yen(value);
  return (
    <span className={text.length > 10 ? s.moneyLong : s.money} aria-label={label ? `${label} ${text}` : undefined}>
      {text}
    </span>
  );
}

export function RowLink({ href, title, meta, aside }: { href: string; title: ReactNode; meta?: ReactNode; aside?: ReactNode }) {
  return (
    <li className={s.listItem}>
      <Link href={href} className={s.rowLink}>
        <span className={s.rowMain}>
          <span className={s.rowTitle}>{title}</span>
          {meta && <span className={s.meta}>{meta}</span>}
        </span>
        <span className={s.row}>
          {aside}
          <Icon name="arrow" className={s.arrow} />
        </span>
      </Link>
    </li>
  );
}

export function Button({ variant = 'primary', busy, busyLabel, children, inline, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger'; busy?: boolean; busyLabel?: string; inline?: boolean }) {
  const cls = variant === 'primary' ? s.btn : variant === 'secondary' ? s.secondary : s.danger;
  return (
    <button {...rest} className={`${cls} ${inline ? s.inline : ''} ${rest.className ?? ''}`} aria-busy={busy || undefined} disabled={rest.disabled || busy}>
      {busy ? (busyLabel ?? '送信しています') : children}
    </button>
  );
}

export function StateBadge({ tone, children }: { tone: 'todo' | 'done' | 'error' | 'muted'; children: ReactNode }) {
  const cls = tone === 'done' ? s.badgeDone : tone === 'error' ? s.badgeError : tone === 'muted' ? s.badgeMuted : s.badge;
  return <span className={cls}>{children}</span>;
}

'use client';

/** Load failures are shown as failures (never as "0 items"), with a retry. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '48px 16px' }} role="alert">
      <h1 style={{ fontSize: 26, lineHeight: 1.4, marginBottom: 16 }}>読み込めませんでした</h1>
      <p style={{ marginBottom: 8 }}>通信の状態か、サーバーの一時的な問題の可能性があります。保存・確定した内容は消えていません。</p>
      <p style={{ marginBottom: 24, color: 'var(--muted)', fontSize: 16 }}>問い合わせ番号: {error.digest ?? '—'}</p>
      <button
        type="button"
        onClick={reset}
        style={{ minHeight: 58, width: '100%', borderRadius: 13, background: 'var(--primary)', color: '#fff', border: 0, fontSize: 20, fontWeight: 700, cursor: 'pointer' }}
      >
        もう一度読み込む
      </button>
    </main>
  );
}

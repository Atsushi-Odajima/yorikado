import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '48px 16px' }}>
      <h1 style={{ fontSize: 26, marginBottom: 16 }}>ページが見つかりません</h1>
      <p style={{ marginBottom: 24 }}>表示する権限がないか、存在しないページです。</p>
      <Link href="/m">ホームへ</Link>
    </main>
  );
}

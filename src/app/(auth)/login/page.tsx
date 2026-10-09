import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { Notice, ui } from '@/components/ui';

export const metadata: Metadata = { title: 'ログイン' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className={ui.h1}>ログイン</h1>
      {sp.expired && <Notice tone="warning" title="もう一度ログインしてください">安全のため、一定時間が過ぎたのでログインが切れました。</Notice>}
      {sp.no_access && <Notice tone="warning" title="利用できる店舗・組織がありません">事務局から届いた招待メールのリンクから登録してください。</Notice>}
      {sp.reset && <Notice tone="success" title="パスワードを変更しました">新しいパスワードでログインしてください。</Notice>}
      <LoginForm />
    </>
  );
}

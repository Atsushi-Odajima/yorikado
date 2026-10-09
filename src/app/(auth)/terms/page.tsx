import type { Metadata } from 'next';
import { Notice, ui } from '@/components/ui';

export const metadata: Metadata = { title: '利用条件（原案）' };

export default function TermsPage() {
  return (
    <article>
      <h1 className={ui.h1}>利用条件（原案）</h1>
      <Notice tone="warning" title="これは原案です">
        契約者（商店街・事務局）の責任者が確認・確定するまで、法的に完成した利用規約ではありません。全文は docs/legal/ の原案を参照してください。
      </Notice>
      <ol className={ui.stack}>
        <li>このアプリは、商店街の加盟店と事務局の間の地域券受付・報告・相談のための窓口です。</li>
        <li>地域券の受付は、事務局が承認した券の規則に従います。入金の時期と金額は事務局の確認と銀行の振込結果によります。</li>
        <li>ログイン情報・認証アプリを他人と共有しないでください。端末を紛失したときは、すぐに事務局へ連絡するか「すべての端末からログアウト」を行ってください。</li>
        <li>相談の内容と写真は、所属する商店街の事務局だけが見られます。他の店舗には公開されません。</li>
        <li>DEMO環境の店舗・券・金額はすべて架空です。実際の券には使えません。</li>
      </ol>
    </article>
  );
}

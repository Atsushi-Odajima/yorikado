'use client';

import { Notice } from '@/components/ui';
import type { ApiError } from '@/lib/api-client';

const BLOCKER_LABEL: Record<string, string> = {
  PENDING_REVERSAL: '未処理の取消申請があります',
  RECALC_REQUIRED: '承認された取消が反映されていません（再計算が必要）',
  UNVERIFIED_PAPER: '原本未確認の紙券申告があります',
  UNCOMMITTED_IMPORT: '確定していない外部実績の取込があります',
  BANK_CHANGE_PENDING: '承認待ちの口座変更があります',
  NO_BANK_ACCOUNT: '承認済みの口座がありません',
  BANK_CHANGED_AFTER_APPROVAL: '承認後に口座が変更されました',
  TOTAL_MISMATCH: '合計が一致しません',
};

const ITEM_LABEL: Record<string, string> = {
  UNSUPPORTED: 'この地域券には対応していません',
  OTHER_CAMPAIGN: '別の地域券事業の券です',
  ALREADY_USED: '使用済みです。事務局へ確認してください',
  VOID: '無効にされた券です',
  INACTIVE: 'まだ使えない券です（有効化前）',
  EXPIRED: '有効期限が切れています',
  NOT_YET_VALID: 'まだ有効期間前です',
  DUPLICATE_IN_LIST: '同じ券が2回読み取られています',
};

export function itemLabel(code: string): string {
  return ITEM_LABEL[code] ?? code;
}

/** What happened, whether it was saved, what to do next. */
export function ErrorNotice({ error, saved = false }: { error: ApiError | null; saved?: boolean }) {
  if (!error) return null;
  if (error.unknownOutcome) {
    return (
      <Notice tone="warning" title="結果を確認できませんでした">
        通信が途切れた可能性があります。保存・確定されたかは画面を再読み込みして確認してください。入力内容は残っています。
      </Notice>
    );
  }
  const blockers = (error.details?.blockers as { code: string; shop: string }[] | undefined) ?? [];
  const items = (error.details?.items as { index?: number; code: string; displayNumber?: string | null }[] | undefined) ?? [];
  return (
    <Notice tone="error" title={error.message}>
      {!saved && error.code !== 'MFA_REQUIRED' && <p>この操作は保存・確定されていません。</p>}
      {blockers.length > 0 && (
        <ul>
          {blockers.map((b, i) => (
            <li key={i}>
              {BLOCKER_LABEL[b.code] ?? b.code}
              {b.shop ? `（${b.shop}）` : ''}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ul>
          {items.map((it, i) => (
            <li key={i}>
              {it.displayNumber ? `券 ${it.displayNumber}: ` : typeof it.index === 'number' ? `${it.index + 1}枚目: ` : ''}
              {itemLabel(it.code)}
            </li>
          ))}
        </ul>
      )}
      {error.requestId && <p className="meta">問い合わせ番号: {error.requestId.slice(0, 8)}</p>}
    </Notice>
  );
}

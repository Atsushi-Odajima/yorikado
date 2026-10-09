/** Stable API error codes and their HTTP statuses (see docs/openapi.yaml). */
export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  MFA_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  ALREADY_USED: 409,
  EXPIRED: 409,
  UNSUPPORTED: 422,
  RESULT_PENDING: 202,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  CSRF: 403,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'ログインが必要です',
  MFA_REQUIRED: '二段階認証が必要です',
  FORBIDDEN: 'この操作の権限がありません',
  NOT_FOUND: '見つかりません',
  VALIDATION: '入力内容を確認してください',
  CONFLICT: '状態が変わったため処理できませんでした',
  ALREADY_USED: 'この券は使用済みです。事務局へ確認してください',
  EXPIRED: '有効期限が切れています',
  UNSUPPORTED: 'この操作には対応していません',
  RESULT_PENDING: '結果を確認しています',
  RATE_LIMITED: '回数が多すぎます。少し待ってからお試しください',
  SERVICE_UNAVAILABLE: '現在利用できません。時間をおいてお試しください',
  CSRF: '不正なリクエストです。画面を再読み込みしてください',
  INTERNAL: '処理中に問題が起きました。保存・確定されたかは履歴で確認してください',
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message || DEFAULT_MESSAGE[code]);
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
  get retryable(): boolean {
    return this.code === 'RATE_LIMITED' || this.code === 'SERVICE_UNAVAILABLE' || this.code === 'RESULT_PENDING';
  }
}

interface PgError {
  message?: string;
  hint?: string | null;
  details?: string | null;
  code?: string;
}

/** Map a PostgREST/Postgres error raised by app.fail() to an AppError. */
export function fromDbError(err: PgError): AppError {
  const code = (err.message ?? '') as ErrorCode;
  if (code in ERROR_STATUS) {
    let details: Record<string, unknown> | undefined;
    if (err.details) {
      try {
        details = JSON.parse(err.details) as Record<string, unknown>;
      } catch {
        details = undefined;
      }
    }
    return new AppError(code, err.hint || undefined, details);
  }
  if (err.code === '23505') return new AppError('CONFLICT', '同じ内容が既に登録されています');
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return new AppError('VALIDATION');
  if (err.code === 'PGRST301' || err.code === 'PGRST303') return new AppError('UNAUTHENTICATED');
  if (err.code === '42501') return new AppError('NOT_FOUND');
  return new AppError('INTERNAL');
}

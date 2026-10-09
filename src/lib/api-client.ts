'use client';

/** Browser-side API client for /api/v1 (BFF). Never stores tokens in the browser. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly fieldErrors: Record<string, string> = {},
    public readonly details: Record<string, unknown> = {},
    public readonly requestId: string | null = null,
  ) {
    super(message);
  }
  /** The request may or may not have been processed (network/timeout/5xx without body). */
  get unknownOutcome(): boolean {
    return this.code === 'NETWORK_UNKNOWN';
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const headers: Record<string, string> = { 'x-requested-with': 'yorikado' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch('/api/v1' + path, {
      method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError('NETWORK_UNKNOWN', '通信の結果を確認できませんでした', 0);
  } finally {
    clearTimeout(timer);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/csv')) {
    if (!res.ok) throw new ApiError('NETWORK_UNKNOWN', 'ファイルを取得できませんでした', res.status);
    return (await res.blob()) as unknown as T;
  }
  let payload: { data?: T; error?: { code: string; message: string; fieldErrors?: Record<string, string>; details?: Record<string, unknown> }; requestId?: string } | null = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!payload) throw new ApiError('NETWORK_UNKNOWN', '通信の結果を確認できませんでした', res.status);
  if (!res.ok || payload.error) {
    const e = payload.error ?? { code: 'INTERNAL', message: 'エラーが発生しました' };
    throw new ApiError(e.code, e.message, res.status, e.fieldErrors ?? {}, e.details ?? {}, payload.requestId ?? null);
  }
  return payload.data as T;
}

export function newKey(): string {
  return crypto.randomUUID();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

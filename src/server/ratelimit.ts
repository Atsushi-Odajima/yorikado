import 'server-only';
import { adminDb, rpc } from '@/server/db/supabase';
import { AppError } from '@/server/errors';
import { sha256Hex } from '@/domain/identity/crypto';

/**
 * Shared fixed-window rate limiter stored in PostgreSQL (works across all
 * server instances; never process-local). Limits are provisional and must be
 * tuned against real busy-hour usage (see docs/OPERATIONS.txt).
 */
export const LIMITS = {
  loginIp: { limit: 10, window: 15 * 60 },
  loginAccount: { limit: 10, window: 15 * 60 },
  voucherLookup: { limit: 30, window: 60 },
  voucherConfirm: { limit: 30, window: 60 },
  recover: { limit: 5, window: 15 * 60 },
  invitation: { limit: 20, window: 15 * 60 },
} as const;

export async function hit(bucket: string, rule: { limit: number; window: number }): Promise<{ allowed: boolean; retryAfter: number; hits: number }> {
  const r = await rpc<{ allowed: boolean; retryAfter: number; hits: number }>(adminDb(), 'svc_rate_limit_hit', {
    p_bucket: bucket,
    p_limit: rule.limit,
    p_window_seconds: rule.window,
  });
  return r;
}

export async function enforce(bucket: string, rule: { limit: number; window: number }) {
  const r = await hit(bucket, rule);
  if (!r.allowed) throw new AppError('RATE_LIMITED', undefined, { retryAfter: r.retryAfter });
}

export function accountBucket(email: string): string {
  return 'login:acct:' + sha256Hex(email.trim().toLowerCase()).slice(0, 32);
}

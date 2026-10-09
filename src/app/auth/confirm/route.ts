import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { rpc, userDb } from '@/server/db/supabase';
import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

/** Email link handler (password recovery). Verifies the one-time token_hash server-side. */
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get('token_hash');
  const type = req.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const base = env().baseUrl;
  if (!tokenHash || type !== 'recovery') return NextResponse.redirect(new URL('/login', base));
  const db = await userDb();
  const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(new URL('/login?expired=1', base));
  await rpc(db, 'api_session_start', { p_user_agent: req.headers.get('user-agent') ?? '' }).catch(() => undefined);
  return NextResponse.redirect(new URL('/auth/reset', base));
}

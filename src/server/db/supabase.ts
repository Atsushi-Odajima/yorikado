import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from '@/server/env';
import { AppError, fromDbError } from '@/server/errors';

export type Db = SupabaseClient;

/** Cookie options for the BFF session: HttpOnly, SameSite=Lax, Secure on HTTPS. */
function cookieOptions() {
  const e = env();
  return { httpOnly: true, sameSite: 'lax' as const, secure: e.baseUrl.protocol === 'https:', path: '/' };
}

/**
 * Supabase client bound to the signed-in user's session cookies. All business
 * reads/writes run under this client so RLS and DB-side authorization apply.
 */
export async function userDb(requestId?: string): Promise<Db> {
  const e = env();
  const store = await cookies();
  return createServerClient(e.supabaseUrl, e.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, { ...c.options, ...cookieOptions() });
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes them.
        }
      },
    },
    cookieOptions: cookieOptions(),
    auth: { flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: requestId ? { 'x-request-id': requestId } : {} },
  });
}

let admin: Db | null = null;
/** Service-role client. Server-only; used for jobs, invitations, storage signing, rate limits. */
export function adminDb(): Db {
  if (!admin) {
    const e = env();
    admin = createClient(e.supabaseUrl, e.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return admin;
}

/** Call an RPC and unwrap errors into AppError. */
export async function rpc<T = unknown>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

export async function requireUser(db: Db): Promise<{ id: string; email: string | null; aal: string | null }> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) throw new AppError('UNAUTHENTICATED');
  const c = data.claims as Record<string, unknown>;
  return { id: String(c.sub), email: (c.email as string) ?? null, aal: (c.aal as string) ?? null };
}

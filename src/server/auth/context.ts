import 'server-only';
import { cookies } from 'next/headers';
import { env } from '@/server/env';

export const SHOP_COOKIE = 'yk_shop';
export const TENANT_COOKIE = 'yk_tenant';

/** Remembers the selected shop / office tenant (an id only; access is re-checked on every request). */
export async function setContextCookie(name: string, value: string) {
  const store = await cookies();
  store.set(name, value, { httpOnly: true, sameSite: 'lax', secure: env().baseUrl.protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 30 });
}

export async function readContextCookie(name: string): Promise<string | null> {
  const store = await cookies();
  return store.get(name)?.value ?? null;
}

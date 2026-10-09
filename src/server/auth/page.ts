import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { rpc, userDb, type Db } from '@/server/db/supabase';
import { AppError } from '@/server/errors';
import { readContextCookie, SHOP_COOKIE, TENANT_COOKIE } from './context';

export interface MeShop {
  shopId: string;
  shopName: string;
  shopStatus: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  tenantContact: string;
  roles: string[];
}
export interface MeOffice {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  roles: string[];
}
export interface Me {
  userId: string;
  environment: 'DEMO' | 'LIVE' | null;
  aal: string;
  profile: { displayName: string; termsAcceptedAt: string | null } | null;
  session: { kind: string; absoluteExpiresAt: string } | null;
  offices: MeOffice[];
  shops: MeShop[];
}

/** Map DB errors on pages: auth -> login, not found -> 404, else rethrow. */
export async function load<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rpc<T>(db, fn, args);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === 'UNAUTHENTICATED') redirect('/login?expired=1');
      if (e.code === 'MFA_REQUIRED') redirect('/mfa');
      if (e.code === 'NOT_FOUND' || e.code === 'VALIDATION') notFound();
    }
    throw e;
  }
}

export async function getMe(): Promise<{ db: Db; me: Me }> {
  const rid = (await headers()).get('x-request-id') ?? undefined;
  const db = await userDb(rid);
  const { data } = await db.auth.getClaims();
  if (!data?.claims) redirect('/login');
  const me = await load<Me>(db, 'api_me');
  if (!me.profile?.termsAcceptedAt || !me.profile.displayName) redirect('/welcome');
  return { db, me };
}

export async function requireMerchant(): Promise<{ db: Db; me: Me; shop: MeShop }> {
  const { db, me } = await getMe();
  if (me.shops.length === 0) redirect(me.offices.length ? '/o' : '/login?no_access=1');
  const selected = await readContextCookie(SHOP_COOKIE);
  const shop = me.shops.find((s) => s.shopId === selected) ?? (me.shops.length === 1 ? me.shops[0] : undefined);
  if (!shop) redirect('/m/shops');
  return { db, me, shop };
}

export async function requireOffice(): Promise<{ db: Db; me: Me; office: MeOffice; can: (r: string[]) => boolean }> {
  const { db, me } = await getMe();
  if (me.offices.length === 0) redirect(me.shops.length ? '/m' : '/login?no_access=1');
  if (me.aal !== 'aal2') redirect('/mfa');
  const selected = await readContextCookie(TENANT_COOKIE);
  const office = me.offices.find((o) => o.tenantId === selected) ?? me.offices[0]!;
  return { db, me, office, can: (r) => office.roles.some((x) => r.includes(x)) };
}

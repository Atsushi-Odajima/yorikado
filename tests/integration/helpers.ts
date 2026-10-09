import { randomUUID } from 'node:crypto';
import { parseKeyRing } from '@/domain/identity/keys';
import { generateToken, tokenDigest } from '@/domain/vouchers/token';
import { asUser, call, DbCallError, ensureSession, pool, type Identity } from '../../scripts/lib/db';
import { SHOP_A1, SHOP_A2, SHOP_B1, TENANT_A, TENANT_B, USERS, type UserKey } from '../../scripts/lib/demo-users';

export { DbCallError, SHOP_A1, SHOP_A2, SHOP_B1, TENANT_A, TENANT_B, USERS };
export const p = pool();
export const ring = () => parseKeyRing(process.env.COUPON_HMAC_KEY!, process.env.COUPON_HMAC_KEY_VERSION, process.env.COUPON_HMAC_KEYS_OLD);

const OFFICE: UserKey[] = ['operator', 'approver', 'admin', 'auditor', 'boperator', 'bapprover'];
const sessions = new Map<UserKey, string>();

export async function who(k: UserKey, opts: { aal2?: boolean; mfaAgeSeconds?: number } = {}): Promise<Identity> {
  if (!sessions.has(k)) sessions.set(k, await ensureSession(p, USERS[k].id, { kind: OFFICE.includes(k) ? 'office' : 'merchant' }));
  return { id: USERS[k].id, sessionId: sessions.get(k)!, aal2: opts.aal2 ?? OFFICE.includes(k), mfaAgeSeconds: opts.mfaAgeSeconds ?? 5 };
}

export async function as<T = any>(k: UserKey | Identity, fn: string, args: Record<string, unknown> = {}, opts: { aal2?: boolean; mfaAgeSeconds?: number } = {}): Promise<T> {
  const id = typeof k === 'string' ? await who(k, opts) : k;
  return asUser(p, id, (c) => call<T>(c, fn, args));
}

/** Expect a DB call to fail with an API error code. Returns the error. */
export async function fails(promise: Promise<unknown>, code: string): Promise<DbCallError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DbCallError) {
      if (e.code !== code) throw new Error(`expected ${code} but got ${e.code}: ${e.hint}`);
      return e;
    }
    throw e;
  }
  throw new Error(`expected ${code} but call succeeded`);
}

const DAY = 86400_000;
const iso = (ms: number) => new Date(ms).toISOString();

export async function newCampaign(opts: { mode?: string; denoms?: number[]; shops?: string[]; tenant?: 'A' | 'B'; name?: string } = {}) {
  const b = opts.tenant === 'B';
  const c = await as(b ? 'boperator' : 'operator', 'api_campaign_create', {
    p_tenant: b ? TENANT_B : TENANT_A,
    p_name: opts.name ?? 'テスト券 ' + randomUUID().slice(0, 6),
    p_mode: opts.mode ?? 'owned_qr',
    p_starts_at: iso(Date.now() - 30 * DAY),
    p_ends_at: iso(Date.now() + 60 * DAY),
    p_denominations: opts.mode === 'external_csv' ? [] : (opts.denoms ?? [500, 1000]),
    p_rules_text: 'test',
    p_issuer: 'test',
    p_shop_ids: opts.shops ?? (b ? [SHOP_B1] : [SHOP_A1, SHOP_A2]),
    p_external_service_url: '',
    p_idem: randomUUID(),
  });
  await as(b ? 'boperator' : 'operator', 'api_campaign_submit', { p_campaign: c.id });
  await as(b ? 'bapprover' : 'approver', 'api_campaign_approve', { p_campaign: c.id });
  return c.id as string;
}

export async function issue(campaignId: string, denom: number, count: number, opts: { activate?: boolean; validFrom?: number; validUntil?: number; tenant?: 'A' | 'B' } = {}) {
  const r = ring();
  const tokens = Array.from({ length: count }, () => generateToken());
  const op: UserKey = opts.tenant === 'B' ? 'boperator' : 'operator';
  const ap: UserKey = opts.tenant === 'B' ? 'bapprover' : 'approver';
  const b = await as(op, 'api_issuance_create', {
    p_campaign: campaignId,
    p_denomination: denom,
    p_valid_from: iso(opts.validFrom ?? Date.now() - DAY),
    p_valid_until: iso(opts.validUntil ?? Date.now() + 50 * DAY),
    p_digests: tokens.map((t) => tokenDigest(r.current.key, t)),
    p_key_version: r.current.version,
    p_idem: randomUUID(),
  });
  await as(op, 'api_issuance_mark_generated', { p_batch: b.batchId, p_object_path: `test/${b.batchId}.enc` });
  if (opts.activate !== false) {
    await as(op, 'api_issuance_download_authorize', { p_batch: b.batchId });
    await as(op, 'api_issuance_confirm_receipt', { p_batch: b.batchId, p_counted: count });
    await as(ap, 'api_issuance_activate', { p_batch: b.batchId });
  }
  return { batchId: b.batchId as string, tokens };
}

export function items(tokens: string[]) {
  const r = ring();
  return tokens.map((t, index) => ({ index, digests: [tokenDigest(r.current.key, t)] }));
}

export async function draft(k: UserKey | Identity, shop: string, campaignId: string, tokens: string[]) {
  return as(k, 'api_receipt_draft_create', { p_shop: shop, p_campaign: campaignId, p_items: items(tokens) }, { aal2: false });
}

export async function redeem(k: UserKey, shop: string, campaignId: string, tokens: string[], key: string = randomUUID()) {
  const d = await draft(k, shop, campaignId, tokens);
  return as(k, 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: key }, { aal2: false });
}

export async function sql<T = any>(q: string, params: unknown[] = []): Promise<T[]> {
  return (await p.query(q, params)).rows as T[];
}

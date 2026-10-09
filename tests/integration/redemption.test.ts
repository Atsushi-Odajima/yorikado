import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, call } from '../../scripts/lib/db';
import { as, draft, fails, issue, newCampaign, p, redeem, SHOP_A1, SHOP_A2, SHOP_B1, sql, who } from './helpers';

let campaign: string;
let b500: string[];
let b1000: string[];

beforeAll(async () => {
  campaign = await newCampaign();
  b500 = (await issue(campaign, 500, 40)).tokens;
  b1000 = (await issue(campaign, 1000, 12)).tokens;
});
afterAll(async () => p.end());

describe('AC04 amounts', () => {
  it('1 coupon and 10 coupons: amounts and totals match, report source written once', async () => {
    const one = await redeem('staff', SHOP_A1, campaign, [b500[0]!]);
    expect(one.status).toBe('confirmed');
    expect(one.receipt.amount).toBe(500);
    const ten = [...b500.slice(1, 6), ...b1000.slice(0, 5)];
    const r = await redeem('staff', SHOP_A1, campaign, ten);
    expect(r.receipt.amount).toBe(5 * 500 + 5 * 1000);
    expect(r.receipt.count).toBe(10);
    const [{ n }] = await sql('select count(*)::int n from redemption_items where redemption_id = $1', [r.receipt.redemptionId]);
    expect(n).toBe(10);
  });
});

describe('AC05 concurrency: 2 shops x 20 parallel on the same coupon', () => {
  it('exactly one succeeds', async () => {
    const token = b500[10]!;
    const staff = await who('staff');
    const owner = await who('owner');
    const drafts = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? draft(staff, SHOP_A1, campaign, [token]) : draft(owner, SHOP_A2, campaign, [token]))),
    );
    const results = await Promise.allSettled(
      drafts.map((d, i) =>
        asUser(p, { ...(i % 2 === 0 ? staff : owner), aal2: false }, (c) => call(c, 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: randomUUID() })),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const codes = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code);
    expect(ok).toHaveLength(1);
    expect(codes.every((c) => c === 'ALREADY_USED' || c === 'CONFLICT')).toBe(true);
    const [row] = await sql(`select c.status, (select count(*)::int from redemption_items i where i.coupon_id = c.id) n from coupons c where c.batch_id in (select batch_id from coupons where display_number is not null) and c.id = (select coupon_ids[1] from receipt_drafts where id = $1)`, [drafts[0]!.id]);
    expect(row.status).toBe('redeemed');
    expect(row.n).toBe(1);
  });
});

describe('AC06 idempotency', () => {
  it('same key returns the same result; different payload with same key is rejected', async () => {
    const d = await draft('staff', SHOP_A1, campaign, [b500[11]!]);
    const key = randomUUID();
    const r1 = await as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: key }, { aal2: false });
    const r2 = await as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: key }, { aal2: false });
    expect(r2.operationId).toBe(r1.operationId);
    expect(r2.replayed).toBe(true);
    await fails(as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount + 1, p_idem: key }, { aal2: false }), 'CONFLICT');
    // another key on a consumed draft points back to the original operation
    const e = await fails(as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: randomUUID() }, { aal2: false }), 'CONFLICT');
    expect(e.details?.operationId).toBe(r1.operationId);
  });

  it('double tap (concurrent same key) creates one operation', async () => {
    const d = await draft('staff', SHOP_A1, campaign, [b500[12]!]);
    const key = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: key }, { aal2: false })));
    expect(new Set(rs.map((r) => r.operationId)).size).toBe(1);
    const [{ n }] = await sql('select count(*)::int n from operations where idempotency_key = $1', [key]);
    expect(n).toBe(1);
  });

  it('a confirmed key still returns the original result after the draft expired', async () => {
    const d = await draft('staff', SHOP_A1, campaign, [b500[13]!]);
    const key = randomUUID();
    const r1 = await as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: key }, { aal2: false });
    await sql(`update receipt_drafts set expires_at = now() - interval '1 hour' where id = $1`, [d.id]);
    const r2 = await as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: key }, { aal2: false });
    expect(r2.operationId).toBe(r1.operationId);
    const op = await as('staff', 'api_operation_get', { p_id: key }, { aal2: false });
    expect(op.status).toBe('confirmed');
  });

  it('unknown key reports pending (nothing recorded); expired unconfirmed draft is rejected', async () => {
    const op = await as('staff', 'api_operation_get', { p_id: randomUUID() }, { aal2: false });
    expect(op.status).toBe('pending');
    const d = await draft('staff', SHOP_A1, campaign, [b500[14]!]);
    await sql(`update receipt_drafts set expires_at = now() - interval '1 second' where id = $1`, [d.id]);
    await fails(as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: randomUUID() }, { aal2: false }), 'EXPIRED');
    const [c] = await sql(`select status from coupons where id = (select coupon_ids[1] from receipt_drafts where id = $1)`, [d.id]);
    expect(c.status).toBe('active');
  });
});

describe('AC07 all-or-nothing and tamper resistance', () => {
  it('one expired coupon fails the whole receipt', async () => {
    const exp = (await issue(campaign, 500, 1, { validFrom: Date.now() - 10 * 86400_000, validUntil: Date.now() - 86400_000 })).tokens;
    const e = await fails(draft('staff', SHOP_A1, campaign, [b500[15]!, exp[0]!]), 'EXPIRED');
    expect((e.details?.items as { code: string }[])[0]!.code).toBe('EXPIRED');
    // expiry between draft and confirm: whole receipt rolled back
    const d = await draft('staff', SHOP_A1, campaign, [b500[16]!, b500[17]!]);
    await sql(`update coupons set valid_until = now() - interval '1 second' where id = (select coupon_ids[2] from receipt_drafts where id = $1)`, [d.id]);
    await fails(as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: randomUUID() }, { aal2: false }), 'EXPIRED');
    const rows = await sql(`select status from coupons where id = any((select coupon_ids from receipt_drafts where id = $1)::uuid[])`, [d.id]);
    expect(rows.map((r) => r.status).sort()).toEqual(['active', 'active']);
  });

  it('rejects tampered amount, foreign draft, foreign shop, rules change, used/other-campaign coupons', async () => {
    const d = await draft('staff', SHOP_A1, campaign, [b500[18]!]);
    await fails(as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: 1, p_idem: randomUUID() }, { aal2: false }), 'CONFLICT');
    await fails(as('owner', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: randomUUID() }, { aal2: false }), 'NOT_FOUND');
    await fails(draft('bstaff', SHOP_A1, campaign, [b500[19]!]), 'NOT_FOUND');
    await fails(draft('staff', SHOP_B1, campaign, [b500[19]!]), 'NOT_FOUND');
    await sql('update campaigns set rules_version = rules_version + 1 where id = $1', [campaign]);
    await fails(as('staff', 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: randomUUID() }, { aal2: false }), 'CONFLICT');
    await fails(draft('staff', SHOP_A1, campaign, [b500[0]!]), 'ALREADY_USED');
    const other = await newCampaign({ denoms: [500] });
    const ot = (await issue(other, 500, 1)).tokens;
    const e = await fails(draft('staff', SHOP_A1, campaign, [ot[0]!]), 'UNSUPPORTED');
    expect((e.details?.items as { code: string }[])[0]!.code).toBe('OTHER_CAMPAIGN');
  });

  it('suspended campaign and ineligible shop are refused', async () => {
    const c2 = await newCampaign({ denoms: [500], shops: [SHOP_A1] });
    const t = (await issue(c2, 500, 2)).tokens;
    await fails(draft('owner', SHOP_A2, c2, [t[0]!]), 'CONFLICT');
    await as('operator', 'api_campaign_suspend', { p_campaign: c2, p_reason: 'test' });
    await fails(draft('staff', SHOP_A1, c2, [t[0]!]), 'CONFLICT');
  });

  it('inactive coupons cannot be redeemed', async () => {
    const t = (await issue(campaign, 500, 1, { activate: false })).tokens;
    await fails(draft('staff', SHOP_A1, campaign, [t[0]!]), 'CONFLICT');
  });
});

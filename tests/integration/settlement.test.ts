import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, fails, issue, newCampaign, p, redeem, SHOP_A1, SHOP_A2, sql } from './helpers';

afterAll(async () => p.end());

const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generate(campaign: string, start: number, end: number) {
  return as('operator', 'api_settlement_generate', { p_campaign: campaign, p_month: null, p_period_start: iso(start), p_period_end: iso(end), p_payment_date: null, p_idem: randomUUID() });
}
async function toApproved(id: string) {
  const b = await as('operator', 'api_settlement_get', { p_batch: id });
  const r = await as('operator', 'api_settlement_submit_review', { p_batch: id, p_expected_version: b.version });
  return as('approver', 'api_settlement_approve', { p_batch: id, p_expected_version: r.version, p_approve: true, p_note: '' });
}

describe('AC11 settlement sums and boundaries', () => {
  let campaign: string;
  let tokens: string[];
  beforeAll(async () => {
    campaign = await newCampaign({ denoms: [500, 1000] });
    tokens = (await issue(campaign, 500, 20)).tokens;
  });

  it('sources = lines = batch, JST [start, end) boundary, never settled twice', async () => {
    const t0 = Date.now();
    const r1 = await redeem('staff', SHOP_A1, campaign, [tokens[0]!, tokens[1]!]);
    const r2 = await redeem('owner', SHOP_A2, campaign, [tokens[2]!]);
    const rEdge = await redeem('staff', SHOP_A1, campaign, [tokens[3]!]);
    // put one redemption exactly on the period end (excluded) and one exactly on the start (included)
    const start = new Date('2026-01-01T00:00:00+09:00').getTime();
    const end = new Date('2026-02-01T00:00:00+09:00').getTime();
    await sql('update redemptions set occurred_at = $2 where id = $1', [r1.receipt.redemptionId, iso(start)]);
    await sql('update redemptions set occurred_at = $2 where id = $1', [r2.receipt.redemptionId, iso(end - 1)]);
    await sql('update redemptions set occurred_at = $2 where id = $1', [rEdge.receipt.redemptionId, iso(end)]);
    const b = await as('operator', 'api_settlement_generate', { p_campaign: campaign, p_month: '2026-01', p_period_start: null, p_period_end: null, p_payment_date: null, p_idem: randomUUID() });
    expect(b.periodStart).toBe('2025-12-31T15:00:00+00:00');
    expect(b.totalAmount).toBe(1500);
    for (const l of b.lines) expect(l.sourceSum).toBe(l.netAmount);
    expect(b.lines.reduce((s: number, l: { netAmount: number }) => s + l.netAmount, 0)).toBe(b.totalAmount);
    await toApproved(b.id);
    // a second batch over a wider period does not include already-settled sources
    await sql('update redemptions set occurred_at = $2 where id = $1', [rEdge.receipt.redemptionId, iso(t0 - 1000)]);
    const b2 = await generate(campaign, start, Date.now());
    const ids = (await sql('select source_id from settlement_sources ss join settlement_lines l on l.id = ss.line_id where l.batch_id = $1', [b2.id])).map((r) => r.source_id);
    expect(ids).not.toContain(r1.receipt.redemptionId);
    expect(ids).not.toContain(r2.receipt.redemptionId);
    expect(ids).toContain(rEdge.receipt.redemptionId);
    await as('operator', 'api_settlement_discard', { p_batch: b2.id, p_expected_version: b2.version });
  });

  it('separation of duties: preparer cannot approve; approve needs recent MFA', async () => {
    await redeem('staff', SHOP_A1, campaign, [tokens[5]!]);
    await sleep(20);
    const b = await generate(campaign, Date.now() - 86400_000, Date.now());
    const r = await as('operator', 'api_settlement_submit_review', { p_batch: b.id, p_expected_version: b.version });
    await fails(as('operator', 'api_settlement_approve', { p_batch: b.id, p_expected_version: r.version, p_approve: true, p_note: '' }), 'FORBIDDEN');
    await fails(as('approver', 'api_settlement_approve', { p_batch: b.id, p_expected_version: r.version, p_approve: true, p_note: '' }, { mfaAgeSeconds: 900 }), 'MFA_REQUIRED');
    await fails(as('approver', 'api_settlement_approve', { p_batch: b.id, p_expected_version: r.version, p_approve: true, p_note: '' }, { aal2: false }), 'MFA_REQUIRED');
    const ok = await as('approver', 'api_settlement_approve', { p_batch: b.id, p_expected_version: r.version, p_approve: true, p_note: '' });
    expect(ok.status).toBe('approved');
    expect(ok.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AC08/AC12 reversal, export and bank results', () => {
  let campaign: string;
  let tokens: string[];
  beforeAll(async () => {
    campaign = await newCampaign({ denoms: [1000] });
    tokens = (await issue(campaign, 1000, 10)).tokens;
  });

  it('reversal: no self-approval, coupon retired forever, history kept', async () => {
    const r = await redeem('staff', SHOP_A1, campaign, [tokens[0]!]);
    await fails(as('staff', 'api_reversal_request', { p_redemption: r.receipt.redemptionId, p_reason: 'x', p_idem: randomUUID() }, { aal2: false }), 'FORBIDDEN');
    const v = await as('owner', 'api_reversal_request', { p_redemption: r.receipt.redemptionId, p_reason: 'mistake', p_idem: randomUUID() }, { aal2: false });
    // operator who also requests cannot approve; approver role required and different person
    await fails(as('operator', 'api_reversal_decide', { p_reversal: v.reversalId, p_approve: true, p_note: '' }), 'FORBIDDEN');
    const done = await as('approver', 'api_reversal_decide', { p_reversal: v.reversalId, p_approve: true, p_note: 'ok' });
    expect(done.status).toBe('approved');
    await fails(redeem('staff', SHOP_A1, campaign, [tokens[0]!]), 'ALREADY_USED');
    const [row] = await sql('select r.status, c.status cstatus from redemptions r join redemption_items i on i.redemption_id = r.id join coupons c on c.id = i.coupon_id where r.id = $1', [r.receipt.redemptionId]);
    expect(row).toEqual({ status: 'reversed', cstatus: 'retired' });
    await expect(sql('delete from redemptions where id = $1', [r.receipt.redemptionId])).rejects.toThrow(/cannot be deleted/);
  });

  it('export is not payment; mixed bank results; re-import; uploader cannot confirm; confirmed lines not re-exported; post-payment reversal becomes a negative adjustment', async () => {
    await redeem('staff', SHOP_A1, campaign, [tokens[1]!, tokens[2]!]);
    const rb = await redeem('staff', SHOP_A1, campaign, [tokens[4]!]);
    const rc = await redeem('owner', SHOP_A2, campaign, [tokens[3]!]);
    await sleep(20);
    const b = await generate(campaign, Date.now() - 86400_000, Date.now());
    // a pending reversal request blocks review
    const pend = await as('owner', 'api_reversal_request', { p_redemption: rc.receipt.redemptionId, p_reason: 'later', p_idem: randomUUID() }, { aal2: false });
    const blocked = await fails(as('operator', 'api_settlement_submit_review', { p_batch: b.id, p_expected_version: b.version }), 'CONFLICT');
    expect((blocked.details?.blockers as { code: string }[]).map((x) => x.code)).toContain('PENDING_REVERSAL');
    await as('approver', 'api_reversal_decide', { p_reversal: pend.reversalId, p_approve: false, p_note: 'no' });
    const approved = await toApproved(b.id);
    expect(approved.status).toBe('approved');
    const exp = await as('operator', 'api_settlement_export', { p_batch: b.id });
    expect(exp.reexport).toBe(false);
    const after = await as('operator', 'api_settlement_get', { p_batch: b.id });
    expect(after.status).toBe('exported'); // exported is not "paid"
    expect(after.lines.every((l: { status: string }) => l.status === 'exported')).toBe(true);
    const lines = exp.lines as { lineId: string; netAmount: number; shopName: string }[];
    const a1 = lines.find((l) => l.shopName === '山田商店')!;
    const a2 = lines.find((l) => l.shopName === 'さくら食堂')!;
    const ref = randomUUID().slice(0, 8);
    const rows = [
      { row: 1, line_id: a1.lineId, bank_reference: `OK-${ref}`, amount_jpy: a1.netAmount, result: 'success', executed_date: '2026-10-30' },
      { row: 2, line_id: a2.lineId, bank_reference: `NG-${ref}`, amount_jpy: a2.netAmount, result: 'failed', executed_date: '2026-10-30' },
      { row: 3, line_id: randomUUID(), bank_reference: `XX-${ref}`, amount_jpy: 1, result: 'success', executed_date: '2026-10-30' },
    ];
    const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    const st = await as('operator', 'api_bank_results_stage', { p_batch: b.id, p_file_name: 'r.csv', p_file_hash: hash, p_raw_path: null, p_rows: rows });
    expect(st.summary).toMatchObject({ ok: 2, error: 1, success: 1, failed: 1 });
    const again = await as('operator', 'api_bank_results_stage', { p_batch: b.id, p_file_name: 'r.csv', p_file_hash: hash, p_raw_path: null, p_rows: rows });
    expect(again.existing).toBe(true);
    await fails(as('operator', 'api_bank_results_confirm', { p_import: st.importId }), 'FORBIDDEN');
    const conf = await as('approver', 'api_bank_results_confirm', { p_import: st.importId });
    expect(conf.status).toBe('exception');
    expect(conf.lines.find((l: { id: string }) => l.id === a1.lineId).status).toBe('confirmed');
    expect(conf.lines.find((l: { id: string }) => l.id === a2.lineId).status).toBe('failed');
    // re-export: only the unpaid line, flagged as a re-export
    const exp2 = await as('operator', 'api_settlement_export', { p_batch: b.id });
    expect(exp2.reexport).toBe(true);
    expect(exp2.lines.map((l: { lineId: string }) => l.lineId)).toEqual([a2.lineId]);
    // a "success" with the wrong amount is not a confirmation
    const rows2 = [{ row: 1, line_id: a2.lineId, bank_reference: `UP-${ref}`, amount_jpy: a2.netAmount - 1, result: 'success', executed_date: '2026-10-31' }];
    const st2 = await as('operator', 'api_bank_results_stage', { p_batch: b.id, p_file_name: 'r2.csv', p_file_hash: createHash('sha256').update('r2' + ref).digest('hex'), p_raw_path: null, p_rows: rows2 });
    const conf2 = await as('approver', 'api_bank_results_confirm', { p_import: st2.importId });
    expect(conf2.lines.find((l: { id: string }) => l.id === a2.lineId).exceptionReason).toBe('UNDERPAID');
    // reversal after payment: no change to the paid batch; next batch carries a negative, flagged adjustment
    const v = await as('owner', 'api_reversal_request', { p_redemption: rb.receipt.redemptionId, p_reason: 'refund', p_idem: randomUUID() }, { aal2: false });
    const dec = await as('approver', 'api_reversal_decide', { p_reversal: v.reversalId, p_approve: true, p_note: '' });
    expect(dec.requiresAdjustment).toBe(true);
    const paid = await as('operator', 'api_settlement_get', { p_batch: b.id });
    expect(paid.lines.find((l: { id: string }) => l.id === a1.lineId).netAmount).toBe(a1.netAmount);
    await sleep(20);
    const nb = await generate(campaign, Date.now() - 86400_000, Date.now());
    const adj = nb.lines.find((l: { shopName: string }) => l.shopName === '山田商店');
    expect(adj.netAmount).toBe(-1000);
    expect(adj.status).toBe('exception');
    expect(adj.exceptionReason).toBe('NEGATIVE_ADJUSTMENT');
    await as('operator', 'api_settlement_discard', { p_batch: nb.id, p_expected_version: nb.version });
  });
});

describe('AC09 paper reports', () => {
  it('submitted paper is not settled; verified difference needs a reason; bundle unique', async () => {
    const c = await newCampaign({ mode: 'paper_count', denoms: [500, 1000] });
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const pr = await as('owner', 'api_paper_report_save', { p_id: null, p_shop: SHOP_A1, p_campaign: c, p_received_date: today, p_counts: { '500': 2, '1000': 1 }, p_photo_ids: [], p_bundle_ref: 'T-1', p_expected_version: null, p_idem: randomUUID() }, { aal2: false });
    expect(pr.claimedAmount).toBe(2000);
    const sub = await as('owner', 'api_paper_report_submit', { p_id: pr.id, p_expected_version: pr.version }, { aal2: false });
    await sleep(20);
    const b = await as('operator', 'api_settlement_generate', { p_campaign: c, p_month: null, p_period_start: iso(Date.now() - 3 * 86400_000), p_period_end: iso(Date.now() + 60_000), p_payment_date: null, p_idem: randomUUID() }).catch((e) => e);
    // period end must not be in the future
    expect(b.code ?? 'ok').toBe('VALIDATION');
    await fails(as('operator', 'api_paper_report_review', { p_id: pr.id, p_action: 'verify', p_verified_amount: 1500, p_reason: '', p_original_present: true, p_original_storage: 'x', p_original_return_status: '', p_expected_version: sub.version }), 'VALIDATION');
    const v = await as('operator', 'api_paper_report_review', { p_id: pr.id, p_action: 'verify', p_verified_amount: 1500, p_reason: '1枚が対象外', p_original_present: true, p_original_storage: '金庫', p_original_return_status: '保管中', p_expected_version: sub.version });
    expect(v).toMatchObject({ status: 'verified', claimedAmount: 2000, verifiedAmount: 1500, differenceReason: '1枚が対象外' });
    const pr2 = await as('owner', 'api_paper_report_save', { p_id: null, p_shop: SHOP_A2, p_campaign: c, p_received_date: today, p_counts: { '500': 1 }, p_photo_ids: [], p_bundle_ref: 'T-1', p_expected_version: null, p_idem: randomUUID() }, { aal2: false });
    const sub2 = await as('owner', 'api_paper_report_submit', { p_id: pr2.id, p_expected_version: pr2.version }, { aal2: false });
    await fails(as('operator', 'api_paper_report_review', { p_id: pr2.id, p_action: 'verify', p_verified_amount: 500, p_reason: '', p_original_present: true, p_original_storage: '', p_original_return_status: '', p_expected_version: sub2.version }), 'CONFLICT');
    // only the verified amount is a settlement source; the submitted report blocks review until checked
    const s = await as('operator', 'api_settlement_generate', { p_campaign: c, p_month: null, p_period_start: iso(Date.now() - 3 * 86400_000), p_period_end: iso(Date.now()), p_payment_date: null, p_idem: randomUUID() });
    expect(s.totalAmount).toBe(1500);
    const types = (await sql('select source_type, source_id from settlement_sources ss join settlement_lines l on l.id = ss.line_id where l.batch_id = $1', [s.id]));
    expect(types).toEqual([{ source_type: 'paper', source_id: pr.id }]);
    const e = await fails(as('operator', 'api_settlement_submit_review', { p_batch: s.id, p_expected_version: s.version }), 'CONFLICT');
    expect((e.details?.blockers as { code: string }[]).map((x) => x.code)).toContain('UNVERIFIED_PAPER');
  });
});

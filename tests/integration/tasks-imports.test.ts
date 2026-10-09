import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, fails, newCampaign, p, SHOP_A1, SHOP_A2, SHOP_B1, sql, TENANT_A } from './helpers';

afterAll(async () => p.end());

async function publish(type: string, def: unknown, shops = [SHOP_A1, SHOP_A2], dueMs = 7 * 86400_000) {
  const t = await as('operator', 'api_task_save_draft', { p_tenant: TENANT_A, p_id: null, p_type: type, p_title: `${type} test`, p_body: 'b', p_definition: def, p_due_at: new Date(Date.now() + dueMs).toISOString(), p_shop_ids: shops, p_expected_version: null, p_idem: randomUUID() });
  return as('operator', 'api_task_publish', { p_task: t.id, p_expected_version: t.version });
}
const EVENT = { questions: [{ id: 'attend', label: '参加', kind: 'choice', required: true, options: ['参加', '不参加'] }, { id: 'note', label: '補足', kind: 'text' }] };

describe('AC13 tasks', () => {
  it('opening a notice does not acknowledge it; acknowledgement is explicit', async () => {
    const t = await publish('notice', { questions: [] });
    const view = await as('staff', 'api_task_for_shop', { p_task: t.id, p_shop: SHOP_A1 }, { aal2: false });
    expect(view.state).toBe('unanswered');
    const [{ n }] = await sql('select count(*)::int n from acknowledgements where task_id = $1', [t.id]);
    expect(n).toBe(0);
    await as('staff', 'api_task_acknowledge', { p_task: t.id, p_shop: SHOP_A1 }, { aal2: false });
    expect((await as('staff', 'api_task_for_shop', { p_task: t.id, p_shop: SHOP_A1 }, { aal2: false })).state).toBe('done');
  });

  it('one current answer per shop, revision conflict, proxy history kept', async () => {
    const t = await publish('event', EVENT);
    const r1 = await as('staff', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { attend: '参加' }, p_idem: randomUUID() }, { aal2: false });
    expect(r1).toMatchObject({ revision: 1, status: 'approved' });
    // owner answers with a stale revision -> conflict showing the latest answer
    const e = await fails(as('owner', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { attend: '不参加' }, p_idem: randomUUID() }, { aal2: false }), 'CONFLICT');
    expect((e.details?.current as { payload: { attend: string } }).payload.attend).toBe('参加');
    await as('owner', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 1, p_payload: { attend: '不参加' }, p_idem: randomUUID() }, { aal2: false });
    // proxy by phone
    await fails(as('operator', 'api_task_proxy_respond', { p_task: t.id, p_shop: SHOP_A2, p_expected_revision: 0, p_payload: { attend: '参加' }, p_proxy_reason: '', p_proxy_channel: 'phone', p_idem: randomUUID() }), 'VALIDATION');
    await as('operator', 'api_task_proxy_respond', { p_task: t.id, p_shop: SHOP_A2, p_expected_revision: 0, p_payload: { attend: '参加' }, p_proxy_reason: '店主から電話', p_proxy_channel: 'phone', p_idem: randomUUID() });
    const rows = await sql('select shop_id, revision, is_current, proxy_reason, submitted_by from responses where task_id = $1 order by shop_id, revision', [t.id]);
    expect(rows.filter((r) => r.shop_id === SHOP_A1).map((r) => [r.revision, r.is_current])).toEqual([[1, false], [2, true]]);
    const proxy = rows.find((r) => r.shop_id === SHOP_A2);
    expect(proxy.proxy_reason).toBe('店主から電話');
    const [aud] = await sql(`select action, actor_id, acting_for_shop_id from audit_events where entity_id = $1 and action = 'task.proxy_respond'`, [t.id]);
    expect(aud.acting_for_shop_id).toBe(SHOP_A2);
    expect(aud.actor_id).not.toBe(null);
  });

  it('validates payload, rejects unknown fields and late answers; published definition cannot be edited', async () => {
    const t = await publish('event', EVENT, [SHOP_A1], 7 * 86400_000);
    await fails(as('staff', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { attend: 'maybe' }, p_idem: randomUUID() }, { aal2: false }), 'VALIDATION');
    await fails(as('staff', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { note: 'x' }, p_idem: randomUUID() }, { aal2: false }), 'VALIDATION');
    await fails(as('staff', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { attend: '参加', hack: 1 }, p_idem: randomUUID() }, { aal2: false }), 'VALIDATION');
    await fails(as('operator', 'api_task_save_draft', { p_tenant: TENANT_A, p_id: t.id, p_type: 'event', p_title: 'changed', p_body: '', p_definition: EVENT, p_due_at: null, p_shop_ids: [SHOP_A1], p_expected_version: t.version, p_idem: null }), 'CONFLICT');
    await sql(`update tasks set due_at = now() - interval '1 minute' where id = $1`, [t.id]);
    await fails(as('staff', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { attend: '参加' }, p_idem: randomUUID() }, { aal2: false }), 'EXPIRED');
    await as('operator', 'api_task_extend', { p_task: t.id, p_due_at: new Date(Date.now() + 86400_000).toISOString() });
    await as('staff', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { attend: '参加' }, p_idem: randomUUID() }, { aal2: false });
    // non-recipient shop and other tenant cannot see it
    await fails(as('bstaff', 'api_task_for_shop', { p_task: t.id, p_shop: SHOP_B1 }, { aal2: false }), 'NOT_FOUND');
  });

  it('revision publishes a new version without invalidating earlier answers', async () => {
    const t = await publish('event', EVENT, [SHOP_A1]);
    await as('staff', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { attend: '参加' }, p_idem: randomUUID() }, { aal2: false });
    const rev = await as('operator', 'api_task_revise', { p_task: t.id, p_idem: randomUUID() });
    await as('operator', 'api_task_publish', { p_task: rev.id, p_expected_version: rev.version });
    const [old] = await sql('select superseded_by from tasks where id = $1', [t.id]);
    expect(old.superseded_by).toBe(rev.id);
    const [{ n }] = await sql('select count(*)::int n from responses where task_id = $1', [t.id]);
    expect(n).toBe(1);
  });

  it('photo / shop change answers require office review by someone else', async () => {
    const t = await publish('shop_change', { questions: [{ id: 'contact_phone', label: '電話', kind: 'text' }] }, [SHOP_A2]);
    const r = await as('owner', 'api_task_respond', { p_task: t.id, p_shop: SHOP_A2, p_expected_revision: 0, p_payload: { contact_phone: '000-1111-2222' }, p_idem: randomUUID() }, { aal2: false });
    expect(r.status).toBe('submitted');
    await as('approver', 'api_task_review', { p_task: t.id, p_shop: SHOP_A2, p_revision: 1, p_approve: true, p_note: '' });
    const [s] = await sql('select contact_phone from shops where id = $1', [SHOP_A2]);
    expect(s.contact_phone).toBe('000-1111-2222');
  });
});

describe('AC10 external CSV records', () => {
  const AT = new Date(Date.now() - 3600_000).toISOString();
  const H = (n: number, over: Record<string, unknown> = {}) => ({
    row: n, provider: 'DEMO_PROVIDER', provider_transaction_id: `T-${n}`, shop_external_code: 'SHOP-DEMO-01', amount_jpy: 500,
    occurred_at: AT, status: 'confirmed', original_transaction_id: '', ...over,
  });
  const hash = () => createHash('sha256').update(randomUUID()).digest('hex');

  it('dedupe by file hash and by row key; conflicting content stops; unknown & foreign shops; reversals', async () => {
    const c = await newCampaign({ mode: 'external_csv' });
    const fh = hash();
    const rows = [H(1), H(2, { amount_jpy: 1000 }), H(3, { status: 'reversed', provider_transaction_id: 'T-3R', original_transaction_id: 'T-1' })];
    const i1 = await as('operator', 'api_external_import_stage', { p_campaign: c, p_source_name: 'DEMO', p_file_name: 'a.csv', p_file_hash: fh, p_rows: rows });
    expect(i1.summary).toMatchObject({ ok: 3, confirmedAmount: 1500, reversedAmount: 500 });
    const same = await as('operator', 'api_external_import_stage', { p_campaign: c, p_source_name: 'DEMO', p_file_name: 'a.csv', p_file_hash: fh, p_rows: rows });
    expect(same.existing).toBe(true);
    await as('operator', 'api_external_import_commit', { p_import: i1.id });
    // same rows again in another file -> skipped duplicates; changed content -> conflict
    const i2 = await as('operator', 'api_external_import_stage', { p_campaign: c, p_source_name: 'DEMO', p_file_name: 'b.csv', p_file_hash: hash(), p_rows: [H(1), H(2, { amount_jpy: 999 })] });
    expect(i2.summary).toMatchObject({ duplicate: 1, conflict: 1 });
    await fails(as('operator', 'api_external_import_commit', { p_import: i2.id }), 'CONFLICT');
    // unknown shop, other-tenant shop code, partial reversal, formula-flagged row
    const i3 = await as('operator', 'api_external_import_stage', {
      p_campaign: c, p_source_name: 'DEMO', p_file_name: 'c.csv', p_file_hash: hash(),
      p_rows: [
        H(1, { provider_transaction_id: 'U-1', shop_external_code: 'NOPE-1' }),
        H(2, { provider_transaction_id: 'U-2', shop_external_code: 'SHOP-AOBA-01' }),
        H(3, { provider_transaction_id: 'U-3', status: 'reversed', original_transaction_id: 'T-2', amount_jpy: 400 }),
        { ...H(4), error: 'FORMULA_OR_CONTROL_CHAR' },
      ],
    });
    expect(i3.summary).toMatchObject({ unknownShop: 2, unsupported: 1, error: 1 });
    await fails(as('operator', 'api_external_import_map_shop', { p_import: i3.id, p_code: 'SHOP-AOBA-01', p_shop: SHOP_B1 }), 'VALIDATION');
    const mapped = await as('operator', 'api_external_import_map_shop', { p_import: i3.id, p_code: 'NOPE-1', p_shop: SHOP_A2 });
    expect(mapped.summary.unknownShop).toBe(1);
    await fails(as('operator', 'api_external_import_commit', { p_import: i3.id }), 'CONFLICT');
    const [{ n }] = await sql('select count(*)::int n from external_transactions where campaign_id = $1', [c]);
    expect(n).toBe(3);
  });

  it('settles confirmed minus reversed external records', async () => {
    const c = await newCampaign({ mode: 'external_csv' });
    const i = await as('operator', 'api_external_import_stage', {
      p_campaign: c, p_source_name: 'DEMO', p_file_name: 'd.csv', p_file_hash: hash(),
      p_rows: [H(1, { amount_jpy: 1000 }), H(2, { amount_jpy: 300 }), H(3, { status: 'reversed', provider_transaction_id: 'T-2R', original_transaction_id: 'T-2', amount_jpy: 300 })],
    });
    await as('operator', 'api_external_import_commit', { p_import: i.id });
    const b = await as('operator', 'api_settlement_generate', { p_campaign: c, p_month: null, p_period_start: new Date(Date.now() - 86400_000).toISOString(), p_period_end: new Date().toISOString(), p_payment_date: null, p_idem: randomUUID() });
    expect(b.lines[0]).toMatchObject({ grossAmount: 1300, reversalAmount: 300, netAmount: 1000 });
  });
});

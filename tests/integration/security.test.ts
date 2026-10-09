import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { asUser, call, ensureSession } from '../../scripts/lib/db';
import { as, fails, issue, newCampaign, p, redeem, SHOP_A1, SHOP_A2, SHOP_B1, sql, TENANT_A, TENANT_B, USERS, who } from './helpers';

afterAll(async () => p.end());

async function selectAs(k: Parameters<typeof who>[0], q: string, params: unknown[] = []) {
  const id = await who(k);
  return asUser(p, id, async (c) => (await c.query(q, params)).rows);
}

describe('AC15 tenant isolation and roles (RLS + functions)', () => {
  it('other tenant data is invisible (404 / no rows)', async () => {
    await fails(as('bstaff', 'api_merchant_home', { p_shop: SHOP_A1 }, { aal2: false }), 'NOT_FOUND');
    await fails(as('boperator', 'api_office_queue', { p_tenant: TENANT_A }), 'NOT_FOUND');
    const [q] = await sql(`select id from requests where tenant_id = $1 limit 1`, [TENANT_A]);
    await fails(as('bstaff', 'api_request_get', { p_req: q.id }, { aal2: false }), 'NOT_FOUND');
    await fails(as('boperator', 'api_request_get', { p_req: q.id }), 'NOT_FOUND');
    for (const t of ['shops', 'campaigns', 'requests', 'request_messages', 'redemptions', 'settlement_lines', 'tasks', 'paper_reports', 'audit_events', 'coupons']) {
      const rows = await selectAs('bstaff', `select tenant_id from public.${t}`);
      expect(rows.every((r: { tenant_id: string }) => r.tenant_id === TENANT_B), t).toBe(true);
      const rows2 = await selectAs('boperator', `select tenant_id from public.${t}`);
      expect(rows2.every((r: { tenant_id: string }) => r.tenant_id === TENANT_B), t).toBe(true);
    }
  });

  it('shop staff only see their own shop; no office-only tables', async () => {
    const shops = await selectAs('staff', 'select id from shops');
    expect(shops.map((s: { id: string }) => s.id)).toEqual([SHOP_A1]);
    expect(await selectAs('staff', 'select * from issuance_batches')).toHaveLength(0);
    expect(await selectAs('staff', 'select * from settlement_batches')).toHaveLength(0);
    expect(await selectAs('staff', 'select * from external_imports')).toHaveLength(0);
    await expect(selectAs('staff', 'select * from bank_accounts')).rejects.toThrow(/permission denied/);
    await expect(selectAs('staff', 'select token_digest from coupons')).rejects.toThrow(/permission denied/);
    await expect(selectAs('staff', 'select * from outbox')).rejects.toThrow(/permission denied/);
    await expect(selectAs('operator', 'select object_path from attachments')).rejects.toThrow(/permission denied/);
  });

  it('API roles cannot write tables directly or touch storage objects', async () => {
    await expect(selectAs('operator', `update shops set display_name = 'x' where id = '${SHOP_A1}'`)).rejects.toThrow(/permission denied/);
    await expect(selectAs('staff', `insert into redemptions (tenant_id) values ('${TENANT_A}')`)).rejects.toThrow(/permission denied/);
    await expect(selectAs('admin', `delete from audit_events`)).rejects.toThrow(/permission denied/);
    expect(await selectAs('operator', 'select * from storage.objects')).toHaveLength(0);
    await expect(sql(`update audit_events set action = 'x' where true`)).rejects.toThrow(/append-only/);
  });

  it('anon cannot execute business functions; authenticated cannot execute service functions', async () => {
    const c = await p.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      await expect(c.query(`select public.api_me()`)).rejects.toThrow(/permission denied/);
      await c.query('rollback');
    } finally {
      c.release();
    }
    await expect(as('operator', 'svc_jobs_claim', { p_limit: 1 })).rejects.toThrow(/permission denied/);
    await expect(as('operator', 'svc_invitation_accept', { p_token_digest: 'x', p_user: USERS.operator.id })).rejects.toThrow(/permission denied/);
  });

  it('role checks: staff cannot request reversals/bank changes; operator cannot approve; auditor read-only', async () => {
    await fails(as('staff', 'api_bank_change_request', { p_shop: SHOP_A1, p_encrypted_payload: 'x', p_key_version: 1, p_display_label: 'x', p_masked_suffix: '1234', p_idem: randomUUID() }, { aal2: true }), 'FORBIDDEN');
    await fails(as('auditor', 'api_shop_create', { p_tenant: TENANT_A, p_display_name: 'x', p_legal_name: '', p_address: '', p_contact_phone: '', p_external_code: '', p_idem: randomUUID() }), 'FORBIDDEN');
    const audit = await as('auditor', 'api_audit_list', { p_tenant: TENANT_A, p_before: null, p_limit: 5 });
    expect(audit.length).toBeGreaterThan(0);
    await fails(as('staff', 'api_audit_list', { p_tenant: TENANT_A, p_before: null, p_limit: 5 }, { aal2: true }), 'NOT_FOUND');
  });

  it('office work requires aal2; sensitive operations require MFA within 5 minutes', async () => {
    await fails(as('operator', 'api_office_queue', { p_tenant: TENANT_A }, { aal2: false }), 'MFA_REQUIRED');
    const c = await newCampaign();
    const b = await issue(c, 500, 1, { activate: false });
    await fails(as('operator', 'api_issuance_download_authorize', { p_batch: b.batchId }, { mfaAgeSeconds: 301 }), 'MFA_REQUIRED');
    // owner bank change needs recent MFA even though shop staff work does not
    await fails(as('owner', 'api_bank_change_request', { p_shop: SHOP_A1, p_encrypted_payload: 'x', p_key_version: 1, p_display_label: 'x', p_masked_suffix: '1234', p_idem: randomUUID() }, { aal2: false }), 'MFA_REQUIRED');
  });

  it('revoked sessions, expired absolute sessions and revoked memberships lose access', async () => {
    const sid = await ensureSession(p, USERS.staff.id, { kind: 'merchant' });
    const id = { id: USERS.staff.id, sessionId: sid };
    expect((await asUser(p, id, (c) => call(c, 'api_me'))).userId).toBe(USERS.staff.id);
    await sql('update app_sessions set revoked_at = now() where session_id = $1', [sid]);
    await fails(asUser(p, id, (c) => call(c, 'api_me')), 'UNAUTHENTICATED');
    const sid2 = await ensureSession(p, USERS.staff.id, { kind: 'merchant' });
    await sql(`update app_sessions set absolute_expires_at = now() - interval '1 second' where session_id = $1`, [sid2]);
    await fails(asUser(p, { id: USERS.staff.id, sessionId: sid2 }, (c) => call(c, 'api_me')), 'UNAUTHENTICATED');
    // forged session id of another user
    const other = await ensureSession(p, USERS.owner.id, { kind: 'merchant' });
    await fails(asUser(p, { id: USERS.staff.id, sessionId: other }, (c) => call(c, 'api_me')), 'UNAUTHENTICATED');
    // office session older than 8 hours
    const old = await ensureSession(p, USERS.operator.id, { kind: 'office', startedAgoSeconds: 8 * 3600 + 5 });
    await fails(asUser(p, { id: USERS.operator.id, sessionId: old, aal2: true }, (c) => call(c, 'api_office_queue', { p_tenant: TENANT_A })), 'UNAUTHENTICATED');
    // membership revoked
    await sql(`update shop_memberships set status = 'revoked' where user_id = $1 and shop_id = $2`, [USERS.bstaff.id, SHOP_B1]);
    try {
      await fails(as('bstaff', 'api_merchant_home', { p_shop: SHOP_B1 }, { aal2: false }), 'NOT_FOUND');
    } finally {
      await sql(`update shop_memberships set status = 'active' where user_id = $1 and shop_id = $2`, [USERS.bstaff.id, SHOP_B1]);
    }
  });

  it('tenant admin: no self-grant, last admin cannot be removed', async () => {
    await fails(as('admin', 'api_membership_set', { p_tenant: TENANT_A, p_user: USERS.admin.id, p_role: 'office_approver', p_status: 'active' }), 'FORBIDDEN');
    await fails(as('admin', 'api_membership_set', { p_tenant: TENANT_A, p_user: USERS.admin.id, p_role: 'tenant_admin', p_status: 'revoked' }), 'CONFLICT');
  });
});

describe('AC16 injection and input handling', () => {
  it('SQL-looking input is stored as data; XSS text is stored verbatim (rendered escaped by React)', async () => {
    const evil = `'); drop table public.shops; -- <script>alert(1)</script>`;
    const r = await as('staff', 'api_request_create', { p_shop: SHOP_A1, p_category: 'other', p_subject: evil, p_body: evil, p_attachment_ids: [], p_related_receipt: '', p_related_request: null, p_idem: randomUUID() }, { aal2: false });
    expect(r.subject).toBe(evil);
    const [{ n }] = await sql('select count(*)::int n from shops');
    expect(n).toBeGreaterThan(0);
  });

  it('attachments of another shop or not yet scanned cannot be attached or downloaded', async () => {
    const a = await as('owner', 'api_attachment_intent', { p_tenant: TENANT_A, p_shop: SHOP_A2, p_purpose: 'request_message' }, { aal2: false });
    await fails(as('owner', 'api_request_create', { p_shop: SHOP_A2, p_category: 'other', p_subject: 'x', p_body: 'x', p_attachment_ids: [a.id], p_related_receipt: '', p_related_request: null, p_idem: randomUUID() }, { aal2: false }), 'VALIDATION');
    await fails(as('owner', 'api_attachment_authorize_download', { p_id: a.id }, { aal2: false }), 'NOT_FOUND');
    await fails(as('bstaff', 'api_attachment_intent', { p_tenant: TENANT_A, p_shop: SHOP_A1, p_purpose: 'request_message' }, { aal2: false }), 'NOT_FOUND');
  });
});

describe('AC14 internal memos never reach shops', () => {
  it('memo and its photos are hidden from shop API and RLS', async () => {
    const req = await as('staff', 'api_request_create', { p_shop: SHOP_A1, p_category: 'other', p_subject: 'memo test', p_body: 'hello', p_attachment_ids: [], p_related_receipt: '', p_related_request: null, p_idem: randomUUID() }, { aal2: false });
    const att = await as('operator', 'api_attachment_intent', { p_tenant: TENANT_A, p_shop: null, p_purpose: 'request_message' });
    await sql(`update attachments set scan_status = 'clean', object_path = 'clean/x.png' where id = $1`, [att.id]);
    await as('operator', 'api_request_message', { p_req: req.id, p_body: 'SECRET MEMO', p_attachment_ids: [att.id], p_internal: true, p_idem: randomUUID() });
    await as('operator', 'api_request_message', { p_req: req.id, p_body: 'public reply', p_attachment_ids: [], p_internal: false, p_idem: randomUUID() });
    const shopView = await as('staff', 'api_request_get', { p_req: req.id }, { aal2: false });
    expect(JSON.stringify(shopView)).not.toContain('SECRET MEMO');
    expect(shopView.messages.map((m: { body: string }) => m.body)).toEqual(['hello', 'public reply']);
    const rows = await selectAs('staff', 'select body from request_messages where request_id = $1', [req.id]);
    expect(rows.map((r: { body: string }) => r.body)).not.toContain('SECRET MEMO');
    await fails(as('staff', 'api_attachment_authorize_download', { p_id: att.id }, { aal2: false }), 'NOT_FOUND');
    await fails(as('staff', 'api_request_message', { p_req: req.id, p_body: 'x', p_attachment_ids: [], p_internal: true, p_idem: randomUUID() }, { aal2: false }), 'NOT_FOUND');
    const officeView = await as('operator', 'api_request_get', { p_req: req.id });
    expect(JSON.stringify(officeView)).toContain('SECRET MEMO');
  });

  it('resolve requires a reason; shop can reopen within 30 days, not after', async () => {
    const req = await as('staff', 'api_request_create', { p_shop: SHOP_A1, p_category: 'other', p_subject: 'reopen', p_body: 'x', p_attachment_ids: [], p_related_receipt: '', p_related_request: null, p_idem: randomUUID() }, { aal2: false });
    await fails(as('operator', 'api_request_update', { p_req: req.id, p_expected_version: 1, p_status: 'resolved', p_assigned_to: null, p_resolution_note: '' }), 'VALIDATION');
    const r = await as('operator', 'api_request_update', { p_req: req.id, p_expected_version: 1, p_status: 'resolved', p_assigned_to: USERS.operator.id, p_resolution_note: 'done' });
    await fails(as('operator', 'api_request_update', { p_req: req.id, p_expected_version: 1, p_status: 'in_progress', p_assigned_to: null, p_resolution_note: '' }), 'CONFLICT');
    await as('staff', 'api_request_message', { p_req: req.id, p_body: 'still broken', p_attachment_ids: [], p_internal: false, p_idem: randomUUID() }, { aal2: false });
    const after = await as('staff', 'api_request_get', { p_req: req.id }, { aal2: false });
    expect(after.status).toBe('in_progress');
    await as('operator', 'api_request_update', { p_req: req.id, p_expected_version: after.version, p_status: 'resolved', p_assigned_to: null, p_resolution_note: 'done again' });
    await sql(`update requests set resolved_at = now() - interval '31 days' where id = $1`, [req.id]);
    await fails(as('staff', 'api_request_message', { p_req: req.id, p_body: 'again', p_attachment_ids: [], p_internal: false, p_idem: randomUUID() }, { aal2: false }), 'CONFLICT');
    void r;
  });

  it('retried creates are idempotent (one consultation)', async () => {
    const key = randomUUID();
    const args = { p_shop: SHOP_A1, p_category: 'other', p_subject: 'idem', p_body: 'once', p_attachment_ids: [], p_related_receipt: '', p_related_request: null, p_idem: key };
    const a = await as('staff', 'api_request_create', args, { aal2: false });
    const b = await as('staff', 'api_request_create', args, { aal2: false });
    expect(b.id).toBe(a.id);
    await fails(as('staff', 'api_request_create', { ...args, p_body: 'different' }, { aal2: false }), 'CONFLICT');
  });
});

describe('AC17 audit contains no secrets', () => {
  it('no raw tokens or full account numbers in audit', async () => {
    const c = await newCampaign({ denoms: [500] });
    const { tokens } = await issue(c, 500, 3);
    await redeem('staff', SHOP_A1, c, [tokens[0]!]);
    const rows = await sql<{ t: string }>(`select coalesce(before_summary::text,'') || coalesce(after_summary::text,'') t from audit_events`);
    const all = rows.map((r) => r.t).join('\n');
    for (const t of tokens) expect(all).not.toContain(t);
    expect(all).not.toMatch(/1234567|7654321/); // DEMO bank account numbers
  });
});

describe('AC19 issuance two-stage, void and DEMO reset guard', () => {
  it('inactive until a different approver activates after receipt check', async () => {
    const c = await newCampaign({ denoms: [500] });
    const b = await issue(c, 500, 2, { activate: false });
    const [{ n }] = await sql(`select count(*)::int n from coupons where batch_id = $1 and status = 'inactive'`, [b.batchId]);
    expect(n).toBe(2);
    await fails(as('approver', 'api_issuance_activate', { p_batch: b.batchId }), 'CONFLICT'); // receipt not confirmed
    await fails(as('operator', 'api_issuance_confirm_receipt', { p_batch: b.batchId, p_counted: 2 }), 'CONFLICT'); // not downloaded
    await as('operator', 'api_issuance_download_authorize', { p_batch: b.batchId });
    await fails(as('operator', 'api_issuance_confirm_receipt', { p_batch: b.batchId, p_counted: 1 }), 'VALIDATION');
    await as('operator', 'api_issuance_confirm_receipt', { p_batch: b.batchId, p_counted: 2 });
    await sql(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'office_approver') on conflict do nothing`, [TENANT_A, USERS.operator.id]);
    try {
      await fails(as('operator', 'api_issuance_activate', { p_batch: b.batchId }), 'FORBIDDEN'); // creator cannot activate
    } finally {
      await sql(`delete from memberships where tenant_id = $1 and user_id = $2 and role = 'office_approver'`, [TENANT_A, USERS.operator.id]);
    }
    await sql(`update issuance_batches set download_expires_at = now() - interval '1 second' where id = $1`, [b.batchId]);
    await fails(as('operator', 'api_issuance_download_authorize', { p_batch: b.batchId }), 'EXPIRED');
    const v = await as('operator', 'api_issuance_void', { p_batch: b.batchId, p_reason: 'expired' });
    expect(v.voidedCoupons).toBe(2);
  });

  it('batch limit 200 and denominations enforced', async () => {
    const c = await newCampaign({ denoms: [500] });
    await expect(issue(c, 500, 201, { activate: false })).rejects.toThrow(/VALIDATION/);
    await expect(issue(c, 700, 1, { activate: false })).rejects.toThrow(/VALIDATION/);
  });

  it('db:reset:demo refuses LIVE and non-local targets', () => {
    const run = (env: Record<string, string>) => spawnSync('node', ['scripts/db-reset-demo.mjs'], { env: { ...process.env, ...env, YORIKADO_CONFIRM_RESET: 'demo' }, encoding: 'utf8' });
    const live = run({ APP_ENV: 'live' });
    expect(live.status).toBe(1);
    expect(live.stderr).toContain('refused');
    const remote = run({ APP_ENV: 'demo', SUPABASE_URL: 'https://abc.supabase.co' });
    expect(remote.status).toBe(1);
  });
});

describe('invitations: 72h, single use, email-bound', () => {
  it('cannot be reused or used after expiry', async () => {
    const digest = createHash('sha256').update(randomUUID()).digest('hex');
    const inv = await as('operator', 'api_invitation_create', { p_tenant: TENANT_A, p_email: USERS.bstaff.email, p_role: 'shop_staff', p_shop: SHOP_A2, p_token_digest: digest, p_token_enc: 'x', p_idem: randomUUID() });
    expect(inv.status).toBe('pending');
    const c = await p.connect();
    try {
      await c.query('begin');
      await expect(call(c, 'svc_invitation_accept', { p_token_digest: digest, p_user: USERS.staff.id })).rejects.toThrow(/FORBIDDEN/);
      await c.query('rollback');
      const r = await call(c, 'svc_invitation_accept', { p_token_digest: digest, p_user: USERS.bstaff.id });
      expect(r.role).toBe('shop_staff');
      await expect(call(c, 'svc_invitation_accept', { p_token_digest: digest, p_user: USERS.bstaff.id })).rejects.toThrow(/CONFLICT/);
    } finally {
      c.release();
      await sql(`delete from shop_memberships where user_id = $1 and shop_id = $2`, [USERS.bstaff.id, SHOP_A2]);
    }
    const d2 = createHash('sha256').update(randomUUID()).digest('hex');
    await as('operator', 'api_invitation_create', { p_tenant: TENANT_A, p_email: 'new.person@example.com', p_role: 'shop_staff', p_shop: SHOP_A1, p_token_digest: d2, p_token_enc: 'x', p_idem: randomUUID() });
    await sql(`update invitations set expires_at = now() - interval '1 second' where token_digest = $1`, [d2]);
    await expect(sql(`select public.svc_invitation_accept($1, $2)`, [d2, USERS.staff.id])).rejects.toThrow(/EXPIRED/);
    // office roles need tenant_admin + recent MFA
    await fails(as('operator', 'api_invitation_create', { p_tenant: TENANT_A, p_email: 'x@example.com', p_role: 'office_approver', p_shop: null, p_token_digest: createHash('sha256').update(randomUUID()).digest('hex'), p_token_enc: 'x', p_idem: randomUUID() }), 'FORBIDDEN');
  });
});

describe('rate limiting is shared (database)', () => {
  it('blocks after the limit within the window', async () => {
    const bucket = 'test:' + randomUUID();
    const r = [];
    for (let i = 0; i < 11; i++) r.push((await sql(`select public.svc_rate_limit_hit($1, 10, 900) r`, [bucket]))[0].r.allowed);
    expect(r.filter(Boolean)).toHaveLength(10);
    expect(r[10]).toBe(false);
  });
});

describe('jobs: retry with backoff, failed queue, dedupe', () => {
  it('moves to failed after 5 attempts and dedupes by key', async () => {
    const key = 'test-job:' + randomUUID();
    await sql(`insert into outbox (tenant_id, kind, dedupe_key, payload) values ($1, 'noop', $2, '{}')`, [TENANT_A, key]);
    await sql(`insert into outbox (tenant_id, kind, dedupe_key, payload) values ($1, 'noop', $2, '{}') on conflict (dedupe_key) do nothing`, [TENANT_A, key]);
    const [{ id, n }] = await sql(`select min(id::text) id, count(*)::int n from outbox where dedupe_key = $1`, [key]);
    expect(n).toBe(1);
    const states: string[] = [];
    for (let i = 0; i < 5; i++) {
      await sql(`update outbox set status = 'processing', attempts = attempts + 1 where id = $1`, [id]);
      states.push((await sql(`select public.svc_job_fail($1, 'boom') s`, [id]))[0].s);
      await sql(`update outbox set next_attempt_at = now() where id = $1`, [id]);
    }
    expect(states).toEqual(['pending', 'pending', 'pending', 'pending', 'failed']);
  });

  it('reminders: one per shop per JST day, answered tasks are not reminded', async () => {
    const t = await as('operator', 'api_task_save_draft', { p_tenant: TENANT_A, p_id: null, p_type: 'notice', p_title: 'remind test', p_body: '', p_definition: { questions: [] }, p_due_at: new Date(Date.now() + 86400_000).toISOString(), p_shop_ids: [SHOP_A1, SHOP_A2], p_expected_version: null, p_idem: randomUUID() });
    await as('operator', 'api_task_publish', { p_task: t.id, p_expected_version: t.version });
    await as('owner', 'api_task_acknowledge', { p_task: t.id, p_shop: SHOP_A2 }, { aal2: false });
    await sql(`delete from outbox where kind = 'reminder_digest'`);
    const r1 = await as('operator', 'api_task_remind', { p_task: t.id });
    expect(r1.queued).toBe(1); // only the unanswered shop
    const r2 = await as('operator', 'api_task_remind', { p_task: t.id });
    expect(r2.queued).toBe(0); // 24h limit per task/shop
    const rows = await sql(`select payload->>'shopId' shop from outbox where kind = 'reminder_digest'`);
    expect(rows.map((r) => r.shop)).toEqual([SHOP_A1]);
    const d = (await sql(`select public.svc_reminder_digest($1) d`, [SHOP_A2]))[0].d;
    expect(d.tasks.map((x: { id: string }) => x.id)).not.toContain(t.id);
  });
});

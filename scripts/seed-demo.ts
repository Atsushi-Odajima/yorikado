/**
 * DEMO fixtures through the real DB functions (as each fictional user).
 * Run only via `npm run db:reset:demo` (guards LIVE / non-local targets).
 * Dates are relative to the moment of seeding; nothing depends on a fixed 2026 date.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { encrypt } from '../src/domain/identity/crypto';
import { parseKeyRing } from '../src/domain/identity/keys';
import { encodeCrockford, formatTokenForPrint, qrText, tokenDigest } from '../src/domain/vouchers/token';
import { asUser, call, ensureSession, pool, type Identity } from './lib/db';
import { SHOP_A1, SHOP_A2, SHOP_B1, TENANT_A, TENANT_B, USERS, type UserKey } from './lib/demo-users';

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required (see .env.example)`);
  return v;
}

if (process.env.APP_ENV !== 'demo') throw new Error('seed-demo runs only with APP_ENV=demo');
const DB_URL = must('DATABASE_URL');
const SUPABASE_URL = must('SUPABASE_URL');
const couponKeys = parseKeyRing(must('COUPON_HMAC_KEY'), process.env.COUPON_HMAC_KEY_VERSION, process.env.COUPON_HMAC_KEYS_OLD);
const exportKeys = parseKeyRing(must('EXPORT_ENCRYPTION_KEY'), process.env.EXPORT_ENCRYPTION_KEY_VERSION, process.env.EXPORT_ENCRYPTION_KEYS_OLD);
const admin = createClient(SUPABASE_URL, must('SUPABASE_SECRET_KEY'), { auth: { persistSession: false } });

const p = pool(DB_URL);
const ids: Partial<Record<UserKey, Identity>> = {};
async function who(k: UserKey, mfa = true): Promise<Identity> {
  if (!ids[k]) {
    const office = ['operator', 'approver', 'admin', 'auditor', 'boperator', 'bapprover'].includes(k);
    ids[k] = { id: USERS[k].id, sessionId: await ensureSession(p, USERS[k].id, { kind: office ? 'office' : 'merchant' }) };
  }
  return { ...ids[k]!, aal2: mfa, mfaAgeSeconds: 5 };
}
async function as<T = any>(k: UserKey, fn: string, args: Record<string, unknown>, mfa = true): Promise<T> {
  return asUser(p, await who(k, mfa), (c) => call<T>(c, fn, args));
}

const DAY = 86400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const now = Date.now();

/** Deterministic DEMO tokens so the printed DEMO sheet and tests agree. */
function demoToken(label: string): string {
  return encodeCrockford(createHmac('sha256', 'yorikado-demo-seed-v1').update(label).digest().subarray(0, 16));
}

const printable: { campaign: string; label: string; displayNumber: string; faceValue: number; token: string; note: string }[] = [];

async function campaign(owner: UserKey, approver: UserKey, tenant: string, name: string, mode: string, denoms: number[], shops: string[], extra: Record<string, unknown> = {}) {
  const c = await as(owner, 'api_campaign_create', {
    p_tenant: tenant,
    p_name: name,
    p_mode: mode,
    p_starts_at: iso(now - 30 * DAY),
    p_ends_at: iso(now + 60 * DAY),
    p_denominations: denoms,
    p_rules_text: 'この券は練習用です。実際の買い物には使えません。1枚ごとの固定額面で、おつりは出ません。',
    p_issuer: tenant === TENANT_A ? 'ひなた商店街振興組合（練習用）' : 'あおば通り会（練習用）',
    p_shop_ids: shops,
    p_external_service_url: '',
    p_idem: randomUUID(),
    ...extra,
  });
  await as(owner, 'api_campaign_submit', { p_campaign: c.id });
  await as(approver, 'api_campaign_approve', { p_campaign: c.id });
  return c.id as string;
}

async function issue(op: UserKey, appr: UserKey | null, campaignId: string, campaignName: string, label: string, denom: number, count: number, validFrom: number, validUntil: number, note: string) {
  const tokens = Array.from({ length: count }, (_, i) => demoToken(`${label}-${i + 1}`));
  const b = await as(op, 'api_issuance_create', {
    p_campaign: campaignId,
    p_denomination: denom,
    p_valid_from: iso(validFrom),
    p_valid_until: iso(validUntil),
    p_digests: tokens.map((t) => tokenDigest(couponKeys.current.key, t)),
    p_key_version: couponKeys.current.version,
    p_idem: randomUUID(),
  });
  const path = `${b.batchId}.enc`;
  const payload = JSON.stringify({ batchId: b.batchId, coupons: b.displayNumbers.map((d: string, i: number) => ({ displayNumber: d, token: tokens[i] })) });
  const up = await admin.storage.from('issuance').upload(path, Buffer.from(encrypt(exportKeys, 'issuance:' + b.batchId, payload)), { contentType: 'application/octet-stream', upsert: true });
  if (up.error) throw new Error('storage upload failed: ' + up.error.message);
  await as(op, 'api_issuance_mark_generated', { p_batch: b.batchId, p_object_path: path });
  if (appr) {
    await as(op, 'api_issuance_download_authorize', { p_batch: b.batchId });
    await as(op, 'api_issuance_confirm_receipt', { p_batch: b.batchId, p_counted: count });
    await as(appr, 'api_issuance_activate', { p_batch: b.batchId });
  }
  tokens.forEach((t, i) => printable.push({ campaign: campaignName, label: `${label}-${i + 1}`, displayNumber: b.displayNumbers[i], faceValue: denom, token: t, note }));
  return { batchId: b.batchId as string, tokens };
}

async function redeem(k: UserKey, shop: string, campaignId: string, tokens: string[]) {
  const d = await as(k, 'api_receipt_draft_create', {
    p_shop: shop,
    p_campaign: campaignId,
    p_items: tokens.map((t, index) => ({ index, digests: [tokenDigest(couponKeys.current.key, t)] })),
  }, false);
  return as(k, 'api_redemption_confirm', { p_draft: d.id, p_expected_amount: d.amount, p_idem: randomUUID() }, false);
}

async function tinyPng(color: string): Promise<Buffer> {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: color } }).png().toBuffer();
}

async function attachment(k: UserKey, tenant: string, shop: string | null, purpose: string, color: string): Promise<string> {
  const intent = await as(k, 'api_attachment_intent', { p_tenant: tenant, p_shop: shop, p_purpose: purpose }, false);
  const png = await tinyPng(color);
  const cleanPath = `clean/${tenant}/${intent.id}.png`;
  const up = await admin.storage.from('attachments').upload(cleanPath, png, { contentType: 'image/png', upsert: true });
  if (up.error) throw new Error(up.error.message);
  const c = await p.connect();
  try {
    await c.query('begin');
    await call(c, 'svc_attachment_finalize', {
      p_id: intent.id, p_actor: USERS[k].id, p_ok: true, p_object_path: cleanPath, p_mime: 'image/png', p_size: png.byteLength,
      p_sha256: createHash('sha256').update(png).digest('hex'), p_width: 320, p_height: 240, p_reason: null,
    });
    await c.query('commit');
  } finally {
    c.release();
  }
  return intent.id;
}

async function main() {
  const env = (await p.query('select environment from public.deployment_environment')).rows[0]?.environment;
  if (env !== 'DEMO') throw new Error('Database is not marked DEMO. Refusing to seed.');
  if ((await p.query('select count(*)::int n from public.campaigns')).rows[0].n > 0) throw new Error('Already seeded. Run npm run db:reset:demo.');

  // ---- Campaigns
  const cQr = await campaign('operator', 'approver', TENANT_A, '練習地域券', 'owned_qr', [500, 1000], [SHOP_A1, SHOP_A2]);
  const cOther = await campaign('operator', 'approver', TENANT_A, '練習プレミアム券', 'owned_qr', [1000], [SHOP_A2]);
  const cStop = await campaign('operator', 'approver', TENANT_A, '練習地域券（停止中）', 'owned_qr', [500], [SHOP_A1, SHOP_A2]);
  const cPaper = await campaign('operator', 'approver', TENANT_A, '紙の練習券', 'paper_count', [500, 1000], [SHOP_A1, SHOP_A2]);
  const cExt = await campaign('operator', 'approver', TENANT_A, '外部の練習券（実績CSV）', 'external_csv', [], [SHOP_A1, SHOP_A2], {
    p_external_service_url: 'https://example.com/demo-official-voucher-service',
  });
  const cB = await campaign('boperator', 'bapprover', TENANT_B, '練習あおば券', 'owned_qr', [500], [SHOP_B1]);

  // ---- Coupons (fixtures)
  const valid = [now - DAY, now + 59 * DAY] as const;
  const b500 = await issue('operator', 'approver', cQr, '練習地域券', 'A500', 500, 20, valid[0], valid[1], '有効');
  const b1000 = await issue('operator', 'approver', cQr, '練習地域券', 'A1000', 1000, 10, valid[0], valid[1], '有効');
  await issue('operator', 'approver', cQr, '練習地域券', 'AEXP', 500, 3, now - 20 * DAY, now - DAY, '期限切れ');
  await issue('operator', null, cQr, '練習地域券', 'AINACT', 500, 3, valid[0], valid[1], '未有効化（印刷確認待ち）');
  const bVoid = await issue('operator', 'approver', cQr, '練習地域券', 'AVOID', 500, 2, valid[0], valid[1], '破棄済み');
  await as('operator', 'api_issuance_void', { p_batch: bVoid.batchId, p_reason: '練習: 印刷ミスのため破棄' });
  await issue('operator', 'approver', cOther, '練習プレミアム券', 'AOTHER', 1000, 3, valid[0], valid[1], '別事業（さくら食堂のみ対象）');
  await issue('operator', 'approver', cStop, '練習地域券（停止中）', 'ASTOP', 500, 2, valid[0], valid[1], '停止中の事業');
  await as('operator', 'api_campaign_suspend', { p_campaign: cStop, p_reason: '練習: 規則見直しのため受付停止中' });
  await issue('boperator', 'bapprover', cB, '練習あおば券', 'B500', 500, 5, valid[0], valid[1], 'あおば通り会（別組織）');

  // ---- Bank accounts (owner requests with recent MFA, approver approves)
  for (const shop of [SHOP_A1, SHOP_A2]) {
    const bank = { bankName: '練習銀行', branchName: 'ひなた支店', accountType: 'ordinary', accountNumber: shop === SHOP_A1 ? '1234567' : '7654321', holderName: shop === SHOP_A1 ? 'ヤマダシヨウテン' : 'サクラシヨクドウ' };
    const r = await as('owner', 'api_bank_change_request', {
      p_shop: shop,
      p_encrypted_payload: encrypt(exportKeys, 'bank-account', JSON.stringify(bank)),
      p_key_version: exportKeys.current.version,
      p_display_label: `練習銀行 ひなた支店 普通 ****${bank.accountNumber.slice(-4)}`,
      p_masked_suffix: bank.accountNumber.slice(-4),
      p_idem: randomUUID(),
    });
    await as('approver', 'api_bank_change_decide', { p_id: r.id, p_approve: true, p_note: '練習: 通帳の写しで本人確認', p_evidence: null });
  }

  // ---- Redemptions before settlement #1 (used coupon fixtures included)
  await redeem('staff', SHOP_A1, cQr, [b500.tokens[18]!, b500.tokens[19]!]); // 使用済み fixture (A500-19, -20)
  await redeem('owner', SHOP_A2, cQr, [b1000.tokens[9]!]); // 使用済み fixture (A1000-10)
  await redeem('staff', SHOP_A1, cQr, [b500.tokens[0]!, b1000.tokens[0]!]);
  await redeem('owner', SHOP_A2, cQr, [b1000.tokens[1]!]);
  await new Promise((r) => setTimeout(r, 1100));

  // ---- Settlement #1: approved -> exported -> bank result mismatch (exception)
  const s1 = await as('operator', 'api_settlement_generate', {
    p_campaign: cQr, p_month: null, p_period_start: iso(now - DAY), p_period_end: iso(Date.now()), p_payment_date: new Date(now + 10 * DAY).toISOString().slice(0, 10), p_idem: randomUUID(),
  });
  await as('operator', 'api_settlement_submit_review', { p_batch: s1.id, p_expected_version: s1.version });
  const s1r = await as('approver', 'api_settlement_get', { p_batch: s1.id });
  await as('approver', 'api_settlement_approve', { p_batch: s1.id, p_expected_version: s1r.version, p_approve: true, p_note: '' });
  const exp = await as('operator', 'api_settlement_export', { p_batch: s1.id });
  const bankRows = exp.lines.map((l: { lineId: string; netAmount: number; shopName: string }, i: number) => ({
    row: i + 1,
    line_id: l.lineId,
    bank_reference: `DEMO-BANK-${String(i + 1).padStart(4, '0')}`,
    amount_jpy: l.shopName === 'さくら食堂' ? l.netAmount - 100 : l.netAmount, // さくら食堂: 金額不一致 fixture
    result: 'success',
    executed_date: new Date(now).toISOString().slice(0, 10),
  }));
  const st = await as('operator', 'api_bank_results_stage', { p_batch: s1.id, p_file_name: 'demo_bank_results.csv', p_file_hash: createHmac('sha256', 'demo').update(JSON.stringify(bankRows)).digest('hex'), p_raw_path: null, p_rows: bankRows });
  await as('approver', 'api_bank_results_confirm', { p_import: st.importId });

  // ---- After settlement #1: a reversal + new redemptions -> settlement #3 left in review (未承認)
  const r3 = await redeem('staff', SHOP_A1, cQr, [b500.tokens[2]!]);
  const rev = await as('owner', 'api_reversal_request', { p_redemption: r3.receipt.redemptionId, p_reason: '練習: 読み取る券を間違えたため', p_idem: randomUUID() });
  await as('approver', 'api_reversal_decide', { p_reversal: rev.reversalId, p_approve: true, p_note: '練習: 現物を確認' });
  await redeem('staff', SHOP_A1, cQr, [b500.tokens[3]!, b500.tokens[4]!]);
  const rPending = await redeem('owner', SHOP_A2, cQr, [b500.tokens[5]!]);
  await new Promise((r) => setTimeout(r, 1100));
  const s3 = await as('operator', 'api_settlement_generate', {
    p_campaign: cQr, p_month: null, p_period_start: iso(now - DAY), p_period_end: iso(Date.now()), p_payment_date: null, p_idem: randomUUID(),
  });
  await as('operator', 'api_settlement_submit_review', { p_batch: s3.id, p_expected_version: s3.version });
  // pending reversal request (office will see it in 対応待ち)
  await as('owner', 'api_reversal_request', { p_redemption: rPending.receipt.redemptionId, p_reason: '練習: お客様から取消の申し出', p_idem: randomUUID() });

  // ---- Paper reports: one verified (settled & approved), one submitted (awaiting check)
  const jstToday = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const jstMinus2 = new Date(Date.now() + 9 * 3600_000 - 2 * DAY).toISOString().slice(0, 10);
  const photo1 = await attachment('owner', TENANT_A, SHOP_A1, 'paper_report', '#C59B44');
  const pr1 = await as('owner', 'api_paper_report_save', { p_id: null, p_shop: SHOP_A1, p_campaign: cPaper, p_received_date: jstMinus2, p_counts: { '500': 1, '1000': 1 }, p_photo_ids: [photo1], p_bundle_ref: 'P-0001', p_expected_version: null, p_idem: randomUUID() }, false);
  const pr1s = await as('owner', 'api_paper_report_submit', { p_id: pr1.id, p_expected_version: pr1.version }, false);
  await as('operator', 'api_paper_report_review', { p_id: pr1.id, p_action: 'verify', p_verified_amount: 1500, p_reason: '', p_original_present: true, p_original_storage: '事務局金庫A', p_original_return_status: '保管中', p_expected_version: pr1s.version });
  const pr2 = await as('owner', 'api_paper_report_save', { p_id: null, p_shop: SHOP_A2, p_campaign: cPaper, p_received_date: jstToday, p_counts: { '500': 2, '1000': 1 }, p_photo_ids: [], p_bundle_ref: 'P-0002', p_expected_version: null, p_idem: randomUUID() }, false);
  await as('owner', 'api_paper_report_submit', { p_id: pr2.id, p_expected_version: pr2.version }, false);
  const ps = new Date(`${new Date(Date.now() + 9 * 3600_000 - 3 * DAY).toISOString().slice(0, 10)}T00:00:00+09:00`).toISOString();
  const pe = new Date(`${jstToday}T00:00:00+09:00`).toISOString();
  const s2 = await as('operator', 'api_settlement_generate', { p_campaign: cPaper, p_month: null, p_period_start: ps, p_period_end: pe, p_payment_date: null, p_idem: randomUUID() });
  await as('operator', 'api_settlement_submit_review', { p_batch: s2.id, p_expected_version: s2.version });
  const s2r = await as('approver', 'api_settlement_get', { p_batch: s2.id });
  await as('approver', 'api_settlement_approve', { p_batch: s2.id, p_expected_version: s2r.version, p_approve: true, p_note: '' });

  // ---- External records (committed import with two normal rows)
  const extRows = [
    { row: 1, provider: 'DEMO_PROVIDER', provider_transaction_id: 'DEMO-TX-0001', shop_external_code: 'SHOP-DEMO-01', amount_jpy: 500, occurred_at: iso(now - 3600_000), status: 'confirmed', original_transaction_id: '' },
    { row: 2, provider: 'DEMO_PROVIDER', provider_transaction_id: 'DEMO-TX-0002', shop_external_code: 'SHOP-DEMO-01', amount_jpy: 1000, occurred_at: iso(now - 1800_000), status: 'confirmed', original_transaction_id: '' },
  ];
  const imp = await as('operator', 'api_external_import_stage', { p_campaign: cExt, p_source_name: 'DEMO提供元（練習）', p_file_name: 'demo_external.csv', p_file_hash: createHmac('sha256', 'ext').update('1').digest('hex'), p_rows: extRows });
  await as('operator', 'api_external_import_commit', { p_import: imp.id });

  // ---- Tasks
  const task = async (type: string, title: string, body: string, def: unknown, dueDays: number | null, shops: string[]) => {
    const t = await as('operator', 'api_task_save_draft', {
      p_tenant: TENANT_A, p_id: null, p_type: type, p_title: title, p_body: body, p_definition: def,
      p_due_at: dueDays === null ? null : iso(now + dueDays * DAY), p_shop_ids: shops, p_expected_version: null, p_idem: randomUUID(),
    });
    await as('operator', 'api_task_publish', { p_task: t.id, p_expected_version: t.version });
    return t.id as string;
  };
  const tNotice = await task('notice', '年末の防犯パトロールのお知らせ（練習）', '12月の第2土曜日に防犯パトロールを行います。参加の有無は不要です。内容をご確認ください。', { questions: [] }, 14, [SHOP_A1, SHOP_A2]);
  await as('owner', 'api_task_acknowledge', { p_task: tNotice, p_shop: SHOP_A2 }, false);
  const tEvent = await task('event', '秋まつり出店の出欠（練習）', '秋まつりの出店について、参加の有無を教えてください。', {
    questions: [
      { id: 'attend', label: '参加しますか', kind: 'choice', required: true, options: ['参加', '不参加', '未定'] },
      { id: 'people', label: '参加人数', kind: 'number' },
      { id: 'note', label: '補足', kind: 'text' },
    ],
  }, 5, [SHOP_A1, SHOP_A2]);
  await as('staff', 'api_task_respond', { p_task: tEvent, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { attend: '参加', people: 2 }, p_idem: randomUUID() }, false);
  await task('closure', '年末年始の休業日（練習）', '年末年始に休業する日を届けてください。', {
    questions: [{ id: 'dates', label: '休業する日', kind: 'dates', required: true }, { id: 'note', label: '理由・補足', kind: 'text' }],
  }, 10, [SHOP_A1, SHOP_A2]);
  const tPhoto = await task('photo', 'ポスター掲示の写真（練習）', '配布したポスターを掲示した様子を撮影して提出してください。', {
    questions: [{ id: 'photos', label: '掲示の写真（3枚まで）', kind: 'photos', required: true }, { id: 'note', label: '補足', kind: 'text' }],
  }, 7, [SHOP_A1, SHOP_A2]);
  const ph = await attachment('staff', TENANT_A, SHOP_A1, 'task_response', '#264D3C');
  await as('staff', 'api_task_respond', { p_task: tPhoto, p_shop: SHOP_A1, p_expected_revision: 0, p_payload: { photos: [ph] }, p_idem: randomUUID() }, false);
  await as('operator', 'api_task_review', { p_task: tPhoto, p_shop: SHOP_A1, p_revision: 1, p_approve: false, p_note: 'ポスター全体が写るように撮り直してください（練習）' });
  await task('shop_change', '店舗情報の確認（練習）', '店名・住所・電話番号に変更があれば申請してください。', {
    questions: [
      { id: 'display_name', label: '新しい店名', kind: 'text' },
      { id: 'address', label: '新しい住所', kind: 'text' },
      { id: 'contact_phone', label: '新しい電話番号', kind: 'text' },
      { id: 'note', label: '変更の理由', kind: 'text' },
    ],
  }, 14, [SHOP_A1, SHOP_A2]);
  const tb = await as('boperator', 'api_task_save_draft', {
    p_tenant: TENANT_B, p_id: null, p_type: 'notice', p_title: 'あおば通り会の回覧（練習）', p_body: '別組織の回覧です。', p_definition: { questions: [] },
    p_due_at: iso(now + 7 * DAY), p_shop_ids: [SHOP_B1], p_expected_version: null, p_idem: randomUUID(),
  });
  await as('boperator', 'api_task_publish', { p_task: tb.id, p_expected_version: tb.version });

  // ---- Requests (相談)
  const req = (k: UserKey, shop: string, category: string, subject: string, body: string) =>
    as(k, 'api_request_create', { p_shop: shop, p_category: category, p_subject: subject, p_body: body, p_attachment_ids: [], p_related_receipt: '', p_related_request: null, p_idem: randomUUID() }, false);
  await req('staff', SHOP_A1, 'voucher_payment', '入金予定日を知りたい（練習）', '今月分の地域券の入金予定日を教えてください。');
  const q2 = await req('staff', SHOP_A1, 'facility_cleaning', '街灯が切れています（練習）', '店の前の街灯が昨夜から消えています。');
  await as('operator', 'api_request_message', { p_req: q2.id, p_body: 'ご連絡ありがとうございます。業者に確認します。', p_attachment_ids: [], p_internal: false, p_idem: randomUUID() });
  await as('operator', 'api_request_message', { p_req: q2.id, p_body: '【内部メモ】ひなた電設に手配済み。費用は街路灯会計（練習）', p_attachment_ids: [], p_internal: true, p_idem: randomUUID() });
  const q3 = await req('owner', SHOP_A2, 'other', '共同チラシの原稿について（練習）', '共同チラシに載せる写真はいつまでに送ればよいですか。');
  const q3d = await as('operator', 'api_request_get', { p_req: q3.id });
  await as('operator', 'api_request_message', { p_req: q3.id, p_body: '掲載したい写真を3枚までお送りください。', p_attachment_ids: [], p_internal: false, p_idem: randomUUID() });
  const q3e = await as('operator', 'api_request_get', { p_req: q3.id });
  await as('operator', 'api_request_update', { p_req: q3.id, p_expected_version: q3e.version, p_status: 'awaiting_shop', p_assigned_to: USERS.operator.id, p_resolution_note: '' });
  void q3d;
  const q4 = await req('staff', SHOP_A1, 'other', 'ゴミ収集日の確認（練習）', '年末のゴミ収集日を教えてください。');
  const q4d = await as('operator', 'api_request_get', { p_req: q4.id });
  await as('operator', 'api_request_update', { p_req: q4.id, p_expected_version: q4d.version, p_status: 'resolved', p_assigned_to: USERS.operator.id, p_resolution_note: '回覧で収集日を案内済み（練習）' });
  await req('bstaff', SHOP_B1, 'other', 'あおば通り会への相談（練習）', '別組織の相談です。');

  // ---- Printable DEMO sheet (local only, gitignored)
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/demo-coupons.json', JSON.stringify(printable, null, 2));
  const cells = await Promise.all(
    printable.map(async (c) => {
      const svg = await QRCode.toString(qrText(c.token), { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
      return `<figure><div class="qr">${svg}</div><figcaption><b>${c.faceValue.toLocaleString('ja-JP')}円</b> ${c.displayNumber}<br>${c.campaign} / ${c.note}<br><code>${formatTokenForPrint(c.token)}</code></figcaption></figure>`;
    }),
  );
  writeFileSync(
    'tmp/demo-coupons.html',
    `<!doctype html><meta charset="utf-8"><title>DEMO券（練習用・換金不可）</title><style>body{font-family:sans-serif}figure{display:inline-block;width:200px;margin:8px;border:1px dashed #999;padding:8px;font-size:11px;vertical-align:top}.qr svg{width:160px;height:160px}h1{color:#A03428}</style><h1>練習用・換金不可（DEMOの架空券）</h1>${cells.join('')}`,
  );
  console.log(`DEMO seed complete: ${printable.length} coupons. Printable sheet: tmp/demo-coupons.html`);
}

main()
  .then(() => p.end())
  .catch(async (e) => {
    console.error(e);
    await p.end();
    process.exit(1);
  });

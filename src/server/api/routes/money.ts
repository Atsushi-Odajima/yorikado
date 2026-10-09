import 'server-only';
import { z } from 'zod';
import { decrypt, encrypt, sha256Hex } from '@/domain/identity/crypto';
import { BankInput, maskedLabel } from '@/domain/settlements/bank';
import { buildWorklistCsv, parseBankResultsCsv, type BankPayload } from '@/domain/settlements/csv';
import { CsvFileError, parseExternalCsv, EXTERNAL_COLUMNS } from '@/domain/vouchers/externalCsv';
import { adminDb, rpc } from '@/server/db/supabase';
import { env } from '@/server/env';
import { AppError } from '@/server/errors';
import { parse, requireIdempotencyKey, UUID, type Ctx, type Route } from '../router';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付の形式が不正です');

async function readUpload(ctx: Ctx, maxBytes: number): Promise<{ bytes: Uint8Array; name: string; fields: FormData }> {
  const len = Number(ctx.req.headers.get('content-length') ?? '0');
  if (len > maxBytes + 64 * 1024) throw new AppError('VALIDATION', 'ファイルは10MBまでです');
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    throw new AppError('VALIDATION', 'ファイルを読み取れませんでした');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('VALIDATION', 'ファイルを選んでください', { fieldErrors: { file: '必須' } });
  if (file.size > maxBytes) throw new AppError('VALIDATION', 'ファイルは10MBまでです');
  return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name.slice(0, 200), fields: form };
}

export const moneyRoutes: Route[] = [
  // ---------------------------------------------------------------- paper reports
  {
    method: 'GET',
    path: '/paper-reports',
    auth: 'user',
    handler: async (ctx) => {
      let q = ctx.db
        .from('paper_reports')
        .select('id, campaign_id, shop_id, received_date, denomination_counts, claimed_amount, verified_amount, status, original_bundle_ref, return_reason, submitted_at, version, created_at, campaigns(name), shops(display_name)')
        .order('created_at', { ascending: false })
        .limit(100);
      const shopId = ctx.query.get('shopId');
      const campaignId = ctx.query.get('campaignId');
      if (shopId) q = q.eq('shop_id', parse(UUID, shopId));
      if (campaignId) q = q.eq('campaign_id', parse(UUID, campaignId));
      if (!shopId && !campaignId) throw new AppError('VALIDATION', 'shopId または campaignId が必要です');
      const { data, error } = await q;
      if (error) throw new AppError('INTERNAL');
      return data;
    },
  },
  {
    method: 'GET',
    path: '/paper-reports/:id',
    auth: 'user',
    handler: async (ctx) => {
      const { data } = await ctx.db
        .from('paper_reports')
        .select('*, campaigns(name, denominations), shops(display_name)')
        .eq('id', parse(UUID, ctx.params.id))
        .maybeSingle();
      if (!data) throw new AppError('NOT_FOUND');
      return data;
    },
  },
  {
    method: 'POST',
    path: '/paper-reports',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({
          id: UUID.nullable().default(null),
          shopId: UUID,
          campaignId: UUID,
          receivedDate: DateStr,
          counts: z.record(z.string().regex(/^\d{1,6}$/), z.number().int().min(0).max(99999)),
          photoIds: z.array(UUID).max(3).default([]),
          bundleRef: z.string().trim().max(60).default(''),
          expectedVersion: z.number().int().nullable().default(null),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_paper_report_save', {
        p_id: b.id,
        p_shop: b.shopId,
        p_campaign: b.campaignId,
        p_received_date: b.receivedDate,
        p_counts: b.counts,
        p_photo_ids: b.photoIds,
        p_bundle_ref: b.bundleRef,
        p_expected_version: b.expectedVersion,
        p_idem: b.id ? null : requireIdempotencyKey(ctx),
      });
    },
  },
  {
    method: 'POST',
    path: '/paper-reports/:id/submit',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ expectedVersion: z.number().int() }), await ctx.json());
      return rpc(ctx.db, 'api_paper_report_submit', { p_id: parse(UUID, ctx.params.id), p_expected_version: b.expectedVersion });
    },
  },
  {
    method: 'POST',
    path: '/paper-reports/:id/review',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({
          action: z.enum(['verify', 'return', 'reject']),
          verifiedAmount: z.number().int().min(0).max(1_000_000).nullable().default(null),
          reason: z.string().max(500).default(''),
          originalPresent: z.boolean().nullable().default(null),
          originalStorage: z.string().max(200).default(''),
          originalReturnStatus: z.string().max(200).default(''),
          expectedVersion: z.number().int(),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_paper_report_review', {
        p_id: parse(UUID, ctx.params.id),
        p_action: b.action,
        p_verified_amount: b.verifiedAmount,
        p_reason: b.reason,
        p_original_present: b.originalPresent,
        p_original_storage: b.originalStorage,
        p_original_return_status: b.originalReturnStatus,
        p_expected_version: b.expectedVersion,
      });
    },
  },
  // ---------------------------------------------------------------- external CSV records
  {
    method: 'POST',
    path: '/imports/external',
    auth: 'user',
    maxBody: 11 * 1024 * 1024,
    handler: async (ctx) => {
      const { bytes, name, fields } = await readUpload(ctx, 10 * 1024 * 1024);
      const campaignId = parse(UUID, fields.get('campaignId'));
      const sourceName = parse(z.string().trim().min(1, '提供元名を入力してください').max(100), fields.get('sourceName'));
      let mapping: Record<string, string> = {};
      const rawMap = fields.get('mapping');
      if (typeof rawMap === 'string' && rawMap) {
        mapping = parse(z.record(z.enum(EXTERNAL_COLUMNS), z.string().max(100)), JSON.parse(rawMap));
      }
      let rows;
      try {
        rows = parseExternalCsv(bytes, mapping);
      } catch (e) {
        if (e instanceof CsvFileError) throw new AppError('VALIDATION', e.message, { reason: e.code });
        throw e;
      }
      return rpc(ctx.db, 'api_external_import_stage', {
        p_campaign: campaignId,
        p_source_name: sourceName,
        p_file_name: name,
        p_file_hash: sha256Hex(Buffer.from(bytes)),
        p_rows: rows,
      });
    },
  },
  {
    method: 'GET',
    path: '/imports/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_external_import_get', { p_import: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/imports/:id/map-shop',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ code: z.string().min(1).max(40), shopId: UUID }), await ctx.json());
      return rpc(ctx.db, 'api_external_import_map_shop', { p_import: parse(UUID, ctx.params.id), p_code: b.code, p_shop: b.shopId });
    },
  },
  {
    method: 'POST',
    path: '/imports/:id/commit',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_external_import_commit', { p_import: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/imports/:id/reject',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_external_import_reject', { p_import: parse(UUID, ctx.params.id) }),
  },
  // ---------------------------------------------------------------- settlements
  {
    method: 'GET',
    path: '/settlements',
    auth: 'user',
    handler: async (ctx) => {
      const shopId = ctx.query.get('shopId');
      if (shopId) return rpc(ctx.db, 'api_settlements_for_shop', { p_shop: parse(UUID, shopId) });
      const tenantId = parse(UUID, ctx.query.get('tenantId'));
      const { data, error } = await ctx.db
        .from('settlement_batches')
        .select('id, batch_number, campaign_id, period_start, period_end, status, total_amount, prepared_by, approved_by, scheduled_payment_date, export_count, created_at, campaigns(name, mode)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new AppError('INTERNAL');
      return data;
    },
  },
  {
    method: 'POST',
    path: '/settlements/generate',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const b = parse(
        z.object({
          campaignId: UUID,
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().default(null),
          periodStart: z.string().datetime({ offset: true }).nullable().default(null),
          periodEnd: z.string().datetime({ offset: true }).nullable().default(null),
          paymentDate: DateStr.nullable().default(null),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_settlement_generate', {
        p_campaign: b.campaignId,
        p_month: b.month,
        p_period_start: b.periodStart,
        p_period_end: b.periodEnd,
        p_payment_date: b.paymentDate,
        p_idem: key,
      });
    },
  },
  {
    method: 'GET',
    path: '/settlements/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_settlement_get', { p_batch: parse(UUID, ctx.params.id) }),
  },
  ...(['submit-review', 'recalculate', 'discard'] as const).map(
    (action): Route => ({
      method: 'POST',
      path: `/settlements/:id/${action}`,
      auth: 'user',
      handler: async (ctx) => {
        const b = parse(z.object({ expectedVersion: z.number().int() }), await ctx.json());
        const fn = { 'submit-review': 'api_settlement_submit_review', recalculate: 'api_settlement_recalculate', discard: 'api_settlement_discard' }[action];
        return rpc(ctx.db, fn, { p_batch: parse(UUID, ctx.params.id), p_expected_version: b.expectedVersion });
      },
    }),
  ),
  {
    method: 'POST',
    path: '/settlements/:id/approve',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ expectedVersion: z.number().int(), approve: z.boolean(), note: z.string().max(500).default('') }), await ctx.json());
      return rpc(ctx.db, 'api_settlement_approve', { p_batch: parse(UUID, ctx.params.id), p_expected_version: b.expectedVersion, p_approve: b.approve, p_note: b.note });
    },
  },
  {
    method: 'POST',
    path: '/settlements/:id/export-worklist',
    auth: 'user',
    handler: async (ctx) => {
      const id = parse(UUID, ctx.params.id);
      const exp = await rpc<{
        batchNumber: number;
        hash: string;
        reexport: boolean;
        exportCount: number;
        lines: { lineId: string; shopName: string; netAmount: number; expectedDate: string | null }[];
      }>(ctx.db, 'api_settlement_export', { p_batch: id });
      const payloads = await rpc<{ lineId: string; payload: string }[]>(adminDb(), 'svc_settlement_bank_payloads', { p_batch: id });
      const byLine = new Map(payloads.map((p) => [p.lineId, p.payload]));
      const csv = buildWorklistCsv(
        exp,
        exp.lines.map((l) => {
          const enc = byLine.get(l.lineId);
          const bank = enc ? (JSON.parse(decrypt(env().exportKeys, 'bank-account', enc).toString('utf8')) as BankPayload) : null;
          return { ...l, bank };
        }),
      );
      const fname = `worklist_${exp.batchNumber}_${exp.reexport ? 'reexport' + exp.exportCount : 'first'}.csv`;
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fname}"`,
          'Cache-Control': 'no-store',
          'X-Request-Id': ctx.requestId,
        },
      });
    },
  },
  {
    method: 'POST',
    path: '/settlements/:id/import-bank-results',
    auth: 'user',
    maxBody: 11 * 1024 * 1024,
    handler: async (ctx) => {
      const id = parse(UUID, ctx.params.id);
      const { bytes, name } = await readUpload(ctx, 10 * 1024 * 1024);
      let rows;
      try {
        rows = parseBankResultsCsv(bytes);
      } catch (e) {
        if (e instanceof CsvFileError) throw new AppError('VALIDATION', e.message, { reason: e.code });
        throw e;
      }
      const hash = sha256Hex(Buffer.from(bytes));
      const rawPath = `${id}/${hash}.csv`;
      await adminDb().storage.from('bank-results').upload(rawPath, Buffer.from(bytes), { contentType: 'text/csv', upsert: true });
      return rpc(ctx.db, 'api_bank_results_stage', { p_batch: id, p_file_name: name, p_file_hash: hash, p_raw_path: rawPath, p_rows: rows });
    },
  },
  {
    method: 'POST',
    path: '/settlements/:id/confirm-bank-results',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ importId: UUID }), await ctx.json());
      return rpc(ctx.db, 'api_bank_results_confirm', { p_import: b.importId });
    },
  },
  {
    method: 'POST',
    path: '/settlement-lines/:id/resolve',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ note: z.string().trim().min(1, '判断内容を記録してください').max(1000) }), await ctx.json());
      return rpc(ctx.db, 'api_settlement_line_resolve', { p_line: parse(UUID, ctx.params.id), p_note: b.note });
    },
  },
  {
    method: 'POST',
    path: '/settlement-lines/:id/declare',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_settlement_line_declare', { p_line: parse(UUID, ctx.params.id) }),
  },
  // ---------------------------------------------------------------- bank account change
  {
    method: 'POST',
    path: '/bank-change-requests',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const raw = (await ctx.json()) as Record<string, unknown>;
      const shopId = parse(UUID, raw.shopId);
      const bank = parse(BankInput, raw);
      const { label, suffix } = maskedLabel(bank);
      const ring = env().exportKeys;
      return rpc(ctx.db, 'api_bank_change_request', {
        p_shop: shopId,
        p_encrypted_payload: encrypt(ring, 'bank-account', JSON.stringify(bank)),
        p_key_version: ring.current.version,
        p_display_label: label,
        p_masked_suffix: suffix,
        p_idem: key,
      });
    },
  },
  {
    method: 'POST',
    path: '/bank-change-requests/:id/approve',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ approve: z.boolean(), note: z.string().max(500).default(''), evidenceId: UUID.nullable().default(null) }), await ctx.json());
      return rpc(ctx.db, 'api_bank_change_decide', { p_id: parse(UUID, ctx.params.id), p_approve: b.approve, p_note: b.note, p_evidence: b.evidenceId });
    },
  },
  {
    method: 'GET',
    path: '/shops/:id/bank-accounts',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_bank_accounts_for_shop', { p_shop: parse(UUID, ctx.params.id) }),
  },
];

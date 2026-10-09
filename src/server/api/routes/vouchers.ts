import 'server-only';
import { z } from 'zod';
import { decrypt, encrypt } from '@/domain/identity/crypto';
import { generateToken, normalizeTokenInput, tokenDigest, tokenDigests } from '@/domain/vouchers/token';
import { adminDb, requireUser, rpc } from '@/server/db/supabase';
import { env } from '@/server/env';
import { AppError } from '@/server/errors';
import { log } from '@/server/log';
import { enforce, hit, LIMITS } from '@/server/ratelimit';
import { parse, requireIdempotencyKey, UUID, type Route } from '../router';

const Iso = z.string().datetime({ offset: true });
const Money = z.number().int().min(1).max(1_000_000);

async function noteLookupFailure(shopId: string, tenantId: string | null) {
  try {
    const r = await hit('lookupfail:shop:' + shopId, { limit: 20, window: 600 });
    if (!r.allowed && r.hits === 21 && tenantId) {
      await rpc(adminDb(), 'svc_alert_rate_limit', { p_tenant: tenantId, p_bucket: 'lookupfail:' + shopId });
    }
  } catch (e) {
    log.warn('ratelimit.alert_failed', { error: (e as Error).message });
  }
}

export const voucherRoutes: Route[] = [
  // ---------------------------------------------------------------- merchant
  {
    method: 'GET',
    path: '/merchant/home',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_merchant_home', { p_shop: parse(UUID, ctx.query.get('shopId')) }),
  },
  {
    method: 'POST',
    path: '/receipt-drafts',
    auth: 'user',
    handler: async (ctx) => {
      const body = parse(
        z.object({ shopId: UUID, campaignId: UUID, tokens: z.array(z.string().max(200)).min(1, '券を読み取ってください').max(10, '1回に10枚までです') }),
        await ctx.json(),
      );
      const user = await requireUser(ctx.db);
      await enforce('lookup:user:' + user.id, LIMITS.voucherLookup);
      const problems: { index: number; code: string }[] = [];
      const seen = new Map<string, number>();
      const items = body.tokens.map((raw, index) => {
        const t = normalizeTokenInput(raw);
        if (!t) problems.push({ index, code: 'UNSUPPORTED' });
        else if (seen.has(t)) problems.push({ index, code: 'DUPLICATE_IN_LIST' });
        else seen.set(t, index);
        return { index, digests: t ? tokenDigests(env().couponKeys, t) : [] };
      });
      if (problems.length) {
        await noteLookupFailure(body.shopId, null);
        throw new AppError(problems.some((p) => p.code === 'DUPLICATE_IN_LIST') && problems.every((p) => p.code === 'DUPLICATE_IN_LIST') ? 'VALIDATION' : 'UNSUPPORTED',
          problems.every((p) => p.code === 'DUPLICATE_IN_LIST') ? '同じ券が2回読み取られています' : 'この地域券には対応していません',
          { items: problems });
      }
      try {
        return await rpc(ctx.db, 'api_receipt_draft_create', { p_shop: body.shopId, p_campaign: body.campaignId, p_items: items });
      } catch (e) {
        if (e instanceof AppError && ['UNSUPPORTED', 'ALREADY_USED', 'EXPIRED'].includes(e.code)) {
          const { data } = await ctx.db.from('shops').select('tenant_id').eq('id', body.shopId).maybeSingle();
          await noteLookupFailure(body.shopId, (data?.tenant_id as string) ?? null);
        }
        throw e;
      }
    },
  },
  {
    method: 'POST',
    path: '/redemptions',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const body = parse(z.object({ draftId: UUID, expectedAmount: Money }), await ctx.json());
      const user = await requireUser(ctx.db);
      await enforce('confirm:user:' + user.id, LIMITS.voucherConfirm);
      return rpc(ctx.db, 'api_redemption_confirm', { p_draft: body.draftId, p_expected_amount: body.expectedAmount, p_idem: key });
    },
  },
  {
    method: 'GET',
    path: '/operations/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_operation_get', { p_id: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'GET',
    path: '/redemptions/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_redemption_get', { p_redemption: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/redemptions/:id/reversal-requests',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const body = parse(z.object({ reason: z.string().trim().min(1, '理由を入力してください').max(500) }), await ctx.json());
      return rpc(ctx.db, 'api_reversal_request', { p_redemption: parse(UUID, ctx.params.id), p_reason: body.reason, p_idem: key });
    },
  },
  {
    method: 'GET',
    path: '/reversals/:id',
    auth: 'user',
    handler: async (ctx) => {
      const { data, error } = await ctx.db
        .from('reversals')
        .select('id, redemption_id, reason, amount, status, requested_by, approved_by, decided_at, decision_note, created_at, tenant_id')
        .eq('id', parse(UUID, ctx.params.id))
        .maybeSingle();
      if (error || !data) throw new AppError('NOT_FOUND');
      const redemption = await rpc(ctx.db, 'api_redemption_get', { p_redemption: data.redemption_id });
      return { reversal: data, redemption };
    },
  },
  {
    method: 'POST',
    path: '/reversals/:id/approve',
    auth: 'user',
    handler: async (ctx) => {
      const body = parse(z.object({ approve: z.boolean(), note: z.string().max(500).default('') }), await ctx.json());
      return rpc(ctx.db, 'api_reversal_decide', { p_reversal: parse(UUID, ctx.params.id), p_approve: body.approve, p_note: body.note });
    },
  },
  // ---------------------------------------------------------------- campaigns (office)
  {
    method: 'GET',
    path: '/campaigns',
    auth: 'user',
    handler: async (ctx) => {
      const tenantId = parse(UUID, ctx.query.get('tenantId'));
      const { data, error } = await ctx.db
        .from('campaigns')
        .select('id, name, mode, environment, status, starts_at, ends_at, denominations, rules_version, submitted_at, approved_at, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw new AppError('INTERNAL');
      return data;
    },
  },
  {
    method: 'POST',
    path: '/campaigns',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const body = parse(
        z
          .object({
            tenantId: UUID,
            name: z.string().trim().min(1).max(100),
            mode: z.enum(['owned_qr', 'paper_count', 'external_csv']),
            startsAt: Iso,
            endsAt: Iso,
            denominations: z.array(z.number().int().min(1).max(100_000)).max(3).default([]),
            rulesText: z.string().max(4000).default(''),
            issuer: z.string().max(200).default(''),
            externalServiceUrl: z.string().max(500).default(''),
            shopIds: z.array(UUID).max(500).default([]),
          })
          .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: '終了は開始より後にしてください', path: ['endsAt'] }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_campaign_create', {
        p_tenant: body.tenantId,
        p_name: body.name,
        p_mode: body.mode,
        p_starts_at: body.startsAt,
        p_ends_at: body.endsAt,
        p_denominations: body.denominations,
        p_rules_text: body.rulesText,
        p_issuer: body.issuer,
        p_shop_ids: body.shopIds,
        p_external_service_url: body.externalServiceUrl,
        p_idem: key,
      });
    },
  },
  {
    method: 'GET',
    path: '/campaigns/:id',
    auth: 'user',
    handler: async (ctx) => {
      const id = parse(UUID, ctx.params.id);
      const { data: c } = await ctx.db.from('campaigns').select('*').eq('id', id).maybeSingle();
      if (!c) throw new AppError('NOT_FOUND');
      const [shops, batches, readiness, paper, imports] = await Promise.all([
        ctx.db.from('campaign_shops').select('shop_id, status, shops(display_name, external_code)').eq('campaign_id', id),
        ctx.db
          .from('issuance_batches')
          .select('id, batch_number, denomination, count, valid_from, valid_until, status, created_by, download_expires_at, first_downloaded_at, download_count, receipt_confirmed_at, receipt_confirmed_by, approved_by, activated_at, void_reason, created_at')
          .eq('campaign_id', id)
          .order('batch_number', { ascending: false }),
        ctx.db.from('live_readiness').select('*').eq('campaign_id', id).maybeSingle(),
        ctx.db
          .from('paper_reports')
          .select('id, shop_id, received_date, claimed_amount, verified_amount, status, original_bundle_ref, submitted_at, shops(display_name)')
          .eq('campaign_id', id)
          .order('created_at', { ascending: false })
          .limit(200),
        ctx.db.from('external_imports').select('id, source_name, file_name, status, summary, created_at').eq('campaign_id', id).order('created_at', { ascending: false }),
      ]);
      return { campaign: c, shops: shops.data ?? [], batches: batches.data ?? [], readiness: readiness.data, paperReports: paper.data ?? [], imports: imports.data ?? [] };
    },
  },
  ...(['submit', 'approve', 'approve-live', 'resume', 'close'] as const).map(
    (action): Route => ({
      method: 'POST',
      path: `/campaigns/:id/${action}`,
      auth: 'user',
      handler: async (ctx) =>
        rpc(ctx.db, { submit: 'api_campaign_submit', approve: 'api_campaign_approve', 'approve-live': 'api_campaign_approve_live', resume: 'api_campaign_resume', close: 'api_campaign_close' }[action], {
          p_campaign: parse(UUID, ctx.params.id),
        }),
    }),
  ),
  {
    method: 'POST',
    path: '/campaigns/:id/suspend',
    auth: 'user',
    handler: async (ctx) => {
      const body = parse(z.object({ reason: z.string().trim().min(1, '理由を入力してください').max(300) }), await ctx.json());
      return rpc(ctx.db, 'api_campaign_suspend', { p_campaign: parse(UUID, ctx.params.id), p_reason: body.reason });
    },
  },
  {
    method: 'PUT',
    path: '/campaigns/:id/live-readiness',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({
          issuerAuthority: z.boolean(),
          rulesApproved: z.boolean(),
          securityReviewed: z.boolean(),
          pilotCompleted: z.boolean(),
          legalReviewRef: z.string().max(200),
          twoPersonApproval: z.boolean(),
          expectedVersion: z.number().int(),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_live_readiness_update', {
        p_campaign: parse(UUID, ctx.params.id),
        p_issuer_authority: b.issuerAuthority,
        p_rules_approved: b.rulesApproved,
        p_security_reviewed: b.securityReviewed,
        p_pilot_completed: b.pilotCompleted,
        p_legal_review_ref: b.legalReviewRef,
        p_two_person_approval: b.twoPersonApproval,
        p_expected_version: b.expectedVersion,
      });
    },
  },
  // ---------------------------------------------------------------- issuance
  {
    method: 'POST',
    path: '/campaigns/:id/issuance-batches',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const body = parse(
        z.object({ denomination: z.number().int().min(1).max(100_000), count: z.number().int().min(1).max(200, '1回の発行は200枚までです'), validFrom: Iso, validUntil: Iso }),
        await ctx.json(),
      );
      const ring = env().couponKeys;
      const tokens = Array.from({ length: body.count }, () => generateToken());
      const digests = tokens.map((t) => tokenDigest(ring.current.key, t));
      const created = await rpc<{ batchId: string; batchNumber: number; displayNumbers: string[]; replayed?: boolean }>(ctx.db, 'api_issuance_create', {
        p_campaign: parse(UUID, ctx.params.id),
        p_denomination: body.denomination,
        p_valid_from: body.validFrom,
        p_valid_until: body.validUntil,
        p_digests: digests,
        p_key_version: ring.current.version,
        p_idem: key,
      });
      if (created.replayed) return created;
      const path = `${created.batchId}.enc`;
      try {
        const payload = JSON.stringify({ batchId: created.batchId, coupons: created.displayNumbers.map((d, i) => ({ displayNumber: d, token: tokens[i] })) });
        const blob = Buffer.from(encrypt(env().exportKeys, 'issuance:' + created.batchId, payload), 'utf8');
        const up = await adminDb().storage.from('issuance').upload(path, blob, { contentType: 'application/octet-stream', upsert: false });
        if (up.error) throw new Error('upload failed: ' + up.error.message);
        return await rpc(ctx.db, 'api_issuance_mark_generated', { p_batch: created.batchId, p_object_path: path });
      } catch (e) {
        log.error('issuance.generate_failed', { batchId: created.batchId, error: (e as Error).message });
        await rpc(ctx.db, 'api_issuance_void', { p_batch: created.batchId, p_reason: '印刷データの作成に失敗したため自動破棄' }).catch(() => undefined);
        throw new AppError('SERVICE_UNAVAILABLE', '印刷データを作成できませんでした。券は無効のまま破棄しました。もう一度発行してください');
      }
    },
  },
  {
    method: 'POST',
    path: '/issuance-batches/:id/download',
    auth: 'user',
    handler: async (ctx) => {
      const id = parse(UUID, ctx.params.id);
      const meta = await rpc<{ objectPath: string; batchNumber: number; denomination: number; count: number; validFrom: string; validUntil: string; campaignName: string; issuer: string; environment: string }>(
        ctx.db,
        'api_issuance_download_authorize',
        { p_batch: id },
      );
      const file = await adminDb().storage.from('issuance').download(meta.objectPath);
      if (file.error || !file.data) throw new AppError('SERVICE_UNAVAILABLE', '印刷データを取得できませんでした');
      const plain = decrypt(env().exportKeys, 'issuance:' + id, Buffer.from(await file.data.arrayBuffer()).toString('utf8'));
      const parsed = JSON.parse(plain.toString('utf8')) as { coupons: { displayNumber: string; token: string }[] };
      const { objectPath: _omit, ...rest } = meta;
      void _omit;
      return { ...rest, coupons: parsed.coupons };
    },
  },
  {
    method: 'POST',
    path: '/issuance-batches/:id/confirm-receipt',
    auth: 'user',
    handler: async (ctx) => {
      const body = parse(z.object({ counted: z.number().int().min(0).max(200) }), await ctx.json());
      return rpc(ctx.db, 'api_issuance_confirm_receipt', { p_batch: parse(UUID, ctx.params.id), p_counted: body.counted });
    },
  },
  {
    method: 'POST',
    path: '/issuance-batches/:id/activate',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_issuance_activate', { p_batch: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/issuance-batches/:id/void',
    auth: 'user',
    handler: async (ctx) => {
      const body = parse(z.object({ reason: z.string().trim().min(1, '理由を入力してください').max(300) }), await ctx.json());
      return rpc(ctx.db, 'api_issuance_void', { p_batch: parse(UUID, ctx.params.id), p_reason: body.reason });
    },
  },
];

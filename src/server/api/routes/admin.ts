import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { encrypt, randomToken, sha256Hex } from '@/domain/identity/crypto';
import { adminDb, rpc } from '@/server/db/supabase';
import { env } from '@/server/env';
import { AppError } from '@/server/errors';
import { runJobs } from '@/server/jobs/runner';
import { parse, requireIdempotencyKey, UUID, type Ctx, type Route } from '../router';

function checkJobSecret(ctx: Ctx) {
  const auth = ctx.req.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : (ctx.req.headers.get('x-job-secret') ?? '');
  const expected = env().jobRunnerSecret;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (!given || a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('FORBIDDEN');
}

const jobHandler = async (ctx: Ctx) => {
  checkJobSecret(ctx);
  return runJobs({ limit: 50 });
};

export const adminRoutes: Route[] = [
  // ---------------------------------------------------------------- office overview
  {
    method: 'GET',
    path: '/office/queue',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_office_queue', { p_tenant: parse(UUID, ctx.query.get('tenantId')) }),
  },
  {
    method: 'GET',
    path: '/office/members',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_office_members', { p_tenant: parse(UUID, ctx.query.get('tenantId')) }),
  },
  {
    method: 'GET',
    path: '/tenants/:id',
    auth: 'user',
    handler: async (ctx) => {
      const { data } = await ctx.db.from('tenants').select('*').eq('id', parse(UUID, ctx.params.id)).maybeSingle();
      if (!data) throw new AppError('NOT_FOUND');
      return data;
    },
  },
  {
    method: 'PUT',
    path: '/tenants/:id/settings',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({
          expectedVersion: z.number().int(),
          contact: z.string().max(300),
          officeHours: z.string().max(300),
          replyGuidance: z.string().max(300),
          emailNotifications: z.boolean(),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_tenant_settings_update', {
        p_tenant: parse(UUID, ctx.params.id),
        p_expected_version: b.expectedVersion,
        p_contact: b.contact,
        p_office_hours: b.officeHours,
        p_reply_guidance: b.replyGuidance,
        p_email_notifications: b.emailNotifications,
      });
    },
  },
  // ---------------------------------------------------------------- shops
  {
    method: 'GET',
    path: '/shops',
    auth: 'user',
    handler: async (ctx) => {
      const { data, error } = await ctx.db
        .from('shops')
        .select('id, display_name, legal_name, address, contact_phone, status, external_code, version')
        .eq('tenant_id', parse(UUID, ctx.query.get('tenantId')))
        .order('display_name');
      if (error) throw new AppError('INTERNAL');
      return data;
    },
  },
  {
    method: 'POST',
    path: '/shops',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const b = parse(
        z.object({
          tenantId: UUID,
          displayName: z.string().trim().min(1, '店名を入力してください').max(100),
          legalName: z.string().max(200).default(''),
          address: z.string().max(300).default(''),
          contactPhone: z.string().max(40).default(''),
          externalCode: z.string().regex(/^[A-Za-z0-9_-]{0,40}$/, '英数字・-・_ の40文字まで').default(''),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_shop_create', {
        p_tenant: b.tenantId,
        p_display_name: b.displayName,
        p_legal_name: b.legalName,
        p_address: b.address,
        p_contact_phone: b.contactPhone,
        p_external_code: b.externalCode,
        p_idem: key,
      });
    },
  },
  {
    method: 'GET',
    path: '/shops/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_shop_get', { p_shop: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'PATCH',
    path: '/shops/:id',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({
          expectedVersion: z.number().int(),
          displayName: z.string().trim().min(1).max(100),
          legalName: z.string().max(200),
          address: z.string().max(300),
          contactPhone: z.string().max(40),
          externalCode: z.string().regex(/^[A-Za-z0-9_-]{0,40}$/),
          status: z.enum(['active', 'suspended', 'closed']),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_shop_update', {
        p_shop: parse(UUID, ctx.params.id),
        p_expected_version: b.expectedVersion,
        p_display_name: b.displayName,
        p_legal_name: b.legalName,
        p_address: b.address,
        p_contact_phone: b.contactPhone,
        p_external_code: b.externalCode,
        p_status: b.status,
      });
    },
  },
  // ---------------------------------------------------------------- invitations & memberships
  {
    method: 'POST',
    path: '/invitations',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const b = parse(
        z.object({
          tenantId: UUID,
          email: z.string().trim().toLowerCase().email('メールアドレスの形式を確認してください').max(254),
          role: z.enum(['shop_staff', 'shop_owner', 'office_operator', 'office_approver', 'tenant_admin', 'auditor']),
          shopId: UUID.nullable().default(null),
        }),
        await ctx.json(),
      );
      const token = randomToken(32);
      return rpc(ctx.db, 'api_invitation_create', {
        p_tenant: b.tenantId,
        p_email: b.email,
        p_role: b.role,
        p_shop: b.shopId,
        p_token_digest: sha256Hex(token),
        p_token_enc: encrypt(env().exportKeys, 'invitation', token),
        p_idem: key,
      });
    },
  },
  {
    method: 'POST',
    path: '/invitations/:id/revoke',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_invitation_revoke', { p_id: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/memberships',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({ tenantId: UUID, userId: UUID, role: z.enum(['office_operator', 'office_approver', 'tenant_admin', 'auditor']), status: z.enum(['active', 'revoked']) }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_membership_set', { p_tenant: b.tenantId, p_user: b.userId, p_role: b.role, p_status: b.status });
    },
  },
  {
    method: 'POST',
    path: '/shop-memberships',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ shopId: UUID, userId: UUID, role: z.enum(['shop_staff', 'shop_owner']), status: z.literal('revoked') }), await ctx.json());
      return rpc(ctx.db, 'api_shop_membership_set', { p_shop: b.shopId, p_user: b.userId, p_role: b.role, p_status: b.status });
    },
  },
  // ---------------------------------------------------------------- audit & export
  {
    method: 'GET',
    path: '/audit',
    auth: 'user',
    handler: async (ctx) => {
      const before = ctx.query.get('before');
      return rpc(ctx.db, 'api_audit_list', {
        p_tenant: parse(UUID, ctx.query.get('tenantId')),
        p_before: before ? parse(z.string().datetime({ offset: true }), before) : null,
        p_limit: 100,
      });
    },
  },
  {
    method: 'POST',
    path: '/exports/tenant',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ tenantId: UUID }), await ctx.json());
      return rpc(ctx.db, 'api_export_request', { p_tenant: b.tenantId });
    },
  },
  {
    method: 'GET',
    path: '/exports',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_exports_list', { p_tenant: parse(UUID, ctx.query.get('tenantId')) }),
  },
  {
    method: 'GET',
    path: '/exports/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_export_get', { p_id: parse(UUID, ctx.params.id), p_for_download: false }),
  },
  {
    method: 'POST',
    path: '/exports/:id/download',
    auth: 'user',
    handler: async (ctx) => {
      const e = await rpc<{ objectPath: string }>(ctx.db, 'api_export_get', { p_id: parse(UUID, ctx.params.id), p_for_download: true });
      const signed = await adminDb().storage.from('exports').createSignedUrl(e.objectPath, 60, { download: true });
      if (signed.error || !signed.data) throw new AppError('SERVICE_UNAVAILABLE');
      return { url: signed.data.signedUrl, expiresInSeconds: 60 };
    },
  },
  // ---------------------------------------------------------------- notifications & history
  {
    method: 'GET',
    path: '/notifications',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_notifications_list', { p_limit: 30 }),
  },
  {
    method: 'POST',
    path: '/notifications/:id/read',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_notification_read', { p_id: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'GET',
    path: '/history',
    auth: 'user',
    handler: async (ctx) => {
      const before = ctx.query.get('before');
      return rpc(ctx.db, 'api_history_for_shop', {
        p_shop: parse(UUID, ctx.query.get('shopId')),
        p_kind: parse(z.enum(['all', 'voucher', 'task', 'request']), ctx.query.get('kind') ?? 'all'),
        p_before: before ? parse(z.string().datetime({ offset: true }), before) : null,
        p_limit: 50,
      });
    },
  },
  // ---------------------------------------------------------------- jobs (cron secret only)
  { method: 'POST', path: '/internal/jobs/run', auth: 'job', handler: jobHandler },
  { method: 'GET', path: '/internal/jobs/run', auth: 'job', handler: jobHandler },
];

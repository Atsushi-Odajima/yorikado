import 'server-only';
import { z } from 'zod';
import { AttachmentPurpose, isAllowedImageType } from '@/domain/requests/attachments';
import { RequestCategory } from '@/domain/requests/categories';
import { TaskType } from '@/domain/tasks/templates';
import { adminDb, requireUser, rpc } from '@/server/db/supabase';
import { AppError } from '@/server/errors';
import { finalizeImage } from '@/server/storage/images';
import { parse, requireIdempotencyKey, UUID, type Route } from '../router';

const Payload = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), z.unknown());

export const workRoutes: Route[] = [
  // ---------------------------------------------------------------- tasks (merchant)
  {
    method: 'GET',
    path: '/tasks',
    auth: 'user',
    handler: async (ctx) => {
      const shopId = ctx.query.get('shopId');
      if (shopId) return rpc(ctx.db, 'api_tasks_for_shop', { p_shop: parse(UUID, shopId) });
      return rpc(ctx.db, 'api_tasks_office_list', { p_tenant: parse(UUID, ctx.query.get('tenantId')) });
    },
  },
  {
    method: 'GET',
    path: '/tasks/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_task_for_shop', { p_task: parse(UUID, ctx.params.id), p_shop: parse(UUID, ctx.query.get('shopId')) }),
  },
  {
    method: 'POST',
    path: '/tasks/:id/responses',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const b = parse(z.object({ shopId: UUID, expectedRevision: z.number().int().min(0), payload: Payload }), await ctx.json());
      return rpc(ctx.db, 'api_task_respond', { p_task: parse(UUID, ctx.params.id), p_shop: b.shopId, p_expected_revision: b.expectedRevision, p_payload: b.payload, p_idem: key });
    },
  },
  {
    method: 'POST',
    path: '/tasks/:id/acknowledge',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ shopId: UUID }), await ctx.json());
      return rpc(ctx.db, 'api_task_acknowledge', { p_task: parse(UUID, ctx.params.id), p_shop: b.shopId });
    },
  },
  // ---------------------------------------------------------------- tasks (office)
  {
    method: 'GET',
    path: '/office/tasks/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_task_office_get', { p_task: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/office/tasks',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({
          tenantId: UUID,
          id: UUID.nullable().default(null),
          type: TaskType,
          title: z.string().trim().min(1, '件名を入力してください').max(120),
          body: z.string().max(4000).default(''),
          definition: z.object({ questions: z.array(z.record(z.string(), z.unknown())).max(5, '質問は5項目までです') }),
          dueAt: z.string().datetime({ offset: true }).nullable().default(null),
          shopIds: z.array(UUID).max(500),
          expectedVersion: z.number().int().nullable().default(null),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_task_save_draft', {
        p_tenant: b.tenantId,
        p_id: b.id,
        p_type: b.type,
        p_title: b.title,
        p_body: b.body,
        p_definition: b.definition,
        p_due_at: b.dueAt,
        p_shop_ids: b.shopIds,
        p_expected_version: b.expectedVersion,
        p_idem: b.id ? null : requireIdempotencyKey(ctx),
      });
    },
  },
  {
    method: 'POST',
    path: '/office/tasks/:id/publish',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ expectedVersion: z.number().int() }), await ctx.json());
      return rpc(ctx.db, 'api_task_publish', { p_task: parse(UUID, ctx.params.id), p_expected_version: b.expectedVersion });
    },
  },
  {
    method: 'POST',
    path: '/office/tasks/:id/close',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_task_close', { p_task: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/office/tasks/:id/remind',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_task_remind', { p_task: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/office/tasks/:id/revise',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_task_revise', { p_task: parse(UUID, ctx.params.id), p_idem: requireIdempotencyKey(ctx) }),
  },
  {
    method: 'POST',
    path: '/office/tasks/:id/extend',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ dueAt: z.string().datetime({ offset: true }) }), await ctx.json());
      return rpc(ctx.db, 'api_task_extend', { p_task: parse(UUID, ctx.params.id), p_due_at: b.dueAt });
    },
  },
  {
    method: 'POST',
    path: '/office/tasks/:id/proxy-response',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const b = parse(
        z.object({
          shopId: UUID,
          expectedRevision: z.number().int().min(0),
          payload: Payload.default({}),
          proxyReason: z.string().trim().min(1, '代理入力の理由を入力してください').max(300),
          proxyChannel: z.enum(['phone', 'paper', 'in_person', 'other']),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_task_proxy_respond', {
        p_task: parse(UUID, ctx.params.id),
        p_shop: b.shopId,
        p_expected_revision: b.expectedRevision,
        p_payload: b.payload,
        p_proxy_reason: b.proxyReason,
        p_proxy_channel: b.proxyChannel,
        p_idem: key,
      });
    },
  },
  {
    method: 'POST',
    path: '/office/tasks/:id/review',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(z.object({ shopId: UUID, revision: z.number().int().min(1), approve: z.boolean(), note: z.string().max(500).default('') }), await ctx.json());
      return rpc(ctx.db, 'api_task_review', { p_task: parse(UUID, ctx.params.id), p_shop: b.shopId, p_revision: b.revision, p_approve: b.approve, p_note: b.note });
    },
  },
  // ---------------------------------------------------------------- requests
  {
    method: 'GET',
    path: '/requests',
    auth: 'user',
    handler: async (ctx) => {
      let q = ctx.db
        .from('requests')
        .select('id, request_number, shop_id, category, subject, status, assigned_to, created_at, updated_at, last_shop_activity_at, version, shops(display_name)')
        .order('updated_at', { ascending: false })
        .limit(100);
      const shopId = ctx.query.get('shopId');
      const tenantId = ctx.query.get('tenantId');
      if (shopId) q = q.eq('shop_id', parse(UUID, shopId));
      else q = q.eq('tenant_id', parse(UUID, tenantId));
      const status = ctx.query.get('status');
      if (status) q = q.eq('status', parse(z.enum(['received', 'in_progress', 'awaiting_shop', 'resolved']), status));
      const { data, error } = await q;
      if (error) throw new AppError('INTERNAL');
      return data;
    },
  },
  {
    method: 'POST',
    path: '/requests',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const b = parse(
        z.object({
          shopId: UUID,
          category: RequestCategory,
          subject: z.string().max(120).default(''),
          body: z.string().trim().min(1, '内容を入力してください').max(4000),
          attachmentIds: z.array(UUID).max(3, '写真は3枚までです').default([]),
          relatedReceiptNumber: z.string().max(20).default(''),
          relatedRequestId: UUID.nullable().default(null),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_request_create', {
        p_shop: b.shopId,
        p_category: b.category,
        p_subject: b.subject,
        p_body: b.body,
        p_attachment_ids: b.attachmentIds,
        p_related_receipt: b.relatedReceiptNumber,
        p_related_request: b.relatedRequestId,
        p_idem: key,
      });
    },
  },
  {
    method: 'GET',
    path: '/requests/:id',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_request_get', { p_req: parse(UUID, ctx.params.id) }),
  },
  {
    method: 'POST',
    path: '/requests/:id/messages',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const b = parse(z.object({ body: z.string().trim().min(1, '内容を入力してください').max(4000), attachmentIds: z.array(UUID).max(3).default([]) }), await ctx.json());
      return rpc(ctx.db, 'api_request_message', { p_req: parse(UUID, ctx.params.id), p_body: b.body, p_attachment_ids: b.attachmentIds, p_internal: false, p_idem: key });
    },
  },
  {
    method: 'POST',
    path: '/office/requests/:id/internal-notes',
    auth: 'user',
    handler: async (ctx) => {
      const key = requireIdempotencyKey(ctx);
      const b = parse(z.object({ body: z.string().trim().min(1).max(4000), attachmentIds: z.array(UUID).max(3).default([]) }), await ctx.json());
      return rpc(ctx.db, 'api_request_message', { p_req: parse(UUID, ctx.params.id), p_body: b.body, p_attachment_ids: b.attachmentIds, p_internal: true, p_idem: key });
    },
  },
  {
    method: 'PATCH',
    path: '/requests/:id',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({
          expectedVersion: z.number().int(),
          status: z.enum(['received', 'in_progress', 'awaiting_shop', 'resolved']),
          assignedTo: UUID.nullable().default(null),
          resolutionNote: z.string().max(1000).default(''),
        }),
        await ctx.json(),
      );
      return rpc(ctx.db, 'api_request_update', {
        p_req: parse(UUID, ctx.params.id),
        p_expected_version: b.expectedVersion,
        p_status: b.status,
        p_assigned_to: b.assignedTo,
        p_resolution_note: b.resolutionNote,
      });
    },
  },
  // ---------------------------------------------------------------- attachments
  {
    method: 'POST',
    path: '/attachments/upload-intent',
    auth: 'user',
    handler: async (ctx) => {
      const b = parse(
        z.object({
          tenantId: UUID.nullable().default(null),
          shopId: UUID.nullable().default(null),
          purpose: AttachmentPurpose,
          contentType: z.string().max(100),
          size: z.number().int().min(1),
        }),
        await ctx.json(),
      );
      if (/heic|heif/i.test(b.contentType)) {
        throw new AppError('UNSUPPORTED', 'HEIC形式の写真は受け付けていません。カメラ設定を「互換性優先」にするか、JPEGで保存してから選んでください');
      }
      if (!isAllowedImageType(b.contentType)) throw new AppError('UNSUPPORTED', 'JPEG・PNG・WebPの写真を選んでください');
      if (b.size > 10 * 1024 * 1024) throw new AppError('VALIDATION', '写真は1枚10MBまでです');
      const intent = await rpc<{ id: string; quarantinePath: string }>(ctx.db, 'api_attachment_intent', { p_tenant: b.tenantId, p_shop: b.shopId, p_purpose: b.purpose });
      const signed = await adminDb().storage.from('attachments').createSignedUploadUrl(intent.quarantinePath);
      if (signed.error || !signed.data) throw new AppError('SERVICE_UNAVAILABLE', '写真の送信を準備できませんでした');
      return { id: intent.id, uploadUrl: signed.data.signedUrl };
    },
  },
  {
    method: 'POST',
    path: '/attachments/:id/finalize',
    auth: 'user',
    handler: async (ctx) => {
      const user = await requireUser(ctx.db);
      return finalizeImage(parse(UUID, ctx.params.id), user.id);
    },
  },
  {
    method: 'GET',
    path: '/attachments/:id/download',
    auth: 'user',
    handler: async (ctx) => {
      const a = await rpc<{ objectPath: string }>(ctx.db, 'api_attachment_authorize_download', { p_id: parse(UUID, ctx.params.id) });
      const signed = await adminDb().storage.from('attachments').createSignedUrl(a.objectPath, 60);
      if (signed.error || !signed.data) throw new AppError('SERVICE_UNAVAILABLE');
      return new Response(null, { status: 302, headers: { Location: signed.data.signedUrl, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    },
  },
];

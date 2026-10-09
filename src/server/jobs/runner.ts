import 'server-only';
import { decrypt } from '@/domain/identity/crypto';
import { adminDb, rpc } from '@/server/db/supabase';
import { env } from '@/server/env';
import { log } from '@/server/log';
import { mailAdapter } from '@/server/notifications/mail';
import { buildTenantExport } from './export';

interface OutboxRow {
  id: string;
  tenant_id: string | null;
  kind: string;
  entity_id: string | null;
  recipient_id: string | null;
  dedupe_key: string;
  payload: Record<string, unknown>;
  attempts: number;
}

type Outcome = { status: 'sent' | 'skipped'; scrub?: string[] } | { status: 'deferred' };

/** 09:00–18:00 JST window for reminders. Returns the next allowed time or null if now is fine. */
export function nextReminderWindow(now: Date): Date | null {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const h = jst.getUTCHours();
  if (h >= 9 && h < 18) return null;
  const next = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + (h >= 18 ? 1 : 0), 9, 0, 0) - 9 * 3600_000);
  return next;
}

function link(path: string): string {
  return new URL(path || '/', env().baseUrl).toString();
}

async function handle(job: OutboxRow): Promise<Outcome> {
  const admin = adminDb();
  switch (job.kind) {
    case 'notification': {
      const d = await rpc<{ email: string | null; title: string; link: string; tenantName: string }>(admin, 'svc_notification_deliver', { p_outbox: job.id });
      if (d.email) {
        await mailAdapter().send({
          to: d.email,
          subject: `[Yorikado] ${d.title}`,
          text: `${d.tenantName} からのお知らせです。\n\n${d.title}\n\n内容はアプリでご確認ください:\n${link(d.link)}\n\n※このメールは送信専用です。`,
        });
      }
      return { status: 'sent' };
    }
    case 'invite_email': {
      const enc = job.payload.tokenEnc as string | undefined;
      const to = job.payload.email as string | undefined;
      if (!enc || !to) return { status: 'skipped' };
      const token = decrypt(env().exportKeys, 'invitation', enc).toString('utf8');
      await mailAdapter().send({
        to,
        subject: '[Yorikado] 商店街の窓口への招待',
        text: `Yorikado（商店街の窓口）に招待されました。\n72時間以内に次のリンクを開いて登録してください（1回だけ使えます）。\n\n${link('/invite?token=' + encodeURIComponent(token))}\n\n心当たりがない場合はこのメールを破棄してください。`,
      });
      return { status: 'sent', scrub: ['tokenEnc'] };
    }
    case 'reminder_digest': {
      const wait = nextReminderWindow(new Date());
      if (wait) {
        await rpc(admin, 'svc_job_defer', { p_id: job.id, p_until: wait.toISOString() });
        return { status: 'deferred' };
      }
      const shopId = String(job.payload.shopId);
      const d = await rpc<{ tasks: { id: string; title: string }[]; recipients: string[]; tenantId: string }>(admin, 'svc_reminder_digest', { p_shop: shopId });
      // re-check right before sending: answered tasks are not reminded
      if (!d.tasks.length) return { status: 'skipped' };
      const title = d.tasks.length === 1 ? `返事をお願いします: ${d.tasks[0]!.title}` : `返事が必要な依頼が${d.tasks.length}件あります`;
      const rows = d.recipients.map((uid) => ({
        tenant_id: d.tenantId,
        kind: 'notification',
        entity_id: shopId,
        recipient_id: uid,
        dedupe_key: `${job.dedupe_key}:${uid}`,
        payload: { title, link: '/m/tasks', entityType: 'reminder' },
      }));
      if (rows.length) {
        const { error } = await admin.from('outbox').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
        if (error) throw new Error('reminder enqueue failed');
      }
      return { status: 'sent' };
    }
    case 'redemption_recorded': {
      // Inform shop owners (not the cashier who just saw the receipt) via in-app notification.
      const { data: r } = await admin.from('redemptions').select('id, tenant_id, shop_id, actor_id, amount, receipt_number, operation_id').eq('id', job.entity_id).maybeSingle();
      if (!r) return { status: 'skipped' };
      const { data: owners } = await admin.from('shop_memberships').select('user_id').eq('shop_id', r.shop_id).eq('role', 'shop_owner').eq('status', 'active');
      const rows = (owners ?? [])
        .filter((o) => o.user_id !== r.actor_id)
        .map((o) => ({
          tenant_id: r.tenant_id,
          recipient_id: o.user_id,
          entity_type: 'redemption',
          entity_id: r.id,
          title: `地域券 ${Number(r.amount).toLocaleString('ja-JP')}円を受け付けました（${r.receipt_number}）`,
          link: `/m/receipts/${r.operation_id}`,
          dedupe_key: `${job.dedupe_key}:${o.user_id}`,
        }));
      if (rows.length) await admin.from('notifications').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
      return { status: 'sent' };
    }
    case 'tenant_export': {
      const exportId = String(job.entity_id);
      try {
        const { zip, sha256 } = await buildTenantExport(String(job.tenant_id), Boolean(job.payload.masked));
        const path = `${job.tenant_id}/${exportId}.zip`;
        const up = await admin.storage.from('exports').upload(path, zip, { contentType: 'application/zip', upsert: true });
        if (up.error) throw new Error(up.error.message);
        await rpc(admin, 'svc_export_complete', { p_id: exportId, p_ok: true, p_path: path, p_sha256: sha256, p_error: null });
      } catch (e) {
        if (job.attempts >= 5) await rpc(admin, 'svc_export_complete', { p_id: exportId, p_ok: false, p_path: null, p_sha256: null, p_error: (e as Error).message });
        throw e;
      }
      return { status: 'sent' };
    }
    default:
      return { status: 'skipped' };
  }
}

export async function runJobs({ limit }: { limit: number }) {
  const admin = adminDb();
  const summary = { claimed: 0, sent: 0, skipped: 0, deferred: 0, retried: 0, failed: 0, reminders: 0, purged: 0 };
  summary.reminders = await rpc<number>(admin, 'svc_schedule_auto_reminders');
  const jobs = await rpc<OutboxRow[]>(admin, 'svc_jobs_claim', { p_limit: limit });
  summary.claimed = jobs.length;
  for (const job of jobs) {
    try {
      const r = await handle(job);
      if (r.status === 'deferred') {
        summary.deferred++;
        continue;
      }
      await rpc(admin, 'svc_job_complete', { p_id: job.id, p_status: r.status, p_scrub_keys: r.scrub ?? [] });
      summary[r.status]++;
    } catch (e) {
      const state = await rpc<string>(admin, 'svc_job_fail', { p_id: job.id, p_error: (e as Error).message.slice(0, 300) });
      if (state === 'failed') summary.failed++;
      else summary.retried++;
      log.warn('job.failed', { id: job.id, kind: job.kind, attempts: job.attempts, state });
    }
  }
  // Purge encrypted print data after 24h / activation / void.
  const purge = await rpc<{ id: string; path: string }[]>(admin, 'svc_issuance_objects_to_purge');
  for (const p of purge) {
    const r = await admin.storage.from('issuance').remove([p.path]);
    if (!r.error) {
      await rpc(admin, 'svc_issuance_mark_purged', { p_id: p.id });
      summary.purged++;
    }
  }
  await rpc(admin, 'svc_housekeeping');
  return summary;
}

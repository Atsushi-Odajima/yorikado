/**
 * Pre-start check. Fails (exit 1) on missing/invalid configuration or a
 * DEMO/LIVE mismatch between APP_ENV and the database marker. Never prints
 * secret values. Run before `npm start` in production.
 */
import { createClient } from '@supabase/supabase-js';
import { parseKeyRing } from '../src/domain/identity/keys';

const problems: string[] = [];
const e = process.env;
const need = ['APP_ENV', 'APP_BASE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'COUPON_HMAC_KEY', 'EXPORT_ENCRYPTION_KEY', 'JOB_RUNNER_SECRET'];
for (const n of need) if (!e[n]?.trim()) problems.push(`${n} is missing`);
for (const n of Object.keys(e)) if (n.startsWith('NEXT_PUBLIC_') && /KEY|SECRET|TOKEN/i.test(n)) problems.push(`${n}: secrets must not use NEXT_PUBLIC_`);
if (e.APP_ENV && !['demo', 'live'].includes(e.APP_ENV)) problems.push('APP_ENV must be demo or live');
try {
  parseKeyRing(e.COUPON_HMAC_KEY ?? '', e.COUPON_HMAC_KEY_VERSION, e.COUPON_HMAC_KEYS_OLD);
} catch (x) {
  problems.push('COUPON_HMAC_KEY invalid: ' + (x as Error).message);
}
try {
  parseKeyRing(e.EXPORT_ENCRYPTION_KEY ?? '', e.EXPORT_ENCRYPTION_KEY_VERSION, e.EXPORT_ENCRYPTION_KEYS_OLD);
} catch (x) {
  problems.push('EXPORT_ENCRYPTION_KEY invalid: ' + (x as Error).message);
}
if (e.COUPON_HMAC_KEY && e.COUPON_HMAC_KEY === e.EXPORT_ENCRYPTION_KEY) problems.push('COUPON_HMAC_KEY and EXPORT_ENCRYPTION_KEY must differ');
if ((e.JOB_RUNNER_SECRET ?? '').length < 32) problems.push('JOB_RUNNER_SECRET must be 32+ chars');
if (e.APP_ENV === 'live') {
  if (!e.APP_BASE_URL?.startsWith('https://')) problems.push('LIVE requires https APP_BASE_URL');
  if (e.MAIL_PROVIDER !== 'smtp') problems.push('LIVE requires MAIL_PROVIDER=smtp (contracted account)');
  if (/127\.0\.0\.1|localhost/.test(e.SUPABASE_URL ?? '')) problems.push('LIVE must not use a local Supabase');
}

async function main() {
  if (!problems.length) {
    const db = createClient(e.SUPABASE_URL!, e.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('svc_environment');
    if (error) problems.push('cannot reach database with SUPABASE_SECRET_KEY (' + (error.code ?? 'error') + ')');
    else if (!data) problems.push('database has no DEMO/LIVE marker (public.deployment_environment)');
    else if (String(data).toLowerCase() !== e.APP_ENV) problems.push(`DEMO/LIVE mismatch: APP_ENV=${e.APP_ENV} but database is ${data}`);
    if (e.APP_ENV === 'live') {
      const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if ((users?.users ?? []).some((u) => /@example\.com$/.test(u.email ?? ''))) problems.push('LIVE database contains DEMO users (@example.com)');
    }
  }
  if (problems.length) {
    console.error('verify-env FAILED:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  console.log(`verify-env OK (${e.APP_ENV})`);
}
main();

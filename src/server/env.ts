import 'server-only';
import { parseKeyRing, type KeyRing } from '@/domain/identity/keys';

/**
 * Server-only configuration. Nothing here is exposed to the browser and no
 * variable uses the NEXT_PUBLIC_ prefix. Missing values throw instead of
 * silently returning a fake success.
 */
export type AppEnv = 'demo' | 'live';

export interface ServerEnv {
  appEnv: AppEnv;
  baseUrl: URL;
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  couponKeys: KeyRing;
  exportKeys: KeyRing;
  jobRunnerSecret: string;
  mail: {
    provider: 'none' | 'sink' | 'smtp';
    from: string;
    smtp?: { host: string; port: number; user?: string; password?: string; secure: boolean };
  };
  production: boolean;
}

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing or invalid configuration: ${missing.join(', ')}`);
  }
}

let cached: ServerEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const problems: string[] = [];
  const get = (n: string) => {
    const v = source[n];
    if (!v || v.trim() === '') {
      problems.push(n);
      return '';
    }
    return v.trim();
  };
  const appEnvRaw = get('APP_ENV');
  if (appEnvRaw && appEnvRaw !== 'demo' && appEnvRaw !== 'live') problems.push('APP_ENV(demo|live)');
  const baseRaw = get('APP_BASE_URL');
  let baseUrl = new URL('http://localhost:3000');
  try {
    if (baseRaw) baseUrl = new URL(baseRaw);
  } catch {
    problems.push('APP_BASE_URL(URL)');
  }
  const production = source.NODE_ENV === 'production';
  if (appEnvRaw === 'live' && baseUrl.protocol !== 'https:') problems.push('APP_BASE_URL(LIVE requires https)');

  let couponKeys: KeyRing = { current: { version: 0, key: Buffer.alloc(0) }, all: [] };
  let exportKeys: KeyRing = couponKeys;
  try {
    couponKeys = parseKeyRing(get('COUPON_HMAC_KEY'), source.COUPON_HMAC_KEY_VERSION, source.COUPON_HMAC_KEYS_OLD);
  } catch (e) {
    problems.push(`COUPON_HMAC_KEY(${(e as Error).message})`);
  }
  try {
    exportKeys = parseKeyRing(get('EXPORT_ENCRYPTION_KEY'), source.EXPORT_ENCRYPTION_KEY_VERSION, source.EXPORT_ENCRYPTION_KEYS_OLD);
  } catch (e) {
    problems.push(`EXPORT_ENCRYPTION_KEY(${(e as Error).message})`);
  }
  const jobRunnerSecret = get('JOB_RUNNER_SECRET');
  if (jobRunnerSecret && jobRunnerSecret.length < 32) problems.push('JOB_RUNNER_SECRET(>=32 chars)');

  const provider = (source.MAIL_PROVIDER ?? 'none').trim() as ServerEnv['mail']['provider'];
  if (!['none', 'sink', 'smtp'].includes(provider)) problems.push('MAIL_PROVIDER(none|sink|smtp)');
  if (appEnvRaw === 'live' && provider === 'sink') problems.push('MAIL_PROVIDER(sink not allowed in LIVE)');
  let smtp: ServerEnv['mail']['smtp'];
  if (provider === 'smtp') {
    smtp = {
      host: get('SMTP_HOST'),
      port: Number(source.SMTP_PORT ?? '587'),
      user: source.SMTP_USER || undefined,
      password: source.SMTP_PASSWORD || undefined,
      secure: source.SMTP_SECURE === 'true',
    };
  }
  const env: ServerEnv = {
    appEnv: (appEnvRaw || 'demo') as AppEnv,
    baseUrl,
    supabaseUrl: get('SUPABASE_URL'),
    publishableKey: get('SUPABASE_PUBLISHABLE_KEY'),
    secretKey: get('SUPABASE_SECRET_KEY'),
    couponKeys,
    exportKeys,
    jobRunnerSecret,
    mail: { provider, from: source.MAIL_FROM?.trim() || 'Yorikado <no-reply@example.invalid>', smtp },
    production,
  };
  if (problems.length) throw new ConfigError(problems);
  return env;
}

export function env(): ServerEnv {
  if (!cached) cached = loadEnv();
  return cached;
}

// Exposed for tests.
export function resetEnvCache() {
  cached = null;
}


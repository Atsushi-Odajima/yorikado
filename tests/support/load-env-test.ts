import { existsSync, readFileSync } from 'node:fs';

/**
 * Integration tests read ONLY .env.test and refuse anything that is not a
 * local DEMO database (spec: test data limited to DEMO connections).
 */
if (!existsSync('.env.test')) throw new Error('.env.test is required for integration tests (copy .env.local)');
for (const line of readFileSync('.env.test', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]!] = m[2]!;
}
const local = (u?: string) => !!u && ['localhost', '127.0.0.1'].includes(new URL(u).hostname);
if (process.env.APP_ENV !== 'demo') throw new Error('integration tests require APP_ENV=demo');
if (!local(process.env.DATABASE_URL) || !local(process.env.SUPABASE_URL)) throw new Error('integration tests run only against a local DEMO database');

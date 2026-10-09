/**
 * AC21 local drill: back up the LOCAL DEMO database + attachment files, restore
 * the database into a NEW database, and compare row counts, settlement totals
 * and attachment hashes. Measures elapsed time (local RTO observation only;
 * hosted LIVE backup/PITR must be drilled separately - see docs/OPERATIONS.txt).
 *   npm run backup:check
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const env = process.env;
if (env.APP_ENV !== 'demo') throw new Error('backup:check runs only for the local DEMO');
const local = (u?: string) => !!u && ['localhost', '127.0.0.1'].includes(new URL(u).hostname);
if (!local(env.DATABASE_URL) || !local(env.SUPABASE_URL)) throw new Error('backup:check is limited to the local Supabase');
const CONTAINER = env.SUPABASE_DB_CONTAINER ?? 'supabase_db_yorikado';
const RESTORE_DB = 'yorikado_restore_check';

async function counts(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const tables = (await c.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename as string);
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await c.query(`select count(*) n from public."${t}"`)).rows[0].n);
  const totals = (await c.query(`select coalesce(sum(total_amount),0)::bigint total, coalesce((select sum(net_amount) from public.settlement_lines),0)::bigint lines,
      coalesce((select sum(signed_amount) from public.settlement_sources),0)::bigint sources from public.settlement_batches`)).rows[0];
  const atts = (await c.query(`select id, object_path, sha256 from public.attachments where scan_status = 'clean' order by id`)).rows;
  await c.end();
  return { tables: out, totals, atts };
}

async function main() {
  const t0 = Date.now();
  mkdirSync('tmp/backup', { recursive: true });
  // 1. database backup (custom format) from the local container
  const dump = execFileSync('docker', ['exec', CONTAINER, 'pg_dump', '-U', 'postgres', '-Fc', '-n', 'public', '-n', 'app', '-n', 'auth', '-n', 'storage', 'postgres'], { maxBuffer: 1 << 30 });
  writeFileSync('tmp/backup/db.dump', dump);
  // 2. attachment files backup (independent of the database)
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const source = await counts(env.DATABASE_URL!);
  const fileHashes: Record<string, string> = {};
  for (const a of source.atts) {
    const f = await admin.storage.from('attachments').download(a.object_path);
    if (f.error || !f.data) continue;
    const buf = Buffer.from(await f.data.arrayBuffer());
    writeFileSync(`tmp/backup/${a.id}`, buf);
    fileHashes[a.id] = createHash('sha256').update(buf).digest('hex');
  }
  const backupDone = Date.now();
  // 3. restore into a new database
  execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-c', `drop database if exists ${RESTORE_DB}`]);
  execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-c', `create database ${RESTORE_DB}`]);
  execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', RESTORE_DB, '-c', 'create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;']);
  const r = spawnSync('docker', ['exec', '-i', CONTAINER, 'pg_restore', '-U', 'postgres', '-d', RESTORE_DB, '--no-owner', '--no-privileges'], { input: dump, maxBuffer: 1 << 30, encoding: 'buffer' });
  // The empty target already has the platform schemas; "already exists" is expected, anything else is a failure.
  const restoreErrors = r.stderr.toString('utf8').split('\n').filter((l) => /ERROR:/.test(l) && !/already exists/.test(l));
  if (restoreErrors.length) throw new Error('restore failed:\n' + restoreErrors.slice(0, 10).join('\n'));
  const restoredUrl = env.DATABASE_URL!.replace(/\/[^/?]+(\?|$)/, `/${RESTORE_DB}$1`);
  const restored = await counts(restoredUrl);
  const restoreDone = Date.now();
  // 4. compare
  const mismatches: string[] = [];
  for (const [t, n] of Object.entries(source.tables)) if (restored.tables[t] !== n) mismatches.push(`${t}: ${n} vs ${restored.tables[t]}`);
  if (JSON.stringify(source.totals) !== JSON.stringify(restored.totals)) mismatches.push(`settlement totals ${JSON.stringify(source.totals)} vs ${JSON.stringify(restored.totals)}`);
  let hashChecked = 0;
  for (const a of restored.atts) {
    if (fileHashes[a.id] === undefined) continue;
    hashChecked++;
    if (a.sha256 !== fileHashes[a.id]) mismatches.push(`attachment ${a.id} hash mismatch`);
  }
  const result = {
    at: new Date().toISOString(),
    tables: Object.keys(source.tables).length,
    rows: Object.values(source.tables).reduce((a, b) => a + b, 0),
    settlementTotals: source.totals,
    attachmentsHashChecked: hashChecked,
    backupSeconds: (backupDone - t0) / 1000,
    restoreSeconds: (restoreDone - backupDone) / 1000,
    mismatches,
    note: 'Local DEMO drill only. Not a measurement of hosted RPO/RTO.',
  };
  writeFileSync('tmp/backup/result.json', JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-c', `drop database if exists ${RESTORE_DB}`]);
  if (mismatches.length) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

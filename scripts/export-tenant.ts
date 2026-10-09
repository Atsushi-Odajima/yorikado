/**
 * Operator CLI: export one tenant's data (JSON/CSV/attachments ZIP) with the
 * service-role key. Same builder as the in-app export. Usage:
 *   npm run export-tenant -- --tenant <uuid> --out tmp/export.zip [--masked]
 * Never includes raw coupon tokens, keys or bank ciphertext.
 */
import { writeFileSync } from 'node:fs';
import { buildTenantExport } from '../src/server/jobs/export';
import { adminDb } from '../src/server/db/supabase';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const tenant = arg('tenant');
  const out = arg('out') ?? `tmp/export_${tenant}.zip`;
  if (!tenant || !/^[0-9a-f-]{36}$/.test(tenant)) throw new Error('--tenant <uuid> is required');
  const masked = process.argv.includes('--masked');
  const { zip, sha256, counts } = await buildTenantExport(tenant, masked);
  writeFileSync(out, zip);
  await adminDb().from('audit_events').insert({ tenant_id: tenant, action: 'export.cli', entity: 'tenant', entity_id: tenant, after_summary: { masked, sha256 } });
  console.log(JSON.stringify({ out, sha256, masked, counts }, null, 1));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

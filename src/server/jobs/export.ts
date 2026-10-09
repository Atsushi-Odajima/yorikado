import 'server-only';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { sha256Hex } from '@/domain/identity/crypto';
import { toCsv } from '@/domain/settlements/csv';
import { adminDb } from '@/server/db/supabase';

/** Tables exported per tenant, with columns that must never leave the system. */
const TABLES: { name: string; omit?: string[]; maskedOmit?: string[] }[] = [
  { name: 'tenants' },
  { name: 'shops', maskedOmit: ['contact_phone'] },
  { name: 'memberships' },
  { name: 'shop_memberships' },
  { name: 'campaigns' },
  { name: 'campaign_shops' },
  { name: 'live_readiness' },
  { name: 'issuance_batches', omit: ['encrypted_object_path'] },
  { name: 'coupons', omit: ['token_digest'] },
  { name: 'operations', omit: ['request_hash'] },
  { name: 'redemptions' },
  { name: 'redemption_items' },
  { name: 'reversals' },
  { name: 'paper_reports' },
  { name: 'external_imports' },
  { name: 'external_transactions' },
  { name: 'tasks' },
  { name: 'task_recipients' },
  { name: 'responses' },
  { name: 'acknowledgements' },
  { name: 'requests' },
  { name: 'request_messages' },
  { name: 'attachments', omit: ['object_path'] },
  { name: 'bank_accounts', omit: ['encrypted_payload'] },
  { name: 'settlement_batches' },
  { name: 'settlement_lines' },
  { name: 'settlement_sources' },
  { name: 'bank_result_imports', omit: ['raw_object_path'] },
  { name: 'bank_results' },
  { name: 'audit_events' },
];

async function selectAll(table: string, tenantId: string): Promise<Record<string, unknown>[]> {
  const admin = adminDb();
  const out: Record<string, unknown>[] = [];
  const key = table === 'tenants' ? 'id' : 'tenant_id';
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').eq(key, tenantId).range(from, from + 999);
    if (error) throw new Error(`export ${table}: ${error.message}`);
    out.push(...(data as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Build a ZIP with JSON (original values) + CSV (formula-neutralised) per table
 * and clean attachments. Raw coupon tokens and encryption keys are never part
 * of the database and therefore never exported; digests/ciphertexts are omitted.
 */
export async function buildTenantExport(tenantId: string, masked: boolean): Promise<{ zip: Uint8Array; sha256: string; counts: Record<string, number> }> {
  const files: Zippable = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = (await selectAll(t.name, tenantId)).map((r) => {
      const copy = { ...r };
      for (const c of [...(t.omit ?? []), ...(masked ? (t.maskedOmit ?? []) : [])]) delete copy[c];
      return copy;
    });
    counts[t.name] = rows.length;
    files[`json/${t.name}.json`] = strToU8(JSON.stringify(rows, null, 1));
    const cols = rows.length ? Object.keys(rows[0]!) : [];
    files[`csv/${t.name}.csv`] = strToU8(toCsv([cols, ...rows.map((r) => cols.map((c) => (typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c])))]));
  }
  if (!masked) {
    const admin = adminDb();
    const atts = await selectAll('attachments', tenantId);
    for (const a of atts) {
      if (a.scan_status !== 'clean') continue;
      const f = await admin.storage.from('attachments').download(String(a.object_path));
      if (f.data) files[`attachments/${a.id}_${String(a.object_path).split('/').pop()}`] = new Uint8Array(await f.data.arrayBuffer());
    }
  }
  files['README.txt'] = strToU8(
    [
      'Yorikado tenant export',
      `tenant_id: ${tenantId}`,
      `masked: ${masked}`,
      `created_at: ${new Date().toISOString()}`,
      'json/ は原文、csv/ は表計算向け（式注入対策で先頭が = + - @ の値に \' を付与）。',
      '券の生token・暗号鍵・口座番号の暗号文は含みません。',
    ].join('\n'),
  );
  const zip = zipSync(files, { level: 6 });
  return { zip, sha256: sha256Hex(Buffer.from(zip)), counts };
}

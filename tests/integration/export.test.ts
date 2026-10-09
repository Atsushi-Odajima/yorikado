import { strFromU8, unzipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { buildTenantExport } from '@/server/jobs/export';
import { p, TENANT_A, TENANT_B } from './helpers';

afterAll(async () => p.end());

describe('AC17 tenant export', () => {
  for (const [tenant, other] of [[TENANT_A, TENANT_B], [TENANT_B, TENANT_A]] as const) {
    it(`contains only ${tenant === TENANT_A ? 'A' : 'B'} rows and no secrets`, async () => {
      const { zip, sha256 } = await buildTenantExport(tenant, false);
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
      const files = unzipSync(zip);
      const json = Object.entries(files).filter(([n]) => n.startsWith('json/'));
      expect(json.length).toBeGreaterThan(20);
      for (const [name, data] of json) {
        const rows = JSON.parse(strFromU8(data)) as Record<string, unknown>[];
        for (const r of rows) {
          const t = name === 'json/tenants.json' ? r.id : r.tenant_id;
          expect(t, name).toBe(tenant);
        }
        const text = strFromU8(data);
        expect(text).not.toContain(other);
        expect(text).not.toMatch(/token_digest|encrypted_payload|encrypted_object_path/);
      }
      const csvs = Object.entries(files).filter(([n]) => n.startsWith('csv/'));
      for (const [, data] of csvs) expect(strFromU8(data)).not.toMatch(/^"[=+\-@]/m);
    });
  }

  it('masked export omits shop phone numbers and attachments', async () => {
    const { zip } = await buildTenantExport(TENANT_A, true);
    const files = unzipSync(zip);
    expect(Object.keys(files).some((n) => n.startsWith('attachments/'))).toBe(false);
    const shops = JSON.parse(strFromU8(files['json/shops.json']!)) as Record<string, unknown>[];
    expect(shops.every((s) => !('contact_phone' in s))).toBe(true);
  });
});

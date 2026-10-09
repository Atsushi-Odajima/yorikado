/** Issue fresh DEMO coupons for an E2E run (DEMO/local only). */
import { mkdirSync, writeFileSync } from 'node:fs';

async function main() {
if (process.env.APP_ENV !== 'demo') throw new Error('E2E runs only against DEMO');
const h = await import('../tests/integration/helpers');
const [row] = await h.sql<{ id: string }>(`select id from campaigns where name = '練習地域券' and tenant_id = $1`, [h.TENANT_A]);
if (!row) throw new Error('DEMO seed missing: run npm run db:reset:demo');
// Fresh limiter windows for a clean DEMO run (local DEMO only).
await h.sql(`delete from rate_limits`);
const a = await h.issue(row.id, 500, 30);
const b = await h.issue(row.id, 1000, 10);
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/e2e-tokens.json', JSON.stringify({ campaignId: row.id, t500: a.tokens, t1000: b.tokens }));
await h.p.end();
console.log('e2e coupons issued');
}
void main();

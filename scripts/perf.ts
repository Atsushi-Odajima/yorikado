/**
 * AC20 measurement (provisional target: 10 req/s, API p95 <= 1s, mail excluded).
 * Measures, does not assert. Run against a production build for meaningful numbers:
 *   npm run build && PORT=3100 npm start   (other terminal)
 *   PERF_BASE_URL=http://localhost:3100 npm run perf
 * Uses the DEMO staff account and issues fresh DEMO coupons (DEMO/local only).
 */
import { writeFileSync } from 'node:fs';

const base = process.env.PERF_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000';
const SHOP = '00000000-0000-4000-b000-000000000001';

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! * 10) / 10 : null;
}
function summary(xs: number[], errors: number) {
  return { n: xs.length, errors, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: pct(xs, 100) };
}

async function main() {
  if (process.env.APP_ENV !== 'demo') throw new Error('perf runs only against DEMO');
  const origin = new URL(base).origin;
  const login = await fetch(base + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'yorikado', origin },
    body: JSON.stringify({ email: 'a.staff@example.com', password: 'yorikado-demo-2026' }),
  });
  if (!login.ok) throw new Error('login failed ' + login.status);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const H = { cookie, 'x-requested-with': 'yorikado', origin, 'content-type': 'application/json' };

  // A: 10 req/s for 30 s on a read API
  const lat: number[] = [];
  let errA = 0;
  const jobs: Promise<void>[] = [];
  const startA = Date.now();
  for (let i = 0; i < 300; i++) {
    const at = startA + i * 100;
    jobs.push(
      (async () => {
        await new Promise((r) => setTimeout(r, Math.max(0, at - Date.now())));
        const t = performance.now();
        const r = await fetch(`${base}/api/v1/merchant/home?shopId=${SHOP}`, { headers: H }).catch(() => null);
        lat.push(performance.now() - t);
        if (!r || !r.ok) errA++;
        await r?.arrayBuffer();
      })(),
    );
  }
  await Promise.all(jobs);
  const achievedRps = Math.round((300 / ((Date.now() - startA) / 1000)) * 10) / 10;

  // B: first page response (HTML) for the merchant home
  const page: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    const r = await fetch(`${base}/m`, { headers: { cookie } });
    await r.text();
    page.push(performance.now() - t);
  }

  // C: confirm operation latency (draft + confirm), within the 30/min per-user limit
  const h = await import('../tests/integration/helpers');
  const [row] = await h.sql<{ id: string }>(`select id from campaigns where name = '練習地域券' and tenant_id = $1`, [h.TENANT_A]);
  const { tokens } = await h.issue(row!.id, 500, 12);
  await h.p.end();
  const draftLat: number[] = [];
  const confirmLat: number[] = [];
  let errC = 0;
  for (const t of tokens) {
    let s = performance.now();
    const d = await fetch(`${base}/api/v1/receipt-drafts`, { method: 'POST', headers: H, body: JSON.stringify({ shopId: SHOP, campaignId: row!.id, tokens: [t] }) });
    draftLat.push(performance.now() - s);
    const dj = (await d.json()) as { data?: { id: string; amount: number } };
    if (!dj.data) {
      errC++;
      continue;
    }
    s = performance.now();
    const c = await fetch(`${base}/api/v1/redemptions`, { method: 'POST', headers: { ...H, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ draftId: dj.data.id, expectedAmount: dj.data.amount }) });
    confirmLat.push(performance.now() - s);
    if (!c.ok) errC++;
    await c.arrayBuffer();
  }
  const result = {
    at: new Date().toISOString(),
    base,
    target: 'API p95 <= 1000ms at 10 req/s (provisional)',
    readApi10rps: { ...summary(lat, errA), achievedRps },
    merchantHomeHtml: summary(page, 0),
    receiptDraft: summary(draftLat, 0),
    redemptionConfirm: summary(confirmLat, errC),
    note: 'Single-machine measurement (app, DB and client on the same host). Not a production capacity figure.',
  };
  writeFileSync('tmp/perf.json', JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

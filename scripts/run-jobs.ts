/**
 * Trigger the job runner endpoint (outbox: notifications, invitations,
 * reminders, exports, purge). `--loop` repeats every 30 seconds for local
 * development. In production use the host's cron (e.g. Vercel Cron) with
 * Authorization: Bearer $JOB_RUNNER_SECRET.
 */
const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const secret = process.env.JOB_RUNNER_SECRET;
if (!secret) {
  console.error('JOB_RUNNER_SECRET is not set (.env.local)');
  process.exit(1);
}
const loop = process.argv.includes('--loop');

async function once() {
  try {
    const res = await fetch(new URL('/api/v1/internal/jobs/run', base), { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
    const body = (await res.json().catch(() => ({}))) as { data?: unknown; error?: { code: string } };
    if (!res.ok) console.error(new Date().toISOString(), 'jobs failed', res.status, body.error?.code);
    else console.log(new Date().toISOString(), JSON.stringify(body.data));
  } catch (e) {
    console.error(new Date().toISOString(), 'jobs: app not reachable at', base, (e as Error).message);
  }
}

await once();
if (loop) setInterval(once, 30_000);

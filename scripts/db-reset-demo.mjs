// Reset the LOCAL Supabase database and load DEMO fixtures.
// Guards: APP_ENV=demo, local DB/Storage hosts only, explicit confirmation.
// There is intentionally no script that can reset a LIVE database.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const env = process.env;
const fail = (m) => {
  console.error('db:reset:demo refused: ' + m);
  process.exit(1);
};
const isLocal = (u) => {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
};
if (env.APP_ENV !== 'demo') fail('APP_ENV must be "demo"');
if (!isLocal(env.SUPABASE_URL ?? '')) fail('SUPABASE_URL must point to localhost (local Supabase)');
if (!isLocal(env.DATABASE_URL ?? '')) fail('DATABASE_URL must point to localhost');

if (env.YORIKADO_CONFIRM_RESET !== 'demo') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question('ローカルDEMOデータベースを初期化します。続けるには DEMO と入力してください: ');
  rl.close();
  if (a.trim() !== 'DEMO') fail('not confirmed');
}
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npx', ['supabase', 'db', 'reset', '--local']);
run('npx', ['tsx', 'scripts/seed-demo.ts']);

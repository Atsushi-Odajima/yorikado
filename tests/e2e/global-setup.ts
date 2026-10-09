import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Issue fresh DEMO coupons for this run through the real DB functions. */
export default async function globalSetup() {
  rmSync('tmp/e2e-auth', { recursive: true, force: true });
  execFileSync(process.execPath, ['--env-file=.env.test', '--import', 'tsx', 'scripts/e2e-prepare.ts'], { stdio: 'inherit' });
}

// Build the source ZIP for distribution from the committed tree only
// (excludes node_modules, .env*, tmp/, test output and anything untracked).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (status) console.warn('warning: uncommitted changes are NOT included in the ZIP');
mkdirSync('dist', { recursive: true });
const out = `dist/yorikado-v${version}-src.zip`;
execFileSync('git', ['archive', '--format=zip', '--prefix=yorikado/', '-o', out, 'HEAD']);
const list = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n');
const bad = list.filter((f) => /(^|\/)\.env($|\.)(?!example)/.test(f) || f.startsWith('node_modules/'));
if (bad.length) {
  console.error('refusing: secret-like files are tracked:', bad);
  process.exit(1);
}
console.log(`created ${out} (${list.length - 1} files)`);

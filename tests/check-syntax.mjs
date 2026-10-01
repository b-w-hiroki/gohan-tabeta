import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = [
  ...readdirSync(resolve(root, 'js')).filter((name) => name.endsWith('.js')).map((name) => resolve(root, 'js', name)),
  resolve(root, 'sw.js'),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

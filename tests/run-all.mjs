// Runs every tests/*.test.mjs against a local static server. Exit code 1 if any test fails.
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.mjs';
import { launch } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const only = process.argv[2];
const files = (await readdir(here)).filter((f) => f.endsWith('.test.mjs') && (!only || f.includes(only))).sort();

const server = await startServer(root);
const browser = await launch();
let failed = 0;
for (const file of files) {
  const tests = (await import(`./${file}`)).default;
  for (const [name, fn] of Object.entries(tests)) {
    const t0 = Date.now();
    try {
      await fn({ browser, base: server.url });
      console.log(`  ✓ ${file} › ${name} (${Date.now() - t0}ms)`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${file} › ${name}\n      ${String(e.stack || e).split('\n').slice(0, 3).join('\n      ')}`);
    }
  }
}
await browser.close();
server.close();
console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);

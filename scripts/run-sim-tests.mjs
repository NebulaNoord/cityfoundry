#!/usr/bin/env node
// Dev-only fallback: runs tests/sim/*.test.js under plain Node, with the
// 'vitest' import aliased to scripts/vitest-shim.mjs via a module
// customization hook. The primary runner is Vitest (`npm test`).
//
// Usage: node scripts/run-sim-tests.mjs [name-filter]

import { register } from 'node:module';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const shimUrl = pathToFileURL(path.join(here, 'vitest-shim.mjs')).href;

const hooks = `
let shim;
export async function initialize(data) { shim = data.shimUrl; }
export async function resolve(specifier, context, next) {
  if (specifier === 'vitest') return { url: shim, shortCircuit: true };
  return next(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hooks), { data: { shimUrl } });

// Import through the same URL the hook resolves to, so the registry is shared.
const { runCollected } = await import(shimUrl);

const testDir = path.join(here, '..', 'tests', 'sim');
const filter = process.argv[2];
const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.js') && (!filter || f.includes(filter)))
  .sort();

const total = { passed: 0, failed: 0, skipped: 0, failures: [] };
const t0 = performance.now();
for (const f of files) {
  console.log(`\n${f}`);
  try {
    await import(pathToFileURL(path.join(testDir, f)).href);
  } catch (err) {
    total.failed++;
    total.failures.push({ file: f, name: '(module load)', err });
    console.log(`  ✗ failed to load: ${err && err.stack}`);
    continue;
  }
  const r = await runCollected({ file: f });
  total.passed += r.passed;
  total.failed += r.failed;
  total.skipped += r.skipped;
  total.failures.push(...r.failures);
}

const secs = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`\nFiles: ${files.length}  Tests: ${total.passed} passed, ${total.failed} failed, ${total.skipped} skipped  (${secs}s)`);
if (total.failed > 0) {
  console.log('\nFailures:');
  for (const f of total.failures) console.log(`  ${f.file} :: ${f.name}: ${f.err && f.err.message}`);
  process.exitCode = 1;
}

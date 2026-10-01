// Draait alle testsuites na elkaar en geeft een samenvatting. Gebruik: npm test
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const suites = ['check-csp.mjs', 'worker.mjs', ...readdirSync(dir).filter(name => /^\d\d-.*\.mjs$/.test(name)).sort()];
let passed = 0;
let failed = 0;
const problems = [];

for (const suite of suites) {
  const run = spawnSync(process.execPath, [suite], { cwd: dir, encoding: 'utf8' });
  const output = `${run.stdout}${run.stderr}`;
  const ok = (output.match(/^OK /gm) ?? []).length;
  const bad = (output.match(/^FOUT /gm) ?? []).length;
  const pageErrors = /^(console-fouten\/waarschuwingen|paginafouten|fouten): (?!geen)/m.test(output);
  const crashed = run.status !== 0 && !bad;
  passed += ok;
  failed += bad + (pageErrors || crashed ? 1 : 0);
  console.log(`${bad || pageErrors || crashed ? '✗' : '✓'} ${suite.padEnd(34)} ${ok} geslaagd${bad ? `, ${bad} mislukt` : ''}${pageErrors ? ', fouten op de pagina' : ''}${crashed ? ', afgebroken' : ''}`);
  if (bad || pageErrors || crashed) problems.push(`--- ${suite} ---\n${output.split('\n').filter(line => /^FOUT|fouten|Error|at /.test(line)).slice(0, 20).join('\n')}`);
}

console.log(`\n${passed} controles geslaagd, ${failed} mislukt.`);
if (problems.length) {
  console.log(`\n${problems.join('\n\n')}`);
  process.exitCode = 1;
}

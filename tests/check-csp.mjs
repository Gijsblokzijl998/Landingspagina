// Controleert (of met --fix: werkt bij) de SHA-256-hashes van de ingebouwde scripts in de CSP van index.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = new URL('../index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const hashes = scripts.map(code => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`);
const policy = html.match(/script-src ([^;]*);/);
if (!policy) throw new Error('Geen script-src gevonden in de CSP.');

const expected = hashes.join(' ');
if (policy[1] === expected) {
  console.log(`OK   CSP-hashes kloppen (${hashes.length} scripts)`);
} else if (process.argv.includes('--fix')) {
  writeFileSync(file, html.replace(policy[0], `script-src ${expected};`));
  console.log(`OK   CSP-hashes bijgewerkt (${hashes.length} scripts)`);
} else {
  console.log('FOUT CSP-hashes kloppen niet; draai: node tests/check-csp.mjs --fix');
  process.exitCode = 1;
}

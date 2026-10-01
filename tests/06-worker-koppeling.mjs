import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
// Worker-code in Node, met een lege nagebootste cache
const store = new Map();
globalThis.caches = { default: { match: async r => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const worker = (await import(WORKER_PATH)).default;
const env = { DASHBOARD_KEY: 'mijn-geheime-sleutel', EXTRA_ICS_HOSTS: '' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce',  viewport: { width: 1280, height: 860 } });
let workerUp = true;
// Alle verzoeken naar de Worker gaan naar de echte Worker-code.
await ctx.route('https://landingspagina.test.workers.dev/**', async route => {
  if (!workerUp) return route.abort('connectionrefused');
  const req = route.request();
  const response = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), env, { waitUntil() {} });
  route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
});
await ctx.route(/^https:\/\/(?!landingspagina\.test)/, route => route.fulfill({ status: 404, body: '' }));
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + name + (extra ? '  → ' + extra : '')); };
const p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/40[134]|net::|Failed to load/.test(m.text())) errors.push(m.text()); });
await p.goto(INDEX_URL);
await p.evaluate(() => localStorage.clear()); await p.reload();

const status = async () => { await p.waitForFunction(() => !document.querySelector('#workerStatus').textContent.endsWith('…')); return { text: await p.textContent('#workerStatus'), state: await p.getAttribute('#workerStatus', 'data-state') }; };
await p.click('#settingsBtn'); await p.click('[data-section="services"]');

await p.click('[data-action="test-worker"]');
let s = await status();
check('zonder adres: duidelijke melding', s.state === 'error' && s.text.includes('adres van je Worker'), s.text);

await p.fill('[data-path="services.workerUrl"]', 'https://landingspagina.test.workers.dev/');
await p.fill('[data-path="services.workerKey"]', 'verkeerd');
await p.click('[data-action="test-worker"]');
s = await status();
check('verkeerde sleutel herkend', s.state === 'error' && s.text.includes('sleutel klopt niet'), s.text);

await p.fill('[data-path="services.workerKey"]', 'mijn-geheime-sleutel');
await p.click('[data-action="test-worker"]');
s = await status();
check('juiste sleutel: verbinding gelukt (ook met / aan het eind)', s.state === 'ok' && /Worker-versie \d/.test(s.text), s.text);
await p.screenshot({ path: OUT + '/fase6-koppelingen.png' });

workerUp = false;
await p.click('[data-action="test-worker"]');
s = await status();
check('Worker onbereikbaar', s.state === 'error' && s.text.includes('niet bereikbaar'), s.text);
workerUp = true;

const savedEnvKey = env.DASHBOARD_KEY; delete env.DASHBOARD_KEY;
await p.click('[data-action="test-worker"]');
s = await status();
check('secret niet ingesteld: uitleg van de Worker getoond', s.state === 'error' && s.text.includes('DASHBOARD_KEY'), s.text);
env.DASHBOARD_KEY = savedEnvKey;

await p.click('[data-action="save-settings"]');
check('opgeslagen', await p.evaluate(() => config.services.workerKey === 'mijn-geheime-sleutel'));

// Kan het dashboard (file://, Origin: null) via de Worker een feed lezen? (voorbereiding fase 7)
const viaWorker = await p.evaluate(async () => {
  const response = await fetch(workerEndpoint(config.services, '/ics?url=' + encodeURIComponent('https://evil.example/x.ics')), { headers: { 'X-Dashboard-Key': config.services.workerKey } });
  return { status: response.status, body: await response.json() };
});
check('CORS werkt vanaf file:// en foutmelding is leesbaar', viaWorker.status === 400 && viaWorker.body.error.includes('evil.example'), JSON.stringify(viaWorker));

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

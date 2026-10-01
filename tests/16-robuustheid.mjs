// Robuustheid: opslag met alleen IndexedDB, capaciteit volgens de echte indeling, oplopende wachttijd bij fouten,
// zuinig bijwerken van de agenda en favicons die na één keer bewaard blijven.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { INDEX_URL, WORKER_PATH, FIX } from './helpers.mjs';

const png = fs.readFileSync(FIX + '/logo.png');
const ics = fs.readFileSync(FIX + '/agenda.ics', 'utf8');
const ICS_URL = 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics';
const store = new Map();
globalThis.caches = { default: { match: async r => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const upstream = [];
globalThis.fetch = async url => {
  upstream.push(url);
  if (url === ICS_URL) return new Response(ics, { headers: { 'Content-Type': 'text/calendar' } });
  if (url === 'https://kapot.example/feed') return new Response('stuk', { status: 500 });
  if (url === 'https://www.office.com/favicon.ico') return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  return new Response('', { status: 404, headers: { 'Content-Type': 'text/html' } });
};
const worker = (await import(WORKER_PATH)).default;

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Amsterdam' });
const workerCalls = [];
await ctx.route('https://dash.test.workers.dev/**', async route => {
  const req = route.request();
  workerCalls.push(req.url());
  const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), { DASHBOARD_KEY: 'k' }, { waitUntil() {} });
  route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
const browserIcons = [];
await ctx.route(/^https:\/\/(?!dash\.test)/, route => {
  browserIcons.push(route.request().url());
  return /gstatic.*buienradar/.test(decodeURIComponent(route.request().url()))
    ? route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: png })
    : route.fulfill({ status: 404, body: '' });
});
const p = await ctx.newPage();
await p.clock.install({ time: new Date('2026-10-01T09:58:30+02:00') });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
let fails = 0;
// Nepklok vooruitzetten en daarna even echt wachten, zodat verzoeken (Worker in Node) kunnen afronden.
const settle = async ms => { await p.clock.runFor(ms); await p.waitForTimeout(400); await p.clock.runFor(10); };
const check = (n, ok, x = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + n + (x ? '  → ' + x : '')); };

await p.goto(INDEX_URL);
await p.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('landingspagina'); q.onsuccess = q.onerror = q.onblocked = r; }); });
await p.reload(); await p.clock.runFor(500);

// --- Opslag: localStorage vol, IndexedDB wel ---
const quota = await p.evaluate(async () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'lp:config') throw new DOMException('vol', 'QuotaExceededError');
    return original.call(this, key, value);
  };
  const d = structuredClone(config); d.general.title = 'Alleen in IndexedDB'; applyConfig(normalizeConfig(d));
  await new Promise(r => setTimeout(r, 300));
  Storage.prototype.setItem = original;
  return { toast: document.querySelector('#toast').textContent, backup: (await idbGet('kv', 'config')).general.title, local: JSON.parse(localStorage.getItem('lp:config') ?? '{}').general?.title ?? null };
});
await p.clock.runFor(400);
check('localStorage vol: melding zegt dat de back-up wel bewaard is', quota.toast.includes('wel bewaard in de back-up') && quota.backup === 'Alleen in IndexedDB', JSON.stringify(quota));
await p.reload(); await p.clock.runFor(800);
check('bij openen: de nieuwere back-up wint van de oude localStorage', await p.evaluate(() => config.general.title === 'Alleen in IndexedDB' && document.querySelector('#pageTitle').textContent === 'Alleen in IndexedDB'));
check('daarna weer gelijk in localStorage', await p.evaluate(() => JSON.parse(localStorage.getItem('lp:config')).general.title === 'Alleen in IndexedDB'));
const neither = await p.evaluate(async () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key) { if (key === 'lp:config') throw new DOMException('vol', 'QuotaExceededError'); };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('kapot', 'UnknownError'); };
  saveData();
  await new Promise(r => setTimeout(r, 300));
  Storage.prototype.setItem = original; IDBObjectStore.prototype.put = put;
  return document.querySelector('#toast').textContent;
});
check('beide mislukt: melding dat er niets bewaard is', neither.includes('niet bewaard'), neither);

// --- Capaciteit volgens de echte indeling ---
const fit = await p.evaluate(() => {
  const cal = { id: 'c', type: 'calendar', width: 3, height: 2 };
  const rss = id => ({ id, type: 'rss' });
  const link = id => ({ id, type: 'link', size: 'normal' });
  return {
    // 4 × 2: agenda 3 × 2 (6) + RSS 2 × 1 (2) = 8 vakken, maar de RSS past niet in de vrije kolom van 1 breed
    areaOkShapeNot: gridFit([cal, rss('r')], 4, 2),
    // 4 × 2: agenda 3 × 2 + 2 gewone tegels = 8 vakken en past precies
    exact: gridFit([cal, link('a'), link('b')], 4, 2),
    // 2 × 2: vier halve tegels + 1 RSS = 4 vakken, past
    halves: gridFit([{ id: 'h1', type: 'link', size: 'half' }, { id: 'h2', type: 'link', size: 'half' }, { id: 'h3', type: 'link', size: 'half' }, { id: 'h4', type: 'link', size: 'half' }, rss('r')], 2, 2),
    tooMany: gridFit([cal, link('a'), link('b'), link('c')], 4, 2)
  };
});
check('genoeg vakken maar de vorm past niet → geweigerd, met uitleg', !fit.areaOkShapeNot.fits && fit.areaOkShapeNot.shape, JSON.stringify(fit.areaOkShapeNot));
check('precies passend → toegestaan', fit.exact.fits, JSON.stringify(fit.exact));
check('halve tegels tellen per halve rij → toegestaan', fit.halves.fits, JSON.stringify(fit.halves));
check('te veel vakken → geweigerd', !fit.tooMany.fits && !fit.tooMany.shape);
const message = await p.evaluate(() => {
  const d = structuredClone(config);
  d.appearance.gridColumns = 4; d.appearance.gridRows = 2;
  d.tiles = [{ id: 'c', type: 'calendar', title: 'A', width: 3, height: 2 }, { id: 'r', type: 'rss', title: 'N', feedUrl: '' }].map(t => normalizeConfig({ ...DEFAULT_CONFIG, tiles: [t] }).tiles[0]);
  return validateDraft(d)?.message ?? '';
});
check('melding bij opslaan noemt de maten van de tegels', message.includes('door hun maten'), message);
check('vrije plek onder het grid → tegel schuift terug binnen de rijen', await p.evaluate(() => {
  const tiles = [{ id: 'a', type: 'link', position: { col: 1, row: 11 } }, { id: 'b', type: 'link' }];
  const l = layoutTiles(tiles, 4, 8);
  return l.bottom <= 8 && l.places.get('a').row < 11;
}));

// --- Worker en agenda koppelen ---
await p.evaluate(ics => {
  const d = normalizeConfig(DEFAULT_CONFIG);
  d.services = { workerUrl: 'https://dash.test.workers.dev', workerKey: 'k' };
  d.tiles.find(t => t.type === 'calendar').icsUrl = ics;
  applyConfig(normalizeConfig(d));
}, ICS_URL);
await settle(1000);

// --- Agenda: elke minuut alleen de labels, opnieuw tekenen alleen bij een wijziging ---
// 09:58:30 → Teamoverleg (09:00–10:00) loopt nog 2 min; Lunch begint over 4 u 2 min
await p.evaluate(() => { window.__rebuilds = 0; const original = renderCalendarTiles; window.renderCalendarTiles = (...a) => { window.__rebuilds++; return original(...a); }; });
const badges = () => p.evaluate(() => [...document.querySelectorAll('.agenda-badge')].map(b => b.textContent).join(' | '));
const before = await badges();
const node = await p.evaluate(() => { window.__item = document.querySelector('.agenda-item.is-now'); return !!window.__item; });
await settle(60_000);
const after1 = await badges();
check('na een minuut: labels bijgewerkt, agenda niet opnieuw opgebouwd', before !== after1 && await p.evaluate(() => document.querySelector('.agenda-item.is-now') === window.__item), `${before} → ${after1}`);
await settle(60_000);
const after2 = await p.evaluate(() => ({ now: document.querySelector('.agenda-item.is-now')?.querySelector('.agenda-title').textContent ?? null, same: document.querySelector('.agenda-item') === window.__item, past: [...document.querySelectorAll('.agenda-item.is-past')].map(i => i.querySelector('.agenda-title').textContent) }));
check('als een afspraak afloopt: agenda opnieuw opgebouwd', node && !after2.same && after2.now === null && after2.past.includes('Teamoverleg'), JSON.stringify(after2));

// --- Oplopende wachttijd bij een kapotte feed ---
await p.evaluate(() => {
  const d = structuredClone(config);
  d.tiles.find(t => t.type === 'rss').feedUrl = 'https://kapot.example/feed';
  applyConfig(normalizeConfig(d));
});
await settle(1000);
const tries = () => upstream.filter(u => u === 'https://kapot.example/feed').length;
const attempts = [tries()];
const delays = [];
for (const minutes of [2, 5, 15, 15]) {
  delays.push(await p.evaluate(() => Math.round((feedState.get('https://kapot.example/feed').retryAt - Date.now()) / 60_000)));
  store.clear();
  await settle(minutes * 60_000 + 1000);
  attempts.push(tries());
}
check('wachttijd na fouten: 2, 5, 15, 15 minuten', delays.join() === '2,5,15,15', delays.join());
check('in die tijd precies één poging per stap', attempts.join() === '1,2,3,4,5', attempts.join());
check('"Opnieuw proberen" wacht daar niet op', await p.evaluate(async () => { await updateFeeds({ force: true }); return feedState.get('https://kapot.example/feed').failures === 6; }) && tries() === 6);
check('nieuwe instellingen: mislukte bron meteen opnieuw', await p.evaluate(async () => { applyConfig(normalizeConfig(structuredClone(config))); await new Promise(r => setTimeout(r, 50)); return true; }) && (await settle(500), tries() === 7), String(tries()));

// --- Favicons: na één keer bewaard ---
check('favicon van de Worker blijft bewaard (ook na 30 dagen)', await p.evaluate(async () => {
  const cached = await idbGet('cache', 'favicon3:www.office.com');
  if (!cached?.blob) return false;
  cached.fetchedAt -= 30 * 86_400_000;
  await idbPut('cache', 'favicon3:www.office.com', cached);
  return true;
}));
const callsBefore = workerCalls.filter(u => u.includes('/favicon') && u.includes('office.com')).length;
await p.reload(); await settle(1500);
check('na herladen geen nieuwe vraag aan de Worker', workerCalls.filter(u => u.includes('/favicon') && u.includes('office.com')).length === callsBefore && await p.evaluate(() => [...document.querySelectorAll('[data-tile-id="t4"] img.favicon')].some(i => i.src.startsWith('blob:'))));
// Zonder Worker: het adres dat lukte wordt onthouden en daarna direct gebruikt
await p.evaluate(() => { const d = structuredClone(config); d.services = { workerUrl: '', workerKey: '' }; applyConfig(normalizeConfig(d)); });
await settle(1500);
const known = await p.evaluate(() => JSON.parse(localStorage.getItem('lp:favicons') ?? '{}')['www.buienradar.nl'] ?? '');
check('zonder Worker: gelukt adres onthouden', known.includes('gstatic') && known.includes('buienradar'), known);
browserIcons.length = 0;
await p.reload(); await settle(1500);
const buienradar = browserIcons.filter(u => decodeURIComponent(u).includes('buienradar'));
check('daarna direct dat adres, zonder eerst andere bronnen', buienradar.length === 1 && buienradar[0] === known, buienradar.join(', '));

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

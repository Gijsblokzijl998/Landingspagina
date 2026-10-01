// Halve tegels, zakelijke iconen met zoekveld, smallere tijdkolom in de agenda.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';

const ics = fs.readFileSync(FIX + '/agenda.ics', 'utf8');
const ICS_URL = 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics';
const store = new Map();
globalThis.caches = { default: { match: async r => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
globalThis.fetch = async url => url === ICS_URL
  ? new Response(ics, { headers: { 'Content-Type': 'text/calendar' } })
  : new Response('', { status: 404, headers: { 'Content-Type': 'text/html' } });
const worker = (await import(WORKER_PATH)).default;

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce',  viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Amsterdam' });
await ctx.route('https://dash.test.workers.dev/**', async route => {
  const req = route.request();
  const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), { DASHBOARD_KEY: 'k' }, { waitUntil() {} });
  route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
await ctx.route(/^https:\/\/(?!dash\.test)/, route => route.fulfill({ status: 404, body: '' }));
const p = await ctx.newPage();
await p.clock.setFixedTime(new Date('2026-10-01T08:00:00+02:00'));
const errors = [];
p.on('pageerror', e => errors.push(e.message));
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + n + (x ? '  → ' + x : '')); };

await p.goto(INDEX_URL);
await p.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('landingspagina'); q.onsuccess = q.onerror = q.onblocked = r; }); });
await p.reload(); await p.waitForTimeout(200);
await p.evaluate(ics => {
  const d = normalizeConfig(DEFAULT_CONFIG);
  d.services = { workerUrl: 'https://dash.test.workers.dev', workerKey: 'k' };
  d.tiles.find(t => t.type === 'calendar').icsUrl = ics;
  applyConfig(normalizeConfig(d));
  saveData();
}, ICS_URL);
await p.waitForTimeout(800);

// --- Agenda: tijd dicht bij de afspraak ---
const agenda = await p.evaluate(() => {
  const items = [...document.querySelectorAll('.agenda-item')];
  const gaps = items.map(i => { const r = document.createRange(); r.selectNodeContents(i.querySelector('.agenda-time')); const text = r.getBoundingClientRect(); return Math.round(i.querySelector('.agenda-title').getBoundingClientRect().left - text.right); });
  const lefts = new Set(items.map(i => Math.round(i.querySelector('.agenda-title').getBoundingClientRect().left)));
  return { min: Math.min(...gaps), max: Math.max(...gaps), aligned: lefts.size === 1, count: items.length };
});
check('afspraken direct naast de langste tijd (≤ 12 px)', agenda.min >= 6 && agenda.min <= 12, JSON.stringify(agenda));
check('titels van alle dagen netjes onder elkaar', agenda.aligned, JSON.stringify(agenda));
await p.screenshot({ path: OUT + '/agenda-tijdkolom.png', clip: await p.evaluate(() => { const r = document.querySelector('.tile--calendar').getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; }) });

// --- Halve tegel ---
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
check('keuze "Gewone tegel, half zo hoog" bij toevoegen', await p.locator('#newTileType option[value="link-half"]').count() === 1);
await p.selectOption('#newTileType', 'link-half');
await p.click('[data-action="add-tile"]');
const index = await p.evaluate(() => draft.tiles.length - 1);
check('editor toont Hoogte = Half zo hoog', await p.inputValue(`[data-path="tiles.${index}.size"]`) === 'half');
await p.fill(`[data-path="tiles.${index}.title"]`, 'Tobias Productie');
await p.fill(`[data-path="tiles.${index}.target.value"]`, 'https://vechtdalwonen.operations.eu.dynamics.com/');
await p.click('[data-action="close-tile-editor"]');
check('lijst toont "Halve tegel"', (await p.locator('.settings-list-item >> nth=-1').innerText()).includes('Halve tegel'));
check('halve tegel telt als een half vak', (await p.textContent('.capacity')).startsWith('11,5 van 16'), await p.textContent('.capacity'));
// Tweede halve tegel via de editor van een bestaande tegel
await p.selectOption('#newTileType', 'link');
await p.click('[data-action="add-tile"]');
await p.fill(`[data-path="tiles.${index + 1}.title"]`, 'Tobias Test');
await p.fill(`[data-path="tiles.${index + 1}.target.value"]`, 'https://vechtdalwonen-uat.sandbox.operations.eu.dynamics.com/');
await p.selectOption(`[data-path="tiles.${index + 1}.size"]`, 'half');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(300);
const half = await p.evaluate(() => {
  const full = document.querySelector('.tile--link:not(.tile--half)').getBoundingClientRect();
  const halves = [...document.querySelectorAll('.tile--half')].map(t => t.getBoundingClientRect());
  const gap = parseFloat(getComputedStyle(document.querySelector('#tileGrid')).rowGap);
  return { count: halves.length, height: halves.map(h => Math.round(h.height)), expected: Math.round((full.height - gap) / 2), width: Math.round(halves[0].width) === Math.round(full.width), stacked: halves.length === 2 && Math.round(halves[0].left) === Math.round(halves[1].left) && Math.abs(halves[1].top - halves[0].bottom - gap) < 1.5 };
});
check('halve tegel is half zo hoog, even breed', half.count === 2 && half.height.every(h => Math.abs(h - half.expected) <= 1) && half.width, JSON.stringify(half));
check('twee halve tegels passen samen in één vak', half.stacked, JSON.stringify(half));
const face = await p.evaluate(() => { const t = document.querySelector('.tile--half'); const icon = t.querySelector('.tile-icon').getBoundingClientRect(), title = t.querySelector('.tile-title').getBoundingClientRect(); return { sideBySide: title.left > icon.right && Math.abs((icon.top + icon.bottom) / 2 - (title.top + title.bottom) / 2) < 3, fits: t.scrollHeight <= t.clientHeight + 1 }; });
check('icoon en titel naast elkaar, past in de tegel', face.sideBySide && face.fits, JSON.stringify(face));
check('halve tegel bewaard en ongeldige hoogte hersteld', await p.evaluate(() => JSON.parse(localStorage.getItem('lp:config')).tiles.filter(t => t.size === 'half').length === 2 && normalizeConfig({ ...DEFAULT_CONFIG, tiles: [{ id: 'a', type: 'link', title: 'A', size: 'reus', target: { kind: 'url', value: 'https://a.nl' } }] }).tiles[0].size === 'normal'));
await p.screenshot({ path: OUT + '/halve-tegels.png' });
await p.emulateMedia({ colorScheme: 'dark' });
await p.screenshot({ path: OUT + '/halve-tegels-donker.png' });
await p.emulateMedia({ colorScheme: 'light' });

// --- Iconen: euro en zakelijke iconen, met zoekveld ---
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
await p.click('[data-action="edit-tile"][data-id="t2"] >> nth=0');
const business = ['euro', 'coins', 'banknote', 'receipt', 'calculator', 'percent', 'piggy', 'bars', 'kanban', 'audit', 'contract', 'scale', 'handshake', 'building', 'apartment', 'landmark', 'idcard', 'presentation', 'decline'];
const present = await p.evaluate(names => names.filter(n => document.querySelector(`.icon-choice[data-icon="${n}"] svg path`)), business);
check(`zakelijke iconen aanwezig (${present.length}/${business.length})`, present.length === business.length, business.filter(n => !present.includes(n)).join(', '));
check('iconen hebben een geldig pad', await p.evaluate(names => names.every(n => { const b = document.querySelector(`.icon-choice[data-icon="${n}"] svg path`).getBBox(); return b.width > 8 && b.height > 8 && b.x >= 0 && b.y >= 0 && b.x + b.width <= 24.5 && b.y + b.height <= 24.5; }), business));
await p.fill('.icon-search', 'euro');
const shown = await p.evaluate(() => [...document.querySelectorAll('.icon-choice[data-icon]')].filter(b => !b.hidden && b.dataset.icon).map(b => b.dataset.icon));
check('zoeken op "euro" toont het euroteken en geldiconen', shown.includes('euro') && shown.includes('coins') && shown.includes('banknote') && shown.length < 10, shown.join(', '));
await p.screenshot({ path: OUT + '/iconen-zoeken.png' });
await p.fill('.icon-search', 'factuur');
check('zoeken op "factuur"', await p.evaluate(() => [...document.querySelectorAll('.icon-choice')].filter(b => !b.hidden).map(b => b.dataset.icon).join() === 'receipt'));
await p.fill('.icon-search', '');
check('leeg zoekveld toont alles', await p.evaluate(() => [...document.querySelectorAll('.icon-choice')].every(b => !b.hidden)));
await p.click('.icon-choice[data-icon="euro"]');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(200);
check('euro-icoon op de tegel', await p.evaluate(() => document.querySelector('[data-tile-id="t2"] .tile-icon path')?.getAttribute('d') === TILE_ICONS.euro[1]));
// Alle iconen op een rij voor de schermafbeelding
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
await p.click('[data-action="edit-tile"][data-id="t2"] >> nth=0');
await p.screenshot({ path: OUT + '/iconen-alle.png', clip: await p.evaluate(() => { const r = document.querySelector('.icon-picker').getBoundingClientRect(); return { x: r.x - 6, y: r.y - 40, width: r.width + 12, height: r.height + 46 }; }) });

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

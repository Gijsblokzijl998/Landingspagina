// Brede RSS-tegel met berichten op één regel, compacte links en agenda, snelle links zonder pil,
// en favicons via de Worker (o.a. Dynamics 365-omgevingen).
import { chromium } from 'playwright';
import fs from 'node:fs';
import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';

const png = fs.readFileSync(FIX + '/logo.png');
const nos = fs.readFileSync(FIX + '/nos.xml', 'utf8');
const ics = fs.readFileSync(FIX + '/agenda.ics', 'utf8');
const ICS_URL = 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics';
const PROD = 'https://vechtdalwonen.operations.eu.dynamics.com/';
const UAT = 'https://vechtdalwonen-uat.sandbox.operations.eu.dynamics.com/?cmp=1&mi=DefaultDashboard';

// Worker in Node met nagebootste bronnen
const store = new Map();
globalThis.caches = { default: { match: async r => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const upstream = [];
globalThis.fetch = async url => {
  upstream.push(url);
  const u = new URL(url);
  const image = () => new Response(png, { headers: { 'Content-Type': 'image/png' } });
  if (url === 'https://feeds.nos.nl/nosnieuwsalgemeen') return new Response(nos, { headers: { 'Content-Type': 'application/xml' } });
  if (url === ICS_URL) return new Response(ics, { headers: { 'Content-Type': 'text/calendar' } });
  if (u.hostname.endsWith('dynamics.com') && u.pathname === '/') {
    const r = new Response('<html><link rel="icon" href="https://aadcdn.msftauth.net/favicon.ico"></html>', { headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(r, 'url', { value: 'https://login.microsoftonline.com/common/oauth2/authorize' });
    return r;
  }
  if (u.hostname === 'aadcdn.msftauth.net') return image();
  if (u.pathname === '/favicon.ico' && /teams|onedrive|office/.test(u.hostname)) return image();
  return new Response('', { status: 404, headers: { 'Content-Type': 'text/html' } });
};
const worker = (await import(WORKER_PATH)).default;
const env = { DASHBOARD_KEY: 'k' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce',  viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Amsterdam' });
let oldWorker = false;
const faviconCalls = [];
await ctx.route('https://dash.test.workers.dev/**', async route => {
  const req = route.request();
  if (req.url().includes('/favicon')) {
    faviconCalls.push(req.url());
    if (oldWorker) return route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: '{"ok":false}' });
  }
  const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), env, { waitUntil() {} });
  route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
const directFavicons = [];
await ctx.route(/^https:\/\/(?!dash\.test)/, route => { directFavicons.push(route.request().url()); route.fulfill({ status: 404, body: '' }); });

const p = await ctx.newPage();
await p.clock.setFixedTime(new Date('2026-10-01T08:00:00+02:00'));
const errors = [];
p.on('pageerror', e => errors.push(e.message));
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + n + (x ? '  → ' + x : '')); };

await p.goto(INDEX_URL);
await p.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('landingspagina'); q.onsuccess = q.onerror = q.onblocked = r; }); });
await p.reload(); await p.waitForTimeout(200);
directFavicons.length = 0; // vanaf hier is de Worker gekoppeld
await p.evaluate(([prod, uat, ics]) => {
  const d = normalizeConfig(DEFAULT_CONFIG);
  d.services = { workerUrl: 'https://dash.test.workers.dev', workerKey: 'k' };
  d.tiles.find(t => t.type === 'calendar').icsUrl = ics;
  d.tiles.push({ id: 'dyn', type: 'links', title: 'Links', icon: 'link', links: [{ label: 'Tobias Productie', url: prod }, { label: 'Tobias Test', url: uat }] });
  applyConfig(normalizeConfig(d));
}, [PROD, UAT, ICS_URL]);
await p.waitForTimeout(1200);

// RSS-tegel breed, berichten op één regel
const rss = await p.evaluate(() => {
  const tile = document.querySelector('.tile--rss').getBoundingClientRect();
  const one = document.querySelector('.tile--link').getBoundingClientRect();
  const titles = [...document.querySelectorAll('.feed-title')];
  const lineHeight = parseFloat(getComputedStyle(titles[0]).lineHeight);
  return { width: tile.width, expected: 2 * one.width + 16, items: titles.length, oneLine: titles.every(t => t.getBoundingClientRect().height <= lineHeight + 1), ellipsis: getComputedStyle(titles[0]).textOverflow };
});
check('RSS-tegel is 2 tegels breed', Math.abs(rss.width - rss.expected) < 1, `${rss.width} vs ${rss.expected}`);
check(`elke berichttitel op één regel (${rss.items} berichten)`, rss.items > 0 && rss.oneLine && rss.ellipsis === 'ellipsis');
check('geen horizontale scrollbalk in tegels', await p.evaluate(() => [...document.querySelectorAll('.tile-body')].every(b => b.scrollWidth <= b.clientWidth)));

// Links compact onder elkaar
const linkHeights = await p.evaluate(() => [...document.querySelectorAll('[data-tile-id="dyn"] .tile-list a')].map(a => Math.round(a.getBoundingClientRect().height)));
check('links in tegels compact (≤ 24 px per regel)', linkHeights.length === 2 && linkHeights.every(h => h <= 24), linkHeights.join(', '));

// Agenda compacter
const agenda = await p.evaluate(() => { const i = document.querySelector('.agenda-item:not(:has(.agenda-location))'); return { height: Math.round(i.getBoundingClientRect().height), padding: getComputedStyle(i).paddingTop }; });
check('agenda-items dichter op elkaar', agenda.height <= 19 && agenda.padding === '1px', JSON.stringify(agenda));

// Snelle links zonder pil
const quick = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.quick-link')); return { border: s.borderTopWidth, background: s.backgroundColor }; });
check('snelle links zonder pilvorm', quick.border === '0px' && quick.background === 'rgba(0, 0, 0, 0)', JSON.stringify(quick));

// Favicons via de Worker
const icons = await p.evaluate(() => [...document.querySelectorAll('[data-tile-id="dyn"] .favicon')].map(f => ({ tag: f.tagName, src: f.src?.slice(0, 5), width: f.naturalWidth })));
check('Dynamics productie en UAT: favicon via de Worker', icons.length === 2 && icons.every(i => i.tag === 'IMG' && i.src === 'blob:' && i.width > 0), JSON.stringify(icons));
check('Worker vond het icoon van de inlogpagina', upstream.includes('https://aadcdn.msftauth.net/favicon.ico'));
check('site zonder favicon (Worker: 204) → direct de letter', await p.evaluate(() => document.querySelector('#quickLinksBar .favicon--letter')?.textContent === 'G'));
check('met Worker geen favicon-verzoeken vanuit de browser', !directFavicons.some(u => /gstatic|duckduckgo|favicon/.test(u)), directFavicons.filter(u => /gstatic|duckduckgo|favicon/.test(u)).join(', '));
await p.screenshot({ path: OUT + '/indeling-licht.png' });

// Na herladen uit IndexedDB, zonder nieuwe Worker-aanvraag
const before = faviconCalls.length;
await p.reload(); await p.waitForTimeout(800);
check('favicons na herladen uit de cache', faviconCalls.length === before && await p.evaluate(() => [...document.querySelectorAll('[data-tile-id="dyn"] img.favicon')].every(i => i.src.startsWith('blob:'))));

// Oudere Worker zonder /favicon: terug naar de bronnen in de browser
oldWorker = true;
await p.evaluate(async () => { const db = await initDB(); await new Promise(r => { const t = db.transaction('cache', 'readwrite'); t.objectStore('cache').clear(); t.oncomplete = r; }); });
await p.reload(); await p.waitForTimeout(800);
check('oudere Worker: favicons via Google/DuckDuckGo in de browser', directFavicons.some(u => u.startsWith('https://t1.gstatic.com/faviconV2')));

// Vijf berichten passen zonder scrollen in een RSS-tegel (grid 4 × 4 op 1440 × 900)
await p.evaluate(() => { const d = structuredClone(config); d.tiles.find(t => t.type === 'rss').maxItems = 5; d.tiles = d.tiles.filter(t => t.id !== 'dyn'); applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(300);
const fit = await p.evaluate(() => { const b = document.querySelector('.tile--rss .tile-body'); return { items: b.querySelectorAll('.feed-item').length, scroll: b.scrollHeight, client: b.clientHeight, size: Math.round(parseFloat(getComputedStyle(b.querySelector('.feed-title')).fontSize) * 10) / 10 }; });
check('5 berichten passen zonder scrollen, kleinere tekst', fit.items === 5 && fit.scroll <= fit.client && fit.size < 12.5, JSON.stringify(fit));
check('korte datum vóór het bericht', await p.evaluate(() => { const m = document.querySelector('.feed-item .feed-meta'); return /^(\d\d:\d\d|\w{2} \d+|\d+ \w{3})$/.test(m.textContent) && m.nextElementSibling?.classList.contains('feed-title'); }), await p.evaluate(() => document.querySelector('.feed-meta').textContent));
await p.screenshot({ path: OUT + '/rss-5.png', clip: await p.evaluate(() => { const r = document.querySelector('.tile--rss').getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; }) });

// Agenda 3 breed; bij 2 kolommen 2 breed
const widths = await p.evaluate(() => { const one = document.querySelector('.tile--link').getBoundingClientRect().width; return Math.round(document.querySelector('.tile--calendar').getBoundingClientRect().width / one * 10) / 10; });
check('agenda is 3 tegels breed', widths > 3 && widths < 3.3, String(widths));

// Groter grid: 8 kolommen × 6 rijen kiezen en opslaan
await p.click('#settingsBtn'); await p.click('[data-section="appearance"]');
check('kolommen tot 12, rijen tot 8', await p.evaluate(() => [...document.querySelectorAll('[data-path="appearance.gridColumns"] option')].map(o => o.value).join() === '2,3,4,5,6,7,8,9,10,11,12' && [...document.querySelectorAll('[data-path="appearance.gridRows"] option')].map(o => o.value).join() === '2,3,4,5,6,7,8'));
await p.selectOption('[data-path="appearance.gridColumns"]', '8');
await p.selectOption('[data-path="appearance.gridRows"]', '6');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(300);
const big = await p.evaluate(() => ({ cols: getComputedStyle(document.querySelector('#tileGrid')).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth, saved: config.appearance.gridColumns === 8 && config.appearance.gridRows === 6 }));
check('grid 8 × 6 opgeslagen, zonder horizontaal scrollen', big.cols === 8 && !big.overflow && big.saved, JSON.stringify(big));
await p.screenshot({ path: OUT + '/grid-8x6.png' });
await p.evaluate(() => { const d = structuredClone(config); d.appearance.gridColumns = 2; applyConfig(normalizeConfig(d)); });
check('bij 2 kolommen is de agenda 2 breed', await p.evaluate(() => getComputedStyle(document.querySelector('#tileGrid')).gridTemplateColumns.split(' ').length === 2));

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

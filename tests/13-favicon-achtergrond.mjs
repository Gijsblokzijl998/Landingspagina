// Favicon als icoon van de RSS-tegel, datum vóór het bericht in de accentkleur, agendatijden in de accentkleur,
// geen "null" in de tegel, instelbare grootte van de agenda en een gedimde achtergrondafbeelding per tegel.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';

const png = fs.readFileSync(FIX + '/logo.png');
const nos = fs.readFileSync(FIX + '/nos.xml', 'utf8');
const ics = fs.readFileSync(FIX + '/agenda.ics', 'utf8');
const tweakers = fs.readFileSync(FIX + '/tweakers.xml', 'utf8');
const ICS_URL = 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics';

// Worker in Node met nagebootste bronnen
const store = new Map();
globalThis.caches = { default: { match: async r => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
let feedDown = false;
const upstream = [];
globalThis.fetch = async url => {
  upstream.push(url);
  const u = new URL(url);
  if (url === 'https://feeds.nos.nl/nosnieuwsalgemeen') {
    return feedDown ? new Response('kapot', { status: 503 }) : new Response(nos, { headers: { 'Content-Type': 'application/xml' } });
  }
  if (url === ICS_URL) return new Response(ics, { headers: { 'Content-Type': 'text/calendar' } });
  if (url === 'https://tweakers.net/feeds/mixed.xml') return new Response(tweakers, { headers: { 'Content-Type': 'application/rss+xml' } });
  if (u.hostname === 'tweakers.net' && u.pathname === '/') {
    // Zoals Tweakers zonder cookies: doorverwezen naar de cookiemelding van DPG Media, zonder icoon.
    const r = new Response('<html><head><title>DPG Media Privacy Gate</title></head></html>', { headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(r, 'url', { value: 'https://myprivacy.dpgmedia.nl/consent?siteKey=x' });
    return r;
  }
  if (u.hostname === 'tweakers.net') return new Response('geblokkeerd', { status: 403, headers: { 'Content-Type': 'text/html' } });
  if (u.hostname === 'nos.nl' && u.pathname === '/favicon.ico') return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  return new Response('', { status: 404, headers: { 'Content-Type': 'text/html' } });
};
const worker = (await import(WORKER_PATH)).default;
const env = { DASHBOARD_KEY: 'k' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce',  viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Amsterdam' });
await ctx.route('https://dash.test.workers.dev/**', async route => {
  const req = route.request();
  const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), env, { waitUntil() {} });
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
await p.waitForTimeout(1200);

// --- RSS-tegel: favicon als icoon ---
const heading = await p.evaluate(() => {
  const h = document.querySelector('.tile--rss .tile-heading');
  const f = h.querySelector('span > .favicon');
  return { site: h.dataset.site, tag: f?.tagName, src: f?.src?.slice(0, 5), width: f?.naturalWidth, size: f && Math.round(f.getBoundingClientRect().width) };
});
check('RSS-tegel toont het favicon van de site (nos.nl) als icoon', heading.site === 'https://nos.nl/' && heading.tag === 'IMG' && heading.src === 'blob:' && heading.width > 0, JSON.stringify(heading));
check('favicon even groot als de lijniconen in de kop', heading.size >= 14 && heading.size <= 16, String(heading.size));
check('favicon gevraagd voor de site, niet voor de feed', upstream.some(u => u === 'https://nos.nl/favicon.ico'));

// --- Datum vóór het bericht, in de accentkleur ---
const accent = () => p.evaluate(() => {
  const probe = document.body.appendChild(Object.assign(document.createElement('span'), { style: 'color: var(--accent-text)' }));
  const color = getComputedStyle(probe).color; probe.remove(); return color;
});
const feed = await p.evaluate(() => [...document.querySelectorAll('.tile--rss .feed-item')].map(i => ({ first: i.firstElementChild.className, color: getComputedStyle(i.firstElementChild).color, text: i.firstElementChild.textContent })));
const accentLight = await accent();
check('datum staat vóór elke berichttitel', feed.length > 0 && feed.every(i => i.first === 'feed-meta'), feed[0]?.first);
check('datum in de accentkleur', feed.every(i => i.color === accentLight), `${feed[0]?.color} vs ${accentLight}`);
check('datum kort: tijd, dag of datum', feed.every(i => /^(\d\d:\d\d|\w{2} \d+|\d+ \w{3}|)$/.test(i.text)), feed.map(i => i.text).slice(0, 4).join(', '));

// --- Agendatijden in de accentkleur ---
const times = await p.evaluate(() => [...document.querySelectorAll('.agenda-item')].map(i => ({ past: i.classList.contains('is-past'), color: getComputedStyle(i.querySelector('.agenda-time')).color })));
const upcoming = times.filter(t => !t.past);
check('agendatijden in de accentkleur', upcoming.length > 0 && upcoming.every(t => t.color === accentLight), `${upcoming.length} afspraken`);
// Afwijkende agendatijden: afgekapt of over meer dan één regel.
const wrappedTimes = () => p.evaluate(() => [...document.querySelectorAll('.agenda-time')].filter(t => {
  const r = document.createRange(); r.selectNodeContents(t);
  return t.scrollWidth > t.clientWidth || new Set([...r.getClientRects()].map(x => Math.round(x.top))).size !== 1;
}).map(t => t.textContent));
check('tijden op één regel, zonder af te kappen', (await wrappedTimes()).length === 0, (await wrappedTimes()).join(', '));
check('afgelopen afspraken blijven grijs', times.filter(t => t.past).every(t => t.color !== accentLight));

// Andere accentkleur volgt direct
await p.evaluate(() => { const d = structuredClone(config); d.appearance.accentColor = '#c2410c'; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(100);
const accentOrange = await accent();
check('nieuwe accentkleur ook voor datum en tijd', accentOrange !== accentLight && await p.evaluate(c => getComputedStyle(document.querySelector('.feed-meta')).color === c && getComputedStyle(document.querySelector('.agenda-item:not(.is-past) .agenda-time')).color === c, accentOrange));
await p.screenshot({ path: OUT + '/accent-rss-agenda.png', clip: await p.evaluate(() => { const a = document.querySelector('.tile--rss').getBoundingClientRect(), b = document.querySelector('.tile--calendar').getBoundingClientRect(); const x = Math.min(a.x, b.x) - 8, y = Math.min(a.y, b.y) - 8; return { x, y, width: Math.max(a.right, b.right) - x + 8, height: Math.max(a.bottom, b.bottom) - y + 8 }; }) });

// --- Geen "null" in de tegels, ook niet bij een storing met cache ---
const noNull = () => p.evaluate(() => !/null|undefined/.test(document.querySelector('#tileGrid').textContent));
check('geen "null" in de tegels', await noNull());
feedDown = true; store.clear();
await p.evaluate(() => updateFeeds({ force: true }));
await p.waitForTimeout(800);
check('geen "null" bij een storing', await noNull(), await p.evaluate(() => document.querySelector('.tile--rss .tile-body').textContent.slice(0, 80)));
await p.evaluate(() => renderFeedTiles());
check('geen "null" na opnieuw tekenen', await noNull());
feedDown = false;

// --- Agenda: breedte en hoogte instelbaar ---
const span = () => p.evaluate(() => {
  const one = document.querySelector('.tile--link').getBoundingClientRect(), cal = document.querySelector('.tile--calendar').getBoundingClientRect();
  return { cols: Math.round((cal.width + 16) / (one.width + 16) * 10) / 10, rows: Math.round((cal.height + 16) / (one.height + 16) * 10) / 10 };
});
check('agenda standaard 3 × 2', JSON.stringify(await span()) === '{"cols":3,"rows":2}', JSON.stringify(await span()));
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
const calId = await p.evaluate(() => config.tiles.find(t => t.type === 'calendar').id);
const calIndex = await p.evaluate(() => config.tiles.findIndex(t => t.type === 'calendar'));
await p.click(`[data-action="edit-tile"][data-id="${calId}"] >> nth=0`);
check('instellingen Breedte en Hoogte voor de agenda', await p.locator(`[data-path="tiles.${calIndex}.width"] option`).count() === 3 && await p.locator(`[data-path="tiles.${calIndex}.height"] option`).count() === 3);
await p.selectOption(`[data-path="tiles.${calIndex}.width"]`, '2');
await p.selectOption(`[data-path="tiles.${calIndex}.height"]`, '3');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(300);
const resized = await span();
check('agenda na opslaan 2 breed en 3 hoog', resized.cols === 2 && resized.rows === 3, JSON.stringify(resized));
check('grootte bewaard', await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('lp:config')).tiles.find(t => t.type === 'calendar'); return c.width === 2 && c.height === 3; }));
check('ongeldige grootte wordt begrensd (breedte 2–12, hoogte 2–8)', await p.evaluate(() => { const t = normalizeConfig({ ...DEFAULT_CONFIG, tiles: [{ id: 'c', type: 'calendar', title: 'A', width: 19, height: 0 }] }).tiles[0]; return t.width === 12 && t.height === 2; }));
check('cellen tellen met de ingestelde grootte', await p.evaluate(() => tileCells({ type: 'calendar', width: 4, height: 3 }, 8) === 12 && tileCells({ type: 'calendar', width: 4, height: 3 }, 2) === 6));
check('bij 2 breed passen tijden nog op één regel', (await wrappedTimes()).length === 0, (await wrappedTimes()).join(', '));
await p.screenshot({ path: OUT + '/agenda-2x3.png' });

// --- Achtergrondafbeelding per tegel ---
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
await p.click('[data-action="edit-tile"][data-id="t1"] >> nth=0');
check('groep Achtergrond in de tegel-editor', await p.locator('[data-image="tile"]').count() === 1 && await p.locator('[data-path="tiles.0.backgroundDim"]').count() === 0);
await p.setInputFiles('[data-image="tile"]', FIX + '/logo.png');
await p.waitForTimeout(500);
check('voorbeeld en dim-schuif na uploaden', await p.locator('.image-preview').count() >= 1 && await p.locator('[data-path="tiles.0.backgroundDim"]').count() === 1);
await p.fill('[data-path="tiles.0.backgroundDim"]', '60');
await p.waitForTimeout(150);
check('label toont het percentage', await p.locator('text=Dimmen (60%)').count() === 1);
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(300);
const bg = await p.evaluate(() => {
  const t = document.querySelector('[data-tile-id="t1"]'), s = getComputedStyle(t);
  const c = config.tiles.find(x => x.id === 't1');
  return { cls: t.classList.contains('has-background'), dim: t.style.getPropertyValue('--tile-dim'), image: s.backgroundImage, jpeg: resolveImage(c.background).startsWith('data:image/jpeg'), length: resolveImage(c.background).length, ref: c.background.startsWith('asset:') };
});
check('tegel heeft de achtergrond met overlay', bg.cls && bg.dim === '60%' && /linear-gradient.*url\("data:image\/jpeg/.test(bg.image), bg.image.slice(0, 80));
check('afbeelding verkleind en als JPEG bewaard (in IndexedDB)', bg.jpeg && bg.ref && bg.length < 200_000, String(bg.length));
check('andere tegels zonder achtergrond', await p.evaluate(() => [...document.querySelectorAll('.tile:not([data-tile-id="t1"])')].every(t => !t.classList.contains('has-background'))));
check('dimmen wordt begrensd (40–95)', await p.evaluate(() => normalizeConfig({ ...DEFAULT_CONFIG, tiles: [{ id: 'a', type: 'link', title: 'A', target: { kind: 'url', value: 'https://a.nl' }, background: 'data:image/png;base64,AAAA', backgroundDim: 10 }] }).tiles[0].backgroundDim === 40));
check('geen externe afbeelding als achtergrond', await p.evaluate(() => normalizeConfig({ ...DEFAULT_CONFIG, tiles: [{ id: 'a', type: 'link', title: 'A', target: { kind: 'url', value: 'https://a.nl' }, background: 'https://evil.test/x.png' }] }).tiles[0].background === ''));
for (const scheme of ['light', 'dark']) {
  await p.emulateMedia({ colorScheme: scheme });
  await p.waitForTimeout(100);
  await p.screenshot({ path: OUT + `/tegel-achtergrond-${scheme}.png` });
}
await p.emulateMedia({ colorScheme: 'light' });

// Achtergrond verwijderen
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
await p.click('[data-action="edit-tile"][data-id="t1"] >> nth=0');
await p.click('[data-action="clear-image"][data-path="tiles.0.background"]');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(200);
check('achtergrond verwijderd', await p.evaluate(() => !document.querySelector('[data-tile-id="t1"]').classList.contains('has-background') && config.tiles[0].background === ''));

// --- Iconenkiezer: Favicon voor RSS ---
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
await p.click('[data-action="edit-tile"][data-id="t5"] >> nth=0');
check('keuze "Favicon" voor de RSS-tegel, geselecteerd', (await p.getAttribute('.icon-choice[data-icon="favicon"]', 'aria-pressed')) === 'true');
await p.click('.icon-choice[data-icon="rss"]');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(200);
check('ander icoon kiezen kan nog', await p.evaluate(() => document.querySelector('.tile--rss .tile-heading svg') !== null && !document.querySelector('.tile--rss .tile-heading .favicon')));

// --- Tweakers: homepage geeft een cookiemelding, de Worker vindt geen icoon; het logo uit de feed werkt wel ---
check('logo uit de feed gelezen (RSS <image> en Atom <icon>)', await p.evaluate(([t, v]) => parseFeed(t, 'https://tweakers.net/feeds/mixed.xml').image === 'https://tweakers.net/icon-192.png' && parseFeed(v, 'https://www.theverge.com/rss/index.xml').image.startsWith('https://platform.theverge.com/'), [tweakers, fs.readFileSync(FIX + '/verge.xml', 'utf8')]));
await p.route('https://tweakers.net/icon-192.png', route => route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: png }));
await p.evaluate(() => { const d = structuredClone(config); d.tiles.push({ id: 'tw', type: 'rss', title: 'Tweakers', icon: 'favicon', feedUrl: 'https://tweakers.net/feeds/mixed.xml', maxItems: 5 }); d.appearance.gridRows = 6; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(1500);
const tw = await p.evaluate(() => { const f = document.querySelector('[data-tile-id="tw"] .tile-heading .favicon'); return { tag: f?.tagName, src: f?.getAttribute('src'), width: f?.naturalWidth, items: document.querySelectorAll('[data-tile-id="tw"] .feed-item').length }; });
check('Tweakers: favicon uit het logo van de feed, ondanks de cookiemelding', tw.tag === 'IMG' && tw.src === 'https://tweakers.net/icon-192.png' && tw.width > 0 && tw.items === 3, JSON.stringify(tw));
check('Worker vindt bij Tweakers zelf geen icoon (cookiemelding, geblokkeerd)', await p.evaluate(async () => { const r = await fetch('https://dash.test.workers.dev/favicon?url=https%3A%2F%2Ftweakers.net', { headers: { 'X-Dashboard-Key': 'k' } }); return r.status === 204; }));
// Lukt het logo niet, dan alsnog de gewone zoektocht (hier: de letter)
await p.unroute('https://tweakers.net/icon-192.png');
await p.route('https://tweakers.net/icon-192.png', route => route.fulfill({ status: 404, body: '' }));
await p.evaluate(() => renderGrid()); await p.waitForTimeout(800);
check('logo onbereikbaar: terugval op de gewone zoektocht', await p.evaluate(() => document.querySelector('[data-tile-id="tw"] .tile-heading .favicon--letter')?.textContent === 'T'));

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

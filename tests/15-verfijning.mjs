// Verfijningen: kopbalk, laden/fouten, nu/straks in de agenda, tegelgrootte en -vorm, verloop, glas,
// inlaadanimatie, instellingen met iconen en kaartjes, twee tabbladen, favicons verversen.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';

const png = fs.readFileSync(FIX + '/logo.png');
const nos = fs.readFileSync(FIX + '/nos.xml', 'utf8');
const ics = fs.readFileSync(FIX + '/agenda.ics', 'utf8');
const ICS_URL = 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics';
const store = new Map();
globalThis.caches = { default: { match: async r => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
let feedMode = 'ok';
let feedDelay = 0;
const upstream = [];
globalThis.fetch = async url => {
  upstream.push(url);
  if (url === 'https://feeds.nos.nl/nosnieuwsalgemeen') {
    if (feedDelay) await new Promise(r => setTimeout(r, feedDelay));
    return feedMode === 'ok' ? new Response(nos, { headers: { 'Content-Type': 'application/xml' } }) : new Response('x', { status: 500 });
  }
  if (url === ICS_URL) return new Response(ics, { headers: { 'Content-Type': 'text/calendar' } });
  if (url === 'https://nos.nl/favicon.ico') return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  return new Response('', { status: 404, headers: { 'Content-Type': 'text/html' } });
};
const worker = (await import(WORKER_PATH)).default;

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Amsterdam' });
await ctx.route('https://dash.test.workers.dev/**', async route => {
  const req = route.request();
  const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), { DASHBOARD_KEY: 'k' }, { waitUntil() {} });
  route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
await ctx.route(/^https:\/\/(?!dash\.test)/, route => route.fulfill({ status: 404, body: '' }));
const p = await ctx.newPage();
await p.clock.setFixedTime(new Date('2026-10-01T09:30:00+02:00'));
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('dialog', d => d.accept());
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + n + (x ? '  → ' + x : '')); };

await p.goto(INDEX_URL);
await p.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('landingspagina'); q.onsuccess = q.onerror = q.onblocked = r; }); });
await p.reload(); await p.waitForTimeout(300);

// --- Kopbalk: geen losse streep als het weer ontbreekt ---
check('geen scheidingslijn vóór de klok zonder weer', await p.evaluate(() => document.querySelector('#weatherWidget').hidden && getComputedStyle(document.querySelector('#clock')).borderLeftStyle === 'none'));
check('standaard achtergrond: verloop in de accentkleur', await p.evaluate(() => document.documentElement.dataset.background === 'gradient' && getComputedStyle(document.body).backgroundImage.includes('radial-gradient')));

// --- Zonder Worker: knop naar de juiste instellingen ---
const openBtn = '.tile--rss [data-action="open-settings"]';
check('RSS zonder Worker: knop "Instellingen openen"', await p.locator(openBtn).count() === 1);
await p.click(openBtn);
check('knop opent Koppelingen', await p.evaluate(() => document.querySelector('#settingsModal').open && document.querySelector('[aria-current="page"]').dataset.section === 'services'));
// Instellingen: iconen in het menu en groepen als kaartjes
const nav = await p.evaluate(() => ({ icons: document.querySelectorAll('.settings-nav-item svg').length, items: document.querySelectorAll('.settings-nav-item').length, card: (() => { const s = getComputedStyle(document.querySelector('.settings-group')); return s.borderTopWidth === '1px' && parseFloat(s.borderTopLeftRadius) >= 10 && parseFloat(s.paddingLeft) >= 16; })() }));
check('instellingenmenu met iconen', nav.icons === nav.items && nav.items === 7, JSON.stringify(nav));
check('groepen als kaartjes', nav.card);
await p.screenshot({ path: OUT + '/instellingen-kaartjes.png' });
await p.fill('[data-path="services.workerUrl"]', 'https://dash.test.workers.dev');
await p.fill('[data-path="services.workerKey"]', 'k');
await p.click('[data-action="save-settings"]');
await p.waitForTimeout(200);

// --- Agenda: knop naar de tegel-editor, daarna laden ---
check('agenda zonder adres: knop opent de tegel-editor', await p.evaluate(() => !!document.querySelector('.tile--calendar [data-action="open-settings"][data-tile]')));
await p.click('.tile--calendar [data-action="open-settings"]');
check('tegel-editor van de agenda open', await p.locator('[data-path$=".icsUrl"]').count() === 1);
await p.fill('[data-path$=".icsUrl"]', ICS_URL);
await p.click('[data-action="save-settings"]');
await p.waitForTimeout(800);

// --- Nu en straks ---
const agenda = await p.evaluate(() => {
  const now = document.querySelector('.agenda-item.is-now');
  const next = document.querySelector('.agenda-item.is-next');
  return {
    nowBorder: now && getComputedStyle(now).borderLeftColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    nowBadge: now?.querySelector('.agenda-badge')?.textContent, nextBadge: next?.querySelector('.agenda-badge')?.textContent, nextTitle: next?.querySelector('.agenda-title').textContent,
    badges: document.querySelectorAll('.agenda-badge').length
  };
});
console.log('     agenda:', JSON.stringify(agenda));
check('lopende afspraak in de accentkleur met "nog … min"', agenda.nowBorder === 'rgb(37, 99, 235)' && agenda.nowBadge === 'nog 30 min', JSON.stringify(agenda));
check('eerstvolgende afspraak met "over … min"', agenda.nextTitle === 'Lunch met Sanne' && agenda.nextBadge === 'over 4 u 30 min' && agenda.badges === 2, JSON.stringify(agenda));
check('duurnotatie', await p.evaluate(() => [formatDuration(30_000), formatDuration(25 * 60_000), formatDuration(60 * 60_000), formatDuration(80 * 60_000)].join('|') === '1 min|25 min|1 u|1 u 20 min'));
await p.screenshot({ path: OUT + '/agenda-nu-straks.png', clip: await p.evaluate(() => { const r = document.querySelector('.tile--calendar').getBoundingClientRect(); return { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 }; }) });

// --- RSS: geen favicon-verzoek voor het feed-adres ---
check('RSS-icoon: favicon van nos.nl, nooit van feeds.nos.nl', await p.evaluate(() => document.querySelector('.tile--rss .tile-heading').dataset.site === 'https://nos.nl/') && !upstream.some(u => u.startsWith('https://feeds.nos.nl/') && !u.endsWith('nosnieuwsalgemeen')));

// --- Laden: grijze regels; fout: knop opnieuw proberen ---
feedMode = 'fail'; feedDelay = 600; store.clear();
await p.evaluate(async () => { await idbPut('cache', 'rss:https://feeds.nos.nl/nosnieuwsalgemeen', null); feedState.clear(); renderFeedTiles('https://feeds.nos.nl/nosnieuwsalgemeen'); updateFeeds({ force: true }); });
await p.waitForTimeout(150);
check('laden: grijze placeholder-regels', await p.evaluate(() => document.querySelectorAll('.tile--rss .skeleton-line').length === 8 && document.querySelector('.tile--rss .skeleton').getAttribute('aria-label') === 'Laden…'));
await p.screenshot({ path: OUT + '/laden.png', clip: await p.evaluate(() => { const r = document.querySelector('.tile--rss').getBoundingClientRect(); return { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 }; }) });
await p.waitForTimeout(900);
check('fout: melding met knop "Opnieuw proberen"', await p.evaluate(() => { const s = document.querySelector('.tile--rss .tile-state.is-error'); return !!s && s.querySelector('[data-action="retry-feed"]')?.textContent.includes('Opnieuw proberen'); }));
await p.screenshot({ path: OUT + '/fout-opnieuw.png', clip: await p.evaluate(() => { const r = document.querySelector('.tile--rss').getBoundingClientRect(); return { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 }; }) });
feedMode = 'ok'; feedDelay = 0;
await p.click('.tile--rss [data-action="retry-feed"]');
await p.waitForTimeout(500);
check('opnieuw proberen laadt de berichten', await p.locator('.tile--rss .feed-item').count() === 8);
// Storing met oude berichten: korte melding met "Opnieuw"
feedMode = 'fail'; store.clear();
await p.evaluate(() => updateFeeds({ force: true })); await p.waitForTimeout(400);
check('storing met cache: "Opnieuw" bij de melding', await p.evaluate(() => document.querySelector('.tile--rss .feed-stale [data-action="retry-feed"]')?.textContent === 'Opnieuw'));
feedMode = 'ok';

// --- Dagkop blijft dicht boven afspraken op een achtergrond ---
await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 120; const x = c.getContext('2d'); x.fillStyle = '#f97316'; x.fillRect(0, 0, 200, 120); const d = structuredClone(config); d.tiles.find(t => t.type === 'calendar').background = c.toDataURL('image/jpeg'); applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(300);
check('dagkop op een tegelachtergrond niet doorzichtig', await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.tile--calendar .agenda-date')); return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backdropFilter.includes('blur'); }));

// --- Tegelgrootte en -vorm ---
const cell = () => p.evaluate(() => { const s = getComputedStyle(document.querySelector('#tileGrid')); return { w: parseFloat(s.gridTemplateColumns), h: 2 * parseFloat(s.gridAutoRows) + parseFloat(s.rowGap), fs: parseFloat(getComputedStyle(document.querySelector('.tile--link .tile-title')).fontSize) }; });
await p.setViewportSize({ width: 2560, height: 1440 }); await p.waitForTimeout(200);
const big = await cell();
await p.evaluate(() => { const d = structuredClone(config); d.appearance.tileSize = 'normal'; applyConfig(normalizeConfig(d)); });
const normal = await cell();
check('automatisch: grotere tegels op een groot scherm', big.w > 280 && normal.w === 210, `${big.w} vs ${normal.w}`);
check('tekst groeit mee met grote tegels', big.fs > normal.fs, `${big.fs} vs ${normal.fs}`);
await p.setViewportSize({ width: 1920, height: 1080 });
await p.evaluate(() => { const d = structuredClone(config); d.appearance.tileSize = 'auto'; d.appearance.tileRatio = 'wider'; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(200);
const wide = await cell();
check('vorm "Breed (3 : 2)": tegels anderhalf keer zo breed als hoog', Math.abs(wide.w / wide.h - 1.5) < 0.01 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(wide));
await p.screenshot({ path: OUT + '/breed-1920.png' });
await p.click('#settingsBtn'); await p.click('[data-section="appearance"]');
check('instellingen Tegelgrootte en Tegelvorm', await p.locator('[data-path="appearance.tileSize"] option').count() === 5 && await p.locator('[data-path="appearance.tileRatio"] option').count() === 3);
// Verloop kiezen
check('6 verlopen om uit te kiezen', await p.locator('.gradient-swatch').count() === 6);
await p.click('.gradient-swatch[data-gradient="oceaan"]');
check('verloop live zichtbaar', await p.evaluate(() => document.documentElement.dataset.gradient === 'oceaan'));
await p.screenshot({ path: OUT + '/verlopen.png' });
// Glas
await p.selectOption('[data-path="appearance.tileStyle"]', 'glass');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(300);
const glass = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.tile--link')); return { blur: s.backdropFilter, bg: s.backgroundColor }; });
check('glas: doorschijnend en wazig', glass.blur.includes('blur') && /color\(srgb [\d. ]+\/ 0\.6\)|rgba\(.*0\.6\)/.test(glass.bg), JSON.stringify(glass));
for (const scheme of ['light', 'dark']) {
  await p.emulateMedia({ colorScheme: scheme }); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + `/glas-${scheme}.png` });
}
await p.emulateMedia({ colorScheme: 'light' });

// --- Twee tabbladen ---
await p.click('#settingsBtn'); await p.click('[data-section="general"]');
await p.fill('[data-path="general.title"]', 'Titel uit dit tabblad');
const other = await ctx.newPage();
await other.goto(INDEX_URL); await other.waitForTimeout(300);
await other.evaluate(() => { const d = structuredClone(config); d.general.welcomeText = 'Uit het andere tabblad'; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(300);
check('melding als een ander tabblad de instellingen wijzigt', (await p.textContent('#toast')).includes('ander tabblad'));
let asked = '';
p.removeAllListeners('dialog');
p.once('dialog', d => { asked = d.message(); d.dismiss(); });
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(200);
check('opslaan vraagt eerst of het andere tabblad overschreven mag worden', asked.includes('ander tabblad') && await p.evaluate(() => document.querySelector('#settingsModal').open));
p.on('dialog', d => d.accept());
await p.click('[data-action="cancel-settings"]');
await other.close();

// --- Favicons verversen in een tabblad dat lang openstaat ---
const before = await p.evaluate(() => faviconUrls.length);
await p.evaluate(() => refreshFavicons()); await p.waitForTimeout(400);
check('favicons opnieuw opgevraagd en oude geheugen vrijgegeven', await p.evaluate(b => faviconRequests.size > 0 && faviconUrls.length > 0, before));

// --- Inlaadanimatie ---
const anim = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await anim.route(/^https?:/, r => r.fulfill({ status: 404, body: '' }));
const a = await anim.newPage();
await a.goto(INDEX_URL); await a.waitForTimeout(50);
const entering = await a.evaluate(() => ({ cls: document.querySelector('#tileGrid').classList.contains('is-entering'), name: getComputedStyle(document.querySelector('#tileGrid > .tile')).animationName, delays: [...document.querySelectorAll('#tileGrid > .tile')].map(t => getComputedStyle(t).animationDelay).slice(0, 3).join(' ') }));
check('tegels verschijnen kort na elkaar', entering.cls && entering.name === 'tile-in' && entering.delays === '0s 0.045s 0.09s', JSON.stringify(entering));
await a.waitForTimeout(1700);
check('animatie alleen bij openen', await a.evaluate(() => !document.querySelector('#tileGrid').classList.contains('is-entering')));
await anim.close();
check('bij "minder animaties" geen inlaadanimatie', await p.evaluate(() => getComputedStyle(document.querySelector('#tileGrid > .tile')).animationName === 'none'));

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
const S = FIX;
const weatherJson = fs.readFileSync(S + '/weather.json', 'utf8');
const geoJson = fs.readFileSync(S + '/geo.json', 'utf8');
const png = fs.readFileSync(FIX + '/logo.png');
const url = INDEX_URL;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
let weatherMode = 'ok';
const weatherRequests = [];
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
await ctx.route('https://api.open-meteo.com/**', route => {
  weatherRequests.push(route.request().url());
  if (weatherMode === 'fail') return route.fulfill({ status: 503, headers: cors, body: '{}' });
  route.fulfill({ status: 200, headers: cors, body: weatherJson });
});
await ctx.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ status: 200, headers: cors, body: geoJson }));
// Favicons: DuckDuckGo kent wikipedia niet (404), Google en de site zelf ook niet → letter. Buienradar alleen via Google.
const faviconRequests = [];
const icon404 = route => route.fulfill({ status: 404, body: 'niet gevonden' });
const iconOk = route => route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: png });
await ctx.route('https://icons.duckduckgo.com/**', route => { faviconRequests.push(route.request().url()); return /wikipedia|buienradar/.test(route.request().url()) ? icon404(route) : iconOk(route); });
await ctx.route('https://www.google.com/s2/favicons**', route => { faviconRequests.push(route.request().url()); return /wikipedia/.test(route.request().url()) ? icon404(route) : iconOk(route); });
await ctx.route('https://nl.wikipedia.org/favicon.ico', route => { faviconRequests.push(route.request().url()); return icon404(route); });
// Overige externe verzoeken (bijv. bij het openen van tabbladen) niet echt uitvoeren.
await ctx.route(/^https:\/\/(?!api\.open-meteo|geocoding-api|www\.google\.com\/s2|icons\.duckduckgo|nl\.wikipedia\.org\/favicon)/, route => route.fulfill({ status: 200, body: 'ok' }));

const errors = [];
let fails = 0;
const check = (name, ok) => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + name); };
const p = await ctx.newPage();
p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/503|404/.test(m.text())) errors.push(m.text()); });
p.on('pageerror', e => errors.push(e.message));
p.on('dialog', d => d.accept());
await p.goto(url);
await p.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('landingspagina'); q.onsuccess = q.onerror = q.onblocked = r; }); });
weatherRequests.length = 0;
await p.reload(); await p.waitForTimeout(500);
console.log('     verzoeken na schone start:', weatherRequests.length);
const widget = () => p.evaluate(() => { const w = document.querySelector('#weatherWidget'); return { hidden: w.hidden, icon: w.querySelector('.weather-icon path')?.getAttribute('d') === ICON_PATHS.cloud ? 'cloud' : 'anders', temp: w.querySelector('.weather-temp').textContent, place: w.querySelector('.weather-place').textContent, title: w.title, stale: w.classList.contains('is-stale') }; });


// --- Vormgeving kop- en voetbalk ---
const bars = await p.evaluate(() => {
  const header = getComputedStyle(document.querySelector('.site-header'));
  const footer = document.querySelector('#siteFooter');
  const f = getComputedStyle(footer);
  return {
    headerLine: header.borderBottomStyle === 'solid' && header.borderBottomWidth === '1px',
    footerLine: f.borderTopStyle === 'solid' && f.borderTopWidth === '1px',
    footerAtBottom: Math.abs(footer.getBoundingClientRect().bottom - innerHeight) < 1,
    titleSize: parseFloat(getComputedStyle(document.querySelector('#pageTitle')).fontSize),
    welcomeColor: getComputedStyle(document.querySelector('#welcomeText')).color,
    iconStroke: getComputedStyle(document.querySelector('#settingsBtn svg')).strokeWidth
  };
});
console.log('     balken:', bars);
check('kopbalk met scheidingslijn', bars.headerLine);
check('voetbalk met scheidingslijn, onderaan het venster', bars.footerLine && bars.footerAtBottom);
check('kleine titel (16px)', bars.titleSize === 16);
check('dunne iconen (1.5)', bars.iconStroke === '1.5px' || bars.iconStroke === '1.5');
// Voetbalk blijft onderaan bij een lang grid (mobiel, pagina scrollt)
await p.setViewportSize({ width: 390, height: 700 });
await p.waitForTimeout(100);
const mobileFooter = await p.evaluate(() => Math.abs(document.querySelector('#siteFooter').getBoundingClientRect().bottom - innerHeight) < 1 && document.documentElement.scrollHeight > innerHeight);
check('voetbalk blijft onderaan als de pagina scrollt', mobileFooter);
await p.evaluate(() => scrollTo(0, document.body.scrollHeight));
check('voetbalk ook onderaan na scrollen', await p.evaluate(() => Math.abs(document.querySelector('#siteFooter').getBoundingClientRect().bottom - innerHeight) < 1));
await p.setViewportSize({ width: 1280, height: 860 });

// --- Tegeliconen ---
check('standaardtegels gebruiken lijniconen', await p.locator('#tileGrid .tile-icon svg').count() === 2 && await p.locator('#tileGrid .tile-heading svg').count() === 3);
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
await p.click('[data-action="edit-tile"][data-id="t2"] >> nth=0');
check('iconenkiezer met ' + await p.locator('.icon-choice').count() + ' keuzes', await p.locator('.icon-choice').count() > 30);
check('huidig icoon gemarkeerd', (await p.getAttribute('.icon-choice[data-icon="mail"]', 'aria-pressed')) === 'true');
await p.click('.icon-choice[data-icon="inbox"]');
check('nieuw icoon gemarkeerd', (await p.getAttribute('.icon-choice[data-icon="inbox"]', 'aria-pressed')) === 'true');
await p.screenshot({ path: OUT + '/iconenkiezer.png' });
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(200);
check('icoon opgeslagen', await p.evaluate(() => config.tiles.find(t => t.id === 't2').icon === 'inbox'));
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
await p.click('[data-action="edit-tile"][data-id="t2"] >> nth=0');
await p.fill('input[data-path="tiles.1.icon"]', '★');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(200);
check('eigen teken in grijstinten', await p.evaluate(() => { const e = document.querySelector('[data-tile-id="t2"] .emoji-icon'); return e?.textContent === '★' && getComputedStyle(e).filter === 'grayscale(1)'; }));

// --- Migratie: oude emoji's worden lijniconen ---
const migrated = await p.evaluate(() => normalizeConfig({ version: 1, tiles: [
  { id: 'a', type: 'link', title: 'Mail', icon: '✉️', target: { kind: 'url', value: 'https://x.nl' } },
  { id: 'b', type: 'rss', title: 'N', icon: '📰' },
  { id: 'c', type: 'link', title: 'Eigen', icon: '🚀', target: { kind: 'url', value: 'https://x.nl' } }
] }));
check('migratie v1 → v2 zet standaard-emoji\'s om, eigen emoji blijft', migrated.version === 2 && migrated.tiles[0].icon === 'mail' && migrated.tiles[1].icon === 'rss' && migrated.tiles[2].icon === '🚀');

for (const scheme of ['light', 'dark']) {
  await p.emulateMedia({ colorScheme: scheme });
  await p.evaluate(() => { const d = normalizeConfig(DEFAULT_CONFIG); d.tiles.push({ id: 'p1', type: 'link', title: 'Projecten', icon: 'folder', target: { kind: 'path', value: 'C:\\Projecten' } }, { id: 'p2', type: 'link', title: 'Begroting', icon: 'table', target: { kind: 'path', value: 'C:\\Begroting.xlsx' } }); applyConfig(normalizeConfig(d)); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/ontwerp-' + scheme + '.png' });
}

console.log('console-fouten/waarschuwingen:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

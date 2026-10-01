import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
const S = FIX;
const weatherJson = fs.readFileSync(S + '/weather.json', 'utf8');
const geoJson = fs.readFileSync(S + '/geo.json', 'utf8');
const png = fs.readFileSync(FIX + '/logo.png');
const url = INDEX_URL;
const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce',  viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
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
// Zonder Worker: Google (host, dan hoofddomein) → DuckDuckGo → de site zelf → letter.
// Google kent wikipedia en buienradar niet; DuckDuckGo kent buienradar wel.
await ctx.route('https://t1.gstatic.com/**', route => { faviconRequests.push(route.request().url()); return /wikipedia|buienradar/.test(decodeURIComponent(route.request().url())) ? icon404(route) : iconOk(route); });
await ctx.route('https://icons.duckduckgo.com/**', route => { faviconRequests.push(route.request().url()); return /wikipedia/.test(route.request().url()) ? icon404(route) : iconOk(route); });
await ctx.route('https://nl.wikipedia.org/favicon.ico', route => { faviconRequests.push(route.request().url()); return icon404(route); });
// Overige externe verzoeken (bijv. bij het openen van tabbladen) niet echt uitvoeren.
await ctx.route(/^https:\/\/(?!api\.open-meteo|geocoding-api|t1\.gstatic\.com|icons\.duckduckgo|nl\.wikipedia\.org\/favicon)/, route => route.fulfill({ status: 200, body: 'ok' }));

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

// --- Gevraagde aanpassingen ---
const header = await p.evaluate(() => { const a = document.querySelector('#pageTitle').getBoundingClientRect(), b = document.querySelector('#welcomeText').getBoundingClientRect(); return { sameLine: Math.abs(a.bottom - b.bottom) < 8, titleLeft: a.right <= b.left }; });
check('titel en welkomsttekst op één regel naast elkaar', header.sameLine && header.titleLeft);
const links = await p.evaluate(() => [...document.querySelectorAll('#tileGrid a, #quickLinksBar a')].map(a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })));
check('alle links openen in een nieuw tabblad (' + links.length + ')', links.length > 0 && links.every(l => l.target === '_blank' && l.rel.includes('noopener')));
check('favicon of letter bij elke snelle link', await p.locator('#quickLinksBar a .favicon').count() === 4);
check('favicons in link-tegel', await p.locator('[data-tile-id="t4"] .tile-list .favicon').count() === 3);
await p.waitForTimeout(300);
const fav = await p.evaluate(() => [...document.querySelectorAll('#quickLinksBar .favicon')].map(f => f.tagName === 'IMG' ? f.src : 'letter:' + f.textContent));
console.log('     favicons:', fav);
check('eerste bron Google voor de host', fav[0] === 'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&size=32&url=https%3A%2F%2Fwww.google.com');
check('Google kent hem niet → hoofddomein → DuckDuckGo (Buienradar)', fav[2] === 'https://icons.duckduckgo.com/ip3/www.buienradar.nl.ico'
  && faviconRequests.some(u => u.includes('url=https%3A%2F%2Fbuienradar.nl')));
// Playwright onderschept geen aanvragen naar favicon.ico; daarom de geprobeerde bronnen van het plaatje zelf volgen.
const wikiSteps = await p.evaluate(async () => {
  const img = buildFavicon('https://nl.wikipedia.org/');
  const steps = [];
  new MutationObserver(() => steps.push(img.getAttribute('src'))).observe(img, { attributes: true, attributeFilter: ['src'] });
  await new Promise(r => setTimeout(r, 1200));
  return steps;
});
check('laatste terugval: letter (Wikipedia), na ook /favicon.ico van de site', fav[1] === 'letter:W' && wikiSteps.at(-1) === 'https://nl.wikipedia.org/favicon.ico', wikiSteps.join(' → '));
const filterOf = sel => p.evaluate(s => getComputedStyle(document.querySelector(s)).filter, sel);
check('favicon grijs in rust', (await filterOf('#quickLinksBar .favicon')) === 'grayscale(1)');
await p.hover('#quickLinksBar a >> nth=0'); await p.waitForTimeout(300);
check('favicon in kleur bij hover (snelle link)', (await filterOf('#quickLinksBar .favicon')) === 'none');
await p.hover('[data-tile-id="t4"] .tile-list a >> nth=0'); await p.waitForTimeout(300);
check('favicon in kleur bij hover (link-tegel)', (await filterOf('[data-tile-id="t4"] .tile-list .favicon')) === 'none');
await p.mouse.move(5, 500);
check('Office-link zonder leeg tabblad', await p.evaluate(() => linkAttributes('ms-excel:ofe|u|file:///C:/a.xlsx').target === undefined));

// --- Fase 5: weer ---
let w = await widget();
console.log('     widget:', w.icon, w.temp, w.place, '|', w.title.replace(/\n/g, ' | '));
check('weer zichtbaar met temperatuur en plaats', !w.hidden && w.temp === '20°' && w.place === 'Amsterdam' && w.icon === 'cloud');
check('geen tooltip meer bij het weer', w.title === '');
check('verzoek met juiste parameters', weatherRequests.length === 1 && weatherRequests[0].includes('latitude=52.374') && weatherRequests[0].includes('timezone=auto') && !weatherRequests[0].includes('daily'));

// Cache: herladen haalt niet opnieuw op en toont direct
weatherRequests.length = 0;
await p.reload(); await p.waitForTimeout(400);
w = await widget();
check('na herladen uit cache, geen nieuw verzoek', !w.hidden && w.temp === '20°' && weatherRequests.length === 0);

// Verouderde cache + storing: laatste waarde blijft, gemarkeerd
await p.evaluate(async () => { const c = await idbGet('cache', 'weather'); c.fetchedAt -= 3 * 3600_000; await idbPut('cache', 'weather', c); });
weatherMode = 'fail';
await p.reload(); await p.waitForTimeout(500);
w = await widget();
check('storing: oude waarde blijft zichtbaar als verouderd', !w.hidden && w.stale);
weatherMode = 'ok';

// Geen cache + storing: widget verborgen, pagina werkt
await p.evaluate(async () => { await idbPut('cache', 'weather', null); });
weatherMode = 'fail';
await p.reload(); await p.waitForTimeout(500);
check('storing zonder cache: widget verborgen', (await widget()).hidden);
weatherMode = 'ok';
await p.evaluate(() => updateWeather({ force: true })); await p.waitForTimeout(300);
check('na herstel weer zichtbaar', !(await widget()).hidden);

// Klik op widget opent weerinstellingen; plaats zoeken
await p.click('#settingsBtn'); await p.click('[data-section="weather"]');
check('instellingen Weer & klok bereikbaar', await p.isVisible('#placeSearch'));
await p.fill('#placeSearch', 'Utrecht'); await p.waitForTimeout(700);
const options = await p.locator('.place-option').allInnerTexts();
console.log('     zoekresultaten:', options.map(o => o.replace(/\n/g, ' – ')));
check('zoekresultaten zonder vliegveld', options.length === 3 && options[0].includes('Utrecht, Nederland'));
await p.click('.place-option >> nth=0');
check('gekozen plaats getoond', (await p.textContent('.place-search .static-value')) === 'Gekozen: Utrecht');
await p.selectOption('[data-path="weather.unit"]', 'fahrenheit');
weatherRequests.length = 0;
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(500);
check('nieuwe plaats + eenheid opgehaald', weatherRequests.length === 1 && weatherRequests[0].includes('latitude=52.09083') && weatherRequests[0].includes('temperature_unit=fahrenheit'));
check('widget toont Utrecht', (await widget()).place === 'Utrecht');

// Weer uitzetten
await p.click('#settingsBtn'); await p.click('[data-section="weather"]');
await p.uncheck('[data-path="weather.enabled"]');
weatherRequests.length = 0;
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(300);
check('weer uit: verborgen en geen verzoek', (await widget()).hidden && weatherRequests.length === 0);
await p.click('#settingsBtn'); await p.click('[data-section="weather"]');
await p.check('[data-path="weather.enabled"]');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(400);

// Favicons uitzetten
await p.click('#settingsBtn'); await p.click('[data-section="appearance"]');
await p.uncheck('[data-path="appearance.favicons"]');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(200);
check('favicons uit', await p.locator('.favicon').count() === 0);
await p.click('#settingsBtn'); await p.click('[data-section="appearance"]');
await p.check('[data-path="appearance.favicons"]');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(300);

for (const scheme of ['light', 'dark']) {
  await p.emulateMedia({ colorScheme: scheme });
  await p.hover('#quickLinksBar a >> nth=1'); await p.waitForTimeout(250);
  await p.screenshot({ path: OUT + '/fase5-' + scheme + '.png' });
}
await p.setViewportSize({ width: 390, height: 844 });
await p.screenshot({ path: OUT + '/fase5-mobiel.png' });

console.log('console-fouten/waarschuwingen:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

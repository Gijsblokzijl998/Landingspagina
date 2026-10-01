import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
const S = FIX;
const nos = fs.readFileSync(S + '/nos.xml', 'utf8');
const verge = fs.readFileSync(S + '/verge.xml', 'utf8');
const rdf = '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="x"><title>RDF-feed</title></channel><item rdf:about="https://rdf.example/1"><title>Eerste RDF-bericht</title><link>https://rdf.example/1</link><dc:date>2026-09-30T08:00:00Z</dc:date></item></rdf:RDF>';
const atomHtml = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog &amp;amp; meer</title><entry><title type="html">&lt;b&gt;Vet&lt;/b&gt; &amp;amp; snel</title><link href="/post/1"/><updated>2026-10-01T09:00:00Z</updated></entry><entry><title>Zonder link</title></entry></feed>';
const evil = '<rss version="2.0"><channel><title>X</title><item><title>&lt;img src=x onerror=alert(1)&gt;Kop</title><link>javascript:alert(1)</link></item></channel></rss>';

// --- Worker in Node; de bronnen zijn nagebootst ---
const store = new Map();
globalThis.caches = { default: { match: async r => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const upstream = { calls: [], down: new Set() };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const host = new URL(url).hostname;
  upstream.calls.push(url);
  if (upstream.down.has(host)) throw new TypeError('netwerkfout');
  const feeds = { 'feeds.nos.nl': nos, 'www.theverge.com': verge, 'rdf.example': rdf };
  if (feeds[host]) return new Response(feeds[host], { headers: { 'Content-Type': 'application/xml' } });
  if (host === 'geenfeed.example') return new Response('<!doctype html><html><body>Hallo</body></html>', { headers: { 'Content-Type': 'text/html' } });
  return new Response('niet gevonden', { status: 404 });
};
const worker = (await import(WORKER_PATH)).default;
const env = { DASHBOARD_KEY: 'sleutel-7', EXTRA_ICS_HOSTS: '' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce',  viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
await ctx.route('https://dash.test.workers.dev/**', async route => {
  const req = route.request();
  const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), env, { waitUntil() {} });
  route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
await ctx.route(/^https:\/\/(?!dash\.test)/, route => route.fulfill({ status: 404, body: '' }));
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + name + (extra ? '  → ' + extra : '')); };
const p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
p.on('dialog', d => { errors.push('dialoog: ' + d.message()); d.dismiss(); });
p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]|net::|Failed to load/.test(m.text())) errors.push(m.text()); });
await p.goto(INDEX_URL);
await p.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('landingspagina'); q.onsuccess = q.onerror = q.onblocked = r; }); });
await p.reload(); await p.waitForTimeout(300);

// --- parseFeed ---
const parsed = await p.evaluate(([nos, verge, rdf, atomHtml, evil]) => {
  const tryParse = (xml, url) => { try { return parseFeed(xml, url); } catch (error) { return { error: error.message }; } };
  return {
    nos: tryParse(nos, 'https://feeds.nos.nl/nosnieuwsalgemeen'),
    verge: tryParse(verge, 'https://www.theverge.com/rss/index.xml'),
    rdf: tryParse(rdf, 'https://rdf.example/feed'),
    atomHtml: tryParse(atomHtml, 'https://blog.example/feed.xml'),
    evil: tryParse(evil, 'https://x.example/'),
    broken: tryParse('<rss><channel><title>kapot', 'https://x/'),
    html: tryParse('<html><body>geen feed</body></html>', 'https://x/')
  };
}, [nos, verge, rdf, atomHtml, evil]);
console.log('     NOS 1e bericht:', parsed.nos.items[0]);
console.log('     Verge 1e bericht:', parsed.verge.items[0]);
check('RSS 2.0 (NOS): titel en 20 berichten met link en datum', parsed.nos.title === 'NOS Nieuws' && parsed.nos.items.length === 20 && parsed.nos.items.every(i => i.title && i.link.startsWith('https://nos.nl/') && i.date));
check('Atom (The Verge): 10 berichten, alternate-link, datum', parsed.verge.title === 'The Verge' && parsed.verge.items.length === 10 && parsed.verge.items[0].link.startsWith('https://www.theverge.com/') && parsed.verge.items.every(i => i.date));
check('RSS 1.0 (RDF) met dc:date', parsed.rdf.title === 'RDF-feed' && parsed.rdf.items.length === 1 && parsed.rdf.items[0].date === '2026-09-30T08:00:00.000Z');
check('Atom type=html: tekst zonder tags, entiteiten opgelost', parsed.atomHtml.items[0].title === 'Vet & snel' && parsed.atomHtml.title === 'Blog & meer', JSON.stringify(parsed.atomHtml.items[0]));
check('relatieve link wordt absoluut', parsed.atomHtml.items[0].link === 'https://blog.example/post/1');
check('HTML in titel wordt tekst (geen element)', parsed.evil.items[0].title === 'Kop');
check('kapotte XML → nette fout', parsed.broken.error?.includes('geen geldige'), parsed.broken.error);
check('HTML-pagina → nette fout', parsed.html.error?.includes('webpagina'), parsed.html.error);

// --- Dashboard ---
await p.evaluate(() => {
  const data = normalizeConfig(DEFAULT_CONFIG);
  data.services = { workerUrl: 'https://dash.test.workers.dev', workerKey: 'sleutel-7' };
  data.tiles.push({ id: 'verge', type: 'rss', title: 'The Verge', icon: 'rss', feedUrl: 'https://www.theverge.com/rss/index.xml', maxItems: 5 });
  applyConfig(normalizeConfig(data));
});
await p.waitForTimeout(600);
const nosTile = () => p.evaluate(() => {
  const body = document.querySelector('[data-tile-id="t5"] .tile-body');
  return { items: [...body.querySelectorAll('.feed-item')].map(a => ({ title: a.querySelector('.feed-title').textContent, href: a.getAttribute('href'), target: a.target, time: a.querySelector('.feed-meta')?.textContent })), state: body.querySelector('.tile-state')?.textContent ?? null, stale: body.querySelector('.feed-stale')?.textContent ?? null, error: !!body.querySelector('.is-error') };
});
let t = await nosTile();
console.log('     NOS-tegel:', t.items.slice(0, 2));
check('NOS-tegel toont 8 berichten (maxItems)', t.items.length === 8 && t.items[0].title === parsed.nos.items[0].title);
check('berichten openen in nieuw tabblad', t.items.every(i => i.target === '_blank' && i.href.startsWith('https://nos.nl/')));
check('korte datum getoond', t.items.every(i => i.time && /^(\d\d:\d\d|\w{2} \d+|\d+ \w{3})$/.test(i.time)), t.items[0].time);
check('Verge-tegel toont 5 berichten', await p.locator('[data-tile-id="verge"] .feed-item').count() === 5);
const unsafe = await p.evaluate(evil => {
  feedState.set('https://evil.example/', { fetchedAt: Date.now(), feed: parseFeed(evil, 'https://evil.example/'), error: null });
  const content = [buildFeedContent({ type: 'rss', feedUrl: 'https://evil.example/', maxItems: 5 })].flat();
  const holder = el('div', {}, content);
  return { links: holder.querySelectorAll('a').length, imgs: holder.querySelectorAll('img').length, text: holder.textContent };
}, evil);
check('onveilige link (javascript:) wordt geen link, geen HTML-injectie', unsafe.links === 0 && unsafe.imgs === 0 && unsafe.text.includes('Kop'), JSON.stringify(unsafe));
await p.screenshot({ path: OUT + '/fase7-licht.png' });
await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(100);
await p.screenshot({ path: OUT + '/fase7-donker.png' });
await p.emulateMedia({ colorScheme: 'light' });

// Cache: na herladen direct zichtbaar, zonder nieuw verzoek
const callsBefore = upstream.calls.length;
store.clear(); // ook de Worker-cache leeg, zodat elk verzoek bij de bron zou aankomen
await p.reload(); await p.waitForTimeout(400);
t = await nosTile();
check('na herladen uit cache, geen nieuw verzoek', t.items.length === 8 && upstream.calls.length === callsBefore);

// Storing bij de bron: oude berichten blijven met melding
upstream.down.add('feeds.nos.nl');
await p.evaluate(() => updateFeeds({ force: true })); await p.waitForTimeout(400);
t = await nosTile();
check('storing: oude berichten blijven met melding', t.items.length === 8 && t.stale?.startsWith('Bijwerken mislukt'), t.stale);
upstream.down.delete('feeds.nos.nl');
await p.evaluate(() => updateFeeds({ force: true })); await p.waitForTimeout(400);
check('na herstel melding weg', (await nosTile()).stale === null);

// Fout zonder cache: melding van de Worker
await p.evaluate(() => { const d = structuredClone(config); d.tiles.find(t => t.id === 't5').feedUrl = 'https://bestaatniet.example/rss'; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(500);
t = await nosTile();
check('bron 404: duidelijke foutmelding', t.error && t.state.includes('De bron gaf status 404.'), t.state);
await p.evaluate(() => { const d = structuredClone(config); d.tiles.find(t => t.id === 't5').feedUrl = 'https://geenfeed.example/'; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(500);
t = await nosTile();
check('HTML in plaats van feed: duidelijke foutmelding', t.error && t.state.includes('webpagina'), t.state);

// Verkeerde sleutel
await p.evaluate(() => { const d = structuredClone(config); d.tiles.find(t => t.id === 't5').feedUrl = 'https://rdf.example/feed'; d.services.workerKey = 'fout'; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(500);
t = await nosTile();
check('verkeerde sleutel: melding', t.error && t.state.includes('sleutel klopt niet'), t.state);

// Zonder Worker: uitleg
await p.evaluate(() => { const d = structuredClone(config); d.services.workerUrl = ''; applyConfig(normalizeConfig(d)); });
t = await nosTile();
check('zonder Worker: uitleg', t.state?.includes('Koppel eerst de Worker'));

// Geen dubbele verzoeken bij gelijktijdige updates
await p.evaluate(() => { const d = structuredClone(config); d.services = { workerUrl: 'https://dash.test.workers.dev', workerKey: 'sleutel-7' }; d.tiles.find(t => t.id === 't5').feedUrl = 'https://rdf.example/feed'; config = normalizeConfig(d); });
store.clear();
const before = upstream.calls.filter(u => u === 'https://rdf.example/feed').length;
await p.evaluate(() => Promise.all([updateFeeds({ force: true }), updateFeeds({ force: true }), updateFeeds({ force: true })]));
check('gelijktijdige updates halen een feed maar één keer op', upstream.calls.filter(u => u === 'https://rdf.example/feed').length - before === 1);

// relativeTime
const rel = await p.evaluate(() => { const now = new Date('2026-10-01T12:00:00'); return [0.2, 12, 180, 26 * 60, 3 * 1440, 20 * 1440].map(m => feedDate(new Date(now - m * 60_000), now)); });
console.log('     korte datums:', rel);
check('korte datums (tijd vandaag, dag deze week, anders datum)', rel.join(' | ') === '11:59 | 11:48 | 09:00 | wo 30 | ma 28 | 11 sep', rel.join(' | '));

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

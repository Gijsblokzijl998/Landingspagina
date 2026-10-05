// Vaste tegelmaat: alleen het ingestelde grid (kolommen × rijen, tegelgrootte, tegelvorm) en het venster bepalen
// hoe groot een tegel is. Een tegel groter maken of verslepen maakt andere tegels niet kleiner. Grid tot 12 kolommen.
import { chromium } from 'playwright';
import { INDEX_URL, OUT } from './helpers.mjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1366, height: 768 } });
await ctx.route(/^https?:/, r => r.fulfill({ status: 404, body: '' }));
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('dialog', d => d.accept());
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + n + (x ? '  → ' + x : '')); };

await p.goto(INDEX_URL);
await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(300);
const size = id => p.evaluate(id => { const r = document.querySelector(`[data-tile-id="${id}"]`).getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; }, id);
const setCalendar = (w, h) => p.evaluate(([w, h]) => { const d = structuredClone(config); Object.assign(d.tiles.find(t => t.type === 'calendar'), { width: w, height: h }); applyConfig(normalizeConfig(d)); }, [w, h]);

// --- Agenda groter maken ---
const start = await size('t2');
const seen = [];
for (const [w, h] of [[3, 3], [4, 3], [2, 2], [3, 2]]) {
  await setCalendar(w, h); await p.waitForTimeout(80);
  seen.push(`${w}×${h}: ${await size('t2')}`);
}
console.log('     Outlook-tegel bij agenda', seen.join(' | '));
check('agenda groter of kleiner: andere tegels blijven even groot', seen.every(s => s.endsWith(start)), `${start} → ${seen.join(', ')}`);

// --- Verslepen naar een lege rij onderaan ---
const grid = await p.evaluate(() => { const g = document.querySelector('#tileGrid'); const s = getComputedStyle(g); return { rows: s.gridTemplateRows.split(' ').length, height: Math.round(g.getBoundingClientRect().height), cell: parseFloat(s.gridTemplateColumns), gap: parseFloat(s.rowGap) }; });
check('alle ingestelde rijen bestaan, ook lege (4 rijen = 8 halve rijen)', grid.rows === 8 && Math.abs(grid.height - (4 * grid.cell + 3 * grid.gap)) <= 1, JSON.stringify(grid));
await p.evaluate(() => { const d = structuredClone(config); d.tiles.find(t => t.id === 't3').position = { col: 1, row: 7 }; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(80);
check('tegel in de onderste, lege rij: andere tegels blijven even groot', await size('t2') === start, await size('t2'));

// --- Grid tot 12 kolommen, zonder horizontaal scrollen ---
for (const [w, h] of [[1920, 1080], [1024, 768]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.evaluate(() => { const d = structuredClone(config); d.appearance.gridColumns = 12; d.tiles.find(t => t.id === 't3').position = { col: 12, row: 1 }; applyConfig(normalizeConfig(d)); });
  await p.waitForTimeout(100);
  const wide = await p.evaluate(() => ({ cols: getComputedStyle(document.querySelector('#tileGrid')).gridTemplateColumns.split(' ').length, width: Math.round(document.querySelector('#tileGrid').getBoundingClientRect().width), hscroll: document.documentElement.scrollWidth > innerWidth, t3: document.querySelector('[data-tile-id="t3"]').style.getPropertyValue('--col') }));
  check(`${w} px: 12 kolommen, tegel in kolom 12, geen horizontale scrollbalk`, wide.cols === 12 && !wide.hscroll && wide.t3 === '12', JSON.stringify(wide));
  if (w === 1920) {
    check('op 1920 px gebruikt het grid nu bijna de hele breedte', wide.width > 1800, String(wide.width));
    await p.screenshot({ path: OUT + '/grid-12-kolommen.png' });
  }
}
await p.reload(); await p.waitForTimeout(200);
check('positie in kolom 12 blijft bewaard na herladen', await p.evaluate(() => config.tiles.find(t => t.id === 't3').position?.col === 12));
await p.setViewportSize({ width: 1366, height: 768 });
await p.evaluate(() => { const d = structuredClone(config); d.appearance.gridColumns = 4; delete d.tiles.find(t => t.id === 't3').position; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(100);

// --- Kop- en voetbalk gemeten, niet geschat ---
const chrome = await p.evaluate(() => {
  const m = getComputedStyle(document.querySelector('#mainContainer'));
  const actual = document.querySelector('.site-header').offsetHeight + document.querySelector('#siteFooter').offsetHeight + parseFloat(m.paddingTop) + parseFloat(m.paddingBottom);
  return { actual, reserved: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-h')) };
});
check('ruimte voor kop- en voetbalk is gemeten', Math.abs(chrome.reserved - chrome.actual - 2) <= 1, JSON.stringify(chrome));
const withFooter = await size('t2');
await p.evaluate(() => { const d = structuredClone(config); d.quickLinks.enabled = false; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(150);
const withoutFooter = await size('t2');
check('zonder voetbalk worden de tegels groter (ruimte niet verspild)', parseInt(withoutFooter) > parseInt(withFooter), `${withFooter} → ${withoutFooter}`);
await p.evaluate(() => { const d = structuredClone(config); d.quickLinks.enabled = true; applyConfig(normalizeConfig(d)); });

// --- Agenda-editor: alleen maten die in het grid passen; te grote agenda wordt binnen het grid getoond ---
await p.click('#settingsBtn'); await p.click('[data-section="appearance"]');
await p.selectOption('[data-path="appearance.gridRows"]', '3');
await p.click('[data-section="tiles"]');
await p.click('[data-action="edit-tile"][data-id="t1"] >> nth=0');
const opts = await p.evaluate(() => ({ w: [...document.querySelectorAll('[data-path$=".width"] option')].map(o => o.value).join(), h: [...document.querySelectorAll('[data-path$=".height"] option')].map(o => o.value).join() }));
check('keuzes voor breedte en hoogte volgen het grid (4 × 3)', opts.w === '2,3,4' && opts.h === '2,3', JSON.stringify(opts));
await p.click('[data-action="cancel-settings"]');
await p.evaluate(() => { const d = structuredClone(config); d.appearance.gridRows = 3; Object.assign(d.tiles.find(t => t.type === 'calendar'), { width: 3, height: 6 }); applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(100);
check('agenda hoger dan het grid: binnen het grid getoond (zoals bij de breedte)', await p.evaluate(() => document.querySelector('.tile--calendar').style.getPropertyValue('--span-rows') === '6'), await p.evaluate(() => document.querySelector('.tile--calendar').style.getPropertyValue('--span-rows')));

// --- Geen kopieerknop meer op pad-tegels ---
await p.evaluate(() => { const d = structuredClone(config); d.tiles.push({ id: 'pad', type: 'link', title: 'Projecten', icon: 'folder', target: { kind: 'path', value: 'C:\\\\Projecten' } }); d.appearance.gridRows = 4; Object.assign(d.tiles.find(t => t.type === 'calendar'), { height: 2 }); applyConfig(normalizeConfig(d)); });
await p.hover('[data-tile-id="pad"]'); await p.waitForTimeout(150);
check('pad-tegel: geen kopieerknop bij aanwijzen', await p.locator('[data-tile-id="pad"] button').count() === 0);

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

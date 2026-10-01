import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.route(/^https:/, r => r.fulfill({ status: 404, body: '' }));
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + n + (x ? '  → ' + x : '')); };
await p.goto(INDEX_URL);
await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(200);
// Titel + welkom gecentreerd
const c = await p.evaluate(() => { const t = document.querySelector('#pageTitle').getBoundingClientRect(), w = document.querySelector('#welcomeText').getBoundingClientRect(); return { groupCenter: (t.left + w.right) / 2, half: innerWidth / 2, titleLeftOfWelcome: t.right < w.left, sameLine: Math.abs(t.bottom - w.bottom) < 6 }; });
check('titel links naast welkomsttekst, samen gecentreerd', c.titleLeftOfWelcome && c.sameLine && Math.abs(c.groupCenter - c.half) < 2, JSON.stringify(c));
// Weer niet klikbaar
check('weer is geen knop', await p.evaluate(() => document.querySelector('#weatherWidget').tagName === 'DIV' && getComputedStyle(document.querySelector('#weatherWidget')).cursor !== 'pointer'));
// Modal groter + kleinere letters
await p.click('#settingsBtn');
const m = await p.evaluate(() => { const d = document.querySelector('#settingsModal'); const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), font: getComputedStyle(d).fontSize, label: getComputedStyle(document.querySelector('.settings-nav-item')).fontSize }; });
check('instellingen groter met kleinere letters', m.w >= 1100 && m.h >= 780 && m.font === '13px', JSON.stringify(m));
await p.click('[data-section="tiles"]');
await p.screenshot({ path: OUT + '/modal-groot.png' });
await p.keyboard.press('Escape');
// Vrij verslepen: een tegel kan naar elk vak, ook los van de andere tegels.
const order = () => p.evaluate(() => [...document.querySelectorAll('#tileGrid > [data-tile-id]')].map(t => t.dataset.tileId).join(','));
const places = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#tileGrid > [data-tile-id]')].map(t => [t.dataset.tileId, `${t.style.getPropertyValue('--col')},${t.style.getPropertyValue('--row')}`])));
// Sleep tegel `id` naar kolom `col`, rij `row` (halve tegels). Vastgepakt op 20,20 px van de linkerbovenhoek,
// of midden op het element `from` binnen de tegel.
const dragTo = async (id, col, row, from = null) => {
  const tile = await p.locator(`[data-tile-id="${id}"]`).boundingBox();
  const source = from ? await p.locator(from).boundingBox() : tile;
  const grab = from ? { x: source.x + source.width / 2 - tile.x, y: source.y + source.height / 2 - tile.y } : { x: 20, y: 20 };
  const point = await p.evaluate(([col, row, grab]) => {
    const grid = document.querySelector('#tileGrid'), s = getComputedStyle(grid);
    const cell = parseFloat(s.gridTemplateColumns), gap = parseFloat(s.columnGap), r = grid.getBoundingClientRect();
    const main = document.querySelector('#mainContainer').getBoundingClientRect();
    const left = r.left + (r.width - (config.appearance.gridColumns * cell + (config.appearance.gridColumns - 1) * gap)) / 2;
    return { x: left + (col - 1) * (cell + gap) + grab.x - main.left, y: r.top + (row - 1) * ((cell - gap) / 2 + gap) + grab.y - main.top };
  }, [col, row, grab]);
  await p.dragAndDrop(from ?? `[data-tile-id="${id}"]`, '#mainContainer', { sourcePosition: { x: tile.x + grab.x - source.x, y: tile.y + grab.y - source.y }, targetPosition: point });
  await p.waitForTimeout(200);
};
const start = await places();
console.log('     start:', JSON.stringify(start));
check('standaardindeling sluit aan', start.t1 === '1,1' && start.t2 === '4,1' && start.t3 === '4,3' && start.t4 === '1,5' && start.t5 === '2,5', JSON.stringify(start));

await dragTo('t5', 3, 7);
let now = await places();
check('Nieuws naar een leeg vak onder de rest; Microsoft 365 blijft staan', now.t5 === '3,7' && now.t4 === '1,5', JSON.stringify(now));
check('er blijft een gat (vrije plaatsing)', await p.evaluate(() => {
  const covers = (t, c, r) => { const col = +t.style.getPropertyValue('--col'), row = +t.style.getPropertyValue('--row'), w = +t.style.getPropertyValue('--span-cols'), h = +t.style.getPropertyValue('--span-rows'); return c >= col && c < col + w && r >= row && r < row + h; };
  return ![...document.querySelectorAll('#tileGrid > .tile')].some(t => covers(t, 2, 5) || covers(t, 3, 5));
}));
check('posities bewaard in config + opslag', await p.evaluate(() => { const t = JSON.parse(localStorage.getItem('lp:config')).tiles.find(t => t.id === 't5'); return t.position.col === 3 && t.position.row === 7 && config.tiles.every(t => t.position); }));
const box = await p.evaluate(() => { const a = document.querySelector('[data-tile-id="t4"]').getBoundingClientRect(), b = document.querySelector('[data-tile-id="t5"]').getBoundingClientRect(); return { below: b.top > a.bottom, right: b.left > a.right + 100 }; });
check('ook zichtbaar los: Nieuws staat rechtsonder, niet tegen Microsoft 365 aan', box.below && box.right, JSON.stringify(box));
await p.screenshot({ path: OUT + '/vrij-geplaatst.png' });
await p.reload(); await p.waitForTimeout(200);
check('indeling na herladen', JSON.stringify(await places()) === JSON.stringify(now), JSON.stringify(await places()));

// Op een andere tegel loslaten: ze ruilen van plek
await dragTo('t2', 4, 3);
now = await places();
check('Outlook op Google Agenda: ze ruilen', now.t2 === '4,3' && now.t3 === '4,1', JSON.stringify(now));
// Tegel die niet op de oude plek past, schuift naar het eerste vrije vak
await dragTo('t5', 1, 5);
now = await places();
check('Nieuws (2 breed) op Microsoft 365: die gaat naar een vrij vak', now.t5 === '1,5' && now.t4 !== '1,5' && !['1,5', '2,5'].includes(now.t4), JSON.stringify(now));
// Slepen vanaf een link in de link-tegel verplaatst de tegel (niet de link)
await dragTo('t4', 4, 5, '[data-tile-id="t4"] .tile-list a >> nth=0');
check('slepen vanaf een link verplaatst de tegel', (await places()).t4 === '4,5', JSON.stringify(await places()));
// Tab-volgorde volgt het scherm
check('volgorde in de pagina volgt het scherm (Tab)', await order() === 't1,t3,t2,t5,t4', await order());
// Klikken blijft werken na slepen
const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click('[data-tile-id="t2"] a.tile-main')]);
check('klikken op tegel werkt nog', tab.url().startsWith('https://outlook.office.com'));
await tab.close();
// Loslaten buiten het grid verandert niets
const before = JSON.stringify(await places());
await p.dragAndDrop('[data-tile-id="t3"]', '.site-header');
await p.waitForTimeout(200);
check('loslaten buiten grid verandert niets', JSON.stringify(await places()) === before);
// Tijdens het slepen een gestippeld vak op de plek waar de tegel komt
const t3 = await p.locator('[data-tile-id="t3"]').boundingBox();
await p.mouse.move(t3.x + 20, t3.y + 20); await p.mouse.down();
const target = await p.evaluate(() => { const g = document.querySelector('#tileGrid'), s = getComputedStyle(g), cell = parseFloat(s.gridTemplateColumns), gap = parseFloat(s.columnGap), r = g.getBoundingClientRect(); const left = r.left + (r.width - (4 * cell + 3 * gap)) / 2; return { x: left + 1 * (cell + gap) + 20, y: r.top + 6 * ((cell - gap) / 2 + gap) + 20 }; });
await p.mouse.move(target.x - 30, target.y - 30, { steps: 4 }); await p.mouse.move(target.x, target.y, { steps: 4 });
const ghost = await p.evaluate(() => { const g = document.querySelector('.drop-ghost'); return g && `${g.style.getPropertyValue('--col')},${g.style.getPropertyValue('--row')}`; });
check('gestippeld doelvak tijdens slepen', ghost === '2,7', String(ghost));
await p.screenshot({ path: OUT + '/slepen-doelvak.png' });
await p.mouse.up(); await p.waitForTimeout(200);
check('na loslaten geen doelvak meer, tegel op zijn plek', await p.locator('.drop-ghost').count() === 0 && (await places()).t3 === '2,7');

// Instellingen: omhoog/omlaag ruilt de plekken; "Tegels aaneensluiten" wist de vrije plaatsen
await p.click('#settingsBtn'); await p.click('[data-section="tiles"]');
const listOrder = await p.evaluate(() => draft.tiles.map(t => t.id).join());
check('lijst in Instellingen in schermvolgorde', listOrder === (await order()), listOrder);
await p.click('[data-action="reset-layout"]');
await p.click('[data-action="save-settings"]'); await p.waitForTimeout(200);
now = await places();
check('aaneensluiten: geen vrije plaatsen meer, geen gaten', await p.evaluate(() => config.tiles.every(t => !t.position)) && now.t1 === '1,1', JSON.stringify(now));

// Smal venster: twee kolommen, tegels onder elkaar zonder overlap
await dragTo('t5', 3, 7);
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
const narrow = await p.evaluate(() => { const r = [...document.querySelectorAll('#tileGrid > .tile')].map(t => t.getBoundingClientRect()); return { cols: getComputedStyle(document.querySelector('#tileGrid')).gridTemplateColumns.split(' ').length, overlap: r.some((a, i) => r.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)), overflow: document.documentElement.scrollWidth > innerWidth }; });
check('smal venster: 2 kolommen, geen overlap, niet te breed', narrow.cols === 2 && !narrow.overlap && !narrow.overflow, JSON.stringify(narrow));
await p.screenshot({ path: OUT + '/vrij-smal.png', fullPage: true });
await p.setViewportSize({ width: 1280, height: 860 });
console.log('fouten:', errors.length ? errors : 'geen', '|', fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

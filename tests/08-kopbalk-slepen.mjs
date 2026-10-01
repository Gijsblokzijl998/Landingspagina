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
// Verslepen
const order = () => p.evaluate(() => [...document.querySelectorAll('#tileGrid > [data-tile-id]')].map(t => t.dataset.tileId).join(','));
console.log('     start:', await order());
await p.dragAndDrop('[data-tile-id="t5"]', '[data-tile-id="t2"]');
await p.waitForTimeout(200);
const afterDrag = await order();
check('tegel versleept: Nieuws vóór Outlook', afterDrag === 't1,t5,t2,t3,t4', afterDrag);
check('volgorde bewaard in config + opslag', await p.evaluate(() => config.tiles.map(t => t.id).join() === 't1,t5,t2,t3,t4' && JSON.parse(localStorage.getItem('lp:config')).tiles.map(t => t.id).join() === 't1,t5,t2,t3,t4'));
await p.reload(); await p.waitForTimeout(200);
check('volgorde na herladen', await order() === 't1,t5,t2,t3,t4');
await p.dragAndDrop('[data-tile-id="t1"]', '[data-tile-id="t4"]');
await p.waitForTimeout(200);
check('agenda (2x2) naar achteren gesleept', (await order()).endsWith('t1'), await order());
// Slepen vanaf een link in de link-tegel verplaatst de tegel (niet de link)
await p.dragAndDrop('[data-tile-id="t4"] .tile-list a >> nth=0', '[data-tile-id="t5"]');
await p.waitForTimeout(200);
check('slepen vanaf een link verplaatst de tegel', (await order()).startsWith('t4'), await order());
// Klikken blijft werken na slepen
const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click('[data-tile-id="t2"] a.tile-main')]);
check('klikken op tegel werkt nog', tab.url().startsWith('https://outlook.office.com'));
await tab.close();
// Annuleren: loslaten buiten het grid zet terug
const before = await order();
await p.dragAndDrop('[data-tile-id="t3"]', '.site-header');
await p.waitForTimeout(200);
check('loslaten buiten grid verandert niets', await order() === before && await p.evaluate(() => config.tiles.map(t => t.id).join()) === before);
await p.screenshot({ path: OUT + '/na-slepen.png' });
console.log('fouten:', errors.length ? errors : 'geen', '|', fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
const url = INDEX_URL;
const browser = await chromium.launch();
const errors = [];
let fails = 0;
const check = (name, ok) => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + name); };

async function page(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route(/^https?:/, route => route.fulfill({ status: 404, body: '' })); // geen internet nodig
  const p = await ctx.newPage();
  p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(url);
  return { ctx, p };
}

// Desktop licht
let { ctx, p } = await page({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
check('thema licht via systeem', await p.evaluate(() => document.documentElement.dataset.theme) === 'light');
check('5 tegels', await p.locator('#tileGrid > .tile').count() === 5);
check('klok gevuld', /^\d\d:\d\d$/.test(await p.textContent('#clockTime')));
console.log('     welkom:', await p.textContent('#welcomeText'), '| datum:', await p.textContent('#clockDate'));
check('quick links zichtbaar (4)', await p.locator('#quickLinksBar a').count() === 4 && await p.isVisible('#quickLinksBar'));
const box = await p.locator('.tile--calendar').boundingBox(), one = await p.locator('.tile--link').first().boundingBox();
console.log('     tegel', one.width, 'x', one.height, '| agenda', box.width, 'x', box.height);
check('agenda is 2x2', Math.abs(box.width - (2 * one.width + 16)) < 1 && Math.abs(box.height - (2 * one.height + 16)) < 1);
check('geen horizontale scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await p.screenshot({ path: OUT + '/desktop-licht.png' });

// Thema wisselen en bewaren
await p.click('#themeToggle');
check('wissel naar donker', await p.evaluate(() => document.documentElement.dataset.theme) === 'dark');
check('aria-label knop', (await p.getAttribute('#themeToggle', 'aria-label')) === 'Schakel naar lichte modus');
await p.reload();
check('donker blijft na herladen', await p.evaluate(() => document.documentElement.dataset.theme) === 'dark');
await p.screenshot({ path: OUT + '/desktop-donker.png' });

// Instellingenmodal
await p.click('#settingsBtn');
check('modal open', await p.evaluate(() => document.querySelector('#settingsModal').open));
await p.click('[data-section="tiles"]');
check('sectie Tegels actief', (await p.textContent('#settingsPanel h3')) === 'Tegels');
await p.screenshot({ path: OUT + '/desktop-instellingen.png' });
await p.keyboard.press('Escape');
check('Esc sluit modal', !(await p.evaluate(() => document.querySelector('#settingsModal').open)));
await p.click('#settingsBtn');
await p.mouse.click(10, 10);
check('backdrop-klik sluit modal', !(await p.evaluate(() => document.querySelector('#settingsModal').open)));
await ctx.close();

// Geen flits: data-theme staat al vóór de body geparsed is
({ ctx, p } = await page({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }));
await p.evaluate(() => localStorage.removeItem('lp:theme'));
check('systeem donker zonder voorkeur', await (async () => { await p.reload(); return p.evaluate(() => document.documentElement.dataset.theme); })() === 'dark');
await ctx.close();

// Groot scherm en mobiel
({ ctx, p } = await page({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' }));
await p.screenshot({ path: OUT + '/fullhd-licht.png' });
await ctx.close();
({ ctx, p } = await page({ viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 2 }));
check('mobiel: geen horizontale scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await p.screenshot({ path: OUT + '/mobiel-licht.png', fullPage: true });
await p.click('#settingsBtn');
await p.screenshot({ path: OUT + '/mobiel-instellingen.png' });
await ctx.close();

console.log('console-fouten/waarschuwingen:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

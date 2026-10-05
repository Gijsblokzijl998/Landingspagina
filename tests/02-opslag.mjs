import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
const url = INDEX_URL;
const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: 'reduce',  viewport: { width: 1280, height: 860 }, colorScheme: 'light', acceptDownloads: true });
await ctx.route(/^https?:/, route => route.fulfill({ status: 404, body: '' })); // geen internet nodig
const errors = [];
let fails = 0;
const check = (name, ok) => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + name); };
const newPage = async () => {
  const p = await ctx.newPage();
  p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(url);
  await p.waitForTimeout(300);
  return p;
};
const title = p => p.textContent('#pageTitle');
const toastText = async p => (await p.evaluate(() => document.querySelector('#toast').matches(':popover-open'))) ? p.textContent('#toast') : null;
const idbConfig = p => p.evaluate(() => idbGet('kv', 'config'));

// 0. Overstap vanaf fase 1: alleen lp:theme aanwezig
let p = await newPage();
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lp:theme', 'dark'); });
await p.reload(); await p.waitForTimeout(300);
check('fase-1-thema blijft behouden', await p.evaluate(() => config.appearance.theme === 'dark' && document.documentElement.dataset.theme === 'dark'));
check('eerste start: niets onnodig opgeslagen', await p.evaluate(() => localStorage.getItem('lp:config')) === null);

// 1. Opslaan en herladen
await p.evaluate(() => { config.general.title = 'Test Dashboard'; config.tiles[1].title = 'Mail'; saveData(); renderDashboard(); });
await p.reload(); await p.waitForTimeout(300);
check('titel overleeft herladen', await title(p) === 'Test Dashboard');
check('tegelwijziging overleeft herladen', (await p.textContent('[data-tile-id="t2"] .tile-title')) === 'Mail');
check('back-up in IndexedDB gelijk', (await idbConfig(p))?.general?.title === 'Test Dashboard');

// 2. Themaknop bewaart in config
await p.click('#themeToggle');
await p.reload(); await p.waitForTimeout(300);
check('themaknop bewaard in lp:config', await p.evaluate(() => JSON.parse(localStorage.getItem('lp:config')).appearance.theme) === 'light');

// 3. Corrupte localStorage -> herstel uit IndexedDB
await p.evaluate(() => localStorage.setItem('lp:config', '{kapot'));
await p.reload(); await p.waitForTimeout(400);
check('corrupt: hersteld uit back-up', await title(p) === 'Test Dashboard');
check('corrupt: melding getoond', (await toastText(p))?.includes('hersteld'));
check('corrupt: localStorage weer heel', await p.evaluate(() => JSON.parse(localStorage.getItem('lp:config')).general.title) === 'Test Dashboard');

// 4. localStorage gewist -> herstel uit IndexedDB
await p.evaluate(() => localStorage.removeItem('lp:config'));
await p.reload(); await p.waitForTimeout(400);
check('gewist: hersteld uit back-up', await title(p) === 'Test Dashboard');

// 5. Export via Instellingen -> Gegevens
await p.click('#settingsBtn'); await p.click('[data-section="data"]'); await p.waitForTimeout(300);
await p.screenshot({ path: OUT + '/fase2-gegevens.png' });
console.log('     opslagfeiten:', (await p.locator('.facts').innerText()).replace(/\n/g, ' | '));
const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-action="export-config"]')]);
const exportPath = OUT + '/export.json';
await download.saveAs(exportPath);
const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
console.log('     bestandsnaam:', download.suggestedFilename());
check('export bevat app-id + config', exported.app === 'landingspagina' && exported.config.general.title === 'Test Dashboard');

// 6. Terugzetten
await p.click('[data-action="reset-config"]'); await p.waitForTimeout(200);
check('terugzetten: standaardtitel', await title(p) === 'Mijn Dashboard');
check('terugzetten: modal dicht + melding', !(await p.evaluate(() => document.querySelector('#settingsModal').open)) && (await toastText(p))?.includes('standaard'));
check('terugzetten: ook back-up', (await idbConfig(p)).general.title === 'Mijn Dashboard');

// 7. Import van het exportbestand -> identiek
await p.click('#settingsBtn'); await p.click('[data-section="data"]');
await p.setInputFiles('#importFile', exportPath); await p.waitForTimeout(300);
check('import: titel terug', await title(p) === 'Test Dashboard');
check('import: config identiek aan export', JSON.stringify(await p.evaluate(() => config)) === JSON.stringify(exported.config));

// 8. Ongeldig importbestand
fs.writeFileSync(OUT + '/fout.json', JSON.stringify({ hallo: 'wereld' }));
await p.click('#settingsBtn'); await p.click('[data-section="data"]');
await p.setInputFiles('#importFile', OUT + '/fout.json'); await p.waitForTimeout(200);
check('ongeldig bestand: melding, niets veranderd', (await toastText(p))?.includes('geen exportbestand') && await title(p) === 'Test Dashboard');
check('melding zichtbaar boven open modal', await p.evaluate(() => document.querySelector('#settingsModal').open));
await p.screenshot({ path: OUT + '/fase2-melding-boven-modal.png' });
await p.click('[data-action="cancel-settings"]');

// 9. normalizeConfig is robuust
const norm = await p.evaluate(() => normalizeConfig({
  version: 1,
  general: { title: 42 },
  appearance: { gridColumns: 15, gridRows: 1, theme: 'paars', accentColor: 'red', tileStyle: 'rond' },
  tiles: [{ type: 'onbekend' }, 'tekst', { id: 'a', type: 'link', title: 'X' }, { id: 'a', type: 'links', links: [{ label: 'L' }, 5] }],
  quickLinks: { items: [{ label: 'Q', url: 'https://q.nl' }, null] }
}));
check('normalize: foute typen -> standaard', norm.general.title === 'Mijn Dashboard' && norm.appearance.theme === 'system' && norm.appearance.accentColor === '#2563eb' && norm.appearance.tileStyle === 'rounded');
check('normalize: grid begrensd (kolommen 2–12, rijen 2–8)', norm.appearance.gridColumns === 12 && norm.appearance.gridRows === 2);
check('normalize: ongeldige tegels eruit, velden aangevuld', norm.tiles.length === 2 && norm.tiles[0].target.kind === 'url' && norm.tiles[0].openInApp === true && !('newTab' in norm.tiles[0]));
check('normalize: dubbele id vervangen', norm.tiles[0].id === 'a' && norm.tiles[1].id !== 'a');
check('normalize: links-items opgeschoond', norm.tiles[1].links.length === 1 && norm.tiles[1].links[0].url === '');
check('normalize: quick links met id', norm.quickLinks.items.length === 1 && !!norm.quickLinks.items[0].id);
check('normalize: geen object -> null', await p.evaluate(() => [null, [], 'x', 3].every(v => normalizeConfig(v) === null)));

// 10. Tweede tabblad neemt wijzigingen over
const p2 = await newPage();
await p.evaluate(() => { config.general.title = 'Uit tabblad 1'; saveData(); renderDashboard(); });
await p2.waitForTimeout(300);
check('ander tabblad volgt mee', await title(p2) === 'Uit tabblad 1');

console.log('console-fouten/waarschuwingen:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

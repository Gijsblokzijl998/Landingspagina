import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
const S = FIX;
const url = INDEX_URL;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await ctx.route(/^https?:/, route => route.fulfill({ status: 404, body: '' })); // geen internet nodig
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + name + (extra && !ok ? '  → ' + extra : '')); };
const p = await ctx.newPage();
p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
p.on('pageerror', e => errors.push(e.message));
let dialogs = [];
p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
await p.goto(url); await p.waitForTimeout(300);
await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('landingspagina'); });
await p.reload(); await p.waitForTimeout(300);
const toast = async () => (await p.evaluate(() => document.querySelector('#toast').matches(':popover-open'))) ? p.textContent('#toast') : '';
const open = async section => { await p.click('#settingsBtn'); await p.click('[data-section="' + section + '"]'); };
const save = async () => { await p.click('[data-action="save-settings"]'); await p.waitForTimeout(150); };
const modalOpen = () => p.evaluate(() => document.querySelector('#settingsModal').open);

// ---------- Fase 3: paden ----------
const paths = await p.evaluate(() => [
  'C:\\Users\\Jan Jansen\\Documenten\\Rapport #1.pdf',
  '"C:\\Users\\Jan\\map\\"',
  '\\\\server\\share\\Team map\\plan.xlsx',
  'file:///C:/al/een/url.txt',
  'D:',
  'geen pad',
  ''
].map(pathToFileUrl));
console.log('     paden:', paths);
check('pad met spaties en #', paths[0] === 'file:///C:/Users/Jan%20Jansen/Documenten/Rapport%20%231.pdf');
check('pad met aanhalingstekens (map)', paths[1] === 'file:///C:/Users/Jan/map/');
check('UNC-pad', paths[2] === 'file://server/share/Team%20map/plan.xlsx');
check('file-URL blijft', paths[3] === 'file:///C:/al/een/url.txt');
check('alleen schijf', paths[4] === 'file:///D:/');
check('ongeldig -> null', paths[5] === null && paths[6] === null);
check('Office-URI voor docx', await p.evaluate(() => officeUri('file:///C:/a/b.docx')) === 'ms-word:ofe|u|file:///C:/a/b.docx');
check('geen Office-URI voor pdf/map', await p.evaluate(() => officeUri('file:///C:/a/b.pdf') === null && officeUri('file:///C:/a/') === null));

// ---------- Fase 4: instellingen ----------
// Algemeen: titel wijzigen en opslaan
await open('general');
await p.fill('[data-path="general.title"]', 'Werkplek');
await p.fill('[data-path="general.welcomeText"]', '{dagdeel}, Gijs-test');
await save();
check('opslaan sluit modal', !(await modalOpen()));
check('titel opgeslagen', (await p.textContent('#pageTitle')) === 'Werkplek' && (await p.textContent('#welcomeText')).endsWith(', Gijs-test'));
await p.reload(); await p.waitForTimeout(200);
check('titel na herladen', (await p.textContent('#pageTitle')) === 'Werkplek');

// Annuleren met wijzigingen
await open('general');
await p.fill('[data-path="general.title"]', 'Weggooien');
dialogs = [];
await p.keyboard.press('Escape');
check('Esc vraagt bevestiging bij wijzigingen', dialogs.length === 1 && !(await modalOpen()));
check('annuleren gooit wijziging weg', (await p.textContent('#pageTitle')) === 'Werkplek');

// Live voorbeeld thema + terugdraaien
await open('appearance');
await p.selectOption('[data-path="appearance.theme"]', 'dark');
check('live voorbeeld donker', await p.evaluate(() => document.documentElement.dataset.theme) === 'dark');
await p.click('[data-action="cancel-settings"]');
check('annuleren draait voorbeeld terug', await p.evaluate(() => document.documentElement.dataset.theme) === 'light');

// Accentkleur + tegelstijl
await open('appearance');
await p.click('[data-color="#16a34a"]');
await p.selectOption('[data-path="appearance.tileStyle"]', 'square');
await save();
check('accent + tegelstijl opgeslagen', await p.evaluate(() => config.appearance.accentColor === '#16a34a' && document.documentElement.dataset.tileStyle === 'square'));

// Tegel toevoegen: Office-pad
await open('tiles');
await p.selectOption('#newTileType', 'link');
await p.click('[data-action="add-tile"]');
check('nieuwe tegel opent editor', await p.isVisible('[data-path="tiles.5.title"]'));
await p.fill('[data-path="tiles.5.title"]', 'Begroting');
await p.selectOption('[data-path="tiles.5.target.kind"]', 'path');
await p.fill('[data-path="tiles.5.target.value"]', 'C:\\Users\\Test\\Begroting 2026.xlsx');
check('Office-optie zichtbaar bij .xlsx', await p.isVisible('[data-office-option]'));
await p.click('[data-action="close-tile-editor"]');
await save();
check('Office-tegel: Excel-link', (await p.getAttribute('[data-tile-id] a.tile-main >> nth=-1', 'href')) === 'ms-excel:ofe|u|file:///C:/Users/Test/Begroting%202026.xlsx');
check('pad-tegel heeft kopieerknop', await p.locator('[data-action="copy-path"]').count() === 1);

// Pad kopiëren
await p.hover('.tile--link >> nth=-1');
await p.click('[data-action="copy-path"]');
await p.waitForTimeout(150);
check('pad gekopieerd naar klembord', (await p.evaluate(() => navigator.clipboard.readText())) === 'C:\\Users\\Test\\Begroting 2026.xlsx');
check('melding na kopiëren', (await toast()).startsWith('Pad gekopieerd'));

// Tegel met echt lokaal pad: klik opent het bestand (file -> file)
await open('tiles');
await p.click('[data-action="edit-tile"][data-id] >> nth=-1');
await p.fill('[data-path="tiles.5.target.value"]', FIX + '/docs/Mijn rapport.html');
check('Office-optie verborgen bij .html', !(await p.isVisible('[data-office-option]')));
await p.click('[data-action="close-tile-editor"]');
await save();
const [fileTab] = await Promise.all([ctx.waitForEvent('page'), p.click('.tile--link >> nth=-1 >> a.tile-main')]);
await fileTab.waitForLoadState();
check('klik op pad-tegel opent lokaal bestand in nieuw tabblad', fileTab.url().endsWith('Mijn%20rapport.html') && (await fileTab.title()) === 'Rapport');
await fileTab.close();

// Validatie: lege URL-tegel
await open('tiles');
await p.click('[data-action="add-tile"]');
await save();
check('ongeldige tegel blokkeert opslaan', await modalOpen() && (await toast()).includes('geldig webadres'));
check('editor van foute tegel geopend', await p.isVisible('[data-path="tiles.6.target.value"]'));
await p.fill('[data-path="tiles.6.target.value"]', 'https://www.nu.nl');
await p.fill('[data-path="tiles.6.title"]', 'NU');
await save();
check('na herstel opgeslagen', !(await modalOpen()) && await p.locator('#tileGrid > .tile').count() === 7);

// Sessiebestand-tegel
await open('tiles');
await p.click('[data-action="edit-tile"][data-id] >> nth=-1');
await p.selectOption('[data-path="tiles.6.target.kind"]', 'session-file');
await p.fill('[data-path="tiles.6.title"]', 'Losse PDF');
await save();
const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.tile--link >> nth=-1 >> button.tile-main')]);
const popupPromise = ctx.waitForEvent('page', { timeout: 2000 }).catch(() => null);
await chooser.setFiles(FIX + '/docs/Mijn rapport.html');
const popup = await popupPromise;
await p.waitForTimeout(200);
console.log('     sessiebestand: popup geopend =', Boolean(popup), popup ? popup.url().slice(0, 30) : '', '| melding:', await toast());
check('sessietegel toont bestandsnaam', (await p.textContent('.tile--link >> nth=-1 >> .tile-hint')) === 'Mijn rapport.html');
check('sessietegel is nu een link', (await p.getAttribute('.tile--link >> nth=-1 >> a.tile-main', 'href'))?.startsWith('blob:'));
if (popup) await popup.close();

// Volgorde en verwijderen
await open('tiles');
const before = await p.evaluate(() => draft.tiles.map(t => t.id));
await p.click('[data-action="move-item"][data-list="tiles"][data-index="0"][data-dir="1"]');
await p.click('[data-action="remove-item"][data-list="tiles"][data-index="6"]');
await save();
const after = await p.evaluate(() => config.tiles.map(t => t.id));
check('volgorde gewisseld + tegel verwijderd', after.length === 6 && after[0] === before[1] && after[1] === before[0]);

// Capaciteit: grid 2x2 is te klein
await open('appearance');
await p.selectOption('[data-path="appearance.gridColumns"]', '2');
await p.selectOption('[data-path="appearance.gridRows"]', '2');
await save();
check('te klein grid blokkeert opslaan', await modalOpen() && (await toast()).includes('cellen nodig'));
check('springt naar Tegels met rode teller', await p.isVisible('.capacity.is-over'));
await p.click('[data-section="appearance"]');
await p.selectOption('[data-path="appearance.gridColumns"]', '4');
await p.selectOption('[data-path="appearance.gridRows"]', '3');
await save();
check('grid 4x3 opgeslagen', await p.evaluate(() => config.appearance.gridRows === 3));

// Link-tegel: link toevoegen
await open('tiles');
const linksIndex = await p.evaluate(() => draft.tiles.findIndex(t => t.type === 'links'));
await p.click('[data-action="edit-tile"][data-id="t4"] >> nth=0');
await p.click('[data-action="add-link"]');
await p.fill('[data-path="tiles.' + linksIndex + '.links.3.label"]', 'Outlook web');
await p.fill('[data-path="tiles.' + linksIndex + '.links.3.url"]', 'https://outlook.office.com');
await save();
check('link toegevoegd aan link-tegel', await p.locator('[data-tile-id="t4"] .tile-list li').count() === 4);

// Snelle links: toevoegen, verwijderen, balk uit
await open('quickLinks');
await p.click('[data-action="add-link"]');
await p.fill('[data-path="quickLinks.items.4.label"]', 'NOS');
await p.fill('[data-path="quickLinks.items.4.url"]', 'https://nos.nl');
await p.click('[data-action="remove-item"][data-list="quickLinks.items"][data-index="0"]');
await save();
// Alleen de tekst van de link, zonder de letter die zonder internet als favicon verschijnt.
const quickLabels = await p.evaluate(() => [...document.querySelectorAll('#quickLinksBar a')].map(a => [...a.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('')));
check('snelle links bijgewerkt', quickLabels.join(',') === 'Wikipedia,Buienradar,Google Maps,NOS', quickLabels.join(','));
check('nieuwe snelle link kreeg id', await p.evaluate(() => config.quickLinks.items.every(i => i.id)));
await open('quickLinks');
await p.uncheck('[data-path="quickLinks.enabled"]');
await save();
check('balk verborgen', !(await p.isVisible('#quickLinksBar')));
await open('quickLinks'); await p.check('[data-path="quickLinks.enabled"]'); await save();

// Logo uploaden
await open('general');
await p.selectOption('[data-path="general.logo.source"]', 'upload');
await p.setInputFiles('[data-image="logo"]', FIX + '/logo.png');
await p.waitForTimeout(300);
check('logo-voorbeeld zichtbaar', await p.isVisible('.image-preview'));
await save();
const logo = await p.evaluate(() => ({ src: document.querySelector('#logo').src.slice(0, 22), hidden: document.querySelector('#logo').hidden, width: document.querySelector('#logo').naturalWidth }));
check('logo in header (verkleind tot 320)', logo.src === 'data:image/png;base64,' && !logo.hidden && logo.width === 320);

// Klok met seconden
await open('weather');
await p.check('[data-path="clock.showSeconds"]');
await save();
check('klok met seconden', /^\d\d:\d\d:\d\d$/.test(await p.textContent('#clockTime')));

// Worker-adres moet https zijn
await open('services');
await p.fill('[data-path="services.workerUrl"]', 'http://onveilig.example');
await save();
check('http Worker-adres geweigerd', await modalOpen() && (await toast()).includes('https://'));
await p.fill('[data-path="services.workerUrl"]', 'https://landingspagina.test.workers.dev');
await p.fill('[data-path="services.workerKey"]', 'geheim');
await save();
check('Worker opgeslagen; RSS-tegel meldt geen koppelfout meer', !(await modalOpen()) && !(await p.textContent('.tile--rss')).includes('Koppel eerst'));

// Achtergrondafbeelding
await open('appearance');
await p.selectOption('[data-path="appearance.background.type"]', 'image');
await p.setInputFiles('[data-image="background"]', FIX + '/logo.png');
await p.waitForTimeout(300);
check('achtergrond live voorbeeld', await p.evaluate(() => document.documentElement.dataset.background) === 'image');
await save();
await p.reload(); await p.waitForTimeout(300);
check('achtergrond na herladen', await p.evaluate(() => document.documentElement.dataset.background) === 'image');
await p.screenshot({ path: OUT + '/fase4-achtergrond.png' });
await open('appearance');
await p.selectOption('[data-path="appearance.background.type"]', 'none');
await save();

// Export bevat logo
check('logo zit in de config (en dus in de export)', await p.evaluate(() => isImageDataUrl(config.general.logo.dataUrl)));

console.log('console-fouten/waarschuwingen:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

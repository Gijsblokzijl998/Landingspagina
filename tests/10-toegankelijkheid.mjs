import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { INDEX_URL, FIX } from './helpers.mjs';
import fs from 'node:fs';
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const ics = fs.readFileSync(FIX + '/agenda.ics', 'utf8');
const nos = fs.readFileSync(FIX + '/nos.xml', 'utf8');
const browser = await chromium.launch();
const results = {};
for (const scheme of ['light', 'dark']) {
  // bypassCSP: de beveiligingsregel van de pagina zou het ingevoegde axe-script terecht blokkeren.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, timezoneId: 'Europe/Amsterdam', bypassCSP: true });
  await ctx.route(/^https:/, r => r.fulfill({ status: 404, body: '' }));
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-10-01T08:00:00+02:00'));
  await p.goto(INDEX_URL);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(200);
  // Gevulde tegels zonder netwerk: feed en agenda direct in de state zetten
  await p.evaluate(([ics, nos]) => {
    const d = normalizeConfig(DEFAULT_CONFIG);
    d.services = { workerUrl: 'https://x.workers.dev', workerKey: 'k' };
    d.tiles.find(t => t.type === 'calendar').icsUrl = 'https://calendar.google.com/x.ics';
    d.tiles.push({ id: 'p1', type: 'link', title: 'Projecten', icon: 'folder', target: { kind: 'path', value: 'C:\\Projecten' } });
    config = normalizeConfig(d);
    const from = new Date(2026, 9, 1).getTime();
    calendarState.set('https://calendar.google.com/x.ics', { fetchedAt: Date.now(), occurrences: expandEvents(parseICS(ics), from, from + 90 * DAY_MS), error: null });
    feedState.set(config.tiles.find(t => t.type === 'rss').feedUrl, { fetchedAt: Date.now(), feed: parseFeed(nos, 'https://feeds.nos.nl/'), error: null });
    weather = { key: weatherKey(), fetchedAt: Date.now(), data: { current: { temperature_2m: 14, weather_code: 2, is_day: 1 } } };
    renderDashboard();
  }, [ics, nos]);
  await p.addScriptTag({ content: axeSource });
  const run = async label => {
    const r = await p.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map(n => n.target.join(' ') + ' :: ' + (n.any[0]?.message ?? n.failureSummary).slice(0, 160)) })));
    results[scheme + ' ' + label] = r;
  };
  await run('dashboard');
  await p.click('#settingsBtn');
  for (const section of ['general', 'appearance', 'tiles', 'quickLinks', 'weather', 'services', 'data']) {
    await p.click('[data-section="' + section + '"]'); await p.waitForTimeout(150);
    await run('instellingen/' + section);
  }
  await p.click('[data-section="tiles"]'); await p.click('[data-action="edit-tile"][data-id="p1"] >> nth=0'); await p.waitForTimeout(100);
  await run('tegel-editor');
  await ctx.close();
}
// Toetsenbord: instellingen openen en sluiten zonder muis, focus keert terug
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^https:/, r => r.fulfill({ status: 404, body: '' }));
  const p = await ctx.newPage();
  await p.goto(INDEX_URL);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(200);
  const focused = () => p.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName);
  const stops = [];
  for (let i = 0; i < 4; i++) { await p.keyboard.press('Tab'); stops.push(await focused()); }
  results['toetsenbord: eerste tabstops'] = stops[0] === 'themeToggle' && stops[1] === 'settingsBtn' ? [] : [{ id: 'tabvolgorde', impact: 'serious', help: stops.join(' → '), nodes: [] }];
  await p.focus('#settingsBtn'); await p.keyboard.press('Enter');
  const inModal = await p.evaluate(() => document.querySelector('#settingsModal').contains(document.activeElement));
  await p.keyboard.press('Escape');
  const back = await focused();
  results['toetsenbord: instellingen openen/sluiten'] = inModal && back === 'settingsBtn' ? [] : [{ id: 'focus', impact: 'serious', help: 'focus in modal: ' + inModal + ', daarna: ' + back, nodes: [] }];
  await ctx.close();
}

let fails = 0;
for (const [k, v] of Object.entries(results)) {
  if (v.length) fails++;
  console.log((v.length ? 'FOUT' : 'OK  ') + ' ' + k + (v.length ? ': ' + v.length + ' probleem(en)' : ': geen problemen'));
  for (const x of v) { console.log('   [' + x.impact + '] ' + x.id + ': ' + x.help); x.nodes.forEach(n => console.log('      ' + n)); }
}
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

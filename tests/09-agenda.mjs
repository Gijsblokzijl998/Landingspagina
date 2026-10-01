import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
const S = FIX;
const ics = fs.readFileSync(S + '/agenda.ics', 'utf8');
const ICS_URL = 'https://calendar.google.com/calendar/ical/test%40gmail.com/private-abc123/basic.ics';

const store = new Map();
globalThis.caches = { default: { match: async r => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
let upstreamDown = false;
const upstreamCalls = [];
globalThis.fetch = async url => {
  upstreamCalls.push(url);
  if (upstreamDown) throw new TypeError('netwerkfout');
  if (url === ICS_URL) return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
  return new Response('niet gevonden', { status: 404 });
};
const worker = (await import(WORKER_PATH)).default;
const env = { DASHBOARD_KEY: 'sleutel-8' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Amsterdam', colorScheme: 'light' });
await ctx.route('https://dash.test.workers.dev/**', async route => {
  const req = route.request();
  const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), env, { waitUntil() {} });
  route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
await ctx.route(/^https:\/\/(?!dash\.test)/, route => route.fulfill({ status: 404, body: '' }));
const p = await ctx.newPage();
await p.clock.setFixedTime(new Date('2026-10-01T08:00:00+02:00'));
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/40[0-9]|50[0-9]|net::|Failed to load/.test(m.text())) errors.push(m.text()); });
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + n + (x ? '  → ' + x : '')); };
await p.goto(INDEX_URL);
await p.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('landingspagina'); q.onsuccess = q.onerror = q.onblocked = r; }); });
await p.reload(); await p.waitForTimeout(300);

// ---------- Parser en herhalingen ----------
const r = await p.evaluate(text => {
  const calendar = parseICS(text);
  const from = new Date(2026, 9, 1).getTime();
  const occ = expandEvents(calendar, from, from + 30 * DAY_MS);
  const local = iso => new Date(iso).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const by = title => occ.filter(o => o.title === title).map(o => o.allDay ? o.startDay + '..' + o.endDay : local(o.start) + '-' + new Date(o.end).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' }));
  return {
    name: calendar.name, events: calendar.events.length, titles: [...new Set(occ.map(o => o.title))],
    teamoverleg: by('Teamoverleg'), location: occ.find(o => o.title === 'Teamoverleg')?.location,
    lunch: by('Lunch met Sanne'), vrij: by('Vrije dag'), conferentie: by('Conferentie'),
    standup: by('Stand-up'), verplaatst: by('Stand-up (verplaatst)'), standupUtc: occ.filter(o => o.title === 'Stand-up').map(o => o.start.slice(5, 16)),
    borrel: by('Borrel'), salaris: by('Salaris'), jarig: by('Verjaardag Jan'), hardlopen: by('Hardlopen'), sprint: by('Sprintreview'),
    outlook: by('Outlook-afspraak'), overleg: occ.filter(o => o.title.startsWith('Overleg')).map(o => o.title),
    tandarts: by('Tandarts'), nacht: by('Nachtdienst'), zwevend: by('Zwevende tijd'),
    sorted: occ.every((o, i) => i === 0 || occ[i - 1].sortKey <= o.sortKey)
  };
}, ics);
console.log('     stand-up:', r.standup.join(' | '));
check('agendanaam en aantal VEVENTs (VTIMEZONE genegeerd)', r.name === 'Agenda Gijs' && r.events === 19, r.name + ' / ' + r.events);
check('enkele afspraak met TZID + locatie unescaped', r.teamoverleg.join() === 'do 1-10, 09:00-10:00' && r.location === 'Kamer 2.14, Utrecht', r.teamoverleg + ' / ' + r.location);
check('UTC-afspraak naar lokale tijd', r.lunch.join() === 'do 1-10, 14:00-15:00', r.lunch.join());
check('hele dag (1 dag)', r.vrij.join() === '2026-10-02..2026-10-03');
check('meerdaagse hele-dag-afspraak', r.conferentie.join() === '2026-10-05..2026-10-08');
check('wekelijks MA+WO met EXDATE, verplaatst en geannuleerd exemplaar', r.standup.length === 5 && !r.standup.some(s => s.includes('7-10') || s.includes('12-10') || s.includes('14-10')), r.standup.join(' | '));
check('verplaatst exemplaar op nieuwe tijd', r.verplaatst.join() === 'ma 12-10, 14:00-14:15', r.verplaatst.join());
check('wintertijd: 10:00 blijft 10:00 (UTC 08:00 → 09:00)', r.standup.includes('ma 26-10, 10:00-10:15') && r.standupUtc.includes('10-05T08:00') && r.standupUtc.includes('10-26T09:00'), r.standupUtc.join(' '));
check('maandelijks laatste vrijdag (BYDAY=-1FR)', r.borrel.join() === 'vr 30-10, 16:00-18:00', r.borrel.join());
check('maandelijks op de 15e (hele dag)', r.salaris.join() === '2026-10-15..2026-10-16');
check('jaarlijks verjaardag sinds 1985', r.jarig.join() === '2026-10-20..2026-10-21');
check('dagelijks COUNT=5 telt vanaf de start (29 sep)', r.hardlopen.length === 3 && r.hardlopen[2].startsWith('za 3-10'), r.hardlopen.join(' | '));
check('tweewekelijks met UNTIL', r.sprint.join(' | ') === 'do 1-10, 15:00-16:00 | do 15-10, 15:00-16:00', r.sprint.join(' | '));
check('geannuleerde losse afspraak weg', !r.titles.includes('Afgezegd'));
check('Windows-tijdzone (Outlook)', r.outlook.join() === 'vr 9-10, 11:30-12:00', r.outlook.join());
check('gevouwen regel + \\, en \\; in titel', r.overleg.join() === 'Overleg, plan; budget', r.overleg.join());
check('DURATION en VALARM-samenvatting genegeerd', r.tandarts.join() === 'di 13-10, 08:30-09:15' && !r.titles.includes('Herinnering'), r.tandarts.join());
check('oude afspraak buiten venster weg', !r.titles.includes('Oud'));
check('nachtdienst van gisteren loopt door in venster', r.nacht.length === 1);
check('zwevende tijd volgt X-WR-TIMEZONE', r.zwevend.join() === 'vr 16-10, 09:00-09:30', r.zwevend.join());
check('resultaat gesorteerd', r.sorted);

// Extra regels
const extra = await p.evaluate(() => {
  const mk = (rrule, start = '20260101T090000') => {
    const cal = parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:X\r\nDTSTART;TZID=Europe/Amsterdam:' + start + '\r\nDTEND;TZID=Europe/Amsterdam:' + start.slice(0, 9) + '100000\r\nRRULE:' + rrule + '\r\nEND:VEVENT\r\nEND:VCALENDAR');
    const from = new Date(2026, 0, 1).getTime();
    return expandEvents(cal, from, from + 800 * DAY_MS).map(o => o.start.slice(0, 10));
  };
  return {
    firstMonday: mk('FREQ=MONTHLY;BYDAY=1MO;COUNT=3'),
    lastWorkday: mk('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3'),
    the31st: mk('FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3', '20260131T090000'),
    leap: mk('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1;COUNT=2'),
    weekdays: mk('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=6'),
    everyOtherDay: mk('FREQ=DAILY;INTERVAL=2;COUNT=3')
  };
});
console.log('     extra:', JSON.stringify(extra));
check('eerste maandag van de maand', extra.firstMonday.join() === '2026-01-05,2026-02-02,2026-03-02');
check('laatste werkdag (BYSETPOS=-1)', extra.lastWorkday.join() === '2026-01-30,2026-02-27,2026-03-31');
check('de 31e: maanden zonder 31 overgeslagen', extra.the31st.join() === '2026-01-31,2026-03-31,2026-05-31');
check('laatste dag van februari', extra.leap.join() === '2026-02-28,2027-02-28');
check('werkdagen', extra.weekdays.join() === '2026-01-01,2026-01-02,2026-01-05,2026-01-06,2026-01-07,2026-01-08');
check('om de dag', extra.everyOtherDay.join() === '2026-01-01,2026-01-03,2026-01-05');
check('geen iCal → nette fout', await p.evaluate(() => { try { parseICS('<html></html>'); return false; } catch (e) { return e.message.includes('geen iCal'); } }));

// ---------- Tegel op het dashboard ----------
await p.evaluate(url => {
  const data = normalizeConfig(DEFAULT_CONFIG);
  data.services = { workerUrl: 'https://dash.test.workers.dev', workerKey: 'sleutel-8' };
  data.tiles.find(t => t.type === 'calendar').icsUrl = url;
  applyConfig(normalizeConfig(data));
}, ICS_URL);
await p.waitForTimeout(600);
const tile = () => p.evaluate(() => {
  const body = document.querySelector('[data-tile-id="t1"] .tile-body');
  return {
    state: body.querySelector('.tile-state')?.textContent ?? null,
    stale: body.querySelector('.feed-stale')?.textContent ?? null,
    days: [...body.querySelectorAll('.agenda-day')].map(d => ({
      date: d.querySelector('.agenda-date').textContent,
      items: [...d.querySelectorAll('.agenda-item')].map(i => (i.classList.contains('is-now') ? '[nu] ' : '') + (i.classList.contains('is-past') ? '[voorbij] ' : '') + i.querySelector('.agenda-time').textContent + ' ' + i.querySelector('.agenda-title').textContent)
    }))
  };
});
let t = await tile();
console.log('     ' + t.days.slice(0, 4).map(d => d.date + ': ' + d.items.join(' · ')).join('\n     '));
check('eerste dag heet Vandaag, tweede Morgen', t.days[0].date === 'Vandaag' && t.days[1].date === 'Morgen');
check('vandaag: nachtdienst (voorbij), hardlopen (nu), teamoverleg, lunch, sprintreview', t.days[0].items.join(' | ') === '[voorbij] tot 01:00 Nachtdienst | [nu] 07:30–08:15 Hardlopen | 09:00–10:00 Teamoverleg | 14:00–15:00 Lunch met Sanne | 15:00–16:00 Sprintreview', t.days[0].items.join(' | '));
check('morgen: hele dag eerst', t.days[1].items[0] === 'Hele dag Vrije dag', t.days[1].items.join(' | '));
check('conferentie staat op 3 dagen', t.days.filter(d => d.items.includes('Hele dag Conferentie')).length === 3);
check('laatste dag binnen 30 dagen (t/m 30 okt)', t.days.at(-1).date.includes('30 okt'), t.days.at(-1).date);
check('nederlandse daglabels', /^(Ma|Di|Wo|Do|Vr|Za|Zo) \d+ okt/.test(t.days[2].date), t.days[2].date);
await p.screenshot({ path: OUT + '/fase8-licht.png' });
await p.emulateMedia({ colorScheme: 'dark' });
await p.screenshot({ path: OUT + '/fase8-donker.png' });
await p.emulateMedia({ colorScheme: 'light' });

// daysAhead = 7
await p.evaluate(() => { const d = structuredClone(config); d.tiles.find(t => t.type === 'calendar').daysAhead = 7; applyConfig(normalizeConfig(d)); });
t = await tile();
check('7 dagen vooruit: laatste dag is 7 okt', t.days.at(-1).date.includes('7 okt'), t.days.at(-1).date);

// Cache na herladen, zonder nieuw verzoek
const icsCalls = () => upstreamCalls.filter(u => u === ICS_URL).length;
const calls = icsCalls(); store.clear();
await p.reload(); await p.waitForTimeout(500);
t = await tile();
check('na herladen uit cache, geen nieuw verzoek', t.days.length > 0 && icsCalls() === calls);

// Storing: oude stand blijft
upstreamDown = true;
await p.evaluate(() => updateCalendars({ force: true })); await p.waitForTimeout(500);
t = await tile();
check('storing: afspraken blijven met melding', t.days.length > 0 && t.stale?.startsWith('Bijwerken mislukt'), t.stale);
upstreamDown = false;

// Niet-toegestane host
await p.evaluate(() => { const d = structuredClone(config); d.tiles.find(t => t.type === 'calendar').icsUrl = 'https://evil.example/cal.ics'; applyConfig(normalizeConfig(d)); });
await p.waitForTimeout(500);
t = await tile();
check('niet-toegestane agendahost: melding van de Worker', t.state?.includes('niet toegestaan'), t.state);

// Tijd verstrijkt: na 10:00 is het teamoverleg voorbij (elke minuut opnieuw getekend)
await p.evaluate(url => { const d = structuredClone(config); d.tiles.find(t => t.type === 'calendar').icsUrl = url; d.tiles.find(t => t.type === 'calendar').daysAhead = 30; applyConfig(normalizeConfig(d)); }, ICS_URL);
await p.waitForTimeout(500);
await p.clock.setFixedTime(new Date('2026-10-01T10:30:00+02:00'));
await p.evaluate(() => renderCalendarTiles());
t = await tile();
check('na 10:00 is het teamoverleg voorbij', t.days[0].items.some(i => i === '[voorbij] 09:00–10:00 Teamoverleg'), t.days[0].items.join(' | '));

console.log('paginafouten:', errors.length ? errors : 'geen');
console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');
await browser.close();

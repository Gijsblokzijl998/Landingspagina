import { INDEX_URL, WORKER_PATH, FIX, OUT } from './helpers.mjs';
// Draait de Worker-module in Node met een nagebootste cache en nagebootste bronnen.
const store = new Map();
globalThis.caches = { default: {
  match: async req => store.get(req.url)?.clone(),
  put: async (req, res) => { store.set(req.url, res); }
} };
const upstreamCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  upstreamCalls.push(url);
  const u = new URL(url);
  if (u.hostname === 'feeds.nos.nl') return new Response('<rss><channel><title>NOS</title></channel></rss>', { headers: { 'Content-Type': 'application/rss+xml' } });
  if (u.hostname === 'calendar.google.com') return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { headers: { 'Content-Type': 'text/calendar' } });
  if (u.hostname === 'groot.example') return new Response(new Uint8Array(3 * 1024 * 1024));
  if (u.hostname === 'stuk.example') return new Response('kapot', { status: 500 });
  if (u.hostname === 'traag.example') setTimeout(() => {}, 300);
  if (u.hostname === 'traag.example') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))));
  if (u.hostname === 'redirect.example') { const r = new Response('x'); Object.defineProperty(r, 'url', { value: 'https://evil.example/cal.ics' }); return r; }
  throw new TypeError('netwerkfout');
};
// Kortere time-out voor de test
const OrigTimeout = AbortSignal.timeout;
AbortSignal.timeout = () => OrigTimeout.call(AbortSignal, 50);

const worker = (await import(WORKER_PATH)).default;
const env = { DASHBOARD_KEY: 'geheim-123', EXTRA_ICS_HOSTS: 'redirect.example' };
const waits = [];
const ctx = { waitUntil: p => waits.push(p) };
const call = async (path, { key = 'geheim-123', method = 'GET', environment = env } = {}) => {
  const headers = key ? { 'X-Dashboard-Key': key, Origin: 'null' } : { Origin: 'null' };
  const res = await worker.fetch(new Request('https://landingspagina.test.workers.dev' + path, { method, headers }), environment, ctx);
  await Promise.all(waits.splice(0));
  const text = await res.text();
  return { status: res.status, cors: res.headers.get('Access-Control-Allow-Origin'), cache: res.headers.get('X-Cache'), type: res.headers.get('Content-Type'), text };
};
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'FOUT') + ' ' + name + (extra ? '  ' + extra : '')); };
const q = url => '?url=' + encodeURIComponent(url);

let r = await call('/ping', { method: 'OPTIONS', key: null });
check('preflight 204 met CORS', r.status === 204 && r.cors === '*');
r = await call('/ping');
check('ping met juiste sleutel', r.status === 200 && JSON.parse(r.text).ok === true, r.text);
r = await call('/ping', { key: 'fout' });
check('verkeerde sleutel → 401 (met CORS, leesbaar voor dashboard)', r.status === 401 && r.cors === '*', r.text);
r = await call('/ping', { key: null });
check('geen sleutel → 401', r.status === 401);
r = await call('/ping', { environment: {} });
check('secret ontbreekt → 500 met uitleg', r.status === 500 && r.text.includes('DASHBOARD_KEY'));
r = await call('/rss', { method: 'POST' });
check('POST → 405', r.status === 405);
r = await call('/onbekend');
check('onbekende route → 404', r.status === 404);

r = await call('/rss' + q('https://feeds.nos.nl/nosnieuwsalgemeen'));
check('RSS doorgegeven met type en CORS', r.status === 200 && r.text.startsWith('<rss') && r.type === 'application/rss+xml' && r.cors === '*' && r.cache === 'MISS');
const before = upstreamCalls.length;
r = await call('/rss' + q('https://feeds.nos.nl/nosnieuwsalgemeen'));
check('tweede keer uit cache', r.cache === 'HIT' && upstreamCalls.length === before && r.text.startsWith('<rss'));
r = await call('/rss' + q('https://feeds.nos.nl/nosnieuwsalgemeen'), { key: 'fout' });
check('cache omzeilt de sleutelcontrole niet', r.status === 401);

r = await call('/rss');
check('url ontbreekt → 400', r.status === 400);
r = await call('/rss' + q('file:///etc/passwd'));
check('file:-adres geweigerd', r.status === 400, r.text);
r = await call('/rss' + q('https://user:pw@feeds.nos.nl/x'));
check('adres met wachtwoord geweigerd', r.status === 400);
r = await call('/rss' + q('https://groot.example/feed'));
check('te groot → 413', r.status === 413, r.text);
r = await call('/rss' + q('https://stuk.example/feed'));
check('bron 500 → 502', r.status === 502, r.text);
r = await call('/rss' + q('https://traag.example/feed'));
check('time-out → 504', r.status === 504, r.text);
r = await call('/rss' + q('https://onbereikbaar.example/feed'));
check('onbereikbaar → 504', r.status === 504, r.text);

r = await call('/ics' + q('https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics'));
check('Google-agenda toegestaan', r.status === 200 && r.text.startsWith('BEGIN:VCALENDAR'));
r = await call('/ics' + q('https://evil.example/cal.ics'));
check('agenda van onbekende host geweigerd', r.status === 400, r.text);
r = await call('/ics' + q('http://calendar.google.com/x.ics'));
check('agenda via http geweigerd', r.status === 400);
r = await call('/ics' + q('https://redirect.example/cal.ics'));
check('doorverwijzing naar niet-toegestane host → 403', r.status === 403, r.text);

console.log(fails ? fails + ' FOUT(EN)' : 'ALLES OK');

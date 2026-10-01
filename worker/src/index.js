/**
 * Landingspagina – Cloudflare Worker
 *
 * Een kleine, afgeschermde doorgeefproxy voor het dashboard. RSS-feeds en agenda's (ICS) sturen meestal geen
 * CORS-headers, waardoor de browser ze niet rechtstreeks mag ophalen. Deze Worker haalt ze op en geeft ze
 * ongewijzigd door, met CORS-headers erbij.
 *
 *   GET /ping            controleert alleen de sleutel ("Verbinding testen" in het dashboard)
 *   GET /rss?url=<feed>  haalt een RSS- of Atom-feed op
 *   GET /ics?url=<ics>   haalt een agenda op (alleen hosts op de allowlist)
 *   GET /favicon?url=<site>  zoekt het favicon van een site (204 als er geen is)
 *
 * Elk verzoek moet de header X-Dashboard-Key hebben met dezelfde waarde als het secret DASHBOARD_KEY.
 * Het dashboard draait als lokaal bestand en stuurt daardoor "Origin: null"; een origin-controle beschermt dan
 * niets, dus de sleutel is de echte beveiliging. Er worden geen URL's of sleutels gelogd.
 */

const VERSION = '1.2.0';

const FAVICON_CACHE_SECONDS = 7 * 24 * 3600;
const FAVICON_MISSING_CACHE_SECONDS = 24 * 3600;
const FAVICON_MAX_BYTES = 256 * 1024;
const SECOND_LEVEL_SUFFIXES = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'co.jp'];

// Agenda's mogen alleen van deze hosts komen; extra hosts kunnen via de variabele EXTRA_ICS_HOSTS (kommagescheiden).
const ICS_HOSTS = ['calendar.google.com', 'outlook.office365.com', 'outlook.live.com'];

const ROUTES = {
  '/rss': {
    protocols: ['http:', 'https:'],
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 10_000,
    cacheSeconds: 15 * 60,
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
    allowsHost: () => true
  },
  '/ics': {
    protocols: ['https:'],
    maxBytes: 10 * 1024 * 1024,
    timeoutMs: 15_000,
    cacheSeconds: 10 * 60,
    accept: 'text/calendar, */*;q=0.5',
    allowsHost: (host, env) => icsHosts(env).includes(host)
  }
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Dashboard-Key',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET') return errorResponse(405, 'Alleen GET is toegestaan.');

    if (!env.DASHBOARD_KEY) {
      return errorResponse(500, 'Het secret DASHBOARD_KEY is nog niet ingesteld in de Worker.');
    }
    if (!safeEqual(request.headers.get('X-Dashboard-Key') ?? '', env.DASHBOARD_KEY)) {
      return errorResponse(401, 'De sleutel klopt niet.');
    }

    const { pathname, searchParams } = new URL(request.url);
    if (pathname === '/ping') return jsonResponse(200, { ok: true, version: VERSION });
    if (pathname === '/favicon') return favicon(searchParams.get('url'), ctx);

    const route = ROUTES[pathname];
    if (!route) return errorResponse(404, 'Onbekende route. Gebruik /ping, /rss, /ics of /favicon.');

    const target = parseTarget(searchParams.get('url'), route, env);
    if (target.error) return errorResponse(400, target.error);

    return proxy(target.url, pathname, route, env, ctx);
  }
};

async function proxy(target, pathname, route, env, ctx) {
  // De cachesleutel bevat alleen het doeladres; de sleutelcontrole is hierboven al gedaan.
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.landingspagina.invalid${pathname}?url=${encodeURIComponent(target)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, 'HIT');

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: { Accept: route.accept, 'User-Agent': `Landingspagina-dashboard/${VERSION}` },
      redirect: 'follow',
      signal: AbortSignal.timeout(route.timeoutMs)
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return errorResponse(504, timedOut ? 'De bron reageerde niet op tijd.' : 'De bron is niet bereikbaar.');
  }

  // Na een doorverwijzing moet ook het eindadres toegestaan zijn.
  const finalUrl = new URL(upstream.url || target);
  if (!route.protocols.includes(finalUrl.protocol) || !route.allowsHost(finalUrl.hostname, env)) {
    return errorResponse(403, `Doorverwezen naar een niet-toegestane host (${finalUrl.hostname}).`);
  }
  if (!upstream.ok) return errorResponse(502, `De bron gaf status ${upstream.status}.`);

  let body;
  try {
    body = await readLimited(upstream, route.maxBytes);
  } catch {
    return errorResponse(413, `Het bestand is groter dan ${Math.round(route.maxBytes / 1024 / 1024)} MB.`);
  }

  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${route.cacheSeconds}`
    }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  return withCors(response, 'MISS');
}

// Zoekt het favicon van een site. Een server ziet, anders dan de browser, of een bron echt een icoon heeft.
// Volgorde: het icoon uit de HTML van de site zelf, /favicon.ico, Google voor de host; dan pas een pagina op een
// ander domein waar de site naar doorverwijst (een inlogpagina zoals bij Dynamics 365 is bruikbaar, een
// cookiemelding zoals bij Tweakers/DPG Media niet), en ten slotte Google voor het hoofddomein.
// Niets gevonden: 204 No Content.
async function favicon(value, ctx) {
  let site;
  try {
    site = new URL(value);
  } catch {
    return errorResponse(400, 'De parameter url is geen geldig adres.');
  }
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password) {
    return errorResponse(400, 'Alleen http- of https-adressen zonder wachtwoord zijn toegestaan.');
  }

  const host = site.hostname.toLowerCase();
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.landingspagina.invalid/favicon/v2?host=${encodeURIComponent(host)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, 'HIT');

  const domain = registrableDomain(host);
  const ownPage = [];
  const otherPage = [];
  try {
    const page = await fetch(`${site.protocol}//${host}/`, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; Landingspagina-dashboard)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000)
    });
    if ((page.headers.get('Content-Type') ?? '').includes('html')) {
      const html = new TextDecoder().decode(await readLimited(page, 512 * 1024).catch(() => new Uint8Array()));
      const base = new URL(page.url || `${site.protocol}//${host}/`); // eindadres na eventuele doorverwijzing
      const found = [...iconLinks(html, base.href), new URL('/favicon.ico', base).href];
      (registrableDomain(base.hostname.toLowerCase()) === domain ? ownPage : otherPage).push(...found);
    }
  } catch {
    // Site niet bereikbaar: de andere bronnen kunnen het icoon nog kennen.
  }
  const candidates = [...ownPage, `https://${host}/favicon.ico`, googleFavicon(host), ...otherPage];
  if (domain !== host) candidates.push(googleFavicon(domain));

  for (const candidate of [...new Set(candidates)]) {
    const icon = await fetchImage(candidate);
    if (!icon) continue;
    const response = new Response(icon.body, {
      headers: { 'Content-Type': icon.type, 'Cache-Control': `public, max-age=${FAVICON_CACHE_SECONDS}` }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
    return withCors(response, 'MISS');
  }

  const missing = new Response(null, { status: 204, headers: { 'Cache-Control': `public, max-age=${FAVICON_MISSING_CACHE_SECONDS}` } });
  return withCors(missing, 'MISS');
}

// <link rel="icon" …> en varianten, in volgorde van voorkeur.
function iconLinks(html, baseUrl) {
  const links = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = tag.match(/\brel\s*=\s*["']?([^"'>]+)/i)?.[1].toLowerCase() ?? '';
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? tag.match(/\bhref\s*=\s*([^\s>]+)/i)?.[1];
    if (!href || !/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) continue;
    try {
      const url = new URL(href.replace(/&amp;/g, '&'), baseUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') links.push({ url: url.href, touch: rel.includes('apple') });
    } catch {
      // Ongeldige href overslaan.
    }
  }
  return [...links.filter(link => !link.touch), ...links.filter(link => link.touch)].map(link => link.url);
}

async function fetchImage(url) {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
    const type = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !type.startsWith('image/')) return null;
    const body = await readLimited(response, FAVICON_MAX_BYTES);
    return body.byteLength > 0 ? { body, type } : null;
  } catch {
    return null;
  }
}

// Zonder fallback_opts geeft Google een 404 als het de site niet kent, in plaats van een standaardwereldbol.
function googleFavicon(host) {
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&size=32&url=${encodeURIComponent(`https://${host}`)}`;
}

// vechtdalwonen.operations.eu.dynamics.com → dynamics.com, www.bbc.co.uk → bbc.co.uk
function registrableDomain(host) {
  const labels = host.split('.');
  const size = SECOND_LEVEL_SUFFIXES.includes(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-size).join('.');
}

function parseTarget(value, route, env) {
  if (!value) return { error: 'De parameter url ontbreekt.' };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: 'De parameter url is geen geldig adres.' };
  }
  if (!route.protocols.includes(url.protocol)) {
    return { error: `Alleen ${route.protocols.map(protocol => protocol.replace(':', '')).join(' of ')}-adressen zijn toegestaan.` };
  }
  if (url.username || url.password) return { error: 'Adressen met een gebruikersnaam of wachtwoord zijn niet toegestaan.' };
  if (!route.allowsHost(url.hostname, env)) {
    return { error: `Agenda's van ${url.hostname} zijn niet toegestaan. Voeg de host toe aan EXTRA_ICS_HOSTS.` };
  }
  return { url: url.href };
}

function icsHosts(env) {
  const extra = String(env.EXTRA_ICS_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return [...ICS_HOSTS, ...extra];
}

// Leest de body, maar stopt zodra die groter wordt dan maxBytes.
async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > maxBytes) throw new Error('Te groot');
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Te groot');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// Vergelijkt in constante tijd, zodat de sleutel niet via responstijden te raden is.
function safeEqual(a, b) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < right.length; index++) {
    difference |= (left[index] ?? 0) ^ right[index];
  }
  return difference === 0;
}

function withCors(response, cacheStatus) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  headers.set('X-Cache', cacheStatus);
  return new Response(response.body, { status: response.status, headers });
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function errorResponse(status, message) {
  return jsonResponse(status, { ok: false, error: message });
}

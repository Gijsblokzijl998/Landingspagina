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
 *
 * Elk verzoek moet de header X-Dashboard-Key hebben met dezelfde waarde als het secret DASHBOARD_KEY.
 * Het dashboard draait als lokaal bestand en stuurt daardoor "Origin: null"; een origin-controle beschermt dan
 * niets, dus de sleutel is de echte beveiliging. Er worden geen URL's of sleutels gelogd.
 */

const VERSION = '1.0.0';

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

    const route = ROUTES[pathname];
    if (!route) return errorResponse(404, 'Onbekende route. Gebruik /ping, /rss of /ics.');

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

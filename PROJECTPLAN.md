# Projectplan: Landingspagina (persoonlijk dashboard)

> **Status:** v2, 1 oktober 2026. De antwoorden op V1–V5 zijn verwerkt (zie [§12](#12-beslissingen-en-open-vragen)).
> **Doel van dit document:** één gedeeld beeld van wat we bouwen, hoe het in elkaar zit en in welke volgorde.

---

## 1. Doel en uitgangspunten

Een persoonlijk startscherm voor de browser dat je zelf aanpast: tegels die naar websites of lokale bestanden
leiden, met daarnaast weer, nieuws (RSS) en je agenda. Alles draait in de browser.

**Gebruikssituatie**
- Microsoft Edge op Windows.
- `index.html` staat lokaal en wordt geopend door erop te dubbelklikken in Verkenner, dus via `file:///…`.
- Het bestand is in Edge ingesteld als startpagina.

**Eisen uit de beschrijving**

| # | Eis |
|---|-----|
| E1 | **Eén HTML-bestand** (`index.html`): HTML-structuur, CSS in `<head>`, alle JavaScript onderaan `<body>`. |
| E2 | **Geen backend of database.** Configuratie staat lokaal: `localStorage` voor de snelle start, `IndexedDB` voor de rest. |
| E3 | **Tegels** navigeren naar URL's, naar lokale bestanden (tijdens de sessie) of naar onthouden paden. |
| E4 | **Weer** via Open-Meteo, inclusief geocoding om een plaatsnaam op te zoeken. |
| E5 | **RSS/Atom-feeds** ophalen via een Cloudflare Worker. |
| E6 | **Agenda (ICS)** ophalen via een Cloudflare Worker. Bron: Google Agenda, waar de Outlook-agenda naartoe gesynchroniseerd wordt. |
| E7 | **Instellingenmodal** met licht/donker-thema, links beheren en het uiterlijk aanpassen. |
| E8 | **Thema via CSS custom properties** (`:root`), voor licht en donker. |

**Afgeleide keuzes**
- Vanilla JavaScript en CSS, zonder framework, libraries of build-stap. Het bestand opent direct in de browser.
- De Cloudflare Worker is het enige onderdeel dat niet in de browser draait. Het is een kleine, afgeschermde
  doorgeefproxy, nodig omdat RSS- en ICS-bronnen meestal geen CORS-headers sturen.
- Code-identifiers zijn Engels (zoals in de beschrijving: `loadData`, `renderDashboard`). Alle UI-teksten zijn
  Nederlands, en datums en tijden gaan via `Intl` met `nl-NL`.

**Niet in v1:** synchronisatie tussen apparaten (wel handmatig via export/import), een browserextensie of
nieuw-tabblad-vervanging, meertaligheid, en meerdere dashboards of profielen.

---

## 2. Repository-indeling

```
Landingspagina/
├── index.html          ← de complete applicatie (single file)
├── worker/             ← Cloudflare Worker: proxy voor RSS en ICS
│   ├── src/index.js
│   ├── wrangler.toml
│   └── README.md       ← deploy-instructies (Cloudflare-dashboard of wrangler)
├── tests/              ← (fase 9) Playwright-smoketests + fixtures (RSS 2.0, Atom, Google-ICS)
├── PROJECTPLAN.md
└── README.md           ← installatie (lokaal + Edge-startpagina) en bijwerken
```

---

## 3. Indeling van de interface

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Logo]          Mijn Dashboard · Goedemorgen!       ⛅ 14°  09:41  ◐  ⚙ │  ← <header>
├──────────────────────────────────────────────────────────────────────────┤
│  #mainContainer                                                          │
│  ┌────────┐ ┌────────┐ ┌──────────────────┐ ┌────────┐                   │
│  │ ✉      │ │ 📁     │ │ Agenda (2x2)     │ │ RSS    │                   │
│  │Outlook │ │Rapport │ │ Vandaag          │ │ • ...  │   .grid           │
│  └────────┘ └────────┘ │ 09:00 Overleg    │ └────────┘   (max 4x4)       │
│  ┌────────┐ ┌────────┐ │ 13:30 Review     │ ┌────────┐                   │
│  │ Links  │ │ ...    │ │ Morgen ...       │ │ ...    │                   │
│  │ • a •b │ │        │ └──────────────────┘ └────────┘                   │
│  └────────┘ └────────┘                                                   │
├──────────────────────────────────────────────────────────────────────────┤
│  Google · Teams · SharePoint · Intranet · …              #quickLinksBar  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Header (`<header>`)
- **Links:** logo (geüploade afbeelding of een URL, geen logo kan ook).
- **Midden:** paginatitel en optioneel een welkomsttekst. `{dagdeel}` in de tekst wordt vervangen door
  "Goedemorgen", "Goedemiddag", "Goedenavond" of "Goedenacht".
- **Rechts:**
  - weerwidget: icoon, temperatuur en plaatsnaam, met min/max van vandaag in de tooltip;
  - klok: tijd met optioneel de datum, met of zonder seconden;
  - themaknop: licht ↔ donker;
  - instellingenknop (⚙), die de modal opent.

### 3.2 Hoofdcontainer (`#mainContainer`) met het tegelgrid (`.grid`)
- Een CSS-grid met **2–4 kolommen × 2–4 rijen**. De agenda is 2 breed, dus minimaal 2 kolommen. De cellen zijn
  vierkant en schalen mee met het venster.
- Tegels staan in de volgorde van de configuratie. `grid-auto-flow: dense` vult gaten op die door de 2x2-agenda ontstaan.
- De instellingen bewaken de capaciteit: kolommen × rijen cellen, waarbij de agenda 4 cellen telt.
- Op smalle schermen worden het 2 kolommen en scrollt de pagina.

| Tegeltype | Grootte | Inhoud | Klikgedrag |
|-----------|---------|--------|------------|
| `link`, de gewone tegel | 1x1 | icoon (emoji of afbeelding), titel en optionele kleur | opent het doel: URL, onthouden pad of sessiebestand (zie §6) |
| `links`, de link-tegel | 1x1 | titel met een lijst van ±3–6 links | elke link opent afzonderlijk |
| `rss` | 1x1 | feednaam met de laatste N items, scrollbaar | een item opent het artikel in een nieuw tabblad |
| `calendar` | 2x2 | afspraken van de **komende 30 dagen**, gegroepeerd per dag, scrollbaar | een afspraak toont details (tijd, locatie) |

### 3.3 Snelle links (`#quickLinksBar`)
Een optionele horizontale balk onder het grid, aan of uit te zetten. Bij te veel links scrollt hij horizontaal.
Elke link heeft een label, een URL en optioneel een icoon.

### 3.4 Instellingenmodal (`#settingsModal`)
De modal is een `<dialog>`-element, zodat focus-trap, Esc-sluiten en de backdrop vanzelf werken. Links staat
een zijbalk met categorieën, rechts het formulier.

| Categorie | Inhoud |
|-----------|--------|
| **Algemeen** | titel, welkomsttekst aan/uit + tekst, logo (upload / URL / geen) |
| **Uiterlijk** | thema (licht / donker / systeem), accentkleur, achtergrond (geen / kleur / afbeelding), grid kolommen × rijen, tegelstijl (afgerond / vierkant) |
| **Tegels** | lijst van tegels: toevoegen (type kiezen), bewerken, verwijderen, volgorde (↑/↓; drag & drop later) |
| **Snelle links** | balk aan/uit, links toevoegen/bewerken/verwijderen/ordenen |
| **Weer & klok** | weer aan/uit, plaats zoeken (geocoding), eenheid °C/°F; klok: seconden, datum |
| **Koppelingen** | Worker-URL + sleutel, knop "Verbinding testen" |
| **Gegevens** | exporteren / importeren (JSON), terugzetten naar standaard, opslaggebruik |

De modal werkt op een **kopie** van de configuratie. *Opslaan* past de wijzigingen toe, slaat op en rendert
opnieuw. *Annuleren* of Esc gooit ze weg. Alleen het thema krijgt een live voorbeeld.

---

## 4. Architectuur van `index.html`

### 4.1 Opbouw van het bestand

```html
<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard</title>
  <script>/* 5 regels: thema uit localStorage zetten vóór de eerste paint (geen witte flits) */</script>
  <style>
    :root { --bg: …; --surface: …; --text: …; --accent: …; --radius: …; --gap: … }
    [data-theme="dark"] { --bg: …; --surface: …; --text: … }
    /* layout, header, grid, tegels, quick links, modal, toast */
  </style>
</head>
<body>
  <header>…</header>
  <main id="mainContainer">
    <section class="grid" aria-label="Tegels"></section>
    <nav id="quickLinksBar" aria-label="Snelle links"></nav>
  </main>
  <dialog id="settingsModal">…</dialog>
  <div id="toast" role="status" aria-live="polite"></div>
  <script>/* de volledige applicatie, zie 4.2 */</script>
</body>
</html>
```

Het kleine script in `<head>` is de enige uitzondering op "JS onderaan". Zonder dat script flitst de pagina
wit voordat het donkere thema geladen is.

### 4.2 JavaScript, ingedeeld in secties

Eén `<script>`, in duidelijk gemarkeerde secties en in deze volgorde:

| # | Sectie | Inhoud / belangrijkste functies |
|---|--------|----------------------------------|
| 1 | **Constanten** | `DEFAULT_CONFIG`, `STORAGE_KEYS`, `DB_NAME`, `DB_VERSION`, `WMO_CODES` (weercode → icoon + omschrijving), `REFRESH_MS` |
| 2 | **State** | `config`, `db`, `sessionFiles` (Map tegel-id → File), `timers` |
| 3 | **Opslag** | `loadData()`, `saveData()`, `initDB()`, `idbGet/idbPut/idbDelete()`, `mergeDefaults()`, `migrateConfig()`, `exportConfig()`, `importConfig()` |
| 4 | **Rendering** | `renderDashboard()`, `renderHeader()`, `buildTile(tile)` → `buildLinkTile`, `buildLinksTile`, `buildRssTile`, `buildCalendarTile`; `renderQuickLinks()`, `applyTheme()` |
| 5 | **Events** | `bindEvents()` (event delegation op `.grid`, header en modal), `handleTileClick()`, `toggleTheme()` |
| 6 | **Databronnen** | `fetchWeather()`, `geocode(query)`, `fetchAndRenderRSS(tile)`, `parseFeed(xml)`, `fetchAndRenderCalendar(tile)`, `parseICS(text)`, `expandEvents(events, from, to)`, `proxyFetch(route, url)` |
| 7 | **Instellingen** | `openSettings()`, `renderSettingsSection(name)`, `readSettingsForm()`, `saveSettings()`, tegel-editor |
| 8 | **Hulpfuncties** | `el(tag, attrs, …children)` (veilige DOM-builder), `safeUrl()`, `pathToFileUrl()`, `formatTime()`, `formatDay()`, `uid()`, `debounce()`, `toast()` |
| 9 | **Init** | `init()` |

### 4.3 Opstartvolgorde (fast boot)

```
<head>  themavoorkeur uit localStorage → <html data-theme="…">                (synchroon, vóór paint)
init()
 1. loadData()          localStorage → JSON.parse → mergeDefaults → migrateConfig     (synchroon)
 2. renderDashboard()   header, grid en quick links direct zichtbaar
 3. bindEvents(); startClock()
 4. await initDB()      IndexedDB openen: logo-blob en cache laden
 5. hydrate()           gecachte weer-, RSS- en agendadata tonen (meteen inhoud, ook offline)
 6. refreshAll()        fetchWeather(), fetchAndRenderRSS() per tegel, fetchAndRenderCalendar()
 7. timers starten; bij visibilitychange pauzeren en bij terugkeer verversen als de data verouderd is
```

### 4.4 Renderstrategie
- `renderDashboard()` bouwt het grid altijd opnieuw op uit `config`. Bij hooguit 16 tegels is dat goedkoop en
  het blijft voorspelbaar.
- Datategels (`rss`, `calendar`) renderen eerst een skelet of de cache. Daarna werkt hun fetch-functie alleen
  de eigen tegel bij, gevonden via `data-tile-id`.
- Externe tekst (feedtitels, afspraken) gaat alleen via `textContent` en `el()` de pagina in, nooit via `innerHTML`.

---

## 5. Datamodel en opslag

### 5.1 `DEFAULT_CONFIG` (schets)

```js
const DEFAULT_CONFIG = {
  version: 1,
  general: {
    title: 'Mijn Dashboard',
    showWelcome: true,
    welcomeText: '{dagdeel}!',
    logo: { source: 'none', url: '' }           // 'none' | 'url' | 'upload' (blob in IndexedDB)
  },
  appearance: {
    theme: 'system',                            // 'light' | 'dark' | 'system'
    accentColor: '#2563eb',
    gridColumns: 4,                             // 2–4
    gridRows: 4,                                // 2–4
    tileStyle: 'rounded',                       // 'rounded' | 'square'
    background: { type: 'none', value: '' }     // 'none' | 'color' | 'image' (blob in IndexedDB)
  },
  clock:   { enabled: true, showSeconds: false, showDate: true },
  weather: {
    enabled: true,
    location: { name: 'Amsterdam', latitude: 52.374, longitude: 4.890 },
    unit: 'celsius'                             // 'celsius' | 'fahrenheit'
  },
  services: { workerUrl: '', workerKey: '' },
  tiles: [
    { id: 't1', type: 'link', title: 'Outlook', icon: '✉️', color: '', newTab: false,
      target: { kind: 'url', value: 'https://outlook.office.com' } },   // kind: 'url' | 'path' | 'session-file'
    { id: 't2', type: 'links', title: 'Microsoft 365',
      links: [{ label: 'Teams', url: 'https://teams.microsoft.com' }] },
    { id: 't3', type: 'rss', title: 'Nieuws', feedUrl: 'https://feeds.nos.nl/nosnieuwsalgemeen', maxItems: 8 },
    { id: 't4', type: 'calendar', title: 'Agenda', icsUrl: '', daysAhead: 30 }
  ],
  quickLinks: {
    enabled: true,
    items: [{ id: 'q1', label: 'Google', url: 'https://www.google.com' }]
  }
};
```

### 5.2 Wat staat waar

| Opslag | Sleutel / store | Inhoud | Waarom hier |
|--------|-----------------|--------|-------------|
| `localStorage` | `lp:config` | de volledige config als JSON (klein, < 50 KB) | synchroon leesbaar, dus de pagina staat er meteen |
| `localStorage` | `lp:theme` | themavoorkeur (`light` / `dark` / `system`) | leesbaar door het `<head>`-script vóór de paint |
| IndexedDB `landingspagina` | `kv` | back-up van de config | herstel als localStorage leeg of corrupt is |
| | `assets` | logo- en achtergrondafbeelding (Blob) | binaire data hoort niet in localStorage (limiet ±5 MB, alleen strings) |
| | `cache` | laatste weer-, RSS- en ICS-resultaat + tijdstempel | direct tonen bij het opstarten en offline |

**Opslag bij een lokaal bestand.** Getest in Chromium, de engine van Edge: `localStorage` en IndexedDB werken
op `file://`, en **alle lokale HTML-bestanden delen één opslag**. Het bestand verplaatsen of vervangen door een
nieuwe versie behoudt dus de instellingen. De keerzijde: "Browsegegevens wissen → Cookies en andere sitegegevens"
in Edge wist ook het dashboard. Daarom zijn er een export als back-up en `navigator.storage.persist()`.

### 5.3 Regels
- **Laden:** eerst `localStorage`. Is die leeg of corrupt, dan de config uit IndexedDB (na `initDB`). Anders `DEFAULT_CONFIG`.
- **Samenvoegen:** `mergeDefaults()` vult velden aan die in een nieuwere versie zijn toegevoegd. `migrateConfig()`
  zet een oude `version` stap voor stap om naar de huidige.
- **Opslaan:** `saveData()` schrijft synchroon naar localStorage en daarna asynchroon naar IndexedDB. Een vol
  geheugen (`QuotaExceededError`) wordt opgevangen en gemeld met een toast.
- **Persistentie:** eenmalig `navigator.storage.persist()` aanvragen, zodat de browser de data niet zelf opruimt.
- **Export/import:** een JSON-bestand, met het logo als data-URL. Bij het exporteren waarschuwen we dat het
  bestand de agenda-URL en de Worker-sleutel bevat.

---

## 6. Tegelnavigatie en lokale bestanden

Omdat het dashboard zelf als lokaal bestand draait, mag het **direct naar andere lokale bestanden linken**. Dat
heb ik getest: een `file:///`-link vanaf een `file:///`-pagina opent gewoon. Vanaf een website zou de browser
dit blokkeren.

Een `link`-tegel heeft een `target.kind`:

| `kind` | Wat | Klikgedrag |
|--------|-----|------------|
| `url` | http(s)- of mailto-adres | gewone `<a href>`. Zelfde of nieuw tabblad is instelbaar per tegel. |
| `path` | **onthouden pad**: `C:\Users\…\rapport.pdf`, een map, of `\\server\share\…` | `pathToFileUrl()` zet het pad om naar `file:///C:/Users/…` (spaties en tekens gecodeerd, UNC → `file://server/share/…`) en opent het als gewone link |
| `session-file` | **bestand tijdens de sessie**: gekozen via de bestandskiezer | `URL.createObjectURL(file)` opent in een nieuw tabblad. Na herladen toont de tegel "Bestand opnieuw kiezen". |

**Wat Edge doet met een lokaal pad** (controleren we in fase 3 op Windows):
- **pdf, afbeeldingen, tekst en html** openen in Edge.
- **Een map** toont Edge als een klikbaar mappenoverzicht in de browser, niet in Verkenner.
- **Office-bestanden** (.docx, .xlsx, .pptx) opent Edge niet zelf; die worden als download aangeboden. In fase 3
  onderzoeken we of de Office-URI's (`ms-word:ofe|u|…`, `ms-excel:…`, `ms-powerpoint:…`) zo'n bestand direct in
  Word, Excel of PowerPoint kunnen openen. Lukt dat niet, dan is "pad kopiëren" de fallback.
- **Pad kopiëren** is altijd als tweede actie beschikbaar (knopje op de tegel), om het pad in Verkenner te plakken.

De File System Access API (bestanden "onthouden" via een handle) is niet nodig, omdat directe padlinks werken. Die
laten we weg.

---

## 7. Externe databronnen

### 7.1 Weer (Open-Meteo, zonder sleutel, met CORS)
- **Huidig weer:**
  `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`
- **Geocoding** (in de instellingen, met debounce 300 ms):
  `https://geocoding-api.open-meteo.com/v1/search?name={plaats}&count=5&language=nl&format=json`.
  De gebruiker kiest uit "Plaats, provincie, land", waarna naam, lat en lon in de config komen.
- `WMO_CODES` zet `weather_code` (+ `is_day`) om naar een icoon en een Nederlandse omschrijving.
- Verversen gebeurt elke 30 minuten. Bij een fout blijft de cache staan met een subtiele "verouderd"-markering.
- Open-Meteo is gratis voor niet-commercieel gebruik tot ±10.000 calls per dag. Wij zitten op ±50 per dag.

### 7.2 RSS/Atom (via de Worker)
- `proxyFetch('rss', feedUrl)` → `GET {workerUrl}/rss?url={encoded}` met de header `X-Dashboard-Key`.
- `parseFeed()` gebruikt `DOMParser` (`application/xml`) en herkent:
  - **RSS 2.0:** `item` → `title`, `link`, `pubDate`;
  - **Atom:** `entry` → `title`, `link[rel=alternate]/@href`, `updated`/`published`;
  - **RSS 1.0/RDF:** basisondersteuning.
- Alleen titel, link en datum worden getoond. Links gaan door `safeUrl()`, dat alleen http(s) toelaat.
  HTML uit de feed wordt nooit gerenderd.
- Elke RSS-tegel heeft één feed. Verversen gebeurt elke 15 minuten.

### 7.3 Agenda (Google Agenda-ICS, via de Worker)
- **Keten:** Outlook → (jouw synchronisatie) → Google Agenda → geheime iCal-link → Worker → dashboard.
  Wijzigingen in Outlook verschijnen dus pas nadat ze naar Google zijn gesynchroniseerd.
- **Bron:** Google Agenda → Instellingen → (jouw agenda) → *Agenda integreren* → **Geheim adres in iCal-indeling**
  (`https://calendar.google.com/calendar/ical/…/private-…/basic.ics`). Deze URL werkt als een wachtwoord, dus hij
  staat alleen lokaal en gaat alleen naar de eigen Worker.
- **`parseICS()`** is een eigen, compacte, generieke parser:
  - regels *unfolden*, properties met parameters parsen, tekst unescapen (`\,` `\;` `\n`);
  - per `VEVENT`: `UID`, `SUMMARY`, `LOCATION`, `DTSTART`, `DTEND`/`DURATION`, `RRULE`, `EXDATE`,
    `RECURRENCE-ID` en `STATUS`. Geannuleerde afspraken worden overgeslagen.
  - datumvormen: UTC (`…Z`), met `TZID` en hele dag (`VALUE=DATE`). Google gebruikt IANA-tijdzones
    (`Europe/Amsterdam`), die `Intl` direct begrijpt.
- **`expandEvents()`** werkt herhalingen uit, alleen binnen het venster [vandaag, vandaag + 30 dagen]:
  - `FREQ` DAILY, WEEKLY, MONTHLY en YEARLY met `INTERVAL`, `COUNT` en `UNTIL`;
  - `BYDAY` (ook `1MO` en `-1FR`), `BYMONTHDAY` en `BYMONTH`;
  - `EXDATE` en verplaatste exemplaren (`RECURRENCE-ID`) worden toegepast.
- **Bestandsgrootte:** de Google-feed bevat je hele agendageschiedenis en kan enkele MB's groot zijn. We parsen
  het bestand één keer per verversing. De cache bewaart alleen de uitgewerkte afspraken van het venster, niet het
  ruwe bestand.
- **Weergave (2x2):** een scrollbare lijst met groepen "Vandaag", "Morgen" en daarna per dag ("wo 8 okt"). Elke
  afspraak toont tijd (of "Hele dag"), titel en locatie, en de lopende afspraak wordt gemarkeerd. Verversen
  gebeurt elke 15 minuten.

### 7.4 Verversen en cache (gemeenschappelijk)
- Elke bron werkt volgens *stale-while-revalidate*: eerst de cache uit IndexedDB tonen, dan op de achtergrond
  ophalen en de tegel bijwerken.
- Timers pauzeren als het tabblad verborgen is (`document.hidden`). Bij terugkeer wordt direct ververst als de
  data ouder is dan het interval.
- Fouten worden per tegel getoond, bijvoorbeeld "Feed niet bereikbaar" of "Worker niet ingesteld". Er komen geen
  alerts, en de rest van het dashboard blijft werken.

---

## 8. Cloudflare Worker (`worker/`)

Eén Worker met twee routes. Hij geeft bestanden door en voegt CORS-headers toe, zonder ze te interpreteren.

| Route | Doel | Extra regels |
|-------|------|--------------|
| `GET /rss?url=…` | feed ophalen | alleen `http(s)`, max. 2 MB, timeout 10 s, cache 15 min |
| `GET /ics?url=…` | agenda ophalen | **alleen hosts op de allowlist** (`calendar.google.com`, aanvulbaar), max. 10 MB, timeout 15 s, cache 10 min |
| `GET /ping` | "Verbinding testen" in de instellingen | controleert alleen de sleutel |
| `OPTIONS *` | CORS-preflight | |

**Beveiliging, zodat het geen open proxy wordt**
- Een pagina die als lokaal bestand draait, stuurt `Origin: null`. Een origin-check beschermt dan niets, dus de
  **gedeelde sleutel** is de echte beveiliging: de header `X-Dashboard-Key` moet gelijk zijn aan het Worker-secret
  `DASHBOARD_KEY`.
- De Worker antwoordt met `Access-Control-Allow-Origin: *`. Er worden geen cookies of credentials gebruikt.
- Daarnaast: een host-allowlist voor ICS, groottelimieten, timeouts, en geen URL's loggen.
- Gratis Workers-plan: 100.000 requests per dag. Wij zitten op ±250 per dag.

**Bestanden:** `src/index.js` (ES-module, `export default { fetch }`), `wrangler.toml` (`name`, `main`,
`compatibility_date`) en een `README.md` met twee deploy-routes:
1. **Zonder installatie:** Cloudflare-dashboard → Workers & Pages → Worker aanmaken → code plakken → secret
   `DASHBOARD_KEY` toevoegen.
2. **Met Node:** `wrangler deploy` en `wrangler secret put DASHBOARD_KEY`.

Daarna vul je in het dashboard bij *Koppelingen* de Worker-URL (`https://….workers.dev`) en de sleutel in.

---

## 9. Kwaliteit

- **Beveiliging**
  - Geen `innerHTML` met externe data.
  - `safeUrl()` laat alleen deze protocollen toe: `http`, `https`, `mailto`, en `file` voor pad-tegels.
  - `rel="noopener noreferrer"` op externe links.
  - Een CSP-meta-tag die `connect-src` beperkt tot Open-Meteo en de Worker.
- **Toegankelijkheid**
  - Tegels zijn echte `<a>`/`<button>`-elementen en dus te bedienen met het toetsenbord.
  - Zichtbare `:focus-visible`, en `aria-label` op icoonknoppen.
  - Contrast AA in beide thema's, en `prefers-reduced-motion` wordt gerespecteerd.
- **Performance**
  - Eerste render zonder netwerk en zonder externe scripts of fonts (systeemfont, Segoe UI op Windows).
  - Streefgrootte voor `index.html` is minder dan ±150 KB.
- **Browser:** Microsoft Edge op Windows. Automatisch testen gebeurt in Chromium, dezelfde engine.
- **Testen:**
  - per fase een handmatige checklist (licht/donker, smal/breed venster, leeg/vol grid, offline);
  - in fase 9 Playwright-smoketests met fixtures, waaronder een Google-ICS met herhalingen, uitzonderingen en
    hele-dag-afspraken.

---

## 10. Fasering

Elke fase levert een werkend `index.html` op en wordt apart gecommit. Grootte: S = klein, M = middel, L = groot.

| Fase | Onderdeel | Oplevering | Klaar wanneer… | Grootte |
|------|-----------|------------|----------------|---------|
| **0** | Plan & keuzes | dit document | keuzes V1–V5 vastgelegd ✅ | S |
| **1** | Skelet & thema | HTML-structuur, CSS-variabelen, header, grid met `DEFAULT_CONFIG`-tegels, klok, themaknop, modal-skelet, responsive layout | pagina toont header + grid + quick links; thema wisselt zonder flits en blijft bewaard; goed bij smal en breed venster ✅ | M |
| **2** | Opslag | `loadData`/`saveData`, `initDB`, `mergeDefaults`, `migrateConfig`, `persist()`, export/import | wijzigingen overleven herladen; corrupte localStorage → herstel uit IndexedDB; export → import geeft identiek dashboard ✅ | M |
| **3** | Tegels & navigatie | `link` (url / path / session-file), pad kopiëren, Office-URI-onderzoek, `links`-tegel, quick links-balk, grid-capaciteit | alle doeltypen werken in Edge zoals in §6; toetsenbordbediening werkt | M |
| **4** | Instellingenmodal | zijbalk + alle categorieën uit §3.4, tegel-editor (toevoegen/bewerken/verwijderen/volgorde), validatie, opslaan/annuleren | alles uit `DEFAULT_CONFIG` is via de UI aan te passen zonder code te wijzigen | L |
| **5** | Weer | `fetchWeather`, `geocode` in de instellingen, `WMO_CODES`, cache | plaats zoeken → kiezen → weer in de header; offline toont de laatste waarde | S |
| **6** | Cloudflare Worker | `worker/` met `/rss`, `/ics` en `/ping`, sleutel, allowlist, CORS, README; "Verbinding testen" in de instellingen | Worker gedeployed; testknop groen; verzoek zonder sleutel → 401 | S |
| **7** | RSS-tegel | `fetchAndRenderRSS`, `parseFeed` (RSS 2.0 / Atom / RDF), verversen, foutstatus | drie verschillende echte feeds tonen correct; foute URL geeft nette melding | M |
| **8** | Agenda-tegel (2x2) | `parseICS`, `expandEvents`, weergave per dag | jouw Google-agenda klopt 30 dagen vooruit, inclusief herhalingen, uitzonderingen, hele-dag-afspraken en zomer-/wintertijd | L |
| **9** | Afwerking | toegankelijkheid, foutstatussen, lege staten, CSP, Playwright-smoketests, README | checklist §9 afgevinkt; dashboard draait als Edge-startpagina | M |

De volgorde is zo gekozen dat er na fase 3 al een bruikbaar startscherm is. Fase 5 (weer) hangt niet af van de
Worker en kan eventueel naar voren.

---

## 11. Risico's

| Risico | Kans | Impact | Maatregel |
|--------|------|--------|-----------|
| ICS-complexiteit (herhalingen, uitzonderingen, zomer-/wintertijd) | middel | hoog | Google levert nette IANA-tijdzones; we testen met een export van jouw agenda als fixture. Plan B: de Worker zet ICS om naar JSON met `ical.js`. |
| Google-feed is groot (volledige geschiedenis), dus het parsen is traag | middel | laag | parsen buiten de eerste render, cache van alleen het venster. Plan B: de Worker filtert op het venster. |
| Office-bestanden worden gedownload in plaats van geopend | zeker | middel | Office-URI's onderzoeken (fase 3), anders "pad kopiëren" |
| Browsegegevens wissen in Edge wist ook het dashboard | laag | hoog | `navigator.storage.persist()` + export als back-up; melding in de instellingen |
| Vertraging Outlook → Google | zeker | laag | geaccepteerd; buiten het dashboard |
| De Worker wordt misbruikt als open proxy | middel | middel | sleutel, host-allowlist voor ICS, groottelimiet, timeouts |
| Het bestand wordt groot en onoverzichtelijk | middel | laag | vaste secties (§4.2), kleine functies, consequente naamgeving |
| Een feed of API ligt eruit | middel | laag | cache tonen + foutstatus per tegel |

---

## 12. Beslissingen en open vragen

**Beslist**

| # | Vraag | Beslissing |
|---|-------|------------|
| V1 | Waar draait het dashboard? | **Lokaal bestand** (dubbelklik in Verkenner), ingesteld als **startpagina in Edge**. Padlinks werken daardoor direct (§6). |
| V2 | Welke browser? | **Microsoft Edge** |
| V3 | Gewone tegel = één doel, link-tegel = lijstje links? | **Ja** |
| V4 | Cloudflare-account? | **Ja, aanwezig.** Ik schrijf de Worker + instructies, jij deployt. |
| V5 | Agenda en periode? | **Google Agenda** (Outlook wordt daarheen gesynchroniseerd), **30 dagen** vooruit |

**Nog open** (beslissen we tijdens het bouwen; tot dan geldt de voorlopige keuze)

| # | Vraag | Voorlopige keuze |
|---|-------|------------------|
| V6 | Iconen voor tegels: emoji, eigen afbeelding, of automatisch het favicon van de site? (Een favicon-dienst stuurt de domeinnamen naar een derde partij.) | Emoji + optionele afbeelding-URL; favicon is opt-in |
| V7 | Grid: volstaat de volgorde-met-pijltjes, of wil je drag & drop en vaste posities? | Pijltjes in v1, drag & drop later |
| V8 | Moet het thema ook "systeem" (volgt Windows) kunnen volgen? | Ja: standaard "systeem", de knop wisselt licht ↔ donker |

---

## 13. Volgende stap

1. ~~**Fase 1**: het skelet van `index.html`~~ ✅ (header, grid, snelle links, thema, klok, modal-skelet).
2. ~~**Fase 2**: opslag~~ ✅ (`loadData`/`saveData`, IndexedDB-back-up met automatisch herstel, export/import/terugzetten
   in Instellingen → Gegevens, synchronisatie tussen tabbladen).
3. **Fase 3**: tegels en navigatie (paden, sessiebestanden, pad kopiëren, Office-bestanden).
4. Na elke fase samen kijken en waar nodig het plan bijstellen. Dit document wordt bijgewerkt als keuzes veranderen.

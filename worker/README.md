# Worker voor RSS en agenda

Het dashboard haalt RSS-feeds en je Google Agenda op via deze Cloudflare Worker. Nieuwssites en Google sturen
geen CORS-headers mee, en dan mag de browser die bestanden niet rechtstreeks lezen. De Worker haalt ze op en
geeft ze ongewijzigd door.

- **Kosten:** het gratis Workers-plan is ruim voldoende. Het staat 100.000 verzoeken per dag toe; het dashboard
  gebruikt er een paar honderd.
- **Beveiliging:** alleen verzoeken met jouw geheime sleutel worden uitgevoerd. Agenda's mogen alleen van Google
  of Outlook komen. Er wordt niets gelogd.

## Stap 1 – Bedenk een sleutel

Maak een lange, willekeurige sleutel. In Windows kan dat met PowerShell (Start → typ *PowerShell*):

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Kopieer de uitkomst. Je hebt hem straks twee keer nodig: in Cloudflare en in het dashboard.

## Stap 2 – Zet de Worker in Cloudflare

Kies één van de twee manieren.

### A. Via het Cloudflare-dashboard (niets installeren)

1. Ga naar [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create application**.
2. Kies **Create Worker** (de "Hello World"-Worker), geef hem de naam `landingspagina` en klik **Deploy**.
3. Klik **Edit code**. Vervang alle code door de inhoud van [`src/index.js`](src/index.js) en klik **Deploy**.
4. Ga terug naar de Worker → **Settings** → **Variables and Secrets** → **Add**:
   - Type: **Secret**
   - Variable name: `DASHBOARD_KEY`
   - Value: de sleutel uit stap 1

   Klik **Deploy**.
5. Noteer het adres van de Worker, bijvoorbeeld `https://landingspagina.<jouw-subdomein>.workers.dev`. Je ziet het
   op de overzichtspagina van de Worker.

### B. Met Wrangler (opdrachtregel, Node.js nodig)

```sh
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put DASHBOARD_KEY      # plak de sleutel uit stap 1
```

`wrangler deploy` toont aan het eind het adres van de Worker.

## Stap 3 – Koppel het dashboard

1. Open het dashboard → ⚙ **Instellingen** → **Koppelingen**.
2. Vul het **Worker-adres** en de **Sleutel** in.
3. Klik **Verbinding testen**. Bij "Verbinding gelukt" klik je **Opslaan**.

Wat de meldingen betekenen:

| Melding | Oplossing |
|---------|-----------|
| *De sleutel klopt niet* | De sleutel in het dashboard en het secret `DASHBOARD_KEY` verschillen. |
| *Het secret DASHBOARD_KEY is nog niet ingesteld* | Stap 2A.4 (of `wrangler secret put`) is nog niet gedaan, of niet gedeployed. |
| *De Worker is niet bereikbaar* | Controleer het adres. Het moet beginnen met `https://`. |

## Bijwerken

Komt er een nieuwe versie van `src/index.js`, plak die dan opnieuw in **Edit code** en klik **Deploy**. Met
Wrangler doe je `npx wrangler deploy`. De sleutel blijft bewaard.

## Technische details

| Route | Doel | Limieten |
|-------|------|----------|
| `GET /ping` | controleert de sleutel ("Verbinding testen") | |
| `GET /rss?url=…` | RSS- of Atom-feed ophalen | http(s), max. 2 MB, time-out 10 s, cache 15 min |
| `GET /ics?url=…` | agenda ophalen | alleen https en alleen toegestane hosts, max. 10 MB, time-out 15 s, cache 10 min |

- Elk verzoek heeft de header `X-Dashboard-Key` nodig. De sleutel wordt in constante tijd vergeleken.
- Het dashboard draait als lokaal bestand en stuurt daardoor `Origin: null`. De Worker antwoordt daarom met
  `Access-Control-Allow-Origin: *`. De sleutel is de beveiliging, niet de origin.
- Toegestane agendahosts: `calendar.google.com`, `outlook.office365.com` en `outlook.live.com`. Meer hosts voeg je
  toe met de variabele `EXTRA_ICS_HOSTS` (kommagescheiden), via **Variables and Secrets** of `wrangler.toml`.
- Na een doorverwijzing moet ook het eindadres toegestaan zijn.
- Adressen met een gebruikersnaam of wachtwoord worden geweigerd.
- Logboeken staan uit (`observability.enabled = false`), omdat verzoeken je geheime agenda-adres bevatten.

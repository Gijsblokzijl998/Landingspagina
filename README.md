# Landingspagina

Een persoonlijk dashboard als startpagina voor Microsoft Edge: tegels naar websites en lokale bestanden, het weer,
nieuws (RSS) en je Google Agenda. Het is één HTML-bestand, zonder installatie of server. Alleen voor RSS en de
agenda gebruik je een kleine Cloudflare Worker, gratis in je eigen account.

Ontwerp, keuzes en fasering staan in [PROJECTPLAN.md](PROJECTPLAN.md).

## Wat het kan

Alles stel je in via **⚙ Instellingen**. Wijzigingen worden pas bewaard als je op *Opslaan* klikt.

- **Tegels.** Voeg ze toe, bewerk, orden en verwijder ze. Je kunt ze ook direct op het dashboard verslepen. Elke
  tegel krijgt een grijs lijnicoon uit een set van 87, of een eigen teken. Er zijn vier soorten:
  - **Gewone tegel.** Opent een website, een lokaal bestand of map, of een bestand dat je per sessie kiest.
    Een lokaal pad plak je in, bijvoorbeeld via rechtsklik → *Als pad kopiëren* in Verkenner.
  - **Link-tegel.** Een lijstje links.
  - **RSS-tegel.** De nieuwste berichten van een RSS- of Atom-feed, elke 15 minuten ververst.
  - **Agenda-tegel (2 × 2).** De afspraken uit je Google Agenda van vandaag en de komende dagen (standaard 30),
    inclusief herhalende afspraken. Afgelopen afspraken worden grijs, de lopende is gemarkeerd.
- **Snelle links** in een vaste balk onderaan, met het favicon van de site. Dat is grijs tot je de link aanwijst.
- **Kopbalk** met logo, titel en welkomsttekst, het weer van je plaats (Open-Meteo) en de klok.
- **Uiterlijk.** Licht, donker of systeemthema, accentkleur, achtergrond (kleur of foto), grootte van het grid
  (tot 4 × 4) en tegelstijl. Je ziet direct een voorbeeld.
- **Gegevens.** Exporteren, importeren en terugzetten. Er is altijd een automatische back-up in de browser.

Alle links openen in een nieuw tabblad.

## Installeren als startpagina in Edge

1. Download `index.html`. Op GitHub: open het bestand en klik op **Download raw file**.
2. Zet het bestand in een vaste map, bijvoorbeeld `C:\Users\<jouw naam>\Dashboard\index.html`.
3. Dubbelklik erop; de pagina opent in Edge. Kopieer het adres uit de adresbalk (`file:///C:/Users/…/index.html`).
4. Ga in Edge naar **Instellingen** → **Start, startpagina en nieuwe tabbladen**. Kies bij *Wanneer Edge wordt
   gestart* voor **Deze pagina's openen**, klik op **Een nieuwe pagina toevoegen** en plak het adres.
   Wil je ook een Startknop in de werkbalk? Zet die aan op dezelfde instellingenpagina, met hetzelfde adres.

## RSS en agenda koppelen

1. Zet de Worker in je Cloudflare-account. De stappen staan in [worker/README.md](worker/README.md).
2. Vul bij ⚙ → **Koppelingen** het adres (`https://….workers.dev`) en de sleutel in, en klik
   **Verbinding testen**.
3. Agenda: plak bij de agenda-tegel (⚙ → Tegels) het **geheime adres in iCal-indeling**. Je vindt het in Google
   Agenda via Instellingen → jouw agenda → *Agenda integreren*. Behandel dit adres als een wachtwoord.

## Bijwerken

Vervang `index.html` door de nieuwe versie. **Je instellingen blijven bewaard.** Edge slaat ze op in de browser
(gedeeld door alle lokale bestanden), niet in het bestand zelf.

Let op: *Browsegegevens wissen → Cookies en andere sitegegevens* in Edge wist ook de instellingen van het
dashboard. Maak daarom af en toe een export via ⚙ → **Gegevens** → **Exporteren**. Het exportbestand bevat ook
je agenda-adres en je Worker-sleutel, dus bewaar het veilig.

## Problemen oplossen

| Wat je ziet | Wat te doen |
|-------------|-------------|
| Office-tegel opent het bestand niet in Word/Excel | Zet bij die tegel *Openen in Word, Excel of PowerPoint* uit. Edge biedt het bestand dan als download aan. Het pad kopiëren kan altijd met het knopje op de tegel. |
| "Koppel eerst de Worker" | Vul bij ⚙ → Koppelingen het Worker-adres en de sleutel in. |
| "De sleutel klopt niet" | De sleutel in het dashboard en het secret `DASHBOARD_KEY` in Cloudflare verschillen. |
| "Het secret DASHBOARD_KEY is nog niet ingesteld" | Het secret ontbreekt of heeft type *Text* in plaats van *Secret*; zie [worker/README.md](worker/README.md). |
| "Gebruik het workers.dev-adres van je Worker" | De beveiligingsregel van de pagina staat alleen verbindingen met `*.workers.dev` toe. |
| "Bijwerken mislukt; dit is de stand van …" | De bron of je internet is even onbereikbaar. De pagina probeert het na een paar minuten opnieuw. |
| Favicons zijn letters | Het logo van de site kon niet worden geladen, bijvoorbeeld door een netwerkfilter. De letter is de terugval. |

## Privacy en beveiliging

- Instellingen staan alleen in je browser. Er is geen server, behalve je eigen Worker.
- De pagina praat alleen met Open-Meteo, je Worker en de favicon-bronnen (DuckDuckGo, Google of de site zelf).
  Favicons kun je uitzetten bij Uiterlijk.
- Een beveiligingsregel (Content Security Policy) blokkeert alle andere verbindingen en ingevoegde scripts.
  Tekst uit feeds en agenda wordt nooit als HTML uitgevoerd.

## Voor ontwikkelaars

De tests staan in [tests/](tests/README.md): `npm install`, `npx playwright install chromium`, `npm test`.
Na het wijzigen van een script in `index.html`: `npm run csp`.

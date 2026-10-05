# Landingspagina

Een persoonlijk dashboard als startpagina voor Microsoft Edge: tegels naar websites en lokale bestanden, het weer,
nieuws (RSS) en je Google Agenda. Het is één HTML-bestand, zonder installatie of server. Alleen voor RSS en de
agenda gebruik je een kleine Cloudflare Worker, gratis in je eigen account.

Ontwerp, keuzes en fasering staan in [PROJECTPLAN.md](PROJECTPLAN.md).

## Wat het kan

Alles stel je in via **⚙ Instellingen**. Wijzigingen worden pas bewaard als je op *Opslaan* klikt.

- **Tegels.** Voeg ze toe, bewerk, orden en verwijder ze. Op het dashboard sleep je een tegel naar elk vak dat je
  wilt, ook naar een leeg vak los van de andere tegels; een gestippeld vak toont waar hij komt. Laat je hem los op
  een andere tegel, dan ruilen ze van plek. *Tegels aaneensluiten* (⚙ → Tegels) wist de vrije plaatsen weer. Elke
  tegel krijgt een grijs lijnicoon uit een set van 105 (met zoekveld, ook zakelijke iconen zoals euro, factuur en
  contract), een eigen teken of het favicon van de site. Elke tegel kan
  ook een achtergrondafbeelding krijgen; die wordt gedimd zodat de inhoud leesbaar blijft. Er zijn vier soorten:
  - **Gewone tegel.** Opent een website, een lokaal bestand of map, of een bestand dat je per sessie kiest. Ook
    als *halve tegel*: half zo hoog, met icoon en titel naast elkaar; twee passen er in één vak.
    Een lokaal pad plak je in, bijvoorbeeld via rechtsklik → *Als pad kopiëren* in Verkenner.
  - **Link-tegel.** Een lijstje links.
  - **RSS-tegel (2 × 1).** De nieuwste berichten van een RSS- of Atom-feed, met het logo uit de feed of het favicon van de site
    als icoon.
    Eén regel per bericht, met vooraan een korte datum in de accentkleur (tijd van vandaag, dag deze week, anders de
    datum). Elke 15 minuten ververst.
  - **Agenda-tegel (standaard 3 × 2, instelbaar tot de breedte en hoogte van het grid).** De afspraken uit je Google Agenda van
    vandaag en de komende dagen (standaard 30), inclusief herhalende afspraken. Tijden staan in de accentkleur.
    Afgelopen afspraken worden grijs. De lopende afspraak is gemarkeerd met "nog … min", de eerstvolgende met
    "over … min".
- **Vaste tegelmaat.** Hoe groot een tegel is, kies je met *Tegelgrootte* (Automatisch volgt je scherm). Meer
  kolommen of rijen maken het grid groter, niet de tegels kleiner; een tegel vergroten of verslepen verandert de
  andere tegels ook niet. Lege rijen en kolommen buiten het venster zie je alleen tijdens het slepen; scrollen kan
  alleen naar plekken waar tegels staan.
- **Snelle links** in een vaste balk onderaan, met het favicon van de site. Dat is grijs tot je de link aanwijst.
- **Kopbalk** met logo, titel en welkomsttekst, het weer van je plaats (Open-Meteo) en de klok.
- **Uiterlijk.** Licht, donker of systeemthema, accentkleur en achtergrond: een zacht verloop (zes keuzes), een
  effen kleur of een foto. Verder de grootte van het grid (tot 12 kolommen × 8 rijen), de tegelgrootte (*Automatisch* groeit mee
  op grote schermen, met de tekst), de tegelvorm (vierkant of breder) en de tegelstijl: afgerond, vierkant of
  *Glas* (doorschijnend). Je ziet direct een voorbeeld.
- **Gegevens.** Exporteren, importeren en terugzetten. Er is altijd een automatische back-up in de browser.

Alle links openen in een nieuw tabblad. Lukt het laden van een feed of agenda niet, dan staat er een knop
*Opnieuw proberen*; ontbreekt een instelling, dan opent een knop direct de juiste plek in Instellingen.

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
(gedeeld door alle lokale bestanden), niet in het bestand zelf. Afbeeldingen (logo, achtergrond, tegelachtergronden)
staan in IndexedDB, zodat ze de kleine opslag van localStorage niet vullen; een export bevat ze wel.

Let op: *Browsegegevens wissen → Cookies en andere sitegegevens* in Edge wist ook de instellingen van het
dashboard. Maak daarom af en toe een export via ⚙ → **Gegevens** → **Exporteren**. Het exportbestand bevat ook
je agenda-adres en je Worker-sleutel, dus bewaar het veilig.

## Problemen oplossen

| Wat je ziet | Wat te doen |
|-------------|-------------|
| Office-tegel opent het bestand niet in Word/Excel | Zet bij die tegel *Openen in Word, Excel of PowerPoint* uit. Edge biedt het bestand dan als download aan. |
| "Koppel eerst de Worker" | Vul bij ⚙ → Koppelingen het Worker-adres en de sleutel in. |
| "De sleutel klopt niet" | De sleutel in het dashboard en het secret `DASHBOARD_KEY` in Cloudflare verschillen. |
| "Het secret DASHBOARD_KEY is nog niet ingesteld" | Het secret ontbreekt of heeft type *Text* in plaats van *Secret*; zie [worker/README.md](worker/README.md). |
| "Gebruik het workers.dev-adres van je Worker" | De beveiligingsregel van de pagina staat alleen verbindingen met `*.workers.dev` toe. |
| "Bijwerken mislukt; dit is de stand van …" | De bron of je internet is even onbereikbaar. De pagina probeert het opnieuw na 2, dan 5, daarna elke 15 minuten; met *Opnieuw* direct. |
| "De gewone opslag van de browser is vol" | Je instellingen staan wel in de back-up (IndexedDB) en komen bij het openen terug. Ruim eventueel grote achtergrondafbeeldingen op. |
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

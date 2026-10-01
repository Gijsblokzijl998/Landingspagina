# Landingspagina

Een persoonlijk dashboard als startpagina voor Microsoft Edge: tegels naar websites en lokale bestanden, weer,
nieuws (RSS) en je agenda. Het is één HTML-bestand, zonder installatie of server.

Ontwerp, keuzes en fasering staan in [PROJECTPLAN.md](PROJECTPLAN.md).

## Status

**Fase 1 t/m 7 zijn klaar.** Alles stel je in via ⚙ Instellingen:
- **Tegels** toevoegen, bewerken, ordenen en verwijderen. Een gewone tegel opent:
  - een **website**;
  - een **lokaal bestand of map**: plak het pad, bijvoorbeeld via rechtsklik → *Als pad kopiëren* in Verkenner;
  - een **bestand dat je per sessie kiest**.
- **Link-tegels** met een lijstje links, en de balk met **snelle links**.
- **Uiterlijk**: thema, accentkleur, achtergrond (kleur of foto), gridgrootte en tegelstijl, met een live voorbeeld.
- **Algemeen**: titel, welkomsttekst en logo (adres, pad of upload).
- **Gegevens**: exporteren, importeren en terugzetten. Instellingen worden bewaard, met een automatische back-up.

- **Weer & klok**: het weer in de kopbalk (Open-Meteo). Zoek je plaats op naam; klik op het weer om hem te
  wijzigen.

Alle links openen in een nieuw tabblad. Tegels hebben grijze lijniconen; kies er een uit de set van 87
in de tegel-editor. Snelle links staan in een vaste balk onderaan. Snelle links en links in een link-tegel tonen
het favicon van de site, grijs tot je de link aanwijst. Die favicons komen van DuckDuckGo, Google of de site
zelf, met de eerste letter als terugval; uitzetten kan bij Uiterlijk.

- **Koppelingen**: het adres en de sleutel van je Cloudflare Worker, met de knop *Verbinding testen*. Hoe je
  de Worker aanmaakt, staat in [worker/README.md](worker/README.md).

- **RSS-tegels** tonen de nieuwste berichten van een RSS- of Atom-feed, opgehaald via die Worker en elke
  15 minuten ververst.

De agenda volgt in de volgende fase.

**Office-bestanden:** een tegel naar een .docx, .xlsx of .pptx probeert het bestand direct in Word, Excel of
PowerPoint te openen. Edge vraagt daarvoor eerst toestemming. Werkt dat niet, zet dan bij die tegel "Openen in
Word, Excel of PowerPoint" uit. Edge biedt het bestand dan als download aan, of je kopieert het pad met het
knopje op de tegel.

## Installeren als startpagina in Edge

1. Download `index.html`. Op GitHub: open het bestand en klik op **Download raw file**.
2. Zet het bestand in een vaste map, bijvoorbeeld `C:\Users\<jouw naam>\Dashboard\index.html`.
3. Dubbelklik erop. De pagina opent in Edge. Kopieer het adres uit de adresbalk (`file:///C:/Users/…/index.html`).
4. Ga in Edge naar **Instellingen** → **Start, startpagina en nieuwe tabbladen**. Kies bij *Wanneer Edge wordt
   gestart* voor **Deze pagina's openen**, klik op **Een nieuwe pagina toevoegen** en plak het adres.
   Wil je ook een Startknop in de werkbalk? Zet die aan op dezelfde instellingenpagina, met hetzelfde adres.

## Bijwerken

Vervang `index.html` door de nieuwe versie. **Je instellingen blijven bewaard.** Edge slaat ze op in de browser
(gedeeld door alle lokale bestanden), niet in het bestand zelf.

Let op: *Browsegegevens wissen → Cookies en andere sitegegevens* in Edge wist ook de instellingen van het
dashboard. Maak daarom af en toe een export via ⚙ Instellingen → **Gegevens** → **Exporteren**. Met
**Importeren** zet je hem terug, ook op een andere computer.

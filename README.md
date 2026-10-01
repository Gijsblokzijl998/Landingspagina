# Landingspagina

Een persoonlijk dashboard als startpagina voor Microsoft Edge: tegels naar websites en lokale bestanden, weer,
nieuws (RSS) en je agenda. Het is één HTML-bestand, zonder installatie of server.

Ontwerp, keuzes en fasering staan in [PROJECTPLAN.md](PROJECTPLAN.md).

## Status

**Fase 1 (skelet en thema) en fase 2 (opslag) zijn klaar.** Werkend:
- header met titel, welkomsttekst en klok;
- het tegelgrid;
- de balk met snelle links;
- het licht/donker-thema;
- instellingen worden bewaard, met een automatische back-up;
- exporteren, importeren en terugzetten via ⚙ Instellingen → Gegevens.

Tegels bewerken, het weer, RSS en de agenda volgen in de volgende fases.

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

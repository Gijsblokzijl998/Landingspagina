# Tests

Automatische tests voor het dashboard (`index.html`) en de Worker (`worker/src/index.js`). Ze openen de pagina
in Chromium, de engine van Edge, als lokaal bestand (`file://`), net zoals jij hem gebruikt.

Internet is niet nodig. Weer, feeds, agenda en favicons worden nagebootst met echte voorbeeldantwoorden uit
`fixtures/`. Dat zijn een NOS-feed (RSS 2.0), The Verge (Atom), een Google-achtige agenda met herhalingen,
uitzonderingen en de overgang naar wintertijd, en antwoorden van Open-Meteo. De Worker-code draait in Node en
krijgt de verzoeken van het dashboard.

## Draaien

Je hebt [Node.js](https://nodejs.org) nodig (LTS).

```sh
npm install                        # Playwright en axe-core
npx playwright install chromium    # eenmalig: de testbrowser
npm test                           # alle suites, met een samenvatting
```

Eén suite apart draaien: `node tests/09-agenda.mjs`. Schermafbeeldingen komen in `tests/output/`.

## Wat er getest wordt

| Suite | Onderwerp |
|-------|-----------|
| `check-csp.mjs` | kloppen de SHA-256-hashes van de scripts in de beveiligingsregel? |
| `worker.mjs` | Worker: sleutel, CORS, allowlist, doorverwijzingen, groottelimiet, time-out, cache |
| `01-basis` | kopbalk, grid, thema zonder flits, modal, smal en breed venster |
| `02-opslag` | opslaan, herstel uit de back-up, export/import, opschonen, tweede tabblad |
| `03-tegels-instellingen` | paden en Office-links, sessiebestanden, alle instellingen, validatie, logo en achtergrond |
| `04-weer-links-favicons` | weer en cache, plaats zoeken, favicons met terugval, nieuw tabblad |
| `05-ontwerp-iconen` | kop- en voetbalk, iconenkiezer, migratie van emoji's |
| `06-worker-koppeling` | "Verbinding testen" tegen de echte Worker-code |
| `07-rss` | RSS/Atom/RDF lezen, tegel, cache, storingen, onveilige links |
| `08-kopbalk-slepen` | titel en welkom in het midden, grootte van de modal, tegels vrij verslepen, ruilen, aaneensluiten |
| `09-agenda` | ICS lezen, herhalingen, tijdzones, wintertijd, tegel per dag |
| `10-toegankelijkheid` | axe-core op dashboard en alle instellingen (licht en donker), toetsenbordbediening |
| `11-beveiliging` | geen CSP-overtredingen bij normaal gebruik; onbekende servers en ingevoegde scripts geblokkeerd |
| `12-indeling-favicons` | brede RSS-tegel, compacte links en agenda, grid tot 8 × 8, favicons via de Worker |
| `13-favicon-achtergrond` | favicon als tegelicoon, accentkleur voor datum en tijd, agendagrootte, tegelachtergrond |
| `14-halve-tegel-iconen` | halve tegels, zakelijke iconen en zoeken, tijdkolom van de agenda |

## Na het wijzigen van een script in index.html

De beveiligingsregel staat alleen scripts toe met een bekende vingerafdruk. Werk die bij met:

```sh
npm run csp
```

# Phasograph CAD (Фазограф КАД) — mapping 0.4 / 10 kV street power grids

**English** · [Русский](README.ru.md) · [Հայերեն](README.hy.md) · Live: https://georgy-garnov.github.io/Phasograph/

**Phasograph CAD** (Russian: **Фазограф КАД**, Armenian: **Ֆազոգրաֆ CAD**; the name follows the interface language) is a web app for mapping
distribution grids directly on an online map (OpenStreetMap via Leaflet or Yandex Maps JS API v3, switchable in
the header): substations, poles, spans with individual wires on insulators, service drops to houses — and
automatic calculation of every customer's phase by tracing from the substation outputs.

## Getting started

```bash
npm install
npm run dev               # http://localhost:5173 — OpenStreetMap by default, no API keys needed
npm test                  # unit tests (tracing, GeoJSON, storage, ZIP)
npm run build             # type check + production build into dist/
```

## Projects, photos, export

- On start you get a **project list** (stored in the browser, IndexedDB): create, open, rename, duplicate,
  delete. Projects are saved automatically. A scheme from earlier versions (localStorage) is moved into a
  "My project" project on first launch.
- **Photos** for poles, substations and houses: "📷 Take photo" opens the camera right away on a phone/tablet;
  after the shot the photo is downscaled (~1920 px) and stored in the project; "🖼 From gallery" adds existing
  pictures. Full-screen viewer with captions and deletion; objects with photos show a 📷 mark on the map.
- **Export**: GeoJSON (scheme only) or ZIP — `project.geojson` + `photos/*.jpg`
  (objects carry `properties.photos = [{ id, file, caption, createdAt }]`).
  **Import** of a ZIP or GeoJSON creates a new project.
- **Languages**: Russian, English and Armenian (🌐 switch in the header and on the project screen; the browser
  language is used by default).

## Offline and iPad (PWA)

The built app is a PWA: after the first visit it works without a network. In Safari on iPad:
Share → Add to Home Screen. Map tiles you viewed online are cached (OSM and satellite — up to ~8000/4000 tiles)
and shown offline. Offline mode needs HTTPS (or localhost), so for iPad the app must be published, e.g. on
GitHub Pages.

### Publishing on GitHub Pages

1. Settings → Pages → Source: **GitHub Actions** (already enabled for this repository).
2. The `.github/workflows/pages.yml` workflow runs the tests, builds and publishes `dist/` on every push to
   `main`/`master`. URL: `https://<user>.github.io/<repository>/`.

To check offline mode locally: `npm run build && npm run preview`, open http://localhost:4173, then go offline
and reload the page.

## Geodata providers

Chosen in the header and remembered in the browser. The scheme does not depend on the provider — you can switch
at any time.

| Setting | Options |
|---|---|
| Map | **OpenStreetMap (Leaflet)** — free, no key; "Map" (OSM) and "Satellite" (Esri World Imagery) base layers. **Yandex Maps** (JS API v3) — requires a key. |
| Addresses | **Nominatim (OSM)** — free, at most 1 request/s (requests are queued). **Yandex Geocoder** — requires a key. |

The Yandex key is a "JavaScript API and HTTP Geocoder" key from https://developer.tech.yandex.ru/; JS API v3
requires an HTTP Referer restriction (add `localhost` and your production domain). Enter the key in the form shown
when Yandex is selected, or set `VITE_YMAPS_API_KEY` in `.env` (see `.env.example`).
Check the providers' terms before production use: tile.openstreetmap.org and Nominatim are meant for moderate load
with attribution; for many users you need your own tile server or a commercial provider.

## How it works

1. **Substation** — place it on the map and set its feeders and the role of every output (A, B, C, N, Lighting, ABC).
2. **0.4 kV main line** — click the substation, then the map/poles. Clicking empty space creates a pole.
   Wires are laid out automatically: insulators of a new pole mirror the previous one; a line started from an
   empty pole gets a standard 5-wire zigzag (A, B, C, N, lighting — phases become known once it is connected to a
   substation). A second line from the substation to the same pole takes the next free feeder (shared spans).
3. **Pole** → insulator layout: side (left/right/center), number from the bottom shared by all sides (zigzag:
   L1, R2, L3, R4, L5; the same number left and right is a crossarm; "center" (C) insulators sit on the pole body,
   e.g. a branch on a T-junction pole), type (pin / ABC clamp), jumpers ("⚡ Jumper" and a click on two insulators
   in the diagram), connected wires. Clicking an insulator highlights the wire along its whole length.
   **ABC (SIP) cable** — a clamp holds a cable with a core set: 1+N (phase + neutral), 3+N, or 3+N+L (with a street
   lighting core). Cores are marked as on the cable (GOST 31946: phases 1, 2, 3 with as many ribs, neutral 0,
   lighting 4) and colored by the traced phase; every core is its own connection point for spans, drops, luminaires and
   jumpers, so the phase is traced through ABC. Clicking the cable on the pole drawing magnifies its cross-section for
   picking a core. The cable type set on one clamp applies to the whole ABC run. Laying an ABC span from a pole with
   bare wires adds a clamp with jumpers from the insulators to the cores of the same roles. On the map an ABC span is a
   black sheath with the colored cores inside. Bundle clamps of older projects are converted on opening.
4. **Junctions** — the span card sets, for every wire, the insulator on the next pole ("was on L2 up to pole X →
   continues on R1 of pole Y"); "By position" matches identical positions. The lighting wire on the same crossarm is
   the substation "Lighting" output and needs no separate drawing; the "Street lighting cable" tool is for a
   separate lighting cable (dashed).
5. **House** — click a building (the address comes from the selected geocoder) or draw its **outline**.
   "Edit outline" in the house card shows corner and wall handles: drag corners (a magnet snaps them to right
   angles — the wall turns green — and releases beyond 10 px) or move walls parallel to themselves; changes are a
   draft until "Finish editing" (Enter), "Cancel" (Esc) discards them. A click on the centre handle toggles reshape (✥)
   and rotate (↻); in reshape mode dragging it moves the whole outline, in rotate mode dragging any corner turns the whole outline around its fixed centre. Service entries
   on the walls keep their wall and position along it, so they and their drops follow outline edits and house moves.
6. **Service drop** — click a pole, then a house/entry. In the drop editor, click insulators in the pole diagram to
   set the phase wire and neutral (L1, L2, L3, N for three-phase customers). The house phase is computed and shown
   by the marker color; on an ABC cable pick the core in the magnified cross-section (with a bundle substation output
   the phase is set manually). Clicking a house outline puts the entry on the wall at that
   point; fiber is brought into houses the same way.
7. **Luminaire on pole** — clicking a pole hangs a luminaire and connects it to the lighting wire (L) and neutral;
   the pole card has a "Street lighting" section with type, power, supply and neutral insulators. The map shows ✹
   next to the pole (grey when unpowered); clicking it selects the luminaire, Del removes it. The "Lighting" report
   tab lists luminaires and power per feeder.
8. Cards show lengths computed from coordinates: span/drop length, network distance to the substation (along
   0.4 kV wires, not straight; the nearest substation if there are several), main line and drop length per feeder.
9. The "Checks" panel reports short circuits (different phases on one wire), feeder rings, unconnected wires,
   customers without neutral, manual vs computed phase mismatches, luminaires without supply/neutral.
   "Feeders" shows customers per phase.

Shortcuts: `Esc` — finish a line / cancel the tool, `Del` — delete, `Ctrl+Z` / `Ctrl+Shift+Z`, `Enter` — finish an outline.

## Voltage-drop calculator

Houses have a **design connection power** and a **current consumption** (kW); spans and drops have a
**conductor** from a catalog (bare aluminium A-16…A-95, ACSR, copper, ABC SIP-2 / SIP-4 with r, x per km;
defaults: A-35 for bare main lines, SIP-2 3×50+1×54.6 for ABC, SIP-4 2×16 for drops); substations have a
busbar phase voltage (230 V by default). For every feeder the app builds the path from the substation to each
house over the traced spans, sums the loads per phase and computes the neutral current as the phasor sum of the
phase currents, so unbalanced phasing shows up as a neutral shift. A **mini digital voltmeter** next to every house
shows the phase voltage at its entry (green within 207–253 V, ±10% by GOST 32144, red otherwise). A three-phase house shows three displays, one per phase (A, B, C), and can take its design and
current load per phase ("Load per phase" in the house card; otherwise the total is split equally). The "Voltage" report tab switches between current and design loads, toggles the
voltmeters and lists houses from the lowest voltage. cos φ = 0.95; resistances are typical values at 20 °C.

**Substation (transformer).** The substation card sets the transformer rating (standard 25…2500 kVA; the type is
shown as e.g. "TS-250/10/0,4"), the HV class (6 or 10 kV), the actual HV supply (to emulate a sag, e.g. 5500 V instead
of 6000) and the off-circuit tap changer position (+5 / +2.5 / 0 / −2.5 / −5 % of the HV winding). The no-load 0.4 kV
voltage is 230.9 V × (U_HV / U_HV,nom) / (1 + tap); under load the busbar voltage drops on the transformer
short-circuit impedance (typical uk and load losses for the rating) carrying the sum of all feeder currents. Next to
the substation a panel of the same mini displays shows busbar voltages and currents per phase, the load in kVA and %
of the rating, the HV voltage and the HV current. HV poles and lines are labelled 6/10 kV.

## Data model

`src/model/types.ts`. Nodes (Point): `ktp`, `pole10`, `pole04`, `poleService`, `entry`, `house` (optional outline).
Lines (LineString between two nodes): `line10`, `line04`, `drop`, `lighting`, `fiber`.

A wire is `{ id, fromPort, toPort }`, where a port is a pole insulator id or a substation output id (no port at an
entry/house). A pole jumper connects two of its insulators.

GeoJSON (`src/model/geojson.ts`): a FeatureCollection with all attributes and links in `properties`:

```json
{ "type": "Feature", "geometry": { "type": "Point", "coordinates": [37.61, 55.75] },
  "properties": { "kind": "pole04", "id": "pole04_…", "number": "12",
    "insulators": [{ "id": "ins_1", "side": "L", "position": 1, "type": "pin" }], "jumpers": [] } }
{ "type": "Feature", "geometry": { "type": "LineString", "coordinates": [[…], […]] },
  "properties": { "kind": "line04", "from": "pole04_…", "to": "pole04_…", "suspension": "bare",
    "wires": [{ "id": "w_1", "fromPort": "ins_1", "toPort": "ins_7" }] } }
```

Export adds `properties.trace` (computed phases of houses and wires); it is ignored on import. Lines without
`from`/`to` are snapped to nodes within 3 m of their ends.

## Tracing algorithm

`src/topology/trace.ts`. Graph vertices are terminals (substation output, insulator, ABC core, wire end at an entry), edges
are wires and jumpers. A breadth-first search with a `{feeder, role}` label starts from every substation output.
Every core of an ABC cable is a separate terminal, so phases pass through ABC unchanged; only an "ABC" substation
output (a bundle with unknown cores) marks labels as "bundled" — the feeder is known, the phase is not. A single-phase house gets the only unambiguous phase among the wires of its drops. Manual wire
markings act as extra sources and are checked against the substation tracing.

## Project structure

```
src/model      types, scheme operations, store (undo/redo, project autosave), GeoJSON
src/storage    IndexedDB (projects, photos), ZIP archive, photo downscaling
src/i18n       localization: ru.ts (reference key set), en.ts, hy.ts, object labels
src/topology   tracing and checks, lengths and distances to substations (distances.ts)
src/map        scene.ts — what to draw (parallel wires offset in pixels), provider-independent;
               adapter.ts — interface and diff updates; leafletAdapter.ts / yandexAdapter.ts — providers;
               geocoder.ts — Nominatim / Yandex; interactions.ts — drawing tools
src/ui         panels: substation, insulator layout, span/drop, customer, reports, projects, photos
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free for noncommercial use — personal use, education, research,
noncommercial and government organizations. Commercial use requires a separate license: please open a
[GitHub issue](https://github.com/Georgy-Garnov/Phasograph/issues).

Copyright © 2026 Georgiy Garnov.

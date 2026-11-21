# Metro Web — Plan

A map of a city's metro network: running and planned lines in their official colours, stations, and simulated trains moving along the tracks. It should look futuristic: a tilted 3D view, glowing lines, light trails behind the trains. It covers **Bengaluru (Namma Metro)**, **Delhi NCR (Delhi Metro, Noida Aqua Line, Rapid Metro Gurugram)** and **Mumbai (Mumbai Metro and Navi Mumbai Metro)**. Each city is a data folder, a fetch config and a registry entry.

---

## 1. What you see

- **Full-screen map** that opens tilted (about 45°) over Bengaluru. You can rotate it and zoom in and out.
- **Three themes**, switched with a toggle that starts on your system setting:
  - **Ivory**: off-white land, warm grey roads, muted water.
  - **Mist**: cool, slightly darker off-white.
  - **Slate**: dark slate land, low-contrast roads; the line colours glow.
- **Lines** drawn by status:
  - Operational: solid, with a soft glow.
  - Under construction: dashed, at half strength.
  - Planned / approved: thin dotted, faint, labelled "Planned".
- **Stations**: small dots. Interchange stations get a ring in two colours. Names fade in as you zoom.
- **Trains**: small capsules moving along the operational lines, each leaving a short light trail in its line's colour. They run on a simulated timetable (see §4).
- **Side panel** (glass look, collapses on mobile):
  - City picker: Bengaluru, Delhi, Mumbai. Each has its own URL (`/bengaluru`, `/delhi`, `/mumbai`) that works with Back/Forward.
  - Line list with a colour chip, length, station count and status, plus a toggle to show or hide each line.
  - Status filter: Operational / Under construction / Planned.
  - Network stats: km running, km coming, station count.
- **Clicking a station** shows a card with its name (English and the local script: Kannada, Hindi or Marathi), lines, status, opening year and interchanges.
- **Time bar** at the bottom: play/pause, a simulated clock, and speed (1× / 10× / 60×).
- **(Phase 2) "Network in year" slider**: drag from 2011 to 2030 and watch the network grow, segment by segment.

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| App | **Vite + React + TypeScript** | Fast, simple, builds to static files |
| Map | **MapLibre GL JS** | Free, no API key, real 3D tilt and buildings |
| Basemap tiles | **OpenFreeMap** vector tiles | Free with no key; we restyle it into Ivory and Slate ourselves |
| Trains and glow | **deck.gl** (`TripsLayer`, `PathLayer`) on top of MapLibre | Built-in animated trails, uses the GPU |
| Styling | Plain CSS with tokens (CSS variables) | Both themes come from one set of tokens |
| State | Zustand (tiny) | Theme, filters, clock, selected station |
| Hosting | Static: Vercel / Netlify / GitHub Pages | No backend needed |

Optional extra: 3D building extrusions in the Slate theme for the "futuristic city" look. They can be turned off on slow devices.

## 3. Data model (per city, which keeps it multi-city)

City data is static, served from `public/` and loaded at runtime. To add a city:
1. Add a config to `CITIES` in `scripts/fetch-osm.mjs`: bbox, route `ref` → line id, construction/proposed way names → line id (with an optional status override), networks to ignore, and the local-name language.
2. Run `node scripts/fetch-osm.mjs <id>`, then write `city.json` (lines, colours, termini, `openings`) and `service.json`.
3. Add the city to `CITIES` in `src/data/cities.ts`. The tests in `src/data/data.test.ts` check every city: openings resolve, opened sections cover the running track, and trains run on every open line.

```
public/data/cities/
  bengaluru/
    city.json              ← hand-written: name, camera, line names/colours/termini, asOf
    lines.geojson          ← generated: track per line + status (operational/construction/planned)
    stations.geojson       ← generated: stations with lineIds, futureLineIds, interchange
    manual.geojson         ← optional hand-traced track, merged in by the script
```

Run `npm run data:<city>` to regenerate the two generated files from OpenStreetMap. Add `--cached` to rebuild from the last download.

**How the script reads OSM (all cities)**
- A line can have several route relations: both directions of the same track, and real branches. It keeps the longest one, then any relation that mostly runs on new track, and marks it as a branch (e.g. `blue:4`, Delhi's Yamuna Bank – Vaishali). Branches get their own trains and can have their own headway in `service.json`.
- Station names lose the per-line and per-direction suffixes OSM uses, such as "Kirti Nagar (Blue Line)" or "(eastbound)", so the same interchange merges into one station.
- Where a route has stop positions but no station node, the stop positions become the stations (Mumbai Line 1, Navi Mumbai).
- Openings in `city.json` can use `<start>`/`<end>` for the end of a track (needed for Delhi's Pink ring).

**Where the Bengaluru data comes from (OSM, 20 Nov 2026)**
- Running lines (Purple, Green, Yellow, and Pink's elevated section): OSM route relations.
- Blue Line Phase 2B (Airport) and the planned Orange and Red lines: OSM `railway=construction` and `railway=proposed` ways.
- Stations under construction: OSM `construction:station=subway`, with each station's `colour` tag giving its line.
- **Derived**, because OSM has the stations but no track yet: Pink underground (Dairy Circle – Nagawara) and Blue Phase 2A (Silk Board – KR Puram). These are drawn by joining the stations in order, so they're approximate.
- A station near a line it doesn't serve yet gets that line under `futureLineIds` (e.g. MG Road → Pink, KR Puram → Blue).

## 4. Train simulation (built in Phase 2)

There's no public live train-location feed for Namma Metro, so trains are **simulated** and labelled that way.

- `public/data/cities/<id>/service.json` sets the service pattern: first and last departures, headway bands by time of day, a per-line headway scale, top speed, acceleration and dwell times.
- `src/sim/` holds the engine, as pure TypeScript with unit tests (`npm test`):
  - `motion.ts`: accelerate, cruise and brake between stations (a triangular profile on short hops).
  - `timetable.ts`: snaps stations onto the track, builds every trip of the day in both directions, and works out where each train is at any time.
  - `clock.ts`: the simulation clock (play/pause, 1×/10×/60×/300×, scrub, "Now" = real IST).
- The service day runs 04:00 to 04:00, so late trains that cross midnight stay on one clock.
- Rendering: deck.gl `TripsLayer` draws the fading trails on the GPU, and a `ScatterplotLayer` draws the train heads (hover one for its line, destination and next stop).
- Result for Bengaluru: about 1,160 trips a day and 82 trains running at 09:00. End-to-end times look realistic (Purple 73 min, Green 58, Yellow 30).
- If BMRCL publishes a GTFS timetable, it can replace `service.json` behind the same `Trip` shape.

## 5. Project structure

```
src/
  app/            App shell, routes (/:cityId)
  map/            MapView, basemap styles (ivory.json, slate.json), layers
  layers/         linesLayer, stationsLayer, trainsLayer, glow helpers
  sim/            schedule builder, train position maths (pure, unit-tested)
  ui/             Sidebar, LineList, StationCard, TimeBar, ThemeToggle, CityPicker
  data/cities/    per-city data (see §3)
  theme/          tokens.css, line palette helpers
scripts/
  fetch-osm.ts    pulls OSM data → GeoJSON for a city
```

## 6. Build phases

**Phase 1: Foundation ✅ done**
1. Set up Vite + React + TS, add linting and formatting.
2. MapLibre with the OpenFreeMap tiles, Ivory and Slate styles, theme toggle, tilted camera.
3. Bengaluru data: OSM fetch script, hand-traced planned lines, `city.json`.
4. Lines and stations layers with status styling and interchange rings.

**Phase 2: Motion ✅ done**
5. Simulation engine (pure TS, with unit tests).
6. deck.gl trains with trails, plus the time bar (play/pause/speed/clock).

**Phase 3: Panels and polish ✅ done**
7. Side panel: line list with focus (station list, others dimmed), eye toggle to hide, status filters, stats, station search (`/`).
   Station card: lines, future interchanges, opening year, simulated next trains each way.
8. Mobile layout, About panel (sources, what's simulated), keyboard shortcuts, trains lazy-loaded after the map.
9. "Watch the network grow": a 2011 → 2031 year player. Sections are cut from the running lines using `openings` in city.json (hand-compiled, approximate), and unopened sections use each line's `expectedYear`.

**Phase 4: More cities ✅ done**
10. Delhi NCR and Mumbai from OSM (21 Nov 2026), with branch support, station-name merging and stop-position fallback in the fetch script.
    - Delhi: 13 lines, 413 km running, 274 stations open; Phase 4 corridors under construction or planned. Namo Bharat (RRTS) is excluded.
    - Mumbai: 9 lines, 97 km running, 86 stations open; Lines 2B, 4, 5, 6, 9 and Navi Mumbai Stage 2 under construction. Monorail and suburban rail are excluded.
11. City picker with `/bengaluru`, `/delhi` and `/mumbai` routes; `npm run build` also writes `404.html` so these URLs load on static hosts.
    Hosting: GitHub Pages from `main` → `/docs` at metro.visrey.me. `npm run build` writes the site into `docs/` (with `CNAME`, `.nojekyll` and `404.html`); commit `docs/` to publish.
12. Camera opens fitted to each city's running network, panel-aware on desktop and phone. Line station lists follow the actual track, with branches listed separately.

**Not yet**
- Opening years for Delhi and Mumbai are hand-compiled and approximate, like Bengaluru's.
- Mumbai Line 4 shows track but almost no stations, because OSM doesn't map them yet.

## 7. Defaults chosen (change any of these)

- React + MapLibre + deck.gl, rather than Three.js. It gives us a real map with 3D and trails without building a 3D engine.
- Trains are simulated and labelled that way.
- Static hosting, no backend.
- English labels first; local-script names (`nameLocal`) are shown on station cards and searchable.

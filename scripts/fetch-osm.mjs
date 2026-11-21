#!/usr/bin/env node
// Pulls a city's metro network from OpenStreetMap (Overpass API) and writes
// public/data/cities/<city>/{lines,stations}.geojson.
//
//   node scripts/fetch-osm.mjs bengaluru            # fetch fresh + build
//   node scripts/fetch-osm.mjs bengaluru --cached   # rebuild from last fetch
//
// Data © OpenStreetMap contributors, ODbL.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Per-city extraction rules. Line ids must match city.json. */
const CITIES = {
  bengaluru: {
    bbox: [12.7, 77.3, 13.35, 77.9], // S, W, N, E
    // Operational lines: OSM route relation `ref` → our line id
    routeRefs: { Purple: 'purple', Green: 'green', Yellow: 'yellow', Pink: 'pink' },
    // Construction / proposed ways: name regex → line id
    wayNames: [
      [/Phase 2A|Phase 2B/i, 'blue'],
      [/Purple Line Extension/i, 'purple'],
      [/ORR-West|Orange/i, 'orange'],
      [/Hosahalli-Kadabagere/i, 'orange'],
      [/Red Line \(/i, 'red'],
    ],
    // Station `colour` tag → line id (used for stations of unopened lines)
    stationColours: { '#ff49a7': 'pink', blue: 'blue', '#0000ff': 'blue', red: 'red', orange: 'orange' },
    // Track OSM hasn't mapped yet: chain the line's stations that sit further than
    // `coverM` from any mapped track, joined onto the nearest mapped track ends.
    deriveFromStations: [
      { lineId: 'pink', status: 'construction', coverM: 160 }, // underground Dairy Circle – Nagawara
      { lineId: 'blue', status: 'construction', coverM: 1000 }, // Phase 2A, Silk Board – KR Puram (ORR)
    ],
    // Station names to drop (depots, pocket tracks, etc.)
    ignoreNames: [/depot/i, /pocket/i],
    localLang: 'kn',
  },
  delhi: {
    bbox: [28.3, 76.8, 28.95, 77.6], // NCR: Delhi, Noida, Gurugram, Faridabad, Ghaziabad
    routeRefs: {
      1: 'red', 2: 'yellow', 3: 'blue', 4: 'blue', 5: 'green', 6: 'violet', 7: 'pink', 8: 'magenta', 9: 'grey',
      AEx: 'airport', RMGL: 'rapid', 'Aqua Line': 'aqua',
    },
    wayNames: [
      [/R K Ashram Marg to Krishna Park/i, 'magenta', 'construction'], // Phase 4 Magenta extension
      [/Tughlakabad to (Domestic )?Airport/i, 'golden', 'construction'], // Phase 4 Golden Line
      [/Rithala.*Narela/i, 'red', 'construction'], // Phase 4 Red extension
      [/Indraprastha to Inderlok/i, 'green'], // Phase 4, Green Line extension
      [/Saket G Block to Lajpat Nagar/i, 'silver'],
      [/Airport Express Line.*Extension/i, 'airport'],
      [/Vaishali to Ghaziabad/i, 'blue'],
      [/Line-5 Extension/i, 'green'],
      [/Aqua Line|Botanical Garden to Noida Sector 142/i, 'aqua'],
    ],
    ignoreNames: [/depot/i, /pocket/i],
    ignoreNetworks: [/RapidX|RRTS|Namo Bharat/i], // regional rail, not metro
    localLang: 'hi',
  },
  mumbai: {
    bbox: [18.85, 72.75, 19.35, 73.2], // MMR: Mumbai, Thane, Navi Mumbai
    // ref 4 is a "(u/c)" relation for Line 4; its track comes from the construction ways.
    routeRefs: { 1: 'blue', 2: 'yellow', '2B': 'yellow', 3: 'aqua', 7: 'red', 9: 'red', N1: 'navi' },
    wayNames: [
      [/Line-2\)|Mandale/i, 'yellow'],
      [/^Line 4A?$/i, 'green'],
      [/^Line 1[01]$/i, 'green'], // Gaimukh – Shivaji Chowk, Wadala – Gateway: Line 4 extensions
      [/Line-5/i, 'orange'],
      [/^Line 6$/i, 'pink'],
      [/^Line 9$|^Line 7A$/i, 'red'],
      [/Navi Mumbai Metro Line 1/i, 'navi'],
      [/^Thane Ring Metro$/i, 'thane'],
    ],
    ignoreNames: [/depot/i, /pocket/i, /car ?shed/i, /^SBI-Dadar/i], // SBI-Dadar duplicates Dadar (Line 3)
    ignoreNetworks: [/Suburban/i],
    localLang: 'mr',
  },
};

// ---------------------------------------------------------------- fetch

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'metro-web-data-script/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith('{')) return JSON.parse(text);
      lastErr = new Error(`${url} → HTTP ${res.status}: ${text.slice(0, 120)}`);
    } catch (e) {
      lastErr = e;
    }
    const wait = 5000 * 2 ** attempt;
    console.warn(`  overpass attempt ${attempt + 1} failed (${lastErr.message}); retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr;
}

async function fetchRaw(cfg) {
  const b = cfg.bbox.join(',');
  const query = `[out:json][timeout:180];
relation["route"~"^(subway|light_rail)$"](${b})->.routes;
(
  .routes;
  node(r.routes)["railway"="stop"];
  way["railway"="construction"]["construction"~"^(subway|light_rail)$"](${b});
  way["railway"="proposed"](${b});
  node["railway"="station"]["station"~"^(subway|light_rail)$"](${b});
  node["railway"="construction"]["construction"="station"](${b});
  node["construction:station"~"^(subway|light_rail)$"](${b});
  node["railway"="proposed"]["proposed"="station"](${b});
);
out geom;`;
  return overpass(query);
}

// ---------------------------------------------------------------- geometry

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

function haversine([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Distance (m) from point p to polyline, local equirectangular projection. */
function distToLine(p, line) {
  const k = Math.cos(toRad(p[1]));
  const px = p[0] * k, py = p[1];
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const ax = line[i][0] * k, ay = line[i][1];
    const bx = line[i + 1][0] * k, by = line[i + 1][1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const qx = ax + t * dx, qy = ay + t * dy;
    best = Math.min(best, Math.hypot(px - qx, py - qy));
  }
  return toRad(best) * R;
}

const lengthOf = (line) => line.reduce((s, c, i) => (i ? s + haversine(line[i - 1], c) : 0), 0);
const coordsOf = (geom) => geom.map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]);

/** Join a relation's ordered way members into one continuous LineString. */
function stitch(ways) {
  let chain = [];
  for (const w of ways) {
    if (!chain.length) { chain = [...w]; continue; }
    const end = chain.at(-1), start = chain[0];
    const d = [
      [haversine(end, w[0]), 'append'],
      [haversine(end, w.at(-1)), 'appendRev'],
      [haversine(start, w.at(-1)), 'prepend'],
      [haversine(start, w[0]), 'prependRev'],
    ].sort((a, b) => a[0] - b[0])[0][1];
    // On the 2nd way the first way may itself be backwards; the min-distance pick handles it.
    if (d === 'append') chain.push(...w.slice(1));
    else if (d === 'appendRev') chain.push(...[...w].reverse().slice(1));
    else if (d === 'prepend') chain.unshift(...w.slice(0, -1));
    else chain.unshift(...[...w].reverse().slice(0, -1));
  }
  return chain;
}

// ---------------------------------------------------------------- build

function build(raw, cfg, manual) {
  const els = raw.elements;
  const features = [];

  // 1. Operational lines. A line can have several relations: both directions of
  //    the same track, and genuine branches (Delhi Blue → Vaishali). Keep the
  //    longest first, then any relation that mostly runs on track not yet kept.
  const rels = [];
  for (const e of els) {
    if (e.type !== 'relation' || !e.tags.ref) continue;
    const lineId = cfg.routeRefs[e.tags.ref];
    if (!lineId) continue;
    const ways = e.members.filter((m) => m.type === 'way' && m.role === '' && m.geometry).map((m) => coordsOf(m.geometry));
    const line = stitch(ways);
    rels.push({ lineId, ref: e.tags.ref, line, len: lengthOf(line), name: e.tags.name });
  }
  rels.sort((a, b) => b.len - a.len);
  const operational = {};
  for (const r of rels) {
    const kept = (operational[r.lineId] ??= []);
    const sample = r.line.filter((_, i) => i % 4 === 0);
    const covered = sample.filter((p) => kept.some((k) => distToLine(p, k.line) < 60)).length / sample.length;
    if (covered > 0.5) continue;
    kept.push(r);
    features.push({
      type: 'Feature',
      properties: {
        lineId: r.lineId, status: 'operational', source: 'osm', osmName: r.name,
        branch: kept.length > 1 ? `${r.lineId}:${r.ref}` : undefined,
        lengthKm: +(r.len / 1000).toFixed(2),
      },
      geometry: { type: 'LineString', coordinates: r.line },
    });
    console.log(`  ${r.lineId.padEnd(8)} operational  ${(r.len / 1000).toFixed(1)} km${kept.length > 1 ? `  branch ${r.ref}` : ''}  (${r.name})`);
  }
  for (const id of Object.keys(operational)) operational[id] = operational[id].map((k) => k.line);
  const allOps = Object.values(operational).flat();
  const nearOperational = (p, tol) => allOps.some((l) => distToLine(p, l) < tol);

  // 2. Construction / proposed ways, grouped per line + status.
  const groups = {};
  for (const e of els) {
    if (e.type !== 'way' || !e.geometry) continue;
    const name = e.tags.name ?? '';
    const match = cfg.wayNames.find(([re]) => re.test(name));
    if (!match) continue;
    // Optional third entry overrides OSM's status (corridors OSM still lists as proposed).
    const status = match[2] ?? (e.tags.railway === 'construction' ? 'construction' : 'planned');
    const coords = coordsOf(e.geometry);
    // Skip stale construction ways that now sit on top of an open line.
    const mid = coords[Math.floor(coords.length / 2)];
    if (nearOperational(mid, 40) && nearOperational(coords[0], 40)) continue;
    const key = `${match[1]}|${status}`;
    (groups[key] ??= []).push(coords);
  }
  for (const [key, lines] of Object.entries(groups)) {
    const [lineId, status] = key.split('|');
    const len = lines.reduce((s, l) => s + lengthOf(l), 0);
    features.push({
      type: 'Feature',
      properties: { lineId, status, source: 'osm', lengthKm: +(len / 1000).toFixed(2) },
      geometry: { type: 'MultiLineString', coordinates: lines },
    });
    console.log(`  ${lineId.padEnd(7)} ${status.padEnd(12)} ${(len / 1000).toFixed(1)} km (${lines.length} ways)`);
  }

  // 3. Hand-traced segments (lines only) for anything OSM doesn't have yet.
  for (const f of manual?.features ?? []) {
    if (f.geometry.type !== 'Point') features.push({ ...f, properties: { ...f.properties, source: 'manual' } });
  }

  // 4. Station candidates, best-known status first.
  const RANK = { operational: 0, construction: 1, planned: 2 };
  const cleanName = (n) =>
    n
      .replace(/\s*\((u\/c|proposed)\)\s*$/i, '')
      // Per-line / per-direction suffixes OSM uses to tell platforms apart.
      .replace(/\s*[([](\w+ Line|Line \w+|[ew]astbound|[ns]orthbound|[ew]estbound|[ns]outhbound)[)\]]\s*$/i, '')
      .replace(/\s+(RMRG Station|Metro Station|Metro|L\d)$/i, '')
      .trim();
  const cands = [];
  for (const e of els) {
    const t = e.tags;
    if (e.type !== 'node' || !t?.name || cfg.ignoreNames.some((re) => re.test(t.name))) continue;
    if (cfg.ignoreNetworks?.some((re) => re.test(t.network ?? ''))) continue;
    // railway=stop: a stop position on a route, used where OSM has no station node.
    const isStop = t.railway === 'stop';
    const status =
      t.railway === 'station' || isStop ? 'operational'
      : t.railway === 'construction' || t['construction:station'] ? 'construction'
      : t.railway === 'proposed' ? 'planned' : null;
    if (!status) continue;
    cands.push({
      osmId: e.id,
      status,
      isStop,
      p: [+e.lon.toFixed(6), +e.lat.toFixed(6)],
      hint: cfg.stationColours?.[(t.colour ?? '').toLowerCase()],
      name: cleanName(t['name:en'] ?? t.name),
      nameLocal: t[`name:${cfg.localLang}`] ? cleanName(t[`name:${cfg.localLang}`]) : null,
    });
  }
  cands.sort((a, b) => RANK[a.status] - RANK[b.status] || a.isStop - b.isStop);

  const paths = () =>
    features.flatMap((f) =>
      (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates).map((l) => ({
        lineId: f.properties.lineId, status: f.properties.status, l,
      })),
    );

  // 5. Derive missing track by chaining a line's unmapped stations in order.
  for (const { lineId, status, coverM = 160 } of cfg.deriveFromStations ?? []) {
    const own = paths().filter((x) => x.lineId === lineId);
    const pts = cands
      .filter((c) => c.status === status && c.hint === lineId && !own.some(({ l }) => distToLine(c.p, l) < coverM))
      .map((c) => c.p);
    if (!pts.length) continue;
    const nearest = (from, list) => list.reduce((b, q) => (haversine(from, q) < haversine(from, b) ? q : b));
    const ends = own.flatMap(({ l }) => [l[0], l.at(-1)]);
    // Start at the mapped track end closest to any unmapped station.
    let cur = ends.length
      ? ends.reduce((b, e) => (Math.min(...pts.map((q) => haversine(e, q))) < Math.min(...pts.map((q) => haversine(b, q))) ? e : b))
      : pts[0];
    const chain = [cur];
    const left = new Set(pts.filter((q) => q !== cur));
    while (left.size) {
      cur = nearest(cur, [...left]);
      left.delete(cur);
      chain.push(cur);
    }
    // Close the gap to the next mapped track end, if one is reasonably near.
    const rest = ends.filter((e) => e !== chain[0]);
    if (rest.length) {
      const close = nearest(chain.at(-1), rest);
      if (haversine(close, chain.at(-1)) < 3000) chain.push(close);
    }
    const len = lengthOf(chain);
    features.push({
      type: 'Feature',
      properties: { lineId, status, source: 'derived', approximate: true, lengthKm: +(len / 1000).toFixed(2) },
      geometry: { type: 'LineString', coordinates: chain },
    });
    console.log(`  ${lineId.padEnd(7)} ${status.padEnd(12)} ${(len / 1000).toFixed(1)} km (derived from ${pts.length} stations)`);
  }

  // 6. Assign lines. `lineIds` = lines at the station's own status; `futureLineIds` = later ones.
  const all = paths();
  const near = (p, pred) => new Set(all.filter((x) => pred(x.status) && distToLine(p, x.l) < 160).map((x) => x.lineId));
  const stations = [];
  for (const c of cands) {
    const own = near(c.p, (s) => s === c.status);
    if (c.hint && c.status !== 'operational') own.add(c.hint);
    if (!own.size) continue;
    const future = [...near(c.p, (s) => RANK[s] > RANK[c.status])].filter((id) => !own.has(id));

    // Fold into an existing station: same name nearby, or a better-status one very close.
    const host = stations.find((s) => {
      const d = haversine(s.geometry.coordinates, c.p);
      return (
        (s.properties.name.toLowerCase() === c.name.toLowerCase() && d < 500) ||
        (d < 350 && RANK[s.properties.status] < RANK[c.status]) ||
        (c.isStop && d < 250)
      );
    });
    if (host) {
      const hp = host.properties;
      const target = hp.status === c.status ? hp.lineIds : hp.futureLineIds;
      for (const id of own) if (!hp.lineIds.includes(id) && !target.includes(id)) target.push(id);
      for (const id of future) if (!hp.lineIds.includes(id) && !hp.futureLineIds.includes(id)) hp.futureLineIds.push(id);
      hp.futureLineIds = hp.futureLineIds.filter((id) => !hp.lineIds.includes(id));
      hp.nameLocal ??= c.nameLocal;
      continue;
    }
    stations.push({
      type: 'Feature',
      properties: {
        id: `osm-${c.osmId}`,
        name: c.name,
        nameLocal: c.nameLocal,
        status: c.status,
        lineIds: [...own],
        futureLineIds: future,
        osmId: c.osmId,
      },
      geometry: { type: 'Point', coordinates: c.p },
    });
  }
  for (const s of stations) s.properties.interchange = s.properties.lineIds.length > 1;

  console.log(`  stations: ${stations.length} (${stations.filter((s) => s.properties.interchange).length} interchanges)`);
  return {
    lines: { type: 'FeatureCollection', features },
    stations: { type: 'FeatureCollection', features: stations },
  };
}

// ---------------------------------------------------------------- main

const [cityId, flag] = process.argv.slice(2);
const cfg = CITIES[cityId];
if (!cfg) {
  console.error(`Unknown city "${cityId}". Known: ${Object.keys(CITIES).join(', ')}`);
  process.exit(1);
}
const outDir = path.join(ROOT, 'public/data/cities', cityId);
const cacheDir = path.join(ROOT, 'scripts/.cache');
const cacheFile = path.join(cacheDir, `${cityId}.osm.json`);
await mkdir(cacheDir, { recursive: true });

let raw;
if (flag === '--cached' && existsSync(cacheFile)) {
  raw = JSON.parse(await readFile(cacheFile, 'utf8'));
} else {
  console.log(`Fetching ${cityId} from Overpass…`);
  raw = await fetchRaw(cfg);
  await writeFile(cacheFile, JSON.stringify(raw));
}
const manualFile = path.join(outDir, 'manual.geojson');
const manual = existsSync(manualFile) ? JSON.parse(await readFile(manualFile, 'utf8')) : null;

const { lines, stations } = build(raw, cfg, manual);
const stamp = raw.osm3s?.timestamp_osm_base ?? new Date().toISOString();
const meta = { osmTimestamp: stamp, attribution: '© OpenStreetMap contributors (ODbL)' };
await writeFile(path.join(outDir, 'lines.geojson'), JSON.stringify({ ...lines, meta }));
await writeFile(path.join(outDir, 'stations.geojson'), JSON.stringify({ ...stations, meta }, null, 1));
console.log(`Wrote ${path.relative(ROOT, outDir)}/{lines,stations}.geojson (OSM as of ${stamp})`);

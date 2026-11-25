// Post-build SEO pass over docs/ (runs after `vite build`).
//
// For every city it writes a real page at docs/<id>.html (GitHub Pages serves
// it at /<id> with a 200), with its own title, description, canonical URL,
// share image and structured data, plus a readable summary of the network
// inside #root (React replaces it once the app loads). It also writes the
// home page, a noindex 404.html for unknown paths, sitemap.xml and robots.txt.

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runnerImport } from 'vite';

// The app's own travel-order logic, so the station lists match the line strip.
const { module: stopsMod } = await runnerImport('./src/data/lineStops.ts');
const { lineStopGroups } = stopsMod;

// What people actually type for each city (alongside the system's official name).
const SEARCH = {
  bengaluru: {
    aliases: ['Bangalore Metro', 'Bengaluru Metro', 'Namma Metro', 'BMRCL Metro'],
    localSystem: 'ನಮ್ಮ ಮೆಟ್ರೋ',
    lead: 'Namma Metro, also called Bangalore Metro or Bengaluru Metro and run by BMRCL',
  },
  delhi: {
    aliases: ['Delhi Metro', 'DMRC', 'Delhi Metro route map', 'Noida Metro', 'Gurugram Rapid Metro', 'Airport Express Line'],
    localSystem: 'दिल्ली मेट्रो',
    lead: 'Delhi Metro (DMRC), together with Noida Metro (Aqua Line) and Rapid Metro Gurugram',
  },
  mumbai: {
    aliases: ['Mumbai Metro', 'Mumbai Metro One', 'Metro 3 Aqua Line', 'MMRDA Metro', 'Navi Mumbai Metro'],
    localSystem: 'मुंबई मेट्रो',
    lead: 'Mumbai Metro — Metro One (Line 1), the MMRDA lines 2A and 7, the underground Aqua Line (Line 3) and Navi Mumbai Metro',
  },
};

// Mumbai's lines are known by number and colour; elsewhere the name is the colour.
const COLOUR_ALIAS = { mumbai: { blue: 'Blue Line', yellow: 'Yellow Line', aqua: 'Aqua Line', green: 'Green Line', orange: 'Orange Line', pink: 'Pink Line', red: 'Red Line' } };

const SITE = 'https://metro.visrey.me';
const BRAND = { name: 'Visrey', url: 'https://visrey.me' };
const APP = 'Metro Visualizer';
const CITY_IDS = ['bengaluru', 'delhi', 'mumbai']; // keep in step with src/data/cities.ts
const DEFAULT_CITY = 'bengaluru';
const OUT = 'docs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const km = (n) => (n >= 10 ? Math.round(n) : n.toFixed(1));
const STATUS = { operational: 'running', construction: 'under construction', planned: 'planned' };

/* ------------------------------------------------------------ data */

function loadCity(id) {
  const dir = `public/data/cities/${id}`;
  const meta = read(`${dir}/city.json`);
  const lines = read(`${dir}/lines.geojson`);
  const stations = read(`${dir}/stations.geojson`);
  const kmBy = { operational: 0, construction: 0, planned: 0 };
  for (const f of lines.features) kmBy[f.properties.status] += f.properties.lengthKm ?? 0;
  const open = stations.features.filter((s) => s.properties.status === 'operational');
  const order = new Map(meta.lines.map((l, i) => [l.id, i]));
  const lineName = new Map(meta.lines.map((l) => [l.id, l.name]));
  for (const s of stations.features) s.properties.lineIds.sort((a, b) => order.get(a) - order.get(b));
  const data = { meta, lines, stations };
  const lineInfo = meta.lines.map((l) => {
    const segs = lines.features.filter((f) => f.properties.lineId === l.id);
    const st = new Set(segs.map((f) => f.properties.status));
    const status = st.has('operational') ? (st.size > 1 ? 'partly open' : 'running') : st.has('construction') ? 'under construction' : 'planned';
    const lineKm = { operational: 0, construction: 0, planned: 0 };
    for (const f of segs) lineKm[f.properties.status] += f.properties.lengthKm ?? 0;
    const groups = lineStopGroups(data, l.id);
    const count = new Set(groups.flatMap((g) => g.stops.map((s) => s.id))).size;
    const alias = COLOUR_ALIAS[id]?.[l.id];
    return { ...l, status, lineKm, groups, count, label: alias ? `${l.name} (${alias})` : l.name };
  });
  const interchanges = open
    .filter((s) => s.properties.lineIds.length > 1)
    .map((s) => ({ name: s.properties.name, local: s.properties.nameLocal, lines: s.properties.lineIds.map((x) => lineName.get(x)) }))
    .sort((a, b) => b.lines.length - a.lines.length || a.name.localeCompare(b.name));
  const coming = lineInfo
    .filter((l) => l.lineKm.construction || l.lineKm.planned)
    .map((l) => ({ l, year: l.expectedYear?.construction ?? l.expectedYear?.planned, km: l.lineKm.construction + l.lineKm.planned }));
  const runningLines = lineInfo.filter((l) => l.status === 'running' || l.status === 'partly open').length;
  const firstYear = Math.min(...(meta.openings ?? []).map((o) => o.year));
  const search = SEARCH[id] ?? { aliases: [meta.system], lead: meta.system };
  const title = `${meta.seoTitle ?? `${meta.system} map — ${meta.name}`} | ${APP} by ${BRAND.name}`;
  const description =
    `${meta.system} map for ${meta.name}: ${runningLines} lines and ${open.length} stations running over ${km(kmBy.operational)} km, ` +
    `every station in order, interchanges, and ${km(kmBy.construction + kmBy.planned)} km under construction or planned. Interactive 3D map with simulated trains.`;
  return { id, meta, lines, stations, kmBy, open, lineInfo, interchanges, coming, runningLines, firstYear, search, title, description };
}

/* ------------------------------------------------------------ share images (1200×630) */

const W = 1200;
const H = 630;
const BG = '#11161D';
const INK = '#E9EEF4';
const MUTED = '#8C99A8';
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

/** SVG paths for a city's lines, fitted into the box [x, y, w, h]. */
function networkSvg(c, [bx, by, bw, bh], stroke = 5) {
  const parts = c.lines.features.flatMap((f) =>
    (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates).map((coords) => ({ f, coords })),
  );
  const all = parts.flatMap((p) => p.coords);
  const lat0 = all.reduce((s, p) => s + p[1], 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p[0] * k);
  const ys = all.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min(bw / (x1 - x0), bh / (y1 - y0));
  const ox = bx + (bw - (x1 - x0) * s) / 2;
  const oy = by + (bh - (y1 - y0) * s) / 2;
  const pt = ([lng, lat]) => `${(ox + (lng * k - x0) * s).toFixed(1)},${(oy + (y1 - lat) * s).toFixed(1)}`;
  const color = new Map(c.meta.lines.map((l) => [l.id, l.color]));
  const rank = { planned: 0, construction: 1, operational: 2 };
  const style = {
    operational: `stroke-width="${stroke}" opacity="1"`,
    construction: `stroke-width="${stroke * 0.7}" stroke-dasharray="${stroke * 1.6} ${stroke * 1.2}" opacity="0.75"`,
    planned: `stroke-width="${stroke * 0.5}" stroke-dasharray="${stroke * 0.3} ${stroke * 1.2}" opacity="0.55"`,
  };
  const paths = parts
    .sort((a, b) => rank[a.f.properties.status] - rank[b.f.properties.status])
    .map(({ f, coords }) => `<polyline points="${coords.map(pt).join(' ')}" fill="none" stroke="${color.get(f.properties.lineId) ?? '#888'}" stroke-linecap="round" stroke-linejoin="round" ${style[f.properties.status]}/>`);
  const dots = c.open
    .filter((st) => st.properties.interchange)
    .map((st) => `<circle cx="${pt(st.geometry.coordinates).split(',')[0]}" cy="${pt(st.geometry.coordinates).split(',')[1]}" r="${stroke * 0.8}" fill="${BG}" stroke="${INK}" stroke-width="${stroke * 0.45}"/>`);
  return paths.join('') + dots.join('');
}

const frame = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${BG}"/>
<g font-family="${FONT}">${inner}</g></svg>`;

const brandRow = (y) =>
  `<text x="64" y="${y}" fill="${MUTED}" font-size="22" font-weight="700" letter-spacing="5">METRO VISUALIZER</text>`;
const footRow = `<text x="64" y="${H - 56}" fill="${MUTED}" font-size="24">metro.visrey.me · by ${BRAND.name}</text>`;

function cityImage(c) {
  return frame(`
${networkSvg(c, [560, 40, 600, 550], 6)}
${brandRow(96)}
<text x="64" y="200" fill="${INK}" font-size="76" font-weight="700">${esc(c.meta.name)}</text>
<text x="64" y="254" fill="${MUTED}" font-size="32">${esc(c.meta.system)}</text>
<text x="64" y="356" fill="${INK}" font-size="40" font-weight="700">${km(c.kmBy.operational)} km running</text>
<text x="64" y="408" fill="${INK}" font-size="32">${c.open.length} stations · ${c.runningLines} lines</text>
<text x="64" y="452" fill="${MUTED}" font-size="28">+${km(c.kmBy.construction + c.kmBy.planned)} km coming</text>
${footRow}`);
}

function homeImage(cities) {
  const cw = (W - 64 * 2 - 40 * 2) / 3;
  const maps = cities
    .map((c, i) => {
      const x = 64 + i * (cw + 40);
      return `${networkSvg(c, [x, 170, cw, 300], 3.5)}
<text x="${x + cw / 2}" y="520" text-anchor="middle" fill="${INK}" font-size="30" font-weight="700">${esc(c.meta.name)}</text>`;
    })
    .join('');
  return frame(`
${brandRow(84)}
<text x="64" y="138" fill="${INK}" font-size="40" font-weight="700">India's metro networks, live and in 3D</text>
${maps}
${footRow}`);
}

function png(svg, file) {
  const out = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica Neue' } }).render().asPng();
  writeFileSync(file, out);
}

/* ------------------------------------------------------------ pages */

const org = { '@type': 'Organization', '@id': `${BRAND.url}/#brand`, name: BRAND.name, url: BRAND.url };
const website = {
  '@type': 'WebSite',
  '@id': `${SITE}/#website`,
  name: APP,
  alternateName: `${APP} by ${BRAND.name}`,
  url: `${SITE}/`,
  publisher: { '@id': org['@id'] },
  creator: { '@id': org['@id'] },
};
const webapp = {
  '@type': 'WebApplication',
  '@id': `${SITE}/#app`,
  name: APP,
  url: `${SITE}/`,
  applicationCategory: 'TravelApplication',
  operatingSystem: 'Any (web browser)',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
  creator: { '@id': org['@id'] },
};

function head({ title, description, path, image, imageAlt, jsonLd, noindex }) {
  const url = `${SITE}${path}`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="author" content="${BRAND.name}" />`,
    `<meta name="theme-color" content="${BG}" />`,
    noindex ? `<meta name="robots" content="noindex" />` : `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${APP} by ${BRAND.name}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE}${image}" />`,
    `<meta property="og:image:width" content="${W}" />`,
    `<meta property="og:image:height" content="${H}" />`,
    `<meta property="og:image:alt" content="${esc(imageAlt)}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${SITE}${image}" />`,
    jsonLd && `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': jsonLd }).replace(/</g, '\\u003c')}</script>`,
  ]
    .filter(Boolean)
    .join('\n    ');
}

// Readable while the app loads, and for crawlers and no-JS visitors.
const STYLE = `<style>
.seo{max-width:760px;margin:0 auto;padding:32px 20px 64px;font:16px/1.55 Inter,system-ui,sans-serif;color:#1d2430;background:#f6f3ec}
.seo h1{font:700 32px/1.2 'Space Grotesk',system-ui,sans-serif;margin:8px 0}.seo h2{font:600 20px 'Space Grotesk',system-ui,sans-serif;margin:28px 0 8px}
.seo .eyebrow{letter-spacing:.2em;font-size:12px;font-weight:700;color:#6b7585}.seo a{color:#2f5fb3}.seo ul,.seo ol{padding-left:22px}.seo h3{font:600 17px 'Space Grotesk',system-ui,sans-serif;margin:18px 0 4px}.seo section p{margin:4px 0}
.seo .sw{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:baseline}
.seo details{margin:6px 0}.seo small{color:#6b7585}
@media (prefers-color-scheme:dark){.seo{color:#e3e8ef;background:#11161d}.seo a{color:#8fb4ff}}
</style>`;

const cityNav = (cities, current) =>
  `<p>${cities.map((c) => (c.id === current ? `<strong>${esc(c.meta.name)}</strong>` : `<a href="/${c.id}">${esc(c.meta.system)} map</a>`)).join(' · ')}</p>`;

const credit = `<p><small>${APP} is made by <a href="${BRAND.url}">${BRAND.name}</a>. Track and stations © OpenStreetMap contributors (ODbL). Trains are simulated, not live positions.</small></p>`;

const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const stationLabel = (s) => esc(s.name) + (s.nameLocal ? ` <small lang="${s.nameLocal.match(/[ಀ-೿]/) ? 'kn' : 'hi'}">${esc(s.nameLocal)}</small>` : '');
const STATUS_NOTE = { operational: '', construction: ' <small>(under construction)</small>', planned: ' <small>(planned)</small>' };

/** Questions people search for, answered from the data. Shown on the page and as FAQPage data. */
function faq(c) {
  const sys = c.meta.system;
  const longest = [...c.lineInfo].sort((a, b) => b.lineKm.operational - a.lineKm.operational)[0];
  const qs = [
    {
      q: `How many lines and stations does ${sys} have?`,
      a: `${sys} has ${c.runningLines} lines running with ${c.open.length} stations open over about ${km(c.kmBy.operational)} km (as of ${c.meta.asOf}). ` +
        `${c.lineInfo.length - c.runningLines > 0 ? `${c.lineInfo.length - c.runningLines} more lines are under construction or planned. ` : ''}` +
        `The longest running line is ${longest.label}, at about ${km(longest.lineKm.operational)} km.`,
    },
  ];
  if (c.interchanges.length)
    qs.push({
      q: `What are the interchange stations on ${sys}?`,
      a: `You can change lines at ${c.interchanges.length} stations: ` +
        c.interchanges.slice(0, 12).map((s) => `${s.name} (${s.lines.join(', ')})`).join('; ') +
        (c.interchanges.length > 12 ? `, and ${c.interchanges.length - 12} more.` : '.'),
    });
  if (c.coming.length)
    qs.push({
      q: `Which ${sys} lines are under construction or planned?`,
      a: c.coming.map(({ l, year, km: k }) => `${l.label}: about ${km(k)} km${year ? `, expected around ${year}` : ''}`).join('; ') +
        '. Years are targets, not commitments.',
    });
  qs.push({
    q: `Are the trains on this ${sys} map live?`,
    a: `No. Trains are simulated from typical service frequencies so you can see how the network runs through the day. Track and stations come from OpenStreetMap; always check the operator, ${c.meta.operator}, for real timings.`,
  });
  return qs;
}

function cityBody(c, cities) {
  const lines = c.lineInfo
    .map((l) => {
      const groups = l.groups
        .filter((g) => g.stops.length)
        .map(
          (g) => `${g.branchFrom ? `<p><em>Branch from ${esc(g.branchFrom)}:</em></p>` : ''}<ol>${g.stops
            .map((s) => `<li>${stationLabel(s)}${s.lineIds.length > 1 ? ` <small>· change for ${esc(list(s.lineIds.filter((x) => x !== l.id).map((x) => c.meta.lines.find((m) => m.id === x)?.name ?? x)))}</small>` : ''}${STATUS_NOTE[s.status]}</li>`)
            .join('')}</ol>`,
        )
        .join('');
      const len = km(l.lineKm.operational + l.lineKm.construction + l.lineKm.planned);
      return `<section><h3><span class="sw" style="background:${l.color}"></span>${esc(l.label)} — ${esc(l.termini.join(' to '))}</h3>
<p>${l.status[0].toUpperCase() + l.status.slice(1)} · about ${len} km · ${l.count} stations${l.note ? ` · ${esc(l.note)}` : ''}</p>
<details><summary>${esc(l.name)} stations in order</summary>${groups || '<p>Stations not yet mapped.</p>'}</details></section>`;
    })
    .join('\n');
  const inter = c.interchanges.length
    ? `<h2>Interchange stations</h2><ul>${c.interchanges.map((s) => `<li>${stationLabel(s)} — ${esc(list(s.lines))}</li>`).join('')}</ul>`
    : '';
  const qa = faq(c)
    .map((x) => `<h3>${esc(x.q)}</h3><p>${esc(x.a)}</p>`)
    .join('\n');
  return `<main class="seo">
<p class="eyebrow">METRO VISUALIZER</p>
<h1>${esc(c.meta.system)} map — ${esc(c.meta.name)}${c.search.localSystem ? ` <small>${esc(c.search.localSystem)}</small>` : ''}</h1>
<p>${esc(c.description)}</p>
<p>This is a map of ${esc(c.search.lead)}. Today it has ${km(c.kmBy.operational)} km and ${c.open.length} stations open,
with ${km(c.kmBy.construction)} km under construction and ${km(c.kmBy.planned)} km planned. Data as of ${esc(c.meta.asOf)}.</p>
<h2>${esc(c.meta.system)} lines and stations</h2>
${lines}
${inter}
<h2>Frequently asked questions</h2>
${qa}
<h2>Other cities</h2>
${cityNav(cities, c.id)}
${credit}
</main>`;
}

function cityJsonLd(c) {
  const url = `${SITE}/${c.id}`;
  const faqLd = {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: faq(c).map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
  };
  return [
    faqLd,
    org,
    website,
    webapp,
    {
      '@type': 'WebPage',
      '@id': `${url}#page`,
      url,
      name: c.title,
      description: c.description,
      inLanguage: 'en-IN',
      dateModified: c.meta.asOf,
      isPartOf: { '@id': website['@id'] },
      primaryImageOfPage: `${SITE}/og/${c.id}.png`,
      author: { '@id': org['@id'] },
      keywords: [`${c.meta.system} map`, ...c.search.aliases.map((a) => `${a} map`), `${c.meta.name} metro stations`].join(', '),
      about: [
        { '@type': 'City', name: c.meta.name, alternateName: c.meta.nameLocal, containedInPlace: { '@type': 'Country', name: 'India' } },
        { '@type': 'Organization', name: c.meta.system, alternateName: [...c.search.aliases, c.search.localSystem].filter(Boolean), description: `Operated by ${c.meta.operator}` },
      ],
      mainEntity: {
        '@type': 'ItemList',
        name: `${c.meta.system} lines`,
        itemListElement: c.lineInfo.map((l, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: l.label,
          description: `${l.termini.join(' to ')} — ${l.status}, ${l.count} stations`,
        })),
      },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: APP, item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: `${c.meta.system} map`, item: url },
        ],
      },
    },
  ];
}

function homeBody(cities) {
  const cards = cities
    .map(
      (c) => `<li><a href="/${c.id}"><strong>${esc(c.meta.system)} map</strong></a> — ${esc(c.meta.name)}: ${km(c.kmBy.operational)} km and ${c.open.length} stations running, ${c.runningLines} lines.</li>`,
    )
    .join('\n');
  return `<main class="seo">
<p class="eyebrow">METRO VISUALIZER</p>
<h1>${APP} — India's metro networks in 3D</h1>
<p>${esc(HOME_DESC)}</p>
<h2>Cities</h2>
<ul>${cards}</ul>
${credit}
</main>`;
}

const HOME_TITLE = `${APP} by ${BRAND.name} — metro maps of Bengaluru, Delhi and Mumbai`;
const HOME_DESC =
  'Interactive 3D maps of Indian metro networks: every running, under-construction and planned line in its official colour, simulated trains moving through the day, and a timeline of how each network grew. Made by Visrey.';

/* ------------------------------------------------------------ write */

const template = readFileSync(`${OUT}/index.html`, 'utf8');
if (!template.includes('<div id="root"></div>')) throw new Error('docs/index.html has no empty #root — run vite build first');
const page = (headHtml, body) =>
  template.replace(/<title>[\s\S]*?<\/title>/, headHtml + '\n    ' + STYLE).replace('<div id="root"></div>', `<div id="root">${body}</div>`);

const cities = CITY_IDS.map(loadCity);
mkdirSync(`${OUT}/og`, { recursive: true });

for (const c of cities) {
  png(cityImage(c), `${OUT}/og/${c.id}.png`);
  const h = head({
    title: c.title,
    description: c.description,
    path: `/${c.id}`,
    image: `/og/${c.id}.png`,
    imageAlt: `Map of ${c.meta.system} lines in ${c.meta.name}`,
    jsonLd: cityJsonLd(c),
  });
  writeFileSync(`${OUT}/${c.id}.html`, page(h, cityBody(c, cities)));
}

png(homeImage(cities), `${OUT}/og/home.png`);
const homeHead = head({
  title: HOME_TITLE,
  description: HOME_DESC,
  path: '/',
  image: '/og/home.png',
  imageAlt: 'Metro maps of Bengaluru, Delhi and Mumbai',
  jsonLd: [org, website, webapp, { '@type': 'WebPage', '@id': `${SITE}/#page`, url: `${SITE}/`, name: HOME_TITLE, description: HOME_DESC, isPartOf: { '@id': website['@id'] }, author: { '@id': org['@id'] } }],
});
writeFileSync(`${OUT}/index.html`, page(homeHead, homeBody(cities)));

// Unknown paths: the app still loads (and falls back to the default city), but isn't indexed.
const nfHead = head({ title: `${APP} by ${BRAND.name}`, description: HOME_DESC, path: '/', image: '/og/home.png', imageAlt: APP, noindex: true });
writeFileSync(`${OUT}/404.html`, page(nfHead, ''));

const lastmod = cities.map((c) => c.meta.asOf).sort().at(-1);
writeFileSync(
  `${OUT}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${lastmod}</lastmod></url>
${cities.map((c) => `  <url><loc>${SITE}/${c.id}</loc><lastmod>${c.meta.asOf}</lastmod></url>`).join('\n')}
</urlset>
`,
);
writeFileSync(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`seo: wrote ${cities.length} city pages, home, 404, ${cities.length + 1} share images, sitemap.xml, robots.txt (default city ${DEFAULT_CITY})`);

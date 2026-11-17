/* FatRaisin opening hours from OpenStreetMap.
   Asks OpenStreetMap (free, through its Overpass service) for breweries, wineries, cideries and distilleries in Canada
   and the US that have opening hours, matches them to the app's places by name and location, and adds the hours to
   place-media.js for places that don't have any yet (hours read from a place's own website are never replaced).
   Run by .github/workflows/osm-hours.yml. Usage: node tools/osm-hours.mjs [--save osm.json | --file osm.json] [--dry] */
import fs from 'fs'; import vm from 'vm'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : ''; };
const DRY = process.argv.includes('--dry');
const log = []; const say = s => { console.log(s); log.push(s); };

/* ---------- the app's places and current hours ---------- */
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of ['places-ca.js', 'places-us.js', 'place-lists.js', 'place-media.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
const D = ctx.window.FR_DATA, M = ctx.window.FR_MEDIA;
const places = [...D.US, ...D.CA].filter(r => typeof r[5] === 'number' && typeof r[6] === 'number').map(r => ({ name: r[0], lat: r[5], lng: r[6], approx: !!r[8] }));

/* ---------- names ---------- */
const GENERIC = new Set('the and of at by co company inc llc ltd winery wineries vineyard vineyards vineyard estate estates wine wines cellar cellars brewing brewery breweries brewpub brew brewhouse beer beers taproom tap room house cidery cider ciders ciderworks cidre distillery distilleries distilling spirits meadery mead farm farms craft works artisan family tasting at'.split(' '));
const fold = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const core = t => fold(t).split(' ').filter(w => w && !GENERIC.has(w));
function sameName(a, b) {
  const x = core(a), y = core(b);
  if (!x.length || !y.length) return fold(a) === fold(b);
  const sx = new Set(x), sy = new Set(y); let n = 0; sx.forEach(w => { if (sy.has(w)) n++; });
  if (n === 0) { const jx = x.join(''), jy = y.join(''); return jx.length >= 5 && (jx === jy || jx.includes(jy) || jy.includes(jx)); }
  return n / Math.min(sx.size, sy.size) >= 1 && n / Math.max(sx.size, sy.size) >= 0.5;
}
const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/* ---------- OpenStreetMap opening_hours → the app's "Monday: 12:00 PM – 6:00 PM" lines ----------
   Only the plain weekly form is read ("Mo-Th 12:00-21:00; Fr,Sa 12:00-23:00; Su off"). Anything with months, dates,
   week numbers, sunrise/sunset, "by appointment" and the like is left out, as are 24/7 places. */
const DN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };
function osmHours(s) {
  s = String(s || '').trim(); if (!s || s.length > 200) return null;
  if (/24\/7|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|\bweek\b|sunrise|sunset|dawn|dusk|easter|\|\||"|\[|\d{4}|\+\s*$|\bopen\s*$/i.test(s)) return null;
  const res = {};
  const rules = s.split(/;|(?<=\d)\s*,\s*(?=(?:mo|tu|we|th|fr|sa|su|ph|sh)\b)/i).map(x => x.trim()).filter(Boolean);
  for (const rule of rules) {
    if (/^(ph|sh)\b/i.test(rule)) continue;                      /* public / school holidays: skip */
    const m = rule.match(/^((?:(?:mo|tu|we|th|fr|sa|su)(?:\s*-\s*(?:mo|tu|we|th|fr|sa|su))?\s*,?\s*)+)?\s*(.*)$/i);
    if (!m) return null;
    let days = [0, 1, 2, 3, 4, 5, 6];
    if (m[1]) {
      days = [];
      for (const part of m[1].split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
        const r = part.split(/\s*-\s*/); const a = DAY[r[0]], b = r[1] ? DAY[r[1]] : a;
        if (a === undefined || b === undefined) return null;
        for (let d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
      }
    }
    const t = m[2].replace(/,?\s*ph\b.*$/i, '').trim().toLowerCase();
    if (/^(off|closed)$/.test(t)) { days.forEach(d => res[d] = 'closed'); continue; }
    const spans = t.split(/\s*,\s*/); let open = null, close = null;
    for (const sp of spans) {
      const x = sp.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/); if (!x) return null;
      const a = +x[1] * 60 + +x[2]; let b = +x[3] * 60 + +x[4];
      if (b <= a) { if (b <= 180) b += 1440; else return null; }
      if (open === null || a < open) open = a; if (close === null || b > close) close = b;
    }
    if (open === null || open < 360 || open > 1320 || close - open < 120 || close - open > 1080) return null;
    days.forEach(d => res[d] = [open, close]);
  }
  if (!Object.values(res).some(v => v !== 'closed')) return null;
  const f = m => { m %= 1440; const h = Math.floor(m / 60), mi = m % 60; return ((h % 12) || 12) + ':' + String(mi).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); };
  return DN.map((n, i) => n + ': ' + (res[i] && res[i] !== 'closed' ? f(res[i][0]) + ' – ' + f(res[i][1]) : 'Closed'));
}

/* ---------- fetch from Overpass, a slice of the continent at a time ---------- */
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
/* small tiles keep each question quick; the far north, Alaska and Hawaii get one big tile each */
const TILES = [];
for (let la = 24; la < 54; la += 6) for (let ln = -126; ln < -60; ln += 6) TILES.push([la, ln, la + 6, ln + 6]);
TILES.push([54, -141, 72, -50], [50, -170, 72, -141], [18, -161, 23, -154]);
function query([s, w, n, e]) {
  const bb = '(' + s + ',' + w + ',' + n + ',' + e + ')';
  return '[out:json][timeout:170];(' +
    'nwr["opening_hours"]["craft"~"brewery|winery|distillery|cider|mead"]' + bb + ';' +
    'nwr["opening_hours"]["industrial"~"brewery|winery|distillery"]' + bb + ';' +
    'nwr["opening_hours"]["tourism"="wine_cellar"]' + bb + ';' +
    'nwr["opening_hours"]["microbrewery"="yes"]' + bb + ';' +
    'nwr["opening_hours"]["brewery"]["amenity"~"pub|bar|restaurant|biergarten"]' + bb + ';' +
    'nwr["opening_hours"]["amenity"~"pub|bar|restaurant|biergarten|cafe"]["name"~"brew|winery|vineyard|cider|distill|taproom",i]' + bb + ';' +
    'nwr["opening_hours"]["shop"~"wine|alcohol|beverages"]["name"~"brew|winery|vineyard|cider|distill|meadery",i]' + bb + ';' +
    ');out center tags;';
}
const STARTED = Date.now(), BUDGET = 85 * 60000;   /* stop asking after 85 minutes and keep what was found */
async function overpass(q) {
  for (const url of SERVERS) {
    if (Date.now() - STARTED > BUDGET) return null;
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FatRaisin-hours/1.0 (https://github.com/algeorge444-web/FatRaisin1)' }, signal: AbortSignal.timeout(200000) });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.elements) && !(j.remark && /timed out|out of memory/i.test(j.remark))) return j.elements; }
      say('  ' + new URL(url).host + ' answered ' + r.status);
    } catch (e) { say('  ' + new URL(url).host + ' failed: ' + String(e.message || e).slice(0, 80)); }
    await new Promise(z => setTimeout(z, 10000));
  }
  return null;
}
let els = [];
if (arg('--file')) { const j = JSON.parse(fs.readFileSync(arg('--file'), 'utf8')); els = j.elements || []; (j.log || []).forEach(x => log.push(x)); }
else {
  let missed = 0;
  for (const t of TILES) {
    if (Date.now() - STARTED > BUDGET) { missed++; continue; }
    const got = await overpass(query(t));
    if (got) { els.push(...got); console.log('Tile ' + t.join(',') + ': ' + got.length); } else { missed++; say('Tile ' + t.join(',') + ' could not be read'); }
    await new Promise(z => setTimeout(z, 3000));
  }
  say((TILES.length - missed) + ' of ' + TILES.length + ' map tiles read in ' + Math.round((Date.now() - STARTED) / 60000) + ' minutes.');
  /* --save: keep what was read and stop, so the matching can run on the newest copy of the app's files afterwards */
  if (arg('--save')) { fs.writeFileSync(arg('--save'), JSON.stringify({ elements: els, log })); console.log('Saved to ' + arg('--save')); process.exit(0); }
}

/* ---------- match and add ---------- */
const grid = {}; const cell = (la, ln) => Math.floor(la * 20) + ',' + Math.floor(ln * 20);
places.forEach(p => { (grid[cell(p.lat, p.lng)] = grid[cell(p.lat, p.lng)] || []).push(p); });
const near = (la, ln) => { const out = [], a = Math.floor(la * 20), b = Math.floor(ln * 20); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid[(a + i) + ',' + (b + j)] || [])); return out; };
const pick = {}; let parsed = 0, matched = 0;
for (const el of els) {
  const t = el.tags || {}, name = t.name || t.brand || '', lat = el.lat ?? (el.center && el.center.lat), lng = el.lon ?? (el.center && el.center.lon);
  if (!name || typeof lat !== 'number') continue;
  const h = osmHours(t.opening_hours); if (!h) continue; parsed++;
  const o = { lat, lng };
  const cands = near(lat, lng).filter(p => sameName(p.name, name) && km(p, o) <= (p.approx ? 3 : 0.6)).sort((a, b) => km(a, o) - km(b, o));
  if (!cands.length) continue; matched++;
  const p = cands[0];
  if (pick[p.name] && JSON.stringify(pick[p.name].h) !== JSON.stringify(h)) { pick[p.name].clash = true; continue; }
  pick[p.name] = { h, d: km(p, o) };
}
let added = 0;
for (const n in pick) if (!pick[n].clash && !M.HOURS[n]) { M.HOURS[n] = pick[n].h; added++; }
say(els.length + ' OpenStreetMap places read, ' + parsed + ' with plain weekly hours, ' + matched + ' matched to app places; hours added for ' + added + ' places that had none (' + Object.keys(M.HOURS).length + ' of ' + places.length + ' now have hours).');

if (added && !DRY) {
  const mf = path.join(ROOT, 'place-media.js'), first = fs.readFileSync(mf, 'utf8').split('\n')[0];
  fs.writeFileSync(mf, first + '\nwindow.FR_MEDIA=' + JSON.stringify(M) + ';\n');
  const lf = path.join(ROOT, 'place-lists.js'); let ls = fs.readFileSync(lf, 'utf8');
  const v = +(ls.match(/"SEED_VERSION":(\d+)/) || [])[1] + 1;
  ls = ls.replace(/"SEED_VERSION":\d+/, '"SEED_VERSION":' + v); fs.writeFileSync(lf, ls);
  const df = path.join(ROOT, 'data-version.js'); fs.writeFileSync(df, fs.readFileSync(df, 'utf8').replace(/FR_DV=\d+/, 'FR_DV=' + v));
  say('Data version is now ' + v + '.');
}
fs.writeFileSync(path.join(ROOT, 'tools', 'osm-hours-last-run.txt'), new Date().toISOString().slice(0, 10) + '\n' + log.join('\n') + '\n');
fs.writeFileSync(path.join(ROOT, 'tools', '.osm-hours-summary'), added + ' places');
export { osmHours, sameName };

/* FatRaisin weekly event search.
   Visits every place's own website (and a few state/regional association calendars), collects upcoming events and
   writes them to events-data.js, which the app loads. Run by .github/workflows/events.yml every week.
   Usage: node tools/crawl-events.mjs [--cache file.json] [--limit N] */
import fs from 'fs'; import vm from 'vm'; import path from 'path'; import { fileURLToPath } from 'url';
import { siteEvents, eventDoc, calEvents, fold, isRoutine, wcoEvents } from './helper-lib.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : ''; };
const HORIZON_DAYS = 150, PER_PLACE = 20, THREADS = 40;
/* association calendars the helper can read (Squarespace, The Events Calendar, or event details on the page) */
const CALS = [
  { name: 'Ohio Wines', url: 'https://www.ohiowines.org/events', st: 'OH' },
  { name: 'Brewers of Indiana Guild', url: 'https://drinkin.beer/events/', st: 'IN' },
  { name: 'Garden State Wine Growers', url: 'https://www.newjerseywines.com/events/', st: 'NJ' },
  { name: 'Washington Wine', url: 'https://www.washingtonwine.org/events/', st: 'WA' },
  { name: 'Walla Walla Wine', url: 'https://www.wallawallawine.com/events/', st: 'WA' },
  { name: 'Oregon Wine', url: 'https://www.oregonwine.org/events/', st: 'OR' },
  { name: 'Sonoma Valley Vintners', url: 'https://sonomavalleywine.com/events/', st: 'CA' },
  { name: 'Amador Vintners', url: 'https://amadorwine.com/events/', st: 'CA' },
  { name: 'Idaho Wines', url: 'https://idahowines.org/events/', st: 'ID' },
  { name: 'Kentucky Distillers Association', url: 'https://kybourbontrail.com/events/', st: 'KY' },
  { name: 'Maryland Wine', url: 'https://marylandwine.com/events/', st: 'MD' },
  { name: 'Cayuga Lake Wine Trail', url: 'https://www.cayugawinetrail.com/events/', st: 'NY' },
  { name: 'Leelanau Peninsula Wine Trail', url: 'https://www.lpwines.com/events/', st: 'MI' }
];
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of ['places-ca.js', 'places-us.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
const D = ctx.window.FR_DATA;
const prov = r => (r[1].match(/, ([A-Z]{2}) (?:\d{5}|[A-Z]\d[A-Z])/) || r[2].match(/, ([A-Z]{2})$/) || [])[1] || '';
let places = [...D.US, ...D.CA].map(r => ({ id: r[10], n: r[0], w: r[4] ? (/^https?:/i.test(r[4]) ? r[4] : 'https://' + r[4]) : '', p: prov(r) }));
const sites = places.filter(p => p.w && !/instagram\.com|facebook\.com/i.test(p.w)).slice(0, +arg('--limit') || 1e9);
/* rough time zone for each state or province, used when a calendar gives times in UTC */
const TZ = { 'America/Los_Angeles': 'CA OR WA NV BC', 'America/Phoenix': 'AZ', 'America/Denver': 'CO UT NM WY MT ID AB', 'America/Chicago': 'TX OK KS NE SD ND MN IA MO AR LA MS AL TN WI IL MB SK',
  'America/New_York': 'NY PA NJ CT RI MA VT NH ME DE MD DC VA WV NC SC GA FL OH MI IN KY ON QC', 'America/Halifax': 'NS NB PE', 'America/St_Johns': 'NL', 'America/Anchorage': 'AK', 'Pacific/Honolulu': 'HI' };
const tzOf = st => Object.keys(TZ).find(z => TZ[z].split(' ').includes(st)) || 'America/New_York';
let cache = {}; if (arg('--cache') && fs.existsSync(arg('--cache'))) cache = JSON.parse(fs.readFileSync(arg('--cache'), 'utf8'));
process.on('unhandledRejection', () => {}); process.on('uncaughtException', () => {});
const found = {}; let i = 0, done = 0, total = 0;
const worker = async () => {
  while (i < sites.length) {
    const p = sites[i++]; let evs = [];
    if (cache[p.id]) evs = cache[p.id].e || [];
    else try {
      const r = await Promise.race([siteEvents(new URLSearchParams({ site: p.w, tz: tzOf(p.p) }), { pages: 2, tickets: 4 }), new Promise(z => setTimeout(() => z({ events: [] }), 45000))]);
      for (const x of r.events || []) { const e = eventDoc(p, p.id, x, 'site'); if (e) evs.push(e); }
    } catch (e) {}
    if (evs.length) found[p.id] = evs; total += evs.length;
    if (++done % 1000 === 0) console.log(done + ' of ' + sites.length + ' websites checked, ' + total + ' events so far');
  }
};
await Promise.all(Array.from({ length: THREADS }, worker));
/* association calendars: each event is linked to the place it names, when that place is in the app */
for (const c of CALS) {
  try {
    const rc = await Promise.race([calEvents(c.url), new Promise(z => setTimeout(() => z({ events: [] }), 60000))]);
    const inState = places.filter(p => p.p === c.st).map(p => [fold(p.n), p]).filter(x => x[0].length >= 5).sort((a, b) => b[0].length - a[0].length);
    let n = 0;
    for (const x of rc.events || []) {
      const wn = fold(x.winery), t = fold(x.title);
      const hit = inState.find(([k]) => (wn && (wn.includes(k) || (k.includes(wn) && wn.length >= 5))) || t.includes(k));
      if (!hit) continue;
      const e = eventDoc(hit[1], hit[1].id, x, 'cal'); if (e) { (found[hit[1].id] = found[hit[1].id] || []).push(e); n++; }
    }
    console.log(c.name + ': ' + n + ' events linked to places');
  } catch (e) { console.log(c.name + ': could not be read'); }
}
/* Wine Country Ontario's own event listings */
try {
  const r = await Promise.race([wcoEvents(60, 15), new Promise(z => setTimeout(() => z({ events: [] }), 240000))]);
  const on = places.filter(p => p.p === 'ON').map(p => [fold(p.n), p]).filter(x => x[0].length >= 5).sort((a, b) => b[0].length - a[0].length);
  let n = 0;
  for (const x of r.events || []) {
    const wn = fold(x.winery), t = fold(x.title);
    const hit = on.find(([k]) => (wn && (wn.includes(k) || (k.includes(wn) && wn.length >= 5))) || t.includes(k));
    if (!hit) continue;
    const e = eventDoc(hit[1], hit[1].id, x, 'cal'); if (e) { (found[hit[1].id] = found[hit[1].id] || []).push(e); n++; }
  }
  console.log('Wine Country Ontario: ' + n + ' events linked to places');
} catch (e) { console.log('Wine Country Ontario: could not be read'); }
/* events the helper or the owner's tools have already saved in the app's database (so visitors no longer have to load them from there) */
try {
  const ids = new Set(places.map(p => p.id)); let tok = '', n = 0;
  const base = 'https://firestore.googleapis.com/v1/projects/fatraisin-a163e/databases/(default)/documents/events?pageSize=300';
  for (let page = 0; page < 40; page++) {
    const r = await (await fetch(base + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''))).json();
    for (const doc of r.documents || []) {
      const f = doc.fields || {}, g = k => (f[k] && f[k].stringValue) || '';
      if (!/^(web|cal|wco)$/.test(g('src')) || !ids.has(g('wid')) || !g('title') || !g('date')) continue;
      (found[g('wid')] = found[g('wid')] || []).push({ id: doc.name.split('/').pop(), d: { title: g('title'), date: g('date'), time: g('time'), type: g('type'), desc: g('desc'), link: g('link'), ticketLink: g('ticketLink'), cost: g('cost') } }); n++;
    }
    tok = r.nextPageToken || ''; if (!tok) break;
  }
  console.log('App database: ' + n + ' saved events read');
} catch (e) { console.log('App database: could not be read'); }
const today = new Date().toISOString().slice(0, 10), limit = new Date(Date.now() + HORIZON_DAYS * 864e5).toISOString().slice(0, 10);
const clean = s => String(s || '').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const SPECIAL = /festival|fest\b|release|dinner|market|holiday|santa|christmas|anniversary|harvest|tour|workshop|pairing|gala|new year/i;
/* words that mark a special event (a release, dinner, festival, class, holiday do...) */
const WORTH = /release|releasing|dinner|supper|brunch|feast|pairing|paired|tasting|flight|festival|fest\b|oktoberfest|market|bazaar|fair\b|anniversary|birthday|party|gala|ball\b|celebrat|harvest|stomp|crush|tour\b|workshop|class\b|masterclass|seminar|paint|wreath|craft|holiday|christmas|xmas|santa|grinch|new year|nye\b|valentine|halloween|thanksgiving|friendsgiving|mardi gras|st\.? patrick|easter|mother|father|launch|debut|tapping|cask|firkin|barrel|vertical|library wine|winemaker|brewmaster|brewer|distiller|collab|bottle|vintage|vintner|sommelier|pickup|pick-up|open house|comedy|concert|charity|fundraiser|benefit|cook-?off|competition|contest|crawl|5k|show\b|murder mystery|dance party|grand opening|wine club|beer club|experience|chocolate|cheese|oyster|lobster|crab|bbq|pig roast|clambake|long table|chef|pop-?up dinner|soir[ée]e|retreat|car show|adoption|expo|gathering/i;
const NOT_SPECIAL = /^\W*open\b(?! house| air| mic| spot)|\bopen (?:on|until|late|\d)|\b(?:run|walk|running) club\b|packet pick ?up|^\W*food\s*:|food trucks?\b(?!.*festival)/i;
const byId = {}; places.forEach(p => byId[p.id] = p);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
/* how many different websites list the same title on the same day */
const elsewhere = {}; { const hosts = {}; for (const pid in found) for (const e of found[pid]) { const k = fold(e.d.title) + '|' + e.d.date; (hosts[k] = hosts[k] || new Set()).add(hostOf(byId[pid] ? byId[pid].w : pid)); } for (const k in hosts) elsewhere[k] = hosts[k].size; }
const rows = [], seen = new Set();
for (const pid in found) {
  const list = found[pid].filter(e => e.d.date >= today && e.d.date <= limit).sort((a, b) => a.d.date < b.d.date ? -1 : 1);
  let k = 0; const titles = {}, repeats = {}, dup = new Set(), counted = new Set(); list.forEach(e => { const t = fold(e.d.title), kk = t + '|' + e.d.date; if (counted.has(kk)) return; counted.add(kk); repeats[t] = (repeats[t] || 0) + 1; });
  for (const e of list) {
    const same = fold(e.d.title) + '|' + e.d.date; if (seen.has(e.id) || dup.has(same) || k >= PER_PLACE) continue;
    if (isRoutine(e.d.title, byId[pid] ? byId[pid].n : '')) continue;
    if (!WORTH.test(e.d.title)) continue;
    if (NOT_SPECIAL.test(e.d.title)) continue;   /* opening-hours notices, run clubs and race packet pick-ups, food-truck line-ups */   /* special events only: bare performer names and everyday listings are left out */
    const tk = fold(e.d.title), reps = repeats[tk] || 0;
    /* the same thing three or more times is a regular fixture, not a special event; seasonal ones keep their next two dates */
    if (reps >= 3 && !SPECIAL.test(e.d.title)) continue;
    titles[tk] = (titles[tk] || 0) + 1; if (titles[tk] > 2) continue;
    if (elsewhere[tk + '|' + e.d.date] >= 3) continue;   /* listed by three or more unrelated places: a ticket-site listing, not this place's event */
    seen.add(e.id); dup.add(same); k++;
    const d = e.d, link = /^https?:\/\//.test(d.link || '') ? d.link : '', tix = /^https?:\/\//.test(d.ticketLink || '') ? d.ticketLink : '';
    rows.push([e.id, pid, clean(d.title).replace(/\s+[\u2014\u2013|-]\s+[^\u2014\u2013]*\|.*$/, ''), d.date, d.time || '', d.type || 'Other', clean(d.desc).slice(0, 280), link, tix, clean(d.cost)]);
  }
}
rows.sort((a, b) => a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);
const out = path.join(ROOT, 'events-data.js');
let before = 0; try { const c2 = { window: {} }; vm.createContext(c2); vm.runInContext(fs.readFileSync(out, 'utf8'), c2); before = (c2.window.FR_EVENTS || []).filter(x => x[3] >= today).length; } catch (e) {}
console.log(rows.length + ' upcoming events at ' + Object.keys(found).length + ' places (the current file has ' + before + ' still upcoming)');
if (before > 200 && rows.length < before * 0.5 && !process.argv.includes('--force')) { console.log('Far fewer events than last time, so the existing file is kept (the search probably had network trouble).'); process.exit(0); }
fs.writeFileSync(out, '/* FatRaisin events found on places’ own websites. Rebuilt every week by tools/crawl-events.mjs. Updated ' + today + '.\n   One row per event: [id, place id, title, date, time, type, description, link, ticket link, cost] */\nwindow.FR_EVENTS_UPDATED="' + today + '";\nwindow.FR_EVENTS=[\n' + rows.map(r => JSON.stringify(r)).join(',\n') + '\n];\n');
process.exit(0);

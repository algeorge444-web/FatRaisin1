// Looks on each place's website for its booking links: Tock, OpenTable, Resy, SevenRooms, LibroReserve,
// CellarPass, VinoVisit, and the place's own "book a tasting / reservations" page. Run from GitHub.
// Opens the home page and up to 3 pages about visiting / tastings / reservations on the same site.
// Input: tools/booking-list.json [{id, name, url}]. FROM/TO/OUT env. Output {id: {tock, opentable, ..., ownbook}}
import fs from 'node:fs';
const ALL = JSON.parse(fs.readFileSync('tools/booking-list.json', 'utf8'));
const FROM = +(process.env.FROM || 0), TO = +(process.env.TO || ALL.length);
const LIST = ALL.slice(FROM, TO);
const OUTFILE = process.env.OUT || 'tools/booking-result.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SITES = [
  ['tock', /(^|\.)exploretock\.com$/], ['opentable', /(^|\.)opentable\.(com|ca)$/], ['resy', /(^|\.)resy\.com$/],
  ['sevenrooms', /(^|\.)sevenrooms\.com$/], ['libroreserve', /(^|\.)libroreserve\.com$/], ['cellarpass', /(^|\.)cellarpass\.com$/],
  ['vinovisit', /(^|\.)vinovisit\.com$/]
];
const OWN = /\b(book (a |your )?(tasting|visit|tour|table|experience|reservation)|make a reservation|reservations?|reserve (a |your )?(tasting|table|spot|visit)?|book now|tastings? (&|and) tours)\b/i;
const OWNPATH = /(reserv|book|tasting|tour|experience|visit)/i;
const withScheme = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
async function get(url) {
  let t;
  try {
    const ctl = new AbortController(); t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }, redirect: 'follow', signal: ctl.signal });
    let html = '';
    if (r.body) { const rd = r.body.getReader(), dec = new TextDecoder(); while (html.length < 500000) { const { done, value } = await rd.read(); if (done) break; html += dec.decode(value, { stream: true }); } try { await rd.cancel(); } catch (e) {} }
    clearTimeout(t); return { st: r.status, final: r.url, html };
  } catch (e) { clearTimeout(t); return { st: 0, final: url, html: '' }; }
}
function clean(u) {
  try { const x = new URL(u); [...x.searchParams.keys()].forEach(k => { if (/^(utm_|fbclid|gclid|_ga|ref)/i.test(k)) x.searchParams.delete(k); }); x.hash = ''; return x.href.replace(/\?$/, ''); } catch (e) { return ''; }
}
function scan(html, base, out, follow) {
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let u; try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch (e) { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const host = u.hostname.toLowerCase(), label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [k, re] of SITES) if (re.test(host) && !out[k] && u.pathname.length > 1) out[k] = clean(u.href);
    if (host.replace(/^www\./, '') === new URL(base).hostname.replace(/^www\./, '')) {
      if (!out.ownbook && OWN.test(label) && OWNPATH.test(u.pathname)) out.ownbook = clean(u.href);
      if (follow && /visit|tasting|reserv|book|experience|tour|dine|restaurant|menu/i.test(label + ' ' + u.pathname) && !follow.includes(u.href) && follow.length < 3) follow.push(u.href);
    }
  }
  // booking widgets embedded in the page (iframes / scripts)
  for (const m of html.matchAll(/(?:src|data-src|href)=["'](https?:\/\/[^"']+)["']/gi)) {
    let u; try { u = new URL(m[1].replace(/&amp;/g, '&')); } catch (e) { continue; }
    for (const [k, re] of SITES) if (re.test(u.hostname.toLowerCase()) && !out[k] && u.pathname.length > 1 && !/\.(js|css)$/.test(u.pathname)) out[k] = clean(u.href);
  }
}
const out = {}; let i = 0;
async function worker() {
  while (i < LIST.length) {
    const p = LIST[i++]; const o = {};
    try {
      const r = await get(withScheme(p.url));
      if (r.st && r.st < 400) {
        const follow = []; scan(r.html, r.final, o, follow);
        for (const u of follow) { const s = await get(u); if (s.st && s.st < 400) scan(s.html, s.final, o, null); }
      }
    } catch (e) {}
    if (Object.keys(o).length) out[p.id] = o;
  }
}
await Promise.all(Array.from({ length: 24 }, worker));
fs.writeFileSync(OUTFILE, JSON.stringify(out));
const v = Object.values(out); const c = {}; v.forEach(o => Object.keys(o).forEach(k => c[k] = (c[k] || 0) + 1));
console.log(LIST.length, 'sites;', v.length, 'with booking links;', JSON.stringify(c));

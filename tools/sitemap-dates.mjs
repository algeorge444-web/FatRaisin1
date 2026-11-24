// Finds when each place's website was last changed, using the site's sitemap (the hidden list of pages that
// most website builders keep, with a "last modified" date for each page) and the home page's Last-Modified header.
// Run from GitHub. Input tools/booking-list.json [{id,name,url}]. FROM/TO/OUT env.
// Output {id: {lm: "YYYY-MM-DD" newest date found, src: "sitemap"|"header"}}. Changes no place data.
import fs from 'node:fs';
const ALL = JSON.parse(fs.readFileSync('tools/booking-list.json', 'utf8'));
const FROM = +(process.env.FROM || 0), TO = +(process.env.TO || ALL.length);
const LIST = ALL.slice(FROM, TO);
const OUTFILE = process.env.OUT || 'tools/sitemap-dates.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const NOW = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
async function get(url, max = 3000000) {
  let t;
  try {
    const ctl = new AbortController(); t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal });
    let body = '';
    if (r.body) { const rd = r.body.getReader(), dec = new TextDecoder(); while (body.length < max) { const { done, value } = await rd.read(); if (done) break; body += dec.decode(value, { stream: true }); } try { await rd.cancel(); } catch (e) {} }
    clearTimeout(t); return { st: r.status, final: r.url, body, lm: r.headers.get('last-modified') || '' };
  } catch (e) { clearTimeout(t); return { st: 0, body: '', lm: '' }; }
}
function newest(xml) {
  let best = '';
  for (const m of xml.matchAll(/<lastmod>\s*(\d{4}-\d{2}-\d{2})/gi)) { const d = m[1]; if (d <= NOW && d > best) best = d; }
  return best;
}
async function one(p) {
  let origin; try { origin = new URL(/^https?:/.test(p.url) ? p.url : 'https://' + p.url).origin; } catch (e) { return null; }
  const home = await get(origin + '/', 400000);
  if (home.st) try { origin = new URL(home.final).origin; } catch (e) {}
  let best = '', src = '';
  const tried = new Set(), queue = [];
  const robots = await get(origin + '/robots.txt', 100000);
  if (robots.st === 200) for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1]);
  queue.push(origin + '/sitemap.xml', origin + '/sitemap_index.xml', origin + '/wp-sitemap.xml');
  let n = 0;
  while (queue.length && n < 8) {
    const u = queue.shift(); if (tried.has(u)) continue; tried.add(u); n++;
    const r = await get(u);
    if (r.st !== 200 || !/<(urlset|sitemapindex)/i.test(r.body)) continue;
    const d = newest(r.body); if (d > best) { best = d; src = 'sitemap'; }
    if (/<sitemapindex/i.test(r.body)) for (const m of r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) if (queue.length < 12) queue.push(m[1].replace(/&amp;/g, '&'));
  }
  if (home.lm) { const d = new Date(home.lm); if (!isNaN(d)) { const s = d.toISOString().slice(0, 10); if (s <= NOW && s > best && s < new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)) { best = s; src = 'header'; } } }
  return best ? { lm: best, src } : null;
}
const out = {}; let i = 0;
async function worker() { while (i < LIST.length) { const p = LIST[i++]; try { const r = await one(p); if (r) out[p.id] = r; } catch (e) {} } }
await Promise.all(Array.from({ length: 24 }, worker));
fs.writeFileSync(OUTFILE, JSON.stringify(out));
const y = {}; Object.values(out).forEach(o => { const k = o.lm.slice(0, 4); y[k] = (y[k] || 0) + 1; });
console.log(LIST.length, 'sites;', Object.keys(out).length, 'with a date;', JSON.stringify(y));

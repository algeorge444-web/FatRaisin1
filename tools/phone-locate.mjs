// For places that share a phone number with another location: opens the place's website and its
// contact / locations / visit pages and looks for the phone number printed next to THIS location's street
// address. Run from GitHub. Changes no place data.
// Input: tools/phone-locate-list.json [{id, name, addr, town, url, phone}]
// Output (OUT env): {id: {near: [phones next to the address], all: [all phones seen], pages, hit: address seen}}
import fs from 'node:fs';

const ALL = JSON.parse(fs.readFileSync('tools/phone-locate-list.json', 'utf8'));
const FROM = +(process.env.FROM || 0), TO = +(process.env.TO || ALL.length);
const LIST = ALL.slice(FROM, TO);
const OUTFILE = process.env.OUT || 'tools/phone-locate-result.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PH = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]{0,2}(\d{3})[\s.-](\d{4})\b/g;
const PATHS = ['/locations', '/location', '/contact', '/contact-us', '/visit', '/visit-us', '/find-us', '/hours', '/taprooms', '/about'];
const withScheme = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u);

async function get(url) {
  let t;
  try {
    const ctl = new AbortController(); t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }, redirect: 'follow', signal: ctl.signal });
    let html = '';
    if (r.body) { const rd = r.body.getReader(), dec = new TextDecoder(); while (html.length < 500000) { const { done, value } = await rd.read(); if (done) break; html += dec.decode(value, { stream: true }); } try { await rd.cancel(); } catch (e) {} }
    clearTimeout(t);
    return { st: r.status, final: r.url, html };
  } catch (e) { clearTimeout(t); return { st: 0, final: url, html: '' }; }
}
const textOf = h => h.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
const phones = s => { const o = []; for (const m of s.matchAll(PH)) { const p = m[1] + '-' + m[2] + '-' + m[3]; if (!o.includes(p)) o.push(p); } return o; };

function streetKey(addr) {
  const first = addr.split(',')[0].toLowerCase();
  const num = (first.match(/\b\d{1,6}\b/) || [''])[0];
  const word = (first.replace(/\b\d+\w*\b/g, ' ').replace(/\b(n|s|e|w|ne|nw|se|sw|north|south|east|west|st|street|rd|road|ave|avenue|blvd|dr|drive|hwy|highway|ln|lane|suite|ste|unit|way|pike|route|rte|us|state)\b\.?/g, ' ').match(/[a-z]{3,}/) || [''])[0];
  return { num, word };
}
function nearPhones(text, key, town) {
  const low = text.toLowerCase(), out = [];
  let hit = false;
  const idxs = [];
  if (key.num) { let i = -1; while ((i = low.indexOf(key.num, i + 1)) !== -1 && idxs.length < 40) { const w = low.slice(i, i + 60); if (!key.word || w.includes(key.word)) idxs.push(i); } }
  for (const i of idxs) {
    hit = true;
    for (const p of phones(text.slice(Math.max(0, i - 250), i + 350))) if (!out.includes(p)) out.push(p);
  }
  return { hit, near: out };
}

async function one(p) {
  const key = streetKey(p.addr), all = [], near = [];
  let hit = false, pages = 0;
  const home = await get(withScheme(p.url)); pages++;
  const urls = [];
  if (home.st && home.st < 400) {
    const base = new URL(home.final);
    for (const m of home.html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
      const label = (m[2].replace(/<[^>]+>/g, ' ') + ' ' + m[1]).toLowerCase();
      if (!/location|contact|visit|find us|hours|taproom|tasting|about/.test(label) && !(p.town && label.includes(p.town.toLowerCase()))) continue;
      try { const u = new URL(m[1], base); if (u.host === base.host && !urls.includes(u.href)) urls.push(u.href); } catch (e) {}
      if (urls.length >= 6) break;
    }
    for (const path of PATHS) { const u = base.origin + path; if (!urls.includes(u)) urls.push(u); }
  }
  for (const page of [home, ...[]]) {
    const t = textOf(page.html); for (const x of phones(t)) if (!all.includes(x)) all.push(x);
    const n = nearPhones(t, key, p.town); hit = hit || n.hit; for (const x of n.near) if (!near.includes(x)) near.push(x);
  }
  for (const u of urls.slice(0, 12)) {
    const page = await get(u); pages++;
    if (!page.st || page.st >= 400) continue;
    const t = textOf(page.html); for (const x of phones(t)) if (!all.includes(x)) all.push(x);
    const n = nearPhones(t, key, p.town); hit = hit || n.hit; for (const x of n.near) if (!near.includes(x)) near.push(x);
  }
  return { near: near.slice(0, 8), all: all.slice(0, 20), pages, hit };
}

const out = {}; let i = 0;
async function worker() { while (i < LIST.length) { const p = LIST[i++]; try { out[p.id] = await one(p); } catch (e) { out[p.id] = { err: String(e).slice(0, 60) }; } } }
await Promise.all(Array.from({ length: 24 }, worker));
fs.writeFileSync(OUTFILE, JSON.stringify(out));
console.log(Object.keys(out).length, 'places;', Object.values(out).filter(x => x.hit).length, 'address found on site');

// Real-browser version of the location phone search (Chromium via Playwright on GitHub).
// For each place: opens its website, follows up to 8 links about locations / contact / visit / its town,
// finds this location's street address on the page and records the phone number printed closest to it.
// Input tools/phone-browser-list.json [{id, name, addr, town, url}]. SHARD/SHARDS env pick a slice.
// Output parts/pb-<shard>.json {id: {hit, best, dist, near:[...], all:[...]}}. Changes no place data.
import fs from 'node:fs';
import { chromium } from 'playwright';
const ALL = JSON.parse(fs.readFileSync('tools/phone-browser-list.json', 'utf8'));
const SH = +(process.env.SHARD || 0), N = +(process.env.SHARDS || 1);
const LIST = ALL.filter((_, i) => i % N === SH);
const PH = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]{0,2}(\d{3})[\s.-](\d{4})\b/g;
const withScheme = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u);

function key(addr) {
  const first = addr.split(',')[0].toLowerCase();
  const num = (first.match(/\b\d{1,6}\b/) || [''])[0];
  const word = (first.replace(/\b\d+\w*\b/g, ' ').replace(/\b(n|s|e|w|ne|nw|se|sw|north|south|east|west|st|street|rd|road|ave|avenue|blvd|dr|drive|hwy|highway|ln|lane|suite|ste|unit|way|pike|route|rte|us|state|old)\b\.?/g, ' ').match(/[a-z]{3,}/) || [''])[0];
  return { num, word };
}
function scan(text, k, acc) {
  const low = text.toLowerCase();
  const phones = [];
  for (const m of text.matchAll(PH)) phones.push({ p: m[1] + '-' + m[2] + '-' + m[3], i: m.index });
  for (const x of phones) if (!acc.all.includes(x.p)) acc.all.push(x.p);
  if (!k.num) return;
  let i = -1;
  while ((i = low.indexOf(k.num, i + 1)) !== -1) {
    if (k.word && !low.slice(i, i + 70).includes(k.word)) continue;
    if (/\d/.test(low[i - 1] || '') || /\d/.test(low[i + k.num.length] || '')) continue;
    acc.hit = true;
    for (const x of phones) {
      const d = x.i >= i ? x.i - i : i - x.i;
      if (d > 400) continue;
      if (!acc.near.includes(x.p)) acc.near.push(x.p);
      if (acc.dist === undefined || d < acc.dist) { acc.dist = d; acc.best = x.p; }
    }
  }
}
async function textOf(page) {
  return page.evaluate(() => {
    const t = document.body ? document.body.innerText : '';
    const tels = [...document.querySelectorAll('a[href^="tel:"]')].map(a => ' ' + a.getAttribute('href').replace('tel:', '') + ' ').join('');
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent).join(' ');
    return t + ' ' + ld.slice(0, 20000) + tels;
  }).catch(() => '');
}
const browser = await chromium.launch();
const out = {};
async function one(ctx, p) {
  const page = await ctx.newPage();
  const acc = { hit: false, near: [], all: [], pages: 0 };
  const k = key(p.addr);
  try {
    await page.goto(withScheme(p.url), { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2500);
    acc.pages++;
    scan(await textOf(page), k, acc);
    const town = (p.town || '').toLowerCase();
    const links = await page.evaluate((town) => {
      const out = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const h = a.href, t = (a.innerText + ' ' + h).toLowerCase();
        if (!h.startsWith(location.origin) || h.includes('#')) continue;
        if (/location|contact|visit|find-us|find us|hours|taproom|tasting|our-|about/.test(t) || (town && t.includes(town))) if (!out.includes(h)) out.push(h);
      }
      return out.slice(0, 14);
    }, town).catch(() => []);
    // links naming the town first
    links.sort((a, b) => (b.toLowerCase().includes(town.replace(/\s+/g, '-')) ? 1 : 0) - (a.toLowerCase().includes(town.replace(/\s+/g, '-')) ? 1 : 0));
    for (const u of links.slice(0, 8)) {
      if (acc.best && acc.dist < 120) break;
      try { await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 }); await page.waitForTimeout(1500); acc.pages++; scan(await textOf(page), k, acc); } catch (e) {}
    }
  } catch (e) { acc.err = String(e.message || e).slice(0, 60); }
  await page.close();
  acc.near = acc.near.slice(0, 8); acc.all = acc.all.slice(0, 15);
  return acc;
}
let i = 0;
async function worker() {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', locale: 'en-US' });
  while (i < LIST.length) { const p = LIST[i++]; try { out[p.id] = await one(ctx, p); } catch (e) { out[p.id] = { err: 'crash' }; } }
  await ctx.close();
}
await Promise.all([worker(), worker(), worker(), worker()]);
await browser.close();
fs.mkdirSync('parts', { recursive: true });
fs.writeFileSync(`parts/pb-${SH}.json`, JSON.stringify(out));
console.log(Object.keys(out).length, 'places;', Object.values(out).filter(x => x.hit).length, 'address found;', Object.values(out).filter(x => x.best).length, 'phone next to it');

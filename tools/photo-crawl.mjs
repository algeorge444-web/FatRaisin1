// Finds a photo for places that have none, from the place's OWN website (no Google): the picture the
// site shares for link previews (og:image / twitter:image / schema.org image), else its biggest header image.
// Each candidate image is opened to check it is a real, large photo (not a logo/icon). Run on GitHub.
// Input tools/photo-list.json [{id,name,url}]; SHARD/SHARDS env; output parts/p-<shard>.json {id:{img,w,h,src}}
import fs from 'node:fs';
const ALL = JSON.parse(fs.readFileSync('tools/photo-list.json', 'utf8'));
const SH = +(process.env.SHARD || 0), N = +(process.env.SHARDS || 1);
const LIST = ALL.filter((_, i) => i % N === SH);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const BAD = /(logo|icon|favicon|sprite|placeholder|blank|spacer|pixel|badge|button|banner-ad|loader|avatar|emoji|signature|map|qr|seal|award|medal|untappd|facebook|instagram|twitter|google|yelp|tripadvisor|payment|visa|mastercard|age-?gate|cropped-.*\d{2,3}x\d{2,3}|\.svg|\.gif)/i;
async function get(url, max, asBin) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': asBin ? 'image/*' : 'text/html,*/*' }, redirect: 'follow', signal: ctl.signal });
    const rd = r.body.getReader(); const chunks = []; let n = 0;
    while (n < max) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); n += value.length; }
    try { await rd.cancel(); } catch (e) {}
    const buf = Buffer.concat(chunks);
    return { st: r.status, final: r.url, type: r.headers.get('content-type') || '', len: +(r.headers.get('content-length') || 0), buf };
  } catch (e) { return { st: 0 }; } finally { clearTimeout(t); }
}
function dims(b) {
  if (!b || b.length < 30) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (f === 'VP8L') { const x = b.readUInt32LE(21); return [(x & 0x3fff) + 1, ((x >> 14) & 0x3fff) + 1]; }
    if (f === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]; const len = b.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}
const abs = (u, base) => { try { return new URL(u.replace(/&amp;/g, '&').trim(), base).href; } catch (e) { return ''; } };
function candidates(html, base) {
  const c = [];
  const meta = (re) => { for (const m of html.matchAll(re)) c.push(['meta', abs(m[1], base)]); };
  meta(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/gi);
  meta(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/gi);
  for (const m of html.matchAll(/"image"\s*:\s*(?:\[\s*)?(?:\{[^}]*?"url"\s*:\s*)?"(https?:[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)) c.push(['schema', abs(m[1].replace(/\\\//g, '/'), base)]);
  // big images in the page: srcset largest, data-src, src, and CSS backgrounds
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0]; let u = '';
    const ss = tag.match(/(?:data-)?srcset=["']([^"']+)["']/i);
    if (ss) { const parts = ss[1].split(',').map(s => s.trim().split(/\s+/)); parts.sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0)); u = parts[0][0]; }
    if (!u) { const s = tag.match(/(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i); u = s ? s[1] : ''; }
    if (u && /\.(jpe?g|png|webp)(\?|$)/i.test(u)) c.push(['img', abs(u, base)]);
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+\.(?:jpe?g|png|webp)[^'")]*)['"]?\s*\)/gi)) c.push(['bg', abs(m[1], base)]);
  const seen = new Set(); return c.filter(([, u]) => u && /^https:/.test(u) && !BAD.test(u) && !seen.has(u) && seen.add(u));
}
const out = {};
async function one(p) {
  const pg = await get(p.url, 800000, false);
  if (!pg.st || pg.st >= 400 || !pg.buf) return { err: 'page ' + pg.st };
  const html = pg.buf.toString('utf8');
  const cands = candidates(html, pg.final || p.url).slice(0, 12);
  for (const [src, u] of cands) {
    const im = await get(u, 200000, true);
    if (!im.st || im.st >= 400 || !/image\//i.test(im.type)) continue;
    const d = dims(im.buf); if (!d) continue;
    const [w, h] = d;
    if (w < 700 || h < 350) continue;           // too small for the place page
    if (w / h > 3.2 || h / w > 1.1) continue;   // thin strips and tall (portrait) pictures
    if ((im.len || im.buf.length) < 25000) continue; // tiny files are usually graphics
    return { img: u, w, h, src };
  }
  return { none: cands.length };
}
let i = 0;
async function worker() { while (i < LIST.length) { const p = LIST[i++]; try { out[p.id] = await one(p); } catch (e) { out[p.id] = { err: 'crash' }; } } }
await Promise.all(Array.from({ length: 16 }, worker));
fs.mkdirSync('parts', { recursive: true });
fs.writeFileSync(`parts/p-${SH}.json`, JSON.stringify(out));
console.log(Object.keys(out).length, 'checked;', Object.values(out).filter(o => o.img).length, 'photos found');

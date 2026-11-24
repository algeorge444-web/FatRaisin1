// Finds Canadian postal codes for places whose address has none (run on GitHub).
// Looks at the place's own website (home + contact pages) and OpenStreetMap (address search and the pin).
// Input tools/postal-list.json [{id,name,addr,prov,url,lat,lng}]  Output tools/postal-result.json. Changes no place data.
import fs from 'node:fs';
const LIST = JSON.parse(fs.readFileSync('tools/postal-list.json', 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const OSMUA = 'FatRaisin-postal-check/1.0 (github.com/algeorge444-web/FatRaisin1)';
const PC = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])[ -]?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/g;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function page(u) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try { const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal }); const h = (await r.text()).slice(0, 600000);
    return h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  } catch (e) { return ''; } finally { clearTimeout(t); }
}
async function osm(url) { try { const r = await fetch(url, { headers: { 'User-Agent': OSMUA } }); return await r.json(); } catch (e) { return null; } finally { await wait(1200); } }
const out = {};
for (const p of LIST) {
  const o = { site: [], osm: [], rev: '' };
  const street = (p.addr.split(',')[0].match(/^\d+[A-Za-z]?\s+(.{3,})/) || [, ''])[1].split(' ')[0].toLowerCase();
  const origin = (() => { try { return new URL(p.url).origin; } catch (e) { return ''; } })();
  for (const path of ['', '/contact', '/contact-us', '/visit', '/about']) {
    if (!origin) break;
    const t = await page(origin + path); if (!t) continue;
    for (const m of t.matchAll(PC)) { const code = m[1] + ' ' + m[2]; const ctx = t.slice(Math.max(0, m.index - 120), m.index).toLowerCase(); o.site.push({ code, street: street && ctx.includes(street) }); }
    if (o.site.some(x => x.street)) break;
  }
  const s = await osm('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=3&countrycodes=ca&q=' + encodeURIComponent(p.addr));
  for (const x of s || []) if (x.address?.postcode) o.osm.push(x.address.postcode.toUpperCase());
  const rv = await osm(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${p.lat}&lon=${p.lng}`);
  o.rev = (rv?.address?.postcode || '').toUpperCase();
  out[p.id] = o;
}
fs.writeFileSync('tools/postal-result.json', JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'looked up;', Object.values(out).filter(o => o.site.length).length, 'with a code on their site');

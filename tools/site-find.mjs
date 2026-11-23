// For places whose saved website is parked, for sale or gone: try likely web addresses built from the
// place's name and keep one whose page shows the name plus the phone number or town. Changes no place data.
// Input tools/site-find-list.json [{id,name,url,city,phone,ca}]  Output tools/site-find-result.json {id:{found,tried}}
import fs from 'node:fs';
import dns from 'node:dns/promises';
const LIST = JSON.parse(fs.readFileSync('tools/site-find-list.json', 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const KIND = /^(brewing|brewery|brewers|brewhouse|winery|wines?|cellars?|vineyards?|estate|distillery|distilling|spirits|cidery|cider|meadery|mead|company|co|inc|llc|beer|works|the|and|of|farm|family)$/;
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
function candidates(p) {
  const w = norm(p.name); const core = w.filter(x => !KIND.test(x)); const kinds = w.filter(x => KIND.test(x) && !/^(the|and|of|co|inc|llc|company)$/.test(x));
  const stems = new Set([core.join(''), w.filter(x => !/^(the|co|inc|llc|company)$/.test(x)).join(''), w.join('')]);
  for (const k of ['winery', 'wines', 'wine', 'brewing', 'brewery', 'beer', 'brewingco', 'cellars', 'vineyards', 'vineyard', 'distillery', 'distilling', 'spirits', 'cider', 'cidery', 'meadery', 'estate', 'estatewinery']) stems.add(core.join('') + k);
  for (const k of kinds) stems.add(core.join('') + k);
  const tlds = p.ca ? ['.ca', '.com', '.wine', '.beer'] : ['.com', '.wine', '.beer', '.net', '.co', '.us'];
  const old = (p.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const out = [];
  for (const s of stems) if (s.length >= 4) for (const t of tlds) { const d = s + t; if (d !== old && !out.includes(d)) out.push(d); }
  return out.slice(0, 60);
}
async function grab(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal });
    let h = ''; const rd = r.body.getReader(); const dec = new TextDecoder();
    while (h.length < 700000) { const { done, value } = await rd.read(); if (done) break; h += dec.decode(value, { stream: true }); }
    try { await rd.cancel(); } catch (e) {}
    return { st: r.status, final: r.url, html: h };
  } catch (e) { return { st: 0 }; } finally { clearTimeout(t); }
}
const txt = h => (h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const PARK = /(\/lander|for sale|buy this domain|parked|domain has expired|sedoparking|hugedomains|afternic|dan\.com)/i;
async function one(p) {
  const res = { found: '', why: '', tried: 0 };
  const words = norm(p.name).filter(x => !KIND.test(x) && x.length > 2);
  const phone = (p.phone || '').replace(/\D/g, '').slice(-7);
  const city = norm(p.city || '').join(' ');
  for (const d of candidates(p)) {
    try { await dns.lookup(d); } catch (e) { continue; }
    res.tried++;
    const g = await grab('https://' + d);
    if (!g.st || g.st >= 400 || PARK.test(g.html.slice(0, 20000))) continue;
    let t = txt(g.html);
    if (!(phone && t.replace(/\D/g, '').includes(phone))) { const c = await grab('https://' + d + '/contact'); if (c.st && c.st < 400) t += ' ' + txt(c.html); }
    const tl = norm(t).join(' '); const digits = t.replace(/\D/g, '');
    const hit = words.filter(x => tl.includes(x)).length;
    const okName = words.length ? hit >= Math.ceil(words.length * 0.6) : false;
    const okPlace = (phone && digits.includes(phone)) || (city && tl.includes(city));
    if (okName && okPlace) { res.found = new URL(g.final).host.replace(/^www\./, ''); res.why = (phone && digits.includes(phone) ? 'phone' : 'town') + ' ' + hit + '/' + words.length; break; }
  }
  return res;
}
const out = {}; let i = 0;
async function worker() { while (i < LIST.length) { const p = LIST[i++]; out[p.id] = await one(p); } }
await Promise.all(Array.from({ length: 12 }, worker));
fs.writeFileSync('tools/site-find-result.json', JSON.stringify(out));
console.log(Object.keys(out).length, 'looked up;', Object.values(out).filter(o => o.found).length, 'new websites found');

// Second look at places whose website failed tools/site-check.mjs (run on GitHub).
// For each: does the domain still exist (DNS), what does the page say, and what does a web search
// (DuckDuckGo's plain HTML page) list as the place's website now. Changes no place data.
// Input tools/site-recheck-list.json [{id,name,url,city}]  Output tools/site-recheck-result.json
import fs from 'node:fs';
import dns from 'node:dns/promises';
const LIST = JSON.parse(fs.readFileSync('tools/site-recheck-list.json', 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const host = u => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).host.replace(/^www\./i, ''); } catch (e) { return ''; } };
async function grab(url, max = 60000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }, redirect: 'follow', signal: ctl.signal });
    let h = ''; const rd = r.body.getReader(); const dec = new TextDecoder();
    while (h.length < max) { const { done, value } = await rd.read(); if (done) break; h += dec.decode(value, { stream: true }); }
    try { await rd.cancel(); } catch (e) {}
    return { st: r.status, final: r.url, html: h.slice(0, max) };
  } catch (e) { return { st: 0, err: String(e.cause?.code || e.name || e).slice(0, 60) }; } finally { clearTimeout(t); }
}
const txt = h => (h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const SKIP = /(facebook|instagram|yelp|tripadvisor|untappd|google|mapquest|yellowpages|yp\.|bbb\.org|wikipedia|duckduckgo|beeradvocate|brewbound|ratebeer|opentable|toasttab|wanderlog|restaurantguru|foursquare|linkedin|twitter|x\.com|tiktok|youtube|pinterest|groupon|indeed|zillow|loopnet|chamberofcommerce|manta|bizapedia|opencorporates|winecountry|vinoshipper|wine-searcher|vivino|nextdoor|airbnb|expedia|booking\.com|trip\.com|reddit|alltrails|roadtrippers|eventbrite|allevents|patch\.com|craftbeer\.com|beermenus|taplist|distillerytrail|apple\.com|bing\.com)/i;
const out = {};
let idx = 0;
async function one(p) {
  const h = host(p.url); const o = { host: h };
  try { o.dns = (await dns.lookup(h)).address; } catch (e) { o.dns = 'NONE:' + (e.code || ''); }
  const g = await grab(/^https?:/i.test(p.url) ? p.url : 'https://' + p.url);
  o.st = g.st; o.final = g.final || ''; o.err = g.err || '';
  const t = txt(g.html); o.text = t.slice(0, 300);
  if (/\/lander/.test(g.html || '')) { const l = await grab('https://' + h + '/lander'); o.lander = txt(l.html).slice(0, 200); }
  const words = p.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !/(brewing|brewery|winery|cellars|vineyards?|distill|company|cider|wines?|spirits|estate|farm)/.test(w));
  o.nameOnPage = words.length ? words.filter(w => t.toLowerCase().includes(w)).length + '/' + words.length : '';
  const s = await grab('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(p.name + ' ' + (p.city || '')), 200000);
  const links = [...(s.html || '').matchAll(/uddg=([^&"]+)/g)].map(m => decodeURIComponent(m[1]));
  o.search = [...new Set(links.map(host).filter(x => x && !SKIP.test(x)))].slice(0, 5);
  o.searchSt = s.st;
  out[p.id] = o;
  await new Promise(r => setTimeout(r, 1500));
}
async function worker() { while (idx < LIST.length) await one(LIST[idx++]); }
await Promise.all([worker(), worker(), worker()]);
fs.writeFileSync('tools/site-recheck-result.json', JSON.stringify(out));
console.log(Object.keys(out).length, 'rechecked;', Object.values(out).filter(o => o.dns.startsWith('NONE')).length, 'domains gone;', Object.values(out).filter(o => o.search.length).length, 'with search results');

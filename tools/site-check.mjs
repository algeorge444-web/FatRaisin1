// Checks places' websites from GitHub (a normal internet connection).
// Input: tools/site-check-list.json  [{id, name, url, kind}]
// Output: tools/site-check-result.json  {id: {st, final, title, sale, closed, home}}
//   st: HTTP status of the saved link (0 = could not connect)
//   home: for a "page not found" link, the status of the site's home page and its address
import fs from 'node:fs';

const LIST = JSON.parse(fs.readFileSync('tools/site-check-list.json', 'utf8'));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const SALE = /(domain (name )?(is |may be )?for sale|buy this domain|this (website|domain) is for sale|hugedomains|afternic|dan\.com|sedoparking|parkingcrew|bodis\.com|domain has expired|website expired|account (has been )?suspended|parked free|\/lander\b)/i;
const CLOSED = /(permanently closed|closed permanently|we have (officially |permanently )?closed|closed for good|closed (our|its) doors|ceased operations|no longer (open|operating|in business)|out of business)/i;

const withScheme = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u);

async function get(u) {
  for (const url of [withScheme(u), withScheme(u).replace(/^https:/, 'http:')]) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'en-US,en' }, redirect: 'follow', signal: ctl.signal });
      const html = (await r.text()).slice(0, 300000);
      clearTimeout(t);
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const title = (html.match(/<title[^>]*>([^<]*)/i) || [, ''])[1].trim().slice(0, 80);
      const s = SALE.exec(r.url + ' ' + title + ' ' + text.slice(0, 6000)) || SALE.exec(html.slice(0, 20000));
      const c = CLOSED.exec(text);
      return { st: r.status, final: r.url, title, sale: s ? s[0] : '', closed: c ? text.slice(Math.max(0, c.index - 100), c.index + 120) : '' };
    } catch (e) { /* try plain http next */ }
  }
  return { st: 0 };
}

const out = {};
let i = 0;
async function worker() {
  while (i < LIST.length) {
    const p = LIST[i++];
    const r = await get(p.url);
    if (p.kind === '404' || r.st === 404) {
      const host = new URL(withScheme(p.url)).host;
      const h = await get(host);
      r.home = { st: h.st, url: host, sale: h.sale, closed: h.closed, title: h.title };
    }
    out[p.id] = r;
  }
}
await Promise.all(Array.from({ length: 48 }, worker));
fs.writeFileSync('tools/site-check-result.json', JSON.stringify(out));
const n = Object.values(out);
console.log(n.length, 'checked;', n.filter(x => x.st && x.st < 400).length, 'ok;', n.filter(x => !x.st).length, 'unreachable;', n.filter(x => x.sale).length, 'for sale');

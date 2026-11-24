// Checks places' websites from GitHub (a normal internet connection).
// Input: tools/site-check-list.json  [{id, name, url, kind}]
// Output: tools/site-check-result.json  {id: {st, final, title, sale, closed, home}}
//   st: HTTP status of the saved link (0 = could not connect)
//   home: for a "page not found" link, the status of the site's home page and its address
import fs from 'node:fs';

const ALL = JSON.parse(fs.readFileSync('tools/site-check-list.json', 'utf8'));
// Optional slice (FROM/TO env) so big lists can be split across several runs; OUT env = output file.
const FROM = +(process.env.FROM || 0), TO = +(process.env.TO || ALL.length);
const LIST = ALL.slice(FROM, TO);
const OUTFILE = process.env.OUT || 'tools/site-check-result.json';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const SALE = /(domain (name )?(is |may be )?for sale|buy this domain|this (website|domain) is for sale|hugedomains|afternic|dan\.com|sedoparking|parkingcrew|bodis\.com|domain has expired|website expired|account (has been )?suspended|parked free|\/lander\b)/i;
const CLOSED = /((we|we'll|we will|we are|we're) (be )?(closing|shutting) (our|the|its)? ?(doors|taproom|tasting room|brewery|winery|distillery|cidery|business|for good|permanently)|will (be )?(closing|close) (our|its|the) (doors|taproom|tasting room)|will (be )?(permanently )?clos(e|ing) (on|at the end of|after)|our (last|final) (day|weekend|night|service) (open |of service )?(is|will be|was)|final weekend|closing (our|its) doors|last call (is|will be) |permanently closed|closed permanently|we have (officially |permanently )?closed|closed for good|closed (our|its) doors( for good| permanently)?|ceased operations|no longer (open|operating|in business)|out of business|(the )?difficult decision to close|decided to close (our|the) (doors|taproom|tasting room|brewery|winery|distillery)|final (day|pour|service)s? (is|was|will be)|last day of (service|operation|business)|farewell (party|celebration|to (our|the) (taproom|brewery|winery))|thank you for (\d+|many|all (the|these)) (wonderful |amazing |great )?years.{0,60}clos|ferm[ée]e? (d[ée]finitivement|pour de bon)|a? ?cess[ée] (ses|nos) activit[ée]s|fermeture d[ée]finitive|nous avons ferm[ée])/i;
const SPAM = /(slot ?gacor|situs (slot|judi|togel)|togel|judi online|sabung ayam|bandar (togel|judi)|link slot|slot88|maxwin|pragmatic play|online casino|casino online|best online casinos|bonus (de )?casino|apuestas deportivas|bahis|kasyno|[^a-z]porn|\bviagra\b|\bcialis\b|payday loan|乐鱼|体育官方|博彩|娱乐城)/i;

const withScheme = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u);

async function get(u) {
  for (const url of [withScheme(u), withScheme(u).replace(/^https:/, 'http:')]) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'en-US,en' }, redirect: 'follow', signal: ctl.signal });
      let html = '';
      if (r.body) {
        const rd = r.body.getReader(); const dec = new TextDecoder();
        while (html.length < 300000) { const { done, value } = await rd.read(); if (done) break; html += dec.decode(value, { stream: true }); }
        try { await rd.cancel(); } catch (e) {}
      }
      html = html.slice(0, 300000);
      clearTimeout(t);
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const title = (html.match(/<title[^>]*>([^<]*)/i) || [, ''])[1].trim().slice(0, 80);
      const s = SALE.exec(r.url + ' ' + title + ' ' + text.slice(0, 6000)) || SALE.exec(html.slice(0, 20000));
      const c = CLOSED.exec(text);
      const sp = SPAM.exec(title + ' ' + text);
      return { st: r.status, final: r.url, title, sale: s ? s[0] : '', closed: c ? text.slice(Math.max(0, c.index - 100), c.index + 120) : '', spam: sp ? text.slice(Math.max(0, sp.index - 60), sp.index + 80) || sp[0] : '', size: html.length };
    } catch (e) { if (typeof t !== 'undefined') clearTimeout(t); /* try plain http next */ }
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
await Promise.all(Array.from({ length: 32 }, worker));
fs.writeFileSync(OUTFILE, JSON.stringify(out));
const n = Object.values(out);
console.log(n.length, 'checked;', n.filter(x => x.st && x.st < 400).length, 'ok;', n.filter(x => !x.st).length, 'unreachable;', n.filter(x => x.sale).length, 'for sale');

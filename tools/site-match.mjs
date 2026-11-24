// Deeper website check, run from GitHub. For each place it opens the saved website and checks that the
// page really belongs to that place: its name, its phone number and its town. If the phone or town isn't
// on the home page it also opens up to 3 "contact / visit / about" pages on the same site.
// Input: tools/site-match-list.json  [{id, name, town, phone, url, type}]
// Output (OUT env): {id: {st, final, title, nm, ph, tw, pg, sale, closed, spam, desc}}
//   nm: share (0..1) of the name's distinctive words found on the site (title, text or web address)
//   ph: phone number found;  tw: town found;  pg: number of pages opened
import fs from 'node:fs';

const ALL = JSON.parse(fs.readFileSync('tools/site-match-list.json', 'utf8'));
const FROM = +(process.env.FROM || 0), TO = +(process.env.TO || ALL.length);
const LIST = ALL.slice(FROM, TO);
const OUTFILE = process.env.OUT || 'tools/site-match-result.json';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const SALE = /(domain (name )?(is |may be )?for sale|buy this domain|this (website|domain) is for sale|hugedomains|afternic|sedoparking|parkingcrew|bodis\.com|domain has expired|website expired|account (has been )?suspended|parked free|\/lander\b)/i;
const CLOSED = /((we|we'll|we will|we are|we're) (be )?(closing|shutting) (our|the|its)? ?(doors|taproom|tasting room|brewery|winery|distillery|cidery|business|for good|permanently)|will (be )?(permanently )?clos(e|ing) (on|at the end of|after)|permanently closed|closed permanently|we have (officially |permanently )?closed|closed for good|closed (our|its) doors|ceased operations|no longer (open|operating|in business)|out of business|difficult decision to close|ferm[ée]e? d[ée]finitivement|fermeture d[ée]finitive)/i;
const SOON = /(coming soon|under construction|site is being built|launching soon|website coming|opening soon|stay tuned for our new)/i;
const SPAM = /(slot ?gacor|situs (slot|judi|togel)|togel|judi online|sabung ayam|slot88|maxwin|online casino|casino online|best online casinos|\bviagra\b|\bcialis\b|payday loan|博彩|娱乐城)/i;
const GENERIC = new Set(('the and of at on in by co company companies inc llc ltd corp brewing brewery breweries brewpub brew brews brewhouse brewworks works beer beers ale ales house taproom tap room pub kitchen grill restaurant bar ' +
  'winery wineries wine wines vineyard vineyards vineyard estate estates cellar cellars vintners vino farm farms family orchard orchards ' +
  'distillery distilleries distilling distillers spirits spirit craft cidery cider ciders cidre meadery mead meads hard tasting project ' +
  'and & le la les de du des et vin vins vignoble vignobles domaine cave brasserie microbrasserie cidrerie distillerie').split(/\s+/));

const withScheme = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const flat = s => fold(s).replace(/[^a-z0-9]/g, '');

async function get(u) {
  for (const url of [withScheme(u), withScheme(u).replace(/^https:/, 'http:')]) {
    let t;
    try {
      const ctl = new AbortController();
      t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'en-US,en' }, redirect: 'follow', signal: ctl.signal });
      let html = '';
      if (r.body) {
        const rd = r.body.getReader(); const dec = new TextDecoder();
        while (html.length < 400000) { const { done, value } = await rd.read(); if (done) break; html += dec.decode(value, { stream: true }); }
        try { await rd.cancel(); } catch (e) {}
      }
      clearTimeout(t);
      return { st: r.status, final: r.url, html: html.slice(0, 400000) };
    } catch (e) { clearTimeout(t); }
  }
  return { st: 0, final: '', html: '' };
}

function textOf(html) {
  return html.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}
function phoneIn(html, ph) {
  if (!ph || ph.length < 10) return false;
  const a = ph.slice(0, 3), b = ph.slice(3, 6), c = ph.slice(6);
  return new RegExp(`${a}\\D{0,3}${b}\\D{0,3}${c}`).test(html) || html.includes(ph);
}
function nameScore(name, hay, hostFlat) {
  const words = fold(name).replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(w => w && !GENERIC.has(w) && w.length >= 2);
  if (!words.length) return 1;
  let hit = 0;
  for (const w of words) if (new RegExp(`(^|[^a-z0-9])${w}`).test(hay) || hostFlat.includes(w)) hit++;
  const whole = flat(words.join(''));
  if (whole.length >= 5 && (hostFlat.includes(whole) || flat(hay).includes(whole))) return 1;
  return Math.round(hit / words.length * 100) / 100;
}
function subLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const label = fold(m[2].replace(/<[^>]+>/g, ' ') + ' ' + m[1]);
    if (!/contact|visit|location|find us|hours|about|directions|taproom|tasting/.test(label)) continue;
    try {
      const u = new URL(m[1], base);
      if (u.host.replace(/^www\./, '') !== new URL(base).host.replace(/^www\./, '')) continue;
      if (!out.includes(u.href) && u.href !== base) out.push(u.href);
    } catch (e) {}
    if (out.length >= 3) break;
  }
  return out;
}

async function check(p) {
  const r = await get(p.url);
  if (!r.st) return { st: 0 };
  const town = fold(p.town).trim();
  let host = ''; try { host = new URL(r.final).host.replace(/^www\./, ''); } catch (e) {}
  const title = ((r.html.match(/<title[^>]*>([^<]*)/i) || [, ''])[1] || '').trim().slice(0, 100);
  const og = ((r.html.match(/property=["']og:site_name["'][^>]*content=["']([^"']*)/i) || [, ''])[1] || '').slice(0, 80);
  const desc = ((r.html.match(/name=["']description["'][^>]*content=["']([^"']*)/i) || [, ''])[1] || '').slice(0, 140);
  let text = textOf(r.html);
  const hay = fold(title + ' ' + og + ' ' + text);
  const nm = nameScore(p.name, hay, flat(host));
  const twRe = town ? new RegExp(`(^|[^a-z])${town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^(st|saint|ste|sainte)(\\\.)? /, '(st|saint|ste|sainte)\\.? ?-?')}([^a-z]|$)`) : null;
  let ph = phoneIn(r.html, p.phone), tw = twRe ? twRe.test(hay) : false, pg = 1;
  if ((!ph || !tw) && r.st < 400) {
    for (const u of subLinks(r.html, r.final)) {
      const s = await get(u); pg++;
      if (!s.st || s.st >= 400) continue;
      ph = ph || phoneIn(s.html, p.phone);
      tw = tw || (twRe ? twRe.test(fold(textOf(s.html))) : false);
      if (ph && tw) break;
    }
  }
  const sale = SALE.exec(r.final + ' ' + title + ' ' + text.slice(0, 6000));
  const c = CLOSED.exec(text), sp = SPAM.exec(title + ' ' + text);
  return { st: r.st, final: r.final.slice(0, 200), title, og, desc, nm, ph, tw, pg, size: r.html.length,
    sale: sale ? sale[0] : '', closed: c ? text.slice(Math.max(0, c.index - 80), c.index + 100) : '', spam: sp ? sp[0] : '', soon: SOON.test(title + ' ' + text.slice(0, 3000)) && text.length < 4000 ? 1 : 0 };
}

const out = {};
let i = 0;
async function worker() {
  while (i < LIST.length) {
    const p = LIST[i++];
    try { out[p.id] = await check(p); } catch (e) { out[p.id] = { st: 0, err: String(e).slice(0, 80) }; }
  }
}
await Promise.all(Array.from({ length: 32 }, worker));
fs.writeFileSync(OUTFILE, JSON.stringify(out));
const n = Object.values(out);
console.log(n.length, 'checked;', n.filter(x => x.st && x.st < 400).length, 'ok;', n.filter(x => x.nm >= 0.5 && (x.ph || x.tw)).length, 'match');

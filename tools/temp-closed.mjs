// Looks on each place's website (home page and a visit/hours page) for a notice that it is temporarily closed:
// "temporarily closed", "closed for the season", "closed until ...", "reopening in spring", etc. Run from GitHub.
// Input tools/temp-closed-list.json [{id,name,url}]. FROM/TO/OUT env. Output {id: {why, snippet, url}}. Changes no data.
import fs from 'node:fs';
const ALL = JSON.parse(fs.readFileSync('tools/temp-closed-list.json', 'utf8'));
const FROM = +(process.env.FROM || 0), TO = +(process.env.TO || ALL.length);
const LIST = ALL.slice(FROM, TO);
const OUTFILE = process.env.OUT || 'tools/temp-closed-result.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const RE = /(temporarily closed|closed temporarily|temporary closure|closed until further notice|closed for the (season|winter)|closed for winter|closed for renovations?|closed (now )?until (spring|april|may|march|june|further notice|20\d\d)|(we('| a)re|we will be) closed (for|until|through) (the )?(season|winter|january|february|march|april|may|renovation|remodel)|re-?open(ing|s)? (in|this) (spring|april|may|march|june|20\d\d)|see you (in|next) (the )?spring|on (winter )?hiatus|tasting room is (currently )?closed|currently closed)/i;
const withScheme = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
async function get(url) {
  let t;
  try {
    const ctl = new AbortController(); t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal });
    let html = '';
    if (r.body) { const rd = r.body.getReader(), dec = new TextDecoder(); while (html.length < 400000) { const { done, value } = await rd.read(); if (done) break; html += dec.decode(value, { stream: true }); } try { await rd.cancel(); } catch (e) {} }
    clearTimeout(t); return { st: r.status, final: r.url, html };
  } catch (e) { clearTimeout(t); return { st: 0, html: '' }; }
}
const textOf = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
function look(html, url) {
  const t = textOf(html), m = RE.exec(t);
  if (!m) return null;
  return { why: m[0], snippet: t.slice(Math.max(0, m.index - 120), m.index + 160), url };
}
const out = {}; let i = 0;
async function worker() {
  while (i < LIST.length) {
    const p = LIST[i++];
    try {
      const r = await get(withScheme(p.url)); if (!r.st || r.st >= 400) continue;
      let hit = look(r.html, r.final);
      if (!hit) {
        const m = r.html.match(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>[^<]{0,40}(hours|visit|tasting room|taproom|location)/i);
        if (m) { try { const u = new URL(m[1], r.final).href; const s = await get(u); if (s.st && s.st < 400) hit = look(s.html, u); } catch (e) {} }
      }
      if (hit) out[p.id] = hit;
    } catch (e) {}
  }
}
await Promise.all(Array.from({ length: 24 }, worker));
fs.writeFileSync(OUTFILE, JSON.stringify(out));
console.log(LIST.length, 'sites;', Object.keys(out).length, 'with a temporary-closure notice');

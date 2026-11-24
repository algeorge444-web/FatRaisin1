// Opens places' websites in a real browser (Chromium via Playwright) on GitHub, for sites that block
// simple checks. Records whether the page says closed / for sale, and the phone numbers it shows
// (also from contact/visit/about pages when asked). Changes no place data.
// Input tools/browser-check-list.json [{id,name,url,phone,city,blocked,phonecheck}]
// wanttext: also save the page's words, picture labels and title (txt) so the name can be matched.
// SHARD/SHARDS env pick a slice. Output parts/b-<shard>.json {id:{st,final,title,challenge,sale,closed,phones}}
import fs from 'node:fs';
import { chromium } from 'playwright';
const ALL = JSON.parse(fs.readFileSync('tools/browser-check-list.json', 'utf8'));
const SH = +(process.env.SHARD || 0), N = +(process.env.SHARDS || 1);
const LIST = ALL.filter((_, i) => i % N === SH);
const SALE = /(domain (name )?(is |may be )?for sale|buy this domain|this (website|domain) is for sale|hugedomains|afternic|sedoparking|parkingcrew|bodis\.com|domain has expired|website expired|account (has been )?suspended|parked free)/i;
const CLOSED = /(permanently closed|closed permanently|we have (officially |permanently )?closed|closed for good|closed (our|its) doors|ceased operations|no longer (open|operating|in business)|out of business|have made the (difficult|hard|tough) decision to close)/i;
const CHAL = /(just a moment|attention required|verify you are human|checking your browser|access denied|are you a robot|captcha)/i;
const PH = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]{0,2}(\d{3})[\s.-](\d{4})\b/g;
const browser = await chromium.launch();
const out = {};
async function look(page, url) {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    let title = await page.title().catch(() => '');
    let text = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    if (CHAL.test(title + ' ' + text.slice(0, 400))) { await page.waitForTimeout(9000); title = await page.title().catch(() => ''); text = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => ''); }
    const tels = await page.evaluate(() => [...document.querySelectorAll('a[href^="tel:"]')].map(a => a.getAttribute('href'))).catch(() => []);
    const alts = await page.evaluate(() => [...document.querySelectorAll('img[alt],[aria-label]')].map(e => e.getAttribute('alt') || e.getAttribute('aria-label')).concat([...document.querySelectorAll('meta[property="og:site_name"],meta[property="og:title"],meta[name="description"]')].map(m => m.content)).join(' | ').slice(0, 2000)).catch(() => '');
    return { st: resp ? resp.status() : 0, final: page.url(), title: title.slice(0, 90), text, tels, alts };
  } catch (e) { return { st: 0, err: String(e.message || e).slice(0, 80), text: '', tels: [], alts: '' }; }
}
const phonesIn = (text, tels) => { const s = new Set(); for (const t of [text, ...tels]) for (const m of (t || '').matchAll(PH)) s.add(m[1] + '-' + m[2] + '-' + m[3]); return [...s]; };
async function one(ctx, p) {
  const page = await ctx.newPage();
  const r = await look(page, p.url);
  const o = { st: r.st, final: r.final || '', title: r.title || '', err: r.err || '' };
  o.challenge = CHAL.test((r.title || '') + ' ' + (r.text || '').slice(0, 400));
  const s = SALE.exec((r.title || '') + ' ' + (r.text || '').slice(0, 6000)); o.sale = s ? s[0] : '';
  const c = CLOSED.exec(r.text || ''); o.closed = c ? r.text.slice(Math.max(0, c.index - 120), c.index + 140).replace(/\s+/g, ' ') : '';
  if (p.wanttext) o.txt = ((r.title || '') + ' | ' + (r.alts || '') + ' | ' + (r.text || '')).replace(/\s+/g, ' ').slice(0, 6000);
  if (p.phonecheck) {
    let phones = phonesIn(r.text, r.tels);
    const want = (p.phone || '').replace(/\D/g, '').slice(-10);
    const has = () => phones.some(x => x.replace(/\D/g, '') === want);
    if (!has() && r.st && r.st < 400) {
      const base = new URL(r.final || p.url).origin;
      for (const path of ['/contact', '/contact-us', '/visit', '/about', '/about-us', '/location', '/hours']) {
        const q = await look(page, base + path);
        if (q.st && q.st < 400) phones = [...new Set([...phones, ...phonesIn(q.text, q.tels)])];
        if (has()) break;
      }
    }
    o.phones = phones.slice(0, 10); o.phoneFound = has();
  }
  await page.close();
  return o;
}
let i = 0;
async function worker() {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', locale: 'en-US', viewport: { width: 1280, height: 900 } });
  while (i < LIST.length) { const p = LIST[i++]; try { out[p.id] = await one(ctx, p); } catch (e) { out[p.id] = { st: 0, err: 'crash' }; } }
  await ctx.close();
}
await Promise.all([worker(), worker(), worker(), worker()]);
await browser.close();
fs.mkdirSync('parts', { recursive: true });
fs.writeFileSync(`parts/b-${SH}.json`, JSON.stringify(out));
const v = Object.values(out);
console.log(v.length, 'opened;', v.filter(x => x.challenge).length, 'still blocked;', v.filter(x => x.sale).length, 'for sale;', v.filter(x => x.closed).length, 'mention closing;', v.filter(x => x.phoneFound).length, 'phone found');

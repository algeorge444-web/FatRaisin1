/* A copy of the FatRaisin helper (Cloudflare Worker) code, used by tools/crawl-events.mjs so the weekly event search reads websites exactly the way the helper does. No keys or secrets live in this file. */
/*
  FatRasin wine helper - a small Cloudflare Worker.

  What it does for the app:
    /find?name=&producer=&vintage=&site=   searches the web for the wine and reads the best product page
    /meta?url=                              reads one product page you already have a link for
    /insta?name=&town=&site=                finds a place's Instagram handle (from its own website first, then a search)
    /site?name=&town=&st=&ctry=             finds a place's own website (web search, then checks the site itself);
                                            ctry=US searches US results, st adds the state (e.g. MI)
    /placeinfo?url=                         a business's own name, address, phone and location, read from its website
    /osm?prov=BC                            every brewery, winery, cidery and distillery OpenStreetMap has in a province
                                            (or a US state: prov=US-MI), with addresses
    /wgbc?pg=N                              one page of the Wine Growers of BC winery directory, with each winery's address
    (scheduled)                             automatic weekly events: needs GCP_SA_KEY and a Cron Trigger (see runCron)
    /bcldb                                  the BC Liquor Stores product price list (BC open data, with UPC barcodes)
    /events?site=                           upcoming events on a place's website, with event links and ticket links
    /wco-events                             every event listed on Wine Country Ontario (winecountryontario.ca/event-listings)
    /archivephotos?site=                    photos from a recent saved copy of the place's site (Internet Archive, free)
    /sitephotos?site=                       large photos the place published on its own website (one image search)
    /geocode?addr=                          exact map spot for a US street address (US Census Bureau, free)
    /cal-events?url=                        every upcoming event on a calendar page (Squarespace, The Events Calendar, or event
                                            details on the page), e.g. a state wine or beer association's calendar
    /shop?site=&page=                       lists the wines a winery sells in its online shop (Shopify, WooCommerce,
                                            or any shop with a sitemap of product pages)
    /ping                                   lets the app check the helper is set up

  From a product page it returns the wine's name, picture, price, description and link,
  taken from the details shops publish for link previews (og: tags and product data).

  Settings - in Cloudflare: your Worker -> Settings -> Variables and Secrets:
    ALLOWED_ORIGIN   (Text)   your app's address, e.g. https://fatrasin.ca
                              Only that site can use the helper, so nobody else spends your searches.
                              Several addresses can be separated with commas.
    SEARCH_KEY       (Secret) your Serper.dev API key (Google results)
    SEARCH_PROVIDER  (Text)   optional: "serper" (the default) or "brave" if you use a Brave Search key
*/

const SKIP_HOSTS = /(^|\.)(facebook|instagram|twitter|x|pinterest|youtube|tiktok|reddit|wikipedia|yelp|tripadvisor|google|linkedin|untappd)\./i;
const GENERIC = new Set(('the wine wines winery wineries estate estates vineyard vineyards cellar cellars red white rose ' +
  'blend select reserve vqa ontario niagara canada co company inc ltd and of de du la le les edition bottle ml').split(' '));

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env).catch(e => console.log('cron failed', e && e.message)));
  },
  async fetch(req, env, ctx) {
    globalThis.__env = env;
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk && origin ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json' }
    });
    if (allowed.length && !originOk) return reply({ error: 'This helper only answers the FatRasin app.' }, 403);

    const url = new URL(req.url);
    try {
      /* BC open data price list: passed straight through (it's a CSV the app reads itself) */
      if (url.pathname === '/bcldb') {
        const r = await bcldbCsv();
        return new Response(r.body, { status: r.ok ? 200 : 502, headers: { ...cors, 'Content-Type': 'text/csv; charset=utf-8', 'X-Source-Url': r.url || '', 'Access-Control-Expose-Headers': 'X-Source-Url', 'Cache-Control': 'public, max-age=3600' } });
      }
      if (url.pathname === '/ping') {
        return reply({ ok: true, search: !!env.SEARCH_KEY, locked: allowed.length > 0 });
      }
      /* Answers are cached for a day, so the same wine doesn't use up another search. */
      const cache = caches.default;
      const HELPER_VERSION = '4';
      const cacheKey = new Request(url.toString() + (url.search ? '&' : '?') + '_hv=' + HELPER_VERSION, { method: 'GET' });
      const noCache = url.searchParams.get('fresh') === '1';
      const hit = noCache ? null : await cache.match(cacheKey);
      if (hit) return reply(await hit.json());

      let out;
      if (url.pathname === '/meta') {
        const target = url.searchParams.get('url') || '';
        if (!/^https?:\/\//i.test(target)) return reply({ error: 'Give a full web address, starting with https://' }, 400);
        out = await pageMeta(target);
      } else if (url.pathname === '/wco-events') {
        out = await wcoEvents();
      } else if (url.pathname === '/archivephotos') {
        out = await archivePhotos(url.searchParams.get('site') || '');
      } else if (url.pathname === '/sitephotos') {
        if (!env.SEARCH_KEY) return reply({ error: 'The helper has no search key yet.' }, 400);
        out = await sitePhotos(url.searchParams.get('site') || '', env);
      } else if (url.pathname === '/geocode') {
        out = await geocodeUS(url.searchParams.get('addr') || '');
      } else if (url.pathname === '/cal-events') {
        out = await calEvents(url.searchParams.get('url') || '');
      } else if (url.pathname === '/events') {
        out = await siteEvents(url.searchParams);
      } else if (url.pathname === '/shop') {
        out = await shopWines(url.searchParams);
      } else if (url.pathname === '/osm') {
        out = await osmPlaces(url.searchParams.get('prov') || '');
      } else if (url.pathname === '/wgbc') {
        out = await wgbcPage(+(url.searchParams.get('pg') || 1));
      } else if (url.pathname === '/placeinfo') {
        out = await placeInfo(url.searchParams.get('url') || '');
      } else if (url.pathname === '/site') {
        if (!env.SEARCH_KEY) return reply({ error: 'The helper has no search key yet.' }, 400);
        out = await findSite(url.searchParams, env);
      } else if (url.pathname === '/insta') {
        out = await findInsta(url.searchParams, env);
      } else if (url.pathname === '/find') {
        if (!env.SEARCH_KEY) return reply({ error: 'The helper has no search key yet. Add SEARCH_KEY in the Worker settings.' }, 400);
        out = await findWine(url.searchParams, env);
      } else {
        return reply({ error: 'Unknown request' }, 404);
      }
      const empty = !out || out.error || out.found === false || (Array.isArray(out.places) && !out.places.length);
      ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(out), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + (empty ? 3600 : 86400) }
      })));
      return reply(out);
    } catch (e) {
      return reply({ error: String((e && e.message) || e) }, 502);
    }
  }
};

/* ---------- searching ---------- */
async function search(q, env, ctry) {
  const us = String(ctry || '').toUpperCase() === 'US';
  const provider = (env.SEARCH_PROVIDER || 'serper').toLowerCase();
  if (provider === 'brave') {
    const r = await fetch('https://api.search.brave.com/res/v1/web/search?count=10&country=' + (us ? 'US' : 'CA') + '&q=' + encodeURIComponent(q), {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': env.SEARCH_KEY }
    });
    if (!r.ok) throw new Error('Brave Search answered ' + r.status + (r.status === 401 || r.status === 403 || r.status === 422 ? ' (check the key)' : ''));
    const j = await r.json();
    return ((j.web && j.web.results) || []).map(x => ({ title: x.title || '', url: x.url || '', snippet: x.description || '' }));
  }
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': env.SEARCH_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: us ? 'us' : 'ca', num: 10 })
  });
  if (!r.ok) throw new Error('Serper answered ' + r.status + (r.status === 401 || r.status === 403 ? ' (check the key)' : ''));
  const j = await r.json();
  return (j.organic || []).map(x => ({ title: x.title || '', url: x.link || '', snippet: x.snippet || '' }));
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function keyWords(s) {
  return norm(s).split(' ').filter(w => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

/* Score a search result: does it name this wine, and is it on the producer's own site? */
function scoreResult(r, nameW, prodW, vintage, site) {
  const host = hostOf(r.url);
  if (!host || SKIP_HOSTS.test(host) || /\.pdf($|\?)/i.test(r.url)) return null;
  const hay = norm(r.title + ' ' + r.url + ' ' + r.snippet);
  const hostFlat = host.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const nameHits = nameW.filter(w => (' ' + hay + ' ').includes(' ' + w + ' ')).length;
  const own = (site && (host === site || host.endsWith('.' + site))) ||
    (prodW.length > 0 && prodW.every(w => hostFlat.includes(w)));
  if (nameW.length && nameHits === 0) return null;
  let s = nameHits * 3 + (own ? 6 : 0) + prodW.filter(w => hay.includes(w)).length;
  if (vintage && hay.includes(String(vintage))) s += 2;
  if (/\/(product|products|shop|store|wines?)\b/i.test(r.url)) s += 2;
  if (/(vivino|wine-searcher|cellartracker)/i.test(host)) s -= 2;
  return { ...r, host, own, nameHits, score: s };
}

async function findWine(params, env) {
  const name = params.get('name') || '', producer = params.get('producer') || '';
  const vintage = (params.get('vintage') || '').replace(/\D/g, '').slice(0, 4);
  const site = (params.get('site') || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const nameW = keyWords(name), prodW = keyWords(producer);
  if (!nameW.length && !prodW.length) return { found: false, error: 'Need a wine name or producer to search for.' };

  const words = [producer, name, vintage].filter(Boolean).join(' ');
  let results = [];
  if (site) results = await search('site:' + site + ' ' + [name, vintage].filter(Boolean).join(' '), env, params.get('ctry'));
  if (!results.length) results = await search(words + ' wine', env, params.get('ctry'));

  const need = Math.min(2, nameW.length);
  const ranked = results.map(r => scoreResult(r, nameW, prodW, vintage, site)).filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const brief = ranked.slice(0, 5).map(r => ({ title: r.title, url: r.url, site: r.host }));

  for (const r of ranked.slice(0, 3)) {
    let meta;
    try { meta = await pageMeta(r.url); } catch (e) { continue; }
    if (!meta.image && !meta.isProduct) continue;
    /* the page itself should name the wine too */
    const pageHits = nameW.filter(w => (' ' + norm(meta.title + ' ' + meta.url) + ' ').includes(' ' + w + ' ')).length;
    const confident = pageHits >= need && (r.own || meta.isProduct);
    return { found: true, ...meta, own: r.own, confident, results: brief };
  }
  return { found: false, results: brief };
}

/* ---------- BC Liquor Stores price list (Open Government Licence - British Columbia) ---------- */
const BCLDB_DATASET = 'e43be180-7511-4e6f-84d3-ad6c9f5c3e2b';
const BCLDB_FALLBACK = 'https://catalogue.data.gov.bc.ca/dataset/e43be180-7511-4e6f-84d3-ad6c9f5c3e2b/resource/09a4eba7-c357-4764-8ef8-5f0499e11a3e/download/bc_liquor_store_product_price_list_june_2026.csv';
async function bcldbCsv() {
  let src = BCLDB_FALLBACK;
  try {
    /* the newest monthly CSV in the dataset (gives up after 8 seconds and uses the known file) */
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r0 = await fetch('https://catalogue.data.gov.bc.ca/api/3/action/package_show?id=' + BCLDB_DATASET, { headers: UA, signal: ctl.signal, cf: { cacheTtl: 86400, cacheEverything: true } });
    clearTimeout(t);
    const j = r0.ok ? await r0.json() : null;
    const res = ((j && j.result && j.result.resources) || []).filter(r => /csv/i.test(r.format || '') || /\.csv$/i.test(r.url || ''));
    res.sort((a, b) => String(b.last_modified || b.created || '').localeCompare(String(a.last_modified || a.created || '')));
    if (res[0] && res[0].url) src = res[0].url;
  } catch (e) { /* use the fallback */ }
  const r = await fetch(src, { headers: UA, redirect: 'follow', cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) return { ok: false, body: 'The BC price list answered ' + r.status, url: src };
  return { ok: true, body: r.body, url: src };
}

/* ---------- events on a place's website ---------- */
const TICKET_SITES = /https?:\/\/(?:www\.)?(?:eventbrite\.(?:ca|com)\/e\/[^"'\s<>#]+|exploretock\.com\/[^"'\s<>#]+|showpass\.com\/[^"'\s<>#]+|tixr\.com\/[^"'\s<>#]+|universe\.com\/events\/[^"'\s<>#]+|ticketmaster\.(?:ca|com)\/[^"'\s<>#]+\/event\/[^"'\s<>#]+|zeffy\.com\/[^"'\s<>#]*ticket[^"'\s<>#]*|ticketleap\.events\/[^"'\s<>#]+|tickettailor\.com\/events\/[^"'\s<>#]+|eventbrite\.(?:ca|com)\/o\/[^"'\s<>#]+)/gi;
function ldEvents(html, base) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let j; try { j = JSON.parse(m[1].trim()); } catch (e) { continue; }
    const list = [].concat(j && j['@graph'] ? j['@graph'] : j).flat();
    for (const it of list) {
      const type = [].concat((it && it['@type']) || []).join(' ');
      if (!/Event\b|Festival/i.test(type) || !it.startDate) continue;
      const offers = [].concat(it.offers || [])[0] || {};
      const img = [].concat(it.image || [])[0];
      out.push({
        title: decode(it.name || ''), start: String(it.startDate), end: String(it.endDate || ''),
        url: absUrl(it.url || '', base), tickets: absUrl(offers.url || '', base),
        cost: offers.price ? String(offers.price) : (offers.lowPrice ? String(offers.lowPrice) : ''),
        desc: stripHtml(it.description || '').slice(0, 600), img: absUrl(typeof img === 'string' ? img : (img && img.url) || '', base)
      });
    }
  }
  return out;
}
function absUrl(u, base) { try { return u ? new URL(u, base).href : ''; } catch (e) { return ''; } }
async function getHtml(u) {
  try {
    const r = await timedFetch(u, { headers: UA, redirect: 'follow' });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) return '';
    return (await r.text()).slice(0, 800000);
  } catch (e) { return ''; }
}
async function siteEvents(params, lim) {
  lim = lim || { pages: 4, tickets: 12 };
  let site = (params.get('site') || '').trim().replace(/\/+$/, '');
  if (!site) return { error: 'No website given.' };
  if (!/^https?:\/\//i.test(site)) site = 'https://' + site;
  const origin = new URL(site).origin;
  const today = new Date().toISOString().slice(0, 10);
  const events = [], seen = new Set();
  const add = e => {
    if (!e || !e.title || !e.start) return;
    const k = e.title.toLowerCase().replace(/\s+/g, ' ') + '|' + e.start.slice(0, 10);
    if (seen.has(k)) return;
    seen.add(k); events.push(e);
  };
  /* 1. WordPress sites using The Events Calendar publish a ready-made list */
  const tec = await getJson(origin + '/wp-json/tribe/events/v1/events?per_page=50&start_date=' + today);
  if (tec && Array.isArray(tec.events)) {
    tec.events.forEach(ev => add({
      title: decode(ev.title || ''), start: String(ev.start_date || ''), end: String(ev.end_date || ''), allDay: !!ev.all_day,
      url: ev.url || '', tickets: ev.website || '', cost: decode(ev.cost || ''),
      desc: stripHtml(ev.excerpt || ev.description || '').slice(0, 600), img: (ev.image && ev.image.url) || ''
    }));
    if (events.length) return { source: 'events-calendar', events };
  }
  /* 2. the home page and any events / what's-on pages: event details published for search engines, plus ticket links */
  const home = await getHtml(origin + '/');
  const pages = new Set();
  (home.match(/href\s*=\s*["'][^"']+["']/gi) || []).forEach(h => {
    const u = absUrl(h.replace(/^href\s*=\s*["']|["']$/gi, ''), origin);
    if (u.startsWith(origin) && /\/(events?|calendar|whats-?on|what-s-on|happenings|upcoming|concerts?|experiences)(\/|$|\?)/i.test(u)) pages.add(u.split('#')[0]);
  });
  ['/events', '/events/', '/whats-on'].forEach(p => { if (pages.size < 2) pages.add(origin + p); });
  const started = Date.now();
  const pageList = [...pages].slice(0, lim.pages);
  const htmls = [home].concat(await Promise.all(pageList.map(u => getHtml(u))));
  const tix = new Set();
  htmls.forEach((h, i) => {
    if (!h) return;
    ldEvents(h, i ? pageList[i - 1] : origin).forEach(add);
    (h.match(TICKET_SITES) || []).forEach(t => tix.add(t.replace(/&amp;/g, '&')));
  });
  /* 3. each ticket page (Eventbrite, Tock, Showpass...) lists the event's date and details */
  if (Date.now() - started < 15000) {
    const tl = [...tix].slice(0, lim.tickets);
    const got = await Promise.all(tl.map(t => getHtml(t)));
    got.forEach((h, i) => {
      if (!h) return;
      ldEvents(h, tl[i]).forEach(e => { if (!e.tickets) e.tickets = tl[i]; if (!e.url) e.url = tl[i]; add(e); });
    });
  }
  return { source: events.length ? 'pages' : 'none', events };
}

/* ---------- is this image a real photo, not a logo or graphic? (no image library needed) ----------
   Reads the picture's own header for its size, then compares its file size with its pixel count: photos are
   full of detail, so they take far more bytes per pixel than logos, badges and flat graphics of the same size.
   Also turns away see-through PNGs, SVG/GIF files, tiny or square-ish pictures and banner strips. */
function imgDims(b) {
  const u8 = new Uint8Array(b);
  if (u8[0] === 0x89 && u8[1] === 0x50) {                         // PNG
    const dv = new DataView(b); const ct = u8[25];               // colour type 4/6 = has transparency
    return { t: 'png', w: dv.getUint32(16), h: dv.getUint32(20), alpha: ct === 4 || ct === 6 };
  }
  if (u8[0] === 0xFF && u8[1] === 0xD8) {                         // JPEG: find a start-of-frame marker
    let i = 2;
    while (i < u8.length - 9) {
      if (u8[i] !== 0xFF) { i++; continue; }
      const m = u8[i + 1], len = (u8[i + 2] << 8) | u8[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { t: 'jpg', h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8] };
      i += 2 + len;
    }
  }
  if (u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) {   // WebP
    const f = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
    if (f === 'VP8 ') return { t: 'webp', w: ((u8[27] << 8) | u8[26]) & 0x3fff, h: ((u8[29] << 8) | u8[28]) & 0x3fff };
    if (f === 'VP8L') { const b0 = u8[21], b1 = u8[22], b2 = u8[23], b3 = u8[24]; return { t: 'webp', w: 1 + (((b1 & 0x3F) << 8) | b0), h: 1 + (((b3 & 0xF) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)), lossless: true }; }
    if (f === 'VP8X') return { t: 'webp', w: 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16)), h: 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16)), alpha: !!(u8[20] & 0x10) };
  }
  return null;
}
async function photoCheck(u) {
  try {
    const r = await timedFetch(u, { headers: UA, redirect: 'follow' }, 10000);
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/image\/(jpe?g|png|webp)/i.test(ct)) return { ok: false, why: 'not a photo file' };
    const b = await r.arrayBuffer();
    if (b.byteLength > 8e6) return { ok: false, why: 'too big' };
    const d = imgDims(b); if (!d || !d.w || !d.h) return { ok: false, why: 'unreadable' };
    const ar = d.w / d.h, bpp = b.byteLength / (d.w * d.h);
    if (d.w < 600 || d.h < 320) return { ok: false, why: 'small' };
    if (ar < 1.2 || ar > 2.8) return { ok: false, why: 'not landscape' };
    if (d.alpha) return { ok: false, why: 'see-through (logo)' };
    if (d.t === 'png' && bpp < 0.6) return { ok: false, why: 'flat graphic' };
    if (d.t !== 'png' && !d.lossless && bpp < 0.07) return { ok: false, why: 'flat graphic' };
    if (d.lossless && bpp < 0.5) return { ok: false, why: 'flat graphic' };
    return { ok: true, w: d.w, h: d.h, url: r.url, bpp: Math.round(bpp * 1000) / 1000 };
  } catch (e) { return { ok: false, why: 'did not load' }; }
}
async function keepPhotos(list, max) {
  const out = [];
  for (const x of list.slice(0, 8)) {
    const c = await photoCheck(x.url);
    if (c.ok) out.push({ url: c.url || x.url, w: c.w, h: c.h, page: x.page || '' });
    if (out.length >= (max || 2)) break;
  }
  return out;
}

/* ---------- photos from a recent saved copy of a place's website in the Internet Archive (free, no key, not Google) ----------
   Works for sites that block visitors or only show pictures once their scripts run. Photo links point at the live site. */
async function archivePhotos(site) {
  let url = String(site || '').trim();
  if (!url) return { error: 'Give the place\u2019s website.' };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const av = await getJson('https://archive.org/wayback/available?url=' + encodeURIComponent(url));
  const s = av && av.archived_snapshots && av.archived_snapshots.closest;
  if (!s || !s.available || String(s.timestamp) < '20230101') return { found: false, photos: [], note: 'no recent saved copy' };
  let raw = '';
  try { const r = await timedFetch('https://web.archive.org/web/' + s.timestamp + 'id_/' + url, { headers: UA, redirect: 'follow' }, 20000); if (r.ok) raw = (await r.text()).slice(0, 900000); } catch (e) {}
  if (!raw) return { found: false, photos: [], note: 'saved copy did not load' };
  const bad = /logo|icon|favicon|sprite|placeholder|gravatar|badge|award|happy|special|menu|promo|flyer|coupon|hours|trivia|event|poster|tap-?list|ontap|sign|welcome|map|button|arrow|social|facebook|instagram|payment|untappd/i;
  const c = [];
  const grab = re => { let m; while ((m = re.exec(raw))) c.push(m[1]); };
  grab(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)/gi);
  grab(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi);
  grab(/<img[^>]+(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:jpe?g|webp)(?:\?[^"']*)?)["']/gi);
  grab(/url\(["']?([^"')]+\.(?:jpe?g|webp)[^"')]*)/gi);
  grab(/(https?:\/\/images\.squarespace-cdn\.com\/[^"'\s)]+)/g);
  grab(/(https?:\/\/static\.wixstatic\.com\/media\/[^"'\s)]+?\.(?:jpe?g|webp))/g);
  const out = [];
  for (let u of c) {
    u = decode(u).trim().replace(/^https?:\/\/web\.archive\.org\/web\/\d+(?:im_|id_)?\//, '');
    try { u = new URL(u, url).href; } catch (e) { continue; }
    if (/^https:/.test(u) && !bad.test(u) && out.indexOf(u) < 0) out.push(u);
    if (out.length >= 8) break;
  }
  const photos = await keepPhotos(out.map(u => ({ url: u })), 2);
  return { found: photos.length > 0, photos, saved: String(s.timestamp).slice(0, 8), looked: out.length };
}

/* ---------- photos a place published on its own website, found with an image search limited to that site ----------
   One search per place (Serper images); only large landscape photos from the place's own domain are returned. */
async function sitePhotos(site, env) {
  const host = String(site || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  if (!host || host.indexOf('.') < 0) return { error: 'Give the place\u2019s website.' };
  const brave = (env.SEARCH_PROVIDER || 'serper').toLowerCase() === 'brave';
  let items = [];
  if (brave) {
    /* Brave's own image index (not Google) */
    const r = await fetch('https://api.search.brave.com/res/v1/images/search?count=50&safesearch=strict&q=' + encodeURIComponent('site:' + host), { headers: { 'Accept': 'application/json', 'X-Subscription-Token': env.SEARCH_KEY } });
    if (!r.ok) throw new Error('Brave Search answered ' + r.status + (r.status === 401 || r.status === 403 || r.status === 422 ? ' (check the key)' : ''));
    const j = await r.json();
    items = (j.results || []).map(x => ({ imageUrl: (x.properties && x.properties.url) || '', imageWidth: (x.properties && x.properties.width) || 0, imageHeight: (x.properties && x.properties.height) || 0, link: x.url || '', title: x.title || '' }));
  } else {
    const r = await fetch('https://google.serper.dev/images', { method: 'POST', headers: { 'X-API-KEY': env.SEARCH_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'site:' + host, num: 20 }) });
    if (!r.ok) throw new Error('Serper answered ' + r.status + (r.status === 401 || r.status === 403 ? ' (check the key)' : ''));
    items = ((await r.json()).images || []);
  }
  const bad = /logo|icon|favicon|sprite|badge|award|menu|flyer|poster|event|special|happy|hours|trivia|label|can-|bottle-shot|map/i;
  const photos = items.filter(x => {
    const h = hostOf(x.imageUrl || ''), w = +x.imageWidth || 0, ht = +x.imageHeight || 0;
    if (!x.imageUrl || bad.test(x.imageUrl) || bad.test(x.title || '')) return false;
    if (!(h === host || h.endsWith('.' + host) || /squarespace-cdn|wixstatic|wp\.com|shopify|cloudfront|amazonaws/.test(h))) return false;
    if (!(hostOf(x.link || '') === host || hostOf(x.link || '').endsWith('.' + host))) return false;
    if (w && ht) return w >= 700 && ht >= 380 && w / ht >= 1.2 && w / ht <= 2.8;
    return true;   /* size not given: the app checks the photo itself before offering it */
  }).slice(0, 8).map(x => ({ url: x.imageUrl, w: +x.imageWidth || 0, h: +x.imageHeight || 0, page: x.link || '' }));
  return { site: host, photos: await keepPhotos(photos, 2), via: brave ? 'brave' : 'serper' };
}

/* ---------- free exact pins for US addresses, from the US Census Bureau's address lookup (no key, no charge) ---------- */
async function geocodeUS(addr) {
  addr = String(addr || '').trim().slice(0, 200);
  if (!addr) return { error: 'Give an address.' };
  const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(addr);
  const j = await getJson(u);
  const m = j && j.result && j.result.addressMatches && j.result.addressMatches[0];
  if (!m) return { found: false };
  return { found: true, lat: m.coordinates.y, lng: m.coordinates.x, matched: m.matchedAddress };
}

/* ---------- any event calendar: Squarespace event pages, The Events Calendar (WordPress), or event details on the page ----------
   Used for state wine and beer association calendars (Ohio Wines, Brewers of Indiana Guild...). Each event carries the
   place's name (winery) when the calendar gives one, so the app can link it to the right place. */
function localStamp(ms, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
  } catch (e) { return new Date(ms).toISOString().slice(0, 16); }
}
async function calEvents(cal) {
  cal = String(cal || '').trim();
  if (!/^https?:\/\//i.test(cal)) return { error: 'Give the calendar page\u2019s full address.' };
  const u = new URL(cal), origin = u.origin;
  const today = new Date().toISOString().slice(0, 10);
  /* 1. Squarespace event pages publish their list as JSON */
  const sq = await getJson(origin + u.pathname + (u.pathname.endsWith('/') ? '' : '') + '?format=json');
  if (sq && Array.isArray(sq.upcoming)) {
    const tz = (sq.website && sq.website.timeZone) || 'America/New_York';
    const events = sq.upcoming.map(x => {
      const loc = x.location || {};
      return { title: decode(x.title || ''), start: x.startDate ? localStamp(x.startDate, tz) : '', end: x.endDate ? localStamp(x.endDate, tz) : '',
        url: absUrl(x.fullUrl || '', origin), tickets: '', desc: stripHtml(x.excerpt || x.body || '').slice(0, 600),
        winery: decode(loc.addressTitle || ''), address: [loc.addressLine1, loc.addressLine2].filter(Boolean).join(', '), img: x.assetUrl || '' };
    }).filter(e => e.title && e.start);
    return { source: 'squarespace', events };
  }
  /* 2. WordPress sites using The Events Calendar */
  const tec = await getJson(origin + '/wp-json/tribe/events/v1/events?per_page=50&start_date=' + today);
  if (tec && Array.isArray(tec.events)) {
    const events = tec.events.map(ev => {
      const v = ev.venue && typeof ev.venue === 'object' && !Array.isArray(ev.venue) ? ev.venue : {};
      return { title: decode(ev.title || ''), start: String(ev.start_date || ''), end: String(ev.end_date || ''), allDay: !!ev.all_day,
        url: ev.url || '', tickets: ev.website || '', cost: decode(ev.cost || ''), desc: stripHtml(ev.excerpt || ev.description || '').slice(0, 600),
        winery: decode(v.venue || ''), address: [v.address, v.city, v.stateprovince || v.state, v.zip].filter(Boolean).join(', '), img: (ev.image && ev.image.url) || '' };
    });
    return { source: 'events-calendar', events };
  }
  /* 3. event details published on the page itself */
  const html = await getHtml(cal);
  const events = html ? ldEvents(html, cal).map(e => Object.assign(e, { winery: '' })) : [];
  return { source: events.length ? 'page' : 'none', events };
}

/* ---------- Wine Country Ontario's event listings ---------- */
function to24(h, m, ap) {
  h = +h; m = +(m || 0); ap = String(ap || '').toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) return '';
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function textOf(h) { return decode(String(h || '').replace(/<[^>]+>/g, ' ')); }
async function wcoEvents(maxDetails, maxPages) {
  const base = 'https://winecountryontario.ca/event-listings/';
  const cards = new Map();
  for (let p = 1; p <= (maxPages || 12); p++) {
    const html = await getHtml(p === 1 ? base : base + 'page/' + p + '/');
    if (!html) break;
    const before = cards.size;
    /* each listing card: the title (h5), then the winery and the date (h6), then a short description */
    const re = /<h5[^>]*>\s*<a[^>]*href="(https:\/\/winecountryontario\.ca\/events\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h5>([\s\S]*?)(?=<h5|<footer|$)/gi;
    let m;
    while ((m = re.exec(html))) {
      const url = m[1].replace(/\/?$/, '/'), rest = m[3].slice(0, 3000);
      if (cards.has(url)) continue;
      const h6 = [...rest.matchAll(/<h6[^>]*>([\s\S]*?)<\/h6>/gi)].map(x => textOf(x[1]));
      const dateTxt = (rest.match(/(\d{2})\/(\d{2})\/(\d{4})/) || []);
      const winery = h6.find(t => t && !/^\d{2}\/\d{2}\/\d{4}$/.test(t)) || '';
      const snippet = textOf(rest.replace(/<h6[\s\S]*?<\/h6>/gi, '').replace(/<a[^>]*event-listings\/page[\s\S]*?<\/a>/gi, '')).slice(0, 400);
      cards.set(url, { url, title: textOf(m[2]), winery, date: dateTxt[0] ? dateTxt[3] + '-' + dateTxt[2] + '-' + dateTxt[1] : '', desc: snippet });
    }
    if (cards.size === before || !new RegExp('event-listings/page/' + (p + 1) + '/').test(html)) break;
  }
  /* each event's own page: time, full description and ticket link */
  /* every event in the listings is kept; the closest ones also get their own page read for the time and ticket link */
  const all = [...cards.values()].filter(c => c.title && c.date), list = all.slice(0, maxDetails || 34);
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(async c => {
      const h = await getHtml(c.url);
      if (!h) return;
      const ld = ldEvents(h, c.url)[0];
      if (ld && /T\d{2}:\d{2}/.test(ld.start)) c.time = ld.start.match(/T(\d{2}:\d{2})/)[1];
      if (!c.time) {
        const body = textOf(h.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')).slice(0, 20000);
        const t = body.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
        if (t) c.time = to24(t[1], t[2], t[3]);
      }
      const og = (h.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1];
      if (og && og.length > (c.desc || '').length) c.desc = decode(og).slice(0, 700);
      const tix = (h.match(TICKET_SITES) || [])[0];
      if (tix) c.tickets = tix.replace(/&amp;/g, '&');
      else {
        const a = [...h.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
          .find(x => /buy tickets|get tickets|tickets|purchase|reserve|book now|register|rsvp/i.test(textOf(x[2])) && /^https?:/i.test(x[1]) && !/winecountryontario\.ca/i.test(x[1]));
        if (a) c.tickets = a[1].replace(/&amp;/g, '&');
      }
      if (!c.winery) {
        const loc = h.match(/(?:Location|Winery|Venue)\s*:?\s*<\/[^>]+>\s*(?:<[^>]+>\s*)*([^<]{3,80})</i);
        if (loc) c.winery = decode(loc[1]).trim();
      }
    }));
  }
  return { source: 'winecountryontario', events: all.map(c => ({ title: c.title, start: c.date + (c.time ? 'T' + c.time : ''), url: c.url, tickets: c.tickets || '', desc: c.desc || '', winery: c.winery || '' })) };
}

/* ---------- a winery's online shop ---------- */
const NOT_WINE = /\b(gift ?cards?|e-?gift|tickets?|tours?|tastings?|experiences?|memberships?|club|subscriptions?|shirts?|t-shirt|tee|hoodies?|hats?|caps?|toques?|glass(es|ware)?|stemless|tumblers?|merch|events?|dinners?|classes?|workshops?|bags?|totes?|openers?|corkscrews?|candles?|vouchers?|shipping|deposits?|donations?|cheese|chocolates?|olive oil|vinegar|jam|honey|soap|book|puzzle|socks|apparel|accessor(y|ies)|gift ?box(es)?|gift ?sets?|bundle fee|rental|wedding|reservation|booking)\b/i;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; FatRasinWineHelper/1.0)', 'Accept': 'application/json,text/html,application/xml;q=0.9,*/*;q=0.8' };
function stripHtml(h) { return decode(String(h || '')).slice(0, 1500); }
function validBarcode(c) {
  c = String(c || '').replace(/\D/g, '');
  if ([8, 12, 13, 14].indexOf(c.length) < 0) return '';
  let sum = 0;
  for (let i = c.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += (+c[i]) * w;
  return (10 - sum % 10) % 10 === +c[c.length - 1] ? c : '';
}
function timedFetch(u, opts, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 7000);
  return fetch(u, Object.assign({}, opts || {}, { signal: ctl.signal })).finally(() => clearTimeout(t));
}
async function getJson(u) {
  try {
    const r = await timedFetch(u, { headers: UA, redirect: 'follow' });
    if (!r.ok || !/json/i.test(r.headers.get('content-type') || '')) return null;
    return await r.json();
  } catch (e) { return null; }
}
async function shopWines(params) {
  let site = (params.get('site') || '').trim().replace(/\/+$/, '');
  if (!site) return { error: 'No website given.' };
  if (!/^https?:\/\//i.test(site)) site = 'https://' + site;
  const origin = new URL(site).origin;
  const page = Math.max(0, parseInt(params.get('page') || '0', 10) || 0);
  const platform = params.get('platform') || '';

  /* Shopify publishes every product (with barcodes, when the shop has entered them) */
  if (!platform || platform === 'shopify') {
    const j = await getJson(origin + '/products.json?limit=250&page=' + (page + 1));
    if (j && Array.isArray(j.products)) {
      const items = j.products.filter(p => !NOT_WINE.test(p.title + ' ' + (p.product_type || ''))).map(p => {
        const v = (p.variants || [])[0] || {};
        return { name: p.title, price: v.price || '', barcode: validBarcode(v.barcode), img: ((p.images || [])[0] || {}).src || '',
          desc: stripHtml(p.body_html), link: origin + '/products/' + p.handle, kind: p.product_type || '' };
      });
      return { platform: 'shopify', items, more: j.products.length === 250 };
    }
    if (platform === 'shopify') return { platform: 'shopify', items: [], more: false };
  }
  /* WooCommerce's public store listing */
  if (!platform || platform === 'woo') {
    const j = await getJson(origin + '/wp-json/wc/store/v1/products?per_page=100&page=' + (page + 1));
    if (Array.isArray(j)) {
      const items = j.filter(p => !NOT_WINE.test(p.name + ' ' + ((p.categories || []).map(c => c.name).join(' ')))).map(p => {
        const pr = p.prices || {}, minor = +pr.currency_minor_unit || 2;
        return { name: decode(p.name), price: pr.price ? (+pr.price / Math.pow(10, minor)).toFixed(2) : '', barcode: validBarcode(p.sku),
          img: ((p.images || [])[0] || {}).src || '', desc: stripHtml(p.short_description || p.description), link: p.permalink || '',
          kind: (p.categories || []).map(c => c.name).join(' ') };
      });
      return { platform: 'woo', items, more: j.length === 100 };
    }
    if (platform === 'woo') return { platform: 'woo', items: [], more: false };
  }
  /* Anything else (Commerce7, Squarespace, WineDirect...): read product pages listed in the sitemap, 25 at a time */
  let urls = [];
  const seen = new Set();
  async function readMap(u, depth) {
    if (depth > 2 || urls.length > 600) return;
    try {
      const r = await fetch(u, { headers: UA, redirect: 'follow' });
      if (!r.ok) return;
      const xml = (await r.text()).slice(0, 2000000);
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decode(m[1]));
      if (/<sitemapindex/i.test(xml)) {
        for (const l of locs.filter(l => /product|wine|shop|store/i.test(l)).slice(0, 3)) await readMap(l, depth + 1);
      } else {
        locs.forEach(l => { if (/\/(product|products|wines?|shop|store)\/[^\/?#]+\/?$/i.test(l) && !seen.has(l)) { seen.add(l); urls.push(l); } });
      }
    } catch (e) { /* no sitemap */ }
  }
  await readMap(origin + '/sitemap.xml', 0);
  if (!urls.length) await readMap(origin + '/sitemap_index.xml', 0);
  urls = urls.filter(u => !NOT_WINE.test(u.replace(/[-_\/]/g, ' ')));
  const slice = urls.slice(page * 25, page * 25 + 25), items = [];
  for (const u of slice) {
    try {
      const m = await pageMeta(u);
      if (!m.title || NOT_WINE.test(m.title)) continue;
      items.push({ name: m.title, price: m.price || '', barcode: '', img: m.image || '', desc: m.description || '', link: m.url || u, kind: '' });
    } catch (e) { /* skip that page */ }
  }
  return { platform: urls.length ? 'sitemap' : 'none', items, more: urls.length > page * 25 + 25, total: urls.length };
}

/* ---------- OpenStreetMap: every mapped brewery, winery, cidery and distillery in a province, with addresses ----------
   Data © OpenStreetMap contributors, available under the Open Database Licence (ODbL). */
const US_ST = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
const OSM_PROV = { ON: 'CA-ON', BC: 'CA-BC', QC: 'CA-QC', AB: 'CA-AB', NS: 'CA-NS', NB: 'CA-NB', PE: 'CA-PE', SK: 'CA-SK', MB: 'CA-MB', NL: 'CA-NL', YT: 'CA-YT', NT: 'CA-NT', NU: 'CA-NU' };
const OVERPASS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function osmPlaces(prov) {
  const P = String(prov || '').toUpperCase().replace(/^US-/, ''); const iso = String(prov || '').toUpperCase().indexOf('US-') === 0 && US_ST.includes(P) ? 'US-' + P : OSM_PROV[P]; if (!iso) return { error: 'Unknown province or state (use US-MI for a US state)' };
  /* plain tag matches (much faster for OpenStreetMap than patterns), and only places that have a house number */
  const sel = ['["craft"="brewery"]', '["craft"="winery"]', '["craft"="distillery"]', '["craft"="cider"]', '["industrial"="brewery"]', '["industrial"="winery"]', '["industrial"="distillery"]', '["microbrewery"="yes"]'];
  const q = '[out:json][timeout:25];area["ISO3166-2"="' + iso + '"]->.p;(' + sel.map(t => 'nwr' + t + '["addr:housenumber"](area.p);').join('') + ');out center tags;';
  let j = null, last = '';
  for (const url of OVERPASS) {
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: Object.assign({}, UA, { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }), body: 'data=' + encodeURIComponent(q) });
      clearTimeout(timer);
      if (r.ok) { j = await r.json(); break; }
      last = (url.split('/')[2]) + ' said ' + r.status;
    } catch (e) { last = (url.split('/')[2]) + (e && e.name === 'AbortError' ? ' was too slow' : ' could not be reached'); }
  }
  if (!j) return { error: 'OpenStreetMap: ' + last + ' (' + prov + ')', places: [], mapped: 0 };
  const out = [];
  for (const e of j.elements || []) {
    const t = e.tags || {}, name = t.name || t['name:en'] || t.brand; if (!name) continue;
    const num = t['addr:housenumber'], street = t['addr:street'], city = t['addr:city'] || t['addr:place'] || '';
    if (!num || !street) continue;
    const unit = t['addr:unit'] ? t['addr:unit'] + '-' : '';
    const address = unit + num + ' ' + street + (city ? ', ' + city : '') + ', ' + prov.toUpperCase() + (t['addr:postcode'] ? ' ' + t['addr:postcode'].toUpperCase() : '');
    const lat = e.lat != null ? e.lat : (e.center && e.center.lat), lng = e.lon != null ? e.lon : (e.center && e.center.lon);
    out.push({ name, address, city, lat, lng, website: t.website || t['contact:website'] || '' });
  }
  return { source: 'openstreetmap', prov: prov.toUpperCase(), places: out, mapped: (j.elements || []).length };
}

/* ---------- Wine Growers of BC directory: name, town, address and exact spot for each winery ---------- */
async function wgbcPage(pg) {
  const html = await getHtml('https://winebc.com/wineries/?pg=' + Math.max(1, Math.min(60, pg)));
  if (!html) return { error: 'The Wine Growers of BC site didn\u2019t answer.' };
  const seen = new Map();
  /* each listing links to the winery's page and ends with "Town lat,lng" */
  const re = /<a[^>]+href=["'](https:\/\/winebc\.com\/winery\/[a-z0-9-]+\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1].replace(/\/?$/, '/'), text = textOf(m[2]).replace(/\s+/g, ' ').trim();
    const c = text.match(/(-?\d{2}\.\d{3,})\s*,\s*(-?\d{2,3}\.\d{3,})\s*$/);
    if (!c || seen.has(url)) continue;
    seen.set(url, { url, lat: +c[1], lng: +c[2] });
  }
  const list = [...seen.values()];
  await Promise.all(list.map(async w => {
    const h = await getHtml(w.url); if (!h) return;
    w.name = decode((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
    const loc = h.split(/>\s*Location\s*</i)[1] || '';
    const a = (loc.match(/<a[^>]*>([^<]{6,160})<\/a>/i) || [])[1] || '';
    w.address = decode(a).replace(/\s+/g, ' ').trim();
    const tel = (loc.match(/href=["']tel:([^"']+)/i) || [])[1]; if (tel) w.phone = decodeURIComponent(tel);
    const web = (loc.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*Visit Website/i) || [])[1]; if (web) w.website = web;
  }));
  return { page: pg, more: new RegExp('[?&]pg=' + (pg + 1) + '["\'&]').test(html), wineries: list.filter(w => w.name) };
}

/* ---------- a business's details, from its own website ---------- */
const PROV_RE = '(ON|BC|QC|NS|AB|MB|SK|NB|PE|PEI|NL|YT|NT|NU|Ontario|British Columbia|Quebec|Québec|Nova Scotia|Alberta|Manitoba|Saskatchewan|New Brunswick|Prince Edward Island|Newfoundland)';
function bizFromLd(html, base) {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m, best = null;
  while ((m = re.exec(html))) {
    let j; try { j = JSON.parse(m[1].trim()); } catch (e) { continue; }
    for (const it of [].concat(j && j['@graph'] ? j['@graph'] : j).flat()) {
      const type = [].concat((it && it['@type']) || []).join(' ');
      if (!/LocalBusiness|Winery|Brewery|Distillery|Restaurant|FoodEstablishment|Organization|Store|BarOrPub|TouristAttraction/i.test(type)) continue;
      const a = [].concat(it.address || [])[0] || {};
      const addr = typeof a === 'string' ? a : [a.streetAddress, a.addressLocality, [a.addressRegion, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const geo = it.geo || {};
      const cand = { name: decode(it.name || ''), address: decode(addr || ''), phone: String(it.telephone || ''),
        lat: +geo.latitude || null, lng: +geo.longitude || null,
        instagram: ([].concat(it.sameAs || []).find(u => /instagram\.com\//i.test(u)) || '') };
      if (!best || (cand.address && !best.address)) best = cand;
    }
  }
  return best;
}
/* ---- deeper address search on a business's own site ---- */
const STREET_WORDS = '(?:Road|Rd|Street|St|Avenue|Ave|Highway|Hwy|Drive|Dr|Line|Concession|Conc|Way|Boulevard|Blvd|Lane|Ln|Crescent|Cres|Parkway|Pkwy|Trail|Trl|Sideroad|Side Road|County Road|Regional Road|Court|Ct|Place|Pl|Terrace|Close|Gate|Square|Sq|Range|Rang|Rue|Chemin|Ch|Route|Rte|Boul|Montée|Rang)';
const PROV_ANY = '(?:ON|BC|QC|NS|AB|MB|SK|NB|PE|PEI|NL|YT|NT|NU|Ontario|British Columbia|Quebec|Québec|Nova Scotia|Alberta|Manitoba|Saskatchewan|New Brunswick|Prince Edward Island|Newfoundland(?: and Labrador)?|Yukon)';
const US_NAMES = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming';
const STATE_ANY = '(?:' + US_ST.join('|') + '|' + US_NAMES + ')';
function addrCandidates(html) {
  const out = [];
  const push = (a, score) => { a = decode(String(a || '')).replace(/\s+/g, ' ').replace(/\s*,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '').trim(); if (/\d/.test(a) && a.length >= 10 && a.length <= 160) out.push({ a, score }); };
  /* 1. structured data */
  const ld = bizFromLd(html, ''); if (ld && ld.address) push(ld.address, 10);
  /* 2. microdata / hCard */
  const ip = k => decode((html.match(new RegExp('itemprop=["\']' + k + '["\'][^>]*>([^<]{2,80})<', 'i')) || [])[1] || '');
  if (ip('streetAddress')) push([ip('streetAddress'), ip('addressLocality'), [ip('addressRegion'), ip('postalCode')].filter(Boolean).join(' ')].filter(Boolean).join(', '), 9);
  const hc = k => decode((html.match(new RegExp('class=["\'][^"\']*\\b' + k + '\\b[^"\']*["\'][^>]*>([^<]{2,80})<', 'i')) || [])[1] || '');
  if (hc('street-address')) push([hc('street-address'), hc('locality'), [hc('region'), hc('postal-code')].filter(Boolean).join(' ')].filter(Boolean).join(', '), 8);
  /* 3. "get directions" links to a map, which often spell out the address */
  const mapRe = /href=["'](https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com)[^"']*)["']/gi; let m;
  while ((m = mapRe.exec(html))) {
    try { const u = new URL(decode(m[1])); const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('daddr') || u.searchParams.get('destination') || u.searchParams.get('address') || (u.pathname.match(/\/maps\/(?:place|search|dir)\/(?:[^/]*\/)?([^/@]+)/) || [])[1] || '';
      const t = decodeURIComponent(q.replace(/\+/g, ' ')); if (/^\d/.test(t.trim())) push(t, 7); } catch (e) {}
  }
  /* 4. written in the page */
  const text = textOf(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ', ').replace(/<\/(p|div|li|span|h\d)>/gi, ', '));
  const withPostal = new RegExp('\\b\\d{1,6}[A-Za-z]?(?:-\\d+)?\\s+[\\w .\'#-]{2,60}?,\\s*[A-Za-zÀ-ÿ .\'-]{2,40},?\\s*' + PROV_ANY + '\\.?,?\\s*[A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d', 'gi');
  (text.match(withPostal) || []).slice(0, 3).forEach(a => push(a, 6));
  const withProv = new RegExp('\\b\\d{1,6}(?:-\\d+)?\\s+(?:[\\w .\'-]{1,40}?\\s)?' + STREET_WORDS + '\\.?(?:\\s+\\d{1,4}[A-Z]?)?(?:\\s+(?:N|S|E|W|North|South|East|West))?\\s*,\\s*[A-Za-zÀ-ÿ .\'-]{2,40},?\\s*' + PROV_ANY + '\\b', 'gi');
  (text.match(withProv) || []).slice(0, 3).forEach(a => push(a, 5));
  /* US: "123 Main St, Town, MI 49615" (with a ZIP), or a state without one */
  const withZip = new RegExp('\\b\\d{1,6}[A-Za-z]?(?:-\\d+)?\\s+[\\w .\'#-]{2,60}?,\\s*[A-Za-z .\'-]{2,40},?\\s*' + STATE_ANY + '\\.?,?\\s*\\d{5}(?:-\\d{4})?\\b', 'g');
  (text.match(withZip) || []).slice(0, 3).forEach(a => push(a, 6));
  const withState = new RegExp('\\b\\d{1,6}(?:-\\d+)?\\s+(?:[\\w .\'-]{1,40}?\\s)?' + STREET_WORDS + '\\.?(?:\\s+(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West))?\\s*,\\s*[A-Za-z .\'-]{2,40},?\\s*' + STATE_ANY + '\\b', 'g');
  (text.match(withState) || []).slice(0, 3).forEach(a => push(a, 5));
  return out;
}
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-CA,en-US;q=0.9,en;q=0.8,fr-CA;q=0.6' };
async function getPage(u, stats) {
  try {
    const r = await timedFetch(u, { headers: BROWSER, redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && (!ct || /html|text/i.test(ct))) { const t = await r.text(); if (t && t.length > 200) { stats.ok++; return t.slice(0, 800000); } }
    if (r.status === 403 || r.status === 429 || r.status === 503) stats.blocked++;
  } catch (e) { stats.failed++; }
  return '';
}
/* 2. if a site turns us away, read it through a reading service that fetches pages like a person would (r.jina.ai, free; a READER_KEY raises its limits) */
async function readerPage(u, stats) {
  try {
    const h = { 'Accept': 'text/plain', 'X-Return-Format': 'html' };
    if (globalThis.__env && globalThis.__env.READER_KEY) h.Authorization = 'Bearer ' + globalThis.__env.READER_KEY;
    const r = await timedFetch('https://r.jina.ai/' + u, { headers: h });
    if (!r.ok) { stats.readerFail++; return ''; }
    const t = await r.text(); if (t && t.length > 200) { stats.reader++; return t.slice(0, 800000); }
  } catch (e) { stats.readerFail++; }
  return '';
}
async function placeInfo(url) {
  if (!/^https?:\/\//i.test(url)) return { error: 'Give a full web address.' };
  const origin = new URL(url).origin;
  const stats = { ok: 0, blocked: 0, failed: 0, reader: 0, readerFail: 0 };
  let home = await getPage(origin + '/', stats) || await getPage(url, stats);
  if (!home) home = await readerPage(origin + '/', stats);
  if (!home) return { found: false, error: 'The website didn\u2019t answer.', stats, deep: 3 };
  const out = bizFromLd(home, origin) || {};
  let cands = addrCandidates(home), pagesRead = 1;
  /* not on the home page: look at the pages where businesses put their address */
  if (!cands.some(c => c.score >= 6)) {
    const want = /contact|visit|location|find-?us|directions|getting-?here|hours|about|our-story|story|tasting|plan-your|map|reach|where|info|faq/i;
    const links = new Set();
    const re = /href=["']([^"'#]+)["']/gi; let m;
    while ((m = re.exec(home))) { try { const u = new URL(decode(m[1]), origin); if (u.origin === origin && want.test(u.pathname)) links.add(u.origin + u.pathname); } catch (e) {} }
    ['/contact', '/contact-us', '/visit', '/visit-us', '/location', '/locations', '/find-us', '/about', '/about-us', '/pages/contact', '/pages/visit-us']
      .forEach(p => { if (links.size < 6) links.add(origin + p); });
    const pages = [...links].sort((a, b) => (/contact|visit|location|find/i.test(b) ? 1 : 0) - (/contact|visit|location|find/i.test(a) ? 1 : 0)).slice(0, 6);
    let htmls = await Promise.all(pages.map(p => getPage(p, stats)));
    pagesRead += htmls.filter(Boolean).length;
    /* the site blocked its inner pages: try the two most likely ones through the reader */
    if (!htmls.some(Boolean)) { const two = pages.filter(p => /contact|visit|location|find/i.test(p)).slice(0, 2); const rd = await Promise.all(two.map(p => readerPage(p, stats))); htmls = htmls.concat(rd); pagesRead += rd.filter(Boolean).length; }
    for (const h of htmls) { if (!h) continue; cands = cands.concat(addrCandidates(h)); const ld2 = bizFromLd(h, origin); if (ld2 && !out.lat && ld2.lat) { out.lat = ld2.lat; out.lng = ld2.lng; } }
  }
  cands.sort((a, b) => b.score - a.score);
  if (cands.length) { out.address = cands[0].a; out.via = ({ 10: 'site data', 9: 'address fields', 8: 'address fields', 7: 'directions link', 6: 'page text', 5: 'page text' })[cands[0].score] || 'page'; }
  out.pagesRead = pagesRead; out.deep = 3; out.stats = stats;
  if (!out.name) out.name = decode((home.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || [])[1] || (home.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').split(/\s[|\u2013\u2014-]\s/)[0].trim();
  if (!out.phone) { const t = (home.match(/href=["']tel:([^"']+)/i) || [])[1]; if (t) out.phone = decodeURIComponent(t).replace(/^\+?1[\s.-]?/, ''); }
  if (!out.instagram) { const ig = home.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i); if (ig && !IG_SKIP.test(ig[1])) out.instagram = ig[1]; }
  else out.instagram = (String(out.instagram).match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i) || [])[1] || '';
  out.website = origin + '/';
  out.found = !!(out.name || out.address);
  return out;
}

/* ---------- a place's own website ---------- */
const NOT_OWN_SITE = /(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|pinterest|linkedin|tripadvisor|yelp|wikipedia|google|goo|untappd|ratebeer|beeradvocate|vivino|wine-searcher|cellartracker|lcbo|saq|bcliquorstores|nslc|opentable|exploretock|tock|resy|sevenrooms|eventbrite|showpass|mapquest|yellowpages|canada411|411|foursquare|winecountryontario|bcaletrail|ontariocraftbrewers|ontariocidertrail|cidercanada|winebc|winesofcanada|canadabeermap|blogto|narcity|toronto|destinationontario|visitniagaracanada|niagaracanada|thebeerstore|beerstore|amazon|uber|doordash|skipthedishes|grubhub|groupon|reddit|medium|wordpress\.com|blogspot|wixsite|squarespace\.com|tourism|travel|visit[a-z]*|hellobc|ontariotravel|explore[a-z]*)\./i;
async function findSite(params, env) {
  const name = params.get('name') || '', town = params.get('town') || '', st = params.get('st') || '', ctry = params.get('ctry') || '';
  const nameW = keyWords(name);
  if (!nameW.length) return { found: false };
  const results = await search([name, town, st].filter(Boolean).join(' ') + ' official website', env, ctry);
  const ranked = results.map(r => {
    const host = hostOf(r.url);
    if (!host || NOT_OWN_SITE.test(host) || (/\.(gov|gc)\.ca$/.test(host) || /\.gov$/.test(host))) return null;
    const flat = host.replace(/[^a-z0-9]/g, '');
    const inHost = nameW.filter(w => flat.includes(w)).length;
    const hay = norm(r.title + ' ' + r.snippet);
    const inText = nameW.filter(w => (' ' + hay + ' ').includes(' ' + w + ' ')).length;
    if (!inHost && inText < Math.min(2, nameW.length)) return null;
    let sc = inHost * 5 + inText * 2;
    if (town && norm(r.title + ' ' + r.snippet).includes(norm(town).split(' ')[0])) sc += 1;
    if ((new URL(r.url).pathname.split('/').filter(Boolean).length) <= 1) sc += 1;
    return { url: r.url, host, inHost, sc };
  }).filter(Boolean).sort((a, b) => b.sc - a.sc);
  /* open the best candidates and make sure the site is really this place */
  for (const c of ranked.slice(0, 3)) {
    const origin = new URL(c.url).origin + '/';
    const html = await getHtml(origin) || await getHtml(c.url);
    if (!html) continue;
    const head = norm(textOf((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') + ' ' +
      ((html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || [])[1] || '') + ' ' +
      textOf(html.slice(0, 120000)).slice(0, 4000));
    const hits = nameW.filter(w => (' ' + head + ' ').includes(' ' + w + ' ') || c.host.replace(/[^a-z0-9]/g, '').includes(w)).length;
    if (hits >= Math.min(2, nameW.length) || (c.inHost && hits >= 1)) {
      return { found: true, url: origin, confident: c.inHost > 0 && hits >= Math.min(2, nameW.length) || hits >= Math.min(3, nameW.length + 1) || (c.inHost >= Math.min(2, nameW.length)) };
    }
  }
  return { found: false };
}

/* ---------- Instagram handles ---------- */
const IG_SKIP = /^(p|reel|reels|explore|stories|tv|accounts|about|developer|legal|direct|web|sharer|share|tag|tags|location|locations|instagram|privacy)$/i;
function igFromHref(h) {
  const m = String(h).match(/instagram\.com\/([A-Za-z0-9_.]{2,30})(?:[\/?#"'\s<]|$)/i);
  if (!m || IG_SKIP.test(m[1])) return '';
  return m[1].replace(/\.+$/, '').toLowerCase();
}
async function findInsta(params, env) {
  const name = params.get('name') || '', town = params.get('town') || '', st = params.get('st') || '', ctry = params.get('ctry') || '';
  let site = (params.get('site') || '').trim();
  const nameW = keyWords(name);
  /* 1. the place's own website almost always links its Instagram, and that link is the most reliable */
  if (site) {
    if (!/^https?:\/\//i.test(site)) site = 'https://' + site;
    try {
      const r = await fetch(site, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FatRasinWineHelper/1.0)', 'Accept': 'text/html' }, redirect: 'follow' });
      if (r.ok && /html/i.test(r.headers.get('content-type') || '')) {
        const html = (await r.text()).slice(0, 800000);
        const counts = {};
        (html.match(/instagram\.com\/[A-Za-z0-9_.]{2,30}[\/?#"'\s<]/gi) || []).forEach(x => {
          const h = igFromHref(x);
          if (h) counts[h] = (counts[h] || 0) + 1;
        });
        const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        if (best) return { found: true, handle: best, source: 'website', confident: true };
      }
    } catch (e) { /* site unreachable: fall back to a search */ }
  }
  /* 2. a web search for the place's Instagram page */
  if (!env.SEARCH_KEY) return { found: false, error: 'No search key on the helper.' };
  const results = await search([name, town, st, 'instagram'].filter(Boolean).join(' '), env, ctry);
  for (const r of results) {
    const h = igFromHref(r.url + '/');
    if (!h) continue;
    const flat = h.replace(/[^a-z0-9]/g, '');
    const hay = norm(r.title + ' ' + r.snippet);
    const hits = nameW.filter(w => flat.includes(w) || (' ' + hay + ' ').includes(' ' + w + ' ')).length;
    if (nameW.length && hits === 0) continue;
    return { found: true, handle: h, source: 'search', confident: hits >= Math.min(2, nameW.length) || flat.includes(nameW.join('')), title: r.title };
  }
  return { found: false };
}

/* ---------- reading a product page ---------- */
function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018')
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
function attrs(tag) {
  const out = {};
  tag.replace(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (m, k, _v, a, b, c) => {
    out[k.toLowerCase()] = a !== undefined ? a : b !== undefined ? b : c;
    return m;
  });
  return out;
}
function parsePage(html, url) {
  html = html.slice(0, 800000);
  const meta = {};
  (html.match(/<meta\b[^>]*>/gi) || []).forEach(t => {
    const a = attrs(t);
    const k = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (k && a.content && !(k in meta)) meta[k] = decode(a.content);
  });
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let product = null;
  const ldRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while (!product && (m = ldRe.exec(html))) {
    try {
      const j = JSON.parse(m[1].trim());
      const list = [].concat(j && j['@graph'] ? j['@graph'] : j).flat();
      for (const it of list) {
        const type = [].concat((it && it['@type']) || []).join(' ');
        if (/Product/i.test(type)) { product = it; break; }
      }
    } catch (e) { /* not valid JSON, skip */ }
  }
  const pickImg = v => !v ? '' : typeof v === 'string' ? v : Array.isArray(v) ? pickImg(v[0]) : (v.url || v.contentUrl || '');
  let offer = product && product.offers;
  offer = Array.isArray(offer) ? offer[0] : offer;
  if (offer && offer.offers) offer = [].concat(offer.offers)[0];
  const abs = x => { try { return x ? new URL(x, url).href : ''; } catch (e) { return ''; } };
  const price = (offer && (offer.price || offer.lowPrice)) || meta['product:price:amount'] || meta['og:price:amount'] || '';
  return {
    url: abs(meta['og:url']) || url,
    title: decode((product && product.name) || meta['og:title'] || (titleM && titleM[1]) || ''),
    image: abs(pickImg(product && product.image) || meta['og:image'] || meta['og:image:url'] || meta['twitter:image']),
    description: decode((product && product.description) || meta['og:description'] || meta.description || '').slice(0, 1200),
    price: price ? String(price).replace(/[^\d.]/g, '') : '',
    currency: (offer && offer.priceCurrency) || meta['product:price:currency'] || meta['og:price:currency'] || '',
    site: decode(meta['og:site_name'] || hostOf(url)),
    isProduct: !!product || /product/i.test(meta['og:type'] || '') || !!meta['product:price:amount']
  };
}
async function pageMeta(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FatRasinWineHelper/1.0; +wine lookups)',
      'Accept': 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });
  if (!r.ok) throw new Error('That page answered ' + r.status);
  const type = r.headers.get('content-type') || '';
  if (!/html/i.test(type)) throw new Error('That link isn\u2019t a web page.');
  return parsePage(await r.text(), r.url || url);
}

/* ===================== automatic weekly events (Cloudflare Cron Trigger) =====================
   Every run reads FatRaisin's list of places from Firebase, checks a small batch of websites for events
   (and once a week the Wine Country Ontario listings), and saves new events to Firebase for everyone.
   Needs two settings on the Worker: GCP_SA_KEY (the Firebase service account key, as a secret) and a Cron Trigger. */
const CRON_CALS = [
  { name: 'Ohio Wines', url: 'https://www.ohiowines.org/events', st: 'OH' },
  { name: 'Brewers of Indiana Guild', url: 'https://drinkin.beer/events/', st: 'IN' }
];
const CRON = { sitesPerRun: 5, pagesPerSite: 2, ticketsPerSite: 4, wcoDetails: 32, wcoPages: 10 };
function b64url(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + b64url(sig) });
  const j = await r.json(); if (!j.access_token) throw new Error('Google sign-in failed: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
/* Firestore's typed values <-> plain values */
function fromFs(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return +v.integerValue; if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue; if ('nullValue' in v) return null;
  if ('mapValue' in v) { const o = {}; const f = v.mapValue.fields || {}; for (const k in f) o[k] = fromFs(f[k]); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  return null;
}
function toFs(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'string') return { stringValue: x }; if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toFs) } };
  const f = {}; for (const k in x) f[k] = toFs(x[k]); return { mapValue: { fields: f } };
}
/* the same rules the app uses: an event ID, the event type, and what doesn't count as an event */
function stableId(prefix, a, b) { const str = (a || '') + '|' + (b || ''); let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return prefix + Math.abs(h).toString(36); }
const ROUTINE = new Set(('lunch lunches dinner dinners brunch breakfast supper happy hour hours tasting tastings open opening opens now closed close reservation reservations reserve book booking seating seatings service services menu menus daily weekly nightly every day days weekend weekends weekday weekdays patio restaurant bistro kitchen terrace room dining dine cafe bar lounge wine wines flight flights tour tours takeout pickup curbside shop store retail boutique winery brewery taproom cidery distillery cellar door available special specials regular hours of at in on our the with and a an for to from all a la carte monday tuesday wednesday thursday friday saturday sunday mondays tuesdays wednesdays thursdays fridays saturdays sundays season seasonal summer fall winter spring live music musician musicians musical acoustic unplugged band bands dj djs tunes jam jams session sessions songs local entertainment performance performances performer series concert concerts night nights afternoon afternoons evening evenings weekend featuring presents vibes sounds sound').split(' '));
const NOT_EVENT = /\b(closed|closure|closures|closing early|close early|closes early|private (event|events|function|party|parties|booking|bookings|rental)|privately booked|buy-?out|we(\u2019|')?re closed|we are closed|holiday hours|hours (change|update)|reduced hours|no (service|tastings?)|karaoke|bingo|trivia|euchre|quiz night|pub quiz|cribbage|crib night|poker|game night|games night)\b/i;
function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
/* everyday goings-on rather than special events: games and sports nights, weekly drink and food deals, exercise and
   hobby clubs, opening-hours notices and anything named after a day of the week ("Thirsty Thursday", "Mahjong Mondays") */
const CASUAL_EVENT = /\b(trivia|thrivia|bingo|singo|karaoke|mah ?jongg?|euchre|cribbage|bunco|poker|chess|jeopardy|feud|cornhole|darts?|board games?|game night|games night|bar league|league night|leagues?|run club|running club|bike night|ride night|yoga|pilates|zumba|line danc\w*|dance (night|lessons?|class)|open mic|jam session|old time jam|football|nfl|ncaa|game ?day|watch party|ufc|super bowl|world series|march madness|playoffs?|happy hour|hoppy hour|happiest hour|pint night|wing night|wings|burger night|burger and pint|tacos?|pizza night|prime rib|food trucks?|drink specials?|specials?|bogo|half price|half off|\d+ ?% off|\$ ?\d+ off|off wine|industry (night|day)|mug club|members? only|member (mondays?|day)|senior day|teacher|neighbou?rhood night|ladies night|college night|(tap ?room|tasting room|gift shop|kitchen) open|hours|kid(\u2019|')?s meals?|public hours|open (at )?(noon|\d)|reservations?|sold out|admission|farmers market|knitting|stitch|book club|vinyl|turntable|story ?time|sunday funday|case sale|pop-?up|(mon|tues|wednes|thurs|fri|satur|sun)days)\b/i;
const HOLIDAY_ONLY = /^\W*(happy |merry )?(thanksgiving|christmas eve|christmas|new year(’|')?s (eve|day)|black friday|small business saturday|cyber monday|easter|halloween)( day)?\W*$/i;
function isRoutine(title, place) {
  if (NOT_EVENT.test(String(title || '')) || CASUAL_EVENT.test(String(title || '')) || HOLIDAY_ONLY.test(String(title || ''))) return true;
  /* named after one day of the week ("Fireside Friday"), unless it is clearly a one-off such as a release, dinner or market */
  if(/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i.test(String(title||''))&&!/release|dinner|festival|fest\b|market|santa|anniversary|gala|pairing|party|celebration|launch|black friday|small business saturday/i.test(String(title||'')))return true;
  const t = fold(title); if (!t) return true;
  const p = new Set(fold(place).split(' '));
  const words = t.split(' ').filter(w => !/^\d+(am|pm)?$/.test(w));
  return !words.length || words.every(w => ROUTINE.has(w) || p.has(w));
}
function evType(t) {
  t = String(t || '').toLowerCase();
  if (/dinner|brunch|lunch|feast|supper|long table|bbq|barbecue|pig roast/.test(t)) return 'Dinner';
  if (/music|concert|jazz|band|\blive\b|\bdj\b|acoustic|singer|songwriter|bluegrass|blues/.test(t)) return 'Live music';
  if (/release|launch|unveil|debut|futures/.test(t)) return 'Release';
  if (/harvest|grape stomp|stomp|crush|picking/.test(t)) return 'Harvest';
  if (/class|workshop|yoga|paint|course|seminar|lesson|masterclass|school/.test(t)) return 'Class';
  if (/tasting|flight|pairing|tour|sip|vertical|cellar/.test(t)) return 'Tasting';
  return 'Other';
}
function eventDoc(place, pid, x, idSeed) {
  const start = String(x.start || ''), date = (start.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0]; if (!date) return null;
  const today = new Date().toISOString().slice(0, 10), limit = new Date(Date.now() + 366 * 864e5).toISOString().slice(0, 10);
  if (date < today || date > limit) return null;
  const title = decode(x.title || '').replace(/\s+/g, ' ').trim(); if (title.length < 3 || isRoutine(title, place.n)) return null;
  if (/\b(closed to the public|closed for (a )?private|private event)\b/i.test(String(x.desc || ''))) return null;
  const tm = start.match(/[T ](\d{2}):(\d{2})/) || [], time = (!x.allDay && tm[1] && !(tm[1] === '00' && tm[2] === '00')) ? tm[1] + ':' + tm[2] : '';
  let desc = decode(x.desc || '').replace(/\s+/g, ' ').trim();
  if (x.cost && !/free|^\$?0+(\.0+)?$/i.test(x.cost)) desc = (desc ? desc + ' ' : '') + 'Tickets: ' + (/^\d/.test(x.cost) ? '$' : '') + x.cost + '.';
  const tix = /^https?:/.test(x.tickets || '') ? x.tickets : (/eventbrite\.|exploretock\.com|showpass\.com|tixr\.com|universe\.com|ticketmaster\.|zeffy\.com|ticketleap|tickettailor\.com/i.test(x.url || '') ? x.url : '');
  const d = { wid: pid || '', wname: (place.n || '').slice(0, 120), title: title.slice(0, 140), date, type: evType(title + ' ' + desc), src: idSeed === 'wco' ? 'wco' : 'web', updated: Date.now() };
  if (time) d.time = time; if (desc) d.desc = desc.slice(0, 800);
  if (/^https?:/.test(x.url || '')) d.link = x.url.slice(0, 500); else if (place.w) d.link = place.w;
  if (tix) d.ticketLink = tix.slice(0, 500); if (x.cost) d.cost = String(x.cost).slice(0, 40); if (place.p) d.prov = place.p;
  const id = (idSeed === 'wco' && !pid) ? 'x' + stableId('wco', String(x.url || title + date)) : 'x' + stableId(pid, title.toLowerCase() + '|' + date);
  return { id, d };
}
async function runCron(env) {
  if (!env.GCP_SA_KEY) return { skipped: 'no GCP_SA_KEY' };
  const sa = JSON.parse(env.GCP_SA_KEY), project = env.FIREBASE_PROJECT || sa.project_id;
  const base = 'https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents/';
  const token = await googleToken(sa), auth = { Authorization: 'Bearer ' + token };
  const get = async path => { const r = await fetch(base + path, { headers: auth }); if (!r.ok) return null; const j = await r.json(); const o = {}; for (const k in (j.fields || {})) o[k] = fromFs(j.fields[k]); return o; };
  const idx = (await get('shared/index')) || {}, state = (await get('shared/eventcron')) || {};
  let places = idx.places || {};
  if (typeof idx.placesJson === 'string') {
    /* the place list is split across shared/index, index_1, index_2... (Firestore allows 1 MB per document) */
    let txt = idx.placesJson;
    for (let k = 1; k < (+idx.parts || 1); k++) { const more = await get('shared/index_' + k); txt += (more && more.placesJson) || ''; }
    try { places = JSON.parse(txt) || {}; } catch (e) { places = {}; }
  }
  const writes = [], add = (id, d) => writes.push({ update: { name: 'projects/' + project + '/databases/(default)/documents/events/' + id, fields: toFs(d).mapValue.fields } });
  let mode, cursor = +state.cursor || 0, found = 0;
  const weekAgo = Date.now() - 7 * 864e5;
  if (!(+state.lastWco > weekAgo)) {
    /* once a week: Wine Country Ontario's own event listings */
    mode = 'wco';
    const r = await wcoEvents(CRON.wcoDetails, CRON.wcoPages);
    const byName = {}; for (const id in places) { const n = fold(places[id].n); if (n) byName[n] = id; }
    for (const x of r.events || []) {
      let pid = '', wn = fold(x.winery);
      for (const n in byName) { if (n.length >= 5 && (wn.includes(n) || n.includes(wn) && wn.length >= 5 || fold(x.title).includes(n))) { pid = byName[n]; break; } }
      const place = pid ? places[pid] : { n: x.winery || 'Wine Country Ontario', p: 'ON' };
      const e = eventDoc(Object.assign({ p: 'ON' }, place), pid, x, 'wco'); if (e) { add(e.id, e.d); found++; }
    }
    /* the same weekly run reads the US state association calendars (keep this list in step with EV_CALS in the app) */
    for (const c of CRON_CALS) {
      try {
        const rc = await calEvents(c.url);
        const inState = {}; for (const id in places) { if (places[id].p === c.st) { const n = fold(places[id].n); if (n) inState[n] = id; } }
        for (const x of rc.events || []) {
          let pid = '', wn = fold(x.winery);
          for (const n in inState) { if (n.length >= 5 && ((wn && (wn.includes(n) || (n.includes(wn) && wn.length >= 5))) || fold(x.title).includes(n))) { pid = inState[n]; break; } }
          const place = pid ? places[pid] : { n: x.winery || c.name, p: c.st };
          const e = eventDoc(Object.assign({ p: c.st }, place), pid, x, 'cal');
          if (e) { if (!pid) e.id = 'x' + stableId('cal' + c.st, String(x.url || x.title + x.start)); e.d.src = 'cal'; add(e.id, e.d); found++; }
        }
      } catch (e) { /* one calendar failing never stops the run */ }
    }
    state.lastWco = Date.now();
  } else {
    /* every other run: the next few places' websites */
    mode = 'sites';
    const withSite = Object.keys(places).filter(id => places[id].w).sort();
    if (withSite.length) {
      if (cursor >= withSite.length) cursor = 0;
      const batch = withSite.slice(cursor, cursor + CRON.sitesPerRun); cursor += batch.length;
      for (const pid of batch) {
        const place = places[pid];
        try {
          const r = await siteEvents(new URLSearchParams({ site: place.w }), { pages: CRON.pagesPerSite, tickets: CRON.ticketsPerSite });
          for (const x of r.events || []) { const e = eventDoc(place, pid, x, 'site'); if (e) { add(e.id, e.d); found++; } }
        } catch (e) { /* one slow or broken site never stops the run */ }
      }
    }
  }
  state.cursor = cursor; state.lastRun = Date.now(); state.lastMode = mode; state.lastFound = found;
  writes.push({ update: { name: 'projects/' + project + '/databases/(default)/documents/shared/eventcron', fields: toFs(state).mapValue.fields } });
  const r = await fetch(base.replace(/documents\/$/, 'documents:commit'), { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), body: JSON.stringify({ writes: writes.slice(0, 500) }) });
  if (!r.ok) throw new Error('Saving to Firebase failed: ' + (await r.text()).slice(0, 200));
  return { mode, found, cursor };
}

export { siteEvents, eventDoc, calEvents, fold, isRoutine, wcoEvents };

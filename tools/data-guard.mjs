#!/usr/bin/env node
/* Data guard: keeps removed places out of the app's files for good.

   When a place is removed it goes on SEED_REMOVED (in place-lists.js). This tool makes sure that:
   - its row is gone from places-us.js / places-ca.js (otherwise anyone opening the app fresh still sees it),
   - its leftover entries are gone from the name-keyed lists (Instagram, booking links...) and from place-media.js,
   - SEED_VERSION (place-lists.js) and FR_DV (data-version.js) are equal, and are bumped when anything changed,
     so every phone picks up the new files.

   With --shared it also reads the app's shared online data (Firebase, readable without signing in): places marked
   closed there (including ones the owner deleted in the app) are taken out of the files and added to SEED_REMOVED.

   Run it before committing data changes:  node tools/data-guard.mjs
   It also runs on GitHub after every change to these files (.github/workflows/data-guard.yml) and commits any fix.
   Prints what it did; changes nothing when everything is already in order. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
let sharedChanged = false; const sharedReport = [];

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const P = f => path.join(root, f);
const load = (file, ctx) => { vm.runInNewContext(fs.readFileSync(P(file), 'utf8'), ctx); return ctx; };

/* places marked closed in the shared online data: taken out of the files too (only with --shared) */
if (process.argv.includes('--shared')) {
  try {
    const html = fs.readFileSync(P('index.html'), 'utf8');
    const proj = (/projectId\\?"?\s*:\s*\\?"([a-z0-9-]+)/.exec(html) || [])[1];
    const base = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/shared/`;
    const get = async doc => { const r = await fetch(base + doc); if (!r.ok) throw new Error(doc + ' ' + r.status); return (await r.json()).fields || {}; };
    const f0 = await get('pins');
    let txt = (f0.pinsJson || {}).stringValue || '{}';
    const parts = +((f0.parts || {}).integerValue || 1);
    for (let k = 1; k < parts; k++) txt += ((await get('pins_' + k)).pinsJson || {}).stringValue || '';
    const pins = JSON.parse(txt);
    const closedIds = new Set(Object.keys(pins).filter(id => pins[id] && pins[id].hc));
    if (closedIds.size) {
      const rowsByName = {}, hits = [];
      for (const f of ['places-us.js', 'places-ca.js']) {
        const c = { window: {} }; load(f, c); const d = c.window.FR_DATA;
        for (const r of (d.US || []).concat(d.CA || [])) { rowsByName[r[0]] = (rowsByName[r[0]] || 0) + 1; if (closedIds.has(r[10])) hits.push(r); }
      }
      if (hits.length) {
        /* drop those exact rows; put the name on the removed list only when no other place shares it */
        for (const f of ['places-us.js', 'places-ca.js']) {
          const ids = new Set(hits.map(r => r[10]));
          const lines = fs.readFileSync(P(f), 'utf8').split('\n');
          const out = lines.filter(ln => { if (!/^\s*,?\s*\[\s*"/.test(ln)) return true; try { return !ids.has(JSON.parse(ln.replace(/^\s*,\s*/, '').replace(/,\s*$/, ''))[10]); } catch (e) { return true; } });
          if (out.length !== lines.length) { const t = out.join('\n').replace(/,(\s*)\n\];/, '$1\n];').replace(/\[\n,/, '[\n'); vm.runInNewContext(t, { window: {} }); fs.writeFileSync(P(f), t); }
        }
        const names = hits.filter(r => rowsByName[r[0]] === 1).map(r => r[0]);
        if (names.length) {
          const lt = fs.readFileSync(P('place-lists.js'), 'utf8').split('\n');
          for (let i = 0; i < lt.length; i++) {
            const m = /^"SEED_REMOVED":(.*?)(,?)$/.exec(lt[i]); if (!m) continue;
            const arr = JSON.parse(m[1]); names.forEach(n => { if (!arr.includes(n)) arr.push(n); });
            lt[i] = `"SEED_REMOVED":${JSON.stringify(arr)}${m[2]}`;
          }
          fs.writeFileSync(P('place-lists.js'), lt.join('\n'));
        }
        sharedChanged = true;
        sharedReport.push(`shared data: took ${hits.length} place(s) marked closed or deleted in the app out of the files (${hits.slice(0, 5).map(r => r[0]).join(', ')}${hits.length > 5 ? ', ...' : ''})`);
      }
    }
  } catch (e) { sharedReport.push('shared data: could not read it this time (' + e.message + '); nothing changed from it'); }
}

const listsCtx = load('place-lists.js', { window: {} });
const lists = listsCtx.window.FR_DATA.lists;
const removed = new Set(lists.SEED_REMOVED || []);
const report = sharedReport;
let dataChanged = sharedChanged;

/* 1. place rows */
for (const f of ['places-us.js', 'places-ca.js']) {
  if (!fs.existsSync(P(f))) continue;
  const lines = fs.readFileSync(P(f), 'utf8').split('\n');
  const out = []; const gone = [];
  for (const ln of lines) {
    if (/^\s*,?\s*\[\s*"/.test(ln)) {
      let row = null;
      try { row = JSON.parse(ln.replace(/^\s*,\s*/, '').replace(/,\s*$/, '')); } catch (e) { row = null; }
      if (row && removed.has(row[0])) { gone.push(row[0]); continue; }
    }
    out.push(ln);
  }
  if (gone.length) {
    let txt = out.join('\n').replace(/,(\s*)\n\];/, '$1\n];').replace(/\[\n,/, '[\n');
    vm.runInNewContext(txt, { window: {} });            // still valid JavaScript?
    fs.writeFileSync(P(f), txt);
    dataChanged = true;
    report.push(`${f}: removed ${gone.length} place(s) on the removed list (${gone.slice(0, 5).join(', ')}${gone.length > 5 ? ', ...' : ''})`);
  }
}

/* 2. name-keyed lists in place-lists.js (one "KEY":value line each) */
const SKIP = new Set(['SEED_REMOVED', 'SEED_ID_MOVES', 'SEED_FIX_IDS', 'PHOTO_REMOVED', 'ALWAYS_REMOVE', 'SEED_VERSION', 'ADDR_CORRECT_VER']);
{
  const lines = fs.readFileSync(P('place-lists.js'), 'utf8').split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = /^"([A-Za-z0-9_]+)":(.*?)(,?)$/.exec(lines[i]);
    if (!m || SKIP.has(m[1])) continue;
    let v; try { v = JSON.parse(m[2]); } catch (e) { continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const drop = Object.keys(v).filter(k => removed.has(k));
    if (!drop.length) continue;
    drop.forEach(k => delete v[k]);
    lines[i] = `"${m[1]}":${JSON.stringify(v)}${m[3]}`;
    changed = true;
    report.push(`place-lists.js ${m[1]}: dropped ${drop.length} entr${drop.length === 1 ? 'y' : 'ies'} for removed places`);
  }
  if (changed) { const txt = lines.join('\n'); vm.runInNewContext(txt, { window: {} }); fs.writeFileSync(P('place-lists.js'), txt); dataChanged = true; }
}

/* 3. place-media.js (photos, logos, hours, tags keyed by name) */
if (fs.existsSync(P('place-media.js'))) {
  const txt = fs.readFileSync(P('place-media.js'), 'utf8');
  const nl = txt.indexOf('\n');
  const head = txt.slice(0, nl + 1), body = txt.slice(nl + 1);
  const m = /^window\.FR_MEDIA=([\s\S]*?);?\s*$/.exec(body);
  if (m) {
    const media = JSON.parse(m[1]); let n = 0;
    for (const k of Object.keys(media)) {
      if (!media[k] || typeof media[k] !== 'object') continue;
      for (const name of Object.keys(media[k])) if (removed.has(name)) { delete media[k][name]; n++; }
    }
    if (n) {
      const semi = /;\s*$/.test(body) ? ';' : '';
      fs.writeFileSync(P('place-media.js'), head + 'window.FR_MEDIA=' + JSON.stringify(media) + semi + (body.endsWith('\n') ? '\n' : ''));
      dataChanged = true;
      report.push(`place-media.js: dropped ${n} entr${n === 1 ? 'y' : 'ies'} for removed places`);
    }
  }
}

/* 4. the two version numbers */
{
  const lt = fs.readFileSync(P('place-lists.js'), 'utf8');
  const sv = +(/"SEED_VERSION":(\d+)/.exec(lt) || [])[1];
  const dt = fs.readFileSync(P('data-version.js'), 'utf8');
  const dv = +(/FR_DV\s*=\s*(\d+)/.exec(dt) || [])[1];
  let want = Math.max(sv || 0, dv || 0);
  if (dataChanged) want += 1;
  if (want !== sv) { fs.writeFileSync(P('place-lists.js'), lt.replace(/"SEED_VERSION":\d+/, `"SEED_VERSION":${want}`)); }
  if (want !== dv) { fs.writeFileSync(P('data-version.js'), dt.replace(/FR_DV\s*=\s*\d+/, `FR_DV=${want}`)); }
  if (want !== sv || want !== dv) report.push(`data version set to ${want} (was SEED_VERSION ${sv}, FR_DV ${dv})`);
}

console.log(report.length ? 'Data guard fixed:\n- ' + report.join('\n- ') : 'Data guard: everything in order.');

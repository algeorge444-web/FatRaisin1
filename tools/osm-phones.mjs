/* Reads OpenStreetMap places exported by osmium (GeoJSON sequence) and writes the drinks places that list a
   phone number: [{name, lat, lon, phone, street, housenumber, city}]. Used to check each location's own phone.
   Usage: node tools/osm-phones.mjs out.json in1.geojsonseq [...] */
import fs from 'fs'; import readline from 'readline';
const [out, ...ins] = process.argv.slice(2);
const els = [];
function centre(g) { let n = 0, x = 0, y = 0; (function walk(c) { if (typeof c[0] === 'number') { x += c[0]; y += c[1]; n++; } else c.forEach(walk); })(g.coordinates); return n ? [y / n, x / n] : null; }
for (const f of ins) {
  if (!fs.existsSync(f)) continue;
  const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
  for await (let line of rl) {
    line = line.replace(/^\x1e/, '').trim(); if (!line) continue;
    let ft; try { ft = JSON.parse(line); } catch (e) { continue; }
    const t = ft.properties || {}; const phone = t.phone || t['contact:phone']; if (!phone || !ft.geometry) continue;
    let c; try { c = centre(ft.geometry); } catch (e) { continue; } if (!c) continue;
    els.push({ name: t.name || t.brand || '', lat: +c[0].toFixed(5), lon: +c[1].toFixed(5), phone, street: t['addr:street'] || '', housenumber: t['addr:housenumber'] || '', city: t['addr:city'] || '' });
  }
}
fs.writeFileSync(out, JSON.stringify(els));
console.log(els.length + ' places with a phone written to ' + out);

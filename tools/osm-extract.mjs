/* Turns OpenStreetMap places exported by osmium (GeoJSON sequence, one place per line) into the
   {elements:[{lat,lon,tags}]} file that tools/osm-hours.mjs --file reads. Ways and areas get their centre point.
   Usage: node tools/osm-extract.mjs out.json in1.geojsonseq [in2.geojsonseq ...] */
import fs from 'fs'; import readline from 'readline';
const [out, ...ins] = process.argv.slice(2);
const els = []; const seen = new Set();
function centre(g) {
  let n = 0, x = 0, y = 0;
  (function walk(c) { if (typeof c[0] === 'number') { x += c[0]; y += c[1]; n++; } else c.forEach(walk); })(g.coordinates);
  return n ? [y / n, x / n] : null;
}
for (const f of ins) {
  const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
  for await (let line of rl) {
    line = line.replace(/^\x1e/, '').trim(); if (!line) continue;
    let ft; try { ft = JSON.parse(line); } catch (e) { continue; }
    const t = ft.properties || {}; if (!t.opening_hours || !(t.name || t.brand) || !ft.geometry) continue;
    const c = centre(ft.geometry); if (!c) continue;
    const key = (t.name || t.brand) + '|' + c[0].toFixed(4) + '|' + c[1].toFixed(4); if (seen.has(key)) continue; seen.add(key);
    els.push({ lat: c[0], lon: c[1], tags: { name: t.name || '', brand: t.brand || '', opening_hours: t.opening_hours } });
  }
}
fs.writeFileSync(out, JSON.stringify({ elements: els, log: [els.length + ' places with opening hours taken from OpenStreetMap downloads (Geofabrik).'] }));
console.log(els.length + ' places written to ' + out);

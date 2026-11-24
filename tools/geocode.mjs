// Looks up map positions for places whose pin is approximate (run on GitHub: OpenStreetMap's
// Nominatim and the US Census geocoder). Input tools/geocode-list.json [{id,name,addr,lat,lng}]
// Output tools/geocode-result.json {id:[{src,q,lat,lng,label}]}. Changes no place data.
import fs from 'node:fs';
const LIST = JSON.parse(fs.readFileSync('tools/geocode-list.json', 'utf8'));
const UA = 'FatRaisin-pin-check/1.0 (github.com/algeorge444-web/FatRaisin1)';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function nomi(q) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=us,ca&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA } });
    const j = await r.json(); return j.map(x => ({ src: 'osm', q, lat: +x.lat, lng: +x.lon, label: x.display_name.slice(0, 140), type: x.type }));
  } catch (e) { return []; } finally { await wait(1200); }
}
async function census(a) {
  try {
    const r = await fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(a));
    const j = await r.json(); return (j.result?.addressMatches || []).slice(0, 2).map(m => ({ src: 'census', q: a, lat: m.coordinates.y, lng: m.coordinates.x, label: m.matchedAddress }));
  } catch (e) { return []; }
}
const out = {};
for (const p of LIST) {
  const town = p.addr.split(',').slice(-2).join(',');
  const res = [];
  res.push(...await nomi(p.addr));
  res.push(...await nomi(p.name + ', ' + town));
  if (/\b[A-Z]{2} \d{5}\b/.test(p.addr)) res.push(...await census(p.addr));
  for (const q of p.alt || []) res.push(...await nomi(q));
  out[p.id] = res;
}
fs.writeFileSync('tools/geocode-result.json', JSON.stringify(out, null, 1));
console.log(Object.values(out).filter(v => v.length).length, 'of', LIST.length, 'with results');

# FatRaisin

A single-page web app (index.html) listing wineries, breweries, cideries and distilleries in Canada and the US.
Published with GitHub Pages from `main`: https://algeorge444-web.github.io/FatRaisin1/ — a push to `main` is live in a minute or two.
The owner is not a programmer: explain changes in plain language, and push finished work here rather than asking them to upload files.

## Files
- `index.html` — the whole app.
- `places-us.js`, `places-ca.js` — one row per place: `[name, address, region, phone, website, lat, lng, source, approx pin 0/1, type, id]`. Keep ids.
- `place-lists.js` — shared lists keyed by place name (INSTAGRAM, CONTACT_OK, SEED_REMOVED, …) and `SEED_VERSION`.
- `place-media.js` — photos, logos and hours keyed by place name (`window.FR_MEDIA`).
- `data-version.js` — `window.FR_DV`; must equal `SEED_VERSION`. **Bump both on every data change** or phones keep old data.
- `events-data.js` — events found on places' websites; rebuilt weekly by `.github/workflows/events.yml` running `tools/crawl-events.mjs`.
- Opening hours (`FR_MEDIA.HOURS`) come from places' websites (`tools/hours-crawl.py` + `tools/hours-parse.py`) and, for places still without any, from OpenStreetMap once a month (`.github/workflows/osm-hours.yml` downloads each province/state from Geofabrik, filters with osmium, `tools/osm-extract.mjs` turns that into the file `tools/osm-hours.mjs --file` matches; it bumps the data version itself and logs to `tools/osm-hours-last-run.txt`). OpenStreetMap can't be reached from Claude's workspace, only from GitHub.
- `wine-barcodes.js` — `window.FR_BC`: wine barcodes from BC's open liquor price list (wine only), built by `tools/bc-wine-barcodes.py`; loaded only when a barcode is scanned and checked before the shared Firebase catalogue (then Open Food Facts).
- `tools/helper-lib.mjs` — copy of the Cloudflare Worker ("helper") code, used by the event search. The live worker is deployed by the owner in Cloudflare, not from this repo. The event search here has extra sources the live worker lacks (Squarespace event JSON, Commerce7 event tickets, public Google Calendar feeds, single event pages); the app doesn't need the worker's 15-minute cron any more.

## Features worth knowing
- Flight Challenge votes are saved in the `reviews` collection as `place: "flight-<category>"`, `text: <place id>`, doc id `flight-<category>_<uid>` (chosen so it should fit the existing reviews rules; not yet confirmed with a real signed-in vote). Review lists and counts skip `flight-` entries.
- Side menu style: `var MENU_STYLE='solid'` in index.html. The owner chose solid but wants the see-through frosted-glass version kept; set it to `'glass'` to switch.
- Badges, the Secret Sip and the passport are worked out on the phone from the visitor's stamps; nothing extra is stored online.


## Rules the owner has set
- No paid Google services (maps, places, search). Firebase stays; Google Maps *links* for directions on non-Apple devices are fine.
- A place should have a street address and a working website; phone where one can be found (places without a phone are kept, and marked as checked in `CONTACT_OK`).
- **New** places (added by Claude to the data files, or by the owner in the app) must have all three: street address, phone and website. The app's add-place forms enforce this.
- When removing a place, also add its name to `SEED_REMOVED` and drop its entries from the name-keyed lists and media.
- Renaming a place means renaming its keys in `place-lists.js` and `place-media.js` too.

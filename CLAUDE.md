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
- `tools/helper-lib.mjs` — copy of the Cloudflare Worker ("helper") code, used by the event search. The live worker is deployed by the owner in Cloudflare, not from this repo.

## Rules the owner has set
- No paid Google services (maps, places, search). Firebase stays; Google Maps *links* for directions on non-Apple devices are fine.
- A place should have a street address and a working website; phone where one can be found (places without a phone are kept).
- When removing a place, also add its name to `SEED_REMOVED` and drop its entries from the name-keyed lists and media.
- Renaming a place means renaming its keys in `place-lists.js` and `place-media.js` too.

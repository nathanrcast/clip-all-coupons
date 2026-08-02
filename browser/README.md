# Clip-All Coupons — userscript + bookmarklet

Clips **all** Albertsons-family for-U coupons (no 250/700 cap) by enumerating offers
through the `ecomgallery` API + the `abJ4uCoupons` cache, then clipping via the store's own
clip endpoint (the same call the published Coupon Clipper extension uses — so it's proven).
Runs in *your* logged-in session, so the login WAF is a non-issue. Firefox + mobile friendly.

## Status: parser locked (probed 2026-06-15)

The gallery shape is confirmed (see `../CLAUDE.md` § Confirmed for-U API). One call
(`offerPgm=PD-CC-MF-SC`) returns all offers as `data.offers` (object keyed by `offerId`); we filter
`status === "C"` (already clipped) and clip the rest via `offerPgm` as `itemType`. `gallery-probe.js`
is kept for re-verifying if the API changes.

## Deploy the guide page (optional — for sharing with others)

`index.html` is a non-technical, mobile-first setup guide. Host this `browser/` dir somewhere
phones can reach it, then share **one link**.

1. Copy `browser/` to wherever you run Docker.
2. Create a Cloudflare Tunnel hostname → `http://web:80`; put its token in a `.env` beside the
   compose file (`TUNNEL_TOKEN=...`).
3. **From inside `browser/`** run `docker compose -f deploy.compose.yml up -d` (nginx static +
   cloudflared). The volume is `./:/usr/share/nginx/html`, so the compose **must** be run from this
   dir — running it from the repo root mounts the wrong docroot (`/` → 403).
4. Tunnel public hostname → Service **HTTP** `web:80` (HTTPS = 525). DNS is a proxied CNAME the tunnel
   creates automatically; don't hand-make an A record for the hostname (it shadows the tunnel → 525/1016).
5. Share the tunnel's public URL.

> **Install trust:** the guide's Android "Install" buttons point at this repo's **GitHub raw**
> URLs (same as `@downloadURL`/`@updateURL`). Nginx on the guide host allowlists only
> `index.html` + bookmarklet `.txt` files — probes, sources, and `.user.js` return 404 so the
> tunnel is not a mutable userscript CDN. Optional LAN port `8551` is commented out in compose;
> uncomment if you need LAN access without the tunnel.

## Userscript (recommended — Firefox desktop + Firefox Android)

1. Install **Violentmonkey** (or Tampermonkey) — both are on AMO for Firefox **and Firefox
   Android**.
2. Open the dashboard → **+ → Install from file** (or paste) → `clip-all-coupons.user.js`.
3. Go to a coupons page while signed in → tap the floating **✂ Clip all coupons** button
   (bottom-right), or the userscript-manager menu command.

## Bookmarklet (no install — any browser incl. iOS Safari / mobile Chrome)

1. `./build-bookmarklet.sh` regenerates `bookmarklet.txt` from `bookmarklet.src.js`.
2. Make a new bookmark; paste the contents of `bookmarklet.txt` as its URL/location.
3. While signed in on a coupons page, tap the bookmark.
   - On mobile, trigger it by typing the bookmark's name in the address bar.
   - Caveat: some sites' CSP can block bookmarklets; the userscript path is more robust.

## Kroger family (Fry's, Ralphs, King Soopers, Smith's, Fred Meyer, QFC, Dillons…)

A separate adapter. Kroger has **no "all offers" API**, so — like every working Kroger clipper —
it scrolls the coupons page to load all cards then **clicks each unclipped "Clip" button** serially
(same jittered cadence). Kroger renders ~150 coupons at a time, so one run clips up to ~150; run it
again for the rest. Install `clip-all-coupons-kroger.user.js` the same way, or use
`kroger-bookmarklet.txt`. It was **not** live-tested on a real Kroger account — if a redesign breaks
the clip buttons, run `kroger-probe.js` on the coupons page (clip one coupon manually) and it reports
the current selectors + any clip API call.

## Target Circle

DOM-first adapter (`clip-all-coupons-target.user.js` / `target-bookmarklet.txt`). Use
`https://www.target.com/deals/all?facet=tap_to_apply` ("Coupons to apply"), then it scrolls and
clicks `button[data-test="save-circle-offer-button"]` (Save/Apply). Optionally reads save-slot
usage from `loyalty_guest_offerlists/v1/external`. **Do not** call `loyalty_offer_groups` —
live OPTIONS returns 502. Re-verify with `target-probe.js` (save one offer manually while it watches).

## Files
| File | What |
|---|---|
| `gallery-probe.js` | Albertsons: console snippet to confirm the offer-data shape (clips nothing) |
| `clip-all-coupons.user.js` | Albertsons userscript (floating button + menu command) |
| `bookmarklet.src.js` | readable Albertsons bookmarklet source |
| `clip-all-coupons-kroger.user.js` | Kroger userscript (DOM-click; floating button + menu command) |
| `kroger-bookmarklet.src.js` | readable Kroger bookmarklet source |
| `kroger-probe.js` | Kroger: console probe of clip API + button selectors (clips nothing) |
| `clip-all-coupons-target.user.js` | Target Circle userscript (API + DOM fallback) |
| `target-bookmarklet.src.js` | readable Target bookmarklet source |
| `target-probe.js` | Target: console probe of loyalty offer API + Save/Activate selectors |
| `build-bookmarklet.sh` | terser-minifies every `*bookmarklet.src.js` → matching `*.txt` |
| `bookmarklet.txt` / `kroger-bookmarklet.txt` / `target-bookmarklet.txt` | generated; paste as a bookmark URL |

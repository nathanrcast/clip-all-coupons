# Clip-All Coupons

Clip **all** of your Albertsons-family "for U" coupons (Safeway, Vons, Acme, Jewel-Osco…) at once —
no 250/700-coupon cap, no clicking each one. A small browser tool (userscript or bookmarklet) that
runs in **your own logged-in session**, enumerates every offer via the for-U `ecomgallery` API, and
clips them via the store's own clip endpoint (the same call the published Coupon Clipper extension makes).

Works on the whole Albertsons banner family: Safeway, Albertsons, Vons, Acme, Jewel-Osco, Randalls,
Tom Thumb, Shaw's, Star Market, Pavilions, Andronico's, Carrs, Haggen, Kings, Balducci's. Firefox
desktop + Firefox Android friendly; the bookmarklet works in any browser (incl. iOS Safari).

> Personal use, low volume. Automating coupon clipping may stretch the store's ToS — use at your own risk.

## How it works

Everything runs client-side in your browser, in your already-signed-in session:

1. Read your session token + storeId from the page (the same globals the store's own site uses).
2. `GET …/j4u/api/ecomgallery` once → every offer across all programs.
3. Filter out already-clipped offers, then `POST …/j4u/api/offers/clip` for each remaining one,
   **serially with a human-like jittered gap** so Akamai Bot Manager doesn't flag it (Error 15).

Your session token is sent **only to the store's own domain** — nowhere else. Nothing is stored, and
there's no server: the tool is just JavaScript that runs on the page.

## Install — userscript (recommended)

1. Install **Violentmonkey** or **Tampermonkey** (both on AMO for Firefox desktop **and** Android).
2. Dashboard → **+ → Install from file** (or paste) → `browser/clip-all-coupons.user.js`.
   - Or install directly from the [raw URL](https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons.user.js) (auto-updates).
3. Open a coupons page while signed in → tap the floating **✂ Clip all coupons** button.

## Install — bookmarklet (no extension; any browser)

1. Run `browser/build-bookmarklet.sh` to regenerate `browser/bookmarklet.txt` from source.
2. Make a new bookmark; paste the contents of `bookmarklet.txt` as its URL.
3. While signed in on a coupons page, tap the bookmark (on mobile, type its name in the address bar).
   - Some sites' CSP can block bookmarklets — the userscript path is more robust.

## Repo layout

| Path | What |
|---|---|
| `browser/clip-all-coupons.user.js` | the userscript (floating button + menu command) |
| `browser/bookmarklet.src.js` | readable bookmarklet source |
| `browser/build-bookmarklet.sh` | minifies src → `bookmarklet.txt` (`javascript:` URL) |
| `browser/bookmarklet.txt` | generated; paste as a bookmark URL |
| `browser/gallery-probe.js` | read-only console snippet to verify the offer-data shape (clips nothing) |
| `browser/index.html` | optional mobile-first setup guide page you can host for others |
| `browser/deploy.compose.yml` | optional: nginx + Cloudflare Tunnel to serve the guide page |

See `browser/README.md` for details and the optional hosting setup.

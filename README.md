# Clip-All Coupons

Clip **all** of your grocery loyalty coupons at once — no clicking each one. Small browser tools
(userscript or bookmarklet) that run in **your own logged-in session**. There are two adapters, one
per retailer family, because the two backends are completely different:

| Retailer family | Stores | Method | Cap |
|---|---|---|---|
| **Albertsons** | Safeway, Albertsons, Vons, Acme, Jewel-Osco, Randalls, Tom Thumb, Shaw's, Star Market, Pavilions, Andronico's, Carrs, Haggen, Kings, Balducci's | for-U `ecomgallery` JSON API | **none** — clips every offer in one pass |
| **Kroger** | Kroger, Fry's, Ralphs, King Soopers, City Market, Smith's, Fred Meyer, QFC, Dillons, Baker's, Mariano's, Metro Market, Pick 'n Save, Food 4 Less, Foods Co | clicks the on-page clip buttons | **~150/run** (Kroger only renders ~150 at a time — run again for the rest) |

Firefox desktop + Firefox Android friendly; the bookmarklets work in any browser (incl. iOS Safari).

> Personal use, low volume. Automating coupon clipping may stretch the store's ToS — use at your own risk.

## How it works

Everything runs client-side in your browser, in your already-signed-in session. Nothing is stored,
and there's no server — the tools are just JavaScript that runs on the page.

**Albertsons** (`clip-all-coupons.user.js`) — has a clean coupon API, so it goes no-cap:

1. Read your session token + storeId from the page (the same globals the store's own site uses).
2. `GET …/j4u/api/ecomgallery` once → every offer across all programs.
3. Filter out already-clipped offers, then `POST …/j4u/api/offers/clip` for each remaining one,
   **serially with a human-like jittered gap** so Akamai Bot Manager doesn't flag it (Error 15).

Your session token is sent **only to the store's own domain** — nowhere else.

**Kroger** (`clip-all-coupons-kroger.user.js`) — Kroger exposes no "all offers" endpoint, so (like
every other Kroger clipper) it scrolls the coupons page to lazy-load all cards, then **clicks each
unclipped "Clip" button** serially with the same jittered gap. Because the page only renders ~150
coupons at a time, one run clips up to ~150 — run it again for more. No network calls of its own.
`browser/kroger-probe.js` captures the live API/selectors if a no-cap path is ever added.

## Install — userscript (recommended)

1. Install **Violentmonkey** or **Tampermonkey** (both on AMO for Firefox desktop **and** Android).
2. Dashboard → **+ → Install from file** (or paste) → the userscript for your store:
   - Albertsons family → `browser/clip-all-coupons.user.js`
     ([raw URL](https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons.user.js), auto-updates)
   - Kroger family → `browser/clip-all-coupons-kroger.user.js`
     ([raw URL](https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons-kroger.user.js), auto-updates)
   - Shop at both? Install both — each only runs on its own stores.
3. Open a coupons page while signed in → tap the floating **✂ Clip all coupons** button.

## Install — bookmarklet (no extension; any browser)

1. Run `browser/build-bookmarklet.sh` to regenerate the `*.txt` files from source.
2. Make a new bookmark; paste the contents of `bookmarklet.txt` (Albertsons) or
   `kroger-bookmarklet.txt` (Kroger) as its URL.
3. While signed in on a coupons page, tap the bookmark (on mobile, type its name in the address bar).
   - Some sites' CSP can block bookmarklets — the userscript path is more robust.

## Repo layout

| Path | What |
|---|---|
| `browser/clip-all-coupons.user.js` | Albertsons userscript (floating button + menu command) |
| `browser/clip-all-coupons-kroger.user.js` | Kroger userscript (floating button + menu command) |
| `browser/bookmarklet.src.js` | readable Albertsons bookmarklet source |
| `browser/kroger-bookmarklet.src.js` | readable Kroger bookmarklet source |
| `browser/build-bookmarklet.sh` | minifies every `*bookmarklet.src.js` → matching `*.txt` (`javascript:` URL) |
| `browser/bookmarklet.txt` / `kroger-bookmarklet.txt` | generated; paste as a bookmark URL |
| `browser/gallery-probe.js` | Albertsons read-only console probe of the offer-data shape (clips nothing) |
| `browser/kroger-probe.js` | Kroger console probe: captures the live clip API + button selectors (clips nothing) |
| `browser/index.html` | optional mobile-first setup guide page you can host for others |
| `browser/deploy.compose.yml` | optional: nginx + Cloudflare Tunnel to serve the guide page |

See `browser/README.md` for details and the optional hosting setup.

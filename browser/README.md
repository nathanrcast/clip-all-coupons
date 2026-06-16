# Safeway Clip-All — userscript + bookmarklet

Clips **all** Safeway/Albertsons for-U coupons (no 250/700 cap) by enumerating offers
through the `ecomgallery` API + the `abJ4uCoupons` cache, then clipping via Safeway's own
clip endpoint (the same call the published Coupon Clipper extension uses — so it's proven).
Runs in *your* logged-in session, so the login WAF is a non-issue. Firefox + mobile friendly.

## Status: parser locked (probed 2026-06-15)

The gallery shape is confirmed (see `../CLAUDE.md` § Confirmed Safeway for-U API). One call
(`offerPgm=PD-CC-MF-SC`) returns all offers as `data.offers` (object keyed by `offerId`); we filter
`status === "C"` (already clipped) and clip the rest via `offerPgm` as `itemType`. `gallery-probe.js`
is kept for re-verifying if Safeway changes the API.

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

> Auto-updates (`@downloadURL`/`@updateURL`) point at this repo's GitHub raw URL, so editing the
> userscript here and pushing is enough — installed copies pull the new version. The "Install the
> Clipper" button on the guide page is a relative link, so it serves whatever's deployed at your host.

## Userscript (recommended — Firefox desktop + Firefox Android)

1. Install **Violentmonkey** (or Tampermonkey) — both are on AMO for Firefox **and Firefox
   Android**.
2. Open the dashboard → **+ → Install from file** (or paste) → `safeway-clip-all.user.js`.
3. Go to a coupons page while signed in → tap the floating **✂ Clip all coupons** button
   (bottom-right), or the userscript-manager menu command.

## Bookmarklet (no install — any browser incl. iOS Safari / mobile Chrome)

1. `./build-bookmarklet.sh` regenerates `bookmarklet.txt` from `bookmarklet.src.js`.
2. Make a new bookmark; paste the contents of `bookmarklet.txt` as its URL/location.
3. While signed in on a coupons page, tap the bookmark.
   - On mobile, trigger it by typing the bookmark's name in the address bar.
   - Caveat: some sites' CSP can block bookmarklets; the userscript path is more robust.

## Files
| File | What |
|---|---|
| `gallery-probe.js` | console snippet to confirm the offer-data shape (clips nothing) |
| `safeway-clip-all.user.js` | the userscript (floating button + menu command) |
| `bookmarklet.src.js` | readable bookmarklet source |
| `build-bookmarklet.sh` | terser-minifies src → `bookmarklet.txt` (`javascript:` URL) |
| `bookmarklet.txt` | generated; paste as a bookmark URL |

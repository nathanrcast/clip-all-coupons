# clip-all-coupons — repo facts

Clip all Albertsons-family "for U" coupons (Safeway, Vons, Acme, Jewel-Osco…) at once. The tool runs entirely client-side in the
user's own logged-in browser session (`browser/`): enumerate all offers via the gallery API, clip
via the for-U API. There is no server and nothing is persisted.

## Confirmed for-U API — Albertsons banners (probed 2026-06-15, store 1487, Firefox)
- **Session globals (page MAIN world):** token `window.AB.userInfo.SWY_SHOP_TOKEN`; `storeId` from
  `window.AB.userInfo.j4u.storeId`/`branchId`; `clientId`/`clientSecret` from
  `window.SWY.CONFIGSERVICE.datapowerConfig`; correlationId `window.AB.userInfo.UUID`. These are the
  same public web-client values the store's own site uses — not user secrets.
- **Enumerate (one call returns ALL):** `GET https://<host>/abs/pub/web/j4u/api/ecomgallery?offerPgm=PD-CC-MF-SC&storeId=<id>&transformOfferbyUpc=y`
  → `data.offers` is an **object keyed by offerId** (not array) → `Object.values()`. Programs: PD +
  CC make up the set (MF/SC often empty). ~682 offers seen.
- **Offer fields:** `offerId`, `offerPgm` (`"PD"`/`"CC"` → use as clip `itemType`), `status`
  (`"C"` = already clipped → filter these out). Full dupe in `localStorage.abJ4uCoupons.objCoupons`
  (keyed by offerId) + `arrClippedCoupons` (array of clipped offerIds) — used as fallback source.
- **Clip:** `POST https://<host>/abs/pub/web/j4u/api/offers/clip?storeId=<id>` body
  `{items:[{clipType:"C",itemId:offerId,itemType:offerPgm},{clipType:"L",...}]}`; success =
  `resp.items[0].status === 1`. Required headers: `SWY_SSO_TOKEN` + `X-swyConsumerDirectoryPro` (both
  = token), `X-IBM-Client-Id`/`X-IBM-Client-Secret`, `X-SWY_API_KEY: "emjou"`, `X-SWY_BANNER` (banner
  from hostname), `X-SWY_VERSION: "1.0"`, `x-swy-correlation-id`. (Clip endpoint/body/headers proven
  by the published Coupon Clipper extension.)

## Gotchas
1. **Firefox + GM_* grant sandboxing:** Violentmonkey hides page globals behind Xray vision (they read
   as `undefined`). Read the session from `unsafeWindow`, not `window` — see the userscript header.
2. **Akamai Bot Manager ("Error 15"):** parallel clip bursts get scored as a bot. Clip **serially**
   with a jittered 350–750 ms gap; on `403`/`429`, back off (treat as "blocked") rather than hammer.
3. **Clip posts both `clipType` `"C"` and `"L"`** per offer.
4. **Auto-update URLs** in `clip-all-coupons.user.js` (`@downloadURL`/`@updateURL`) point at this
   repo's GitHub raw path — keep them in sync if the repo/branch moves.

## Files
- `browser/clip-all-coupons.user.js` — userscript (floating button + menu command). Live tool.
- `browser/bookmarklet.src.js` → `browser/build-bookmarklet.sh` → `browser/bookmarklet.txt` — bookmarklet build.
- `browser/gallery-probe.js` — read-only console probe to re-verify the API shape (clips nothing).
- `browser/index.html` — optional hostable setup guide; `browser/deploy.compose.yml` — nginx + tunnel.

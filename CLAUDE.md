# clip-all-coupons — repo facts

Clip all of a user's grocery loyalty coupons at once, client-side in their own logged-in session
(`browser/`). No server, nothing persisted. **Two adapters, one per retailer family — the backends
are unrelated, so they share only the overlay/progress UX and the serial+jittered clip cadence:**
- **Albertsons** (Safeway, Vons, Acme, Jewel-Osco…) — clean for-U `ecomgallery` JSON API → **no cap**.
- **Kroger** (Fry's, Ralphs, King Soopers, Smith's…) — no "all offers" API; **clicks on-page clip
  buttons**, capped ~150/run (Kroger lazy-renders ~150). DOM-click is what every working Kroger
  clipper does (kro-clipper, kroger-cli, the Ralphs gist).

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

## Kroger adapter (NOT live-tested — built from public clippers + defensive selectors)
- **No probe of a real Fry's account was possible**, so selectors/flow are best-effort. `browser/kroger-probe.js`
  hooks `fetch`/`XHR` + dumps the live clip-button selectors → run it on a logged-in Kroger coupons
  page (clip one coupon manually) to confirm/correct, and to capture a real clip request if a no-cap
  API path is ever added.
- **Clip-button selectors (drift across redesigns — match several + a text/aria fallback):**
  `button.kds-Button--favorable` (kroger-cli era), `button.CouponCard-button.kds-Button--primary`
  (Ralphs gist), `button[data-testid="coupon-add-button"]`, plus any `<button>` whose text/aria-label
  is "Clip"/"Clip coupon". Skip already-done buttons (`disabled`, `aria-pressed`, text/label matching
  `clipped|unclip|added|remove`).
- **Flow:** scroll to bottom until card count stabilizes (lazy-load all) → collect unclipped buttons →
  click serially with the 350–750 ms jitter → re-collect between passes (clicking re-renders) → stop
  when nothing clippable remains or no forward progress (≤8 passes). Legacy JSON API
  (`/p/np/<division>/Kroger/coupons` + `/coupon/clip?id&clipsource=KWL&signature`) exists but is old
  and division-specific — not used.

## Gotchas
1. **Firefox + GM_* grant sandboxing (Albertsons):** Violentmonkey hides page globals behind Xray vision
   (they read as `undefined`). Read the session from `unsafeWindow`, not `window` — see the userscript header.
2. **Akamai Bot Manager ("Error 15"):** parallel clip bursts get scored as a bot. Clip **serially**
   with a jittered 350–750 ms gap; on `403`/`429`, back off (treat as "blocked") rather than hammer.
   (Kroger likely has similar bot scoring — same serial+jitter cadence is reused.)
3. **Clip posts both `clipType` `"C"` and `"L"`** per offer (Albertsons).
4. **Auto-update URLs** in both `*.user.js` (`@downloadURL`/`@updateURL`) point at this repo's GitHub
   raw path — keep them in sync if the repo/branch moves.

## Files
- `browser/clip-all-coupons.user.js` — Albertsons userscript (floating button + menu command). Live tool.
- `browser/clip-all-coupons-kroger.user.js` — Kroger userscript (DOM-click; floating button + menu command).
- `browser/bookmarklet.src.js` + `browser/kroger-bookmarklet.src.js` → `browser/build-bookmarklet.sh`
  (builds every `*bookmarklet.src.js` → matching `*.txt`).
- `browser/gallery-probe.js` (Albertsons API shape) / `browser/kroger-probe.js` (Kroger API+selectors) — probes, clip nothing.
- `browser/index.html` — optional hostable setup guide; `browser/deploy.compose.yml` — nginx + tunnel.

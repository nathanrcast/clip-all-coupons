# clip-all-coupons — repo facts

Clip all of a user's grocery loyalty coupons at once, client-side in their own logged-in session
(`browser/`). No server, nothing persisted. **One adapter per retailer family — the backends are
unrelated, so they share only the overlay/progress UX and the serial+jittered clip cadence:**
- **Albertsons** (Safeway, Vons, Acme, Jewel-Osco…) — clean for-U `ecomgallery` JSON API → **no cap**.
- **Kroger** (Fry's, Ralphs, King Soopers, Smith's…) — no "all offers" API; **clicks on-page clip
  buttons**, capped ~150/run (Kroger lazy-renders ~150). DOM-click is what every working Kroger
  clipper does (kro-clipper, kroger-cli, the Ralphs gist).
- **Target Circle** — **DOM-first** Save/Apply clicks on Deals (`/deals/all?facet=tap_to_apply`).
  Most store deals auto-apply since 2024-04; this saves manufacturer coupons / bonuses.
  Account save-cap still exists (75 slots seen live). Optional saved-list API for slot usage only.

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

## Confirmed Target Circle (live HAR 2026-08-02 on `/deals/all?facet=tap_to_apply`)
- **Works:** `GET https://api.target.com/loyalty_guest_offerlists/v1/external` with
  `Authorization: <loyaltyClientKey>`, `x-api-key: <loyaltyApiKey>`, `credentials: "include"`.
  Returns saved offers + `user_meta_data.total_filled_slots` / `total_earned_slots` (75 cap seen).
- **Broken for clients:** `GET loyalty_offer_groups/v1/categories` — OPTIONS preflight **502**
  ("no upstream"), so browser `fetch` fails (status 0). **Do not enumerate via offer_groups.**
  v0.1.0 API-first path threw on that failure and never reached DOM fallback — fixed in v0.2.0.
- **Save/clip API** still exists in site JS (`POST …/loyalty_guest_offerlists/v1/external/{offerId}`)
  but grid offers are slingshot/CDUI-rendered; adapter is **DOM-first**.
- **DOM selectors (live):** `button[data-test="save-circle-offer-button"]` (primary);
  CTA language flag may label buttons `Save` / `Apply` / `Save offer` with aria
  `Save <title>` or `Apply <title>`. Skip `Applied` / `Offer saved` / `Remove`.
  Best page: `https://www.target.com/deals/all?facet=tap_to_apply` ("Coupons to apply").
- **Config keys:** `window.__CONFIG__.services.apiPlatform.circleOfferLoyaltyKeys` (public
  web-client values; hardcoded fallbacks match the page).

## Gotchas
1. **Firefox + GM_* grant sandboxing (Albertsons / Target):** Violentmonkey hides page globals behind
   Xray vision (they read as `undefined`). Read the session/config from `unsafeWindow`, not `window`
   — see the userscript headers.
2. **Akamai Bot Manager ("Error 15"):** parallel clip bursts get scored as a bot. Clip **serially**
   with a jittered 350–750 ms gap; on `403`/`429`, back off (treat as "blocked") rather than hammer.
   (Kroger / Target likely have similar bot scoring — same serial+jitter cadence is reused.)
3. **Clip posts both `clipType` `"C"` and `"L"`** per offer (Albertsons).
4. **Auto-update URLs** in `*.user.js` (`@downloadURL`/`@updateURL`) point at this repo's GitHub
   raw path — keep them in sync if the repo/branch moves.
5. **Target value is narrower than grocery clippers** — don't expect thousands of clips; only
   offers that still require save/activate are in scope.

## Files
- `browser/clip-all-coupons.user.js` — Albertsons userscript (floating button + menu command). Live tool.
- `browser/clip-all-coupons-kroger.user.js` — Kroger userscript (DOM-click; floating button + menu command).
- `browser/clip-all-coupons-target.user.js` — Target Circle userscript (API-first + DOM fallback).
- `browser/bookmarklet.src.js` + `browser/kroger-bookmarklet.src.js` + `browser/target-bookmarklet.src.js`
  → `browser/build-bookmarklet.sh` (builds every `*bookmarklet.src.js` → matching `*.txt`).
- `browser/gallery-probe.js` (Albertsons) / `browser/kroger-probe.js` (Kroger) /
  `browser/target-probe.js` (Target) — probes, clip nothing.
- `browser/index.html` — optional hostable setup guide; `browser/deploy.compose.yml` — nginx + tunnel.

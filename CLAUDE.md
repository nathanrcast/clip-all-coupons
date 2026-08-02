# clip-all-coupons — repo facts

Clip all of a user's grocery loyalty coupons at once, client-side in their own logged-in session
(`browser/`). No server, nothing persisted. **One adapter per retailer family — the backends are
unrelated, so they share only the overlay/progress UX and the serial+jittered clip cadence:**
- **Albertsons** (Safeway, Vons, Acme, Jewel-Osco…) — clean for-U `ecomgallery` JSON API → **no cap**.
- **Kroger** (Fry's, Ralphs, King Soopers, Smith's…) — no "all offers" API; **clicks on-page clip
  buttons**, capped ~150/run (Kroger lazy-renders ~150). DOM-click is what every working Kroger
  clipper does (kro-clipper, kroger-cli, the Ralphs gist).
- **Target Circle** — loyalty offer JSON API (`api.target.com`) with DOM Save/Activate fallback.
  Most store deals auto-apply since 2024-04; this saves manufacturer coupons / bonuses / rebates.
  Account save-cap still exists (`/circle/maxedDeals`).

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

## Confirmed Target Circle API (probed from public page bundles / `__CONFIG__`, 2026-08-02)
- **Config:** `window.__CONFIG__.services.apiPlatform` (every Target page). Public web-client keys
  live in `circleOfferLoyaltyKeys` (`loyaltyApiKey`, `loyaltyClientKey`) — same values the site
  sends; not user secrets. Fallbacks hardcoded in the adapter match the live page.
- **Base:** `https://api.target.com` + `credentials: "include"` (logged-in session cookies).
- **Headers:** `Authorization: <loyaltyClientKey>`, `x-api-key: <loyaltyApiKey>`.
- **Enumerate:** `GET loyalty_offer_groups/v1/categories` (+ `/{id}` for offers);
  `GET loyalty_offer_groups/v1/collections` (+ `/{id}`);
  `GET loyalty_guest_offerlists/v1/external` (already-saved).
- **Save/clip:** `POST loyalty_guest_offerlists/v1/external/{offerId}?location_id=<storeId>`
  (`location_id` optional when store unknown). Delete is same path with DELETE.
- **Product note:** store Circle deals auto-apply at checkout; manufacturer coupons + bonuses still
  need save/activate. Save limit still wired (`/circle/maxedDeals`) — stop cleanly on capacity errors.
- **DOM fallback selectors:** `button[data-test="save-button"]` + text/aria
  `Save|Activate|Apply` (+ optional `offer|deal|bonus|coupon`); skip saved/applied/remove.
  "Load more" + scroll for lazy grids. `browser/target-probe.js` re-confirms selectors + live calls.
- **Not live-tested on a signed-in household account** — API shape is from Target's shipped JS;
  run the probe once signed in to confirm headers/body and tweak if needed.

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

# Retailer adapters — confirmed APIs and selectors

Reference for the three adapters in `browser/`. Moved out of `AGENTS.md` to keep the agent notes short; update this file whenever a probe confirms or disproves an endpoint or selector.

## Confirmed for-U API — Albertsons banners (probed 2026-06-15, Firefox)
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
- **No probe of a real Kroger-family account was possible**, so selectors/flow are best-effort. `browser/kroger-probe.js`
  hooks `fetch`/`XHR` + dumps the live clip-button selectors → run it on a logged-in Kroger coupons
  page (clip one coupon manually) to confirm/correct, and to capture a real clip request if a no-cap
  API path is ever added.
- **Clip button (read from Kroger's `/cdn/coupons.*.js` bundle, 2026-09 "citrus" redesign — KDS
  classes are gone):** `button[data-testid="CouponActionButton-<couponId>"]`, class
  `CouponActionButton CouponCard-button`, `aria-label="<Verb> for coupon: <desc> coupon"`, text `<Verb>`.
  The verb is the state: `Clip` → `Clipping` (disabled) → `Unclip`; `Sign In To Clip` when logged out;
  a **disabled `Clip`** = clip limit reached. Cash-back cards reuse the testid with `Get Cash Back` /
  `Remove` — deliberately not clicked. Classify by the aria verb (the description can contain words like
  "added"), and never scope via `[data-testid*="coupon"]` — the header nav link
  `SiteMenuMobile-MarqueeLinks-Digital Coupons` matches first (that was the 2026-09 "No unclipped
  coupons found" bug). Fallback if the testid is renamed: exact-`Clip` `<button>`s inside `<main>`.
- **Flow:** window-scroll to bottom until card count stabilizes and `.CouponsCatalogue-infiniteScrollSpinner`
  is gone (react-infinite-scroll-component, loads until `totalCount`) → click each `Clip` serially,
  waiting ≤3 s for the button to flip to `Unclip` (React replaces the node — re-find by testid), then the
  350–750 ms jitter → re-collect between passes; stop on limit, nothing clippable, or no progress (≤8
  passes). The SPA's own clip call is `POST /atlas/v1/savings-coupons/v1/clip-unclip`
  `{action:"CLIP", couponId}` — a possible future API path, not used (headers unprobed). Legacy
  `/p/np/<division>/Kroger/coupons` + `/coupon/clip?…&signature` is dead.
- **Offline test harness:** headless Chromium (`~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome
  --headless=new --dump-dom --virtual-time-budget=…`) gets past Akamai for page/bundle fetches (curl is
  tarpitted) but the coupon list itself errors ("not finding any coupons") — test against a mock page.
  Virtual time doesn't fire `scroll` events; mocks must poll `scrollY`.

## Confirmed Target Circle (live HAR 2026-08-02 on `/deals/all?facet=tap_to_apply`)
- **Works:** `GET https://api.target.com/loyalty_guest_offerlists/v1/external` with
  `Authorization: <loyaltyClientKey>`, `x-api-key: <loyaltyApiKey>`, `credentials: "include"`.
  Returns saved offers + `user_meta_data.total_filled_slots` / `total_earned_slots`.
  `total_earned_slots` often reads **75** (legacy marketed save cap) but is **not** a hard
  client-side stop — a live run saved 300+ while earned stayed 75. Never gate on
  `filled >= earned` (v0.2.0 bug → fixed in v0.2.1).
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

# clip-all-coupons — agent notes

Clip all of a user's grocery loyalty coupons at once, client-side in their own logged-in session
(`browser/`). No server, nothing persisted. **One adapter per retailer family — the backends are
unrelated, so they share only the overlay/progress UX and the serial+jittered clip cadence:**
- **Albertsons** (Safeway, Vons, Acme, Jewel-Osco…) — clean for-U `ecomgallery` JSON API → **no cap**.
- **Kroger** (Fry's, Ralphs, King Soopers, Smith's…) — no "all offers" API; **clicks on-page clip
  buttons**, capped ~150/run (Kroger lazy-renders ~150). DOM-click is what every working Kroger
  clipper does (kro-clipper, kroger-cli, the Ralphs gist).
- **Target Circle** — **DOM-first** Save/Apply clicks on Deals (`/deals/all?facet=tap_to_apply`).
  Most store deals auto-apply since 2024-04; this saves manufacturer coupons / bonuses.
  API reports `total_earned_slots` (often 75) but that is not a reliable hard stop —
  live mass-saves can exceed it; only trust an on-page maxed modal.

**API endpoints, headers and DOM selectors per retailer: `docs/adapters.md`** — read the relevant section before touching an adapter.

**PUBLIC repo (MIT).** Never commit lab details — LAN IPs, internal hostnames, deploy paths, SSH. History was squashed once to scrub them.

## Commands

- `browser/build-bookmarklet.sh` — rebuilds every `*bookmarklet.src.js` → matching `*.txt`. Run after editing any bookmarklet source.
- No server and no test suite: verify against a mock page (headless Chromium can't load the real coupon lists — see `docs/adapters.md` § Kroger).

## Settled decisions

- Client-side only, in the user's own logged-in session. A server-side/OTP design is dead — Akamai WAF blocks headless login. Scheduled auto-clip is deliberately not built.

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

## Review focus

- Clip cadence stays serial with the 350–750 ms jitter; 403/429 must back off, never retry hot.
- Kroger and Target adapters are **not tested on a real logged-in account** — selector changes need a probe run (`browser/*-probe.js`) before they're trusted.
- Never classify Kroger buttons by description text or `[data-testid*="coupon"]` (`docs/adapters.md`).

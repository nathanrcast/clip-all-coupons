// ==UserScript==
// @name         Clip-All Coupons — Kroger
// @namespace    https://github.com/nathanrcast/clip-all-coupons
// @version      0.1.0
// @description  Clip ALL of your Kroger-family digital coupons (Fry's, Ralphs, King Soopers, Smith's, Fred Meyer, QFC, Dillons…) in one tap. Firefox + mobile friendly.
// @author       ncastel
// @homepageURL  https://github.com/nathanrcast/clip-all-coupons
// @downloadURL  https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons-kroger.user.js
// @updateURL    https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons-kroger.user.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9C%82%3C/text%3E%3C/svg%3E
// @match        https://*.kroger.com/*
// @match        https://*.frysfood.com/*
// @match        https://*.ralphs.com/*
// @match        https://*.kingsoopers.com/*
// @match        https://*.citymarket.com/*
// @match        https://*.smithsfoodanddrug.com/*
// @match        https://*.fredmeyer.com/*
// @match        https://*.qfc.com/*
// @match        https://*.dillons.com/*
// @match        https://*.bakersplus.com/*
// @match        https://*.gerbes.com/*
// @match        https://*.jaycfoods.com/*
// @match        https://*.marianos.com/*
// @match        https://*.metromarket.net/*
// @match        https://*.picknsave.com/*
// @match        https://*.food4less.com/*
// @match        https://*.foodsco.net/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==
(function () {
  "use strict";

  // ── Why DOM-click instead of an API ──────────────────────────────────────
  // Unlike Albertsons (clean `ecomgallery` JSON → no cap), Kroger has no public
  // "all offers" endpoint. Every working Kroger clipper clicks the on-page clip
  // buttons, which is capped at the ~150 coupons the page lazy-renders. So this
  // adapter scrolls to load every card, then clicks each unclipped clip button
  // serially with a human-like jittered gap (bot-detection friendly). Run it
  // again after new coupons drop. To re-verify selectors or capture a real API,
  // see browser/kroger-probe.js.

  const MIN_GAP_MS = 350, MAX_GAP_MS = 750;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gap = () => MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);

  // Kroger Design System clip-button selectors. Classes have drifted across
  // redesigns, so match several known variants; the text/aria pass below is the
  // resilient fallback. If a future redesign breaks these, the probe reports the
  // current class names.
  const CLIP_SELECTORS = [
    "button.kds-Button--favorable",
    "button.CouponCard-button.kds-Button--primary",
    'button[data-testid="coupon-add-button"]',
  ];
  // A button is "already done" (skip it) when it reads as clipped/added.
  const isClipped = (b) => {
    const t = (b.textContent || "").trim().toLowerCase();
    const a = (b.getAttribute("aria-label") || "").toLowerCase();
    return (
      b.disabled ||
      b.getAttribute("aria-pressed") === "true" ||
      /clipped|unclip|added|remove|in cart/.test(t) ||
      /clipped|added|unclip/.test(a)
    );
  };
  // A button is a clip target when it looks like an unclipped "Clip" action.
  const looksClippable = (b) => {
    const t = (b.textContent || "").trim().toLowerCase();
    const a = (b.getAttribute("aria-label") || "").toLowerCase();
    return t === "clip" || t === "clip coupon" || /^clip\b/.test(a);
  };

  function collectClipButtons() {
    const set = new Set();
    for (const sel of CLIP_SELECTORS) {
      document.querySelectorAll(sel).forEach((b) => { if (!isClipped(b)) set.add(b); });
    }
    document.querySelectorAll("button").forEach((b) => {
      if (looksClippable(b) && !isClipped(b)) set.add(b);
    });
    return [...set];
  }

  // Kroger lazy-loads coupon cards on scroll. Scroll to the bottom until the
  // card count stops growing (or we hit a sane ceiling), so we see them all.
  async function loadAllCards(onProgress) {
    let last = -1, stable = 0;
    for (let i = 0; i < 40 && stable < 3; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
      const n = document.querySelectorAll("button").length;
      stable = n === last ? stable + 1 : 0;
      last = n;
      onProgress(collectClipButtons().length);
    }
    window.scrollTo(0, 0);
  }

  function overlay() {
    const el = document.createElement("div");
    el.id = "cc-overlay";
    el.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;" +
      "justify-content:center;z-index:2147483646;font:16px -apple-system,Segoe UI,Roboto,sans-serif";
    el.innerHTML =
      '<div style="background:#1a2129;color:#eef2f5;padding:24px 28px;border-radius:14px;text-align:center;' +
      'min-width:280px;box-shadow:0 12px 40px rgba(0,0,0,.5)">' +
      '<div id="cc-msg" style="margin-bottom:12px;line-height:1.5">Finding all coupons…</div>' +
      '<div id="cc-count" style="font-weight:600;margin-bottom:14px">0 / 0</div>' +
      '<div style="background:#2b3947;border-radius:8px;height:14px;width:260px;margin:0 auto 14px">' +
      '<div id="cc-bar" style="background:#38c172;height:100%;width:0%;border-radius:8px;transition:width .2s"></div></div>' +
      '<button id="cc-stop" style="background:#ff4d4f;color:#fff;border:none;padding:8px 16px;' +
      'border-radius:6px;cursor:pointer">Stop</button></div>';
    document.body.appendChild(el);
    return el;
  }

  let running = false;
  async function clipAll() {
    if (running) return;
    running = true;
    const ov = overlay();
    const msg = ov.querySelector("#cc-msg");
    const cnt = ov.querySelector("#cc-count");
    const bar = ov.querySelector("#cc-bar");
    let stop = false;
    ov.querySelector("#cc-stop").onclick = () => { stop = true; };

    const finish = (text) => {
      msg.textContent = text;
      const sb = ov.querySelector("#cc-stop");
      sb.textContent = "Close";
      sb.onclick = () => ov.remove();
      running = false;
    };

    msg.textContent = "Loading all coupons (scrolling the page)…";
    await loadAllCards((n) => { cnt.textContent = n + " found"; });
    if (stop) return finish("Stopped.");

    // Clip in passes: clicking re-renders the list, so re-collect between passes
    // and keep going until nothing clippable remains or no progress is made.
    let clipped = 0, lastRemaining = -1, idleClicks = 0;
    for (let pass = 0; pass < 8 && !stop; pass++) {
      const buttons = collectClipButtons();
      if (!buttons.length) break;
      if (pass === 0 && buttons.length === 0) break;
      msg.textContent = "Clipping " + buttons.length + " coupons… please don't close this tab.";
      const total = clipped + buttons.length;
      for (const b of buttons) {
        if (stop) break;
        try { b.scrollIntoView({ block: "center" }); b.click(); clipped++; } catch (e) {}
        cnt.textContent = clipped + " / " + total;
        bar.style.width = Math.min(100, (clipped / total) * 100) + "%";
        await sleep(gap());
      }
      await sleep(1200); // let the list settle / lazy-load more
      const remaining = collectClipButtons().length;
      idleClicks = remaining === lastRemaining ? idleClicks + 1 : 0;
      lastRemaining = remaining;
      if (idleClicks >= 2) break; // no forward progress — stop hammering
    }

    bar.style.width = "100%";
    if (clipped === 0) {
      finish("No unclipped coupons found. If the page hadn't finished loading, reload and try again.");
    } else {
      finish(stop ? "Stopped — clipped " + clipped + " so far." :
        "Done! Clipped " + clipped + " coupon" + (clipped === 1 ? "" : "s") +
        ". (Kroger renders ~150 at a time — run again for more.)");
    }
  }

  function addButton() {
    if (document.getElementById("cc-fab")) return;
    const b = document.createElement("button");
    b.id = "cc-fab";
    b.textContent = "✂ Clip all coupons";
    Object.assign(b.style, {
      position: "fixed", bottom: "16px", right: "16px", zIndex: 2147483647,
      background: "#0c4ca3", color: "#fff", border: "none", borderRadius: "24px",
      padding: "12px 18px", fontWeight: "600", fontSize: "15px", cursor: "pointer",
      boxShadow: "0 6px 18px rgba(0,0,0,.35)", font: "600 15px -apple-system,Segoe UI,Roboto,sans-serif",
    });
    b.onclick = clipAll;
    document.body.appendChild(b);
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("Clip all coupons", clipAll);
  }
  addButton();
  // Kroger is a SPA — re-add the button after client-side navigation.
  new MutationObserver(() => addButton()).observe(document.documentElement, { childList: true, subtree: true });
})();

// ==UserScript==
// @name         Clip-All Coupons — Kroger
// @namespace    https://github.com/nathanrcast/clip-all-coupons
// @version      0.3.0
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

  // Each coupon card renders one action button (2026-09 citrus redesign):
  //   <button data-testid="CouponActionButton-<couponId>"
  //           aria-label="Clip for coupon: <desc> coupon">Clip</button>
  // The verb (aria prefix / text) is the state: Clip → Clipping → Unclip, or
  // "Sign In To Clip" when logged out; a disabled "Clip" means the clip limit
  // was hit. Cash-back cards reuse the testid with "Get Cash Back" — left alone.
  const ACTION_SEL = 'button[data-testid^="CouponActionButton-"]';

  function isCouponsPath() {
    const p = location.pathname.toLowerCase();
    return /\/savings\b/.test(p) || /coupon/.test(p) || /\/cl\//.test(p);
  }

  function verb(b) {
    const a = (b.getAttribute("aria-label") || "").trim().toLowerCase();
    const m = a.match(/^(.*?) for coupon:/);
    return m ? m[1] : (b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  const isClippable = (b) =>
    verb(b) === "clip" && !b.disabled && b.getAttribute("aria-disabled") !== "true";

  function actionButtons() {
    const set = new Set(document.querySelectorAll(ACTION_SEL));
    // Fallback if the testid is renamed again: exact "Clip" buttons inside <main>.
    if (!set.size) {
      (document.querySelector("main") || document.body)
        .querySelectorAll("button").forEach((b) => { if (verb(b) === "clip") set.add(b); });
    }
    return [...set];
  }

  const collectClipButtons = () => actionButtons().filter(isClippable);

  function pageState() {
    const bs = actionButtons();
    return {
      signedOut: bs.some((b) => verb(b) === "sign in to clip"),
      limited: bs.filter((b) => verb(b) === "clip" && !isClippable(b)).length,
    };
  }

  // React may swap the node after a click — re-find it by testid.
  const current = (b) => {
    const id = b.getAttribute("data-testid");
    return (id && document.querySelector(`button[data-testid="${id}"]`)) || b;
  };

  async function waitClipped(b) {
    for (let t = 0; t < 3000; t += 150) {
      await sleep(150);
      if (verb(current(b)) === "unclip") return true;
    }
    return false;
  }

  // Kroger infinite-scrolls the grid (window scroll). Scroll until the card
  // count stops growing and no spinner is showing. Honors shouldStop.
  async function loadAllCards(onProgress, shouldStop) {
    let last = -1, stable = 0;
    for (let i = 0; i < 120 && stable < 3 && !shouldStop(); i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
      const n = actionButtons().length;
      const busy = !!document.querySelector(".CouponsCatalogue-infiniteScrollSpinner");
      stable = n === last && !busy ? stable + 1 : 0;
      last = n;
      onProgress(n);
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
    if (!isCouponsPath()) {
      const ok = confirm(
        "This doesn't look like the Kroger coupons page (savings / coupons). Open that page first for best results.\n\nContinue anyway?"
      );
      if (!ok) return;
    }
    running = true;
    const ov = overlay();
    const msg = ov.querySelector("#cc-msg");
    const cnt = ov.querySelector("#cc-count");
    const bar = ov.querySelector("#cc-bar");
    let stop = false;
    ov.querySelector("#cc-stop").onclick = () => { stop = true; };

    const finish = (text, countText) => {
      msg.textContent = text;
      if (countText != null) cnt.textContent = countText;
      const sb = ov.querySelector("#cc-stop");
      sb.textContent = "Close";
      sb.onclick = () => ov.remove();
      running = false;
    };

    msg.textContent = "Loading all coupons (scrolling the page)…";
    await loadAllCards((n) => { cnt.textContent = n + " coupons loaded"; }, () => stop);
    if (stop) return finish("Stopped.");

    // First pass size is the progress denominator (avoids jumping totals).
    let buttons = collectClipButtons();
    if (!buttons.length) {
      const st = pageState();
      return finish(
        st.signedOut ? "You're signed out — sign in to your Kroger account, then try again."
          : st.limited ? "Kroger's coupon clip limit is reached — unclip or use some coupons first."
          : "No unclipped coupons found. If the page hadn't finished loading, reload and try again."
      );
    }
    const runTotal = buttons.length;
    let attempts = 0, verified = 0, lastRemaining = -1, idlePasses = 0;

    for (let pass = 0; pass < 8 && !stop; pass++) {
      if (pass > 0) {
        buttons = collectClipButtons();
        if (!buttons.length) break;
      }
      msg.textContent = "Clipping coupons… please don't close this tab.";
      for (const b of buttons) {
        if (stop) break;
        const btn = current(b);
        if (!isClippable(btn)) continue;
        try {
          btn.scrollIntoView({ block: "center" });
          btn.click();
          attempts++;
          if (await waitClipped(btn)) verified++;
        } catch (e) { /* ignore */ }
        cnt.textContent = `${attempts} attempted · ${verified} clipped (of ~${runTotal})`;
        bar.style.width = Math.min(100, (attempts / runTotal) * 100) + "%";
        await sleep(gap());
      }
      if (pageState().limited) break;
      await sleep(1200);
      const remaining = collectClipButtons().length;
      idlePasses = remaining === lastRemaining ? idlePasses + 1 : 0;
      lastRemaining = remaining;
      if (idlePasses >= 2) break;
    }

    bar.style.width = "100%";
    const limited = pageState().limited > 0;
    if (attempts === 0) {
      finish("No unclipped coupons found. If the page hadn't finished loading, reload and try again.");
    } else {
      const summary = `${verified} clipped · ${attempts} attempted`;
      finish(
        stop
          ? `Stopped — ${verified} clipped so far.`
          : limited
            ? `Clipped ${verified} coupon${verified === 1 ? "" : "s"} — Kroger's clip limit is now reached.`
            : `Done! Clipped ${verified} coupon${verified === 1 ? "" : "s"}. Run again anytime to catch new or missed ones.`,
        summary
      );
    }
  }

  function addButton() {
    if (!isCouponsPath()) {
      const existing = document.getElementById("cc-fab");
      if (existing) existing.remove();
      return;
    }
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

  let fabTimer = null;
  function scheduleAddButton() {
    if (running) return;
    if (fabTimer) clearTimeout(fabTimer);
    fabTimer = setTimeout(addButton, 200);
  }

  addButton();
  // Kroger is a SPA — re-add the button after client-side navigation (debounced).
  new MutationObserver(scheduleAddButton).observe(document.body, { childList: true, subtree: true });
})();

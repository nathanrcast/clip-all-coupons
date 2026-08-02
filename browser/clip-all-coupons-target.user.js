// ==UserScript==
// @name         Clip-All Coupons — Target Circle
// @namespace    https://github.com/nathanrcast/clip-all-coupons
// @version      0.2.1
// @description  Save/activate Target Circle manufacturer coupons & bonuses in one tap (DOM click; optional loyalty API). Firefox + mobile friendly.
// @author       ncastel
// @homepageURL  https://github.com/nathanrcast/clip-all-coupons
// @downloadURL  https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons-target.user.js
// @updateURL    https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons-target.user.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9C%82%3C/text%3E%3C/svg%3E
// @match        https://*.target.com/*
// @match        https://target.com/*
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==
(function () {
  "use strict";

  // ── Why DOM-first (API save is secondary) ────────────────────────────────
  // Live HAR (2026-08-02): GET loyalty_guest_offerlists/v1/external works, but
  // loyalty_offer_groups/v1/categories returns 502 on CORS preflight — fetch
  // throws and (in v0.1.0) aborted before DOM fallback. Offer grids on
  // /deals/all?facet=tap_to_apply are slingshot/CDUI-rendered; the reliable
  // path is clicking Save/Apply buttons (data-test=save-circle-offer-button).
  // Most store deals auto-apply since 2024-04 — this targets coupons/bonuses.
  // total_earned_slots often reads 75 (legacy marketed cap) but is NOT a reliable
  // hard stop — live runs can save far more. Only stop on an on-page maxed modal.

  const PW = (typeof unsafeWindow !== "undefined" && unsafeWindow) || window;

  const MIN_GAP_MS = 350, MAX_GAP_MS = 750;
  const REQ_TIMEOUT_MS = 12000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gap = () => MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);

  const FALLBACK_BASE = "https://api.target.com";
  const FALLBACK_API_KEY = "a5ae7fb188e78581614e4909f407462d8392b977";
  const FALLBACK_CLIENT_KEY = "NX1a8HGstVgSEONL1pMdNw==";
  const PATH_SAVED = "loyalty_guest_offerlists/v1/external";

  // Prefer exact live selectors; avoid CSS [attr i] (spotty in some engines).
  const SAVE_BTN_SELS = [
    'button[data-test="save-circle-offer-button"]',
    'button[data-test="save-button"]',
    'button[data-test="cta-offer"]',
    '[data-test="save-circle-offer-button"]',
    '[data-test="cta-offer"] button',
  ];
  // CTA language flag can yield "Save offer", "Apply", "Save <title>", etc.
  const SAVE_START_RE = /^(save|activate|apply)\b/i;
  const DONE_RE = /^(offer\s+)?(saved|applied|activated)\b|^remove\b|^unsave\b|applied in cart|already saved/i;
  const MAXED_RE = /free up some space|max(ed)?\s*(deals|offers)|offer limit|too many|filled_slots|no more room/i;

  function isCouponsPath() {
    const p = location.pathname.toLowerCase();
    const q = location.search.toLowerCase();
    return (
      /\/circle\b/.test(p) ||
      /target-circle/.test(p) ||
      /\/deals\b/.test(p) ||
      /\/bonus\b/.test(p) ||
      /\/myoffers\b/.test(p) ||
      /\/saveddeals\b/.test(p) ||
      /\/redeemoffers\b/.test(p) ||
      /tap_to_apply|circle_deals/.test(q)
    );
  }

  function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  function getConfig() {
    const api = PW.__CONFIG__?.services?.apiPlatform || {};
    const lists = api.apis?.loyaltyGuestOfferLists?.endpointPaths || {};
    const keys = api.circleOfferLoyaltyKeys || {};
    return {
      baseUrl: (api.baseUrl || FALLBACK_BASE).replace(/\/$/, ""),
      apiKey: keys.loyaltyApiKey || FALLBACK_API_KEY,
      clientKey: keys.loyaltyClientKey || FALLBACK_CLIENT_KEY,
      savedPath: lists.getSavedOffersV1 || PATH_SAVED,
    };
  }

  /** Optional: read save-slot usage. Never throws — categories/collections are intentionally unused (502). */
  async function readSavedMeta() {
    try {
      const cfg = getConfig();
      const url = `${cfg.baseUrl}/${cfg.savedPath.replace(/^\//, "")}`;
      const r = await fetchWithTimeout(url, {
        headers: {
          Accept: "application/json",
          Authorization: cfg.clientKey,
          "x-api-key": cfg.apiKey,
        },
        credentials: "include",
      }, REQ_TIMEOUT_MS);
      if (!r.ok) return null;
      const json = await r.json().catch(() => null);
      // Response may be array of list objects or a single object.
      const rows = Array.isArray(json) ? json : json ? [json] : [];
      let filled = 0, earned = 0, savedCount = 0;
      for (const row of rows) {
        const meta = row?.user_meta_data || row?.userMetaData || {};
        if (meta.total_filled_slots != null) filled = Number(meta.total_filled_slots) || filled;
        if (meta.total_earned_slots != null) earned = Number(meta.total_earned_slots) || earned;
        const offers = row?.offers;
        if (Array.isArray(offers)) savedCount += offers.length;
      }
      return { filled, earned, savedCount };
    } catch (e) {
      console.warn("[clip-all-target] saved meta", e);
      return null;
    }
  }

  function btnLabel(b) {
    const aria = (b.getAttribute("aria-label") || "").trim();
    const text = (b.textContent || "").trim().replace(/\s+/g, " ");
    return { aria, text, both: (aria + " " + text).trim() };
  }

  function isClipped(b) {
    if (b.disabled || b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-disabled") === "true") {
      return true;
    }
    const { aria, text } = btnLabel(b);
    if (DONE_RE.test(aria) || DONE_RE.test(text)) return true;
    // Confirmed BaseConfirmationButton often keeps initial text but sets data/class.
    const dt = (b.getAttribute("data-test") || "") + " " + (b.className || "");
    if (/confirmed|is-confirmed|offer-saved/i.test(dt) && !SAVE_START_RE.test(text) && !SAVE_START_RE.test(aria)) {
      return true;
    }
    return false;
  }

  function looksSavable(b) {
    if (isClipped(b)) return false;
    const dt = (b.getAttribute("data-test") || "").toLowerCase();
    if (dt === "save-circle-offer-button" || dt === "save-button") return true;
    const { aria, text } = btnLabel(b);
    if (SAVE_START_RE.test(aria) || SAVE_START_RE.test(text)) return true;
    // Parent wrapper sometimes holds data-test=cta-offer with an inner button.
    if (b.closest('[data-test="cta-offer"]') && (SAVE_START_RE.test(aria) || SAVE_START_RE.test(text) || !text)) {
      return !DONE_RE.test(aria) && !DONE_RE.test(text);
    }
    return false;
  }

  function maxedVisible() {
    const text = (document.body && document.body.innerText) || "";
    return MAXED_RE.test(text);
  }

  function couponsRoot() {
    return (
      document.querySelector('[data-test="offer-card"]')?.closest("main, [class*='OfferGrid'], body") ||
      document.querySelector("main") ||
      document.body
    );
  }

  function collectSaveButtons() {
    const root = couponsRoot();
    const set = new Set();
    for (const sel of SAVE_BTN_SELS) {
      try {
        root.querySelectorAll(sel).forEach((b) => {
          const el = b.tagName === "BUTTON" || b.getAttribute("role") === "button" ? b : b.querySelector("button") || b;
          if (looksSavable(el)) set.add(el);
        });
      } catch (e) { /* bad selector in older engines */ }
    }
    root.querySelectorAll("button").forEach((b) => {
      if (looksSavable(b)) set.add(b);
    });
    return [...set];
  }

  async function loadAllCards(onProgress, shouldStop) {
    let last = -1, stable = 0;
    for (let i = 0; i < 50 && stable < 3 && !shouldStop(); i++) {
      document.querySelectorAll("button").forEach((b) => {
        const t = (b.textContent || "").trim().toLowerCase();
        if (/^load more/.test(t) && !b.disabled) {
          try { b.click(); } catch (e) { /* ignore */ }
        }
      });
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(650);
      const n = collectSaveButtons().length;
      stable = n === last ? stable + 1 : 0;
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
      '<div id="cc-msg" style="margin-bottom:12px;line-height:1.5">Finding Circle offers…</div>' +
      '<div id="cc-count" style="font-weight:600;margin-bottom:14px">0 / 0</div>' +
      '<div style="background:#2b3947;border-radius:8px;height:14px;width:260px;margin:0 auto 14px">' +
      '<div id="cc-bar" style="background:#cc0000;height:100%;width:0%;border-radius:8px;transition:width .2s"></div></div>' +
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
        "This doesn't look like Target Circle / Deals. Open Deals → Coupons to apply (or Circle) first.\n\nContinue anyway?"
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

    try {
      msg.textContent = "Checking saved Circle offers…";
      // Informational only — do NOT gate on filled/earned (earned is often a stale
      // "75" while filled can be hundreds after a successful mass-save).
      const meta = await readSavedMeta();
      if (stop) return finish("Stopped.");

      msg.textContent = "Loading offers (scrolling the page)…";
      await loadAllCards((n) => {
        cnt.textContent = meta && meta.savedCount
          ? `${n} to save · ${meta.savedCount} already saved`
          : n + " found";
      }, () => stop);
      if (stop) return finish("Stopped.");

      let buttons = collectSaveButtons();
      if (!buttons.length) {
        return finish(
          meta && meta.savedCount
            ? "No unsaved coupons/bonuses on this page. Try Deals → Coupons to apply, or you're all caught up."
            : "No Save/Apply buttons found. Open https://www.target.com/deals/all?facet=tap_to_apply while signed in, wait for offers to load, then try again."
        );
      }

      const runTotal = buttons.length;
      let attempts = 0, verified = 0, lastRemaining = -1, idlePasses = 0, maxed = false;

      for (let pass = 0; pass < 8 && !stop && !maxed; pass++) {
        if (pass > 0) {
          buttons = collectSaveButtons();
          if (!buttons.length) break;
        }
        msg.textContent = "Saving Circle offers… please don't close this tab.";
        for (const b of buttons) {
          if (stop) break;
          try {
            b.scrollIntoView({ block: "center", inline: "nearest" });
            b.click();
            attempts++;
            await sleep(150);
            if (maxedVisible()) { maxed = true; break; }
            if (isClipped(b) || !b.isConnected) verified++;
          } catch (e) { /* ignore */ }
          cnt.textContent = `${attempts} attempted · ${verified} saved (of ~${runTotal})`;
          bar.style.width = Math.min(100, (attempts / runTotal) * 100) + "%";
          await sleep(gap());
        }
        await sleep(1000);
        if (maxed) break;
        const remaining = collectSaveButtons().length;
        idlePasses = remaining === lastRemaining ? idlePasses + 1 : 0;
        lastRemaining = remaining;
        if (idlePasses >= 2) break;
      }

      bar.style.width = "100%";
      const summary = `${verified} saved · ${attempts} attempted`;
      if (maxed) {
        return finish(
          `Saved ${verified} offer${verified === 1 ? "" : "s"}, then hit Target's save limit. Remove some saved deals and run again.`,
          summary
        );
      }
      if (!attempts) {
        return finish("No unsaved Circle offers found on this page.");
      }
      finish(
        stop
          ? `Stopped — ${verified} saved so far.`
          : `Done! Saved ${verified} Circle offer${verified === 1 ? "" : "s"}. (Store deals auto-apply — only coupons/bonuses need saving.)`,
        summary
      );
    } catch (e) {
      console.warn("[clip-all-target]", e);
      finish("Something went wrong. Reload the Deals page and try again.");
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
    b.textContent = "✂ Save all Circle offers";
    Object.assign(b.style, {
      position: "fixed", bottom: "16px", right: "16px", zIndex: 2147483647,
      background: "#cc0000", color: "#fff", border: "none", borderRadius: "24px",
      padding: "12px 18px", fontWeight: "600", fontSize: "15px", cursor: "pointer",
      boxShadow: "0 6px 18px rgba(0,0,0,.35)", font: "600 15px -apple-system,Segoe UI,Roboto,sans-serif",
    });
    b.onclick = clipAll;
    document.body.appendChild(b);
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("Save all Circle offers", clipAll);
  }

  let fabTimer = null;
  function scheduleAddButton() {
    if (running) return;
    if (fabTimer) clearTimeout(fabTimer);
    fabTimer = setTimeout(addButton, 200);
  }

  addButton();
  new MutationObserver(scheduleAddButton).observe(document.documentElement || document.body, {
    childList: true, subtree: true,
  });
})();

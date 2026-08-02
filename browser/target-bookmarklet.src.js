/* Source for the Clip-All Coupons — Target Circle bookmarklet. Self-contained IIFE.
 * Build: ./browser/build-bookmarklet.sh
 * DOM-first (v0.2): clicks Save/Apply on /deals/all?facet=tap_to_apply. Categories
 * API 502'd in live use — do not rely on offer-group enumeration.
 */
(function () {
  "use strict";
  if (window.__ccRunning) return;
  window.__ccRunning = true;
  var MIN_GAP = 350, MAX_GAP = 750, REQ_TIMEOUT = 12000;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var gap = function () { return MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP); };
  var FALLBACK_BASE = "https://api.target.com";
  var FALLBACK_API_KEY = "a5ae7fb188e78581614e4909f407462d8392b977";
  var FALLBACK_CLIENT_KEY = "NX1a8HGstVgSEONL1pMdNw==";
  var PATH_SAVED = "loyalty_guest_offerlists/v1/external";
  var SAVE_SELS = [
    'button[data-test="save-circle-offer-button"]',
    'button[data-test="save-button"]',
    'button[data-test="cta-offer"]',
    '[data-test="save-circle-offer-button"]',
    '[data-test="cta-offer"] button',
  ];
  var SAVE_START = /^(save|activate|apply)\b/i;
  var DONE_RE = /^(offer\s+)?(saved|applied|activated)\b|^remove\b|^unsave\b|applied in cart|already saved/i;
  var MAXED_RE = /free up some space|max(ed)?\s*(deals|offers)|offer limit|too many|no more room/i;

  function isCouponsPath() {
    var p = location.pathname.toLowerCase(), q = location.search.toLowerCase();
    return /\/circle\b/.test(p) || /target-circle/.test(p) || /\/deals\b/.test(p) ||
      /\/bonus\b/.test(p) || /\/myoffers\b/.test(p) || /\/saveddeals\b/.test(p) ||
      /tap_to_apply|circle_deals/.test(q);
  }
  function getConfig() {
    var api = (window.__CONFIG__ && window.__CONFIG__.services && window.__CONFIG__.services.apiPlatform) || {};
    var lists = (api.apis && api.apis.loyaltyGuestOfferLists && api.apis.loyaltyGuestOfferLists.endpointPaths) || {};
    var keys = api.circleOfferLoyaltyKeys || {};
    return {
      baseUrl: (api.baseUrl || FALLBACK_BASE).replace(/\/$/, ""),
      apiKey: keys.loyaltyApiKey || FALLBACK_API_KEY,
      clientKey: keys.loyaltyClientKey || FALLBACK_CLIENT_KEY,
      savedPath: lists.getSavedOffersV1 || PATH_SAVED,
    };
  }
  async function readSavedMeta() {
    try {
      var cfg = getConfig();
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, REQ_TIMEOUT);
      var r = await fetch(cfg.baseUrl + "/" + cfg.savedPath.replace(/^\//, ""), {
        headers: { Accept: "application/json", Authorization: cfg.clientKey, "x-api-key": cfg.apiKey },
        credentials: "include", signal: ctrl.signal,
      }).finally(function () { clearTimeout(t); });
      if (!r.ok) return null;
      var json = await r.json().catch(function () { return null; });
      var rows = Array.isArray(json) ? json : json ? [json] : [];
      var filled = 0, earned = 0, savedCount = 0;
      rows.forEach(function (row) {
        var meta = row.user_meta_data || row.userMetaData || {};
        if (meta.total_filled_slots != null) filled = Number(meta.total_filled_slots) || filled;
        if (meta.total_earned_slots != null) earned = Number(meta.total_earned_slots) || earned;
        if (Array.isArray(row.offers)) savedCount += row.offers.length;
      });
      return { filled: filled, earned: earned, savedCount: savedCount };
    } catch (e) { return null; }
  }
  function label(b) {
    return {
      aria: (b.getAttribute("aria-label") || "").trim(),
      text: (b.textContent || "").trim().replace(/\s+/g, " "),
    };
  }
  function clipped(b) {
    if (b.disabled || b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-disabled") === "true") return true;
    var L = label(b);
    return DONE_RE.test(L.aria) || DONE_RE.test(L.text);
  }
  function savable(b) {
    if (clipped(b)) return false;
    var dt = (b.getAttribute("data-test") || "").toLowerCase();
    if (dt === "save-circle-offer-button" || dt === "save-button") return true;
    var L = label(b);
    return SAVE_START.test(L.aria) || SAVE_START.test(L.text);
  }
  function maxedVisible() { return MAXED_RE.test((document.body && document.body.innerText) || ""); }
  function root() {
    var card = document.querySelector('[data-test="offer-card"]');
    return (card && card.closest("main")) || document.querySelector("main") || document.body;
  }
  function collect() {
    var r = root(), set = new Set();
    SAVE_SELS.forEach(function (sel) {
      try {
        r.querySelectorAll(sel).forEach(function (b) {
          var el = b.tagName === "BUTTON" || b.getAttribute("role") === "button" ? b : b.querySelector("button") || b;
          if (savable(el)) set.add(el);
        });
      } catch (e) {}
    });
    r.querySelectorAll("button").forEach(function (b) { if (savable(b)) set.add(b); });
    return Array.prototype.slice.call(set);
  }
  function overlay() {
    var el = document.createElement("div");
    el.id = "cc-overlay";
    el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;" +
      "justify-content:center;z-index:2147483646;font:16px -apple-system,Segoe UI,Roboto,sans-serif";
    el.innerHTML = '<div style="background:#1a2129;color:#eef2f5;padding:24px 28px;border-radius:14px;text-align:center;' +
      'min-width:280px;box-shadow:0 12px 40px rgba(0,0,0,.5)"><div id="cc-msg" style="margin-bottom:12px;line-height:1.5">' +
      'Finding Circle offers…</div><div id="cc-count" style="font-weight:600;margin-bottom:14px">0 / 0</div>' +
      '<div style="background:#2b3947;border-radius:8px;height:14px;width:260px;margin:0 auto 14px">' +
      '<div id="cc-bar" style="background:#cc0000;height:100%;width:0%;border-radius:8px;transition:width .2s"></div></div>' +
      '<button id="cc-stop" style="background:#ff4d4f;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Stop</button></div>';
    document.body.appendChild(el);
    return el;
  }

  (async function () {
    if (!isCouponsPath()) {
      if (!confirm("This doesn't look like Target Circle / Deals. Continue anyway?")) {
        window.__ccRunning = false; return;
      }
    }
    var ov = overlay(), msg = ov.querySelector("#cc-msg"), cnt = ov.querySelector("#cc-count"),
      bar = ov.querySelector("#cc-bar"), stop = false;
    ov.querySelector("#cc-stop").onclick = function () { stop = true; };
    function finish(text, countText) {
      msg.textContent = text;
      if (countText != null) cnt.textContent = countText;
      var sb = ov.querySelector("#cc-stop"); sb.textContent = "Close"; sb.onclick = function () { ov.remove(); };
      window.__ccRunning = false;
    }

    msg.textContent = "Checking saved Circle offers…";
    // Informational only — do not gate on filled/earned (earned often stale "75").
    var meta = await readSavedMeta();
    if (stop) return finish("Stopped.");

    msg.textContent = "Loading offers (scrolling the page)…";
    var last = -1, stable = 0;
    for (var i = 0; i < 50 && stable < 3 && !stop; i++) {
      document.querySelectorAll("button").forEach(function (b) {
        var t = (b.textContent || "").trim().toLowerCase();
        if (/^load more/.test(t) && !b.disabled) { try { b.click(); } catch (e) {} }
      });
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(650);
      var n = collect().length;
      stable = n === last ? stable + 1 : 0; last = n;
      cnt.textContent = meta && meta.savedCount ? (n + " to save · " + meta.savedCount + " already saved") : (n + " found");
    }
    window.scrollTo(0, 0);
    if (stop) return finish("Stopped.");

    var btns = collect();
    if (!btns.length) {
      return finish(meta && meta.savedCount
        ? "No unsaved coupons/bonuses on this page. Try Deals → Coupons to apply, or you're all caught up."
        : "No Save/Apply buttons found. Open Deals → Coupons to apply while signed in, wait for offers, then try again.");
    }
    var runTotal = btns.length, attempts = 0, verified = 0, lastRemaining = -1, idle = 0, hitMax = false;
    for (var pass = 0; pass < 8 && !stop && !hitMax; pass++) {
      if (pass > 0) { btns = collect(); if (!btns.length) break; }
      msg.textContent = "Saving Circle offers… please don't close this tab.";
      for (var j = 0; j < btns.length && !stop; j++) {
        try {
          btns[j].scrollIntoView({ block: "center", inline: "nearest" });
          btns[j].click();
          attempts++;
          await sleep(150);
          if (maxedVisible()) { hitMax = true; break; }
          if (clipped(btns[j]) || !btns[j].isConnected) verified++;
        } catch (e) {}
        cnt.textContent = attempts + " attempted · " + verified + " saved (of ~" + runTotal + ")";
        bar.style.width = Math.min(100, (attempts / runTotal) * 100) + "%";
        await sleep(gap());
      }
      await sleep(1000);
      if (hitMax) break;
      var remaining = collect().length;
      idle = remaining === lastRemaining ? idle + 1 : 0; lastRemaining = remaining;
      if (idle >= 2) break;
    }
    bar.style.width = "100%";
    var sum = verified + " saved · " + attempts + " attempted";
    if (hitMax) return finish("Saved " + verified + " offers, then hit Target's save limit. Remove some saved deals and run again.", sum);
    if (!attempts) return finish("No unsaved Circle offers found on this page.");
    finish(stop ? ("Stopped — " + verified + " saved so far.") :
      ("Done! Saved " + verified + " Circle offer" + (verified === 1 ? "" : "s") + "."), sum);
  })();
})();

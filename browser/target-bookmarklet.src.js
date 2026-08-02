/* Source for the Clip-All Coupons — Target Circle bookmarklet. Self-contained IIFE.
 * Build the javascript: URL with:  ./browser/build-bookmarklet.sh
 * Same API-first + DOM-fallback core as clip-all-coupons-target.user.js, minus the
 * floating button — it runs immediately when you tap the bookmark on a logged-in
 * Target Circle deals page. Most store deals auto-apply; this saves manufacturer
 * coupons & bonuses. Save-cap may stop a run early — remove saved deals and retry.
 */
(function () {
  "use strict";
  if (window.__ccRunning) return;
  window.__ccRunning = true;
  var MIN_GAP = 350, MAX_GAP = 750;
  var REQ_TIMEOUT = 15000, CLIP_RETRIES = 2, BLOCK_RETRY = 45000;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var gap = function () { return MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP); };
  var FALLBACK_BASE = "https://api.target.com";
  var FALLBACK_API_KEY = "a5ae7fb188e78581614e4909f407462d8392b977";
  var FALLBACK_CLIENT_KEY = "NX1a8HGstVgSEONL1pMdNw==";
  var PATH_SAVED = "loyalty_guest_offerlists/v1/external";
  var PATH_POST = "loyalty_guest_offerlists/v1/external";
  var PATH_CATEGORIES = "loyalty_offer_groups/v1/categories";
  var PATH_COLLECTIONS = "loyalty_offer_groups/v1/collections";
  var SAVE_SELS = [
    'button[data-test="save-button"]',
    'button[data-test*="offer" i]',
    'button[data-test*="deal" i]',
    'button[data-test*="bonus" i]',
  ];
  var SAVE_RE = /^(save|activate|apply)(\s+(offer|deal|bonus|coupon))?$/i;
  var DONE_RE = /saved|applied|activated|remove|unsave|added|in wallet|free up some space/i;
  var MAXED_RE = /free up some space|max(ed)?\s*(deals|offers)|offer limit|too many/i;

  function isCouponsPath() {
    var p = location.pathname.toLowerCase();
    return /\/circle\b/.test(p) || /target-circle/.test(p) || /\/deals\b/.test(p) ||
      /\/bonus\b/.test(p) || /\/myoffers\b/.test(p) || /\/saveddeals\b/.test(p);
  }
  function fetchWithTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(function () { clearTimeout(t); });
  }
  function getConfig() {
    var api = (window.__CONFIG__ && window.__CONFIG__.services && window.__CONFIG__.services.apiPlatform) || {};
    var lists = (api.apis && api.apis.loyaltyGuestOfferLists && api.apis.loyaltyGuestOfferLists.endpointPaths) || {};
    var groups = (api.apis && api.apis.loyaltyOfferGroups && api.apis.loyaltyOfferGroups.endpointPaths) || {};
    var keys = api.circleOfferLoyaltyKeys || {};
    return {
      baseUrl: (api.baseUrl || FALLBACK_BASE).replace(/\/$/, ""),
      apiKey: keys.loyaltyApiKey || FALLBACK_API_KEY,
      clientKey: keys.loyaltyClientKey || FALLBACK_CLIENT_KEY,
      savedPath: lists.getSavedOffersV1 || PATH_SAVED,
      postPath: lists.postOfferV1 || PATH_POST,
      categoriesPath: groups.getLoyaltyCategoriesV1 || PATH_CATEGORIES,
      categoryOffersPath: groups.getLoyaltyCategoryOffersV1 || PATH_CATEGORIES,
      collectionsPath: groups.getLoyaltyCollectionsV1 || PATH_COLLECTIONS,
      collectionOffersPath: groups.getLoyaltyCollectionOffersV1 || PATH_COLLECTIONS,
    };
  }
  function getStoreId() {
    try {
      var cookies = document.cookie.split(";");
      for (var i = 0; i < cookies.length; i++) {
        var parts = cookies[i].trim().split("=");
        var k = parts[0], v = decodeURIComponent(parts.slice(1).join("=") || "");
        if (/store|UserLocation|GuestLocation|fiats/i.test(k)) {
          var m = v.match(/\b(\d{3,5})\b/);
          if (m) return m[1];
        }
      }
    } catch (e) {}
    return "";
  }
  function headers(cfg) {
    return { Accept: "application/json", "Content-Type": "application/json",
      Authorization: cfg.clientKey, "x-api-key": cfg.apiKey };
  }
  var ID_KEYS = ["offerId", "offer_id", "offerID", "id"];
  var STATUS_KEYS = ["offerStatus", "offer_status", "status", "redemptionStatus", "redemption_status"];
  function looksSaved(o) {
    if (!o) return false;
    if (o.added === true || o.isAdded === true || o.saved === true) return true;
    for (var i = 0; i < STATUS_KEYS.length; i++) {
      var v = String(o[STATUS_KEYS[i]] || "").toLowerCase();
      if (/^(saved|applied|activated|clipped|redeemed|added)$/.test(v)) return true;
    }
    return false;
  }
  function extractOffers(data, into, seen) {
    if (Array.isArray(data)) { for (var i = 0; i < data.length; i++) extractOffers(data[i], into, seen); return; }
    if (data && typeof data === "object") {
      var idKey = null;
      for (var k = 0; k < ID_KEYS.length; k++) {
        if (data[ID_KEYS[k]] != null && /^[A-Za-z0-9._-]+$/.test(String(data[ID_KEYS[k]]))) { idKey = ID_KEYS[k]; break; }
      }
      if (idKey) {
        var looks = false;
        for (var s = 0; s < STATUS_KEYS.length; s++) if (data[STATUS_KEYS[s]] != null) looks = true;
        if (data.offer_description != null || data.offerDescription != null || data.title != null ||
            data.description != null || data.image_url != null || data.imageUrl != null ||
            data.added != null || data.legal_copy != null || data.legalCopy != null) looks = true;
        if (looks) {
          var id = String(data[idKey]);
          if (!seen.has(id)) { seen.add(id); into.push({ offerId: id, saved: looksSaved(data) }); }
        }
      }
      var vals = Object.keys(data);
      for (var j = 0; j < vals.length; j++) extractOffers(data[vals[j]], into, seen);
    }
  }
  function groupIds(data) {
    var ids = [], seen = new Set();
    (function walk(o) {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (!o || typeof o !== "object") return;
      var id = o.categoryId || o.category_id || o.collectionId || o.collection_id || o.id;
      if (id != null && (o.name != null || o.title != null || o.display_name != null || o.category_name != null)) {
        var s = String(id);
        if (!seen.has(s) && /^[A-Za-z0-9._-]+$/.test(s)) { seen.add(s); ids.push(s); }
      }
      Object.keys(o).forEach(function (k) { walk(o[k]); });
    })(data);
    return ids;
  }
  async function apiGet(cfg, path) {
    var url = cfg.baseUrl + "/" + path.replace(/^\//, "");
    var r = await fetchWithTimeout(url, { headers: headers(cfg), credentials: "include" }, REQ_TIMEOUT);
    if (r.status === 401 || r.status === 403) return { ok: false, blocked: true, status: r.status, json: null };
    if (!r.ok) return { ok: false, blocked: false, status: r.status, json: null };
    var json = await r.json().catch(function () { return null; });
    return { ok: true, blocked: false, status: r.status, json: json };
  }
  async function enumerateApi(cfg) {
    var offers = [], seen = new Set(), apiError = null, blocked = false;
    var saved = await apiGet(cfg, cfg.savedPath);
    if (saved.blocked) return { offers: [], source: "none", apiError: "saved HTTP " + saved.status, blocked: true };
    var savedIds = new Set();
    if (saved.ok) {
      var tmp = []; extractOffers(saved.json, tmp, new Set());
      tmp.forEach(function (o) { savedIds.add(o.offerId); });
    }
    async function pullGroup(listPath, itemPath, label) {
      var list = await apiGet(cfg, listPath);
      if (list.blocked) { apiError = label + " HTTP " + list.status; return true; }
      if (!list.ok) { apiError = apiError || (label + " HTTP " + list.status); return false; }
      extractOffers(list.json, offers, seen);
      var ids = groupIds(list.json);
      for (var i = 0; i < ids.length; i++) {
        var item = await apiGet(cfg, itemPath.replace(/\/$/, "") + "/" + encodeURIComponent(ids[i]));
        if (item.blocked) { apiError = label + "/" + ids[i] + " HTTP " + item.status; return true; }
        if (item.ok) extractOffers(item.json, offers, seen);
        await sleep(80);
      }
      return false;
    }
    blocked = await pullGroup(cfg.categoriesPath, cfg.categoryOffersPath, "categories");
    if (!blocked) blocked = await pullGroup(cfg.collectionsPath, cfg.collectionOffersPath, "collections");
    offers.forEach(function (o) { if (savedIds.has(o.offerId)) o.saved = true; });
    return { offers: offers, source: offers.length ? "api" : "none", apiError: apiError, blocked: !!blocked };
  }
  async function clipOne(cfg, offer, storeId) {
    var blockedOnce = false;
    for (var attempt = 0; attempt <= CLIP_RETRIES; attempt++) {
      try {
        var url = cfg.baseUrl + "/" + cfg.postPath.replace(/\/$/, "") + "/" + encodeURIComponent(offer.offerId);
        if (storeId) url += "?location_id=" + encodeURIComponent(storeId);
        var r = await fetchWithTimeout(url, { method: "POST", headers: headers(cfg), credentials: "include" }, REQ_TIMEOUT);
        if (r.status === 403 || r.status === 429) {
          if (!blockedOnce) { blockedOnce = true; await sleep(BLOCK_RETRY); continue; }
          return "blocked";
        }
        if (r.status === 409 || r.status === 422) {
          var t1 = await r.text().catch(function () { return ""; });
          return MAXED_RE.test(t1) ? "maxed" : "already";
        }
        if (r.status >= 500) {
          if (attempt < CLIP_RETRIES) { await sleep(1000 * Math.pow(3, attempt)); continue; }
          return "failed";
        }
        if (!r.ok) {
          var t2 = await r.text().catch(function () { return ""; });
          return MAXED_RE.test(t2) ? "maxed" : "failed";
        }
        var j = await r.json().catch(function () { return {}; });
        return MAXED_RE.test(JSON.stringify(j)) ? "maxed" : "clipped";
      } catch (e) {
        if (attempt < CLIP_RETRIES) { await sleep(1000 * Math.pow(3, attempt)); continue; }
        return "failed";
      }
    }
    return "failed";
  }

  function clipped(b) {
    var t = (b.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
    var a = (b.getAttribute("aria-label") || "").toLowerCase();
    return b.disabled || b.getAttribute("aria-pressed") === "true" || DONE_RE.test(t) || DONE_RE.test(a);
  }
  function savable(b) {
    var t = (b.textContent || "").trim().replace(/\s+/g, " ");
    var a = (b.getAttribute("aria-label") || "").trim();
    return SAVE_RE.test(t) || SAVE_RE.test(a) || /^(save|activate|apply)\b/i.test(a);
  }
  function maxedVisible() {
    return MAXED_RE.test((document.body && document.body.innerText) || "");
  }
  function collect() {
    var root = document.querySelector("main") || document.body, set = new Set();
    SAVE_SELS.forEach(function (sel) {
      root.querySelectorAll(sel).forEach(function (b) { if (!clipped(b) && savable(b)) set.add(b); });
    });
    root.querySelectorAll("button").forEach(function (b) { if (savable(b) && !clipped(b)) set.add(b); });
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
      if (!confirm("This doesn't look like a Target Circle / deals page. Continue anyway?")) {
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

    // API path
    var cfg = getConfig(), storeId = getStoreId();
    msg.textContent = "Loading Circle offers (API)…";
    var enumRes = await enumerateApi(cfg);
    if (stop) return finish("Stopped.");
    var pending = enumRes.offers.filter(function (o) { return !o.saved; });
    if (pending.length && !enumRes.blocked) {
      msg.textContent = "Saving Circle offers… please don't close this tab.";
      var clippedN = 0, already = 0, failed = 0, maxed = false, total = pending.length;
      for (var i = 0; i < pending.length && !stop; i++) {
        var res = await clipOne(cfg, pending[i], storeId);
        if (res === "clipped") clippedN++;
        else if (res === "already") already++;
        else if (res === "maxed") { maxed = true; break; }
        else if (res === "blocked") {
          return finish("Paused — Target blocked further saves (" + clippedN + " saved). Try again in a minute.",
            clippedN + " saved · " + already + " already · " + failed + " failed");
        } else failed++;
        cnt.textContent = (clippedN + already + failed) + " / " + total;
        bar.style.width = Math.min(100, ((i + 1) / total) * 100) + "%";
        await sleep(gap());
      }
      bar.style.width = "100%";
      var summary = clippedN + " saved · " + already + " already · " + failed + " failed";
      if (maxed) return finish("Saved " + clippedN + " offers, then hit Target's save limit. Remove some saved deals and run again.", summary);
      if (stop) return finish("Stopped — " + clippedN + " saved so far.", summary);
      return finish("Done! Saved " + clippedN + " Circle offer" + (clippedN === 1 ? "" : "s") +
        ". (Store deals auto-apply — only coupons/bonuses need saving.)", summary);
    }

    // DOM fallback
    msg.textContent = "API path unavailable — trying on-page buttons…";
    var last = -1, stable = 0;
    for (var li = 0; li < 40 && stable < 3 && !stop; li++) {
      document.querySelectorAll("button").forEach(function (b) {
        var t = (b.textContent || "").trim().toLowerCase();
        if (/^load more/.test(t) && !b.disabled) { try { b.click(); } catch (e) {} }
      });
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
      var n = collect().length;
      stable = n === last ? stable + 1 : 0; last = n;
      cnt.textContent = n + " found";
    }
    window.scrollTo(0, 0);
    if (stop) return finish("Stopped.");
    var btns = collect();
    if (!btns.length) {
      return finish(enumRes.source === "api" && enumRes.offers.length
        ? "All caught up! Every saveable Circle offer is already saved."
        : "No unsaved Circle offers found. Open Circle Deals while signed in and try again.");
    }
    var runTotal = btns.length, attempts = 0, verified = 0, lastRemaining = -1, idle = 0, hitMax = false;
    for (var pass = 0; pass < 8 && !stop && !hitMax; pass++) {
      if (pass > 0) { btns = collect(); if (!btns.length) break; }
      msg.textContent = "Saving Circle offers… please don't close this tab.";
      for (var j = 0; j < btns.length && !stop; j++) {
        try {
          btns[j].scrollIntoView({ block: "center" });
          btns[j].click();
          attempts++;
          await sleep(120);
          if (maxedVisible()) { hitMax = true; break; }
          if (clipped(btns[j]) || !btns[j].isConnected) verified++;
        } catch (e) {}
        cnt.textContent = attempts + " attempted · " + verified + " saved (of ~" + runTotal + ")";
        bar.style.width = Math.min(100, (attempts / runTotal) * 100) + "%";
        await sleep(gap());
      }
      await sleep(1200);
      if (hitMax) break;
      var remaining = collect().length;
      idle = remaining === lastRemaining ? idle + 1 : 0; lastRemaining = remaining;
      if (idle >= 2) break;
    }
    bar.style.width = "100%";
    var sum2 = verified + " saved · " + attempts + " attempted";
    if (hitMax) return finish("Saved " + verified + " offers, then hit Target's save limit. Remove some saved deals and run again.", sum2);
    if (!attempts) return finish("No unsaved Circle offers found on this page.");
    finish(stop ? ("Stopped — " + verified + " saved so far.") :
      ("Done! Saved " + verified + " Circle offer" + (verified === 1 ? "" : "s") + "."), sum2);
  })();
})();

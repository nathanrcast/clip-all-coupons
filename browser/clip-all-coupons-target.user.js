// ==UserScript==
// @name         Clip-All Coupons — Target Circle
// @namespace    https://github.com/nathanrcast/clip-all-coupons
// @version      0.1.0
// @description  Save/activate Target Circle manufacturer coupons & bonuses in one tap via the loyalty offer API (DOM fallback). Firefox + mobile friendly.
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

  // ── Why API-first (with DOM fallback) ────────────────────────────────────
  // Target Circle embeds loyalty offer endpoints in window.__CONFIG__ (same
  // public web-client keys the site uses). Most store deals auto-apply since
  // 2024-04; this tool saves/activates the offers that still need it
  // (manufacturer coupons, bonuses, rebates). Save-cap (/circle/maxedDeals)
  // still exists — stop cleanly when hit. If the API path fails, fall back to
  // clicking on-page Save/Activate buttons (Kroger-style). Re-verify with
  // browser/target-probe.js on a logged-in deals page.

  const PW = (typeof unsafeWindow !== "undefined" && unsafeWindow) || window;

  const MIN_GAP_MS = 350, MAX_GAP_MS = 750;
  const REQ_TIMEOUT_MS = 15000;
  const CLIP_RETRIES = 2;
  const BLOCK_RETRY_MS = 45000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gap = () => MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);

  // Public web-client fallbacks (embedded in every Target page load — not user secrets).
  const FALLBACK_BASE = "https://api.target.com";
  const FALLBACK_API_KEY = "a5ae7fb188e78581614e4909f407462d8392b977";
  const FALLBACK_CLIENT_KEY = "NX1a8HGstVgSEONL1pMdNw==";
  const PATH_SAVED = "loyalty_guest_offerlists/v1/external";
  const PATH_POST = "loyalty_guest_offerlists/v1/external";
  const PATH_CATEGORIES = "loyalty_offer_groups/v1/categories";
  const PATH_COLLECTIONS = "loyalty_offer_groups/v1/collections";

  const SAVE_BTN_SELS = [
    'button[data-test="save-button"]',
    'button[data-test*="offer" i]',
    'button[data-test*="deal" i]',
    'button[data-test*="bonus" i]',
  ];
  const SAVE_RE = /^(save|activate|apply)(\s+(offer|deal|bonus|coupon))?$/i;
  const DONE_RE = /saved|applied|activated|remove|unsave|added|in wallet|free up some space/i;
  const MAXED_RE = /free up some space|max(ed)?\s*(deals|offers)|offer limit|too many/i;

  function isCouponsPath() {
    const p = location.pathname.toLowerCase();
    return (
      /\/circle\b/.test(p) ||
      /target-circle/.test(p) ||
      /\/deals\b/.test(p) ||
      /\/bonus\b/.test(p) ||
      /\/myoffers\b/.test(p) ||
      /\/saveddeals\b/.test(p) ||
      /\/redeemoffers\b/.test(p)
    );
  }

  function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // ---- session / config ---------------------------------------------------
  function getConfig() {
    const api = PW.__CONFIG__?.services?.apiPlatform || {};
    const lists = api.apis?.loyaltyGuestOfferLists?.endpointPaths || {};
    const groups = api.apis?.loyaltyOfferGroups?.endpointPaths || {};
    const keys = api.circleOfferLoyaltyKeys || {};
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
    const tryNum = (v) => {
      const m = String(v || "").match(/\b(\d{3,5})\b/);
      return m ? m[1] : "";
    };
    try {
      const cookies = document.cookie.split(";").map((c) => c.trim());
      for (const c of cookies) {
        const [k, ...rest] = c.split("=");
        const v = decodeURIComponent(rest.join("=") || "");
        if (/store/i.test(k) && tryNum(v)) return tryNum(v);
        if (/UserLocation|GuestLocation|fiats/i.test(k) && tryNum(v)) return tryNum(v);
      }
    } catch (e) { /* ignore */ }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || "";
        if (/store/i.test(k)) {
          const n = tryNum(localStorage.getItem(k));
          if (n) return n;
        }
      }
    } catch (e) { /* ignore */ }
    const pref = PW.__CONFIG__?.services?.apiPlatform; // no store here — leave empty
    void pref;
    return "";
  }

  function headers(cfg) {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: cfg.clientKey,
      "x-api-key": cfg.apiKey,
    };
  }

  // ---- offer enumeration --------------------------------------------------
  const ID_KEYS = ["offerId", "offer_id", "offerID", "id"];
  const STATUS_KEYS = ["offerStatus", "offer_status", "status", "redemptionStatus", "redemption_status"];

  function looksSaved(o) {
    if (o == null) return false;
    if (o.added === true || o.isAdded === true || o.saved === true) return true;
    for (const k of STATUS_KEYS) {
      const v = String(o[k] || "").toLowerCase();
      if (/^(saved|applied|activated|clipped|redeemed|added)$/.test(v)) return true;
    }
    return false;
  }

  function extractOffers(data, into, seen) {
    if (Array.isArray(data)) {
      for (const x of data) extractOffers(x, into, seen);
      return;
    }
    if (data && typeof data === "object") {
      const idKey = ID_KEYS.find(
        (k) => data[k] != null && /^[A-Za-z0-9._-]+$/.test(String(data[k]))
      );
      if (idKey) {
        const looksOffer =
          STATUS_KEYS.some((k) => data[k] != null) ||
          data.offer_description != null || data.offerDescription != null ||
          data.title != null || data.description != null ||
          data.image_url != null || data.imageUrl != null ||
          data.added != null || data.legal_copy != null || data.legalCopy != null;
        if (looksOffer) {
          const id = String(data[idKey]);
          if (!seen.has(id)) {
            seen.add(id);
            into.push({ offerId: id, saved: looksSaved(data), raw: data });
          }
        }
      }
      for (const v of Object.values(data)) extractOffers(v, into, seen);
    }
  }

  function groupIds(data) {
    const ids = [];
    const seen = new Set();
    const walk = (o) => {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (!o || typeof o !== "object") return;
      const id = o.categoryId || o.category_id || o.collectionId || o.collection_id || o.id;
      if (id != null && (o.name != null || o.title != null || o.display_name != null || o.category_name != null)) {
        const s = String(id);
        if (!seen.has(s) && /^[A-Za-z0-9._-]+$/.test(s)) { seen.add(s); ids.push(s); }
      }
      for (const v of Object.values(o)) walk(v);
    };
    walk(data);
    return ids;
  }

  async function apiGet(cfg, path) {
    const url = `${cfg.baseUrl}/${path.replace(/^\//, "")}`;
    const r = await fetchWithTimeout(url, { headers: headers(cfg), credentials: "include" }, REQ_TIMEOUT_MS);
    if (r.status === 401 || r.status === 403) return { ok: false, blocked: true, status: r.status, json: null };
    if (!r.ok) return { ok: false, blocked: false, status: r.status, json: null };
    const json = await r.json().catch(() => null);
    return { ok: true, blocked: false, status: r.status, json };
  }

  async function enumerateApi(cfg) {
    const offers = [];
    const seen = new Set();
    let source = "none";
    let apiError = null;

    const saved = await apiGet(cfg, cfg.savedPath);
    if (saved.blocked) return { offers: [], source: "none", apiError: `saved HTTP ${saved.status}`, blocked: true };
    const savedIds = new Set();
    if (saved.ok) {
      const tmp = [];
      extractOffers(saved.json, tmp, new Set());
      tmp.forEach((o) => savedIds.add(o.offerId));
    }

    const pullGroup = async (listPath, itemPath, label) => {
      const list = await apiGet(cfg, listPath);
      if (list.blocked) { apiError = `${label} HTTP ${list.status}`; return true; }
      if (!list.ok) { apiError = apiError || `${label} HTTP ${list.status}`; return false; }
      const ids = groupIds(list.json);
      // Also harvest any offers nested in the list response itself.
      extractOffers(list.json, offers, seen);
      for (const id of ids) {
        const item = await apiGet(cfg, `${itemPath.replace(/\/$/, "")}/${encodeURIComponent(id)}`);
        if (item.blocked) { apiError = `${label}/${id} HTTP ${item.status}`; return true; }
        if (item.ok) extractOffers(item.json, offers, seen);
        await sleep(80);
      }
      return false;
    };

    let blocked = await pullGroup(cfg.categoriesPath, cfg.categoryOffersPath, "categories");
    if (!blocked) blocked = await pullGroup(cfg.collectionsPath, cfg.collectionOffersPath, "collections");

    // Mark already-saved from the saved list and from offer fields.
    for (const o of offers) {
      if (savedIds.has(o.offerId)) o.saved = true;
    }

    if (offers.length) source = "api";
    return { offers, source, apiError, blocked: !!blocked };
  }

  // ---- clip (API) ---------------------------------------------------------
  async function clipOneOnce(cfg, offer, storeId) {
    let url = `${cfg.baseUrl}/${cfg.postPath.replace(/\/$/, "")}/${encodeURIComponent(offer.offerId)}`;
    if (storeId) url += `?location_id=${encodeURIComponent(storeId)}`;
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: headers(cfg),
      credentials: "include",
    }, REQ_TIMEOUT_MS);
    if (r.status === 403 || r.status === 429) return "blocked";
    if (r.status === 409 || r.status === 422) {
      // Likely already saved or at capacity — peek body.
      const t = await r.text().catch(() => "");
      if (MAXED_RE.test(t)) return "maxed";
      return "already";
    }
    if (r.status >= 500) return "retry";
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      if (MAXED_RE.test(t)) return "maxed";
      console.warn("[clip-all-target] save failed", offer.offerId, r.status);
      return "failed";
    }
    const j = await r.json().catch(() => ({}));
    const blob = JSON.stringify(j);
    if (MAXED_RE.test(blob)) return "maxed";
    return "clipped";
  }

  async function clipOne(cfg, offer, storeId) {
    let blockedOnce = false;
    for (let attempt = 0; attempt <= CLIP_RETRIES; attempt++) {
      try {
        const res = await clipOneOnce(cfg, offer, storeId);
        if (res === "blocked") {
          if (!blockedOnce) {
            blockedOnce = true;
            await sleep(BLOCK_RETRY_MS);
            continue;
          }
          return "blocked";
        }
        if (res === "retry") {
          if (attempt < CLIP_RETRIES) {
            await sleep(1000 * Math.pow(3, attempt));
            continue;
          }
          return "failed";
        }
        return res;
      } catch (e) {
        if (attempt < CLIP_RETRIES) {
          await sleep(1000 * Math.pow(3, attempt));
          continue;
        }
        console.warn("[clip-all-target] save error", offer.offerId, e);
        return "failed";
      }
    }
    return "failed";
  }

  // ---- DOM fallback -------------------------------------------------------
  function isClipped(b) {
    const t = (b.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
    const a = (b.getAttribute("aria-label") || "").toLowerCase();
    return (
      b.disabled ||
      b.getAttribute("aria-pressed") === "true" ||
      DONE_RE.test(t) ||
      DONE_RE.test(a)
    );
  }

  function looksSavable(b) {
    const t = (b.textContent || "").trim().replace(/\s+/g, " ");
    const a = (b.getAttribute("aria-label") || "").trim();
    return SAVE_RE.test(t) || SAVE_RE.test(a) || /^(save|activate|apply)\b/i.test(a);
  }

  function maxedVisible() {
    const text = (document.body && document.body.innerText) || "";
    return MAXED_RE.test(text);
  }

  function collectSaveButtons() {
    const root = document.querySelector("main") || document.body;
    const set = new Set();
    for (const sel of SAVE_BTN_SELS) {
      root.querySelectorAll(sel).forEach((b) => { if (!isClipped(b) && looksSavable(b)) set.add(b); });
    }
    root.querySelectorAll("button").forEach((b) => {
      if (looksSavable(b) && !isClipped(b)) set.add(b);
    });
    return [...set];
  }

  function countSaveCandidates() {
    return collectSaveButtons().length;
  }

  async function loadAllCards(onProgress, shouldStop) {
    let last = -1, stable = 0;
    for (let i = 0; i < 40 && stable < 3 && !shouldStop(); i++) {
      // Click any visible "Load more" first, then scroll.
      document.querySelectorAll("button").forEach((b) => {
        const t = (b.textContent || "").trim().toLowerCase();
        if (/^load more/.test(t) && !b.disabled) {
          try { b.click(); } catch (e) { /* ignore */ }
        }
      });
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
      const n = countSaveCandidates();
      stable = n === last ? stable + 1 : 0;
      last = n;
      onProgress(n);
    }
    window.scrollTo(0, 0);
  }

  // ---- UI -----------------------------------------------------------------
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

  async function runApiPath(ov, msg, cnt, bar, stopFlag) {
    const cfg = getConfig();
    const storeId = getStoreId();
    msg.textContent = "Loading Circle offers (API)…";
    const { offers, source, apiError, blocked } = await enumerateApi(cfg);
    if (stopFlag()) return { done: true, text: "Stopped." };
    if (blocked) return { done: false, reason: "blocked", detail: apiError };
    const pending = offers.filter((o) => !o.saved);
    if (!pending.length) {
      if (source === "api" && offers.length) {
        return { done: true, text: "All caught up! Every saveable Circle offer is already saved." };
      }
      return { done: false, reason: "empty", detail: apiError };
    }

    msg.textContent = "Saving Circle offers… please don't close this tab.";
    let clipped = 0, already = 0, failed = 0, maxed = false;
    const total = pending.length;
    for (let i = 0; i < pending.length && !stopFlag(); i++) {
      const res = await clipOne(cfg, pending[i], storeId);
      if (res === "clipped") clipped++;
      else if (res === "already") already++;
      else if (res === "maxed") { maxed = true; break; }
      else if (res === "blocked") {
        return {
          done: true,
          text: `Paused — Target blocked further saves (${clipped} saved). Try again in a minute.`,
          count: `${clipped} saved · ${already} already · ${failed} failed`,
        };
      } else failed++;
      cnt.textContent = `${clipped + already + failed} / ${total}`;
      bar.style.width = Math.min(100, ((i + 1) / total) * 100) + "%";
      await sleep(gap());
    }
    bar.style.width = "100%";
    const summary = `${clipped} saved · ${already} already · ${failed} failed`;
    if (maxed) {
      return {
        done: true,
        text: `Saved ${clipped} offer${clipped === 1 ? "" : "s"}, then hit Target's save limit. Remove some saved deals and run again.`,
        count: summary,
      };
    }
    if (stopFlag()) {
      return { done: true, text: `Stopped — ${clipped} saved so far.`, count: summary };
    }
    return {
      done: true,
      text: `Done! Saved ${clipped} Circle offer${clipped === 1 ? "" : "s"}. (Store deals auto-apply — only coupons/bonuses need saving.)`,
      count: summary,
    };
  }

  async function runDomPath(ov, msg, cnt, bar, stopFlag) {
    msg.textContent = "Loading offers (scrolling the page)…";
    await loadAllCards((n) => { cnt.textContent = n + " found"; }, stopFlag);
    if (stopFlag()) return { text: "Stopped." };

    let buttons = collectSaveButtons();
    if (!buttons.length) {
      return { text: "No unsaved Circle offers found on this page. Open Circle Deals while signed in, or try again after the page finishes loading." };
    }
    const runTotal = buttons.length;
    let attempts = 0, verified = 0, lastRemaining = -1, idlePasses = 0, maxed = false;

    for (let pass = 0; pass < 8 && !stopFlag() && !maxed; pass++) {
      if (pass > 0) {
        buttons = collectSaveButtons();
        if (!buttons.length) break;
      }
      msg.textContent = "Saving Circle offers… please don't close this tab.";
      for (const b of buttons) {
        if (stopFlag()) break;
        try {
          b.scrollIntoView({ block: "center" });
          b.click();
          attempts++;
          await sleep(120);
          if (maxedVisible()) { maxed = true; break; }
          if (isClipped(b) || !b.isConnected) verified++;
        } catch (e) { /* ignore */ }
        cnt.textContent = `${attempts} attempted · ${verified} saved (of ~${runTotal})`;
        bar.style.width = Math.min(100, (attempts / runTotal) * 100) + "%";
        await sleep(gap());
      }
      await sleep(1200);
      if (maxed) break;
      const remaining = collectSaveButtons().length;
      idlePasses = remaining === lastRemaining ? idlePasses + 1 : 0;
      lastRemaining = remaining;
      if (idlePasses >= 2) break;
    }

    bar.style.width = "100%";
    const summary = `${verified} saved · ${attempts} attempted`;
    if (maxed) {
      return {
        text: `Saved ${verified} offer${verified === 1 ? "" : "s"}, then hit Target's save limit. Remove some saved deals and run again.`,
        count: summary,
      };
    }
    if (!attempts) {
      return { text: "No unsaved Circle offers found on this page." };
    }
    return {
      text: stopFlag()
        ? `Stopped — ${verified} saved so far.`
        : `Done! Saved ${verified} Circle offer${verified === 1 ? "" : "s"}.`,
      count: summary,
    };
  }

  async function clipAll() {
    if (running) return;
    if (!isCouponsPath()) {
      const ok = confirm(
        "This doesn't look like a Target Circle / deals page. Open Circle Deals first for best results.\n\nContinue anyway?"
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
      const apiResult = await runApiPath(ov, msg, cnt, bar, () => stop);
      if (apiResult.done) {
        finish(apiResult.text, apiResult.count);
        return;
      }
      // API empty/blocked → DOM fallback
      msg.textContent = "API path unavailable — trying on-page buttons…";
      await sleep(400);
      const domResult = await runDomPath(ov, msg, cnt, bar, () => stop);
      finish(domResult.text, domResult.count);
    } catch (e) {
      console.warn("[clip-all-target]", e);
      finish("Something went wrong. Reload the Circle Deals page and try again.");
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
  // Target is a SPA — re-add the button after client-side navigation (debounced).
  new MutationObserver(scheduleAddButton).observe(document.documentElement || document.body, {
    childList: true, subtree: true,
  });
})();

// ==UserScript==
// @name         Clip-All Coupons
// @namespace    https://github.com/nathanrcast/clip-all-coupons
// @version      0.2.0
// @description  Clip ALL of your Albertsons-family for-U coupons (Safeway, Vons, Acme, Jewel-Osco…) at once via the gallery API (no 250 cap). Firefox + mobile friendly.
// @author       ncastel
// @homepageURL  https://github.com/nathanrcast/clip-all-coupons
// @downloadURL  https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons.user.js
// @updateURL    https://raw.githubusercontent.com/nathanrcast/clip-all-coupons/main/browser/clip-all-coupons.user.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9C%82%3C/text%3E%3C/svg%3E
// @match        https://*.safeway.com/*
// @match        https://*.albertsons.com/*
// @match        https://*.vons.com/*
// @match        https://*.acmemarkets.com/*
// @match        https://*.jewelosco.com/*
// @match        https://*.randalls.com/*
// @match        https://*.tomthumb.com/*
// @match        https://*.shaws.com/*
// @match        https://*.starmarket.com/*
// @match        https://*.pavilions.com/*
// @match        https://*.andronicos.com/*
// @match        https://*.carrsqc.com/*
// @match        https://*.haggen.com/*
// @match        https://*.kingsfoodmarkets.com/*
// @match        https://*.balduccis.com/*
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==
(function () {
  "use strict";

  // Violentmonkey runs this sandboxed (because of the GM_* grant); on Firefox the
  // page's globals (window.SWY/AB/…) are hidden behind Xray vision and read as
  // undefined. unsafeWindow is the real page window — read the session from it.
  const PW = (typeof unsafeWindow !== "undefined" && unsafeWindow) || window;

  // Clip slowly and serially: Akamai Bot Manager ("Access Denied / Error 15")
  // scores bursts of parallel requests as a bot. One-at-a-time with a human-like
  // jittered gap clears the WAF and mirrors how a person clicks.
  const CLIP_CONCURRENCY = 1;
  const MIN_GAP_MS = 350, MAX_GAP_MS = 750;
  const GALLERY_TIMEOUT_MS = 20000;
  const CLIP_TIMEOUT_MS = 10000;
  const CLIP_RETRIES = 2;
  const BLOCK_RETRY_MS = 45000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gap = () => MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
  // One ecomgallery call with all programs returns every offer (confirmed via probe).
  const GALLERY_PARAM = "PD-CC-MF-SC";
  const AVG_CLIP_SEC = 0.55;

  function isCouponsPath() {
    const p = location.pathname.toLowerCase();
    return /\/foru\b/.test(p) || /coupon/.test(p) || /\/j4u\b/.test(p);
  }

  function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // ---- session (mirrors the working Coupon Clipper extension) -------------
  function getSession() {
    const user = PW.AB?.userInfo;
    const ref = PW.userInfoServiceRefAL;
    const { clientId, clientSecret } = PW.SWY?.CONFIGSERVICE?.datapowerConfig || {};
    const correlationId =
      user?.UUID || PW.AB?.COMMON?.generateUUID?.() || "cc-" + Date.now();
    const token =
      user?.SWY_SHOP_TOKEN || ref?.service?._userSession?.SWY_SHOP_TOKEN;
    const storeId = String(
      user?.j4u?.storeId || user?.branchId ||
      ref?.service?.userInfo?.j4u?.storeId || ref?.service?.userInfo?.branchId ||
      (typeof PW.getStoreId === "function" ? PW.getStoreId() : "") || ""
    );
    const banner = location.hostname.split(".").slice(-2, -1)[0] || "safeway";
    return { token, storeId, clientId, clientSecret, correlationId, banner };
  }

  function headers(s) {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      SWY_SSO_TOKEN: s.token,
      "X-swyConsumerDirectoryPro": s.token,
      "X-IBM-Client-Id": s.clientId || "",
      "X-IBM-Client-Secret": s.clientSecret || "",
      "X-SWY_API_KEY": "emjou",
      "X-SWY_BANNER": s.banner,
      "X-SWY_VERSION": "1.0",
      "x-swy-correlation-id": s.correlationId,
    };
  }

  // ---- offer enumeration: generic recursive extractor ---------------------
  // Tune ID_KEYS/PGM_KEYS after the probe if the live field names differ.
  const ID_KEYS = ["offerId", "offer_id", "offerID", "couponId", "id"];
  const PGM_KEYS = ["offerPgm", "offerProgramType", "programType", "program", "offerPgmType"];

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
          PGM_KEYS.some((k) => data[k] != null) ||
          data.offerPrice != null || data.title != null ||
          data.description != null || data.clipStatus != null || data.status != null;
        if (looksOffer) {
          const id = String(data[idKey]);
          if (!seen.has(id)) {
            seen.add(id);
            const pgmKey = PGM_KEYS.find((k) => data[k] != null);
            into.push({ offerId: id, offerPgm: pgmKey ? String(data[pgmKey]) : "SC", status: data.status });
          }
        }
      }
      for (const v of Object.values(data)) extractOffers(v, into, seen);
    }
  }

  function add(offers, seen, o) {
    const id = o && (o.offerId || o.offer_id || o.id);
    if (!id || seen.has(String(id))) return;
    seen.add(String(id));
    offers.push({
      offerId: String(id),
      offerPgm: String(o.offerPgm || o.offerType || "SC"),
      status: o.status,
    });
  }

  /** @returns {{ offers: object[], source: string, galleryError: string|null }} */
  async function enumerateAll(s) {
    const offers = [];
    const seen = new Set();
    let galleryError = null;
    let source = "none";

    // (1) gallery: one call returns all programs; data.offers is an object keyed by offerId.
    try {
      const url = `https://${location.hostname}/abs/pub/web/j4u/api/ecomgallery` +
        `?offerPgm=${encodeURIComponent(GALLERY_PARAM)}&storeId=${encodeURIComponent(s.storeId)}&transformOfferbyUpc=y`;
      const r = await fetchWithTimeout(url, { headers: headers(s), credentials: "include" }, GALLERY_TIMEOUT_MS);
      if (r.ok) {
        const json = await r.json();
        const o = json && json.offers;
        const list = Array.isArray(o) ? o : (o && typeof o === "object" ? Object.values(o) : []);
        list.forEach((x) => add(offers, seen, x));
        if (!list.length) {
          const f = []; extractOffers(json, f, new Set());
          f.forEach((x) => add(offers, seen, x));
        }
        if (offers.length) source = "gallery";
      } else {
        galleryError = `HTTP ${r.status}`;
      }
    } catch (e) {
      galleryError = e?.name === "AbortError" ? "timed out" : (e?.message || "network error");
      console.warn("[clip-all] gallery", e);
    }

    // (2) localStorage cache (objCoupons), if the gallery gave nothing
    if (!offers.length) {
      try {
        const oc = JSON.parse(localStorage.getItem("abJ4uCoupons") || "{}").objCoupons;
        if (oc && typeof oc === "object") {
          Object.values(oc).forEach((x) => add(offers, seen, x));
          if (offers.length) source = "cache";
        }
      } catch (e) { /* ignore */ }
    }

    // (3) DOM fallback (what the page has rendered)
    if (!offers.length) {
      document.querySelectorAll('button[id^="couponAddBtn"]').forEach((btn) => {
        const m = btn.id.match(/^couponAddBtn(\d+)$/);
        if (m) add(offers, seen, { offerId: m[1], offerPgm: "SC" });
      });
      if (offers.length) source = "dom";
    }

    return { offers, source, galleryError };
  }

  // ---- clip --------------------------------------------------------------
  async function clipOneOnce(s, offer) {
    const url = `https://${location.hostname}/abs/pub/web/j4u/api/offers/clip?storeId=${encodeURIComponent(s.storeId)}`;
    const body = {
      items: [
        { clipType: "C", itemId: offer.offerId, itemType: offer.offerPgm },
        { clipType: "L", itemId: offer.offerId, itemType: offer.offerPgm },
      ],
    };
    const r = await fetchWithTimeout(url, {
      method: "POST", headers: headers(s), credentials: "include",
      body: JSON.stringify(body),
    }, CLIP_TIMEOUT_MS);
    // Akamai bot block — back off instead of hammering and risking a longer lockout.
    if (r.status === 403 || r.status === 429) return "blocked";
    if (r.status >= 500) return "retry";
    if (!r.ok) {
      console.warn("[clip-all] clip failed", offer.offerId, r.status);
      return "failed";
    }
    const j = await r.json().catch(() => ({}));
    const st = j?.items?.[0]?.status;
    return st === 1 ? "clipped" : "already";
  }

  async function clipOne(s, offer) {
    let blockedOnce = false;
    for (let attempt = 0; attempt <= CLIP_RETRIES; attempt++) {
      try {
        const res = await clipOneOnce(s, offer);
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
        console.warn("[clip-all] clip error", offer.offerId, e);
        return "failed";
      }
    }
    return "failed";
  }

  function markCacheClipped(offerIds) {
    if (!offerIds.length) return;
    try {
      const raw = localStorage.getItem("abJ4uCoupons");
      if (!raw) return;
      const data = JSON.parse(raw);
      const oc = data.objCoupons;
      if (!oc || typeof oc !== "object") return;
      const idSet = new Set(offerIds.map(String));
      for (const [k, v] of Object.entries(oc)) {
        const id = String(v?.offerId || v?.offer_id || v?.id || k);
        if (idSet.has(id)) v.status = "C";
      }
      if (Array.isArray(data.arrClippedCoupons)) {
        for (const id of idSet) {
          if (!data.arrClippedCoupons.includes(id)) data.arrClippedCoupons.push(id);
        }
      }
      localStorage.setItem("abJ4uCoupons", JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  // ---- UI -----------------------------------------------------------------
  function overlay() {
    const el = document.createElement("div");
    el.id = "cc-overlay";
    Object.assign(el.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999999,
      font: "16px -apple-system,Segoe UI,Roboto,sans-serif",
    });
    el.innerHTML = `<div style="background:#1a2129;color:#eef2f5;padding:24px 28px;border-radius:14px;
      text-align:center;min-width:280px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
      <div id="cc-msg" style="margin-bottom:12px;line-height:1.5">Loading offer list…</div>
      <div id="cc-count" style="font-weight:600;margin-bottom:14px">0 / 0</div>
      <div style="background:#2b3947;border-radius:8px;height:14px;width:260px;margin:0 auto 14px">
        <div id="cc-bar" style="background:#38c172;height:100%;width:0%;border-radius:8px;transition:width .2s"></div>
      </div>
      <button id="cc-stop" style="background:#ff4d4f;color:#fff;border:none;padding:8px 16px;
        border-radius:6px;cursor:pointer">Stop</button>
    </div>`;
    document.body.appendChild(el);
    return el;
  }

  function finishOverlay(ov, msgText, countText) {
    const msg = ov.querySelector("#cc-msg");
    const cnt = ov.querySelector("#cc-count");
    msg.textContent = msgText;
    if (countText != null) cnt.textContent = countText;
    ov.querySelector("#cc-stop").textContent = "Close";
    ov.querySelector("#cc-stop").onclick = () => ov.remove();
  }

  let running = false;
  async function clipAll() {
    if (running) return;
    if (!isCouponsPath()) {
      const ok = confirm(
        "This doesn't look like the coupons & deals page. Open for-U coupons first for best results.\n\nContinue anyway?"
      );
      if (!ok) return;
    }
    running = true;
    const s = getSession();
    if (!s.token) {
      alert("Couldn't read your store session. Make sure you're signed in, then reload the coupons page.");
      running = false;
      return;
    }
    if (!/^\d+$/.test(s.storeId)) {
      alert("Couldn't read your store ID. Open the coupons & deals page while signed in, reload, then try again.");
      running = false;
      return;
    }
    const ov = overlay();
    const msg = ov.querySelector("#cc-msg");
    const cnt = ov.querySelector("#cc-count");
    const bar = ov.querySelector("#cc-bar");
    let stop = false;
    ov.querySelector("#cc-stop").onclick = () => { stop = true; };

    const { offers: all, source, galleryError } = await enumerateAll(s);
    const offers = all.filter((o) => String(o.status || "").toUpperCase() !== "C");
    if (!all.length) {
      if (galleryError) {
        finishOverlay(ov, `Couldn't load offers (${galleryError}). Reload the coupons page and try again.`);
      } else {
        finishOverlay(ov, "No coupons found. Open the coupons & deals page, reload, then try again.");
      }
      running = false;
      return;
    }
    if (!offers.length) {
      finishOverlay(ov, "All caught up! 🎉", `${all.length} coupons — all already clipped.`);
      bar.style.width = "100%";
      running = false;
      return;
    }
    const etaMin = Math.max(1, Math.ceil((offers.length * AVG_CLIP_SEC) / 60));
    const srcNote = source === "cache" ? " (using page cache)" : source === "dom" ? " (from visible buttons)" : "";
    msg.textContent = `Clipping ${offers.length} new coupons (~${etaMin} min)${srcNote}… please don't close this tab.`;

    let done = 0, clipped = 0, already = 0, failed = 0, blocked = false;
    const total = offers.length;
    const queue = offers.slice();
    const clippedIds = [];

    async function worker() {
      while (queue.length && !stop && !blocked) {
        const offer = queue.shift();
        const res = await clipOne(s, offer);
        if (res === "blocked") { blocked = true; break; }
        if (res === "clipped") { clipped++; clippedIds.push(offer.offerId); }
        else if (res === "already") already++;
        else failed++;
        done++;
        const left = total - done;
        cnt.textContent = left ? `${done} / ${total} (~${Math.ceil((left * AVG_CLIP_SEC) / 60)} min left)` : `${done} / ${total}`;
        bar.style.width = `${(done / total) * 100}%`;
        await sleep(gap());
      }
    }
    await Promise.all(Array.from({ length: CLIP_CONCURRENCY }, worker));

    markCacheClipped(clippedIds);
    // Full successful run: clear cache so the site refreshes next visit.
    if (!blocked && !stop && failed === 0) {
      try { localStorage.removeItem("abJ4uCoupons"); } catch {}
    }

    const left = total - done;
    const summary = `Clipped ${clipped} · already had ${already} · failed ${failed} (of ${total})`;
    if (blocked) {
      finishOverlay(
        ov,
        `The store's bot protection paused us (Error 15). Clipped ${clipped} of ${total}` +
          (left ? `; ${left} left` : "") +
          " — wait a few minutes, reload, and run again to finish.",
        summary
      );
    } else if (stop) {
      finishOverlay(ov, left ? `Stopped. ${left} left — run again to finish.` : "Stopped.", summary);
    } else {
      finishOverlay(ov, "Done!", summary);
    }
    running = false;
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
      position: "fixed", bottom: "16px", right: "16px", zIndex: 999998,
      background: "#e2231a", color: "#fff", border: "none", borderRadius: "24px",
      padding: "12px 18px", fontWeight: "600", fontSize: "15px", cursor: "pointer",
      boxShadow: "0 6px 18px rgba(0,0,0,.35)", font: "600 15px -apple-system,Segoe UI,Roboto,sans-serif",
    });
    b.onclick = clipAll;
    document.body.appendChild(b);
  }

  let fabTimer = null;
  function scheduleAddButton() {
    if (fabTimer) clearTimeout(fabTimer);
    fabTimer = setTimeout(addButton, 150);
  }

  addButton();
  new MutationObserver(scheduleAddButton).observe(document.body, { childList: true, subtree: true });
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("Clip all coupons", clipAll);
  }
})();

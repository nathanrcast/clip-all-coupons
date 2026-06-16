// ==UserScript==
// @name         Safeway Clip-All Coupons
// @namespace    https://github.com/nathanrcast/safeway-clipper
// @version      0.1.0
// @description  Clip ALL Safeway/Albertsons for-U coupons at once via the gallery API (no 250 cap). Firefox + mobile friendly.
// @author       ncastel
// @homepageURL  https://github.com/nathanrcast/safeway-clipper
// @downloadURL  https://raw.githubusercontent.com/nathanrcast/safeway-clipper/main/browser/safeway-clip-all.user.js
// @updateURL    https://raw.githubusercontent.com/nathanrcast/safeway-clipper/main/browser/safeway-clip-all.user.js
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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gap = () => MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
  // One ecomgallery call with all programs returns every offer (confirmed via probe).
  const GALLERY_PARAM = "PD-CC-MF-SC";

  // ---- session (mirrors the working Coupon Clipper extension) -------------
  function getSession() {
    const user = PW.AB?.userInfo;
    const ref = PW.userInfoServiceRefAL;
    const { clientId, clientSecret } = PW.SWY?.CONFIGSERVICE?.datapowerConfig || {};
    const correlationId =
      user?.UUID || PW.AB?.COMMON?.generateUUID?.() || "cc-" + Date.now();
    const token =
      user?.SWY_SHOP_TOKEN || ref?.service?._userSession?.SWY_SHOP_TOKEN;
    const storeId =
      user?.j4u?.storeId || user?.branchId ||
      ref?.service?.userInfo?.j4u?.storeId || ref?.service?.userInfo?.branchId ||
      (typeof PW.getStoreId === "function" ? PW.getStoreId() : "") || "";
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

  async function enumerateAll(s) {
    const offers = [];
    const seen = new Set();

    // (1) gallery: one call returns all programs; data.offers is an object keyed by offerId.
    try {
      const url = `https://${location.hostname}/abs/pub/web/j4u/api/ecomgallery` +
        `?offerPgm=${encodeURIComponent(GALLERY_PARAM)}&storeId=${s.storeId}&transformOfferbyUpc=y`;
      const r = await fetch(url, { headers: headers(s), credentials: "include" });
      if (r.ok) {
        const json = await r.json();
        const o = json && json.offers;
        const list = Array.isArray(o) ? o : (o && typeof o === "object" ? Object.values(o) : []);
        list.forEach((x) => add(offers, seen, x));
        // generic fallback if the shape ever changes
        if (!list.length) {
          const f = []; extractOffers(json, f, new Set());
          f.forEach((x) => add(offers, seen, x));
        }
      }
    } catch (e) { console.warn("[clip-all] gallery", e); }

    // (2) localStorage cache (objCoupons), if the gallery gave nothing
    if (!offers.length) {
      try {
        const oc = JSON.parse(localStorage.getItem("abJ4uCoupons") || "{}").objCoupons;
        if (oc && typeof oc === "object") Object.values(oc).forEach((x) => add(offers, seen, x));
      } catch (e) { /* ignore */ }
    }

    // (3) DOM fallback (what the page has rendered)
    if (!offers.length) {
      document.querySelectorAll('button[id^="couponAddBtn"]').forEach((btn) => {
        const m = btn.id.match(/^couponAddBtn(\d+)$/);
        if (m) add(offers, seen, { offerId: m[1], offerPgm: "SC" });
      });
    }

    return offers;
  }

  // ---- clip --------------------------------------------------------------
  async function clipOne(s, offer) {
    const url = `https://${location.hostname}/abs/pub/web/j4u/api/offers/clip?storeId=${s.storeId}`;
    const body = {
      items: [
        { clipType: "C", itemId: offer.offerId, itemType: offer.offerPgm },
        { clipType: "L", itemId: offer.offerId, itemType: offer.offerPgm },
      ],
    };
    try {
      const r = await fetch(url, {
        method: "POST", headers: headers(s), credentials: "include",
        body: JSON.stringify(body),
      });
      // Akamai bot block — back off instead of hammering and risking a longer lockout.
      if (r.status === 403 || r.status === 429) return "blocked";
      if (!r.ok) return "failed";
      const j = await r.json().catch(() => ({}));
      const st = j?.items?.[0]?.status;
      return st === 1 ? "clipped" : "already";
    } catch {
      return "failed";
    }
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
      <div id="cc-msg" style="margin-bottom:12px;line-height:1.5">Finding all coupons…</div>
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

  let running = false;
  async function clipAll() {
    if (running) return;
    running = true;
    const s = getSession();
    if (!s.token) {
      alert("Couldn't read your Safeway session. Make sure you're signed in, then reload the coupons page.");
      running = false;
      return;
    }
    const ov = overlay();
    const msg = ov.querySelector("#cc-msg");
    const cnt = ov.querySelector("#cc-count");
    const bar = ov.querySelector("#cc-bar");
    let stop = false;
    ov.querySelector("#cc-stop").onclick = () => { stop = true; };

    const all = await enumerateAll(s);
    const offers = all.filter((o) => String(o.status || "").toUpperCase() !== "C");
    if (!all.length) {
      msg.textContent = "No coupons found. Open the coupons & deals page, reload, then try again.";
      ov.querySelector("#cc-stop").textContent = "Close";
      ov.querySelector("#cc-stop").onclick = () => ov.remove();
      running = false;
      return;
    }
    if (!offers.length) {
      msg.textContent = "All caught up! 🎉";
      cnt.textContent = `${all.length} coupons — all already clipped.`;
      bar.style.width = "100%";
      ov.querySelector("#cc-stop").textContent = "Close";
      ov.querySelector("#cc-stop").onclick = () => ov.remove();
      running = false;
      return;
    }
    msg.textContent = `Clipping ${offers.length} new coupons… please don't close this tab.`;

    let done = 0, clipped = 0, already = 0, failed = 0, blocked = false;
    const total = offers.length;
    const queue = offers.slice();

    async function worker() {
      while (queue.length && !stop && !blocked) {
        const offer = queue.shift();
        const res = await clipOne(s, offer);
        if (res === "blocked") { blocked = true; break; }
        if (res === "clipped") clipped++;
        else if (res === "already") already++;
        else failed++;
        done++;
        cnt.textContent = `${done} / ${total}`;
        bar.style.width = `${(done / total) * 100}%`;
        await sleep(gap());
      }
    }
    await Promise.all(Array.from({ length: CLIP_CONCURRENCY }, worker));

    try { localStorage.removeItem("abJ4uCoupons"); } catch {}
    if (blocked) {
      msg.textContent = "Safeway's bot protection paused us (Error 15). Your account is fine — wait a few minutes, reload, and run it again to finish the rest.";
    } else
    msg.textContent = stop ? "Stopped." : "Done!";
    cnt.textContent = `Clipped ${clipped} · already had ${already} · failed ${failed} (of ${total})`;
    ov.querySelector("#cc-stop").textContent = "Close";
    ov.querySelector("#cc-stop").onclick = () => ov.remove();
    running = false;
  }

  function addButton() {
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

  addButton();
  new MutationObserver(addButton).observe(document.body, { childList: true });
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("Clip all coupons", clipAll);
  }
})();

/* Source for the Clip-All Coupons bookmarklet. Self-contained IIFE.
 * Build the javascript: URL with:  ./browser/build-bookmarklet.sh
 * Same core as clip-all-coupons.user.js, minus the floating button/menu —
 * it runs immediately when you tap the bookmark while on a logged-in coupons page.
 */
(function () {
  "use strict";
  // Serial + jittered: Akamai ("Access Denied / Error 15") scores parallel bursts as a bot.
  var CONC = 1, MIN_GAP = 350, MAX_GAP = 750;
  var GALLERY_TIMEOUT_MS = 20000, CLIP_TIMEOUT_MS = 10000, CLIP_RETRIES = 2, BLOCK_RETRY_MS = 45000;
  var AVG_CLIP_SEC = 0.55;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var gap = function () { return MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP); };
  var GP = "PD-CC-MF-SC"; // one call returns all programs (confirmed via probe)
  var ID_KEYS = ["offerId", "offer_id", "offerID", "couponId", "id"];
  var PGM_KEYS = ["offerPgm", "offerProgramType", "programType", "program", "offerPgmType"];

  function isCouponsPath() {
    var p = location.pathname.toLowerCase();
    return /\/foru\b/.test(p) || /coupon/.test(p) || /\/j4u\b/.test(p);
  }

  function fetchWithTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, ms);
    var o = Object.assign({}, opts, { signal: ctrl.signal });
    return fetch(url, o).finally(function () { clearTimeout(t); });
  }

  function getSession() {
    var user = window.AB && window.AB.userInfo;
    var ref = window.userInfoServiceRefAL;
    var dp = (window.SWY && window.SWY.CONFIGSERVICE && window.SWY.CONFIGSERVICE.datapowerConfig) || {};
    var correlationId = (user && user.UUID) ||
      (window.AB && window.AB.COMMON && window.AB.COMMON.generateUUID && window.AB.COMMON.generateUUID()) ||
      "cc-" + Date.now();
    var token = (user && user.SWY_SHOP_TOKEN) ||
      (ref && ref.service && ref.service._userSession && ref.service._userSession.SWY_SHOP_TOKEN);
    var storeId = String((user && (user.j4u && user.j4u.storeId)) || (user && user.branchId) ||
      (ref && ref.service && ref.service.userInfo && ((ref.service.userInfo.j4u && ref.service.userInfo.j4u.storeId) || ref.service.userInfo.branchId)) ||
      (typeof window.getStoreId === "function" ? window.getStoreId() : "") || "");
    var banner = location.hostname.split(".").slice(-2, -1)[0] || "safeway";
    return { token: token, storeId: storeId, clientId: dp.clientId, clientSecret: dp.clientSecret, correlationId: correlationId, banner: banner };
  }

  function H(s) {
    return {
      "Content-Type": "application/json", Accept: "application/json",
      SWY_SSO_TOKEN: s.token, "X-swyConsumerDirectoryPro": s.token,
      "X-IBM-Client-Id": s.clientId || "", "X-IBM-Client-Secret": s.clientSecret || "",
      "X-SWY_API_KEY": "emjou", "X-SWY_BANNER": s.banner, "X-SWY_VERSION": "1.0",
      "x-swy-correlation-id": s.correlationId,
    };
  }

  function extract(data, into, seen) {
    if (Array.isArray(data)) { for (var i = 0; i < data.length; i++) extract(data[i], into, seen); return; }
    if (data && typeof data === "object") {
      var idKey = ID_KEYS.find(function (k) { return data[k] != null && /^[A-Za-z0-9._-]+$/.test(String(data[k])); });
      if (idKey) {
        var looks = PGM_KEYS.some(function (k) { return data[k] != null; }) ||
          data.offerPrice != null || data.title != null || data.description != null ||
          data.clipStatus != null || data.status != null;
        if (looks) {
          var id = String(data[idKey]);
          if (!seen.has(id)) {
            seen.add(id);
            var pk = PGM_KEYS.find(function (k) { return data[k] != null; });
            into.push({ offerId: id, offerPgm: pk ? String(data[pk]) : "SC", status: data.status });
          }
        }
      }
      var vals = Object.values(data);
      for (var j = 0; j < vals.length; j++) extract(vals[j], into, seen);
    }
  }

  function add(offers, seen, o) {
    var id = o && (o.offerId || o.offer_id || o.id);
    if (!id || seen.has(String(id))) return;
    seen.add(String(id));
    offers.push({ offerId: String(id), offerPgm: String(o.offerPgm || o.offerType || "SC"), status: o.status });
  }

  async function enumerateAll(s) {
    var offers = [], seen = new Set(), galleryError = null, source = "none";
    try {
      var url = "https://" + location.hostname + "/abs/pub/web/j4u/api/ecomgallery?offerPgm=" +
        encodeURIComponent(GP) + "&storeId=" + encodeURIComponent(s.storeId) + "&transformOfferbyUpc=y";
      var r = await fetchWithTimeout(url, { headers: H(s), credentials: "include" }, GALLERY_TIMEOUT_MS);
      if (r.ok) {
        var json = await r.json(), o = json && json.offers;
        var list = Array.isArray(o) ? o : (o && typeof o === "object" ? Object.values(o) : []);
        list.forEach(function (x) { add(offers, seen, x); });
        if (!list.length) { var f = []; extract(json, f, new Set()); f.forEach(function (x) { add(offers, seen, x); }); }
        if (offers.length) source = "gallery";
      } else {
        galleryError = "HTTP " + r.status;
      }
    } catch (e) {
      galleryError = (e && e.name === "AbortError") ? "timed out" : ((e && e.message) || "network error");
    }
    if (!offers.length) {
      try {
        var oc = JSON.parse(localStorage.getItem("abJ4uCoupons") || "{}").objCoupons;
        if (oc && typeof oc === "object") {
          Object.values(oc).forEach(function (x) { add(offers, seen, x); });
          if (offers.length) source = "cache";
        }
      } catch (e) {}
    }
    if (!offers.length) {
      document.querySelectorAll('button[id^="couponAddBtn"]').forEach(function (b) {
        var m = b.id.match(/^couponAddBtn(\d+)$/); if (m) add(offers, seen, { offerId: m[1], offerPgm: "SC" });
      });
      if (offers.length) source = "dom";
    }
    return { offers: offers, source: source, galleryError: galleryError };
  }

  async function clipOneOnce(s, o) {
    var url = "https://" + location.hostname + "/abs/pub/web/j4u/api/offers/clip?storeId=" + encodeURIComponent(s.storeId);
    var body = { items: [{ clipType: "C", itemId: o.offerId, itemType: o.offerPgm }, { clipType: "L", itemId: o.offerId, itemType: o.offerPgm }] };
    var r = await fetchWithTimeout(url, { method: "POST", headers: H(s), credentials: "include", body: JSON.stringify(body) }, CLIP_TIMEOUT_MS);
    if (r.status === 403 || r.status === 429) return "blocked";
    if (r.status >= 500) return "retry";
    if (!r.ok) return "failed";
    var j = await r.json().catch(function () { return {}; });
    return (j && j.items && j.items[0] && j.items[0].status === 1) ? "clipped" : "already";
  }

  async function clipOne(s, o) {
    var blockedOnce = false;
    for (var attempt = 0; attempt <= CLIP_RETRIES; attempt++) {
      try {
        var res = await clipOneOnce(s, o);
        if (res === "blocked") {
          if (!blockedOnce) { blockedOnce = true; await sleep(BLOCK_RETRY_MS); continue; }
          return "blocked";
        }
        if (res === "retry") {
          if (attempt < CLIP_RETRIES) { await sleep(1000 * Math.pow(3, attempt)); continue; }
          return "failed";
        }
        return res;
      } catch (e) {
        if (attempt < CLIP_RETRIES) { await sleep(1000 * Math.pow(3, attempt)); continue; }
        return "failed";
      }
    }
    return "failed";
  }

  function markCacheClipped(offerIds) {
    if (!offerIds.length) return;
    try {
      var raw = localStorage.getItem("abJ4uCoupons");
      if (!raw) return;
      var data = JSON.parse(raw);
      var oc = data.objCoupons;
      if (!oc || typeof oc !== "object") return;
      var idSet = {};
      for (var i = 0; i < offerIds.length; i++) idSet[String(offerIds[i])] = true;
      Object.keys(oc).forEach(function (k) {
        var v = oc[k];
        var id = String((v && (v.offerId || v.offer_id || v.id)) || k);
        if (idSet[id]) v.status = "C";
      });
      if (Array.isArray(data.arrClippedCoupons)) {
        Object.keys(idSet).forEach(function (id) {
          if (data.arrClippedCoupons.indexOf(id) < 0) data.arrClippedCoupons.push(id);
        });
      }
      localStorage.setItem("abJ4uCoupons", JSON.stringify(data));
    } catch (e) {}
  }

  function overlay() {
    var el = document.createElement("div"); el.id = "cc-overlay";
    el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:999999;font:16px -apple-system,Segoe UI,Roboto,sans-serif";
    el.innerHTML = '<div style="background:#1a2129;color:#eef2f5;padding:24px 28px;border-radius:14px;text-align:center;min-width:280px;box-shadow:0 12px 40px rgba(0,0,0,.5)"><div id="cc-msg" style="margin-bottom:12px;line-height:1.5">Loading offer list…</div><div id="cc-count" style="font-weight:600;margin-bottom:14px">0 / 0</div><div style="background:#2b3947;border-radius:8px;height:14px;width:260px;margin:0 auto 14px"><div id="cc-bar" style="background:#38c172;height:100%;width:0%;border-radius:8px;transition:width .2s"></div></div><button id="cc-stop" style="background:#ff4d4f;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Stop</button></div>';
    document.body.appendChild(el); return el;
  }

  (async function () {
    if (window.__ccRunning) return; window.__ccRunning = true;
    if (!isCouponsPath()) {
      if (!confirm("This doesn't look like the coupons & deals page. Continue anyway?")) {
        window.__ccRunning = false; return;
      }
    }
    var s = getSession();
    if (!s.token) { alert("Couldn't read your store session. Sign in, open the coupons page, then tap again."); window.__ccRunning = false; return; }
    if (!/^\d+$/.test(s.storeId)) { alert("Couldn't read your store ID. Open the coupons page while signed in, reload, then try again."); window.__ccRunning = false; return; }
    var ov = overlay(), msg = ov.querySelector("#cc-msg"), cnt = ov.querySelector("#cc-count"), bar = ov.querySelector("#cc-bar"), stop = false;
    ov.querySelector("#cc-stop").onclick = function () { stop = true; };
    var enumResult = await enumerateAll(s);
    var all = enumResult.offers, source = enumResult.source, galleryError = enumResult.galleryError;
    var offers = all.filter(function (o) { return String(o.status || "").toUpperCase() !== "C"; });
    var sb0 = ov.querySelector("#cc-stop");
    function finish(msgText, countText) {
      msg.textContent = msgText;
      if (countText != null) cnt.textContent = countText;
      sb0.textContent = "Close"; sb0.onclick = function () { ov.remove(); };
      window.__ccRunning = false;
    }
    if (!all.length) {
      finish(galleryError ? ("Couldn't load offers (" + galleryError + "). Reload and try again.") : "No coupons found. Open the coupons page, reload, try again.");
      return;
    }
    if (!offers.length) {
      finish("All caught up! 🎉", all.length + " coupons — all already clipped.");
      bar.style.width = "100%";
      return;
    }
    var etaMin = Math.max(1, Math.ceil((offers.length * AVG_CLIP_SEC) / 60));
    var srcNote = source === "cache" ? " (using page cache)" : source === "dom" ? " (from visible buttons)" : "";
    msg.textContent = "Clipping " + offers.length + " new coupons (~" + etaMin + " min)" + srcNote + "… please don't close this tab.";
    var done = 0, clipped = 0, already = 0, failed = 0, blocked = false, total = offers.length, queue = offers.slice(), clippedIds = [];
    async function worker() {
      while (queue.length && !stop && !blocked) {
        var offer = queue.shift();
        var res = await clipOne(s, offer);
        if (res === "blocked") { blocked = true; break; }
        if (res === "clipped") { clipped++; clippedIds.push(offer.offerId); }
        else if (res === "already") already++; else failed++;
        done++;
        var left = total - done;
        cnt.textContent = left ? (done + " / " + total + " (~" + Math.ceil((left * AVG_CLIP_SEC) / 60) + " min left)") : (done + " / " + total);
        bar.style.width = (done / total) * 100 + "%";
        await sleep(gap());
      }
    }
    var ws = []; for (var i = 0; i < CONC; i++) ws.push(worker());
    await Promise.all(ws);
    markCacheClipped(clippedIds);
    if (!blocked && !stop && failed === 0) {
      try { localStorage.removeItem("abJ4uCoupons"); } catch (e) {}
    }
    var left = total - done;
    var summary = "Clipped " + clipped + " · already had " + already + " · failed " + failed + " (of " + total + ")";
    if (blocked) {
      finish("The store's bot protection paused us (Error 15). Clipped " + clipped + " of " + total +
        (left ? ("; " + left + " left") : "") + " — wait a few minutes, reload, and tap again.", summary);
    } else if (stop) {
      finish(left ? ("Stopped. " + left + " left — tap again to finish.") : "Stopped.", summary);
    } else {
      finish("Done!", summary);
    }
  })();
})();

/* Source for the Clip-All Coupons — Kroger bookmarklet. Self-contained IIFE.
 * Build the javascript: URL with:  ./browser/build-bookmarklet.sh
 * Same DOM-click core as clip-all-coupons-kroger.user.js, minus the floating
 * button — it runs immediately when you tap the bookmark on a logged-in Kroger
 * coupons page. Kroger has no "all offers" API, so it clicks the on-page clip
 * buttons (capped ~150/run); tap again after new coupons drop.
 */
(function () {
  "use strict";
  if (window.__ccRunning) return;
  window.__ccRunning = true;
  var MIN_GAP = 350, MAX_GAP = 750;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var gap = function () { return MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP); };
  var SELS = [
    "button.kds-Button--favorable",
    "button.CouponCard-button.kds-Button--primary",
    'button[data-testid="coupon-add-button"]',
  ];
  function clipped(b) {
    var t = (b.textContent || "").trim().toLowerCase();
    var a = (b.getAttribute("aria-label") || "").toLowerCase();
    return b.disabled || b.getAttribute("aria-pressed") === "true" ||
      /clipped|unclip|added|remove|in cart/.test(t) || /clipped|added|unclip/.test(a);
  }
  function clippable(b) {
    var t = (b.textContent || "").trim().toLowerCase();
    var a = (b.getAttribute("aria-label") || "").toLowerCase();
    return t === "clip" || t === "clip coupon" || /^clip\b/.test(a);
  }
  function collect() {
    var set = new Set();
    SELS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (b) { if (!clipped(b)) set.add(b); });
    });
    document.querySelectorAll("button").forEach(function (b) { if (clippable(b) && !clipped(b)) set.add(b); });
    return Array.prototype.slice.call(set);
  }
  function overlay() {
    var el = document.createElement("div");
    el.id = "cc-overlay";
    el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;" +
      "justify-content:center;z-index:2147483646;font:16px -apple-system,Segoe UI,Roboto,sans-serif";
    el.innerHTML = '<div style="background:#1a2129;color:#eef2f5;padding:24px 28px;border-radius:14px;text-align:center;' +
      'min-width:280px;box-shadow:0 12px 40px rgba(0,0,0,.5)"><div id="cc-msg" style="margin-bottom:12px;line-height:1.5">' +
      'Loading all coupons…</div><div id="cc-count" style="font-weight:600;margin-bottom:14px">0 / 0</div>' +
      '<div style="background:#2b3947;border-radius:8px;height:14px;width:260px;margin:0 auto 14px">' +
      '<div id="cc-bar" style="background:#38c172;height:100%;width:0%;border-radius:8px;transition:width .2s"></div></div>' +
      '<button id="cc-stop" style="background:#ff4d4f;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Stop</button></div>';
    document.body.appendChild(el);
    return el;
  }
  (async function () {
    var ov = overlay(), msg = ov.querySelector("#cc-msg"), cnt = ov.querySelector("#cc-count"), bar = ov.querySelector("#cc-bar"), stop = false;
    ov.querySelector("#cc-stop").onclick = function () { stop = true; };
    function finish(text) {
      msg.textContent = text;
      var sb = ov.querySelector("#cc-stop"); sb.textContent = "Close"; sb.onclick = function () { ov.remove(); };
      window.__ccRunning = false;
    }
    // load all lazy-rendered cards
    var last = -1, stable = 0;
    for (var i = 0; i < 40 && stable < 3 && !stop; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
      var n = document.querySelectorAll("button").length;
      stable = n === last ? stable + 1 : 0; last = n;
      cnt.textContent = collect().length + " found";
    }
    window.scrollTo(0, 0);
    if (stop) return finish("Stopped.");
    var done = 0, lastRemaining = -1, idle = 0;
    for (var pass = 0; pass < 8 && !stop; pass++) {
      var btns = collect();
      if (!btns.length) break;
      msg.textContent = "Clipping " + btns.length + " coupons… please don't close this tab.";
      var total = done + btns.length;
      for (var j = 0; j < btns.length && !stop; j++) {
        try { btns[j].scrollIntoView({ block: "center" }); btns[j].click(); done++; } catch (e) {}
        cnt.textContent = done + " / " + total;
        bar.style.width = Math.min(100, (done / total) * 100) + "%";
        await sleep(gap());
      }
      await sleep(1200);
      var remaining = collect().length;
      idle = remaining === lastRemaining ? idle + 1 : 0; lastRemaining = remaining;
      if (idle >= 2) break;
    }
    bar.style.width = "100%";
    if (!done) finish("No unclipped coupons found. If the page hadn't finished loading, reload and try again.");
    else finish(stop ? "Stopped — clipped " + done + " so far." :
      "Done! Clipped " + done + " coupon" + (done === 1 ? "" : "s") + ". (Kroger shows ~150 at a time — tap again for more.)");
  })();
})();

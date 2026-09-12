/* Source for the Clip-All Coupons — Kroger bookmarklet. Self-contained IIFE.
 * Build the javascript: URL with:  ./browser/build-bookmarklet.sh
 * Same DOM-click core as clip-all-coupons-kroger.user.js, minus the floating
 * button — it runs immediately when you tap the bookmark on a logged-in Kroger
 * coupons page. Kroger has no "all offers" API, so it scrolls the grid to load
 * every card, then clicks each "Clip" button; tap again after new coupons drop.
 */
(function () {
  "use strict";
  if (window.__ccRunning) return;
  window.__ccRunning = true;
  var MIN_GAP = 350, MAX_GAP = 750;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var gap = function () { return MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP); };
  // <button data-testid="CouponActionButton-<id>" aria-label="Clip for coupon: …">Clip</button>
  var ACTION_SEL = 'button[data-testid^="CouponActionButton-"]';

  function isCouponsPath() {
    var p = location.pathname.toLowerCase();
    return /\/savings\b/.test(p) || /coupon/.test(p) || /\/cl\//.test(p);
  }

  function verb(b) {
    var a = (b.getAttribute("aria-label") || "").trim().toLowerCase();
    var m = a.match(/^(.*?) for coupon:/);
    return m ? m[1] : (b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function clippable(b) {
    return verb(b) === "clip" && !b.disabled && b.getAttribute("aria-disabled") !== "true";
  }
  function actionButtons() {
    var list = Array.prototype.slice.call(document.querySelectorAll(ACTION_SEL));
    if (!list.length) {
      (document.querySelector("main") || document.body).querySelectorAll("button").forEach(function (b) {
        if (verb(b) === "clip") list.push(b);
      });
    }
    return list;
  }
  function collect() { return actionButtons().filter(clippable); }
  function pageState() {
    var bs = actionButtons();
    return {
      signedOut: bs.some(function (b) { return verb(b) === "sign in to clip"; }),
      limited: bs.filter(function (b) { return verb(b) === "clip" && !clippable(b); }).length,
    };
  }
  function current(b) {
    var id = b.getAttribute("data-testid");
    return (id && document.querySelector('button[data-testid="' + id + '"]')) || b;
  }
  async function waitClipped(b) {
    for (var t = 0; t < 3000; t += 150) {
      await sleep(150);
      if (verb(current(b)) === "unclip") return true;
    }
    return false;
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
    if (!isCouponsPath()) {
      if (!confirm("This doesn't look like the Kroger coupons page. Continue anyway?")) {
        window.__ccRunning = false; return;
      }
    }
    var ov = overlay(), msg = ov.querySelector("#cc-msg"), cnt = ov.querySelector("#cc-count"), bar = ov.querySelector("#cc-bar"), stop = false;
    ov.querySelector("#cc-stop").onclick = function () { stop = true; };
    function finish(text, countText) {
      msg.textContent = text;
      if (countText != null) cnt.textContent = countText;
      var sb = ov.querySelector("#cc-stop"); sb.textContent = "Close"; sb.onclick = function () { ov.remove(); };
      window.__ccRunning = false;
    }
    msg.textContent = "Loading all coupons (scrolling the page)…";
    var last = -1, stable = 0;
    for (var i = 0; i < 120 && stable < 3 && !stop; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
      var n = actionButtons().length;
      var busy = !!document.querySelector(".CouponsCatalogue-infiniteScrollSpinner");
      stable = n === last && !busy ? stable + 1 : 0; last = n;
      cnt.textContent = n + " coupons loaded";
    }
    window.scrollTo(0, 0);
    if (stop) return finish("Stopped.");

    var btns = collect();
    if (!btns.length) {
      var st = pageState();
      return finish(st.signedOut ? "You're signed out — sign in to your Kroger account, then try again." :
        st.limited ? "Kroger's coupon clip limit is reached — unclip or use some coupons first." :
        "No unclipped coupons found. If the page hadn't finished loading, reload and try again.");
    }
    var runTotal = btns.length, attempts = 0, verified = 0, lastRemaining = -1, idle = 0;
    for (var pass = 0; pass < 8 && !stop; pass++) {
      if (pass > 0) {
        btns = collect();
        if (!btns.length) break;
      }
      msg.textContent = "Clipping coupons… please don't close this tab.";
      for (var j = 0; j < btns.length && !stop; j++) {
        var btn = current(btns[j]);
        if (!clippable(btn)) continue;
        try {
          btn.scrollIntoView({ block: "center" });
          btn.click();
          attempts++;
          if (await waitClipped(btn)) verified++;
        } catch (e) {}
        cnt.textContent = attempts + " attempted · " + verified + " clipped (of ~" + runTotal + ")";
        bar.style.width = Math.min(100, (attempts / runTotal) * 100) + "%";
        await sleep(gap());
      }
      if (pageState().limited) break;
      await sleep(1200);
      var remaining = collect().length;
      idle = remaining === lastRemaining ? idle + 1 : 0; lastRemaining = remaining;
      if (idle >= 2) break;
    }
    bar.style.width = "100%";
    var limited = pageState().limited > 0, s = verified === 1 ? "" : "s";
    if (!attempts) finish("No unclipped coupons found. If the page hadn't finished loading, reload and try again.");
    else finish(stop ? ("Stopped — " + verified + " clipped so far.") :
      limited ? ("Clipped " + verified + " coupon" + s + " — Kroger's clip limit is now reached.") :
      ("Done! Clipped " + verified + " coupon" + s + ". Tap again anytime to catch new or missed ones."),
      verified + " clipped · " + attempts + " attempted");
  })();
})();

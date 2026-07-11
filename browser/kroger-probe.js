/* Kroger coupon PROBE — clips nothing on its own. Discovers the real API + DOM.
 *
 * Unlike Albertsons, Kroger has no public "all offers" endpoint, so the userscript
 * clips on-page buttons (capped ~150/run). This probe captures what's needed to add
 * a no-cap API path: it hooks fetch/XHR and records every coupon-related request,
 * dumps the live clip-button selectors, and lets you grab the real *clip* call by
 * clipping ONE coupon manually while it watches.
 *
 * HOW TO RUN (Firefox or Chrome), signed in on the coupons page
 * (e.g. https://www.frysfood.com/savings/cl/coupons/):
 *   1. Open DevTools (F12) → Console. Paste this whole file, press Enter.
 *   2. Leave it running. Manually click ONE coupon's "Clip" button on the page.
 *   3. Click the floating "📋 Copy probe report" button (bottom-right), review, then copy.
 *
 * Tokens in headers and sensitive body fields are masked. Not served from the public guide host.
 */
(() => {
  const events = [];
  const rec = (kind, o) => { events.push({ kind, ...o, t: new Date().toISOString() }); };
  const COUPON_RE = /coupon|clip|savings|offer|j4u|np\/\d+/i;
  const SENSITIVE_RE = /(token|authorization|cookie|secret|signature|csrf|x-csp|bearer|password|session)/i;
  const maskHeaders = (h) => {
    const out = {};
    for (const [k, v] of Object.entries(h || {})) {
      out[k] = SENSITIVE_RE.test(k) ? "<masked:" + String(v).length + " chars>" : v;
    }
    return out;
  };
  const redactBody = (b) => {
    if (b == null) return null;
    let s = typeof b === "string" ? b : (() => { try { return JSON.stringify(b); } catch { return String(b); } })();
    // Mask JSON-ish string values for sensitive keys.
    s = s.replace(/("?(?:access_?token|refresh_?token|authorization|password|secret|cookie|session|csrf)[^"]*"?\s*[:=]\s*")([^"]{4,})(")/gi,
      (_, a, v, c) => a + "<masked:" + v.length + " chars>" + c);
    s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-+=/]+/gi, "$1<masked>");
    return s.length > 2000 ? s.slice(0, 2000) + "…(truncated)" : s;
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (COUPON_RE.test(url)) {
        const method = (init && init.method) || (input && input.method) || "GET";
        const headers = {};
        const h = (init && init.headers) || (input && input.headers);
        if (h && typeof h.forEach === "function") h.forEach((v, k) => (headers[k] = v));
        else Object.assign(headers, h || {});
        rec("fetch", { url, method, headers: maskHeaders(headers), body: redactBody(init && init.body) });
      }
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };

  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send, XH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) { this.__cc = { method, url, headers: {} }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__cc) this.__cc.headers[k] = v; return XH.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__cc && COUPON_RE.test(this.__cc.url)) {
        rec("xhr", { url: this.__cc.url, method: this.__cc.method, headers: maskHeaders(this.__cc.headers), body: redactBody(body) });
      }
    } catch (e) {}
    return XS.apply(this, arguments);
  };

  const selectors = [
    "button.kds-Button--favorable",
    "button.CouponCard-button.kds-Button--primary",
    'button[data-testid="coupon-add-button"]',
  ];
  const domReport = () => {
    const lines = [];
    for (const sel of selectors) lines.push(`  ${sel} → ${document.querySelectorAll(sel).length} matches`);
    let textClip = 0, sampleAttrs = null;
    document.querySelectorAll("button").forEach((b) => {
      const t = (b.textContent || "").trim().toLowerCase();
      const a = (b.getAttribute("aria-label") || "").toLowerCase();
      if (t === "clip" || t === "clip coupon" || /^clip\b/.test(a)) {
        textClip++;
        if (!sampleAttrs) {
          sampleAttrs = {
            className: (b.className || "").toString().slice(0, 120),
            testId: b.getAttribute("data-testid") || "",
            aria: (b.getAttribute("aria-label") || "").slice(0, 80),
            text: (b.textContent || "").trim().slice(0, 40),
          };
        }
      }
    });
    lines.push(`  text/aria "Clip" fallback → ${textClip} matches`);
    if (sampleAttrs) lines.push("  SAMPLE clip button attrs: " + JSON.stringify(sampleAttrs));
    return lines.join("\n");
  };

  const build = () => {
    const report =
      "=== KROGER COUPON PROBE ===\n" +
      "host: " + location.hostname + "\n" +
      "path: " + location.pathname + "\n\n" +
      "── DOM clip-button selectors ──\n" + domReport() + "\n\n" +
      "── captured coupon requests (" + events.length + ") ──\n" +
      (events.length ? events.map((e, i) =>
        `#${i + 1} [${e.kind}] ${e.method} ${e.url}\n  headers: ${JSON.stringify(e.headers)}\n  body: ${e.body || "(none)"}`
      ).join("\n\n") : "(none yet — clip one coupon manually, then copy again)");

    let box = document.getElementById("cc-probe-box");
    if (box) box.remove();
    box = document.createElement("div");
    box.id = "cc-probe-box";
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.7);display:flex;" +
      "flex-direction:column;align-items:center;justify-content:center;padding:24px;font:14px -apple-system,Segoe UI,Roboto,sans-serif";
    const head = document.createElement("div");
    head.style.cssText = "color:#fff;margin-bottom:10px;text-align:center;max-width:760px";
    head.textContent = "Kroger probe report. Sensitive headers/bodies are masked. Review before sharing. Captured " +
      events.length + " coupon request(s).";
    const ta = document.createElement("textarea");
    ta.value = report;
    ta.style.cssText = "width:min(760px,92vw);height:60vh;padding:12px;border-radius:8px;border:1px solid #555;" +
      "background:#0e141a;color:#eef2f5;font-family:monospace;font-size:12px";
    const row = document.createElement("div");
    row.style.cssText = "margin-top:12px;display:flex;gap:10px";
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    copy.style.cssText = "background:#0c4ca3;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer";
    copy.onclick = () => { try { navigator.clipboard.writeText(report); } catch (e) {} ta.select(); };
    const close = document.createElement("button");
    close.textContent = "Close";
    close.style.cssText = "background:#555;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer";
    close.onclick = () => box.remove();
    row.append(copy, close);
    box.append(head, ta, row);
    document.body.appendChild(box);
    ta.focus();
  };

  const fab = document.createElement("button");
  fab.textContent = "📋 Probe report";
  fab.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0c4ca3;color:#fff;" +
    "border:none;border-radius:24px;padding:12px 18px;font:600 15px -apple-system,Segoe UI,Roboto,sans-serif;" +
    "cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35)";
  fab.onclick = build;
  document.body.appendChild(fab);

  console.log("%c[kroger-probe]", "color:#0c4ca3;font-weight:bold",
    "watching coupon requests. Clip ONE coupon manually, then click '📋 Probe report'.");
})();

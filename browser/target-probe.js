/* Target Circle PROBE — clips/saves nothing on its own. Discovers the live API + DOM.
 *
 * Target Circle embeds a clean loyalty offer API in window.__CONFIG__ (probed from
 * public page JS, 2026-08-02):
 *   GET  api.target.com/loyalty_guest_offerlists/v1/external          (saved)
 *   POST api.target.com/loyalty_guest_offerlists/v1/external/{id}     (save/clip)
 *   DEL  api.target.com/loyalty_guest_offerlists/v1/external/{id}
 *   GET  api.target.com/loyalty_offer_groups/v1/categories[/{id}]
 *   GET  api.target.com/loyalty_offer_groups/v1/collections[/{id}]
 * Auth: public loyaltyClientKey + loyaltyApiKey headers + session cookies
 * (credentials: "include"). Save cap still exists (/circle/maxedDeals).
 *
 * HOW TO RUN (Firefox or Chrome), signed in on Circle deals
 * (e.g. https://www.target.com/circle/offers → redirects to deals):
 *   1. Open DevTools (F12) → Console. Paste this whole file, press Enter.
 *   2. Leave it running. Manually save/activate ONE offer on the page.
 *   3. Click the floating "📋 Probe report" button (bottom-right), review, then copy.
 *
 * Tokens in headers and sensitive body fields are masked. Not served from the public guide host.
 */
(() => {
  const events = [];
  const rec = (kind, o) => { events.push({ kind, ...o, t: new Date().toISOString() }); };
  const COUPON_RE = /loyalty_guest_offer|loyalty_offer|circle|bonus|offerlist|guest_offer|save.?offer|coupon|deal/i;
  const SENSITIVE_RE = /(token|authorization|cookie|secret|signature|csrf|x-csp|bearer|password|session|loyalty.?client|x-api-key)/i;
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
    'button[data-test="save-button"]',
    'button[data-test*="offer" i]',
    'button[data-test*="deal" i]',
    'button[data-test*="bonus" i]',
  ];
  const SAVE_RE = /^(save|activate|apply)(\s+(offer|deal|bonus|coupon))?$/i;
  const DONE_RE = /saved|applied|activated|remove|unsave|added|in wallet/i;

  const configReport = () => {
    const api = window.__CONFIG__?.services?.apiPlatform;
    if (!api) return "  window.__CONFIG__.services.apiPlatform → MISSING";
    const lists = api.apis?.loyaltyGuestOfferLists?.endpointPaths || {};
    const groups = api.apis?.loyaltyOfferGroups?.endpointPaths || {};
    const keys = api.circleOfferLoyaltyKeys || {};
    return [
      "  baseUrl: " + (api.baseUrl || "(none)"),
      "  getSavedOffersV1: " + (lists.getSavedOffersV1 || "(none)"),
      "  postOfferV1: " + (lists.postOfferV1 || "(none)"),
      "  deleteOfferV1: " + (lists.deleteOfferV1 || "(none)"),
      "  categories: " + (groups.getLoyaltyCategoriesV1 || "(none)"),
      "  collections: " + (groups.getLoyaltyCollectionsV1 || "(none)"),
      "  loyaltyApiKey: " + (keys.loyaltyApiKey ? "<present " + keys.loyaltyApiKey.length + " chars>" : "(none)"),
      "  loyaltyClientKey: " + (keys.loyaltyClientKey ? "<present " + keys.loyaltyClientKey.length + " chars>" : "(none)"),
    ].join("\n");
  };

  const domReport = () => {
    const lines = [];
    for (const sel of selectors) lines.push(`  ${sel} → ${document.querySelectorAll(sel).length} matches`);
    let textSave = 0, sampleAttrs = null, loadMore = 0, maxed = 0;
    document.querySelectorAll("button").forEach((b) => {
      const t = (b.textContent || "").trim().replace(/\s+/g, " ");
      const a = (b.getAttribute("aria-label") || "").trim();
      const tl = t.toLowerCase(), al = a.toLowerCase();
      if (SAVE_RE.test(tl) || SAVE_RE.test(al) || /^(save|activate|apply)\b/.test(al)) {
        textSave++;
        if (!sampleAttrs) {
          sampleAttrs = {
            className: (b.className || "").toString().slice(0, 120),
            testId: b.getAttribute("data-test") || b.getAttribute("data-testid") || "",
            aria: a.slice(0, 80),
            text: t.slice(0, 40),
          };
        }
      }
      if (/load more/i.test(t) || /load more/i.test(a)) loadMore++;
    });
    const bodyText = (document.body && document.body.innerText) || "";
    if (/free up some space|max(ed)?\s*(deals|offers)|offer limit/i.test(bodyText)) maxed = 1;
    lines.push(`  text/aria Save|Activate|Apply fallback → ${textSave} matches`);
    lines.push(`  "Load more" buttons → ${loadMore}`);
    lines.push(`  maxed-deals / capacity copy visible → ${maxed ? "yes" : "no"}`);
    if (sampleAttrs) lines.push("  SAMPLE save button attrs: " + JSON.stringify(sampleAttrs));
    return lines.join("\n");
  };

  const build = () => {
    const report =
      "=== TARGET CIRCLE PROBE ===\n" +
      "host: " + location.hostname + "\n" +
      "path: " + location.pathname + "\n\n" +
      "── window.__CONFIG__ apiPlatform ──\n" + configReport() + "\n\n" +
      "── DOM save/activate selectors ──\n" + domReport() + "\n\n" +
      "── captured offer requests (" + events.length + ") ──\n" +
      (events.length ? events.map((e, i) =>
        `#${i + 1} [${e.kind}] ${e.method} ${e.url}\n  headers: ${JSON.stringify(e.headers)}\n  body: ${e.body || "(none)"}`
      ).join("\n\n") : "(none yet — save/activate ONE offer manually, then copy again)");

    let box = document.getElementById("cc-probe-box");
    if (box) box.remove();
    box = document.createElement("div");
    box.id = "cc-probe-box";
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.7);display:flex;" +
      "flex-direction:column;align-items:center;justify-content:center;padding:24px;font:14px -apple-system,Segoe UI,Roboto,sans-serif";
    const head = document.createElement("div");
    head.style.cssText = "color:#fff;margin-bottom:10px;text-align:center;max-width:760px";
    head.textContent = "Target Circle probe report. Sensitive headers/bodies are masked. Review before sharing. Captured " +
      events.length + " offer request(s).";
    const ta = document.createElement("textarea");
    ta.value = report;
    ta.style.cssText = "width:min(760px,92vw);height:60vh;padding:12px;border-radius:8px;border:1px solid #555;" +
      "background:#0e141a;color:#eef2f5;font-family:monospace;font-size:12px";
    const row = document.createElement("div");
    row.style.cssText = "margin-top:12px;display:flex;gap:10px";
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    copy.style.cssText = "background:#cc0000;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer";
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
  fab.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#cc0000;color:#fff;" +
    "border:none;border-radius:24px;padding:12px 18px;font:600 15px -apple-system,Segoe UI,Roboto,sans-serif;" +
    "cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35)";
  fab.onclick = build;
  document.body.appendChild(fab);

  console.log("%c[target-probe]", "color:#cc0000;font-weight:bold",
    "watching Circle offer requests. Save/activate ONE offer manually, then click '📋 Probe report'.");
})();

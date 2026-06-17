/* for-U gallery PROBE — clips nothing. Confirms how to enumerate ALL offers.
 *
 * HOW TO RUN (Firefox or Chrome):
 *   1. Sign in to your store's site (safeway.com, vons.com, …) and open the for-U coupons & deals page.
 *   2. Open DevTools (F12) -> Console.
 *   3. Paste this whole file, press Enter, wait ~5 seconds for "REPORT READY".
 *   4. The full report is auto-copied to your clipboard -> just paste (Ctrl/Cmd+V)
 *      into the chat. (If clipboard copy was blocked, see the fallback note it prints.)
 *
 * It clips nothing. It reports: whether your session token is readable, your storeId,
 * the shape of the ecomgallery API for several program params, and the localStorage
 * coupon cache (abJ4uCoupons) — whichever returns the most offers is what we'll use.
 */
(async () => {
  const lines = [];
  // push(): print to console AND record a plain-text line for the copyable report.
  const push = (...parts) => {
    const text = parts
      .map((p) => (typeof p === "string" ? p : safeJson(p)))
      .join(" ");
    lines.push(text);
    console.log("%c[probe]", "color:#e2231a;font-weight:bold", ...parts);
  };
  const safeJson = (v) => {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };

  push("=== FOR-U GALLERY PROBE ===", "host:", location.hostname);

  // --- read page session (mirrors the working extension's page-script.js) ---
  const user = window.AB?.userInfo;
  const ref = window.userInfoServiceRefAL;
  const { clientId, clientSecret } = window.SWY?.CONFIGSERVICE?.datapowerConfig || {};
  const correlationId = user?.UUID || window.AB?.COMMON?.generateUUID?.() || "probe-" + Date.now();
  const token = user?.SWY_SHOP_TOKEN || ref?.service?._userSession?.SWY_SHOP_TOKEN;
  const storeId =
    user?.j4u?.storeId || user?.branchId ||
    ref?.service?.userInfo?.j4u?.storeId || ref?.service?.userInfo?.branchId ||
    (typeof window.getStoreId === "function" ? window.getStoreId() : "") || "";

  push("token present:", !!token, "| storeId:", storeId,
       "| clientId present:", !!clientId, "| clientSecret present:", !!clientSecret);
  if (!token) {
    push("NO TOKEN — make sure you're signed in and on the coupons page, then retry.");
    finish();
    return;
  }

  // Recursively find offer-like objects (has an id-ish field + looks like a coupon).
  const ID_KEYS = ["offerId", "offer_id", "offerID", "couponId", "id"];
  const PGM_KEYS = ["offerPgm", "offerProgramType", "programType", "program", "offerPgmType"];
  const collect = (node, out, seen) => {
    if (Array.isArray(node)) { node.forEach((n) => collect(n, out, seen)); return; }
    if (node && typeof node === "object") {
      const idKey = ID_KEYS.find((k) => node[k] != null && /^[A-Za-z0-9._-]+$/.test(String(node[k])));
      const looks = PGM_KEYS.some((k) => node[k] != null) ||
        node.offerPrice != null || node.title != null || node.description != null ||
        node.clipStatus != null || node.status != null || node.offerEndDate != null;
      if (idKey && looks) {
        const id = String(node[idKey]);
        if (!seen.has(id)) { seen.add(id); out.push(node); }
      }
      Object.values(node).forEach((v) => collect(v, out, seen));
    }
  };

  // --- 1) localStorage cache (often holds the full set) ---
  try {
    const raw = localStorage.getItem("abJ4uCoupons");
    if (raw) {
      const parsed = JSON.parse(raw);
      const oc = parsed.objCoupons;
      push("objCoupons type:", Array.isArray(oc) ? `array(${oc.length})` : typeof oc,
           oc && !Array.isArray(oc) ? "| keys: " + JSON.stringify(Object.keys(oc)) : "");
      const lsOffers = []; collect(oc, lsOffers, new Set());
      push(`objCoupons offer-like count: ${lsOffers.length}`);
      if (lsOffers.length) push("objCoupons SAMPLE OFFER:", lsOffers[0]);
      const clipped = parsed.arrClippedCoupons;
      push("arrClippedCoupons:", Array.isArray(clipped) ? `array(${clipped.length})` : typeof clipped,
           "| sample:", Array.isArray(clipped) ? clipped[0] : clipped);
    } else {
      push("localStorage abJ4uCoupons: (empty)");
    }
  } catch (e) { push("localStorage parse error:", e.message); }

  // --- 2) ecomgallery API, several program params ---
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    SWY_SSO_TOKEN: token,
    "X-swyConsumerDirectoryPro": token,
    "X-IBM-Client-Id": clientId || "",
    "X-IBM-Client-Secret": clientSecret || "",
    "X-SWY_API_KEY": "emjou",
    "X-SWY_BANNER": location.hostname.split(".").slice(-2, -1)[0] || "safeway",
    "X-SWY_VERSION": "1.0",
    "x-swy-correlation-id": correlationId,
  };
  const base = `https://${location.hostname}/abs/pub/web/j4u/api/ecomgallery`;
  const programs = ["PD-CC", "PD", "CC", "MF", "SC", "PD-CC-MF-SC"];

  const summarize = (data) => {
    if (Array.isArray(data)) return `array(${data.length})`;
    if (data && typeof data === "object")
      return "{ " + Object.entries(data).map(([k, v]) =>
        `${k}: ${Array.isArray(v) ? `array(${v.length})` : typeof v}`).join(", ") + " }";
    return typeof data;
  };

  const fetchT = async (url, ms = 8000) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, { headers, credentials: "include", signal: ac.signal }); }
    finally { clearTimeout(t); }
  };

  for (const pgm of programs) {
    const url = `${base}?offerPgm=${encodeURIComponent(pgm)}&storeId=${storeId}&transformOfferbyUpc=y`;
    try {
      const r = await fetchT(url);
      let data;
      try { data = await r.json(); } catch { data = await r.text(); }
      const off = data && data.offers;
      const offKeys = off && !Array.isArray(off) && typeof off === "object" ? Object.keys(off) : null;
      const found = []; collect(data, found, new Set());
      push(`gallery offerPgm=${pgm} -> HTTP ${r.status} | offers:`,
        Array.isArray(off) ? `array(${off.length})` : (offKeys ? `object keys(${offKeys.length}): ${JSON.stringify(offKeys.slice(0, 8))}` : typeof off),
        `| offer-like count: ${found.length}`);
      if (found.length && pgm === "PD-CC") push(`   SAMPLE OFFER[${pgm}]:`, found[0]);
    } catch (e) {
      push(`gallery offerPgm=${pgm} -> ${e.name === "AbortError" ? "TIMEOUT" : "ERROR"}`, e.message || "");
    }
  }

  finish();

  function finish() {
    const report = lines.join("\n");
    console.log("\n================ PROBE REPORT ================\n" + report +
      "\n================ END ================");

    // Try every clipboard path (best-effort).
    try { navigator.clipboard?.writeText(report); } catch (e) {}
    try { /* eslint-disable-next-line no-undef */ copy(report); } catch (e) {}

    // Unmissable on-page box with the text pre-selected — just Ctrl+C, then paste to chat.
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.7);" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;" +
      "font:14px -apple-system,Segoe UI,Roboto,sans-serif";
    const head = document.createElement("div");
    head.style.cssText = "color:#fff;margin-bottom:10px;text-align:center;max-width:760px";
    head.innerHTML = "<b>Probe report ready.</b> The text below is selected — press " +
      "<b>Ctrl+C</b> (Cmd+C) and paste it into the chat. (It may already be on your clipboard.)";
    const ta = document.createElement("textarea");
    ta.value = report;
    ta.style.cssText = "width:min(760px,92vw);height:60vh;padding:12px;border-radius:8px;" +
      "border:1px solid #555;background:#0e141a;color:#eef2f5;font-family:monospace;font-size:12px";
    const btn = document.createElement("button");
    btn.textContent = "Close";
    btn.style.cssText = "margin-top:12px;background:#e2231a;color:#fff;border:none;padding:10px 20px;" +
      "border-radius:8px;font-weight:600;cursor:pointer";
    btn.onclick = () => wrap.remove();
    wrap.append(head, ta, btn);
    document.body.appendChild(wrap);
    ta.focus(); ta.select();
  }
})();

/**
 * TAKE & BITE — Order API (secure version)
 * SETUP: run SETUP_ONCE() once, set SPREADSHEET_ID (and optional NOTIFY_EMAIL)
 * in Script Properties, set appsscript.json timeZone to "Asia/Dhaka",
 * deploy as Web app (Execute as Me, Anyone). No GITHUB_TOKEN is needed:
 * the admin panel writes to GitHub directly from the browser.
 */
const PROP = PropertiesService.getScriptProperties();
const SHEET_NAME = "Orders", ITEMS_SHEET = "Order Items";
const TZ = "Asia/Dhaka";
const STATUSES = ["New","Confirmed","Preparing","Out for delivery","Delivered","Cancelled"];

function SETUP_ONCE() {
  PROP.setProperties({GITHUB_OWNER:"saikat-71", GITHUB_REPO:"take-and-bite", GITHUB_BRANCH:"main"}, false);
  Logger.log("Done. Now add SPREADSHEET_ID (and optionally NOTIFY_EMAIL) in Script Properties.");
}

// ---------- routing ----------
function doGet(e) {
  const p = (e && e.parameter) || {};
  let result;
  try {
    if (p.action === "orderStatus") result = getOrderStatus_(p);
    else if (p.action === "data") result = getSiteData_();
    else result = {status:"ok", message:"Take & Bite API is running"};
  } catch (err) { result = {status:"error", message:String(err.message || err)}; }
  return p.callback ? jsonp_(String(p.callback), result) : json_(result);
}

function doPost(e) {
  const d = Object.assign({}, (e && e.parameter) || {});
  let result;
  try {
    if (typeof d.items === "string") d.items = JSON.parse(d.items);
    switch (d.action || "order") {
      case "order": result = saveOrder_(d); break;
      case "adminOrders": requireAdmin_(d.githubToken); result = getOrders_(); break;
      case "updateOrderStatus": requireAdmin_(d.githubToken); result = updateOrderStatus_(d); break;
      default: result = {status:"error", message:"Unknown action"};
    }
  } catch (err) { result = {status:"error", message:String(err.message || err)}; }
  return iframe_(result, d.origin, d.messageId);
}

// ---------- output helpers ----------
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function jsonp_(cb, o) {
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(cb)) return json_({status:"error", message:"Invalid callback."});
  return ContentService.createTextOutput(cb + "(" + JSON.stringify(o).replace(/</g, "\\u003c") + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function iframe_(obj, origin, messageId) {
  // HtmlService output sits in a nested sandbox frame, so post to window.top.
  const safeOrigin = /^https?:\/\/[A-Za-z0-9.\-:]+$/.test(origin || "") ? origin : "*";
  const msg = JSON.stringify({messageId: messageId || "", result: obj})
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return HtmlService.createHtmlOutput("<!doctype html><html><body><script>" +
    "window.top.postMessage(" + msg + "," + JSON.stringify(safeOrigin) + ");<\/script></body></html>");
}

// ---------- admin auth (config comes ONLY from Script Properties) ----------
function requireAdmin_(pat) {
  pat = String(pat || "").trim();
  if (!pat) throw new Error("Admin token required.");
  const key = "TB_ADMIN_" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pat));
  const cache = CacheService.getScriptCache();
  if (cache.get(key)) return true;
  const owner = PROP.getProperty("GITHUB_OWNER"), repo = PROP.getProperty("GITHUB_REPO");
  if (!owner || !repo) throw new Error("Run SETUP_ONCE() first.");
  const res = UrlFetchApp.fetch("https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo), {
    muteHttpExceptions: true,
    headers: {Authorization: "Bearer " + pat, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
  });
  let ok = false;
  if (res.getResponseCode() === 200) {
    const perms = JSON.parse(res.getContentText()).permissions || {};
    ok = !!(perms.push || perms.admin);
  }
  if (!ok) throw new Error("Not authorized: token needs write access to the repository.");
  cache.put(key, "1", 300);
  return true;
}

// ---------- site data / catalog ----------
function getSiteData_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("TB_SITE_DATA");
  if (hit) return {status:"success", siteData: JSON.parse(hit)};
  const owner = PROP.getProperty("GITHUB_OWNER"), repo = PROP.getProperty("GITHUB_REPO");
  const branch = PROP.getProperty("GITHUB_BRANCH") || "main";
  const res = UrlFetchApp.fetch("https://raw.githubusercontent.com/" + encodeURIComponent(owner) + "/" +
    encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/site-data.js?cb=" + Date.now(),
    {muteHttpExceptions: true, followRedirects: true});
  if (res.getResponseCode() !== 200) throw new Error("Could not read site data (HTTP " + res.getResponseCode() + ").");
  const raw = res.getContentText();
  const a = raw.indexOf("{", raw.indexOf("window.TB_DATA")), b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("site-data.js format not recognized.");
  const site = JSON.parse(raw.slice(a, b + 1));
  try { cache.put("TB_SITE_DATA", JSON.stringify(site), 120); } catch (_) {} // >100KB: skip cache
  return {status:"success", siteData: site};
}

function getCatalogIndex_() {
  const site = getSiteData_().siteData || {}, index = {};
  (site.products || []).forEach(p => {
    if (Array.isArray(p.variants) && p.variants.length) {
      // parent of a sized product is NOT orderable (fixes the price-0 hole)
      p.variants.forEach(v => index[v.id] = {id:v.id, productId:p.id, name:p.name || "", size:v.size || "", price:Number(v.price)});
    } else {
      index[p.id] = {id:p.id, productId:p.id, name:p.name || "", size:p.size || "", price:Number(p.price)};
    }
  });
  return index;
}

// ---------- orders ----------
function clean_(v, max) {
  let s = String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 200);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // block formula injection
  return s;
}
function minOrderDate_() { return Utilities.formatDate(new Date(Date.now() + 2 * 86400000), TZ, "yyyy-MM-dd"); }

function validateOrder_(d) {
  if (d.website) throw new Error("Rejected."); // honeypot
  const name = String(d.customerName || "").trim(), addr = String(d.address || "").trim();
  const phone = String(d.phone || "").replace(/[\s-]/g, "").replace(/^\+?880/, "0");
  if (name.length < 2) throw new Error("Please enter your name.");
  if (!/^01[3-9]\d{8}$/.test(phone)) throw new Error("Enter a valid Bangladeshi mobile number (01XXXXXXXXX).");
  if (addr.length < 3) throw new Error("Please enter address / pickup details.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.preferredDate || "")) || d.preferredDate < minOrderDate_())
    throw new Error("Delivery date must be at least 2 days from today.");
  if (["Pickup","Delivery"].indexOf(d.deliveryType) < 0) throw new Error("Invalid order method.");
  if (["Cash on delivery","bKash","Nagad","Other"].indexOf(d.paymentMethod) < 0) throw new Error("Invalid payment method.");
  const cache = CacheService.getScriptCache(), rk = "TB_RATE_" + phone;
  const n = Number(cache.get(rk) || 0);
  if (n >= 5) throw new Error("Too many orders from this number. Please try again later.");
  cache.put(rk, String(n + 1), 3600);
  return phone;
}

function normalizeOrderItems_(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 30) throw new Error("Cart is empty or too large.");
  const catalog = getCatalogIndex_(), items = [];
  let total = 0, count = 0;
  raw.forEach(r => {
    const c = catalog[String(r.id || "").trim()], q = Number(r.quantity);
    if (!c) throw new Error("One or more cart items are no longer available.");
    if (!Number.isInteger(q) || q < 1 || q > 100) throw new Error("Invalid cart quantity.");
    if (!Number.isFinite(c.price) || c.price <= 0) throw new Error("Invalid product price.");
    items.push({id:c.id, productId:c.productId, name:c.name, size:c.size, quantity:q, unitPrice:c.price, subtotal:c.price * q});
    total += c.price * q; count += q;
  });
  return {items:items, itemCount:count, grandTotal:total};
}

function saveOrder_(d) {
  const orderId = clean_(d.orderId || ("TB-" + Date.now()), 60);
  const cacheKey = "TB_ORDER_STATUS_" + orderId, cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const phone = validateOrder_(d);
    const sheet = getSheet_();
    const last = sheet.getLastRow();
    const ids = last >= 2 ? sheet.getRange(2, 2, last - 1, 1).getDisplayValues().flat() : [];
    if (ids.indexOf(orderId) >= 0) {
      const r = {status:"success", orderId:orderId, duplicate:true};
      cache.put(cacheKey, JSON.stringify(r), 600); return r;
    }
    const n = normalizeOrderItems_(d.items);
    const itemText = n.items.map(i => i.name + (i.size ? " (" + i.size + ")" : "") + " x" + i.quantity + " = ৳" + i.subtotal).join(" | ");
    const charge = d.deliveryType === "Pickup" ? 0 : "To be confirmed";
    sheet.appendRow([new Date(), orderId, clean_(d.customerName, 80), "'" + phone, clean_(d.address, 300),
      clean_(d.preferredDate, 10), d.deliveryType, clean_(d.deliveryLocation, 120), charge, d.paymentMethod,
      itemText, n.grandTotal, clean_(d.note, 500), "New", n.itemCount]);
    const rows = n.items.map(i => [new Date(), orderId, i.id, i.productId, i.name, i.size, i.quantity, i.unitPrice, i.subtotal]);
    const is = getItemsSheet_();
    is.getRange(is.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
    SpreadsheetApp.flush();
    const ok = {status:"success", orderId:orderId, itemCount:n.itemCount, total:n.grandTotal};
    cache.put(cacheKey, JSON.stringify(ok), 600);
    notifyOwner_(orderId, d, phone, itemText, n.grandTotal);
    return ok;
  } catch (err) {
    cache.put(cacheKey, JSON.stringify({status:"error", orderId:orderId, message:String(err.message || err)}), 600);
    throw err;
  } finally { lock.releaseLock(); }
}

function notifyOwner_(orderId, d, phone, itemText, total) {
  const to = PROP.getProperty("NOTIFY_EMAIL");
  if (!to) return;
  try {
    MailApp.sendEmail(to, "New order " + orderId + " — ৳" + total,
      "Name: " + d.customerName + "\nPhone: " + phone + "\nMethod: " + d.deliveryType +
      "\nAddress: " + d.address + "\nDate: " + d.preferredDate + "\nPayment: " + d.paymentMethod +
      "\n\n" + itemText + "\n\nTotal: ৳" + total + "\nNote: " + (d.note || ""));
  } catch (_) {}
}

function getOrderStatus_(p) {
  const id = String(p.orderId || "").trim();
  if (!id) return {status:"error", message:"Order ID is required."};
  const hit = CacheService.getScriptCache().get("TB_ORDER_STATUS_" + id);
  if (hit) { try { return JSON.parse(hit); } catch (_) {} }
  const sh = getSheet_(), last = sh.getLastRow();
  if (last >= 2) {
    const idx = sh.getRange(2, 2, last - 1, 1).getDisplayValues().flat().indexOf(id);
    if (idx >= 0) return {status:"success", orderId:id, total:Number(sh.getRange(idx + 2, 12).getValue()) || 0};
  }
  return {status:"pending", orderId:id};
}

function getOrders_() {
  const sh = getSheet_(), last = sh.getLastRow();
  if (last < 2) return {status:"success", orders:[]};
  const v = sh.getRange(2, 1, last - 1, 15).getDisplayValues().reverse();
  return {status:"success", orders: v.map(r => ({
    timestamp:r[0], orderId:r[1], customerName:r[2], phone:String(r[3]).replace(/^'/, ""), address:r[4],
    preferredDate:r[5], deliveryType:r[6], deliveryLocation:r[7], deliveryCharge:r[8], paymentMethod:r[9],
    items:r[10], total:r[11] || "0", note:r[12], status:r[13] || "New", itemCount:r[14]}))};
}

function updateOrderStatus_(d) {
  const id = String(d.orderId || "").trim(), status = String(d.status || "");
  if (STATUSES.indexOf(status) < 0) throw new Error("Invalid order status.");
  const sh = getSheet_(), last = sh.getLastRow();
  const idx = last >= 2 ? sh.getRange(2, 2, last - 1, 1).getDisplayValues().flat().indexOf(id) : -1;
  if (idx < 0) throw new Error("Order not found.");
  sh.getRange(idx + 2, 14).setValue(status);
  return {status:"success", message:"Order status updated."};
}

// ---------- sheets ----------
function ss_() {
  const id = PROP.getProperty("SPREADSHEET_ID");
  const s = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!s) throw new Error("Set SPREADSHEET_ID in Script Properties.");
  return s;
}
function getSheet_() {
  const s = ss_(); let sh = s.getSheetByName(SHEET_NAME) || s.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 15).setValues([["Timestamp","Order ID","Customer Name","Phone","Address","Preferred Date",
      "Order Method","Delivery Location","Delivery Charge","Payment Method","Items Summary","Grand Total","Note","Status","Item Count"]]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function getItemsSheet_() {
  const s = ss_(); let sh = s.getSheetByName(ITEMS_SHEET) || s.insertSheet(ITEMS_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 9).setValues([["Timestamp","Order ID","Cart Item ID","Product ID","Product Name","Size","Quantity","Unit Price","Subtotal"]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

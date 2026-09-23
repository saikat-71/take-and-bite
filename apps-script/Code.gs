/**
 * TAKE & BITE — Admin CMS + Order API + GitHub Sync
 *
 * ONE-TIME SETUP:
 * 1) Create a Google Sheet and open Extensions > Apps Script.
 * 2) Paste this file.
 * 3) Run SETUP_ONCE() once.
 * 4) Add GITHUB_TOKEN in Apps Script > Project Settings > Script Properties.
 *    Use a fine-grained token scoped only to this repository with Contents:
 *    Read and write permission. NEVER put the token in this source file.
 * 5) Deploy > New deployment > Web app > Execute as Me > Anyone.
 * 6) Put the Web App /exec URL in api-config.js.
 *
 * Admin login uses a GitHub Fine-grained PAT from the browser. The PAT is
 * verified for repository access and is never stored in Script Properties.
 *
 * SECURITY: Do not store GitHub tokens or plain-text admin passwords in code.
 */

const PROP = PropertiesService.getScriptProperties();
const SHEET_NAME = "Orders";
const DATA_PATH = "site-data.js";
const BRANCH = "main";

// ---------- ONE-TIME CONFIG ----------
function SETUP_ONCE() {
  // Repository settings only. The GitHub token must be stored in
  // Script Properties, not in source code.
  PROP.setProperties({
    GITHUB_OWNER: "saikat-71",
    GITHUB_REPO: "take-and-bite",
    GITHUB_BRANCH: "main"
  }, true);

  if (!PROP.getProperty("GITHUB_TOKEN")) {
    Logger.log("SETUP_ONCE completed. Now add GITHUB_TOKEN in Project Settings > Script Properties.");
  } else {
    Logger.log("SETUP_ONCE completed. GitHub token is already configured in Script Properties.");
  }
}

// Run this from the Apps Script editor once.
// This version does NOT call SpreadsheetApp.getUi(), so it works when
// started with the Run button in the Apps Script editor.
//
// It creates a strong random password, stores only a salted SHA-256 hash,
// and prints the generated password once in the execution log.
// Username is "admin". Re-run this function only when you intentionally
// want to replace the current admin password.
function SET_ADMIN_CREDENTIALS() {
  const user = "admin";
  const pass = generateAdminPassword_();
  const salt = Utilities.getUuid();

  PROP.setProperties({
    ADMIN_USERNAME: user,
    ADMIN_PASSWORD_SALT: salt,
    ADMIN_PASSWORD_HASH: hashPassword_(pass, salt)
  }, true);

  // Remove any legacy plaintext credential.
  PROP.deleteProperty("ADMIN_PASSWORD");
  PROP.deleteProperty("ADMIN_SETUP_PASSWORD");

  Logger.log("==========================================");
  Logger.log("TAKE & BITE ADMIN CREDENTIALS");
  Logger.log("Username: " + user);
  Logger.log("Password: " + pass);
  Logger.log("SAVE THIS PASSWORD NOW. It is not stored as plain text.");
  Logger.log("==========================================");
}

function generateAdminPassword_() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  const random = Utilities.getUuid().replace(/-/g, "");
  for (let i = 0; i < 20; i++) {
    const n = parseInt(random.substr((i * 2) % random.length, 2), 16);
    out += chars[n % chars.length];
  }
  return out;
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + String(password),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}
// -------------------------------------

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "ping";
  try {
    if (action === "ping") return json_({status:"ok", message:"Take & Bite API is running"});
    if (action === "orderStatus") {
      const result = getOrderStatus_(e.parameter || {});
      const callback = String((e.parameter && e.parameter.callback) || "").trim();
      if (callback) return jsonp_(callback, result);
      return json_(result);
    }
    if (action === "data") {
      const result = getSiteData_();
      const callback = String((e.parameter && e.parameter.callback) || "").trim();
      if (callback) return jsonp_(callback, result);
      if (e.parameter && e.parameter.transport === "iframe") return iframe_(result, e.parameter.origin, e.parameter.messageId);
      return json_(result);
    }
    if (action === "adminOrders") {
      const result = getOrdersWithGithubAuth_(e.parameter || {});
      const callback = String((e.parameter && e.parameter.callback) || "").trim();
      if (callback) return jsonp_(callback, result);
      return json_(result);
    }
    return json_({status:"ok"});
  } catch(err) {
    const result={status:"error", message:String(err)};
    if (e && e.parameter && e.parameter.transport === "iframe") return iframe_(result, e.parameter.origin, e.parameter.messageId);
    if (e && e.parameter && e.parameter.callback) return jsonp_(String(e.parameter.callback), result);
    return json_(result);
  }
}

function doPost(e) {
  try {
    // Supports both JSON requests and hidden-iframe form requests.
    let data = {};
    const isForm = e && e.parameter && e.parameter.action;
    if (isForm) {
      data = Object.assign({}, e.parameter);
      if (data.siteData) data.siteData = JSON.parse(data.siteData);
      if (data.items && typeof data.items === "string") data.items = JSON.parse(data.items);
    } else {
      data = JSON.parse(e.postData.contents || "{}");
    }

    const action = data.action || "order";
    let result;

    if (action === "githubLogin") result = githubLogin_(data);
    else if (action === "login") result = login_(data);
    else if (action === "logout") result = logout_(data);
    else if (action === "saveData") {
      requireAuth_(data.token);
      commitData_(data.siteData);
      result = {status:"success", message:"Website data updated. GitHub Pages will publish it automatically."};
    }
    else if (action === "uploadImage") {
      requireAuth_(data.token);
      const path = safePath_(data.path);
      commitFile_(path, data.base64, data.mimeType || "image/jpeg", data.message || "Admin: upload image");
      result = {status:"success", path:path};
    }
    else if (action === "deleteImage") {
      requireAuth_(data.token);
      deleteFile_(safePath_(data.path), data.message || "Admin: delete image");
      result = {status:"success"};
    }
    else if (action === "getOrders") {
      requireAuth_(data.token);
      result = getOrders_();
    }
    else if (action === "updateOrderStatus") {
      if (data.githubToken) verifyGitHubToken_(data);
      else requireAuth_(data.token);
      result = updateOrderStatus_(data);
    }
    else if (action === "order") result = saveOrder_(data);
    else result = {status:"error", message:"Unknown action"};

    if (isForm && data.transport === "iframe") return iframe_(result, data.origin, data.messageId);
    return json_(result);
  } catch(err) {
    const result={status:"error", message:String(err)};
    if (e && e.parameter && e.parameter.transport === "iframe") return iframe_(result, e.parameter.origin, e.parameter.messageId);
    return json_(result);
  }
}

function iframe_(obj, origin, messageId) {
  // The admin panel submits forms into a hidden iframe, so it works even
  // when the browser blocks normal cross-origin fetch calls to Apps Script.
  const safeOrigin = String(origin || "*").replace(/'/g, "");
  const msg = JSON.stringify({messageId:messageId || "", result:obj})
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const html = "<!doctype html><html><body><script>" +
    "window.parent.postMessage(" + msg + ",'" + safeOrigin + "');" +
    "<\\/script></body></html>";
  return HtmlService.createHtmlOutput(html);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(callback, obj) {
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback)) {
    return json_({status:"error", message:"Invalid callback."});
  }
  const body = callback + "(" + JSON.stringify(obj).replace(/</g,"\\u003c") + ");";
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function verifyGitHubToken_(data) {
  const pat = String(data.githubToken || "").trim();
  const owner = String(data.githubOwner || PROP.getProperty("GITHUB_OWNER") || "").trim();
  const repo = String(data.githubRepo || PROP.getProperty("GITHUB_REPO") || "").trim();
  if (!pat || !owner || !repo) throw new Error("GitHub username, repository and token are required.");
  const url = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/contents/" + encodeURIComponent(DATA_PATH) + "?ref=" + encodeURIComponent(PROP.getProperty("GITHUB_BRANCH") || BRANCH);
  const res = UrlFetchApp.fetch(url, {method:"get", muteHttpExceptions:true, headers:{Authorization:"Bearer " + pat, Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28"}});
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error("GitHub authentication failed. Check the PAT, repository and Contents permission.");
  return true;
}

function getOrdersWithGithubAuth_(params) {
  verifyGitHubToken_(params);
  return getOrders_();
}


function githubLogin_(data) {
  const pat = String(data.githubToken || "").trim();
  if (!pat) return {status:"error", message:"GitHub Personal Access Token is required."};

  const owner = String(data.githubOwner || PROP.getProperty("GITHUB_OWNER") || "saikat-71").trim();
  const repo = String(data.githubRepo || PROP.getProperty("GITHUB_REPO") || "take-and-bite").trim();
  const branch = PROP.getProperty("GITHUB_BRANCH") || BRANCH;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return {status:"error", message:"Invalid GitHub username or repository name."};
  }

  try {
    const url = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) + "/contents/" + encodeURIComponent(DATA_PATH) +
      "?ref=" + encodeURIComponent(branch);

    const res = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true,
      headers: {
        Authorization: "Bearer " + pat,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    const code = res.getResponseCode();

    if (code < 200 || code >= 300) {
      return {
        status:"error",
        message:"GitHub authentication failed. Check the PAT, repository access, and Contents: Read permission."
      };
    }

    const session = Utilities.getUuid() + "-" + Utilities.getUuid();
    CacheService.getScriptCache().put("TB_SESSION_" + session, "github-admin", 21600);

    return {
      status:"success",
      token:session,
      username:"github-admin"
    };
  } catch (err) {
    return {status:"error", message:"Could not verify the GitHub token: " + String(err)};
  }
}

function login_(data) {
  const user = PROP.getProperty("ADMIN_USERNAME") || "";
  const salt = PROP.getProperty("ADMIN_PASSWORD_SALT") || "";
  const hash = PROP.getProperty("ADMIN_PASSWORD_HASH") || "";
  const legacyPass = PROP.getProperty("ADMIN_PASSWORD") || "";

  const suppliedUser = String(data.username || "").trim();
  const suppliedPass = String(data.password || "");

  // Small server-side lockout to slow repeated guesses.
  const attemptsKey = "TB_LOGIN_ATTEMPTS_" + suppliedUser.toLowerCase();
  const attempts = Number(CacheService.getScriptCache().get(attemptsKey) || 0);
  if (attempts >= 8) return {status:"error", message:"Too many failed attempts. Please wait a few minutes and try again."};

  let valid = false;
  if (user && hash && salt) {
    valid = suppliedUser === user && hashPassword_(suppliedPass, salt) === hash;
  } else {
    // Backward compatibility for an older deployment. Replace it by running
    // SET_ADMIN_CREDENTIALS() and remove ADMIN_PASSWORD afterwards.
    valid = suppliedUser === user && legacyPass && suppliedPass === legacyPass;
  }

  if (!valid) {
    CacheService.getScriptCache().put(attemptsKey, String(attempts + 1), 300);
    return {status:"error", message:"Invalid username or password."};
  }

  CacheService.getScriptCache().remove(attemptsKey);
  const token = Utilities.getUuid() + "-" + Utilities.getUuid();
  CacheService.getScriptCache().put("TB_SESSION_" + token, user, 21600);
  return {status:"success", token:token, username:user};
}

function requireAuth_(token) {
  if (!token || !CacheService.getScriptCache().get("TB_SESSION_" + token)) {
    throw new Error("Session expired. Please log in again.");
  }
}

function logout_(data) {
  if (data.token) CacheService.getScriptCache().remove("TB_SESSION_" + data.token);
  return {status:"success"};
}

function getSiteData_() {
  const raw = getFileText_(DATA_PATH);
  const marker = "window.TB_DATA = ";
  const start = raw.indexOf(marker);
  if (start < 0) throw new Error("site-data.js format not recognized.");
  const jsonText = raw.slice(start + marker.length).replace(/;\s*$/, "").trim();
  return {status:"success", siteData:JSON.parse(jsonText)};
}

function commitData_(siteData) {
  if (!siteData || typeof siteData !== "object") throw new Error("Invalid site data.");
  const content = "window.TB_DATA = " + JSON.stringify(siteData, null, 2) + ";\n";
  putTextFile_(DATA_PATH, content, "Admin: update website content");
}

function safePath_(p) {
  p = String(p || "").replace(/^\/+/, "");
  if (!/^assets\/uploads\/[A-Za-z0-9._\-\/]+$/.test(p)) {
    throw new Error("Invalid image path.");
  }
  return p;
}

function commitFile_(path, base64, mimeType, message) {
  if (!base64) throw new Error("Image data missing.");
  const bytes = Utilities.base64Decode(String(base64).replace(/^data:[^,]+,/, ""));
  const content = Utilities.base64Encode(bytes);
  putBase64File_(path, content, message);
  return path;
}

function githubBase_() {
  const owner = PROP.getProperty("GITHUB_OWNER");
  const repo = PROP.getProperty("GITHUB_REPO");
  const branch = PROP.getProperty("GITHUB_BRANCH") || BRANCH;
  const token = PROP.getProperty("GITHUB_TOKEN");
  if (!owner || !repo || !token || owner.indexOf("YOUR_") === 0 || token.indexOf("YOUR_") === 0) {
    throw new Error("GitHub settings are not configured. Run SETUP_ONCE(), then add GITHUB_TOKEN in Project Settings > Script Properties.");
  }
  return {owner:owner, repo:repo, branch:branch, token:token};
}

function githubRequest_(method, endpoint, body) {
  const g = githubBase_();
  const options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: "Bearer " + g.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  };
  if (body !== undefined) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch("https://api.github.com/repos/" + g.owner + "/" + g.repo + endpoint, options);
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error("GitHub API " + code + ": " + text);
  return text ? JSON.parse(text) : {};
}

function getFileMeta_(path) {
  const g = githubBase_();
  try {
    return githubRequest_("get", "/contents/" + encodePath_(path) + "?ref=" + encodeURIComponent(g.branch));
  } catch(err) {
    if (String(err).indexOf("GitHub API 404") >= 0) return null;
    throw err;
  }
}

function getFileText_(path) {
  const meta = getFileMeta_(path);
  if (!meta || !meta.content) throw new Error("File not found in GitHub: " + path);
  return Utilities.newBlob(Utilities.base64Decode(meta.content.replace(/\n/g, ""))).getDataAsString();
}

function putTextFile_(path, text, message) {
  putBase64File_(path, Utilities.base64Encode(Utilities.newBlob(text).getBytes()), message);
}

function putBase64File_(path, base64, message) {
  const g = githubBase_();
  const meta = getFileMeta_(path);
  const body = {
    message: message,
    content: base64,
    branch: g.branch
  };
  if (meta && meta.sha) body.sha = meta.sha;
  githubRequest_("put", "/contents/" + encodePath_(path), body);
}

function deleteFile_(path, message) {
  const g = githubBase_();
  const meta = getFileMeta_(path);
  if (!meta || !meta.sha) return;
  githubRequest_("delete", "/contents/" + encodePath_(path), {
    message: message,
    sha: meta.sha,
    branch: g.branch
  });
}

function encodePath_(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// ---------- Existing order receiver ----------
function getCatalogIndex_() {
  const site = getSiteData_().siteData || {};
  const index = {};
  (site.products || []).forEach(product => {
    index[product.id] = {
      id: product.id,
      name: product.name || "",
      size: product.size || "",
      price: Number(product.price || 0)
    };
    (product.variants || []).forEach(variant => {
      index[variant.id] = {
        id: variant.id,
        productId: product.id,
        name: product.name || "",
        size: variant.size || "",
        price: Number(variant.price || 0)
      };
    });
  });
  return index;
}

function normalizeOrderItems_(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new Error("Cart is empty.");
  const catalog = getCatalogIndex_();
  const items = [];
  let grandTotal = 0;
  let itemCount = 0;

  rawItems.forEach(raw => {
    const id = String(raw.id || raw.productId || "").trim();
    const catalogItem = catalog[id];
    const qty = Number(raw.quantity);
    if (!catalogItem) throw new Error("One or more cart items are no longer available.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw new Error("Invalid cart quantity.");
    if (!Number.isFinite(catalogItem.price) || catalogItem.price < 0) throw new Error("Invalid product price.");

    const subtotal = catalogItem.price * qty;
    itemCount += qty;
    grandTotal += subtotal;
    items.push({
      id: catalogItem.id,
      productId: catalogItem.productId || catalogItem.id,
      name: catalogItem.name,
      size: catalogItem.size,
      quantity: qty,
      unitPrice: catalogItem.price,
      subtotal: subtotal
    });
  });

  return {items: items, itemCount: itemCount, grandTotal: grandTotal};
}

function saveOrder_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  const orderId = String(data.orderId || ("TB-" + Date.now())).trim();
  const cacheKey = "TB_ORDER_STATUS_" + orderId;
  CacheService.getScriptCache().put(cacheKey, JSON.stringify({status:"pending", orderId:orderId}), 600);
  try {
    const normalized = normalizeOrderItems_(data.items || []);
    const sheet = getOrCreateSheet_();
    const itemText = normalized.items.map(item =>
      `${item.name}${item.size ? " (" + item.size + ")" : ""} x${item.quantity} = ৳${item.subtotal}`
    ).join(" | ");

    // Prevent accidental duplicate orders if the browser retries the request.
    const existing = sheet.getLastRow() >= 2
      ? sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues().flat()
      : [];
    if (existing.indexOf(orderId) >= 0) {
      const existingRow = existing.indexOf(orderId) + 2;
      const existingTotal = Number(sheet.getRange(existingRow, 12).getValue()) || 0;
      const duplicateResult = {status:"success", orderId:orderId, itemCount:normalized.itemCount, total:existingTotal, duplicate:true};
      CacheService.getScriptCache().put(cacheKey, JSON.stringify(duplicateResult), 600);
      return duplicateResult;
    }

    sheet.appendRow([
      new Date(),
      orderId,
      String(data.customerName || "").trim(),
      String(data.phone || "").trim(),
      String(data.address || "").trim(),
      data.preferredDate || "",
      data.deliveryType || "",
      data.deliveryLocation || "",
      data.deliveryCharge ?? "",
      data.paymentMethod || "",
      itemText,
      normalized.grandTotal,
      data.note || "",
      "New",
      normalized.itemCount
    ]);

    const itemsSheet = getOrCreateItemsSheet_();
    const rows = normalized.items.map(item => [
      new Date(),
      orderId,
      item.id,
      item.productId,
      item.name,
      item.size,
      item.quantity,
      item.unitPrice,
      item.subtotal
    ]);
    itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, rows.length, 9).setValues(rows);

    // Force the spreadsheet write before returning success to the customer.
    SpreadsheetApp.flush();

    const successResult = {
      status:"success",
      orderId:orderId,
      itemCount:normalized.itemCount,
      total:normalized.grandTotal
    };
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(successResult), 600);
    return successResult;
  } catch (err) {
    const errorResult = {status:"error", orderId:orderId, message:String(err)};
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(errorResult), 600);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function getOrderStatus_(params) {
  const orderId = String((params && params.orderId) || "").trim();
  if (!orderId) return {status:"error", message:"Order ID is required."};
  const cached = CacheService.getScriptCache().get("TB_ORDER_STATUS_" + orderId);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }
  // Fallback: if the write completed but the cache entry expired, confirm from the sheet.
  const sheet = getOrCreateSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues().flat();
    const idx = ids.indexOf(orderId);
    if (idx >= 0) {
      const row = idx + 2;
      const total = Number(sheet.getRange(row, 12).getValue()) || 0;
      const result = {status:"success", orderId:orderId, total:total};
      CacheService.getScriptCache().put("TB_ORDER_STATUS_" + orderId, JSON.stringify(result), 600);
      return result;
    }
  }
  return {status:"pending", orderId:orderId};
}

function getOrders_() {
  const sheet = getOrCreateSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {status:"success", orders:[]};
  const width = Math.max(sheet.getLastColumn(), 15);
  const values = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  const orders = values.reverse().map((r, i) => ({
    row: lastRow - i,
    timestamp: r[0] || "",
    orderId: r[1] || "",
    customerName: r[2] || "",
    phone: r[3] || "",
    address: r[4] || "",
    preferredDate: r[5] || "",
    deliveryType: r[6] || "",
    deliveryLocation: r[7] || "",
    deliveryCharge: r[8] || "",
    paymentMethod: r[9] || "",
    items: r[10] || "",
    total: r[11] || "0",
    note: r[12] || "",
    status: r[13] || "New",
    itemCount: r[14] || ""
  }));
  return {status:"success", orders:orders};
}

function updateOrderStatus_(data) {
  const row = Number(data.row);
  const status = String(data.status || "New").trim();
  const allowed = ["New", "Confirmed", "Preparing", "Out for delivery", "Delivered", "Cancelled"];
  if (!Number.isInteger(row) || row < 2) throw new Error("Invalid order row.");
  if (allowed.indexOf(status) < 0) throw new Error("Invalid order status.");
  const sheet = getOrCreateSheet_();
  if (row > sheet.getLastRow()) throw new Error("Order not found.");
  sheet.getRange(row, 14).setValue(status);
  return {status:"success", message:"Order status updated."};
}

function getOrCreateSheet_() {
  const spreadsheetId = PROP.getProperty("SPREADSHEET_ID");
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Google Sheet is not connected. Set SPREADSHEET_ID in Script Properties or bind the Apps Script to the order spreadsheet.");
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

  const headers = [
    "Timestamp","Order ID","Customer Name","Phone","Address","Preferred Date",
    "Order Method","Delivery Location","Delivery Charge","Payment Method",
    "Items Summary","Grand Total","Note","Status","Item Count"
  ];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    // Upgrade older 14-column sheets without deleting any existing orders.
    if (sheet.getRange(1, 15).getValue() !== "Item Count") {
      sheet.getRange(1, 15).setValue("Item Count");
    }
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateItemsSheet_() {
  const spreadsheetId = PROP.getProperty("SPREADSHEET_ID");
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Google Sheet is not connected.");
  let sheet = spreadsheet.getSheetByName("Order Items");
  if (!sheet) sheet = spreadsheet.insertSheet("Order Items");
  const headers = ["Timestamp","Order ID","Cart Item ID","Product ID","Product Name","Size","Quantity","Unit Price","Subtotal"];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

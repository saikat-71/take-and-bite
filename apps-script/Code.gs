/**
 * TAKE & BITE - Google Sheets Order Receiver
 *
 * SETUP:
 * 1. Create a Google Sheet.
 * 2. Open Extensions > Apps Script.
 * 3. Replace the default code with this code.
 * 4. Change SHEET_NAME if needed.
 * 5. Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 * 6. Copy the Web App URL and paste it into index.html:
 *    const GOOGLE_APPS_SCRIPT_URL = "YOUR_URL";
 */

const SHEET_NAME = "Orders";

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({status: "ok", message: "Take & Bite order API is running"}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet_();

    const itemText = (data.items || []).map(item =>
      `${item.name} (${item.size}) x${item.quantity} = ৳${item.subtotal}`
    ).join(" | ");

    sheet.appendRow([
      new Date(),
      data.orderId || "",
      data.customerName || "",
      data.phone || "",
      data.address || "",
      data.preferredDate || "",
      data.deliveryType || "",
      data.deliveryLocation || "",
      data.deliveryCharge ?? "",
      data.paymentMethod || "",
      itemText,
      data.total || 0,
      data.note || "",
      "New"
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({status: "success", orderId: data.orderId}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({status: "error", message: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Timestamp",
      "Order ID",
      "Customer Name",
      "Phone",
      "Address",
      "Preferred Date",
      "Order Method",
      "Delivery Location",
      "Delivery Charge",
      "Payment Method",
      "Items",
      "Total",
      "Note",
      "Status"
    ]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

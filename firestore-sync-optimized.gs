/**
 * OPTIMIZED SYNC GOOGLE SHEETS → FIRESTORE (v2)
 * - Uses Batch Writes (Atomic Commit) to avoid 429 Errors
 * - Implements Pagination for listing documents
 * - Deletes removed docs efficiently
 * - Only 1 Read cycle for existing data
 */

const FIREBASE_CONFIG = {
  project_id: "navodaymlibrary",
  // Note: These are kept for structure, but the script uses getOAuthToken() below.
  // Ensure your Cloud Project has the "Cloud Datastore API" enabled.
  client_email: "YOUR_SERVICE_ACCOUNT_EMAIL@navodaymlibrary.iam.gserviceaccount.com"
};

/**
 * MAIN SYNC FUNCTION
 */
function syncSheetToFirestore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Book') || 
                ss.getSheetByName('Form_Responses1') || 
                ss.getSheets()[0];
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert("No sheet found!");
    return;
  }

  const data = sheet.getDataRange().getValues();
  const collectionName = "books";

  console.log("Fetching existing Firestore data with pagination...");
  const firebaseMap = getAllFirestoreDocsMap(collectionName);
  console.log(`Found ${Object.keys(firebaseMap).length} existing documents.`);

  const sheetDocIds = [];
  const seenStocks = new Set();
  const writeBatch = []; // 🔥 BATCH ARRAY

  console.log("Processing sheet data...");

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const stock = String(row[1]);
    if (!stock || stock === "undefined") continue;

    // 🚫 SKIP DUPLICATES in Sheet
    if (seenStocks.has(stock)) {
      console.log("Duplicate skipped in sheet:", stock);
      continue;
    }
    seenStocks.add(stock);

    const docId = "BOOK-" + stock;
    sheetDocIds.push(docId);

    const bookData = {
      stock_number: stock,
      call_number: String(row[2]),
      title: String(row[3]),
      author: String(row[4]),
      category: String(row[5]),
      language: String(row[6]),
      price: String(row[7]),
      publisher: String(row[8]),
      edition: String(row[9]),
      shelf: String(row[10]),
      available: true,
      last_updated: String(row[11] || "")
    };

    if (!bookData.title || bookData.title === "undefined") continue;

    const existing = firebaseMap[docId];

    // ✅ SKIP if no changes
    if (existing && existing.last_updated === bookData.last_updated) {
      continue;
    }

    // ➕ ADD TO BATCH (Update)
    const docPath = `projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents/${collectionName}/${docId}`;
    writeBatch.push({
      update: {
        name: docPath,
        fields: encodeFirestoreFields(bookData)
      }
    });

    // 🚀 EXECUTE BATCH if it reaches 500
    if (writeBatch.length >= 500) {
      commitBatch(writeBatch);
      writeBatch.length = 0; // Clear array
    }
  }

  // 🧹 HANDLE DELETIONS
  console.log("Checking for books to remove...");
  const firebaseDocIds = Object.keys(firebaseMap);

  firebaseDocIds.forEach(docId => {
    if (!sheetDocIds.includes(docId)) {
      const docPath = `projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents/${collectionName}/${docId}`;
      writeBatch.push({
        delete: docPath
      });

      // 🚀 EXECUTE BATCH if it reaches 500
      if (writeBatch.length >= 500) {
        commitBatch(writeBatch);
        writeBatch.length = 0;
      }
    }
  });

  // 🏁 FINAL FLUSH
  if (writeBatch.length > 0) {
    commitBatch(writeBatch);
  }

  SpreadsheetApp.getUi().alert("✅ Optimized Sync Complete!");
  console.log("Sync process finished.");
}

/**
 * 📦 COMMIT BATCH TO FIRESTORE
 */
function commitBatch(writes) {
  console.log(`Committing batch of ${writes.length} operations...`);
  const token = ScriptApp.getOAuthToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents:commit`;

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ writes: writes }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    console.error("Batch Error:", response.getContentText());
    throw new Error("Batch commit failed. See logs.");
  }
}

/**
 * 🔥 FETCH ALL FIREBASE DOCS (WITH PAGINATION)
 */
function getAllFirestoreDocsMap(collection) {
  const token = ScriptApp.getOAuthToken();
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents/${collection}`;
  
  let map = {};
  let pageToken = null;
  let hasMore = true;

  while (hasMore) {
    let url = baseUrl + "?pageSize=300"; // Max for list is usually 300-500
    if (pageToken) {
      url += "&pageToken=" + pageToken;
    }

    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.error("Fetch Error:", response.getContentText());
      break;
    }

    const data = JSON.parse(response.getContentText());
    
    if (data.documents) {
      data.documents.forEach(doc => {
        const docId = doc.name.split("/").pop();
        map[docId] = decodeFirestoreFields(doc.fields);
      });
    }

    pageToken = data.nextPageToken;
    hasMore = !!pageToken;
  }

  return map;
}

/**
 * 🔄 ENCODE FOR FIRESTORE (REST API)
 */
function encodeFirestoreFields(data) {
  const fields = {};
  for (const key in data) {
    if (typeof data[key] === 'boolean') {
      fields[key] = { booleanValue: data[key] };
    } else {
      fields[key] = { stringValue: String(data[key]) };
    }
  }
  return fields;
}

/**
 * 🔄 DECODE FROM FIRESTORE
 */
function decodeFirestoreFields(fields) {
  const obj = {};
  for (let key in fields) {
    const val = fields[key];
    if (val.booleanValue !== undefined) obj[key] = val.booleanValue;
    else if (val.stringValue !== undefined) obj[key] = val.stringValue;
    else if (val.integerValue !== undefined) obj[key] = val.integerValue;
    else obj[key] = "";
  }
  return obj;
}

/**
 * 📋 MENU BUTTON
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Firebase Sync')
      .addItem('Sync Library Now', 'syncSheetToFirestore')
      .addToUi();
}

/**
 * ⏱️ AUTO UPDATE TIMESTAMP WHEN EDITING
 */
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const range = e.range;
  const row = range.getRow();
  
  // Only trigger on data rows (not header)
  if (row <= 1) return;

  const timestampCol = 12; // Column L
  sheet.getRange(row, timestampCol).setValue(new Date().toISOString());
}

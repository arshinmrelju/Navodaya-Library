/**
 * INCREMENTAL SYNC: GOOGLE SHEETS → FIRESTORE
 * - Processes 5000 records per run (Adjust BATCH_SIZE for balance sync)
 * - Resumes from where it left off using PropertiesService
 * - Zero FireStore Reads: Uses a 'Sync Hash' in Column M to detect changes
 * - Switch to 'Delta Mode' after full initial sync
 */

const FIREBASE_CONFIG = {
  project_id: "navodhayam-library"
};

const SYNC_CONFIG = {
  BATCH_SIZE: 5000,
  HASH_COL: 13, // Column M
  STOCK_COL: 2,  // Column B
  START_ROW: 2   // Skip Header
};

const SYNC_CONFIG_MEMBERS = {
  SHEET_NAME: 'Members',
  BATCH_SIZE: 1000,
  HASH_COL: 13, // Column M
  START_ROW: 2
};

/**
 * MAIN ENTRY POINT: Run this via Trigger or Menu
 */
function runIncrementalSync() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Book') || ss.getSheets()[0];
  const totalRows = sheet.getLastRow();
  
  const props = PropertiesService.getScriptProperties();
  let lastProcessed = parseInt(props.getProperty('LAST_SYNC_ROW')) || (SYNC_CONFIG.START_ROW - 1);
  
  // Reset if we reached the end
  if (lastProcessed >= totalRows) {
    console.log("Full sync cycle completed. Restarting from row 2...");
    lastProcessed = SYNC_CONFIG.START_ROW - 1;
  }

  const startRow = lastProcessed + 1;
  const numRows = Math.min(SYNC_CONFIG.BATCH_SIZE, totalRows - startRow + 1);
  
  if (numRows <= 0) {
    console.log("No new rows to sync.");
    return;
  }

  console.log(`Starting Balance Sync from row ${startRow} to ${startRow + numRows - 1}`);
  
  const dataRange = sheet.getRange(startRow, 1, numRows, SYNC_CONFIG.HASH_COL);
  const data = dataRange.getValues();
  const writeBatch = [];
  const updatedHashes = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const stock = String(row[1]); // Column B
    if (!stock || stock === "undefined") {
      updatedHashes.push([row[SYNC_CONFIG.HASH_COL - 1]]); // Keep same hash
      continue;
    }

    const docId = "BOOK-" + stock;
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

    // Calculate Hash of current data
    const currentHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(bookData)));
    const storedHash = String(row[SYNC_CONFIG.HASH_COL - 1]);

    // 🚀 SKIP if data hasn't changed
    if (currentHash === storedHash) {
      updatedHashes.push([storedHash]);
      continue;
    }

    // ➕ ADD TO BATCH
    const docPath = `projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents/books/${docId}`;
    writeBatch.push({
      update: {
        name: docPath,
        fields: encodeFirestoreFields(bookData)
      }
    });

    updatedHashes.push([currentHash]);

    // Commit if batch is full
    if (writeBatch.length >= 500) {
      commitBatch(writeBatch);
      writeBatch.length = 0;
    }
  }

  // Final flush
  if (writeBatch.length > 0) {
    commitBatch(writeBatch);
  }

  // Update hash column for the processed batch
  sheet.getRange(startRow, SYNC_CONFIG.HASH_COL, numRows, 1).setValues(updatedHashes);

  // Save progress
  props.setProperty('LAST_SYNC_ROW', (startRow + numRows - 1).toString());
  
  console.log(`Successfully processed ${numRows} rows. Last row: ${startRow + numRows - 1}`);

  // 📊 Update Sync Stats for the Admin Panel
  updateSyncStats(startRow + numRows - 1, totalRows);
}

/**
 * 👥 BI-DIRECTIONAL MEMBER SYNC
 */
function runMemberSync() {
  console.log("--- Starting Member Sync ---");
  syncMembersFromFirestore(); // Firestore -> Sheet (Reverse Sync)
  syncMembersFromSheet();     // Sheet -> Firestore (Forward Sync)
  console.log("--- Member Sync Completed ---");
}

/**
 * 📤 SHEET → FIRESTORE (Forward Member Sync)
 */
function syncMembersFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SYNC_CONFIG_MEMBERS.SHEET_NAME);
  if (!sheet) return;

  const totalRows = sheet.getLastRow();
  const props = PropertiesService.getScriptProperties();
  let lastProcessed = parseInt(props.getProperty('LAST_SYNC_ROW_MEMBERS')) || (SYNC_CONFIG_MEMBERS.START_ROW - 1);

  if (lastProcessed >= totalRows) lastProcessed = SYNC_CONFIG_MEMBERS.START_ROW - 1;

  const startRow = lastProcessed + 1;
  const numRows = Math.min(SYNC_CONFIG_MEMBERS.BATCH_SIZE, totalRows - startRow + 1);
  if (numRows <= 0) return;

  const dataRange = sheet.getRange(startRow, 1, numRows, SYNC_CONFIG_MEMBERS.HASH_COL);
  const data = dataRange.getValues();
  const writeBatch = [];
  const updatedHashes = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const email = String(row[6]); // Column G
    const phone = String(row[5]); // Column F
    if (!email && !phone) {
      updatedHashes.push([row[SYNC_CONFIG_MEMBERS.HASH_COL - 1]]);
      continue;
    }

    // Use email or phone as doc ID basis if UID is not known
    const docId = email ? email.replace(/[^a-zA-Z0-9]/g, '_') : phone;
    const memberData = {
      memberId: String(row[1]),
      name: String(row[2]),
      address: String(row[3]),
      age: String(row[4]),
      phone: String(row[5]),
      email: String(row[6]),
      recommender: String(row[7]),
      bloodGroup: String(row[8]),
      joiningDate: String(row[9]),
      deposit: String(row[10]),
      status: String(row[11] || 'approved'),
      last_updated: new Date().toISOString(),
      source: 'sheet'
    };

    const currentHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(memberData)));
    const storedHash = String(row[SYNC_CONFIG_MEMBERS.HASH_COL - 1]);

    if (currentHash === storedHash) {
      updatedHashes.push([storedHash]);
      continue;
    }

    const docPath = `projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents/members/${docId}`;
    writeBatch.push({
      update: {
        name: docPath,
        fields: encodeFirestoreFields(memberData)
      }
    });

    updatedHashes.push([currentHash]);

    if (writeBatch.length >= 500) {
      commitBatch(writeBatch);
      writeBatch.length = 0;
    }
  }

  if (writeBatch.length > 0) commitBatch(writeBatch);
  sheet.getRange(startRow, SYNC_CONFIG_MEMBERS.HASH_COL, numRows, 1).setValues(updatedHashes);
  props.setProperty('LAST_SYNC_ROW_MEMBERS', (startRow + numRows - 1).toString());
}

/**
 * 📥 FIRESTORE → SHEET (Reverse Member Sync)
 */
function syncMembersFromFirestore() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SYNC_CONFIG_MEMBERS.SHEET_NAME);
  if (!sheet) return;

  const props = PropertiesService.getScriptProperties();
  const lastFsSyncTime = props.getProperty('LAST_FS_MEMBER_SYNC_TIME') || "2000-01-01T00:00:00Z";
  
  const token = ScriptApp.getOAuthToken();
  // Filter for members updated since last sync AND not updated by the sheet to avoid loops
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents:runQuery`;
  
  const query = {
    structuredQuery: {
      from: [{ collectionId: "members" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "last_updated" },
                op: "GREATER_THAN",
                value: { stringValue: lastFsSyncTime }
              }
            },
            {
              fieldFilter: {
                field: { fieldPath: "source" },
                op: "NOT_EQUAL",
                value: { stringValue: "sheet" }
              }
            }
          ]
        }
      }
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(query),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    console.error("Firestore Query Error:", response.getContentText());
    return;
  }

  const results = JSON.parse(response.getContentText());
  if (!results || results.length === 0 || !results[0].document) {
    console.log("No new updates from Firestore.");
    return;
  }

  const sheetData = sheet.getDataRange().getValues();
  const emailCol = 6; // Column G (0-indexed)
  const phoneCol = 5; // Column F (0-indexed)

  results.forEach(res => {
    if (!res.document) return;
    const fields = res.document.fields;
    const member = decodeFirestoreFields(fields);
    
    // Find matching row in sheet
    let rowIndex = -1;
    for (let i = 1; i < sheetData.length; i++) {
      if ((member.email && String(sheetData[i][emailCol]) === member.email) || 
          (member.phone && String(sheetData[i][phoneCol]) === member.phone)) {
        rowIndex = i + 1;
        break;
      }
    }

    const rowData = [
      "", // SI (Column A)
      member.memberId || "",
      member.name || "",
      member.address || "",
      member.age || "",
      member.phone || "",
      member.email || "",
      member.recommender || "",
      member.bloodGroup || "",
      member.joiningDate || "",
      member.deposit || "",
      member.status || "pending"
    ];

    if (rowIndex > 0) {
      // Update existing
      sheet.getRange(rowIndex, 1, 1, 12).setValues([rowData]);
      console.log(`Updated member: ${member.name}`);
    } else {
      // Append new
      sheet.appendRow(rowData);
      console.log(`Added new member: ${member.name}`);
    }
  });

  props.setProperty('LAST_FS_MEMBER_SYNC_TIME', new Date().toISOString());
}

/**
 * 🔄 DECODE FROM FIRESTORE
 */
function decodeFirestoreFields(fields) {
  const data = {};
  for (const key in fields) {
    if (fields[key].stringValue !== undefined) data[key] = fields[key].stringValue;
    else if (fields[key].booleanValue !== undefined) data[key] = fields[key].booleanValue;
    else if (fields[key].integerValue !== undefined) data[key] = fields[key].integerValue;
  }
  return data;
}

/**
 * 📊 UPDATE SYNC STATS IN FIRESTORE
 */
function updateSyncStats(syncedRow, totalRows) {
  const token = ScriptApp.getOAuthToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents/metadata/sync_stats`;
  
  const stats = {
    total_books: totalRows - (SYNC_CONFIG.START_ROW - 1),
    synced_books: syncedRow - (SYNC_CONFIG.START_ROW - 1),
    last_run: new Date().toISOString()
  };

  const options = {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({
      fields: encodeFirestoreFields(stats)
    }),
    muteHttpExceptions: true
  };

  // Use updateMask to ensure we create/update specifically these fields
  const mask = "?updateMask.fieldPaths=total_books&updateMask.fieldPaths=synced_books&updateMask.fieldPaths=last_run";
  UrlFetchApp.fetch(url + mask, options);
}

/**
 * 📦 COMMIT BATCH TO FIRESTORE
 */
function commitBatch(writes) {
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
    throw new Error("Batch commit failed.");
  }
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
 * 📋 MENU BUTTONS
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Firebase Sync')
      .addItem('Run Book Sync (Books → Firebase)', 'runIncrementalSync')
      .addItem('Run Member Sync (Bi-directional)', 'runMemberSync')
      .addSeparator()
      .addItem('Reset All Sync Progress', 'resetAllSyncPointers')
      .addToUi();
}

/**
 * 🧹 RESET POINTERS
 */
function resetAllSyncPointers() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('LAST_SYNC_ROW');
  props.deleteProperty('LAST_SYNC_ROW_MEMBERS');
  props.deleteProperty('LAST_FS_MEMBER_SYNC_TIME');
  SpreadsheetApp.getUi().alert("All sync pointers have been reset.");
}

/**
 * ⏱️ AUTO UPDATE TIMESTAMP WHEN EDITING
 */
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const range = e.range;
  const row = range.getRow();
  if (row <= 1) return;

  const sheetName = sheet.getName();
  let timestampCol = 0;

  if (sheetName === 'Book') {
    timestampCol = 12; // Column L
  } else if (sheetName === 'Members') {
    timestampCol = 12; // Column L
  }

  if (timestampCol > 0) {
    sheet.getRange(row, timestampCol).setValue(new Date().toISOString());
  }
}

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
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Error: Sheet '" + SYNC_CONFIG_MEMBERS.SHEET_NAME + "' not found.");
    return;
  }

  const lastRow = sheet.getLastRow();
  const props = PropertiesService.getScriptProperties();
  const startRow = SYNC_CONFIG_MEMBERS.START_ROW; // Force start from Row 2 to recreate collection

  if (lastRow < startRow) {
    SpreadsheetApp.getUi().alert("No members found in the sheet (starting at Row 2).");
    return;
  }

  // Ensure the sheet has enough columns (at least Column M for Hashes)
  if (sheet.getMaxColumns() < SYNC_CONFIG_MEMBERS.HASH_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), SYNC_CONFIG_MEMBERS.HASH_COL - sheet.getMaxColumns());
    sheet.getRange(1, SYNC_CONFIG_MEMBERS.HASH_COL).setValue("Sync Hash");
  }

  const numRows = lastRow - startRow + 1;
  const dataRange = sheet.getRange(startRow, 1, numRows, SYNC_CONFIG_MEMBERS.HASH_COL);
  const data = dataRange.getValues();
  
  const bgColorsRange = sheet.getRange(startRow, 2, numRows, 1); // Column B is 2
  const bgColors = bgColorsRange.getBackgrounds();
  
  const writeBatch = [];
  const updatedHashes = [];
  let syncCount = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    let memberId = String(row[1] || "").trim(); // Column B
    
    // Determine if it's a lifetime membership based on background color
    let bgCol = bgColors[i][0];
    let isLifetime = (bgCol !== '#ffffff' && bgCol !== '#fff2cc' && bgCol !== null && bgCol !== '');

    let email = String(row[6] || "").trim().toLowerCase(); // Column G
    let phone = String(row[5] || "").trim(); // Column F
    
    // Safety check: skip headers or empty rows if all ID fields are missing
    if (!email && !phone && !memberId) {
      updatedHashes.push([row[SYNC_CONFIG_MEMBERS.HASH_COL - 1]]);
      continue;
    }
    
    if (email === "email id") { // Skip header duplicate
      updatedHashes.push([row[SYNC_CONFIG_MEMBERS.HASH_COL - 1]]);
      continue;
    }

    if (!memberId) {
      // Skip forward sync for rows without a memberId assigned by admin
      updatedHashes.push([row[SYNC_CONFIG_MEMBERS.HASH_COL - 1]]);
      continue;
    }

    // Generate strict docId: MEM_XX
    let docId = "MEM_" + memberId;
    
    const memberData = {
      memberId: memberId,
      name: String(row[2] || ""),
      address: String(row[3] || ""),
      age: String(row[4] || ""),
      phone: phone,
      email: email,
      recommender: String(row[7] || ""),
      bloodGroup: String(row[8] || ""),
      joiningDate: String(row[9] || ""),
      deposit: String(row[10] || ""),
      vitalStatus: String(row[11] || "Active").trim(), // 🔥 Read Column L (Active/Deceased)
      status: 'approved', // 🔥 Force 'approved' for all sheet members so they show up in the app
      timestamp: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      source: 'sheet',
      isLifetime: isLifetime
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
    syncCount++;

    if (writeBatch.length >= 200) {
      commitBatch(writeBatch);
      writeBatch.length = 0;
    }
  }

  if (writeBatch.length > 0) commitBatch(writeBatch);
  
  // Update hashes in sheet
  sheet.getRange(startRow, SYNC_CONFIG_MEMBERS.HASH_COL, numRows, 1).setValues(updatedHashes);
  props.setProperty('LAST_SYNC_ROW_MEMBERS', lastRow.toString());
  
  if (syncCount > 0) {
    updateSyncStatsMember();
    SpreadsheetApp.getUi().alert(`Successfully created/updated ${syncCount} members in Firestore!`);
  } else {
    SpreadsheetApp.getUi().alert("No changes detected. All members are already in Firestore.");
  }
}

/**
 * 📊 UPDATE MEMBER SYNC STATS
 */
function updateSyncStatsMember() {
  const token = ScriptApp.getOAuthToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents/metadata/sync_stats`;
  
  const stats = {
    last_member_sync: new Date().toISOString()
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

  // Use updateMask to specifically update ONLY the last_member_sync field
  const mask = "?updateMask.fieldPaths=last_member_sync";
  UrlFetchApp.fetch(url + mask, options);
}

/**
 * 📥 FIRESTORE → SHEET (Reverse Member Sync)
 */
function syncMembersFromFirestore() {
  console.log("--- Starting Member Sync from Firestore ---");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SYNC_CONFIG_MEMBERS.SHEET_NAME);
  if (!sheet) {
    console.error("Sheet '" + SYNC_CONFIG_MEMBERS.SHEET_NAME + "' not found!");
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const lastFsSyncTime = props.getProperty('LAST_FS_MEMBER_SYNC_TIME') || "2000-01-01T00:00:00Z";
  console.log("Syncing changes after: " + lastFsSyncTime);
  
  const token = ScriptApp.getOAuthToken();
  // Filter for members updated since last sync. 
  // We handle the 'source' loop prevention in memory to avoid query complexity with missing fields.
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents:runQuery`;
  
  const query = {
    structuredQuery: {
      from: [{ collectionId: "members" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "last_updated" },
          op: "GREATER_THAN",
          value: { timestampValue: lastFsSyncTime }
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
  console.log("Documents fetched: " + (results.length || 0));
  
  if (!results || results.length === 0 || (results.length === 1 && !results[0].document)) {
    console.log("No new updates found.");
    return;
  }

  const sheetData = sheet.getDataRange().getValues();
  const emailCol = 6; // Column G (0-indexed)
  const phoneCol = 5; // Column F (0-indexed)

  results.forEach(res => {
    if (!res.document) return;
    const fields = res.document.fields;
    const member = decodeFirestoreFields(fields);
    member.id = res.document.name.split('/').pop();
    
    console.log("Processing Member: " + (member.name || "Unknown") + " | ID: " + (member.memberId || "No ID"));

    // SKIP if this document was just pushed from the sheet to prevent loops
    if (member.source === 'sheet') {
      console.log("Skipping member-from-sheet loop.");
      return;
    }

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
      member.vitalStatus || "Active", // Column L (Status)
      "", // Column M (Reserved for Hash, will be auto-calculated)
      member.last_updated || new Date().toISOString() // Column N (Last Update)
    ];

    if (rowIndex > 0) {
      // Update existing
      console.log("Updating row " + rowIndex);
      sheet.getRange(rowIndex, 1, 1, 14).setValues([rowData]);
    } else {
      // Find max SI and increment
      let maxSI = 0;
      for (let i = 1; i < sheetData.length; i++) {
        const val = parseInt(sheetData[i][0]);
        if (!isNaN(val) && val > maxSI) maxSI = val;
      }
      const nextSI = maxSI + 1;
      rowData[0] = nextSI;
      
      console.log("Appending new member with SI: " + nextSI);
      sheet.appendRow(rowData);
      // Refresh sheetData if we append multiple rows in one run
      sheetData.push(rowData);
    }
  });

  props.setProperty('LAST_FS_MEMBER_SYNC_TIME', new Date().toISOString());
  console.log("--- Sync Complete ---");
}

/**
 * 🔄 DECODE FROM FIRESTORE
 */
function decodeFirestoreFields(fields) {
  const data = {};
  for (const key in fields) {
    const val = fields[key];
    if (val.stringValue !== undefined) data[key] = val.stringValue;
    else if (val.booleanValue !== undefined) data[key] = val.booleanValue;
    else if (val.integerValue !== undefined) data[key] = val.integerValue;
    else if (val.doubleValue !== undefined) data[key] = val.doubleValue;
    else if (val.timestampValue !== undefined) data[key] = val.timestampValue;
    else if (val.nullValue !== undefined) data[key] = null;
    else if (val.mapValue !== undefined) {
      data[key] = decodeFirestoreFields(val.mapValue.fields);
    }
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
    } else if (key === 'timestamp' || key === 'last_updated') {
      // Convert to RFC3339 format for Firestore timestampValue
      let date = data[key] instanceof Date ? data[key] : new Date(data[key]);
      if (isNaN(date.getTime())) date = new Date();
      fields[key] = { timestampValue: date.toISOString() };
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
      .addItem('🔍 Test Connection to Firestore', 'testFirestoreConnection')
      .addItem('🚀 FORCE Re-sync All Books', 'runFullBookSyncForce')
      .addItem('🚀 FORCE Re-sync All Members', 'runFullMemberSyncForce')
      .addSeparator()
      .addItem('Reset Member Sync (Fix Deleted Collection)', 'resetMemberSyncProgress')
      .addItem('Reset Book Sync Progress', 'resetBookSyncOnly')
      .addToUi();
}

/**
 * 🔍 TEST CONNECTION
 */
function testFirestoreConnection() {
  const token = ScriptApp.getOAuthToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.project_id}/databases/(default)/documents/metadata/connection_test`;
  const options = {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({
      fields: { 
        status: { stringValue: "ok" },
        last_test: { timestampValue: new Date().toISOString() }
      }
    }),
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  
  if (code === 200 || code === 204) {
    SpreadsheetApp.getUi().alert("✅ Success! Script can talk to Firestore. (Code " + code + ")");
  } else {
    SpreadsheetApp.getUi().alert("❌ Connection Failed!\nCode: " + code + "\nResponse: " + body + "\n\nMake sure Project ID '" + FIREBASE_CONFIG.project_id + "' is correct.");
  }
}

/**
 * 🚀 FORCE FULL MEMBER SYNC (Ignore Hashes)
 */
function runFullMemberSyncForce() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Force Sync Members', 'Are you sure you want to force re-upload ALL members? This ignores all hashes.', ui.ButtonSet.YES_NO);
  
  if (response == ui.Button.YES) {
    // Temporarily disable hash checking by clearing memory
    resetMemberSyncProgress();
    syncMembersFromSheet();
  }
}

/**
 * 🚀 FORCE FULL BOOK SYNC (Ignore Hashes)
 */
function runFullBookSyncForce() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Force Sync Books', 'Are you sure you want to force re-upload ALL books? This ignores all hashes.', ui.ButtonSet.YES_NO);
  
  if (response == ui.Button.YES) {
    // 1. Reset progress
    PropertiesService.getScriptProperties().deleteProperty('LAST_SYNC_ROW');
    
    // 2. Clear hashes
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Book') || ss.getSheets()[0];
    const lastRow = sheet.getLastRow();
    if (lastRow >= SYNC_CONFIG.START_ROW) {
      sheet.getRange(SYNC_CONFIG.START_ROW, SYNC_CONFIG.HASH_COL, lastRow - SYNC_CONFIG.START_ROW + 1, 1).clearContent();
    }
    
    // 3. Start sync
    runIncrementalSync();
  }
}

/**
 * 🗑️ RESET MEMBER SYNC (Safe for Books)
 */
function resetMemberSyncProgress() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('LAST_SYNC_ROW_MEMBERS');
  props.deleteProperty('LAST_FS_MEMBER_SYNC_TIME');
  
  // Clear member hashes
  resetMemberSyncHashes();
  
  SpreadsheetApp.getUi().alert("Member sync has been reset. You can now run 'Run Member Sync' to recreate the collection. (Books were not affected)");
}

/**
 * 🧹 RESET BOOK SYNC ONLY
 */
function resetBookSyncOnly() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_SYNC_ROW');
  SpreadsheetApp.getUi().alert("Book sync pointer reset. (Members were not affected)");
}

/**
 * 🗑️ CLEAR MEMBER HASHES (Forces full re-sync)
 */
function resetMemberSyncHashes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SYNC_CONFIG_MEMBERS.SHEET_NAME);
  if (!sheet) return;
  
  const lastRow = sheet.getLastRow();
  if (lastRow < SYNC_CONFIG_MEMBERS.START_ROW) return;
  
  sheet.getRange(SYNC_CONFIG_MEMBERS.START_ROW, SYNC_CONFIG_MEMBERS.HASH_COL, lastRow - SYNC_CONFIG_MEMBERS.START_ROW + 1, 1).clearContent();
  console.log("Member hashes cleared.");
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
  
  // 🔥 Only auto-timestamp for Books. 
  // For Members, we let the admin portal handle status/updates to avoid overwriting Column L.
  if (sheetName === 'Book') {
    sheet.getRange(row, 12).setValue(new Date().toISOString());
  }
}

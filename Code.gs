/**
 * Daily Expenses Tracker - Google Apps Script Backend
 * Supports multi-user login, role-based access levels, Forgot Password PIN reset,
 * and dual expense mode (House Expenses & Meal Expenses).
 */

const SHEET_NAME = 'Expenses';
const USERS_SHEET_NAME = 'Users';

const EXPENSE_HEADERS = ['Serial Number', 'Date & Time', 'Descriptions', 'Amount', 'Mode', 'Member', 'Payment Method', 'CreatedBy'];
const USER_HEADERS = ['Username', 'PIN', 'Role', 'Status', 'Modes', 'CreatedAt'];

// Rabbi as Super Admin, others as User (Editor)
const DEFAULT_USERS = [
  ['Rabbi', '1234', 'Super Admin', 'Active', 'Both'],
  ['Nahid', '1234', 'Editor', 'Active', 'Both'],
  ['Maruf', '1234', 'Editor', 'Active', 'Both'],
  ['Nasir', '1234', 'Editor', 'Active', 'Both']
];

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.getSheetByName('Sheet1') || ss.getSheets()[0];
    try { sh.setName(SHEET_NAME); } catch(e) {}
  }
  const lr = sh.getLastRow();
  if (lr === 0) {
    sh.appendRow(EXPENSE_HEADERS);
    formatHeaders(sh, EXPENSE_HEADERS.length, '#111827');
  }

  // Auto-migrate headers if missing or legacy
  const lc = sh.getLastColumn();
  if (lr > 0 && lc > 0) {
    const row1 = sh.getRange(1, 1, 1, Math.max(lc, EXPENSE_HEADERS.length)).getValues()[0];
    if (!row1.includes('Mode')) {
      const amtIdx = row1.indexOf('Amount') + 1;
      if (amtIdx > 0) {
        sh.insertColumnAfter(amtIdx);
        sh.getRange(1, amtIdx + 1).setValue('Mode');
      } else {
        sh.getRange(1, sh.getLastColumn() + 1).setValue('Mode');
      }
    }
    const updatedRow1 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (!updatedRow1.includes('Member')) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue('Member');
    }
    if (updatedRow1.includes('Remarks') && !updatedRow1.includes('Payment Method')) {
      const rIdx = updatedRow1.indexOf('Remarks') + 1;
      sh.getRange(1, rIdx).setValue('Payment Method');
    } else if (!updatedRow1.includes('Payment Method') && !updatedRow1.includes('Remarks')) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue('Payment Method');
    }
    const updatedRow2 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (!updatedRow2.includes('CreatedBy')) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue('CreatedBy');
    }
  }
  return sh;
}

function getUsersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(USERS_SHEET_NAME);
    sh.appendRow(USER_HEADERS);
    formatHeaders(sh, USER_HEADERS.length, '#374151');
    const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    DEFAULT_USERS.forEach(u => {
      sh.appendRow([u[0], String(u[1]), u[2], u[3], u[4], nowStr]);
    });
  } else {
    // Check if Modes column exists in Users sheet
    const lc = sh.getLastColumn();
    if (lc > 0) {
      const headerRow = sh.getRange(1, 1, 1, lc).getValues()[0];
      if (!headerRow.includes('Modes')) {
        const statusIdx = headerRow.indexOf('Status') + 1;
        if (statusIdx > 0) {
          sh.insertColumnAfter(statusIdx);
          sh.getRange(1, statusIdx + 1).setValue('Modes');
          const lr = sh.getLastRow();
          if (lr > 1) {
            sh.getRange(2, statusIdx + 1, lr - 1, 1).setValue('Both');
          }
        }
      }
    }
  }
  return sh;
}

function formatHeaders(sheet, cols, bgColor) {
  const h = sheet.getRange(1, 1, 1, cols);
  h.setBackground(bgColor);
  h.setFontColor('#ffffff');
  h.setFontWeight('bold');
  h.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function readAllUsers() {
  const sh = getUsersSheet();
  const lr = sh.getLastRow();
  if (lr <= 1) return [];
  const lc = Math.max(sh.getLastColumn(), USER_HEADERS.length);
  const rows = sh.getRange(2, 1, lr - 1, lc).getValues();
  return rows.map(r => ({
    username: String(r[0] || '').trim(),
    pin: String(r[1] || '').trim(),
    role: String(r[2] || 'Editor').trim(),
    status: String(r[3] || 'Active').trim(),
    modes: String(r[4] || 'Both').trim(),
    createdAt: String(r[5] || '')
  }));
}

function doGet(e) {
  try {
    const a = (e && e.parameter && e.parameter.action) || 'read';

    if (a === 'ping') {
      const sh = getSheet();
      const users = readAllUsers();
      return json({
        status: 'success',
        sheetName: sh.getName(),
        totalRows: Math.max(0, sh.getLastRow() - 1),
        userCount: users.length
      });
    }

    if (a === 'read') {
      const sh = getSheet();
      const lr = sh.getLastRow();
      const lc = Math.max(sh.getLastColumn(), EXPENSE_HEADERS.length);
      const users = readAllUsers().map(u => ({ username: u.username, role: u.role, status: u.status, modes: u.modes }));

      if (lr <= 1) {
        return json({ status: 'success', data: [], users: users, nextSerial: 1 });
      }

      // Read header row to map column indexes dynamically
      const headers = sh.getRange(1, 1, 1, lc).getValues()[0].map(h => String(h).trim());
      const serialIdx = headers.indexOf('Serial Number');
      const dateIdx = headers.indexOf('Date & Time');
      const descIdx = headers.indexOf('Descriptions');
      const amtIdx = headers.indexOf('Amount');
      const modeIdx = headers.indexOf('Mode');
      const memberIdx = headers.indexOf('Member');
      const payMethodIdx = headers.indexOf('Payment Method') >= 0 ? headers.indexOf('Payment Method') : headers.indexOf('Remarks');
      const createdByIdx = headers.indexOf('CreatedBy');

      const rows = sh.getRange(2, 1, lr - 1, lc).getValues();
      let mx = 0;
      const data = rows.map((r, i) => {
        const s = parseInt(serialIdx >= 0 ? r[serialIdx] : r[0]) || (i + 1);
        if (s > mx) mx = s;
        let dt = dateIdx >= 0 ? r[dateIdx] : r[1];
        if (dt instanceof Date) dt = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
        else dt = String(dt || '');
        const rawMode = String(modeIdx >= 0 ? r[modeIdx] : 'Meal Expenses').trim();
        const normalizedMode = (rawMode === 'Daily Meal' || rawMode === 'Meal' || !rawMode) ? 'Meal Expenses' : (rawMode === 'House rent' ? 'House Expenses' : rawMode);
        const payVal = String(payMethodIdx >= 0 ? r[payMethodIdx] : r[5] || 'Cash').trim() || 'Cash';
        return {
          serialNumber: s,
          dateTime: dt,
          descriptions: String(descIdx >= 0 ? r[descIdx] : r[2] || ''),
          amount: parseFloat(amtIdx >= 0 ? r[amtIdx] : r[3]) || 0,
          mode: normalizedMode,
          member: String(memberIdx >= 0 ? r[memberIdx] : r[4] || ''),
          paymentMethod: payVal,
          remarks: payVal,
          createdBy: String(createdByIdx >= 0 ? r[createdByIdx] : r[6] || '')
        };
      });

      // Load inventory & payment methods from project properties
      const props = PropertiesService.getScriptProperties();
      let inv = [];
      let pms = [];
      try { inv = JSON.parse(props.getProperty('INVENTORY') || '[]'); } catch(e){}
      try { pms = JSON.parse(props.getProperty('PAYMENT_METHODS') || '[]'); } catch(e){}

      return json({ status: 'success', data: data, users: users, inventory: inv, paymentMethods: pms, nextSerial: mx + 1 });
    }

    return doAction(a, e.parameter || {});
  } catch (err) {
    return json({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  try {
    let p = {};
    if (e && e.postData && e.postData.contents) {
      try { p = JSON.parse(e.postData.contents); } catch (x) { p = e.parameter || {}; }
    } else if (e && e.parameter) {
      p = e.parameter;
    }
    return doAction(p.action || 'create', p);
  } catch (err) {
    return json({ status: 'error', message: err.toString() });
  }
}

function doAction(action, p) {
  const sh = getSheet();
  const uSh = getUsersSheet();
  const lr = sh.getLastRow();

  // ── AUTH: LOGIN ──────────────────────────────────────────
  if (action === 'login') {
    const username = String(p.username || '').trim();
    const pin = String(p.pin || '').trim();
    const users = readAllUsers();
    const found = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!found) {
      return json({ status: 'error', message: 'User not found' });
    }
    if (found.status === 'Disabled') {
      return json({ status: 'error', message: 'Account is deactivated. Contact Super Admin.' });
    }
    if (found.pin !== pin) {
      return json({ status: 'error', message: 'Incorrect PIN' });
    }

    return json({
      status: 'success',
      user: { username: found.username, role: found.role, status: found.status, modes: found.modes }
    });
  }

  // ── AUTH: CHANGE PIN ─────────────────────────────────────
  if (action === 'changePin') {
    const username = String(p.username || '').trim();
    const currentPin = String(p.currentPin || '').trim();
    const newPin = String(p.newPin || '').trim();
    const uLr = uSh.getLastRow();

    if (uLr <= 1) return json({ status: 'error', message: 'User not found' });

    const rows = uSh.getRange(2, 1, uLr - 1, 2).getValues();
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase() === username.toLowerCase()) {
        if (String(rows[i][1]).trim() !== currentPin) {
          return json({ status: 'error', message: 'Current PIN is incorrect' });
        }
        rowIndex = i + 2;
        break;
      }
    }
    if (rowIndex === -1) return json({ status: 'error', message: 'User not found' });

    uSh.getRange(rowIndex, 2).setValue(String(newPin));
    return json({ status: 'success', message: 'PIN changed successfully' });
  }

  // ── AUTH: FORGOT PASSWORD / DIRECT PIN RESET ─────────────
  if (action === 'forgotPassword' || action === 'resetMyPin') {
    const username = String(p.username || '').trim();
    const newPin = String(p.newPin || '').trim();
    const uLr = uSh.getLastRow();

    if (!username || !newPin) {
      return json({ status: 'error', message: 'Username and new PIN are required' });
    }
    if (uLr <= 1) return json({ status: 'error', message: 'User not found' });

    const rows = uSh.getRange(2, 1, uLr - 1, 1).getValues();
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase() === username.toLowerCase()) {
        rowIndex = i + 2;
        break;
      }
    }
    if (rowIndex === -1) return json({ status: 'error', message: 'User "' + username + '" not found' });

    uSh.getRange(rowIndex, 2).setValue(String(newPin));
    return json({ status: 'success', message: 'Password/PIN reset successfully for ' + username });
  }

  // ── USER MANAGEMENT: GET USERS ───────────────────────────
  if (action === 'getUsers') {
    const users = readAllUsers().map(u => ({ username: u.username, role: u.role, status: u.status, modes: u.modes }));
    return json({ status: 'success', users });
  }

  // ── USER MANAGEMENT: SAVE / ADD USER ─────────────────────
  if (action === 'saveUser') {
    const username = String(p.username || '').trim();
    const pin = String(p.pin || '1234').trim();
    const role = String(p.role || 'Editor').trim();
    const status = String(p.status || 'Active').trim();
    const modes = String(p.modes || 'Both').trim();
    const uLr = uSh.getLastRow();

    if (!username) return json({ status: 'error', message: 'Username is required' });

    if (uLr > 1) {
      const rows = uSh.getRange(2, 1, uLr - 1, 1).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).toLowerCase() === username.toLowerCase()) {
          const r = i + 2;
          if (p.pin) uSh.getRange(r, 2).setValue(String(pin));
          if (p.role) uSh.getRange(r, 3).setValue(role);
          if (p.status) uSh.getRange(r, 4).setValue(status);
          if (p.modes) uSh.getRange(r, 5).setValue(modes);
          return json({ status: 'success', message: 'User updated' });
        }
      }
    }

    const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    uSh.appendRow([username, String(pin), role, status, modes, nowStr]);
    return json({ status: 'success', message: 'User created' });
  }

  // ── USER MANAGEMENT: UPDATE ROLE & MODES ─────────────────
  if (action === 'updateRole') {
    const username = String(p.username || '').trim();
    const role = p.role ? String(p.role).trim() : null;
    const modes = p.modes ? String(p.modes).trim() : null;
    const uLr = uSh.getLastRow();
    if (uLr <= 1) return json({ status: 'error', message: 'User not found' });

    const rows = uSh.getRange(2, 1, uLr - 1, 1).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase() === username.toLowerCase()) {
        const r = i + 2;
        if (role) uSh.getRange(r, 3).setValue(role);
        if (modes) uSh.getRange(r, 5).setValue(modes);
        return json({ status: 'success', message: 'User updated' });
      }
    }
    return json({ status: 'error', message: 'User not found' });
  }

  // ── USER MANAGEMENT: RESET PIN ───────────────────────────
  if (action === 'resetPin') {
    const username = String(p.username || '').trim();
    const newPin = String(p.newPin || '1234').trim();
    const uLr = uSh.getLastRow();
    if (uLr <= 1) return json({ status: 'error', message: 'User not found' });

    const rows = uSh.getRange(2, 1, uLr - 1, 1).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase() === username.toLowerCase()) {
        uSh.getRange(i + 2, 2).setValue(String(newPin));
        return json({ status: 'success', message: 'PIN reset to ' + newPin });
      }
    }
    return json({ status: 'error', message: 'User not found' });
  }

  // ── USER MANAGEMENT: DELETE USER ─────────────────────────
  if (action === 'deleteUser') {
    const username = String(p.username || '').trim();
    const uLr = uSh.getLastRow();
    if (uLr <= 1) return json({ status: 'error', message: 'User not found' });

    const rows = uSh.getRange(2, 1, uLr - 1, 1).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase() === username.toLowerCase()) {
        uSh.deleteRow(i + 2);
        return json({ status: 'success', message: 'User deleted' });
      }
    }
    return json({ status: 'error', message: 'User not found' });
  }

  // ── INVENTORY MANAGEMENT ─────────────────────────────────
  if (action === 'saveInventory') {
    const items = p.items || [];
    PropertiesService.getScriptProperties().setProperty('INVENTORY', JSON.stringify(items));
    return json({ status: 'success', message: 'Inventory saved' });
  }

  // ── PAYMENT METHODS MANAGEMENT ───────────────────────────
  if (action === 'savePaymentMethods') {
    const methods = p.methods || [];
    PropertiesService.getScriptProperties().setProperty('PAYMENT_METHODS', JSON.stringify(methods));
    return json({ status: 'success', message: 'Payment methods saved' });
  }

  // ── EXPENSES: CREATE ─────────────────────────────────────
  if (action === 'create') {
    let s = parseInt(p.serialNumber);
    if (!s || isNaN(s)) {
      s = lr <= 1 ? 1 : Math.max(...sh.getRange(2, 1, lr - 1, 1).getValues().map(r => parseInt(r[0]) || 0)) + 1;
    }
    const dt = p.dateTime || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    const desc = p.descriptions || '';
    const amt = parseFloat(p.amount) || 0;
    const rawMode = p.mode || 'Meal Expenses';
    const mode = (rawMode === 'Daily Meal' || rawMode === 'Meal') ? 'Meal Expenses' : (rawMode === 'House rent' ? 'House Expenses' : rawMode);
    const member = p.member || '';
    const payMethod = p.paymentMethod || p.remarks || 'Cash';
    const createdBy = p.createdBy || p.member || '';

    sh.appendRow([s, dt, desc, amt, mode, member, payMethod, createdBy]);
    const nr = sh.getLastRow();
    sh.getRange(nr, 1).setHorizontalAlignment('center');
    sh.getRange(nr, 4).setNumberFormat('#,##0.00');
    return json({ status: 'success', message: 'Added' });
  }

  // ── EXPENSES: UPDATE ─────────────────────────────────────
  if (action === 'update') {
    const t = parseInt(p.serialNumber);
    if (isNaN(t) || lr <= 1) return json({ status: 'error', message: 'Not found' });
    const srs = sh.getRange(2, 1, lr - 1, 1).getValues();
    let ri = -1;
    for (let i = 0; i < srs.length; i++) {
      if (parseInt(srs[i][0]) === t) { ri = i + 2; break; }
    }
    if (ri === -1) return json({ status: 'error', message: 'Not found' });

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const dateCol = headers.indexOf('Date & Time') + 1;
    const descCol = headers.indexOf('Descriptions') + 1;
    const amtCol = headers.indexOf('Amount') + 1;
    const modeCol = headers.indexOf('Mode') + 1;
    const memberCol = headers.indexOf('Member') + 1;
    const payCol = headers.indexOf('Payment Method') >= 0 ? (headers.indexOf('Payment Method') + 1) : (headers.indexOf('Remarks') + 1);

    if (p.dateTime !== undefined && dateCol > 0) sh.getRange(ri, dateCol).setValue(p.dateTime);
    if (p.descriptions !== undefined && descCol > 0) sh.getRange(ri, descCol).setValue(p.descriptions);
    if (!isNaN(parseFloat(p.amount)) && amtCol > 0) sh.getRange(ri, amtCol).setValue(parseFloat(p.amount));
    if (p.mode !== undefined && modeCol > 0) {
      const rawMode = p.mode;
      const normalizedMode = (rawMode === 'Daily Meal' || rawMode === 'Meal') ? 'Meal Expenses' : (rawMode === 'House rent' ? 'House Expenses' : rawMode);
      sh.getRange(ri, modeCol).setValue(normalizedMode);
    }
    if (p.member !== undefined && memberCol > 0) sh.getRange(ri, memberCol).setValue(p.member);
    if ((p.paymentMethod !== undefined || p.remarks !== undefined) && payCol > 0) {
      sh.getRange(ri, payCol).setValue(p.paymentMethod || p.remarks || 'Cash');
    }

    return json({ status: 'success', message: 'Updated' });
  }

  // ── EXPENSES: DELETE ─────────────────────────────────────
  if (action === 'delete') {
    const t = parseInt(p.serialNumber);
    if (isNaN(t) || lr <= 1) return json({ status: 'error', message: 'Not found' });
    const srs = sh.getRange(2, 1, lr - 1, 1).getValues();
    let ri = -1;
    for (let i = 0; i < srs.length; i++) {
      if (parseInt(srs[i][0]) === t) { ri = i + 2; break; }
    }
    if (ri === -1) return json({ status: 'error', message: 'Not found' });
    sh.deleteRow(ri);
    return json({ status: 'success', message: 'Deleted' });
  }

  return json({ status: 'error', message: 'Unknown action' });
}

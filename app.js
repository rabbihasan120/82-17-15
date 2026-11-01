/* Daily Expenses Tracker — app.js
   Flat, mobile-first, user login & access levels, Google Sheets database integration.
   Rabbi Super Admin, House Expenses & Meal Expenses modes, Purchase Items Inventory,
   Payment Methods, Day/Week/Month/All/Custom Calendar filter, Fixed Cloud Endpoint. */

// ── Fixed Cloud Google Apps Script Endpoint ────────────────
const FIXED_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwD_JOUjxHMRyF1lviWhiZuL2Kq1DIrhkGYtsBU0y98X9HGZaDQWxtStkgH8nQPa64s_g/exec';
const FIXED_SHEET_URL = '';

// ── Constants & Defaults ───────────────────────────────────
const DEFAULT_USERS = [
  { username: 'Rabbi', pin: '1234', role: 'Super Admin', status: 'Active', modes: 'Both' },
  { username: 'Nahid', pin: '1234', role: 'Editor', status: 'Active', modes: 'Both' },
  { username: 'Maruf', pin: '1234', role: 'Editor', status: 'Active', modes: 'Both' },
  { username: 'Nasir', pin: '1234', role: 'Editor', status: 'Active', modes: 'Both' }
];

const CURRENCIES = [
  { symbol: '$',  label: 'USD ($)' },
  { symbol: '€',  label: 'EUR (€)' },
  { symbol: '£',  label: 'GBP (£)' },
  { symbol: '₹',  label: 'INR (₹)' },
  { symbol: '¥',  label: 'JPY (¥)' },
  { symbol: '₱',  label: 'PHP (₱)' },
  { symbol: '৳',  label: 'BDT (৳)' },
  { symbol: 'RM', label: 'MYR (RM)' },
];

const STORE = {
  DATA:            'exp_data_v2',
  USERS:           'exp_users_v2',
  SESSION_USER:    'exp_session_user_v2',
  MEMBERS:         'exp_members_v2',
  SCRIPT:          'exp_script_url_v2',
  SHEET:           'exp_sheet_url_v2',
  CURRENCY:        'exp_currency_v2',
  THEME:           'exp_theme_v2',
  INSTALL:         'exp_install_dismissed_v2',
  INVENTORY:       'exp_inventory_v2',
  PAYMENT_METHODS: 'exp_payment_methods_v2',
};

const DEFAULT_INVENTORY = [
  'Rice', 'Oil', 'Chicken', 'Beef', 'Fish', 'Eggs', 'Vegetables', 
  'Onion', 'Potato', 'Spices', 'Salt', 'Milk', 'Bread', 'Tea', 
  'Water', 'Gas Cylinder', 'Electricity Bill', 'Internet Bill', 
  'House Rent', 'Cleaning Supplies', 'Snacks', 'Fruits'
];

const DEFAULT_PAYMENT_METHODS = ['Cash', 'DuitNow', 'Touch \'n Go', 'Maybank QR', 'FPX', 'Debit Card', 'Credit Card', 'Bank Transfer'];

// Mode helpers
const isMealExpense = (m) => m === 'Meal Expenses' || m === 'Daily Meal' || m === 'Meal' || !m;
const isHouseExpense = (m) => m === 'House Expenses' || m === 'House rent' || m === 'House Rent';

// ── State ──────────────────────────────────────────────────
let currentUser = null;
let users = [];
let expenses = [];
let members = [];
let inventory = [];
let paymentMethods = [];
let selectedItems = [];
let customStartDate = '';
let customEndDate = '';
let currency = '৳';
let scriptUrl = FIXED_SCRIPT_URL;
let sheetUrl = FIXED_SHEET_URL;
let timeRange = 'day'; // 'day', 'week', 'month', 'all', 'custom'
let selectedMode = 'all'; // 'all', 'Meal Expenses', 'House Expenses'
let editingSerial = null;
let deferredInstallPrompt = null;

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadCurrency();
  loadSheetConfig();
  loadUsers();
  loadMembers();
  loadInventory();
  loadPaymentMethods();
  loadExpenses();
  checkAuthSession();
  setupPWA();

  if (isScriptConfigured()) {
    syncFromSheet();
  }
});

function isScriptConfigured() {
  return scriptUrl && !scriptUrl.includes('CHANGE_TO_YOUR_DEPLOYED_URL');
}

// ── User Authentication & Session ──────────────────────────
function loadUsers() {
  const raw = localStorage.getItem(STORE.USERS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        users = parsed;
        const rabbi = users.find(u => u.username.toLowerCase() === 'rabbi');
        if (rabbi) {
          rabbi.role = 'Super Admin';
        } else {
          users.unshift({ username: 'Rabbi', pin: '1234', role: 'Super Admin', status: 'Active', modes: 'Both' });
        }
        users.forEach(u => {
          if (!u.modes) u.modes = 'Both';
        });
        saveUsers();
        return;
      }
    } catch (e) {}
  }
  users = JSON.parse(JSON.stringify(DEFAULT_USERS));
  saveUsers();
}

function saveUsers() {
  localStorage.setItem(STORE.USERS, JSON.stringify(users));
}

function checkAuthSession() {
  const saved = localStorage.getItem(STORE.SESSION_USER);
  if (saved) {
    try {
      const session = JSON.parse(saved);
      const matched = users.find(u => u.username.toLowerCase() === session.username.toLowerCase() && u.status !== 'Disabled');
      if (matched && matched.pin === session.pin) {
        currentUser = matched;
        onLoginSuccess(matched, false);
        return;
      }
    } catch (e) {}
  }
  showLoginScreen();
}

function showLoginScreen() {
  currentUser = null;
  document.getElementById('loginView').style.display = 'flex';
  renderLoginUserSelect();
}

function renderLoginUserSelect() {
  const select = document.getElementById('loginUserSelect');
  if (!select) return;
  select.innerHTML = users
    .filter(u => u.status !== 'Disabled')
    .map(u => {
      const modeTag = u.modes === 'Both' ? 'House + Meal' : (isHouseExpense(u.modes) ? 'House Expenses' : (isMealExpense(u.modes) ? 'Meal Expenses' : u.modes));
      return `<option value="${esc(u.username)}">${esc(u.username)} (${esc(u.role)} · ${esc(modeTag)})</option>`;
    })
    .join('');
}

function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUserSelect').value;
  const pin = document.getElementById('loginPin').value.trim();

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    toast('User not found');
    return;
  }
  if (user.status === 'Disabled') {
    toast('This account is disabled. Contact Rabbi (Super Admin).');
    return;
  }
  if (user.pin !== pin) {
    toast('Incorrect PIN. Try again or tap Forgot PIN.');
    return;
  }

  const remember = document.getElementById('loginRemember').checked;
  if (remember) {
    localStorage.setItem(STORE.SESSION_USER, JSON.stringify({ username: user.username, pin: user.pin }));
  } else {
    localStorage.removeItem(STORE.SESSION_USER);
  }

  onLoginSuccess(user, true);
}

function onLoginSuccess(user, showToast = true) {
  currentUser = user;
  document.getElementById('loginPin').value = '';
  document.getElementById('loginView').style.display = 'none';

  updateHeaderUserBadge();
  applyRolePermissions();
  renderAll();

  if (showToast) {
    toast(`Welcome, ${user.username} (${user.role})`);
  }
}

function handleLogout() {
  localStorage.removeItem(STORE.SESSION_USER);
  currentUser = null;
  closeModal('userPanelModal');
  showLoginScreen();
  toast('Signed out');
}

function updateHeaderUserBadge() {
  if (!currentUser) return;
  document.getElementById('headerUserName').textContent = currentUser.username;
  document.getElementById('headerUserRole').textContent = currentUser.role;
  document.getElementById('headerUserAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
}

// ── Forgot PIN / Self Reset ────────────────────────────────
function openForgotPinModal() {
  const select = document.getElementById('forgotPinUserSelect');
  if (select) {
    select.innerHTML = users
      .filter(u => u.status !== 'Disabled')
      .map(u => `<option value="${esc(u.username)}">${esc(u.username)}</option>`)
      .join('');
  }
  document.getElementById('forgotNewPin').value = '';
  document.getElementById('forgotConfirmPin').value = '';
  openModal('forgotPinModal');
}

async function handleForgotPinSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('forgotPinUserSelect').value;
  const newPin = document.getElementById('forgotNewPin').value.trim();
  const confirmPin = document.getElementById('forgotConfirmPin').value.trim();

  if (!newPin || newPin.length < 3) {
    toast('PIN must be at least 3 digits');
    return;
  }
  if (newPin !== confirmPin) {
    toast('PIN confirmation does not match');
    return;
  }

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    toast('User not found');
    return;
  }

  user.pin = newPin;
  saveUsers();

  closeModal('forgotPinModal');
  toast(`PIN reset successfully for ${user.username}. You can now sign in.`);

  const loginSelect = document.getElementById('loginUserSelect');
  if (loginSelect) loginSelect.value = user.username;
  const loginPinInput = document.getElementById('loginPin');
  if (loginPinInput) {
    loginPinInput.value = newPin;
    loginPinInput.focus();
  }

  if (isScriptConfigured()) {
    sendAction('forgotPassword', { username: user.username, newPin });
  }
}

// ── User Account Panel ─────────────────────────────────────
function openUserPanel() {
  if (!currentUser) return;

  document.getElementById('userPanelName').textContent = currentUser.username;
  document.getElementById('userPanelAvatar').textContent = currentUser.username.charAt(0).toUpperCase();

  const roleBadge = document.getElementById('userPanelRoleBadge');
  roleBadge.textContent = currentUser.role;
  roleBadge.className = 'badge ' + getRoleBadgeClass(currentUser.role);

  const modeBadge = document.getElementById('userPanelModeBadge');
  modeBadge.textContent = currentUser.modes === 'Both' ? 'House + Meal' : (isHouseExpense(currentUser.modes) ? 'House Expenses' : (isMealExpense(currentUser.modes) ? 'Meal Expenses' : (currentUser.modes || 'Both')));

  // Calculate personal financials based on user's active modes
  const myExpenses = expenses.filter(e => {
    const isMine = (e.member || '').toLowerCase() === currentUser.username.toLowerCase();
    return isMine;
  });
  const myTotalPaid = myExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  // Compute fair share according to mode access
  let myFairShare = 0;
  const mealExpensesList = expenses.filter(e => isMealExpense(e.mode));
  const mealMembers = getActiveMembersForMode('Meal Expenses');
  if (mealMembers.includes(currentUser.username) && mealMembers.length > 0) {
    const totalMeal = mealExpensesList.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    myFairShare += (totalMeal / mealMembers.length);
  }

  const houseExpensesList = expenses.filter(e => isHouseExpense(e.mode));
  const houseMembers = getActiveMembersForMode('House Expenses');
  if (houseMembers.includes(currentUser.username) && houseMembers.length > 0) {
    const totalHouse = houseExpensesList.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    myFairShare += (totalHouse / houseMembers.length);
  }

  const netDue = myFairShare - myTotalPaid;

  document.getElementById('userPanelTotalPaid').textContent = fmt(myTotalPaid);

  const balEl = document.getElementById('userPanelBalance');
  if (Math.abs(netDue) < 0.005) {
    balEl.textContent = 'Settled (' + fmt(0) + ')';
    balEl.style.color = 'var(--success)';
  } else if (netDue > 0) {
    balEl.textContent = 'Due: ' + fmt(netDue);
    balEl.style.color = 'var(--danger)';
  } else {
    balEl.textContent = 'Overpaid: ' + fmt(-netDue);
    balEl.style.color = 'var(--success)';
  }

  document.getElementById('inputCurrentPin').value = '';
  document.getElementById('inputNewPin').value = '';
  openModal('userPanelModal');
}

function handleChangePin(e) {
  e.preventDefault();
  if (!currentUser) return;

  const currentPin = document.getElementById('inputCurrentPin').value.trim();
  const newPin = document.getElementById('inputNewPin').value.trim();

  if (currentUser.pin !== currentPin) {
    toast('Current PIN is incorrect');
    return;
  }
  if (!newPin || newPin.length < 3) {
    toast('New PIN must be at least 3 digits');
    return;
  }

  currentUser.pin = newPin;
  const idx = users.findIndex(u => u.username.toLowerCase() === currentUser.username.toLowerCase());
  if (idx !== -1) {
    users[idx].pin = newPin;
    saveUsers();
  }

  document.getElementById('inputCurrentPin').value = '';
  document.getElementById('inputNewPin').value = '';
  closeModal('userPanelModal');
  toast('PIN updated successfully');

  if (isScriptConfigured()) {
    sendAction('changePin', { username: currentUser.username, currentPin, newPin });
  }
}

// ── Role Permissions ───────────────────────────────────────
function applyRolePermissions() {
  if (!currentUser) return;

  const fab = document.getElementById('fabAdd');
  if (currentUser.role === 'Viewer') {
    if (fab) fab.style.display = 'none';
  } else if (currentUser.role === 'Editor') {
    if (fab) fab.style.display = 'flex';
  } else if (currentUser.role === 'Super Admin') {
    if (fab) fab.style.display = 'flex';
  }
}

function getRoleBadgeClass(role) {
  if (role === 'Super Admin') return 'badge-admin';
  if (role === 'Editor') return 'badge-editor';
  return 'badge-viewer';
}

// ── Expense Mode Filtering ─────────────────────────────────
function setExpenseMode(mode) {
  selectedMode = mode;
  document.querySelectorAll('#modeTabs .time-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  renderAll();
}

function getActiveMembersForMode(mode) {
  if (mode === 'all') return members;
  const isTargetHouse = isHouseExpense(mode);
  const isTargetMeal = isMealExpense(mode);
  return members.filter(m => {
    const u = users.find(usr => usr.username.toLowerCase() === m.toLowerCase());
    if (!u) return true;
    const userModes = u.modes || 'Both';
    if (userModes === 'Both') return true;
    if (isTargetHouse) {
      return isHouseExpense(userModes);
    }
    if (isTargetMeal) {
      return isMealExpense(userModes);
    }
    return userModes === mode;
  });
}

// ── Super Admin Panel: User Access Levels & Modes ───────────
function openAdminUsersModal() {
  if (!currentUser || currentUser.role !== 'Super Admin') {
    toast('Access restricted to Super Admin');
    return;
  }
  closeModal('settingsModal');
  renderAdminUsersList();
  openModal('adminUsersModal');
}

function renderAdminUsersList() {
  const container = document.getElementById('adminUsersList');
  if (!container) return;

  document.getElementById('adminUserCountLabel').textContent = `${users.length} users`;

  container.innerHTML = users.map(u => {
    const isSelf = currentUser && currentUser.username.toLowerCase() === u.username.toLowerCase();
    const initial = u.username.charAt(0).toUpperCase();

    return `
      <div style="padding:12px 14px;border-bottom:1px solid var(--border-light)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="member-avatar">${esc(initial)}</div>
            <div>
              <div style="font-size:14px;font-weight:700">${esc(u.username)} ${isSelf ? '<span style="font-size:11px;color:var(--text-tertiary)">(You)</span>' : ''}</div>
              <div style="font-size:11px;color:var(--text-tertiary)">Status: ${esc(u.status || 'Active')} · PIN: ${esc(u.pin)}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <button class="icon-btn" onclick="adminResetPin('${esc(u.username)}')" title="Reset PIN" style="width:30px;height:30px;color:var(--text-secondary)">
              <i class="fa-solid fa-key" style="font-size:12px"></i>
            </button>
            ${!isSelf ? `
              <button class="icon-btn" onclick="adminDeleteUser('${esc(u.username)}')" title="Delete User" style="width:30px;height:30px;color:var(--danger)">
                <i class="fa-solid fa-trash-can" style="font-size:12px"></i>
              </button>
            ` : '<div style="width:30px"></div>'}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px">
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text-tertiary);margin-bottom:2px">ROLE</label>
            <select class="form-select" style="padding:4px 8px;font-size:12px" onchange="adminChangeRole('${esc(u.username)}', this.value)">
              <option value="Editor" ${u.role === 'Editor' ? 'selected' : ''}>User (Editor)</option>
              <option value="Viewer" ${u.role === 'Viewer' ? 'selected' : ''}>User (Viewer)</option>
              <option value="Super Admin" ${u.role === 'Super Admin' ? 'selected' : ''}>Super Admin</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:10px;font-weight:600;color:var(--text-tertiary);margin-bottom:2px">EXPENSE MODE</label>
            <select class="form-select" style="padding:4px 8px;font-size:12px" onchange="adminChangeMode('${esc(u.username)}', this.value)">
              <option value="Both" ${(u.modes || 'Both') === 'Both' ? 'selected' : ''}>Both (House + Meal)</option>
              <option value="Meal Expenses" ${isMealExpense(u.modes) && u.modes !== 'Both' ? 'selected' : ''}>Meal Expenses Only</option>
              <option value="House Expenses" ${isHouseExpense(u.modes) && u.modes !== 'Both' ? 'selected' : ''}>House Expenses Only</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function adminAddUser() {
  const usernameInput = document.getElementById('adminNewUsername');
  const roleSelect = document.getElementById('adminNewUserRole');
  const modeSelect = document.getElementById('adminNewUserMode');
  const pinInput = document.getElementById('adminNewUserPin');

  const username = (usernameInput.value || '').trim();
  const role = roleSelect.value;
  const modes = modeSelect.value;
  const pin = (pinInput.value || '1234').trim();

  if (!username) {
    toast('Username is required');
    return;
  }

  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    toast(`User "${username}" already exists`);
    return;
  }

  const newUser = { username, pin, role, status: 'Active', modes };
  users.push(newUser);
  saveUsers();

  if (!members.some(m => m.toLowerCase() === username.toLowerCase())) {
    members.push(username);
    saveMembers();
    populateFormMembers();
  }

  usernameInput.value = '';
  pinInput.value = '';
  renderAdminUsersList();
  renderAll();
  toast(`User "${username}" created`);

  if (isScriptConfigured()) {
    sendAction('saveUser', newUser);
  }
}

function adminChangeRole(username, newRole) {
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return;
  user.role = newRole;
  saveUsers();
  if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
    currentUser.role = newRole;
    updateHeaderUserBadge();
    applyRolePermissions();
  }
  toast(`${username} role updated to ${newRole}`);
  if (isScriptConfigured()) {
    sendAction('updateRole', { username, role: newRole, modes: user.modes });
  }
}

function adminChangeMode(username, newMode) {
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return;
  user.modes = newMode;
  saveUsers();
  if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
    currentUser.modes = newMode;
  }
  renderAll();
  toast(`${username} mode updated to ${newMode}`);
  if (isScriptConfigured()) {
    sendAction('updateRole', { username, role: user.role, modes: newMode });
  }
}

function adminResetPin(username) {
  const newPin = prompt(`Enter new PIN for ${username}:`, '1234');
  if (!newPin || !newPin.trim()) return;

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return;
  user.pin = newPin.trim();
  saveUsers();
  renderAdminUsersList();
  if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
    currentUser.pin = user.pin;
  }
  toast(`PIN reset for ${username}`);

  if (isScriptConfigured()) {
    sendAction('resetPin', { username, newPin: user.pin });
  }
}

function adminDeleteUser(username) {
  if (!confirm(`Are you sure you want to remove user "${username}"?`)) return;
  users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
  saveUsers();
  renderAdminUsersList();
  toast(`User "${username}" deleted`);

  if (isScriptConfigured()) {
    sendAction('deleteUser', { username });
  }
}

// ── Members (Legacy sync) ──────────────────────────────────
function loadMembers() {
  const raw = localStorage.getItem(STORE.MEMBERS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        members = parsed;
        return;
      }
    } catch (e) {}
  }
  members = users.map(u => u.username);
  saveMembers();
}

function saveMembers() {
  localStorage.setItem(STORE.MEMBERS, JSON.stringify(members));
  updateSettingsMemberCount();
}

function updateSettingsMemberCount() {
  const el = document.getElementById('settingsMemberCount');
  if (el) el.textContent = `${members.length} members`;
}

function openMemberManager() {
  closeModal('settingsModal');
  renderMembersManagerList();
  openModal('membersModal');
}

function renderMembersManagerList() {
  const container = document.getElementById('membersManagerList');
  if (!container) return;

  if (members.length === 0) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:13px">No members added</div>';
    return;
  }

  container.innerHTML = members.map(m => {
    const initial = m.charAt(0).toUpperCase();
    return `
      <div class="settings-item" style="cursor:default">
        <div class="settings-item-left">
          <div class="member-avatar">${esc(initial)}</div>
          <span class="settings-item-label">${esc(m)}</span>
        </div>
        <button class="icon-btn" onclick="removeMember('${esc(m)}')" title="Remove member" style="color:var(--text-tertiary);width:32px;height:32px">
          <i class="fa-solid fa-trash-can" style="font-size:13px"></i>
        </button>
      </div>
    `;
  }).join('');

  updateSettingsMemberCount();
}

function addMember() {
  const input = document.getElementById('inputNewMember');
  const name = (input.value || '').trim();
  if (!name) {
    toast('Enter a member name');
    return;
  }
  if (members.some(m => m.toLowerCase() === name.toLowerCase())) {
    toast(`Member "${name}" already exists`);
    return;
  }
  members.push(name);
  saveMembers();
  input.value = '';
  renderMembersManagerList();
  populateFormMembers();
  renderAll();
  toast(`Added ${name}`);
}

function removeMember(name) {
  if (members.length <= 1) {
    toast('At least one member is required');
    return;
  }
  const countUsed = expenses.filter(e => e.member === name).length;
  const msg = countUsed > 0 
    ? `"${name}" is associated with ${countUsed} expense(s). Remove this member?`
    : `Remove "${name}"?`;
  if (!confirm(msg)) return;

  members = members.filter(m => m !== name);
  saveMembers();
  renderMembersManagerList();
  populateFormMembers();
  renderAll();
  toast(`Removed ${name}`);
}

// ── Expenses Data ──────────────────────────────────────────
function loadExpenses() {
  const raw = localStorage.getItem(STORE.DATA);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        expenses = parsed.map(e => ({
          ...e,
          mode: isHouseExpense(e.mode) ? 'House Expenses' : 'Meal Expenses',
          paymentMethod: e.paymentMethod || e.remarks || 'Cash',
          remarks: e.paymentMethod || e.remarks || 'Cash'
        }));
        return;
      }
    } catch (e) {}
  }
  expenses = [];
}

function save() {
  localStorage.setItem(STORE.DATA, JSON.stringify(expenses));
}

function nextSerial() {
  if (!expenses.length) return 1;
  return Math.max(...expenses.map(e => e.serialNumber || 0)) + 1;
}

// ── Time & Mode Filtering ──────────────────────────────────
function setTimeRange(range) {
  timeRange = range;
  document.querySelectorAll('#timeTabs .time-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.range === range);
  });

  const customBar = document.getElementById('customDateRangeBar');
  if (customBar) {
    if (range === 'custom') {
      customBar.style.display = 'flex';
      const startEl = document.getElementById('customStartDate');
      const endEl = document.getElementById('customEndDate');
      const now = new Date();
      if (!startEl.value) {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        startEl.value = dateStr(firstDay);
      }
      if (!endEl.value) {
        endEl.value = dateStr(now);
      }
      customStartDate = startEl.value;
      customEndDate = endEl.value;
    } else {
      customBar.style.display = 'none';
    }
  }

  renderAll();
}

function applyCustomDateRange() {
  const startEl = document.getElementById('customStartDate');
  const endEl = document.getElementById('customEndDate');
  if (startEl && endEl) {
    customStartDate = startEl.value;
    customEndDate = endEl.value;
    if (customStartDate && customEndDate && customStartDate > customEndDate) {
      toast('Start date cannot be after end date');
      return;
    }
    renderAll();
  }
}

function filterExpenses(list) {
  const now = new Date();
  const todayStr = dateStr(now);

  return list.filter(e => {
    // Mode filter
    const itemMode = e.mode || 'Meal Expenses';
    if (selectedMode !== 'all') {
      if (selectedMode === 'House Expenses') {
        if (!isHouseExpense(itemMode)) return false;
      } else if (selectedMode === 'Meal Expenses') {
        if (!isMealExpense(itemMode)) return false;
      } else if (itemMode !== selectedMode) {
        return false;
      }
    }

    // Time filter
    if (timeRange === 'all') return true;
    const d = new Date(e.dateTime.replace(/-/g, '/'));
    if (isNaN(d)) return true;

    if (timeRange === 'day' || timeRange === 'today') {
      return dateStr(d) === todayStr;
    }
    if (timeRange === 'week') {
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - ((day + 6) % 7));
      mon.setHours(0,0,0,0);
      return d >= mon;
    }
    if (timeRange === 'month') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    if (timeRange === 'custom') {
      const dStr = dateStr(d);
      if (customStartDate && dStr < customStartDate) return false;
      if (customEndDate && dStr > customEndDate) return false;
      return true;
    }
    return true;
  });
}

function dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ── Render ─────────────────────────────────────────────────
function renderAll() {
  renderStats();
  renderBalances();
  renderExpenses();
}

function renderStats() {
  const filtered = filterExpenses(expenses);
  const total = filtered.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  // Relevant active members for current mode
  const relevantMembers = getActiveMembersForMode(selectedMode);
  const memberCount = Math.max(relevantMembers.length, 1);
  const perPerson = total / memberCount;

  document.getElementById('statTotal').textContent = fmt(total);
  document.getElementById('statCount').textContent = filtered.length + ' expense' + (filtered.length === 1 ? '' : 's');
  document.getElementById('statPerPerson').textContent = fmt(perPerson);

  const perPersonLabel = document.getElementById('statPerPersonLabel');
  if (perPersonLabel) {
    const modeSuffix = selectedMode === 'all' ? '' : ` · ${selectedMode}`;
    perPersonLabel.textContent = `Per person (${relevantMembers.length} member${relevantMembers.length === 1 ? '' : 's'}${modeSuffix})`;
  }

  let timeLabel = 'Today';
  if (timeRange === 'day' || timeRange === 'today') timeLabel = 'Today';
  else if (timeRange === 'week') timeLabel = 'This week';
  else if (timeRange === 'month') timeLabel = 'This month';
  else if (timeRange === 'all') timeLabel = 'All time';
  else if (timeRange === 'custom') {
    timeLabel = (customStartDate && customEndDate) ? `${customStartDate} to ${customEndDate}` : 'Calendar range';
  }

  const modeText = selectedMode === 'all' ? '' : ` (${selectedMode})`;
  document.getElementById('balanceRangeLabel').textContent = timeLabel + modeText;
  document.getElementById('overviewTitle').textContent = 'Overview' + modeText;
}

function renderBalances() {
  const filtered = filterExpenses(expenses);
  const total = filtered.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  const relevantMembers = getActiveMembersForMode(selectedMode);
  const memberCount = Math.max(relevantMembers.length, 1);
  const perPerson = total / memberCount;

  // Calculate how much each relevant member paid
  const paid = {};
  relevantMembers.forEach(m => { paid[m] = 0; });
  filtered.forEach(e => {
    const m = e.member || '';
    if (paid[m] !== undefined) paid[m] += parseFloat(e.amount) || 0;
  });

  const container = document.getElementById('memberBalances');
  if (relevantMembers.length === 0) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:13px">No members enrolled for this mode</div>';
    return;
  }

  container.innerHTML = relevantMembers.map(m => {
    const p = paid[m] || 0;
    const due = perPerson - p;
    const isOverpaid = due < -0.005;
    const isSettled = Math.abs(due) < 0.005;
    const isDue = due > 0.005;

    let balanceHtml = '';
    if (isSettled) {
      balanceHtml = `<span class="balance-badge badge-settled">Settled</span>`;
    } else if (isDue) {
      balanceHtml = `<span class="balance-badge badge-due">Due ${fmt(due)}</span>`;
    } else if (isOverpaid) {
      balanceHtml = `<span class="balance-badge badge-overpaid">+${fmt(-due)}</span>`;
    }

    const initial = m.charAt(0).toUpperCase();

    return `
      <div class="balance-item">
        <div class="balance-left">
          <div class="member-avatar">${esc(initial)}</div>
          <div>
            <div class="balance-name">${esc(m)}</div>
            <div class="balance-sub">Paid ${fmt(p)}</div>
          </div>
        </div>
        <div class="balance-right">
          ${balanceHtml}
        </div>
      </div>
    `;
  }).join('');
}

function renderExpenses() {
  const search = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  let filtered = filterExpenses(expenses);

  if (search) {
    filtered = filtered.filter(e =>
      (e.descriptions || '').toLowerCase().includes(search) ||
      (e.member || '').toLowerCase().includes(search) ||
      (e.paymentMethod || '').toLowerCase().includes(search) ||
      (e.remarks || '').toLowerCase().includes(search) ||
      (e.mode || '').toLowerCase().includes(search) ||
      String(e.serialNumber).includes(search)
    );
  }

  // Sort newest first
  filtered.sort((a, b) => {
    const da = new Date(a.dateTime.replace(/-/g, '/'));
    const db = new Date(b.dateTime.replace(/-/g, '/'));
    return db - da;
  });

  const countEl = document.getElementById('expenseCount');
  countEl.textContent = filtered.length + ' item' + (filtered.length === 1 ? '' : 's');

  const container = document.getElementById('expenseList');

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fa-regular fa-receipt"></i></div>
        <div class="empty-state-text">${search ? 'No matching expenses' : 'No expenses in this view'}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(e => {
    const d = new Date(e.dateTime.replace(/-/g, '/'));
    const timeStr = isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateDisplay = isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const isHouse = isHouseExpense(e.mode);
    const modeBadge = isHouse ? 'House' : 'Meal';
    const payBadge = e.paymentMethod || e.remarks || 'Cash';

    return `
      <div class="expense-item" onclick="openDetail(${e.serialNumber})">
        <div class="expense-left">
          <div class="expense-desc">${esc(e.descriptions)}</div>
          <div class="expense-meta">
            <span>${dateDisplay}</span>
            <span>${timeStr}</span>
            <span class="expense-member-tag" style="background:var(--accent-light);color:var(--text-primary)">${esc(modeBadge)}</span>
            <span class="expense-member-tag" style="background:var(--bg-tertiary);color:var(--text-secondary)"><i class="fa-solid fa-credit-card" style="font-size:10px;margin-right:3px"></i>${esc(payBadge)}</span>
            <span class="expense-member-tag">${esc(e.member || '—')}</span>
          </div>
        </div>
        <div class="expense-amount">${fmt(e.amount)}</div>
      </div>
    `;
  }).join('');
}

// ── Purchase Items Inventory Management ────────────────────
function loadInventory() {
  const raw = localStorage.getItem(STORE.INVENTORY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        inventory = parsed;
        updateInventoryUI();
        return;
      }
    } catch (e) {}
  }
  inventory = [...DEFAULT_INVENTORY];
  saveInventory(false);
}

function saveInventory(sync = true) {
  localStorage.setItem(STORE.INVENTORY, JSON.stringify(inventory));
  updateInventoryUI();
  if (sync && isScriptConfigured()) {
    sendAction('saveInventory', { items: inventory });
  }
}

function updateInventoryUI() {
  const countEl = document.getElementById('settingsInventoryCount');
  if (countEl) countEl.textContent = `${inventory.length} items`;
  const listCount = document.getElementById('inventoryListCount');
  if (listCount) listCount.textContent = inventory.length;
}

function openInventoryManager() {
  closeModal('settingsModal');
  renderInventoryManagerList();
  openModal('inventoryModal');
}

function renderInventoryManagerList() {
  const container = document.getElementById('inventoryManagerList');
  if (!container) return;
  updateInventoryUI();

  const isAdmin = currentUser && currentUser.role === 'Super Admin';
  const adminControls = document.getElementById('adminInventoryControls');
  const notice = document.getElementById('nonAdminInventoryNotice');

  if (adminControls) adminControls.style.display = isAdmin ? 'block' : 'none';
  if (notice) notice.style.display = isAdmin ? 'none' : 'block';

  if (inventory.length === 0) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:13px">No inventory items configured</div>';
    return;
  }

  container.innerHTML = inventory.map((item, idx) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;font-weight:600;color:var(--text-tertiary);width:20px">${idx + 1}</span>
        <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(item)}</span>
      </div>
      ${isAdmin ? `
        <button class="icon-btn" onclick="removeInventoryItem('${esc(item)}')" title="Remove item" style="width:28px;height:28px;color:var(--danger)">
          <i class="fa-solid fa-trash-can" style="font-size:12px"></i>
        </button>
      ` : ''}
    </div>
  `).join('');
}

function addInventoryItem() {
  if (!currentUser || currentUser.role !== 'Super Admin') {
    toast('Only Super Admin can add items to inventory');
    return;
  }
  const input = document.getElementById('inputNewInventoryItem');
  const name = (input.value || '').trim();
  if (!name) return;
  if (inventory.some(i => i.toLowerCase() === name.toLowerCase())) {
    toast('Item already in inventory');
    return;
  }
  inventory.push(name);
  saveInventory(true);
  input.value = '';
  renderInventoryManagerList();
  toast(`"${name}" added to inventory`);
}

function removeInventoryItem(item) {
  if (!currentUser || currentUser.role !== 'Super Admin') {
    toast('Only Super Admin can remove items from inventory');
    return;
  }
  inventory = inventory.filter(i => i.toLowerCase() !== item.toLowerCase());
  saveInventory(true);
  renderInventoryManagerList();
  toast(`"${item}" removed`);
}

// ── Payment Methods Management ─────────────────────────────
function loadPaymentMethods() {
  const raw = localStorage.getItem(STORE.PAYMENT_METHODS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        paymentMethods = parsed;
        updatePaymentMethodsUI();
        return;
      }
    } catch (e) {}
  }
  paymentMethods = [...DEFAULT_PAYMENT_METHODS];
  savePaymentMethods(false);
}

function savePaymentMethods(sync = true) {
  localStorage.setItem(STORE.PAYMENT_METHODS, JSON.stringify(paymentMethods));
  updatePaymentMethodsUI();
  if (sync && isScriptConfigured()) {
    sendAction('savePaymentMethods', { methods: paymentMethods });
  }
}

function updatePaymentMethodsUI() {
  const countEl = document.getElementById('settingsPaymentMethodsCount');
  if (countEl) countEl.textContent = `${paymentMethods.length} methods`;
}

function openPaymentMethodsModal() {
  closeModal('settingsModal');
  renderPaymentMethodsList();
  openModal('paymentMethodsModal');
}

function renderPaymentMethodsList() {
  const container = document.getElementById('paymentMethodsManagerList');
  if (!container) return;
  updatePaymentMethodsUI();

  if (paymentMethods.length === 0) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:13px">No payment methods configured</div>';
    return;
  }

  container.innerHTML = paymentMethods.map(m => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;gap:10px">
        <i class="fa-solid fa-credit-card" style="font-size:12px;color:var(--text-tertiary)"></i>
        <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(m)}</span>
      </div>
      <button class="icon-btn" onclick="removePaymentMethod('${esc(m)}')" title="Remove" style="width:28px;height:28px;color:var(--danger)">
        <i class="fa-solid fa-trash-can" style="font-size:12px"></i>
      </button>
    </div>
  `).join('');
}

function addPaymentMethod() {
  const input = document.getElementById('inputNewPaymentMethod');
  const name = (input.value || '').trim();
  if (!name) return;
  if (paymentMethods.some(m => m.toLowerCase() === name.toLowerCase())) {
    toast('Payment method already exists');
    return;
  }
  paymentMethods.push(name);
  savePaymentMethods(true);
  input.value = '';
  renderPaymentMethodsList();
  toast(`"${name}" added`);
}

function removePaymentMethod(method) {
  if (paymentMethods.length <= 1) {
    toast('At least one payment method is required');
    return;
  }
  paymentMethods = paymentMethods.filter(m => m.toLowerCase() !== method.toLowerCase());
  savePaymentMethods(true);
  renderPaymentMethodsList();
  toast(`"${method}" removed`);
}

function populatePaymentMethodsSelect(selectedVal) {
  const select = document.getElementById('formPaymentMethod');
  if (!select) return;
  select.innerHTML = paymentMethods.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  if (selectedVal && paymentMethods.includes(selectedVal)) {
    select.value = selectedVal;
  } else if (paymentMethods.length > 0) {
    select.value = paymentMethods[0];
  }
}

// ── Purchase Items Form Selector ───────────────────────────
function renderFormInventoryOptions() {
  const select = document.getElementById('formInventorySelect');
  if (select) {
    select.innerHTML = '<option value="">-- Choose from Inventory --</option>' +
      inventory.map(item => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
  }
  renderInventorySuggestionChips();
  renderSelectedItemsChips();
}

function renderInventorySuggestionChips() {
  const container = document.getElementById('inventorySuggestionsChips');
  if (!container) return;

  container.innerHTML = inventory.map(item => {
    const isSelected = selectedItems.includes(item);
    return `<button type="button" class="chip-btn ${isSelected ? 'active' : ''}" onclick="toggleSuggestionItem('${esc(item)}')">${esc(item)}</button>`;
  }).join('');
}

function renderSelectedItemsChips() {
  const container = document.getElementById('selectedItemsContainer');
  if (!container) return;

  if (selectedItems.length === 0) {
    container.innerHTML = '<span style="font-size:11px;color:var(--text-tertiary);font-style:italic">No items selected yet</span>';
    return;
  }

  container.innerHTML = selectedItems.map(item => `
    <span class="item-tag">
      ${esc(item)}
      <span class="item-tag-remove" onclick="removeSelectedItem('${esc(item)}')">&times;</span>
    </span>
  `).join('');
}

function handleSelectInventoryItem(item) {
  if (!item) return;
  if (!selectedItems.includes(item)) {
    selectedItems.push(item);
    syncDescriptionFromSelectedItems();
    renderFormInventoryOptions();
  }
  const select = document.getElementById('formInventorySelect');
  if (select) select.value = '';
}

function toggleSuggestionItem(item) {
  if (selectedItems.includes(item)) {
    selectedItems = selectedItems.filter(i => i !== item);
  } else {
    selectedItems.push(item);
  }
  syncDescriptionFromSelectedItems();
  renderFormInventoryOptions();
}

function removeSelectedItem(item) {
  selectedItems = selectedItems.filter(i => i !== item);
  syncDescriptionFromSelectedItems();
  renderFormInventoryOptions();
}

function clearSelectedItems() {
  selectedItems = [];
  syncDescriptionFromSelectedItems();
  renderFormInventoryOptions();
}

function syncDescriptionFromSelectedItems() {
  const descInput = document.getElementById('formDesc');
  if (!descInput) return;
  descInput.value = selectedItems.join(', ');
}

// ── Add / Edit Expense ─────────────────────────────────────
function populateFormMembers(selectedMember, modeValue) {
  const select = document.getElementById('formMember');
  if (!select) return;

  const mode = modeValue || document.getElementById('formMode').value;
  const eligibleMembers = getActiveMembersForMode(mode);
  const listToUse = eligibleMembers.length > 0 ? eligibleMembers : members;

  select.innerHTML = listToUse.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  if (selectedMember && listToUse.includes(selectedMember)) {
    select.value = selectedMember;
  } else if (currentUser && listToUse.includes(currentUser.username)) {
    select.value = currentUser.username;
  } else if (listToUse.length > 0) {
    select.value = listToUse[0];
  }
}

function openAddModal() {
  if (currentUser && currentUser.role === 'Viewer') {
    toast('Viewer role cannot add expenses');
    return;
  }
  editingSerial = null;
  document.getElementById('formTitle').textContent = 'Add Expense';
  document.getElementById('formSubmitBtn').textContent = 'Save Expense';
  document.getElementById('formAmount').value = '';
  document.getElementById('formDesc').value = '';

  const modeSelect = document.getElementById('formMode');
  if (selectedMode !== 'all') {
    modeSelect.value = isHouseExpense(selectedMode) ? 'House Expenses' : 'Meal Expenses';
  } else if (currentUser && currentUser.modes && currentUser.modes !== 'Both') {
    modeSelect.value = isHouseExpense(currentUser.modes) ? 'House Expenses' : 'Meal Expenses';
  } else {
    modeSelect.value = 'Meal Expenses';
  }

  // Hook change listener to update members
  modeSelect.onchange = () => populateFormMembers();

  populateFormMembers();
  selectedItems = [];
  renderFormInventoryOptions();
  populatePaymentMethodsSelect('Cash');

  document.getElementById('formSerial').value = '';
  setFormNow();
  openModal('expenseModal');
  setTimeout(() => document.getElementById('formAmount').focus(), 300);
}

function openEditModal(serial) {
  const item = expenses.find(e => e.serialNumber === serial);
  if (!item) return;

  // Permission check
  const canEdit = currentUser && (
    currentUser.role === 'Super Admin' ||
    (currentUser.role === 'Editor' && (item.member === currentUser.username || item.createdBy === currentUser.username))
  );

  if (!canEdit) {
    toast('You do not have permission to edit this expense');
    return;
  }

  editingSerial = serial;
  document.getElementById('formTitle').textContent = 'Edit Expense';
  document.getElementById('formSubmitBtn').textContent = 'Update';
  document.getElementById('formAmount').value = item.amount;
  document.getElementById('formDesc').value = item.descriptions;

  const modeSelect = document.getElementById('formMode');
  const normalizedMode = isHouseExpense(item.mode) ? 'House Expenses' : 'Meal Expenses';
  modeSelect.value = normalizedMode;
  modeSelect.onchange = () => populateFormMembers(item.member);

  populateFormMembers(item.member, normalizedMode);

  // Extract selected inventory items from existing description
  selectedItems = [];
  const currentDesc = item.descriptions || '';
  inventory.forEach(invItem => {
    const re = new RegExp('\\b' + invItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(currentDesc)) {
      selectedItems.push(invItem);
    }
  });
  renderFormInventoryOptions();
  populatePaymentMethodsSelect(item.paymentMethod || item.remarks || 'Cash');

  document.getElementById('formSerial').value = item.serialNumber;
  let dt = item.dateTime;
  if (dt && !dt.includes('T')) dt = dt.replace(' ', 'T');
  document.getElementById('formDate').value = dt;
  closeModal('detailModal');
  openModal('expenseModal');
}

function setFormNow() {
  const n = new Date();
  const v = n.getFullYear() + '-' + p(n.getMonth()+1) + '-' + p(n.getDate()) + 'T' + p(n.getHours()) + ':' + p(n.getMinutes());
  document.getElementById('formDate').value = v;
}

function p(n) { return String(n).padStart(2, '0'); }

async function handleSubmit(ev) {
  ev.preventDefault();
  const amount = parseFloat(document.getElementById('formAmount').value);
  const desc = document.getElementById('formDesc').value.trim();
  const mode = document.getElementById('formMode').value;
  const member = document.getElementById('formMember').value;
  const dateTime = document.getElementById('formDate').value.replace('T', ' ');
  const paymentMethod = document.getElementById('formPaymentMethod') ? document.getElementById('formPaymentMethod').value : 'Cash';

  if (!desc || isNaN(amount) || amount <= 0) {
    toast('Enter a valid amount and description');
    return;
  }

  const serial = editingSerial || nextSerial();
  const createdBy = currentUser ? currentUser.username : member;
  const item = { serialNumber: serial, dateTime, descriptions: desc, amount, mode, member, paymentMethod, remarks: paymentMethod, createdBy };

  if (editingSerial) {
    const idx = expenses.findIndex(e => e.serialNumber === editingSerial);
    if (idx !== -1) {
      item.createdBy = expenses[idx].createdBy || createdBy;
      expenses[idx] = item;
    }
    save();
    renderAll();
    closeModal('expenseModal');
    toast('Expense updated');
    if (isScriptConfigured()) sendAction('update', item);
  } else {
    expenses.push(item);
    save();
    renderAll();
    closeModal('expenseModal');
    toast('Expense added');
    if (isScriptConfigured()) sendAction('create', item);
  }
  editingSerial = null;
}

// ── Detail / Delete ────────────────────────────────────────
function openDetail(serial) {
  const item = expenses.find(e => e.serialNumber === serial);
  if (!item) return;

  const d = new Date(item.dateTime.replace(/-/g, '/'));
  const dateFmt = isNaN(d) ? item.dateTime : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Access control for editing/deleting
  const canEdit = currentUser && (
    currentUser.role === 'Super Admin' ||
    (currentUser.role === 'Editor' && (item.member === currentUser.username || item.createdBy === currentUser.username))
  );

  document.getElementById('detailBody').innerHTML = `
    <div style="margin-bottom:24px">
      <div style="font-size:28px;font-weight:700;margin-bottom:4px">${fmt(item.amount)}</div>
      <div style="font-size:15px;font-weight:500;color:var(--text-primary);margin-bottom:2px">${esc(item.descriptions)}</div>
      <div style="font-size:12px;color:var(--text-tertiary)">${dateFmt}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px">
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:2px">Mode</div>
        <div style="font-size:14px;font-weight:600">${esc(isHouseExpense(item.mode) ? 'House Expenses' : 'Meal Expenses')}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:2px">Paid by</div>
        <div style="font-size:14px;font-weight:600">${esc(item.member || '—')}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:2px">Payment Method</div>
        <div style="font-size:14px;font-weight:600">${esc(item.paymentMethod || item.remarks || 'Cash')}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:2px">Serial</div>
        <div style="font-size:14px;font-weight:500">#${item.serialNumber}</div>
      </div>
    </div>

    ${canEdit ? `
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" style="flex:1" onclick="openEditModal(${serial})"><i class="fa-solid fa-pen" style="margin-right:6px"></i>Edit</button>
        <button class="btn btn-danger" style="flex:1" onclick="confirmDelete(${serial})"><i class="fa-solid fa-trash" style="margin-right:6px"></i>Delete</button>
      </div>
    ` : `
      <div style="padding:10px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:12px;color:var(--text-tertiary);text-align:center">
        ${currentUser && currentUser.role === 'Viewer' ? 'Viewer access (read-only)' : 'Only creator or Super Admin can edit'}
      </div>
    `}
  `;
  openModal('detailModal');
}

function confirmDelete(serial) {
  const item = expenses.find(e => e.serialNumber === serial);
  if (!item) return;

  const canDelete = currentUser && (
    currentUser.role === 'Super Admin' ||
    (currentUser.role === 'Editor' && (item.member === currentUser.username || item.createdBy === currentUser.username))
  );

  if (!canDelete) {
    toast('You do not have permission to delete this expense');
    return;
  }

  if (!confirm(`Delete expense #${serial} (${item.descriptions})?`)) return;

  expenses = expenses.filter(e => e.serialNumber !== serial);
  save();
  renderAll();
  closeModal('detailModal');
  toast('Expense deleted');

  if (isScriptConfigured()) sendAction('delete', { serialNumber: serial });
}

// ── Google Sheets Sync ─────────────────────────────────────
async function syncFromSheet() {
  if (!isScriptConfigured()) return;
  try {
    const url = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=read&t=' + Date.now();
    const res = await fetch(url, { redirect: 'follow' });
    const data = await res.json();
    if (data.status === 'success') {
      if (Array.isArray(data.data)) {
        expenses = data.data.map(r => {
          const rawMode = r.mode || 'Meal Expenses';
          const normalizedMode = (rawMode === 'Daily Meal' || rawMode === 'Meal' || !rawMode) ? 'Meal Expenses' : (rawMode === 'House rent' ? 'House Expenses' : rawMode);
          const payVal = r.paymentMethod || r.remarks || 'Cash';
          return {
            serialNumber: parseInt(r.serialNumber) || 1,
            dateTime: r.dateTime || '',
            descriptions: r.descriptions || '',
            amount: parseFloat(r.amount) || 0,
            mode: normalizedMode,
            member: r.member || '',
            paymentMethod: payVal,
            remarks: payVal,
            createdBy: r.createdBy || ''
          };
        });
        save();
      }

      if (Array.isArray(data.inventory) && data.inventory.length > 0) {
        inventory = data.inventory;
        saveInventory(false);
      }

      if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) {
        paymentMethods = data.paymentMethods;
        savePaymentMethods(false);
      }

      if (Array.isArray(data.users) && data.users.length > 0) {
        data.users.forEach(ru => {
          const local = users.find(u => u.username.toLowerCase() === ru.username.toLowerCase());
          if (local) {
            local.role = ru.role || local.role;
            local.status = ru.status || local.status;
            local.modes = ru.modes || local.modes || 'Both';
          } else {
            users.push({ username: ru.username, pin: '1234', role: ru.role || 'Editor', status: ru.status || 'Active', modes: ru.modes || 'Both' });
          }
        });
        const rabbi = users.find(u => u.username.toLowerCase() === 'rabbi');
        if (rabbi) rabbi.role = 'Super Admin';

        saveUsers();
        users.forEach(u => {
          if (!members.some(m => m.toLowerCase() === u.username.toLowerCase())) {
            members.push(u.username);
          }
        });
        saveMembers();
      }

      renderAll();
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      document.getElementById('lastSyncLabel').textContent = t;
      toast('Synced with Google Sheet');
    }
  } catch (err) {
    console.error(err);
    toast('Sync failed');
  }
}

function doSync() {
  if (!isScriptConfigured()) {
    toast('Configure Google Sheet Web App URL first');
    openSheetSetup();
    return;
  }
  toast('Syncing with Google Sheet...');
  syncFromSheet();
}

async function sendAction(action, payload) {
  if (!isScriptConfigured()) return;
  try {
    await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      redirect: 'follow',
      mode: 'no-cors'
    });
  } catch (err) {
    console.error('sendAction error:', err);
  }
}

// ── Google Sheet Config Modal ──────────────────────────────
function loadSheetConfig() {
  const s = localStorage.getItem(STORE.SCRIPT);
  if (s) scriptUrl = s;
  const sh = localStorage.getItem(STORE.SHEET);
  if (sh) sheetUrl = sh;
}

function openSheetSetup() {
  if (currentUser && currentUser.role !== 'Super Admin') {
    toast('Only Super Admin can edit Cloud Database settings');
    return;
  }
  document.getElementById('inputScriptUrl').value = scriptUrl;
  document.getElementById('inputSheetUrl').value = sheetUrl;
  closeModal('settingsModal');
  openModal('sheetSetupModal');
}

function saveSheetSettings() {
  if (currentUser && currentUser.role !== 'Super Admin') {
    toast('Only Super Admin can modify database settings');
    return;
  }
  const s = document.getElementById('inputScriptUrl').value.trim();
  const sh = document.getElementById('inputSheetUrl').value.trim();
  scriptUrl = s;
  sheetUrl = sh;
  localStorage.setItem(STORE.SCRIPT, s);
  localStorage.setItem(STORE.SHEET, sh);
  updateConnectionStatus();
  closeModal('sheetSetupModal');
  toast('Connection settings saved');
  if (isScriptConfigured()) syncFromSheet();
}

function clearSheetSettings() {
  if (currentUser && currentUser.role !== 'Super Admin') {
    toast('Only Super Admin can reset settings');
    return;
  }
  if (!confirm('Clear Google Sheet URL and revert to local mode?')) return;
  scriptUrl = '';
  sheetUrl = '';
  localStorage.removeItem(STORE.SCRIPT);
  localStorage.removeItem(STORE.SHEET);
  updateConnectionStatus();
  closeModal('sheetSetupModal');
  toast('Reset to default');
}

async function testConnection() {
  const url = document.getElementById('inputScriptUrl').value.trim();
  if (!url) { toast('Please enter a Web App URL'); return; }
  toast('Testing connection...');
  try {
    const testUrl = url + (url.includes('?') ? '&' : '?') + 'action=ping&t=' + Date.now();
    const res = await fetch(testUrl, { redirect: 'follow' });
    const data = await res.json();
    if (data.status === 'success') {
      toast(`Connected! Sheet: "${data.sheetName}", Rows: ${data.totalRows}, Users: ${data.userCount}`);
    } else {
      toast('Connection error: ' + (data.message || 'Unknown response'));
    }
  } catch (err) {
    toast('Could not connect. Ensure access is set to "Anyone"');
  }
}

function updateConnectionStatus() {
  const statusEl = document.getElementById('headerStatus');
  const connLabel = document.getElementById('connectionStatusLabel');
  if (isScriptConfigured()) {
    if (statusEl) statusEl.textContent = 'Cloud synced';
    if (connLabel) connLabel.textContent = 'Connected';
  } else {
    if (statusEl) statusEl.textContent = 'Local mode';
    if (connLabel) connLabel.textContent = 'Not connected';
  }
}

// ── Currency ───────────────────────────────────────────────
function loadCurrency() {
  const c = localStorage.getItem(STORE.CURRENCY);
  if (c) currency = c;
  updateCurrencyLabel();
}

function updateCurrencyLabel() {
  const found = CURRENCIES.find(c => c.symbol === currency);
  const label = found ? `${found.symbol} (${found.label.split(' ')[0]})` : currency;
  const el = document.getElementById('currencyLabel');
  if (el) el.textContent = label;
}

function openCurrencyPicker() {
  closeModal('settingsModal');
  renderCurrencyList();
  openModal('currencyModal');
}

function renderCurrencyList() {
  const container = document.getElementById('currencyList');
  container.innerHTML = CURRENCIES.map(c => `
    <div class="settings-item" onclick="selectCurrency('${c.symbol}')">
      <span class="settings-item-label">${c.label}</span>
      ${currency === c.symbol ? '<i class="fa-solid fa-check" style="color:var(--text-primary);font-size:14px"></i>' : ''}
    </div>
  `).join('');
}

function selectCurrency(sym) {
  currency = sym;
  localStorage.setItem(STORE.CURRENCY, sym);
  updateCurrencyLabel();
  renderAll();
  closeModal('currencyModal');
  openSettings();
}

function fmt(n) {
  const num = parseFloat(n) || 0;
  return currency + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Theme ──────────────────────────────────────────────────
function loadTheme() {
  const t = localStorage.getItem(STORE.THEME) || 'dark';
  applyTheme(t);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(STORE.THEME, next);
  document.getElementById('themeLabel').textContent = next === 'dark' ? 'Dark' : 'Light';
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.getElementById('metaThemeColor');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0f0f0f' : '#ffffff');
}

// ── Export ──────────────────────────────────────────────────
function exportCSV() {
  if (!expenses.length) { toast('No data to export'); return; }
  const headers = ['Serial Number', 'Date & Time', 'Descriptions', 'Amount', 'Mode', 'Member', 'Payment Method', 'CreatedBy'];
  const rows = expenses.map(e => [
    e.serialNumber,
    '"' + (e.dateTime || '').replace(/"/g, '""') + '"',
    '"' + (e.descriptions || '').replace(/"/g, '""') + '"',
    e.amount,
    '"' + (isHouseExpense(e.mode) ? 'House Expenses' : 'Meal Expenses').replace(/"/g, '""') + '"',
    '"' + (e.member || '').replace(/"/g, '""') + '"',
    '"' + (e.paymentMethod || e.remarks || 'Cash').replace(/"/g, '""') + '"',
    '"' + (e.createdBy || '').replace(/"/g, '""') + '"'
  ]);
  const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Expenses_' + dateStr(new Date()) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('Exported to CSV');
}

// ── Script Viewer ──────────────────────────────────────────
function openScriptViewer() {
  document.getElementById('scriptCodeArea').value = getScriptCode();
  closeModal('settingsModal');
  openModal('scriptModal');
}

function copyScript() {
  navigator.clipboard.writeText(getScriptCode()).then(() => toast('Copied to clipboard'));
}

// ── Settings ───────────────────────────────────────────────
function openSettings() {
  updateCurrencyLabel();
  updateConnectionStatus();
  updateSettingsMemberCount();
  updateInventoryUI();
  updatePaymentMethodsUI();

  const adminSection = document.getElementById('adminSettingsSection');
  if (adminSection) {
    adminSection.style.display = (currentUser && currentUser.role === 'Super Admin') ? 'block' : 'none';
  }

  const t = document.documentElement.getAttribute('data-theme');
  document.getElementById('themeLabel').textContent = t === 'dark' ? 'Dark' : 'Light';
  openModal('settingsModal');
}

// ── Modal helpers ──────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) {
    document.body.style.overflow = '';
  }
}

// Close on backdrop tap
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) {
      document.body.style.overflow = '';
    }
  }
});

// ── Toast ──────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const container = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.2s';
    setTimeout(() => t.remove(), 200);
  }, 2400);
}

// ── PWA Setup ──────────────────────────────────────────────
function setupPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!localStorage.getItem(STORE.INSTALL)) {
      document.getElementById('installBanner').style.display = 'flex';
    }
  });
}

function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => {
      deferredInstallPrompt = null;
      document.getElementById('installBanner').style.display = 'none';
    });
  }
}

function dismissInstall() {
  document.getElementById('installBanner').style.display = 'none';
  localStorage.setItem(STORE.INSTALL, '1');
}

// ── Helpers ────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Google Apps Script code (embedded for copy) ────────────
function getScriptCode() {
  return `/**
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

  if (action === 'login') {
    const username = String(p.username || '').trim();
    const pin = String(p.pin || '').trim();
    const users = readAllUsers();
    const found = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!found) return json({ status: 'error', message: 'User not found' });
    if (found.status === 'Disabled') return json({ status: 'error', message: 'Account is deactivated' });
    if (found.pin !== pin) return json({ status: 'error', message: 'Incorrect PIN' });

    return json({
      status: 'success',
      user: { username: found.username, role: found.role, status: found.status, modes: found.modes }
    });
  }

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

  if (action === 'forgotPassword' || action === 'resetMyPin') {
    const username = String(p.username || '').trim();
    const newPin = String(p.newPin || '').trim();
    const uLr = uSh.getLastRow();

    if (!username || !newPin) return json({ status: 'error', message: 'Username and new PIN are required' });
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

  if (action === 'getUsers') {
    const users = readAllUsers().map(u => ({ username: u.username, role: u.role, status: u.status, modes: u.modes }));
    return json({ status: 'success', users });
  }

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

  if (action === 'saveInventory') {
    const items = p.items || [];
    PropertiesService.getScriptProperties().setProperty('INVENTORY', JSON.stringify(items));
    return json({ status: 'success', message: 'Inventory saved' });
  }

  if (action === 'savePaymentMethods') {
    const methods = p.methods || [];
    PropertiesService.getScriptProperties().setProperty('PAYMENT_METHODS', JSON.stringify(methods));
    return json({ status: 'success', message: 'Payment methods saved' });
  }

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
}`;
}

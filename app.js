/* Daily Expenses Tracker — app.js
   Flat, mobile-first, user login & access levels, Google Sheets database integration.
   Rabbi Super Admin, House Expenses & Daily Meal modes, Forgot PIN, Fixed Cloud Endpoint. */

// ── Fixed Cloud Google Apps Script Endpoint ────────────────
// Set this to your deployed Google Apps Script Web App URL so users can access anywhere without manual setup.
const FIXED_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwY4i8H2gN5yZ0T9E0X_CHANGE_TO_YOUR_DEPLOYED_URL/exec';
const FIXED_SHEET_URL = '';

// ── Constants & Defaults ───────────────────────────────────
// Rabbi is Super Admin, all others are User (Editor)
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
  DATA:         'exp_data_v2',
  USERS:        'exp_users_v2',
  SESSION_USER: 'exp_session_user_v2',
  MEMBERS:      'exp_members_v2',
  SCRIPT:       'exp_script_url_v2',
  SHEET:        'exp_sheet_url_v2',
  CURRENCY:     'exp_currency_v2',
  THEME:        'exp_theme_v2',
  INSTALL:      'exp_install_dismissed_v2',
};

// ── State ──────────────────────────────────────────────────
let currentUser = null;
let users = [];
let expenses = [];
let members = [];
let currency = '৳';
let scriptUrl = FIXED_SCRIPT_URL;
let sheetUrl = FIXED_SHEET_URL;
let timeRange = 'today';
let selectedMode = 'all'; // 'all', 'Daily Meal', 'House Expenses'
let editingSerial = null;
let deferredInstallPrompt = null;

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadCurrency();
  loadSheetConfig();
  loadUsers();
  loadMembers();
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
        // Guarantee Rabbi is Super Admin
        const rabbi = users.find(u => u.username.toLowerCase() === 'rabbi');
        if (rabbi) {
          rabbi.role = 'Super Admin';
        } else {
          users.unshift({ username: 'Rabbi', pin: '1234', role: 'Super Admin', status: 'Active', modes: 'Both' });
        }
        // Ensure modes property exists for all users
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
  const rawSession = localStorage.getItem(STORE.SESSION_USER);
  if (rawSession) {
    try {
      const parsed = JSON.parse(rawSession);
      const matched = users.find(u => u.username.toLowerCase() === parsed.username.toLowerCase());
      if (matched && matched.status !== 'Disabled') {
        currentUser = matched;
        onUserAuthenticated();
        return;
      }
    } catch (e) {}
  }

  // Not authenticated: Show login view
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
      const modeTag = u.modes === 'Both' ? 'House + Meal' : (u.modes === 'House rent' ? 'House Expenses' : u.modes);
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
    toast('Account is deactivated. Contact Super Admin.');
    return;
  }

  if (user.pin !== pin) {
    toast('Incorrect PIN');
    return;
  }

  currentUser = user;
  localStorage.setItem(STORE.SESSION_USER, JSON.stringify({ username: user.username, role: user.role }));
  document.getElementById('loginPin').value = '';
  document.getElementById('loginView').style.display = 'none';

  onUserAuthenticated();
  toast(`Signed in as ${user.username}`);
}

function onUserAuthenticated() {
  updateHeaderUserBadge();
  applyUserPermissions();
  renderAll();
}

function updateHeaderUserBadge() {
  if (!currentUser) return;
  document.getElementById('headerUserName').textContent = currentUser.username;
  document.getElementById('headerUserRole').textContent = currentUser.role;
  document.getElementById('headerUserAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
}

function handleLogout() {
  localStorage.removeItem(STORE.SESSION_USER);
  currentUser = null;
  closeModal('userPanelModal');
  closeModal('settingsModal');
  document.getElementById('loginView').style.display = 'flex';
  renderLoginUserSelect();
  toast('Signed out');
}

// ── Forgot PIN / Password ──────────────────────────────────
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

function handleForgotPinSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('forgotPinUserSelect').value;
  const newPin = document.getElementById('forgotNewPin').value.trim();
  const confirmPin = document.getElementById('forgotConfirmPin').value.trim();

  if (!newPin || newPin.length < 2) {
    toast('PIN must be at least 2 digits');
    return;
  }

  if (newPin !== confirmPin) {
    toast('PINs do not match');
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
  toast(`PIN changed for ${username}. You can now sign in.`);

  // Sync with cloud if configured
  if (isScriptConfigured()) {
    sendAction('forgotPassword', { username, newPin });
  }
}

// ── User Profile Panel ─────────────────────────────────────
function openUserPanel() {
  if (!currentUser) return;

  document.getElementById('userPanelName').textContent = currentUser.username;
  document.getElementById('userPanelAvatar').textContent = currentUser.username.charAt(0).toUpperCase();

  const roleBadge = document.getElementById('userPanelRoleBadge');
  roleBadge.textContent = currentUser.role;
  roleBadge.className = 'badge ' + getRoleBadgeClass(currentUser.role);

  const modeBadge = document.getElementById('userPanelModeBadge');
  modeBadge.textContent = currentUser.modes === 'Both' ? 'House + Meal' : (currentUser.modes === 'House rent' ? 'House Expenses' : (currentUser.modes || 'Both'));

  // Calculate personal financials based on user's active modes
  const myExpenses = expenses.filter(e => {
    const isMine = (e.member || '').toLowerCase() === currentUser.username.toLowerCase();
    return isMine;
  });
  const myTotalPaid = myExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  // Compute fair share according to mode access
  let myFairShare = 0;
  const mealExpenses = expenses.filter(e => (e.mode || 'Daily Meal') === 'Daily Meal');
  const mealMembers = getActiveMembersForMode('Daily Meal');
  if (mealMembers.includes(currentUser.username) && mealMembers.length > 0) {
    const totalMeal = mealExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    myFairShare += (totalMeal / mealMembers.length);
  }

  const isHouseExpense = (m) => m === 'House Expenses' || m === 'House rent';
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
    balEl.textContent = 'Overpaid: ' + fmt(Math.abs(netDue));
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

  if (!newPin || newPin.length < 2) {
    toast('New PIN must be at least 2 digits');
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

// ── Role Permissions Enforcement ───────────────────────────
function applyUserPermissions() {
  const fab = document.querySelector('.fab');
  const adminSection = document.getElementById('adminSettingsSection');

  if (!currentUser) return;

  // 1. Viewer Role: Read-only access
  if (currentUser.role === 'Viewer') {
    if (fab) fab.style.display = 'none';
    if (adminSection) adminSection.style.display = 'none';
  } else if (currentUser.role === 'Editor') {
    if (fab) fab.style.display = 'flex';
    if (adminSection) adminSection.style.display = 'none';
  } else if (currentUser.role === 'Super Admin') {
    if (fab) fab.style.display = 'flex';
    if (adminSection) adminSection.style.display = 'block';
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
  const isTargetHouse = mode === 'House Expenses' || mode === 'House rent';
  return members.filter(m => {
    const u = users.find(usr => usr.username.toLowerCase() === m.toLowerCase());
    if (!u) return true;
    const userModes = u.modes || 'Both';
    if (userModes === 'Both') return true;
    if (isTargetHouse) {
      return userModes === 'House Expenses' || userModes === 'House rent';
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
      <div class="settings-item" style="cursor:default;flex-direction:column;align-items:stretch;gap:8px;padding:12px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="settings-item-left">
            <div class="member-avatar">${esc(initial)}</div>
            <div>
              <div style="font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px">
                ${esc(u.username)}
                ${isSelf ? '<span style="font-size:10px;color:var(--text-tertiary)">(You)</span>' : ''}
              </div>
              <div style="font-size:11px;color:var(--text-tertiary)">
                Role: <strong>${esc(u.role)}</strong> · Mode: <strong>${esc(u.modes || 'Both')}</strong>
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:6px">
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
              <option value="Daily Meal" ${u.modes === 'Daily Meal' ? 'selected' : ''}>Daily Meal Only</option>
              <option value="House Expenses" ${u.modes === 'House Expenses' || u.modes === 'House rent' ? 'selected' : ''}>House Expenses Only</option>
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

  // Also add to members if not already there
  if (!members.some(m => m.toLowerCase() === username.toLowerCase())) {
    members.push(username);
    saveMembers();
    renderMembersManagerList();
    populateFormMembers();
  }

  usernameInput.value = '';
  pinInput.value = '';
  renderAdminUsersList();
  renderAll();
  toast(`User "${username}" created (${role} · ${modes})`);

  if (isScriptConfigured()) {
    sendAction('saveUser', newUser);
  }
}

function adminChangeRole(username, newRole) {
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return;

  // Safeguard: Ensure at least one Super Admin remains
  if (user.role === 'Super Admin' && newRole !== 'Super Admin') {
    const adminCount = users.filter(u => u.role === 'Super Admin').length;
    if (adminCount <= 1) {
      toast('At least one Super Admin is required');
      renderAdminUsersList();
      return;
    }
  }

  user.role = newRole;
  saveUsers();

  if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
    currentUser.role = newRole;
    updateHeaderUserBadge();
    applyUserPermissions();
  }

  renderAdminUsersList();
  toast(`Updated ${username}'s role to ${newRole}`);

  if (isScriptConfigured()) {
    sendAction('updateRole', { username, role: newRole });
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

  renderAdminUsersList();
  renderAll();
  toast(`Updated ${username}'s mode to ${newMode}`);

  if (isScriptConfigured()) {
    sendAction('updateRole', { username, modes: newMode });
  }
}

function adminResetPin(username) {
  const newPin = prompt(`Enter new PIN for "${username}" (default 1234):`, '1234');
  if (newPin === null) return;
  const cleaned = newPin.trim() || '1234';

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return;

  user.pin = cleaned;
  saveUsers();
  toast(`PIN reset for "${username}"`);

  if (isScriptConfigured()) {
    sendAction('resetPin', { username, newPin: cleaned });
  }
}

function adminDeleteUser(username) {
  if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
    toast('You cannot delete your own account');
    return;
  }

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (user && user.role === 'Super Admin') {
    const adminCount = users.filter(u => u.role === 'Super Admin').length;
    if (adminCount <= 1) {
      toast('Cannot delete the only Super Admin');
      return;
    }
  }

  if (!confirm(`Delete user "${username}"?`)) return;

  users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
  members = members.filter(m => m.toLowerCase() !== username.toLowerCase());

  saveUsers();
  saveMembers();
  renderAdminUsersList();
  renderMembersManagerList();
  populateFormMembers();
  renderAll();
  toast(`User "${username}" deleted`);

  if (isScriptConfigured()) {
    sendAction('deleteUser', { username });
  }
}

// ── Members State (Cost Sharing) ───────────────────────────
function loadMembers() {
  const raw = localStorage.getItem(STORE.MEMBERS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        members = parsed;
        updateSettingsMemberCount();
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
  if (el) {
    el.textContent = `${members.length} member${members.length === 1 ? '' : 's'}`;
  }
}

// ── Theme ──────────────────────────────────────────────────
function loadTheme() {
  const t = localStorage.getItem(STORE.THEME) ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(t);
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(STORE.THEME, t);
  const mc = document.getElementById('metaThemeColor');
  if (mc) mc.content = t === 'dark' ? '#0f0f0f' : '#ffffff';
  const el = document.getElementById('themeLabel');
  if (el) el.textContent = t === 'dark' ? 'Dark' : 'Light';
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
}

// ── Currency ───────────────────────────────────────────────
function loadCurrency() {
  currency = localStorage.getItem(STORE.CURRENCY) || '৳';
  updateCurrencyLabel();
}

function updateCurrencyLabel() {
  const c = CURRENCIES.find(c => c.symbol === currency) || CURRENCIES[0];
  const el = document.getElementById('currencyLabel');
  if (el) el.textContent = c.label;
}

function openCurrencyPicker() {
  const list = document.getElementById('currencyList');
  list.innerHTML = CURRENCIES.map(c => `
    <div class="settings-item" onclick="setCurrency('${c.symbol}')">
      <span class="settings-item-label">${esc(c.label)}</span>
      ${c.symbol === currency ? '<i class="fa-solid fa-check" style="color:var(--success);font-size:14px"></i>' : ''}
    </div>
  `).join('');
  openModal('currencyModal');
}

function setCurrency(sym) {
  currency = sym;
  localStorage.setItem(STORE.CURRENCY, sym);
  updateCurrencyLabel();
  closeModal('currencyModal');
  renderAll();
  toast('Currency updated');
}

function fmt(n) {
  return currency + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Sheet Config (Fixed Cloud Endpoint) ─────────────────────
function loadSheetConfig() {
  const savedScript = localStorage.getItem(STORE.SCRIPT);
  const savedSheet = localStorage.getItem(STORE.SHEET);

  scriptUrl = savedScript || FIXED_SCRIPT_URL;
  sheetUrl = savedSheet || FIXED_SHEET_URL;

  updateConnectionStatus();
}

function updateConnectionStatus() {
  const statusEl = document.getElementById('headerStatus');
  const settingEl = document.getElementById('sheetStatusLabel');
  if (isScriptConfigured()) {
    statusEl.innerHTML = '<span class="conn-dot online"></span> Cloud sync';
    if (settingEl) settingEl.innerHTML = '<span class="conn-dot online"></span> Connected';
  } else {
    statusEl.textContent = 'Local mode';
    if (settingEl) settingEl.innerHTML = '<span class="conn-dot offline"></span> Ready';
  }
}

// ── Data ───────────────────────────────────────────────────
function loadExpenses() {
  const raw = localStorage.getItem(STORE.DATA);
  if (raw) {
    try {
      expenses = JSON.parse(raw);
      // Ensure mode exists for old items
      expenses.forEach(e => {
        if (!e.mode) e.mode = 'Daily Meal';
      });
    } catch { expenses = []; }
  }
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
  renderAll();
}

function filterExpenses(list) {
  const now = new Date();
  const todayStr = dateStr(now);

  return list.filter(e => {
    // Mode filter
    const itemMode = e.mode || 'Daily Meal';
    if (selectedMode !== 'all') {
      const isSelectedHouse = selectedMode === 'House Expenses' || selectedMode === 'House rent';
      const isItemHouse = itemMode === 'House Expenses' || itemMode === 'House rent';
      if (isSelectedHouse) {
        if (!isItemHouse) return false;
      } else if (itemMode !== selectedMode) {
        return false;
      }
    }

    // Time filter
    if (timeRange === 'all') return true;
    const d = new Date(e.dateTime.replace(/-/g, '/'));
    if (isNaN(d)) return true;
    if (timeRange === 'today') return dateStr(d) === todayStr;
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

  const labels = { today: 'Today', week: 'This week', month: 'This month', all: 'All time' };
  const modeText = selectedMode === 'all' ? '' : ` (${selectedMode})`;
  document.getElementById('balanceRangeLabel').textContent = labels[timeRange] + modeText;
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
    const due = perPerson - paid[m]; // positive = owes, negative = is owed
    const initial = m.charAt(0).toUpperCase();
    let dueClass, dueLabel, dueText;
    if (Math.abs(due) < 0.005) {
      dueClass = 'clear';
      dueLabel = 'Settled';
      dueText = fmt(0);
    } else if (due > 0) {
      dueClass = 'owes';
      dueLabel = 'Due';
      dueText = fmt(due);
    } else {
      dueClass = 'owed';
      dueLabel = 'Overpaid';
      dueText = fmt(Math.abs(due));
    }

    return `
      <div class="member-row">
        <div class="member-info">
          <div class="member-avatar">${esc(initial)}</div>
          <div>
            <div class="member-name">${esc(m)}</div>
            <div class="member-paid">Paid ${fmt(paid[m])}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div class="member-due ${dueClass}">${dueText}</div>
          <div class="member-due-label ${dueClass}">${dueLabel}</div>
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
    const isHouse = (e.mode === 'House Expenses' || e.mode === 'House rent');
    const modeBadge = isHouse ? 'House' : 'Meal';

    return `
      <div class="expense-item" onclick="openDetail(${e.serialNumber})">
        <div class="expense-left">
          <div class="expense-desc">${esc(e.descriptions)}</div>
          <div class="expense-meta">
            <span>${dateDisplay}</span>
            <span>${timeStr}</span>
            <span class="expense-member-tag" style="background:var(--accent-light);color:var(--text-primary)">${esc(modeBadge)}</span>
            <span class="expense-member-tag">${esc(e.member || '—')}</span>
          </div>
        </div>
        <div class="expense-amount">${fmt(e.amount)}</div>
      </div>
    `;
  }).join('');
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
  // Match current active tab mode if specific
  if (selectedMode !== 'all') {
    modeSelect.value = selectedMode;
  } else if (currentUser && currentUser.modes && currentUser.modes !== 'Both') {
    modeSelect.value = currentUser.modes;
  } else {
    modeSelect.value = 'Daily Meal';
  }

  // Hook change listener to update members
  modeSelect.onchange = () => populateFormMembers();

  populateFormMembers();
  document.getElementById('formRemarks').value = '';
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
  const normalizedMode = (item.mode === 'House rent') ? 'House Expenses' : (item.mode || 'Daily Meal');
  modeSelect.value = normalizedMode;
  modeSelect.onchange = () => populateFormMembers(item.member);

  populateFormMembers(item.member, normalizedMode);
  document.getElementById('formRemarks').value = item.remarks || '';
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
  const remarks = document.getElementById('formRemarks').value.trim();

  if (!desc || isNaN(amount) || amount <= 0) {
    toast('Enter a valid amount and description');
    return;
  }

  const serial = editingSerial || nextSerial();
  const createdBy = currentUser ? currentUser.username : member;
  const item = { serialNumber: serial, dateTime, descriptions: desc, amount, mode, member, remarks, createdBy };

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
        <div style="font-size:14px;font-weight:600">${esc((item.mode === 'House rent') ? 'House Expenses' : (item.mode || 'Daily Meal'))}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:2px">Paid by</div>
        <div style="font-size:14px;font-weight:600">${esc(item.member || '—')}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:2px">Remarks</div>
        <div style="font-size:14px;font-weight:500;color:var(--text-secondary)">${esc(item.remarks || '—')}</div>
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
    toast('Permission denied');
    return;
  }

  if (!confirm('Delete this expense?')) return;
  expenses = expenses.filter(e => e.serialNumber !== serial);
  save();
  renderAll();
  closeModal('detailModal');
  toast('Expense deleted');
  if (isScriptConfigured()) sendAction('delete', { serialNumber: serial });
}

// ── Member Management (Cost Sharing Members) ───────────────
function openMemberManager() {
  closeModal('settingsModal');
  renderMembersManagerList();
  openModal('membersModal');
  setTimeout(() => {
    const inp = document.getElementById('inputNewMember');
    if (inp) inp.focus();
  }, 300);
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

// ── Google Sheets Sync ─────────────────────────────────────
async function syncFromSheet() {
  if (!isScriptConfigured()) return;
  try {
    const url = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=read&t=' + Date.now();
    const res = await fetch(url, { redirect: 'follow' });
    const data = await res.json();
    if (data.status === 'success') {
      if (Array.isArray(data.data)) {
        expenses = data.data.map(r => ({
          serialNumber: parseInt(r.serialNumber) || 1,
          dateTime: r.dateTime || '',
          descriptions: r.descriptions || '',
          amount: parseFloat(r.amount) || 0,
          mode: r.mode || 'Daily Meal',
          member: r.member || '',
          remarks: r.remarks || '',
          createdBy: r.createdBy || ''
        }));
        save();
      }

      if (Array.isArray(data.users) && data.users.length > 0) {
        // Merge users while preserving local PINs if remote doesn't have them
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
        // Guarantee Rabbi is Super Admin
        const rabbi = users.find(u => u.username.toLowerCase() === 'rabbi');
        if (rabbi) rabbi.role = 'Super Admin';

        saveUsers();
        // Sync members array with active users
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
  syncFromSheet();
}

async function sendAction(action, payload) {
  if (!isScriptConfigured()) return;
  try {
    await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      redirect: 'follow'
    });
  } catch (e) {
    console.warn('Sheet action failed:', e);
  }
}

// ── Sheet Setup ────────────────────────────────────────────
function openSheetSetup() {
  if (currentUser && currentUser.role !== 'Super Admin') {
    toast('Only Super Admin can change Google Sheet settings');
    return;
  }
  document.getElementById('inputScriptUrl').value = scriptUrl;
  document.getElementById('inputSheetUrl').value = sheetUrl;
  document.getElementById('sheetTestResult').innerHTML = '';
  closeModal('settingsModal');
  openModal('sheetSetupModal');
}

async function testSheet() {
  const url = document.getElementById('inputScriptUrl').value.trim();
  const box = document.getElementById('sheetTestResult');
  if (!url) { box.innerHTML = '<div style="color:var(--danger);font-size:12px">Enter a URL first</div>'; return; }
  box.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary)">Testing...</div>';
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=ping&t=' + Date.now(), { redirect: 'follow' });
    const data = await res.json();
    if (data.status === 'success') {
      box.innerHTML = '<div style="color:var(--success);font-size:12px;font-weight:600">Connected successfully — ' + (data.totalRows || 0) + ' rows, ' + (data.userCount || 0) + ' users found</div>';
    } else {
      box.innerHTML = '<div style="color:var(--danger);font-size:12px">' + (data.message || 'Unknown error') + '</div>';
    }
  } catch (e) {
    box.innerHTML = '<div style="color:var(--danger);font-size:12px">Connection failed. Check the URL and deployment settings.</div>';
  }
}

function saveSheetSettings() {
  if (currentUser && currentUser.role !== 'Super Admin') {
    toast('Only Super Admin can save Sheet settings');
    return;
  }
  scriptUrl = document.getElementById('inputScriptUrl').value.trim();
  sheetUrl = document.getElementById('inputSheetUrl').value.trim();
  localStorage.setItem(STORE.SCRIPT, scriptUrl);
  localStorage.setItem(STORE.SHEET, sheetUrl);
  updateConnectionStatus();
  closeModal('sheetSetupModal');
  toast('Sheet settings saved');
  if (isScriptConfigured()) syncFromSheet();
}

function clearSheetSettings() {
  if (currentUser && currentUser.role !== 'Super Admin') {
    toast('Only Super Admin can reset');
    return;
  }
  if (!confirm('Reset Google Sheet connection?')) return;
  scriptUrl = FIXED_SCRIPT_URL;
  sheetUrl = FIXED_SHEET_URL;
  localStorage.removeItem(STORE.SCRIPT);
  localStorage.removeItem(STORE.SHEET);
  updateConnectionStatus();
  document.getElementById('inputScriptUrl').value = '';
  document.getElementById('inputSheetUrl').value = '';
  closeModal('sheetSetupModal');
  toast('Reset to default');
}

// ── Export ──────────────────────────────────────────────────
function exportCSV() {
  if (!expenses.length) { toast('No data to export'); return; }
  const headers = ['Serial Number', 'Date & Time', 'Descriptions', 'Amount', 'Mode', 'Member', 'Remarks', 'CreatedBy'];
  const rows = expenses.map(e => [
    e.serialNumber,
    '"' + (e.dateTime || '').replace(/"/g, '""') + '"',
    '"' + (e.descriptions || '').replace(/"/g, '""') + '"',
    e.amount,
    '"' + (e.mode || 'Daily Meal').replace(/"/g, '""') + '"',
    '"' + (e.member || '').replace(/"/g, '""') + '"',
    '"' + (e.remarks || '').replace(/"/g, '""') + '"',
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

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('open')) {
    e.target.classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
  }
});

// ── PWA Install ────────────────────────────────────
function setupPWA() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!localStorage.getItem(STORE.INSTALL)) {
      document.getElementById('installBanner').style.display = 'flex';
    }
  });
}

function installApp() {
  if (!deferredInstallPrompt) {
    toast('Open this page in Chrome or Edge to install');
    return;
  }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(r => {
    if (r.outcome === 'accepted') {
      document.getElementById('installBanner').style.display = 'none';
      toast('App installed');
    }
    deferredInstallPrompt = null;
  });
}

function dismissInstall() {
  document.getElementById('installBanner').style.display = 'none';
  localStorage.setItem(STORE.INSTALL, '1');
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg) {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => el.remove(), 200);
  }, 2500);
}

// ── Utils ──────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Google Apps Script code (embedded for copy) ────────────
function getScriptCode() {
  return `/**
 * DAILY EXPENSES TRACKER - GOOGLE APPS SCRIPT BACKEND
 */
const SHEET_NAME = 'Expenses';
const USERS_SHEET_NAME = 'Users';
const EXPENSE_HEADERS = ['Serial Number', 'Date & Time', 'Descriptions', 'Amount', 'Mode', 'Member', 'Remarks', 'CreatedBy'];
const USER_HEADERS = ['Username', 'PIN', 'Role', 'Status', 'Modes', 'CreatedAt'];

const DEFAULT_USERS = [
  ['Rabbi', '1234', 'Super Admin', 'Active', 'Both'],
  ['Nahid', '1234', 'Editor', 'Active', 'Both'],
  ['Maruf', '1234', 'Editor', 'Active', 'Both'],
  ['Nasir', '1234', 'Editor', 'Active', 'Both']
];

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME) || ss.getSheetByName('Sheet1') || ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(EXPENSE_HEADERS);
    formatHeaders(sh, EXPENSE_HEADERS.length, '#111827');
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
    DEFAULT_USERS.forEach(u => sh.appendRow([u[0], String(u[1]), u[2], u[3], u[4], nowStr]));
  }
  return sh;
}

function formatHeaders(sheet, cols, bgColor) {
  const h = sheet.getRange(1, 1, 1, cols);
  h.setBackground(bgColor).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const a = (e && e.parameter && e.parameter.action) || 'read';
    if (a === 'ping') {
      return json({ status: 'success', totalRows: Math.max(0, getSheet().getLastRow() - 1) });
    }
    if (a === 'read') {
      const sh = getSheet();
      const lr = sh.getLastRow();
      const uSh = getUsersSheet();
      const uLr = uSh.getLastRow();
      let users = [];
      if (uLr > 1) {
        users = uSh.getRange(2, 1, uLr - 1, USER_HEADERS.length).getValues().map(r => ({ username: r[0], role: r[2], status: r[3], modes: r[4] }));
      }
      if (lr <= 1) return json({ status: 'success', data: [], users, nextSerial: 1 });
      const rows = sh.getRange(2, 1, lr - 1, 8).getValues();
      let mx = 0;
      const data = rows.map((r, i) => {
        const s = parseInt(r[0]) || (i + 1);
        if (s > mx) mx = s;
        let dt = r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : String(r[1] || '');
        return { serialNumber: s, dateTime: dt, descriptions: r[2] || '', amount: parseFloat(r[3]) || 0, mode: r[4] || 'Daily Meal', member: r[5] || '', remarks: r[6] || '', createdBy: r[7] || '' };
      });
      return json({ status: 'success', data, users, nextSerial: mx + 1 });
    }
    return doAction(a, e.parameter || {});
  } catch (err) { return json({ status: 'error', message: err.toString() }); }
}

function doPost(e) {
  try {
    let p = {};
    if (e && e.postData && e.postData.contents) {
      try { p = JSON.parse(e.postData.contents); } catch (x) { p = e.parameter || {}; }
    } else if (e && e.parameter) p = e.parameter;
    return doAction(p.action || 'create', p);
  } catch (err) { return json({ status: 'error', message: err.toString() }); }
}

function doAction(action, p) {
  const sh = getSheet();
  const uSh = getUsersSheet();
  const lr = sh.getLastRow();

  if (action === 'create') {
    let s = parseInt(p.serialNumber);
    if (!s || isNaN(s)) s = lr <= 1 ? 1 : Math.max(...sh.getRange(2, 1, lr - 1, 1).getValues().map(r => parseInt(r[0]) || 0)) + 1;
    const dt = p.dateTime || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    sh.appendRow([s, dt, p.descriptions || '', parseFloat(p.amount) || 0, p.mode || 'Daily Meal', p.member || '', p.remarks || '', p.createdBy || '']);
    return json({ status: 'success', message: 'Added' });
  }

  if (action === 'update') {
    const t = parseInt(p.serialNumber);
    const srs = sh.getRange(2, 1, lr - 1, 1).getValues();
    let ri = -1;
    for (let i = 0; i < srs.length; i++) if (parseInt(srs[i][0]) === t) { ri = i + 2; break; }
    if (ri === -1) return json({ status: 'error', message: 'Not found' });
    if (p.dateTime) sh.getRange(ri, 2).setValue(p.dateTime);
    if (p.descriptions) sh.getRange(ri, 3).setValue(p.descriptions);
    if (!isNaN(parseFloat(p.amount))) sh.getRange(ri, 4).setValue(parseFloat(p.amount));
    if (p.mode) sh.getRange(ri, 5).setValue(p.mode);
    if (p.member) sh.getRange(ri, 6).setValue(p.member);
    if (p.remarks) sh.getRange(ri, 7).setValue(p.remarks);
    return json({ status: 'success', message: 'Updated' });
  }

  if (action === 'delete') {
    const t = parseInt(p.serialNumber);
    const srs = sh.getRange(2, 1, lr - 1, 1).getValues();
    let ri = -1;
    for (let i = 0; i < srs.length; i++) if (parseInt(srs[i][0]) === t) { ri = i + 2; break; }
    if (ri === -1) return json({ status: 'error', message: 'Not found' });
    sh.deleteRow(ri);
    return json({ status: 'success', message: 'Deleted' });
  }

  if (action === 'forgotPassword' || action === 'resetMyPin') {
    const username = String(p.username || '').trim();
    const newPin = String(p.newPin || '').trim();
    const uLr = uSh.getLastRow();
    if (uLr <= 1) return json({ status: 'error', message: 'User not found' });
    const rows = uSh.getRange(2, 1, uLr - 1, 1).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase() === username.toLowerCase()) {
        uSh.getRange(i + 2, 2).setValue(String(newPin));
        return json({ status: 'success', message: 'PIN reset' });
      }
    }
    return json({ status: 'error', message: 'User not found' });
  }

  return json({ status: 'error', message: 'Unknown action' });
}`;
}

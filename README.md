# Daily Expenses Tracker

A flat, minimalist, mobile-first web application for tracking shared expenses with **user authentication**, **Rabbi as Super Admin**, **dual expense modes (House Expenses & Daily Meal)**, **user-specific mode assignment**, **Forgot PIN reset**, and **fixed Google Sheets database synchronization**.

---

## Access from Anywhere via the Internet (Laptop or Mobile Phone)

Anyone can open and use this app from anywhere using just the URL. **Users do NOT need to configure or connect a database manually.**

### Deployment in 2 Minutes:
1. **Free 1-Click Hosting**:
   - Go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag and drop the `d:\Test` folder.
   - You get a public HTTPS link (e.g. `https://our-expenses.netlify.app`).
   - Or deploy to **GitHub Pages** or **Vercel**.
2. **Open on any Device**:
   - Open the link on any phone or laptop.
   - On iOS Safari: Tap **Share > Add to Home Screen**.
   - On Android Chrome: Tap the **Install** banner or **Menu > Add to Home screen**.

---

## Accounts & Access Levels

| User | Role | Modes Assigned | Default PIN |
|---|---|---|---|
| **Rabbi** | **Super Admin** | Both Modes (House + Meal) | `1234` |
| **Nahid** | **Editor** | Both Modes (House + Meal) | `1234` |
| **Maruf** | **Editor** | Both Modes (House + Meal) | `1234` |
| **Nasir** | **Editor** | Both Modes (House + Meal) | `1234` |

- **Super Admin (Rabbi)**: Has complete control. Can create/remove users, change roles (`Super Admin`, `Editor`, `Viewer`), assign mode access (`Both Modes`, `Daily Meal Only`, `House Expenses Only`), reset user PINs, edit or delete any expense, and manage settings.
- **Editor**: Can add expenses and edit or delete their own entries.
- **Viewer**: Read-only access to stats, member balances, and expenses.

---

## Key Features

### 1. Dual Expense Modes: House Expenses & Daily Meal
- Expenses are tagged as either **House Expenses** or **Daily Meal**.
- **Top Mode Filter**: Switch between **All Modes**, **Daily Meal**, and **House Expenses** at any time.
- **Smart Mode-Aware Splitting**:
  - Costs are divided strictly among members who are enrolled in that mode.
  - If a user is assigned **"Daily Meal Only"**, they will **not** be charged for House Expenses.
  - $\text{Per person cost} = \frac{\text{Total mode expenses}}{\text{Members enrolled in that mode}}$
  - $\text{Due} = \text{Per person cost} - \text{Amount paid by member}$

### 2. Admin User & Mode Management
- Accessible only by Super Admin (Rabbi) from **Settings (⚙) > User Access Levels**:
  - Add new users with a designated role, initial PIN, and mode permission dropdown (**Both Modes**, **Daily Meal Only**, or **House Expenses Only**).
  - Change existing users' mode access or role at any time.
  - Reset any user's PIN or deactivate accounts.

### 3. Forgot Password / PIN
- A **"Forgot PIN?"** link is right on the login screen.
- Allows any member to select their account and set a new PIN without needing admin intervention.
- Synchronizes with Google Sheets automatically when connected.

### 4. Built-in (Fixed) Google Sheet Backend
- **No manual sheet setup for users**: The Google Apps Script URL is embedded directly into the application in `app.js` (`FIXED_SCRIPT_URL`).
- When members open the app URL, it automatically connects to the shared Google Sheet database.

---

## Google Sheet Database Setup (One-time Setup)

1. Open a new Google Sheet at [sheets.new](https://sheets.new).
2. Go to **Extensions > Apps Script**.
3. Replace the default script with the contents of [`Code.gs`](file:///d:/Test/Code.gs) and press **Ctrl + S**.
4. Click **Deploy > New deployment**:
   - Type: **Web app**
   - Description: `Daily Expenses Backend`
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, authorize permissions, and copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).
6. Open [`d:\Test\app.js`](file:///d:/Test/app.js) and paste your URL into line 7:
   ```javascript
   const FIXED_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
   ```
7. Done! The Google Sheet will automatically generate and organize two sheets:
   - **`Expenses`**: `[Serial Number, Date & Time, Descriptions, Amount, Member, Remarks, CreatedBy, Mode]`
   - **`Users`**: `[Username, PIN, Role, Status, CreatedAt, Modes]`

---

## File Structure

```
d:\Test\
├── index.html       # Flat mobile-first shell with login, forgot PIN, mode tabs & modals
├── style.css        # Minimalist HCI design system (no emojis, dark/light modes)
├── app.js           # Auth, access control, dual mode calculations, fixed Sheets sync
├── Code.gs          # Google Apps Script backend with dual mode & dynamic headers
├── manifest.json    # PWA manifest for mobile home screen installation
└── README.md        # Comprehensive documentation
```

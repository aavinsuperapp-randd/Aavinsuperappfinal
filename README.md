# AAVIN BMC Monitoring System

A secure, real-time web application for auditing, approving, and managing BMC-related operations for AAVIN.

---

## 📁 1. Project Folder Structure

```text
/
├── index.html                  # Landing Page
├── login.html                  # Citizen/GM Login Page
├── register.html               # Registration Page (User / GM select)
├── worker.html                 # Approved Worker Dashboard Placeholder
├── gm.html                     # Approved GM Dashboard Placeholder
│
├── admin/
│   ├── login.html              # Admin Login Page (fixed credentials)
│   ├── dashboard.html          # Admin Dashboard Panel
│   └── verification.html       # Admin Verification Audit Desk
│
├── css/
│   ├── global.css              # Reset, Variables & Layout Styles
│   ├── landing.css             # Hero & Overview section layout styles
│   ├── auth.css                # Login/Register form cards
│   ├── dashboard.css           # Worker/GM Dashboard widgets
│   └── admin.css               # Sidebar navigation, Tables & Audit cells
│
├── js/
│   ├── supabase.js             # Configuration Loader & Notification alerts
│   ├── auth.js                 # Session Verification & Security Guard
│   ├── register.js             # User & GM Registration Handler
│   ├── login.js                # Portal Login Validation & Admin routing
│   ├── worker.js               # Worker specific view logic
│   ├── gm.js                   # GM specific view logic
│   └── admin.js                # Administrator verification actions
│
├── backend/
│   ├── server.js               # Express Server & Config provider
│   ├── package.json            # Node.js Express server dependencies
│   ├── .env                    # Environment credentials
│   └── .env.example            # Environment variables example
│
├── schema.sql                  # PostgreSQL profiles database structure and RLS rules
├── package.json                # Workspace execution scripts
└── README.md                   # Master Technical Documentation
```

---

## 🛠️ 2. Core Technologies

- **Frontend:** HTML5, CSS3, Vanilla ES6+ JavaScript.
- **Backend:** Node.js, Express.js.
- **Database & Services:** Supabase (Auth, Storage, PostgreSQL).

---

## 🚀 3. Getting Started

### Step 1: Install Server Dependencies
From the workspace root directory:

```bash
# Navigate to backend
cd backend

# Install dependencies (express, cors, dotenv, @supabase/supabase-js)
npm install
```

### Step 2: Configure Environment Variables
Inside `backend/.env`, populate your Supabase connection parameters:

```env
PORT=5000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
```

### Step 3: Run the Application

```bash
# From backend directory
npm run dev
```

The server launches on **`http://localhost:5000`**.

---

## 📊 4. Database Setup

1. Copy the contents of `schema.sql`.
2. Open your project on the **Supabase Dashboard**, navigate to the **SQL Editor**, and execute the script.
3. In your Supabase Dashboard, create a public Storage bucket named `profile_images` to host profile pictures.

---

## 🛡️ 5. Fixed Administrator Credentials

To access the Admin panel:
- **URL:** `http://localhost:5000/admin/login.html`
- **Email:** `admin@gmail.com`
- **Password:** `superpass123`

---

## 💡 6. Sandbox / Mock Mode
If Supabase environment variables are not yet configured in `.env`, the system automatically runs in **Mock Sandbox Mode**, allowing you to inspect:
- Successful and pending registrations
- Administrator accept/reject actions (simulated using `sessionStorage`)
- Role routing transitions

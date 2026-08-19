# 🚀 Transport Officer Portal - Quick Start Guide

## Step 1: Update Database (CRITICAL)

Open Supabase SQL Editor and run:

```sql
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
CHECK (role in ('user', 'gm', 'admin', 'transport_officer', 'driver'));
```

## Step 2: Start Backend Server

```bash
cd backend
npm start
```

Wait for: `✅ Server is live on http://localhost:5000`

## Step 3: Access Transport Officer Portal

### Option A: Use Test Account
1. Go to: `http://localhost:5000/login.html`
2. Login with: `driverdemo@gmail.com` / `123456`
3. Portal opens at: `http://localhost:5000/transport/dashboard.html`

### Option B: Create New Account
1. Go to: `http://localhost:5000/register.html`
2. Select **Driver** role (third card)
3. Fill details and register
4. Login as admin to approve: `admin@gmail.com` / `superpass123`
5. Go to Users & Approvals, approve the new account
6. Login with new account

## Step 4: Explore Features

### Dashboard
- View fleet metrics and charts
- Monitor duties and driver status

### Drivers Tab
- Click "➕ Add Driver" to create new drivers
- Click "Edit" to modify driver details
- Click "View" to see driver profile & performance

### Vehicles Tab
- Click "➕ Add Vehicle" to add vehicles
- Manage vehicle fleet
- Track vehicle usage

### Duty Tab
- View assigned duties
- Filter by date and status

### Driver Analysis Tab
- Select a driver from dropdown
- Choose date range (Today, This Week, etc.)
- Click "Analyze" to see:
  - Performance metrics
  - 4 interactive charts
  - Complete trip history

## ✅ Verification Checklist

- [ ] Database constraint updated (no "Invalid role" error)
- [ ] Backend server running on port 5000
- [ ] Can login with transport officer account
- [ ] Dashboard loads with real data
- [ ] Can add/edit/delete drivers
- [ ] Can add/edit/delete vehicles
- [ ] Charts render properly
- [ ] Search filters work

## 🐛 Troubleshooting

### "Invalid role. Must be user or gm"
➜ Run the SQL from Step 1 in Supabase

### Login works but redirects to blank page
➜ Clear browser cache and try again

### "Access Denied" after login
➜ Make sure account is approved by admin

### Backend won't start
➜ Check `.env` file has correct Supabase credentials

### No data showing in dashboard
➜ Create some test drivers/vehicles first

## 📞 Need Help?

Check `TRANSPORT_OFFICER_SETUP_COMPLETE.md` for detailed documentation.

---

**Ready to go! 🚛✨**

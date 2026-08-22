const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve static frontend files
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// Serve assets folder
const assetsPath = path.join(__dirname, '../frontend/assets');
const legacyAssetsPath = path.join(__dirname, '../assests');
app.use('/assets', express.static(assetsPath));
app.use('/assets', express.static(legacyAssetsPath));
app.use('/assests', express.static(legacyAssetsPath));

// ─── Admin Supabase Client (Service Role) ─────────────────────────────────────
// This client has full database access and bypasses RLS.
// It is ONLY used server-side and its key is NEVER sent to the browser.
function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

// Auto-create profile_images bucket if it doesn't exist
async function ensureStorageBucket() {
  const adminClient = getAdminClient();
  if (!adminClient) return;
  try {
    const { data: buckets } = await adminClient.storage.listBuckets();
    const exists = buckets && buckets.some(b => b.name === 'profile_images');
    if (!exists) {
      await adminClient.storage.createBucket('profile_images', { public: true });
      console.log('📦 Created public profile_images storage bucket.');
    }
  } catch (err) {
    // Ignore error if bucket creation fails
  }
}
ensureStorageBucket();


// ─── GET /api/config ──────────────────────────────────────────────────────────
// Returns public-safe credentials to the browser (anon key only)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// ─── POST /api/register ───────────────────────────────────────────────────────
// Creates a new Supabase Auth user without email confirmation, then inserts
// the profile row. Uses the service-role key so RLS is bypassed on insert.
app.post('/api/register', async (req, res) => {
  const { name, dob, email, password, role } = req.body;

  // Basic validation
  if (!name || !dob || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!['user', 'gm', 'driver', 'transport_officer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be user, gm, driver, or transport_officer.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return res.status(503).json({ error: 'Server database not configured.' });
  }

  try {
    // 1. Create the Auth user (auto-confirmed — no email verification needed)
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Skip email verification entirely
      user_metadata: { name, dob, role }
    });

    if (authError) {
      // Handle duplicate email gracefully
      if (authError.message.includes('already been registered') || authError.status === 422) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      throw authError;
    }

    const userId = authData.user.id;

    // 2. Insert profile (trigger may have already done it, use upsert to be safe)
    const { error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        id: userId,
        name,
        dob,
        email,
        role,
        status: 'pending',
        profile_image_url: null
      }, { onConflict: 'id' });

    if (profileError) throw profileError;

    // Automatically add to TO's drivers list if role is driver
    if (role === 'driver') {
      // Check if driver already exists to avoid duplicates
      const { data: existingDriver } = await adminClient
        .from('drivers')
        .select('id')
        .eq('name', name)
        .maybeSingle();
        
      if (!existingDriver) {
        await adminClient.from('drivers').insert({
          name: name,
          phone: '',
          license_number: '',
          is_active: false // Requires approval/activation by TO
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Registration submitted. Awaiting administrator approval.'
    });

  } catch (err) {
    console.error('❌ Registration error:', err.message);
    return res.status(500).json({ error: err.message || 'Registration failed.' });
  }
});

// ─── POST /api/approve ────────────────────────────────────────────────────────
// Admin-only: updates a profile's status. Authenticated via Supabase JWT.
app.post('/api/approve', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const { userId, newStatus } = req.body;

  if (!userId || !newStatus) return res.status(400).json({ error: 'userId and newStatus required.' });
  if (!['approved', 'rejected'].includes(newStatus)) return res.status(400).json({ error: 'Invalid status.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server database not configured.' });

  // Verify the caller is admin
  const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized.' });

  const { data: callerProfile } = await adminClient
    .from('profiles').select('role').eq('id', user.id).single();

  if (!callerProfile || callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }

  const { error } = await adminClient
    .from('profiles')
    .update({ status: newStatus, updated_at: new Date() })
    .eq('id', userId);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ─── ADMIN ROLE MIDDLEWARE ───────────────────────────────────────────────────
async function requireAdminRole(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server database not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient.from('profiles').select('*').eq('id', user.id).single();
  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

// ─── ADMIN USERS ENDPOINTS ───────────────────────────────────────────────────
app.get('/api/admin/users', requireAdminRole, async (req, res) => {
  const { data: profiles, error } = await req.adminClient
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: profiles || [] });
});

app.delete('/api/admin/users/all', requireAdminRole, async (req, res) => {
  const { error } = await req.adminClient
    .from('profiles')
    .delete()
    .neq('role', 'admin');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'All non-admin users deleted successfully.' });
});

app.delete('/api/admin/users/:id', requireAdminRole, async (req, res) => {
  const userId = req.params.id;
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete current logged-in admin user.' });
  }

  const { error } = await req.adminClient
    .from('profiles')
    .delete()
    .eq('id', userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'User profile deleted successfully.' });
});

// ─── ADMIN DRIVERS ENDPOINTS ─────────────────────────────────────────────────
app.get('/api/admin/drivers', requireAdminRole, async (req, res) => {
  const { data: drivers, error } = await req.adminClient
    .from('drivers')
    .select('*')
    .order('name');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ drivers: drivers || [] });
});

app.post('/api/admin/drivers', requireAdminRole, async (req, res) => {
  const { name, phone, license_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Driver name is required.' });

  const { data, error } = await req.adminClient
    .from('drivers')
    .insert({ name, phone, license_number, is_active: true })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ driver: data });
});

app.put('/api/admin/drivers/:id/toggle', requireAdminRole, async (req, res) => {
  const { is_active } = req.body;
  const { data, error } = await req.adminClient
    .from('drivers')
    .update({ is_active, updated_at: new Date() })
    .eq('id', req.params.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ driver: data });
});

app.delete('/api/admin/drivers/all', requireAdminRole, async (req, res) => {
  const { adminClient } = req;
  try {
    await adminClient.from('trips').update({ driver_id: null }).not('driver_id', 'is', null);
    await adminClient.from('driver_trips').update({ assigned_driver_id: null }).not('assigned_driver_id', 'is', null);
    const { error } = await adminClient.from('drivers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: 'All drivers removed successfully. Historical trip records preserved.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete drivers.' });
  }
});

app.delete('/api/admin/drivers/:id', requireAdminRole, async (req, res) => {
  const { adminClient } = req;
  const driverId = req.params.id;
  try {
    // Unlink driver from historical trips to prevent foreign key error while keeping trip records intact
    await adminClient.from('trips').update({ driver_id: null }).eq('driver_id', driverId);
    await adminClient.from('driver_trips').update({ assigned_driver_id: null }).eq('assigned_driver_id', driverId);

    const { error } = await adminClient.from('drivers').delete().eq('id', driverId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: 'Driver deleted successfully. Historical trip records preserved.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete driver.' });
  }
});

// ─── ADMIN TANKERS/VEHICLES ENDPOINTS ──────────────────────────────────────
app.get('/api/admin/tankers', requireAdminRole, async (req, res) => {
  const { data: tankers, error } = await req.adminClient
    .from('tankers')
    .select('*')
    .order('board_number');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ tankers: tankers || [] });
});

app.post('/api/admin/tankers', requireAdminRole, async (req, res) => {
  const { board_number, capacity_liters } = req.body;
  if (!board_number) return res.status(400).json({ error: 'Vehicle board number is required.' });

  const { data, error } = await req.adminClient
    .from('tankers')
    .insert({ board_number, capacity_liters: capacity_liters || 5000, is_active: true })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ tanker: data });
});

app.put('/api/admin/tankers/:id/toggle', requireAdminRole, async (req, res) => {
  const { is_active } = req.body;
  const { data, error } = await req.adminClient
    .from('tankers')
    .update({ is_active, updated_at: new Date() })
    .eq('id', req.params.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ tanker: data });
});

app.delete('/api/admin/tankers/all', requireAdminRole, async (req, res) => {
  const { error } = await req.adminClient.from('tankers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'All vehicles removed successfully.' });
});

app.delete('/api/admin/tankers/:id', requireAdminRole, async (req, res) => {
  const { error } = await req.adminClient.from('tankers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'Vehicle deleted successfully.' });
});

// ─── ADMIN TRIPS ENDPOINTS ───────────────────────────────────────────────────
app.get('/api/admin/trips', requireAdminRole, async (req, res) => {
  try {
    const [tripsRes, visitsRes, profilesRes, bmcsRes, ftirRes, gerberRes] = await Promise.all([
      req.adminClient.from('trips').select('*').neq('status', 'deleted').order('created_at', { ascending: false }),
      req.adminClient.from('trip_bmc_visits').select('*').order('visit_sequence'),
      req.adminClient.from('profiles').select('id, name, email'),
      req.adminClient.from('bmcs').select('id, name, district'),
      req.adminClient.from('ftir_tests').select('*'),
      req.adminClient.from('gerber_tests').select('*')
    ]);

    const trips = tripsRes.data || [];
    const visits = visitsRes.data || [];
    const profiles = profilesRes.data || [];
    const bmcs = bmcsRes.data || [];
    const ftirs = ftirRes.data || [];
    const gerbers = gerberRes.data || [];

    const profileMap = {};
    profiles.forEach(p => profileMap[p.id] = p.name);
    const bmcMap = {};
    bmcs.forEach(b => bmcMap[b.id] = b.name);

    const enrichedTrips = trips.map(t => {
      const tVisits = visits.filter(v => v.trip_id === t.id);
      const formattedVisits = tVisits.map((v, idx, arr) => {
        const bmcName = bmcMap[v.bmc_id] || 'Unknown BMC';
        const previousOccurrences = arr.slice(0, idx).filter(prev => prev.bmc_id === v.bmc_id);
        const isAfterMixing = v.is_after_mixing || previousOccurrences.length >= 1 || (v.remarks && v.remarks.includes('[AFTER MIXING]'));
        const displayName = isAfterMixing ? `${bmcName} (After Mixing)` : bmcName;

        const ftir = ftirs.find(f => f.visit_id === v.id);
        const gerber = gerbers.find(g => g.visit_id === v.id);

        let ftir_result = '—';
        if (ftir) {
          const resText = (ftir.overall_result || '').toLowerCase();
          const extra = resText && resText !== 'pass' ? ` [${resText.toUpperCase()}]` : '';
          ftir_result = `FAT: ${ftir.fat || 0}%, SNF: ${ftir.snf || 0}%${extra}`;
        } else if (v.status === 'completed') {
          ftir_result = 'Not Tested';
        } else {
          ftir_result = 'Pending';
        }

        let gerber_result = '—';
        if (gerber) {
          const resText = (gerber.overall_result || '').toLowerCase();
          const extra = resText && resText !== 'pass' ? ` [${resText.toUpperCase()}]` : '';
          gerber_result = `FAT: ${gerber.fat_percentage || 0}%, SNF: ${gerber.snf || 0}%${extra}`;
        } else if (v.status === 'completed') {
          gerber_result = 'Not Tested';
        } else {
          gerber_result = 'Pending';
        }

        return {
          id: v.id,
          visit_sequence: v.visit_sequence || (idx + 1),
          bmc_name: displayName,
          milk_quantity_liters: v.milk_quantity_liters,
          milk_quantity_formatted: v.milk_quantity_liters ? `${v.milk_quantity_liters} kg` : '—',
          status: v.status || 'pending',
          ftir_result,
          gerber_result
        };
      });

      const routeNames = formattedVisits.map(v => v.bmc_name).join(' → ');

      return {
        ...t,
        worker_name: profileMap[t.worker_id] || 'Unknown Worker',
        route: routeNames || 'No BMCs visited yet',
        visits: formattedVisits
      };
    });

    res.json({ trips: enrichedTrips });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch trips.' });
  }
});

app.delete('/api/admin/trips/all', requireAdminRole, async (req, res) => {
  const { error } = await req.adminClient.from('trips').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'All trip records deleted successfully.' });
});

app.delete('/api/admin/trips/:id', requireAdminRole, async (req, res) => {
  const { error } = await req.adminClient.from('trips').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'Trip deleted successfully.' });
});

// ─── ADMIN / GM BMCS DELETE ENDPOINTS ───────────────────────────────────────
app.delete('/api/admin/bmcs/all', requireGm, async (req, res) => {
  const { error } = await req.adminClient.from('bmcs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'All BMC records deleted successfully.' });
});

app.delete('/api/admin/bmcs/:id', requireGm, async (req, res) => {
  const { error } = await req.adminClient.from('bmcs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'BMC deleted successfully.' });
});

// ─── JWT Auth Middleware ──────────────────────────────────────────────────────
// Verifies Supabase JWT and attaches user + profile to req
async function requireWorker(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (profile.role !== 'user') return res.status(403).json({ error: 'Worker access required.' });
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Account not yet approved.' });

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

// ─── GM JWT Middleware ────────────────────────────────────────────────────────
async function requireGm(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (profile.role !== 'gm' && profile.role !== 'admin') {
    return res.status(403).json({ error: 'GM access required.' });
  }
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Account not yet approved.' });

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

function formatDurationMs(ms) {
  if (ms === null || ms === undefined || isNaN(ms) || ms < 0) return 'N/A';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

// ─── GET /api/gm/dashboard (LAST 7 DAYS FIXED) ───────────────────────────────
app.get('/api/gm/dashboard', requireGm, async (req, res) => {
  const { adminClient } = req;

  // Calculate Last 7 Days Range (Today - 6 previous days = 7 calendar days)
  const endDateObj = new Date();
  const startDateObj = new Date();
  startDateObj.setDate(startDateObj.getDate() - 6);
  startDateObj.setHours(0, 0, 0, 0);

  const startIso = startDateObj.toISOString();
  const endIso = endDateObj.toISOString();

  const startFormatted = startDateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const endFormatted = endDateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  try {
    const { data: trips } = await adminClient
      .from('trips')
      .select('*')
      .gte('created_at', startIso)
      .lte('created_at', endIso);

    const tripList = trips || [];
    const total_trips = tripList.length;
    const completed_trips = tripList.filter(t => t.status === 'completed').length;
    const active_trips = tripList.filter(t => t.status === 'active').length;

    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*')
      .gte('created_at', startIso)
      .lte('created_at', endIso);

    const visitList = visits || [];
    const total_bmc_visits = visitList.length;
    const visitIds = visitList.map(v => v.id);

    let ftirList = [];
    if (visitIds.length > 0) {
      const { data: ftirs } = await adminClient.from('ftir_tests').select('*').in('visit_id', visitIds);
      ftirList = ftirs || [];
    }

    const total_ftir = ftirList.length;
    const ftir_pass = ftirList.filter(f => (f.overall_result || '').toLowerCase() === 'pass').length;
    const ftir_warning = ftirList.filter(f => (f.overall_result || '').toLowerCase() === 'warning').length;
    const ftir_fail = ftirList.filter(f => (f.overall_result || '').toLowerCase() === 'fail').length;

    let gerberList = [];
    if (visitIds.length > 0) {
      const { data: gerbers } = await adminClient.from('gerber_tests').select('*').in('visit_id', visitIds);
      gerberList = gerbers || [];
    }

    const total_gerber = gerberList.length;
    const gerber_pass = gerberList.filter(g => (g.overall_result || '').toLowerCase() === 'pass').length;
    const gerber_warning = gerberList.filter(g => (g.overall_result || '').toLowerCase() === 'warning').length;
    const gerber_fail = gerberList.filter(g => (g.overall_result || '').toLowerCase() === 'fail').length;

    let issueList = [];
    if (visitIds.length > 0) {
      const { data: issues } = await adminClient.from('bmc_issues').select('*').in('visit_id', visitIds);
      issueList = issues || [];
    }

    const total_issues = issueList.length;
    const high_critical_issues = issueList.filter(i => ['high', 'critical'].includes((i.severity || '').toLowerCase())).length;
    const pending_corrections = high_critical_issues;

    const issue_categories = {};
    issueList.forEach(iss => {
      const cat = iss.category || 'uncategorized';
      issue_categories[cat] = (issue_categories[cat] || 0) + 1;
    });

    let ratingList = [];
    if (visitIds.length > 0) {
      const { data: ratings } = await adminClient.from('bmc_ratings').select('*').in('visit_id', visitIds);
      ratingList = ratings || [];
    }

    const { data: bmcsData } = await adminClient.from('bmcs').select('id, name, district, location');

    const daily_trends = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      const dayTrips = tripList.filter(t => (t.created_at || '').startsWith(dateStr)).length;
      const dayVisits = visitList.filter(v => (v.created_at || '').startsWith(dateStr)).length;
      const dayIssues = issueList.filter(iss => (iss.created_at || '').startsWith(dateStr)).length;

      daily_trends.push({
        date: dateStr,
        label: dayLabel,
        trips: dayTrips,
        visits: dayVisits,
        issues: dayIssues
      });
    }

    const bmcVisitCounts = {};
    visitList.forEach(v => {
      bmcVisitCounts[v.bmc_id] = (bmcVisitCounts[v.bmc_id] || 0) + 1;
    });

    const bmcIssueCounts = {};
    visitList.forEach(v => {
      const vIssues = issueList.filter(i => i.visit_id === v.id).length;
      if (vIssues > 0) {
        bmcIssueCounts[v.bmc_id] = (bmcIssueCounts[v.bmc_id] || 0) + vIssues;
      }
    });

    const bmcRatingSums = {};
    const bmcRatingCounts = {};
    visitList.forEach(v => {
      const vRatings = ratingList.filter(r => r.visit_id === v.id);
      vRatings.forEach(r => {
        const val = Number(r.overall_rating || r.behaviour || 5);
        bmcRatingSums[v.bmc_id] = (bmcRatingSums[v.bmc_id] || 0) + val;
        bmcRatingCounts[v.bmc_id] = (bmcRatingCounts[v.bmc_id] || 0) + 1;
      });
    });

    const bmcStatsList = (bmcsData || []).map(b => {
      const visitsCount = bmcVisitCounts[b.id] || 0;
      const issuesCount = bmcIssueCounts[b.id] || 0;
      const ratingCount = bmcRatingCounts[b.id] || 0;
      const avgRating = ratingCount > 0 ? Number((bmcRatingSums[b.id] / ratingCount).toFixed(1)) : null;
      return {
        id: b.id,
        name: b.name,
        district: b.district,
        location: b.location,
        visitsCount,
        issuesCount,
        avgRating
      };
    });

    const most_visited = [...bmcStatsList].sort((a, b) => b.visitsCount - a.visitsCount).slice(0, 5);
    const most_issues = [...bmcStatsList].filter(b => b.issuesCount > 0).sort((a, b) => b.issuesCount - a.issuesCount).slice(0, 5);
    const ratedBmcs = bmcStatsList.filter(b => b.avgRating !== null);
    const top_rated = [...ratedBmcs].sort((a, b) => b.avgRating - a.avgRating).slice(0, 5);
    const lowest_rated = [...ratedBmcs].sort((a, b) => a.avgRating - b.avgRating).slice(0, 5);

    res.json({
      period: {
        start: startIso.slice(0, 10),
        end: endIso.slice(0, 10),
        startFormatted,
        endFormatted,
        label: `LAST 7 DAYS (${startFormatted} - ${endFormatted})`
      },
      kpis: {
        total_trips,
        completed_trips,
        active_trips,
        total_bmc_visits,
        total_ftir,
        total_gerber,
        total_issues,
        pending_corrections
      },
      quality_summary: {
        ftir: { pass: ftir_pass, warning: ftir_warning, fail: ftir_fail },
        gerber: { pass: gerber_pass, warning: gerber_warning, fail: gerber_fail }
      },
      issue_summary: {
        total: total_issues,
        high_critical: high_critical_issues,
        categories: issue_categories
      },
      daily_trends,
      bmc_rankings: {
        top_rated,
        lowest_rated,
        most_visited,
        most_issues
      }
    });

  } catch (err) {
    console.error('❌ GM Dashboard Error:', err);
    res.status(500).json({ error: err.message || 'Failed to calculate GM Dashboard metrics.' });
  }
});

// ─── GET /api/gm/dashboard-v2 (SINGLE-DATE COMPREHENSIVE DASHBOARD) ──────────
app.get('/api/gm/dashboard-v2', requireGm, async (req, res) => {
  const { adminClient } = req;
  const dateParam = req.query.date; // YYYY-MM-DD or empty for today

  // Calculate date range for the selected day
  let targetDate;
  if (dateParam) {
    targetDate = new Date(dateParam + 'T00:00:00');
  } else {
    targetDate = new Date();
  }
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = dayEnd.toISOString();

  // Also calculate last 7 days for trend charts
  const trendStart = new Date(targetDate);
  trendStart.setDate(trendStart.getDate() - 6);
  trendStart.setHours(0, 0, 0, 0);
  const trendStartIso = trendStart.toISOString();

  try {
    // ── Parallel fetch: all entity lists + day-specific data ──
    const [
      tripsRes, trendTripsRes, visitsRes,
      profilesRes, driversRes, tankersRes, bmcsRes
    ] = await Promise.all([
      // Trips for selected date
      adminClient.from('trips').select('*').neq('status', 'deleted').gte('created_at', dayStartIso).lte('created_at', dayEndIso).order('created_at', { ascending: false }),
      // Trips for last 7 days (for trend)
      adminClient.from('trips').select('id, status, created_at').gte('created_at', trendStartIso).lte('created_at', dayEndIso),
      // All BMC visits
      adminClient.from('trip_bmc_visits').select('*').order('visit_sequence'),
      // All profiles (workers/GMs)
      adminClient.from('profiles').select('id, name, email, role, status, profile_image_url'),
      // All drivers
      adminClient.from('drivers').select('*').order('name'),
      // All tankers
      adminClient.from('tankers').select('*').order('board_number'),
      // All BMCs
      adminClient.from('bmcs').select('*').order('name')
    ]);

    const tripList = tripsRes.data || [];
    const trendTripList = trendTripsRes.data || [];
    const visitList = visitsRes.data || [];
    const profilesList = profilesRes.data || [];
    const driversList = driversRes.data || [];
    const tankersList = tankersRes.data || [];
    const bmcsList = bmcsRes.data || [];

    // Build lookup maps
    const profileMap = {};
    profilesList.forEach(p => profileMap[p.id] = p);
    const bmcMap = {};
    bmcsList.forEach(b => bmcMap[b.id] = b);

    // ── KPIs ──
    const total_trips = tripList.length;
    const active_trips = tripList.filter(t => t.status === 'active').length;
    const completed_trips = tripList.filter(t => t.status === 'completed').length;
    const total_bmc_visits = visitList.length;

    let total_milk_liters = 0;
    visitList.forEach(v => {
      if (v.milk_quantity_liters) total_milk_liters += Number(v.milk_quantity_liters);
    });

    // ── Fetch test data, issues, ratings for visits ──
    const visitIds = visitList.map(v => v.id);
    let ftirList = [], gerberList = [], issueList = [], ratingList = [];
    if (visitIds.length > 0) {
      const [fRes, gRes, iRes, rRes] = await Promise.all([
        adminClient.from('ftir_tests').select('*').in('visit_id', visitIds),
        adminClient.from('gerber_tests').select('*').in('visit_id', visitIds),
        adminClient.from('bmc_issues').select('*').in('visit_id', visitIds),
        adminClient.from('bmc_ratings').select('*').in('visit_id', visitIds)
      ]);
      ftirList = fRes.data || [];
      gerberList = gRes.data || [];
      issueList = iRes.data || [];
      ratingList = rRes.data || [];
    }

    // Also fetch ALL open issues (not date-limited) for complaints section
    const { data: allOpenIssues } = await adminClient
      .from('bmc_issues')
      .select('*, visit:trip_bmc_visits(bmc_id, trip_id, trip:trips(worker_id))')
      .order('created_at', { ascending: false })
      .limit(100);

    const formattedIssues = (allOpenIssues || []).map(i => {
      const bmcId = i.visit?.bmc_id;
      const workerId = i.visit?.trip?.worker_id;
      return {
        id: i.id,
        category: i.category,
        severity: i.severity,
        description: i.description,
        image_url: i.image_url,
        remarks: i.remarks || '',
        status: i.status || 'pending',
        created_at: i.created_at,
        bmc_name: bmcId && bmcMap[bmcId] ? bmcMap[bmcId].name : 'Unknown BMC',
        worker_name: workerId && profileMap[workerId] ? profileMap[workerId].name : 'Unknown Worker'
      };
    });

    // ── Enrich trips with worker, visits, test counts ──
    const enrichedTrips = tripList.map(t => {
      const tVisits = visitList.filter(v => v.trip_id === t.id);
      const tVisitIds = tVisits.map(v => v.id);
      const tFtir = ftirList.filter(f => tVisitIds.includes(f.visit_id)).length;
      const tGerber = gerberList.filter(g => tVisitIds.includes(g.visit_id)).length;
      const tIssues = issueList.filter(i => tVisitIds.includes(i.visit_id)).length;

      let duration_ms = null;
      if (t.out_time && t.in_time) {
        const outMs = new Date(t.out_time).getTime();
        const inMs = new Date(t.in_time).getTime();
        if (inMs >= outMs) duration_ms = inMs - outMs;
      }

      const worker = profileMap[t.worker_id] || { name: 'Unknown Worker' };
      const lastVisit = tVisits.length > 0 ? tVisits[tVisits.length - 1] : null;
      const lastBmc = lastVisit && bmcMap[lastVisit.bmc_id] ? bmcMap[lastVisit.bmc_id].name : '—';

      const formattedVisits = tVisits
        .sort((a, b) => (a.visit_sequence || 0) - (b.visit_sequence || 0))
        .map((v, idx, arr) => {
          const bmcName = (bmcMap[v.bmc_id] && bmcMap[v.bmc_id].name) || 'Unknown BMC';
          const previousOccurrences = arr.slice(0, idx).filter(prev => prev.bmc_id === v.bmc_id);
          const isAfterMixing = v.is_after_mixing || previousOccurrences.length >= 1 || (v.remarks && v.remarks.includes('[AFTER MIXING]'));
          const displayName = isAfterMixing ? `${bmcName} (After Mixing)` : bmcName;

          const ftir = ftirList.find(f => f.visit_id === v.id);
          const gerber = gerberList.find(g => g.visit_id === v.id);

          let ftir_result = '—';
          if (ftir) {
            const resText = (ftir.overall_result || '').toLowerCase();
            const extra = resText && resText !== 'pass' ? ` [${resText.toUpperCase()}]` : '';
            ftir_result = `FAT: ${ftir.fat || 0}%, SNF: ${ftir.snf || 0}%${extra}`;
          } else if (v.status === 'completed') {
            ftir_result = 'Not Tested';
          } else {
            ftir_result = 'Pending';
          }

          let gerber_result = '—';
          if (gerber) {
            const resText = (gerber.overall_result || '').toLowerCase();
            const extra = resText && resText !== 'pass' ? ` [${resText.toUpperCase()}]` : '';
            gerber_result = `FAT: ${gerber.fat_percentage || 0}%, SNF: ${gerber.snf || 0}%${extra}`;
          } else if (v.status === 'completed') {
            gerber_result = 'Not Tested';
          } else {
            gerber_result = 'Pending';
          }

          return {
            id: v.id,
            visit_sequence: v.visit_sequence || (idx + 1),
            bmc_id: v.bmc_id,
            bmc_name: displayName,
            milk_quantity_liters: v.milk_quantity_liters,
            milk_quantity_formatted: v.milk_quantity_liters ? `${v.milk_quantity_liters} kg` : '—',
            status: v.status || 'pending',
            ftir_result,
            gerber_result
          };
        });

      const visitBmcNames = formattedVisits.map(v => v.bmc_name).join(' → ');

      return {
        id: t.id,
        trip_name: t.trip_name,
        worker_id: t.worker_id,
        worker_name: worker.name,
        driver_name: t.driver_name,
        tanker_number: t.tanker_number,
        out_time: t.out_time,
        in_time: t.in_time,
        status: t.status,
        created_at: t.created_at,
        visits_count: tVisits.length,
        ftir_count: tFtir,
        gerber_count: tGerber,
        issues_count: tIssues,
        duration_ms,
        duration_formatted: formatDurationMs(duration_ms),
        last_bmc: lastBmc,
        route: visitBmcNames || '—',
        visits: formattedVisits
      };
    });

    // ── Daily trends (last 7 days) ──
    const daily_trends = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(targetDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const dayTrips = trendTripList.filter(t => (t.created_at || '').startsWith(dateStr)).length;
      daily_trends.push({ date: dateStr, label: dayLabel, trips: dayTrips });
    }

    // ── Workers with current trip status ──
    const workers = profilesList
      .filter(p => p.role === 'user' && p.status === 'approved')
      .map(p => {
        const workerTrips = tripList.filter(t => t.worker_id === p.id);
        const activeTrip = workerTrips.find(t => t.status === 'active');
        return {
          id: p.id,
          name: p.name,
          email: p.email,
          status: p.status,
          profile_image_url: p.profile_image_url,
          current_trip: activeTrip ? {
            id: activeTrip.id,
            trip_name: activeTrip.trip_name,
            driver_name: activeTrip.driver_name,
            tanker_number: activeTrip.tanker_number,
            out_time: activeTrip.out_time,
            status: activeTrip.status
          } : null,
          trips_today: workerTrips.length
        };
      });

    res.json({
      date: dayStart.toISOString().slice(0, 10),
      date_formatted: targetDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      kpis: {
        total_trips,
        active_trips,
        completed_trips,
        total_bmc_visits,
        total_milk_liters: Math.round(total_milk_liters)
      },
      trips: enrichedTrips,
      workers,
      drivers: driversList,
      tankers: tankersList,
      bmcs: bmcsList,
      issues: formattedIssues,
      daily_trends
    });

  } catch (err) {
    console.error('❌ GM Dashboard V2 Error:', err);
    res.status(500).json({ error: err.message || 'Failed to load GM Dashboard data.' });
  }
});

// ─── POST /api/gm/create-bmc (GM BMC CREATION) ───────────────────────────────
app.post('/api/gm/create-bmc', requireGm, async (req, res) => {
  const { adminClient } = req;
  const { name, district, location, contact_number, latitude, longitude, profile_image_url, total_capacity, silos } = req.body;

  if (!name || !district || !location || !contact_number) {
    return res.status(400).json({ error: 'Name, district, location, and contact number are required.' });
  }
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null || latitude === '' || longitude === '') {
    return res.status(400).json({ error: 'GPS coordinates (latitude and longitude) are required.' });
  }

  try {
    const { data: existing } = await adminClient
      .from('bmcs')
      .select('id')
      .ilike('name', name.trim())
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'A BMC with this name already exists.' });
    }

    const bmcPayload = {
      name: name.trim(),
      district: district.trim(),
      location: location.trim(),
      contact_number: contact_number.trim(),
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      profile_image_url: profile_image_url || null,
      is_active: true
    };
    if (total_capacity !== undefined && total_capacity !== null) {
      bmcPayload.total_capacity = parseFloat(total_capacity) || 0;
    }

    let data = null;
    let error = null;

    const result = await adminClient.from('bmcs').insert(bmcPayload).select();

    if (result.error) {
      if (result.error.code === '42703' || (result.error.message && result.error.message.includes('total_capacity'))) {
        const retryPayload = { ...bmcPayload };
        delete retryPayload.total_capacity;
        const retryResult = await adminClient.from('bmcs').insert(retryPayload).select();
        data = retryResult.data ? retryResult.data[0] : null;
        error = retryResult.error;
      } else {
        error = result.error;
      }
    } else {
      data = result.data ? result.data[0] : null;
    }

    if (error) throw error;

    let insertedSilos = [];
    if (Array.isArray(silos) && silos.length > 0 && data?.id) {
      try {
        const silosToInsert = silos.map((s, idx) => ({
          bmc_id: data.id,
          silo_number: idx + 1,
          silo_name: `Silo ${idx + 1}`,
          capacity_kg: parseFloat(s.capacity_kg) || 0
        }));
        const { data: sData } = await adminClient
          .from('bmc_silos')
          .insert(silosToInsert)
          .select();
        insertedSilos = sData || [];
      } catch (sErr) {
        console.warn('⚠️ Silo insertion skipped/failed:', sErr.message);
      }
    }

    res.status(201).json({ bmc: { ...data, silos: insertedSilos } });
  } catch (err) {
    console.error('❌ GM Create BMC error:', err);
    res.status(500).json({ error: err.message || 'Failed to create BMC.' });
  }
});


// ─── GET /api/gm/analysis (VEHICLE / DRIVER / WORKER DEEP ANALYSIS) ─────────
app.get('/api/gm/analysis', requireGm, async (req, res) => {
  const { adminClient } = req;
  const { type = 'vehicle', entityId = '', startDate, endDate } = req.query;

  let startIso, endIso;
  if (startDate && endDate) {
    startIso = new Date(startDate).toISOString();
    const endD = new Date(endDate);
    endD.setHours(23, 59, 59, 999);
    endIso = endD.toISOString();
  } else {
    const endD = new Date();
    const startD = new Date();
    startD.setDate(startD.getDate() - 6);
    startD.setHours(0, 0, 0, 0);
    startIso = startD.toISOString();
    endIso = endD.toISOString();
  }

  try {
    const { data: trips } = await adminClient
      .from('trips')
      .select('*')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    const tripList = trips || [];
    const tripIds = tripList.map(t => t.id);

    let visitList = [];
    if (tripIds.length > 0) {
      const { data: visits } = await adminClient.from('trip_bmc_visits').select('*').in('trip_id', tripIds);
      visitList = visits || [];
    }

    const visitIds = visitList.map(v => v.id);

    let ftirList = [], gerberList = [], issueList = [], ratingList = [];
    if (visitIds.length > 0) {
      const [fRes, gRes, iRes, rRes] = await Promise.all([
        adminClient.from('ftir_tests').select('*').in('visit_id', visitIds),
        adminClient.from('gerber_tests').select('*').in('visit_id', visitIds),
        adminClient.from('bmc_issues').select('*').in('visit_id', visitIds),
        adminClient.from('bmc_ratings').select('*').in('visit_id', visitIds)
      ]);
      ftirList = fRes.data || [];
      gerberList = gRes.data || [];
      issueList = iRes.data || [];
      ratingList = rRes.data || [];
    }

    const { data: profiles } = await adminClient.from('profiles').select('id, name, email');
    const profileMap = {};
    (profiles || []).forEach(p => profileMap[p.id] = p);

    const { data: bmcs } = await adminClient.from('bmcs').select('id, name, district, location');
    const bmcMap = {};
    (bmcs || []).forEach(b => bmcMap[b.id] = b);

    const enrichedTrips = tripList.map(t => {
      const tVisits = visitList.filter(v => v.trip_id === t.id);
      const tVisitIds = tVisits.map(v => v.id);
      const tFtir = ftirList.filter(f => tVisitIds.includes(f.visit_id)).length;
      const tGerber = gerberList.filter(g => tVisitIds.includes(g.visit_id)).length;
      const tIssues = issueList.filter(i => tVisitIds.includes(i.visit_id)).length;

      let duration_ms = null;
      if (t.out_time && t.in_time) {
        const outMs = new Date(t.out_time).getTime();
        const inMs = new Date(t.in_time).getTime();
        if (inMs >= outMs) duration_ms = inMs - outMs;
      }

      const workerObj = profileMap[t.worker_id] || { name: 'Unknown Worker' };

      return {
        ...t,
        worker_name: workerObj.name,
        visits_count: tVisits.length,
        ftir_count: tFtir,
        gerber_count: tGerber,
        issues_count: tIssues,
        duration_ms,
        duration_formatted: formatDurationMs(duration_ms)
      };
    });

    let aggregatedResults = [];

    if (type === 'vehicle') {
      const vehicleMap = {};
      enrichedTrips.forEach(t => {
        const tanker = (t.tanker_number || 'UNKNOWN').trim().toUpperCase();
        if (!vehicleMap[tanker]) {
          vehicleMap[tanker] = {
            id: tanker,
            name: tanker,
            board_number: tanker,
            total_trips: 0,
            total_visits: 0,
            durations: [],
            out_times: [],
            in_times: [],
            drivers_set: new Set(),
            workers_set: new Set(),
            trips: []
          };
        }

        const v = vehicleMap[tanker];
        v.total_trips += 1;
        v.total_visits += t.visits_count;
        if (t.duration_ms !== null) v.durations.push(t.duration_ms);
        if (t.out_time) v.out_times.push(new Date(t.out_time).getTime());
        if (t.in_time) v.in_times.push(new Date(t.in_time).getTime());
        if (t.driver_name) v.drivers_set.add(t.driver_name);
        if (t.worker_name) v.workers_set.add(t.worker_name);
        v.trips.push(t);
      });

      aggregatedResults = Object.values(vehicleMap).map(v => {
        const totalDurationMs = v.durations.reduce((acc, curr) => acc + curr, 0);
        const avgDurationMs = v.durations.length > 0 ? Math.round(totalDurationMs / v.durations.length) : null;
        const minDurationMs = v.durations.length > 0 ? Math.min(...v.durations) : null;
        const maxDurationMs = v.durations.length > 0 ? Math.max(...v.durations) : null;
        const firstTripMs = v.out_times.length > 0 ? Math.min(...v.out_times) : null;
        const lastTripMs = v.out_times.length > 0 ? Math.max(...v.out_times) : null;

        return {
          id: v.id,
          name: v.name,
          board_number: v.board_number,
          total_trips: v.total_trips,
          total_visits: v.total_visits,
          avg_bmcs_per_trip: Number((v.total_visits / (v.total_trips || 1)).toFixed(1)),
          completed_durations_count: v.durations.length,
          total_duration_ms: totalDurationMs,
          total_duration_formatted: formatDurationMs(totalDurationMs),
          avg_duration_ms: avgDurationMs,
          avg_duration_formatted: formatDurationMs(avgDurationMs),
          min_duration_formatted: formatDurationMs(minDurationMs),
          max_duration_formatted: formatDurationMs(maxDurationMs),
          first_trip_time: firstTripMs ? new Date(firstTripMs).toLocaleString() : '—',
          last_trip_time: lastTripMs ? new Date(lastTripMs).toLocaleString() : '—',
          associated_drivers: Array.from(v.drivers_set),
          associated_workers: Array.from(v.workers_set),
          trips: v.trips
        };
      });

    } else if (type === 'driver') {
      const driverMap = {};
      enrichedTrips.forEach(t => {
        const driver = (t.driver_name || 'UNKNOWN').trim();
        if (!driverMap[driver]) {
          driverMap[driver] = {
            id: driver,
            name: driver,
            driver_name: driver,
            total_trips: 0,
            total_visits: 0,
            durations: [],
            out_times: [],
            in_times: [],
            tankers_set: new Set(),
            workers_set: new Set(),
            trips: []
          };
        }

        const d = driverMap[driver];
        d.total_trips += 1;
        d.total_visits += t.visits_count;
        if (t.duration_ms !== null) d.durations.push(t.duration_ms);
        if (t.out_time) d.out_times.push(new Date(t.out_time).getTime());
        if (t.in_time) d.in_times.push(new Date(t.in_time).getTime());
        if (t.tanker_number) d.tankers_set.add(t.tanker_number);
        if (t.worker_name) d.workers_set.add(t.worker_name);
        d.trips.push(t);
      });

      aggregatedResults = Object.values(driverMap).map(d => {
        const totalDurationMs = d.durations.reduce((acc, curr) => acc + curr, 0);
        const avgDurationMs = d.durations.length > 0 ? Math.round(totalDurationMs / d.durations.length) : null;
        const minDurationMs = d.durations.length > 0 ? Math.min(...d.durations) : null;
        const maxDurationMs = d.durations.length > 0 ? Math.max(...d.durations) : null;
        const firstTripMs = d.out_times.length > 0 ? Math.min(...d.out_times) : null;
        const lastTripMs = d.out_times.length > 0 ? Math.max(...d.out_times) : null;

        return {
          id: d.id,
          name: d.name,
          driver_name: d.driver_name,
          total_trips: d.total_trips,
          total_visits: d.total_visits,
          avg_bmcs_per_trip: Number((d.total_visits / (d.total_trips || 1)).toFixed(1)),
          completed_durations_count: d.durations.length,
          total_duration_ms: totalDurationMs,
          total_duration_formatted: formatDurationMs(totalDurationMs),
          avg_duration_ms: avgDurationMs,
          avg_duration_formatted: formatDurationMs(avgDurationMs),
          min_duration_formatted: formatDurationMs(minDurationMs),
          max_duration_formatted: formatDurationMs(maxDurationMs),
          first_trip_time: firstTripMs ? new Date(firstTripMs).toLocaleString() : '—',
          last_trip_time: lastTripMs ? new Date(lastTripMs).toLocaleString() : '—',
          associated_tankers: Array.from(d.tankers_set),
          associated_workers: Array.from(d.workers_set),
          trips: d.trips
        };
      });

    } else if (type === 'worker') {
      const workerMap = {};
      enrichedTrips.forEach(t => {
        const wId = t.worker_id;
        const wName = t.worker_name;
        if (!workerMap[wId]) {
          workerMap[wId] = {
            id: wId,
            name: wName,
            worker_name: wName,
            total_trips: 0,
            total_visits: 0,
            total_ftir: 0,
            total_gerber: 0,
            total_issues: 0,
            durations: [],
            trip_ids: [],
            tankers_set: new Set(),
            drivers_set: new Set(),
            trips: []
          };
        }

        const w = workerMap[wId];
        w.total_trips += 1;
        w.total_visits += t.visits_count;
        w.total_ftir += t.ftir_count;
        w.total_gerber += t.gerber_count;
        w.total_issues += t.issues_count;
        if (t.duration_ms !== null) w.durations.push(t.duration_ms);
        w.trip_ids.push(t.id);
        if (t.tanker_number) w.tankers_set.add(t.tanker_number);
        if (t.driver_name) w.drivers_set.add(t.driver_name);
        w.trips.push(t);
      });

      aggregatedResults = Object.values(workerMap).map(w => {
        const totalDurationMs = w.durations.reduce((acc, curr) => acc + curr, 0);
        const avgDurationMs = w.durations.length > 0 ? Math.round(totalDurationMs / w.durations.length) : null;
        const minDurationMs = w.durations.length > 0 ? Math.min(...w.durations) : null;
        const maxDurationMs = w.durations.length > 0 ? Math.max(...w.durations) : null;

        const wVisits = visitList.filter(v => w.trip_ids.includes(v.trip_id));
        const wVisitIds = wVisits.map(v => v.id);
        const wRatings = ratingList.filter(r => wVisitIds.includes(r.visit_id));
        const avgRatingVal = wRatings.length > 0
          ? Number((wRatings.reduce((acc, r) => acc + Number(r.overall_rating || r.behaviour || 5), 0) / wRatings.length).toFixed(1))
          : null;

        return {
          id: w.id,
          name: w.name,
          worker_name: w.worker_name,
          total_trips: w.total_trips,
          total_visits: w.total_visits,
          total_ftir: w.total_ftir,
          total_gerber: w.total_gerber,
          total_issues: w.total_issues,
          total_corrections: 0,
          avg_bmc_rating: avgRatingVal,
          total_duration_ms: totalDurationMs,
          total_duration_formatted: formatDurationMs(totalDurationMs),
          avg_duration_ms: avgDurationMs,
          avg_duration_formatted: formatDurationMs(avgDurationMs),
          min_duration_formatted: formatDurationMs(minDurationMs),
          max_duration_formatted: formatDurationMs(maxDurationMs),
          associated_tankers: Array.from(w.tankers_set),
          associated_drivers: Array.from(w.drivers_set),
          trips: w.trips
        };
      });
    }

    if (entityId) {
      aggregatedResults = aggregatedResults.filter(item => String(item.id).toLowerCase() === String(entityId).toLowerCase() || String(item.name).toLowerCase() === String(entityId).toLowerCase());
    }

    res.json({
      type,
      startDate: startIso.slice(0, 10),
      endDate: endIso.slice(0, 10),
      summary_list: aggregatedResults,
      all_trips: enrichedTrips
    });

  } catch (err) {
    console.error('❌ GM Analysis Error:', err);
    res.status(500).json({ error: err.message || 'Failed to calculate GM Analysis data.' });
  }
});


// ─── GET /api/gm/requirements (LIST ALL BMC REQUIREMENTS) ────────────────────
app.get('/api/gm/requirements', requireGm, async (req, res) => {
  const { adminClient } = req;
  const { bmcId = '', status = 'all', search = '' } = req.query;

  try {
    const { data: reqs, error } = await adminClient
      .from('requirement_checks')
      .select(`*,
        visit:trip_bmc_visits(
          id, bmc_id,
          bmc:bmcs(id, name, district, location),
          trip:trips(id, trip_number, trip_name, created_at, worker_id)
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const { data: profiles } = await adminClient.from('profiles').select('id, name');
    const profileMap = {};
    (profiles || []).forEach(p => profileMap[p.id] = p.name);

    let list = (reqs || []).map(item => {
      const visit = item.visit || {};
      const bmc = visit.bmc || {};
      const trip = visit.trip || {};
      const workerName = profileMap[trip.worker_id] || 'Unknown Worker';

      return {
        id: item.id,
        visit_id: item.visit_id,
        bmc_id: bmc.id || visit.bmc_id,
        bmc_name: bmc.name || 'Unknown BMC',
        bmc_district: bmc.district || '',
        bmc_location: bmc.location || '',
        worker_name: workerName,
        trip_number: trip.trip_number || '',
        trip_name: trip.trip_name || '',
        seal_cutter_available: item.seal_cutter_available,
        seal_cutter_working: item.seal_cutter_working,
        acid_available: item.acid_available,
        acid_condition: item.acid_condition,
        ftir_machine_available: item.ftir_machine_available,
        ftir_machine_working: item.ftir_machine_working,
        cooling_system_working: item.cooling_system_working,
        power_backup_available: item.power_backup_available,
        weighing_scale_working: item.weighing_scale_working,
        remarks: item.remarks || '',
        status: item.status || 'pending',
        created_at: item.created_at
      };
    });

    if (bmcId) {
      list = list.filter(r => String(r.bmc_id) === String(bmcId));
    }
    if (status !== 'all') {
      list = list.filter(r => (r.status || 'pending') === status);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.bmc_name.toLowerCase().includes(q) ||
        r.worker_name.toLowerCase().includes(q) ||
        r.remarks.toLowerCase().includes(q)
      );
    }

    res.json({ requirements: list });

  } catch (err) {
    console.error('❌ GM Requirements API Error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch requirements.' });
  }
});

// ─── PATCH /api/gm/requirements/:id/complete (TICK REQUIREMENT AS COMPLETED) ──
app.patch('/api/gm/requirements/:id/complete', requireGm, async (req, res) => {
  const { adminClient } = req;
  const reqId = req.params.id;

  try {
    // Attempt updating status column
    let { data, error } = await adminClient
      .from('requirement_checks')
      .update({ status: 'completed' })
      .eq('id', reqId)
      .select().single();

    if (error) {
      // If column doesn't exist, append [COMPLETED] tag in remarks
      const { data: existing } = await adminClient
        .from('requirement_checks')
        .select('remarks')
        .eq('id', reqId)
        .single();

      const newRemarks = (existing?.remarks || '') + ' [COMPLETED BY GM]';
      const fallback = await adminClient
        .from('requirement_checks')
        .update({ remarks: newRemarks })
        .eq('id', reqId)
        .select().single();

      data = fallback.data;
    }

    res.json({ success: true, requirement: data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to complete requirement.' });
  }
});

// ─── GET /api/gm/issues (LIST ALL BMC ISSUES) ────────────────────────────────
app.get('/api/gm/issues', requireGm, async (req, res) => {
  const { adminClient } = req;
  const { bmcId = '', status = 'all', category = '', severity = '', search = '' } = req.query;

  try {
    const { data: issues, error } = await adminClient
      .from('bmc_issues')
      .select(`*,
        visit:trip_bmc_visits(
          id, bmc_id,
          bmc:bmcs(id, name, district, location),
          trip:trips(id, trip_number, trip_name, created_at, worker_id)
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const { data: profiles } = await adminClient.from('profiles').select('id, name');
    const profileMap = {};
    (profiles || []).forEach(p => profileMap[p.id] = p.name);

    let list = (issues || []).map(item => {
      const visit = item.visit || {};
      const bmc = visit.bmc || {};
      const trip = visit.trip || {};
      const workerName = profileMap[trip.worker_id] || 'Unknown Worker';

      return {
        id: item.id,
        visit_id: item.visit_id,
        bmc_id: bmc.id || visit.bmc_id,
        bmc_name: bmc.name || 'Unknown BMC',
        bmc_district: bmc.district || '',
        bmc_location: bmc.location || '',
        worker_name: workerName,
        trip_number: trip.trip_number || '',
        category: item.category,
        severity: item.severity,
        description: item.description,
        image_url: item.image_url,
        remarks: item.remarks || '',
        status: item.status || 'pending',
        created_at: item.created_at
      };
    });

    if (bmcId) {
      list = list.filter(i => String(i.bmc_id) === String(bmcId));
    }
    if (status !== 'all') {
      list = list.filter(i => (i.status || 'pending') === status);
    }
    if (category) {
      list = list.filter(i => i.category === category);
    }
    if (severity) {
      list = list.filter(i => i.severity === severity);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.bmc_name.toLowerCase().includes(q) ||
        i.worker_name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
      );
    }

    res.json({ issues: list });

  } catch (err) {
    console.error('❌ GM Issues API Error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch issues.' });
  }
});

// ─── PATCH /api/gm/issues/:id/complete (TICK ISSUE AS COMPLETED/RESOLVED) ───
app.patch('/api/gm/issues/:id/complete', requireGm, async (req, res) => {
  const { adminClient } = req;
  const issueId = req.params.id;

  try {
    let { data, error } = await adminClient
      .from('bmc_issues')
      .update({ status: 'completed' })
      .eq('id', issueId)
      .select().single();

    if (error) {
      const { data: existing } = await adminClient
        .from('bmc_issues')
        .select('remarks')
        .eq('id', issueId)
        .single();

      const newRemarks = (existing?.remarks || '') + ' [RESOLVED BY GM]';
      const fallback = await adminClient
        .from('bmc_issues')
        .update({ remarks: newRemarks })
        .eq('id', issueId)
        .select().single();

      data = fallback.data;
    }

    res.json({ success: true, issue: data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to complete issue.' });
  }
});

// ─── GET /api/gm/bmcs (LIST ALL BMCS WITH FULL DATA FOR GM) ───────────────────
app.get('/api/gm/bmcs', requireGm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: bmcs, error } = await adminClient
      .from('bmcs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    let silosList = [];
    try {
      const { data: silosData } = await adminClient
        .from('bmc_silos')
        .select('*')
        .order('silo_number', { ascending: true });
      silosList = silosData || [];
    } catch (siloErr) {
      silosList = [];
    }

    const silosMap = {};
    silosList.forEach(s => {
      if (!silosMap[s.bmc_id]) silosMap[s.bmc_id] = [];
      silosMap[s.bmc_id].push(s);
    });

    const enrichedBmcs = (bmcs || []).map(b => ({
      ...b,
      silos: silosMap[b.id] || []
    }));

    res.json({ bmcs: enrichedBmcs });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load BMC list.' });
  }
});

// ─── PUT /api/gm/bmcs/:id (UPDATE BMC DETAILS) ─────────────────────────────────
app.put('/api/gm/bmcs/:id', requireGm, async (req, res) => {
  const { adminClient } = req;
  const bmcId = req.params.id;
  const { name, district, location, contact_number, latitude, longitude, profile_image_url, total_capacity, silos } = req.body;

  console.log(`[GM BMC UPDATE] id=${bmcId} total_capacity=${total_capacity} silos_count=${Array.isArray(silos) ? silos.length : 'none'}`);

  if (!name || !district || !location || !contact_number) {
    return res.status(400).json({ error: 'Name, district, location, and contact number are required.' });
  }

  try {
    const payload = {
      name: name.trim(),
      district: district.trim(),
      location: location.trim(),
      contact_number: contact_number.trim(),
      latitude: latitude !== undefined && latitude !== null && latitude !== '' ? parseFloat(latitude) : null,
      longitude: longitude !== undefined && longitude !== null && longitude !== '' ? parseFloat(longitude) : null
    };
    if (profile_image_url !== undefined) payload.profile_image_url = profile_image_url;
    if (total_capacity !== undefined && total_capacity !== null) {
      payload.total_capacity = parseFloat(total_capacity) || 0;
      console.log(`[GM BMC UPDATE] Setting total_capacity=${payload.total_capacity}`);
    }

    let data = null;
    let error = null;

    const result = await adminClient
      .from('bmcs')
      .update(payload)
      .eq('id', bmcId)
      .select();

    if (result.error) {
      console.warn('[GM BMC UPDATE] Initial update error:', result.error.message);
      if (result.error.code === '42703' || (result.error.message && result.error.message.includes('total_capacity'))) {
        console.warn('[GM BMC UPDATE] Retrying update without total_capacity...');
        const retryPayload = { ...payload };
        delete retryPayload.total_capacity;
        const retryResult = await adminClient
          .from('bmcs')
          .update(retryPayload)
          .eq('id', bmcId)
          .select();
        data = retryResult.data ? retryResult.data[0] : null;
        error = retryResult.error;
      } else {
        error = result.error;
      }
    } else {
      data = result.data ? result.data[0] : null;
    }

    if (error) throw error;

    let updatedSilos = [];
    if (Array.isArray(silos)) {
      console.log(`[GM BMC UPDATE] Processing ${silos.length} silos for bmc_id=${bmcId}`);
      try {
        const { data: existingSilos, error: selErr } = await adminClient
          .from('bmc_silos')
          .select('id')
          .eq('bmc_id', bmcId);
        if (selErr) console.error('[GM BMC UPDATE] Error fetching existing silos:', selErr.message);

        const existingIds = (existingSilos || []).map(s => s.id);
        const payloadSiloIds = silos.filter(s => s.id).map(s => s.id);
        const idsToDelete = existingIds.filter(id => !payloadSiloIds.includes(id));

        if (idsToDelete.length > 0) {
          const { error: delErr } = await adminClient.from('bmc_silos').delete().in('id', idsToDelete);
          if (delErr) console.error('[GM BMC UPDATE] Error deleting old silos:', delErr.message);
        }

        for (let i = 0; i < silos.length; i++) {
          const s = silos[i];
          const siloData = {
            bmc_id: bmcId,
            silo_number: i + 1,
            silo_name: `Silo ${i + 1}`,
            capacity_kg: parseFloat(s.capacity_kg) || 0
          };

          if (s.id && existingIds.includes(s.id)) {
            const { error: uErr } = await adminClient.from('bmc_silos').update(siloData).eq('id', s.id);
            if (uErr) console.error(`[GM BMC UPDATE] Silo ${i+1} update error:`, uErr.message);
          } else {
            const { error: iErr } = await adminClient.from('bmc_silos').insert(siloData);
            if (iErr) console.error(`[GM BMC UPDATE] Silo ${i+1} insert error:`, iErr.message);
          }
        }
        console.log('[GM BMC UPDATE] Silos processed OK');

        const { data: refSilos } = await adminClient
          .from('bmc_silos')
          .select('*')
          .eq('bmc_id', bmcId)
          .order('silo_number', { ascending: true });
        updatedSilos = refSilos || [];
      } catch (sErr) {
        console.error('⚠️ Silo update exception:', sErr.message);
      }
    }

    res.json({ bmc: { ...data, silos: updatedSilos } });
  } catch (err) {
    console.error('❌ Update BMC error:', err);
    res.status(500).json({ error: err.message || 'Failed to update BMC.' });
  }
});

// ─── PUT /api/gm/bmcs/:id/toggle (TOGGLE BMC ACTIVE STATUS) ────────────────────
app.put('/api/gm/bmcs/:id/toggle', requireGm, async (req, res) => {
  const { adminClient } = req;
  const bmcId = req.params.id;
  const { is_active } = req.body;

  try {
    const { data, error } = await adminClient
      .from('bmcs')
      .update({ is_active: !!is_active, updated_at: new Date() })
      .eq('id', bmcId)
      .select()
      .single();

    if (error) throw error;
    res.json({ bmc: data });
  } catch (err) {
    console.error('❌ Toggle BMC status error:', err);
    res.status(500).json({ error: err.message || 'Failed to toggle BMC status.' });
  }
});

// ─── GET /api/gm/bmcs/:bmcId/profile (DETAILED BMC PROFILE SEARCH & SUMMARY) ──
app.get('/api/gm/bmcs/:bmcId/profile', requireGm, async (req, res) => {
  const { adminClient } = req;
  const bmcId = req.params.bmcId;

  try {
    const { data: bmc, error: bmcErr } = await adminClient
      .from('bmcs')
      .select('*')
      .eq('id', bmcId)
      .single();

    if (bmcErr || !bmc) return res.status(404).json({ error: 'BMC unit not found.' });

    // Fetch visits for this BMC
    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('id, trip_id, created_at')
      .eq('bmc_id', bmcId);

    const visitIds = (visits || []).map(v => v.id);

    let requirements = [], issues = [], ratings = [];
    if (visitIds.length > 0) {
      const [reqRes, issRes, ratRes] = await Promise.all([
        adminClient.from('requirement_checks').select('*, visit:trip_bmc_visits(trip:trips(worker_id))').in('visit_id', visitIds),
        adminClient.from('bmc_issues').select('*, visit:trip_bmc_visits(trip:trips(worker_id))').in('visit_id', visitIds),
        adminClient.from('bmc_ratings').select('*, visit:trip_bmc_visits(trip:trips(worker_id))').in('visit_id', visitIds)
      ]);
      requirements = reqRes.data || [];
      issues = issRes.data || [];
      ratings = ratRes.data || [];
    }

    const { data: profiles } = await adminClient.from('profiles').select('id, name');
    const profileMap = {};
    (profiles || []).forEach(p => profileMap[p.id] = p.name);

    // Format Requirements
    const formattedRequirements = requirements.map(r => {
      const workerId = r.visit?.trip?.worker_id;
      return {
        id: r.id,
        worker_name: profileMap[workerId] || 'Worker',
        acid_available: r.acid_available,
        ftir_machine_available: r.ftir_machine_available,
        seal_cutter_available: r.seal_cutter_available,
        power_backup_available: r.power_backup_available,
        remarks: r.remarks || '',
        status: r.status || 'pending',
        created_at: r.created_at
      };
    });

    // Format Issues
    const formattedIssues = issues.map(i => {
      const workerId = i.visit?.trip?.worker_id;
      return {
        id: i.id,
        worker_name: profileMap[workerId] || 'Worker',
        category: i.category,
        severity: i.severity,
        description: i.description,
        image_url: i.image_url,
        remarks: i.remarks || '',
        status: i.status || 'pending',
        created_at: i.created_at
      };
    });

    // Format Reviews/Ratings
    const formattedRatings = ratings.map(rat => {
      const workerId = rat.visit?.trip?.worker_id;
      return {
        id: rat.id,
        worker_name: profileMap[workerId] || 'Worker',
        overall_rating: rat.overall_rating || rat.behaviour || 5,
        remarks: rat.remarks || '',
        created_at: rat.created_at
      };
    });

    // Calculate Average Rating
    const validRatings = formattedRatings.map(r => Number(r.overall_rating)).filter(n => !isNaN(n));
    const avgRating = validRatings.length > 0
      ? Number((validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(1))
      : null;

    res.json({
      bmc,
      total_visits: (visits || []).length,
      avg_rating: avgRating,
      requirements: formattedRequirements,
      issues: formattedIssues,
      ratings: formattedRatings
    });

  } catch (err) {
    console.error('❌ GM BMC Profile Error:', err);
    res.status(500).json({ error: err.message || 'Failed to load BMC profile.' });
  }
});


// ─── GET /api/worker/profile ──────────────────────────────────────────────────
app.get('/api/worker/profile', requireWorker, (req, res) => {
  res.json({ profile: req.profile });
});

// ─── GET /api/worker/dashboard-stats ─────────────────────────────────────────
app.get('/api/worker/dashboard-stats', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const [tripsRes, visitsRes] = await Promise.all([
      adminClient.from('trips').select('id, status').eq('worker_id', profile.id),
      adminClient.from('trip_bmc_visits').select('id, status, trip_id')
        .in('trip_id',
          (await adminClient.from('trips').select('id').eq('worker_id', profile.id)).data?.map(t => t.id) || []
        )
    ]);

    const trips = tripsRes.data || [];
    const visits = visitsRes.data || [];

    res.json({
      total_trips: trips.length,
      completed_trips: trips.filter(t => t.status === 'completed').length,
      active_trips: trips.filter(t => t.status === 'active').length,
      total_bmc_visits: visits.length,
      completed_bmc_visits: visits.filter(v => v.status === 'completed').length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/worker/active-trip ─────────────────────────────────────────────
app.get('/api/worker/active-trip', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const { data: trip, error } = await adminClient
      .from('trips')
      .select('*')
      .eq('worker_id', profile.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !trip) return res.json({ trip: null, visits: [] });

    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*, bmc:bmcs(*)')
      .eq('trip_id', trip.id)
      .order('visit_sequence');

    res.json({ trip, visits: visits || [] });
  } catch (err) {
    res.json({ trip: null, visits: [] });
  }
});

// ─── GET /api/drivers ─────────────────────────────────────────────────────────
app.get('/api/drivers', requireWorker, async (req, res) => {
  const { data, error } = await req.adminClient.from('drivers')
    .select('*').eq('is_active', true).order('name');
  if (error) return res.json({ drivers: [] });
  res.json({ drivers: data || [] });
});

// ─── GET /api/tankers ─────────────────────────────────────────────────────────
app.get('/api/tankers', requireWorker, async (req, res) => {
  const { data, error } = await req.adminClient.from('tankers')
    .select('*').eq('is_active', true).order('board_number');
  if (error) return res.json({ tankers: [] });
  res.json({ tankers: data || [] });
});

// ─── ADMIN: DRIVERS & TANKERS API ─────────────────────────────────────────────
app.get('/api/admin/drivers', async (req, res) => {
  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });
  const { data, error } = await adminClient.from('drivers').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ drivers: data || [] });
});

app.post('/api/admin/drivers', async (req, res) => {
  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });
  const { name, phone, license_number } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Driver name is required.' });

  const { data, error } = await adminClient.from('drivers').insert({
    name: name.trim(),
    phone: phone ? phone.trim() : null,
    license_number: license_number ? license_number.trim() : null,
    is_active: true
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ driver: data });
});

app.put('/api/admin/drivers/:id/toggle', async (req, res) => {
  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });
  const { is_active } = req.body;
  const { data, error } = await adminClient.from('drivers')
    .update({ is_active: Boolean(is_active) })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ driver: data });
});

app.get('/api/admin/tankers', async (req, res) => {
  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });
  const { data, error } = await adminClient.from('tankers').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ tankers: data || [] });
});

app.post('/api/admin/tankers', async (req, res) => {
  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });
  const { board_number, capacity_liters } = req.body;
  if (!board_number || !board_number.trim()) return res.status(400).json({ error: 'Vehicle board number is required.' });

  const { data, error } = await adminClient.from('tankers').insert({
    board_number: board_number.trim().toUpperCase(),
    capacity_liters: capacity_liters ? Number(capacity_liters) : 5000,
    is_active: true
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ tanker: data });
});

app.put('/api/admin/tankers/:id/toggle', async (req, res) => {
  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });
  const { is_active } = req.body;
  const { data, error } = await adminClient.from('tankers')
    .update({ is_active: Boolean(is_active) })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ tanker: data });
});


// ─── GET /api/bmcs/search ─────────────────────────────────────────────────────
// ─── POST /api/worker/create-bmc ─────────────────────────────────────────────
// Allows workers to register a new BMC unit from the field
app.post('/api/worker/create-bmc', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { name, district, location, contact_number, latitude, longitude, profile_image_url } = req.body;

  if (!name || !district || !location || !contact_number) {
    return res.status(400).json({ error: 'Name, district, location, and contact number are required.' });
  }
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    return res.status(400).json({ error: 'GPS coordinates (latitude and longitude) are required.' });
  }

  try {
    // Check for duplicate BMC name (case-insensitive)
    const { data: existing } = await adminClient
      .from('bmcs')
      .select('id')
      .ilike('name', name.trim())
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'A BMC with this name already exists.' });
    }

    const { data, error } = await adminClient.from('bmcs').insert({
      name: name.trim(),
      district: district.trim(),
      location: location.trim(),
      contact_number: contact_number.trim(),
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      profile_image_url: profile_image_url || null,
      is_active: true
    }).select().single();

    if (error) throw error;
    res.status(201).json({ bmc: data });
  } catch (err) {
    console.error('❌ Create BMC error:', err);
    res.status(500).json({ error: err.message || 'Failed to create BMC.' });
  }
});

app.get('/api/bmcs/search', requireWorker, async (req, res) => {
  const q = (req.query.q || '').trim();
  let query = req.adminClient.from('bmcs').select('*').eq('is_active', true);
  if (q) {
    query = query.or(`name.ilike.%${q}%,district.ilike.%${q}%,location.ilike.%${q}%`);
  }
  const { data, error } = await query.order('name').limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ bmcs: data || [] });
});

// ─── POST /api/trips ──────────────────────────────────────────────────────────
app.post('/api/trips', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { trip_name, driver_name, tanker_number, driver_id, tanker_id, out_time } = req.body;

  const finalDriver = (driver_name || '').trim();
  const finalTanker = (tanker_number || '').trim();

  if (!trip_name || !finalDriver || !finalTanker) {
    return res.status(400).json({ error: 'trip_name, driver_name, and tanker_number are required.' });
  }

  // Prevent duplicate active trips
  const { data: existing } = await adminClient
    .from('trips').select('id').eq('worker_id', profile.id).eq('status', 'active').limit(1);
  if (existing && existing.length > 0) {
    return res.status(409).json({ error: 'You already have an active trip. Complete it before starting a new one.' });
  }

  const { data, error } = await adminClient.from('trips').insert({
    trip_name,
    worker_id: profile.id,
    driver_name: finalDriver,
    tanker_number: finalTanker,
    driver_id: driver_id || null,
    tanker_id: tanker_id || null,
    out_time: out_time || new Date().toISOString(),
    status: 'active'
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ trip: data });
});

// ─── GET /api/trips ───────────────────────────────────────────────────────────
app.get('/api/trips', requireWorker, async (req, res) => {
  const { data, error } = await req.adminClient
    .from('trips')
    .select('*')
    .eq('worker_id', req.profile.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ trips: data || [] });
});

// ─── GET /api/trips/:id ───────────────────────────────────────────────────────
app.get('/api/trips/:id', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { data: trip, error } = await adminClient
    .from('trips')
    .select('*')
    .eq('id', req.params.id)
    .eq('worker_id', profile.id)   // Enforce ownership
    .single();

  if (error || !trip) return res.status(404).json({ error: 'Trip not found.' });

  const { data: rawVisits } = await adminClient
    .from('trip_bmc_visits')
    .select(`*, bmc:bmcs(*),
      ftir_tests(*), gerber_tests(*),
      requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
    .eq('trip_id', trip.id)
    .order('visit_sequence');

  const visits = (rawVisits || []).map((v, idx, arr) => {
    const previousOccurrences = arr.slice(0, idx).filter(prev => prev.bmc_id === v.bmc_id);
    if (previousOccurrences.length >= 1 || (v.remarks && v.remarks.includes('[AFTER MIXING]'))) {
      v.is_after_mixing = true;
    }
    return v;
  });

  res.json({ trip, visits });
});


// ─── PATCH /api/trips/:id/complete ───────────────────────────────────────────
app.patch('/api/trips/:id/complete', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { in_time, remarks } = req.body;
  if (!in_time) return res.status(400).json({ error: 'Factory in_time is required.' });

  const { data, error } = await adminClient
    .from('trips')
    .update({ status: 'completed', in_time, remarks, updated_at: new Date() })
    .eq('id', req.params.id)
    .eq('worker_id', profile.id)
    .select().single();

  if (error || !data) return res.status(404).json({ error: error?.message || 'Trip not found.' });
  res.json({ trip: data });
});

// ─── POST /api/trips/:tripId/visits ──────────────────────────────────────────
app.post('/api/trips/:tripId/visits', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { bmc_id } = req.body;
  if (!bmc_id) return res.status(400).json({ error: 'bmc_id is required.' });

  // Verify trip ownership
  const { data: trip } = await adminClient
    .from('trips').select('id, status').eq('id', req.params.tripId).eq('worker_id', profile.id).single();
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });
  if (trip.status !== 'active') return res.status(400).json({ error: 'Trip is not active.' });

  // Count existing visits for this BMC in this trip
  const { data: existingVisits } = await adminClient
    .from('trip_bmc_visits')
    .select('id, visit_sequence, remarks')
    .eq('trip_id', trip.id)
    .eq('bmc_id', bmc_id)
    .order('visit_sequence');

  const count = existingVisits ? existingVisits.length : 0;

  if (count >= 2) {
    return res.status(400).json({ error: 'This BMC has already been added twice (Normal Visit and After Mixing) for this trip.' });
  }

  const isAfterMixing = count === 1;

  // Determine next sequence number
  const { data: existingSeq } = await adminClient
    .from('trip_bmc_visits').select('visit_sequence').eq('trip_id', trip.id).order('visit_sequence', { ascending: false }).limit(1);
  const nextSeq = existingSeq && existingSeq.length > 0 ? existingSeq[0].visit_sequence + 1 : 1;

  const insertPayload = {
    trip_id: trip.id,
    bmc_id,
    visit_sequence: nextSeq,
    status: 'pending',
    remarks: isAfterMixing ? '[AFTER MIXING]' : null
  };

  const { data, error } = await adminClient.from('trip_bmc_visits').insert(insertPayload).select('*, bmc:bmcs(*)').single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This BMC is blocked by a database UNIQUE constraint. Please execute allow_after_mixing_schema.sql in Supabase SQL editor to drop UNIQUE(trip_id, bmc_id).' });
    }
    return res.status(500).json({ error: error.message });
  }

  if (data && isAfterMixing) {
    data.is_after_mixing = true;
  }

  res.status(201).json({ visit: data });
});

// ─── GET /api/visits/:visitId ────────────────────────────────────────────────
app.get('/api/visits/:visitId', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { data: visit, error } = await adminClient
    .from('trip_bmc_visits')
    .select(`*, bmc:bmcs(*),
      ftir_tests(*), gerber_tests(*),
      requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
    .eq('id', req.params.visitId)
    .single();

  if (error || !visit) return res.status(404).json({ error: 'Visit not found.' });

  const { data: trip } = await adminClient.from('trips').select('worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });

  // Determine if this visit is "After Mixing"
  const { data: allVisits } = await adminClient
    .from('trip_bmc_visits')
    .select('id, visit_sequence')
    .eq('trip_id', visit.trip_id)
    .eq('bmc_id', visit.bmc_id)
    .order('visit_sequence');

  if (allVisits && allVisits.length > 1 && allVisits[1].id === visit.id) {
    visit.is_after_mixing = true;
  }

  res.json({ visit });
});

// ─── PATCH /api/visits/:visitId ───────────────────────────────────────────────
app.patch('/api/visits/:visitId', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const allowed = ['compartment', 'status', 'visit_start_time', 'visit_end_time', 'milk_quantity_liters', 'remarks'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  updates.updated_at = new Date();

  // Verify ownership via trip
  const { data: visit } = await adminClient
    .from('trip_bmc_visits').select('trip_id').eq('id', req.params.visitId).single();
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });

  const { data: trip } = await adminClient
    .from('trips').select('worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });

  const { data, error } = await adminClient
    .from('trip_bmc_visits').update(updates).eq('id', req.params.visitId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ visit: data });
});

// ─── DELETE /api/visits/:visitId ──────────────────────────────────────────────
app.delete('/api/visits/:visitId', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;

  // Verify visit exists and worker owns the trip
  const { data: visit } = await adminClient.from('trip_bmc_visits').select('id, trip_id').eq('id', req.params.visitId).single();
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });

  const { data: trip } = await adminClient.from('trips').select('id, worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });

  const { error } = await adminClient.from('trip_bmc_visits').delete().eq('id', req.params.visitId);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, message: 'BMC Visit deleted successfully.' });
});

// ─── POST /api/upload ─────────────────────────────────────────────────────────
app.post('/api/upload', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { imageBase64, filename } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: 'Image data is required.' });
  }

  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = (filename && filename.split('.').pop()) || 'jpg';
    const filePath = `ftir-tests/${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;

    const { error: uploadErr } = await adminClient.storage
      .from('profile_images')
      .upload(filePath, buffer, {
        contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
        upsert: true
      });

    if (uploadErr) {
      console.warn('Backend storage upload error, returning data URL:', uploadErr.message);
      return res.json({ publicUrl: imageBase64 });
    }

    const { data: publicUrlData } = adminClient.storage.from('profile_images').getPublicUrl(filePath);
    res.json({ publicUrl: publicUrlData.publicUrl });
  } catch (err) {
    console.error('Upload endpoint error:', err);
    res.json({ publicUrl: imageBase64 });
  }
});

// ─── POST /api/visits/:visitId/ftir ──────────────────────────────────────────
app.post('/api/visits/:visitId/ftir', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { fat, snf, protein, lactose, water_percentage, temperature, remarks, image_url } = req.body;

  if (!image_url) {
    return res.status(400).json({ error: 'FTIR test photo/image is mandatory.' });
  }

  // Verify ownership
  const { data: visit } = await adminClient.from('trip_bmc_visits').select('trip_id').eq('id', req.params.visitId).single();
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });
  const { data: trip } = await adminClient.from('trips').select('worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });

  // Basic quality evaluation
  let overall_result = 'pass';
  if (fat !== undefined && fat < 3.0) overall_result = 'fail';
  else if (snf !== undefined && snf < 8.0) overall_result = 'fail';
  else if (water_percentage !== undefined && water_percentage > 5) overall_result = 'warning';

  // Safe Save (check existing first)
  const { data: existing } = await adminClient.from('ftir_tests').select('id').eq('visit_id', req.params.visitId).maybeSingle();
  
  let formattedRemarks = remarks || '';
  if (image_url && !formattedRemarks.includes('[FTIR_IMAGE:')) {
    formattedRemarks = formattedRemarks ? `${formattedRemarks} [FTIR_IMAGE: ${image_url}]` : `[FTIR_IMAGE: ${image_url}]`;
  }

  const payload = {
    visit_id: req.params.visitId,
    fat, snf, protein, lactose, water_percentage, temperature, overall_result,
    remarks: formattedRemarks,
    tested_at: new Date()
  };

  // Try storing image_url directly in payload if column exists
  payload.image_url = image_url;

  let result = existing 
    ? await adminClient.from('ftir_tests').update(payload).eq('id', existing.id).select().single()
    : await adminClient.from('ftir_tests').insert(payload).select().single();

  if (result.error && result.error.message && result.error.message.includes('image_url')) {
    delete payload.image_url;
    result = existing
      ? await adminClient.from('ftir_tests').update(payload).eq('id', existing.id).select().single()
      : await adminClient.from('ftir_tests').insert(payload).select().single();
  }

  if (result.error) return res.status(500).json({ error: result.error.message });
  
  const responseData = result.data;
  if (!responseData.image_url) responseData.image_url = image_url;

  res.json({ ftir: responseData });
});

// ─── POST /api/visits/:visitId/gerber ────────────────────────────────────────
app.post('/api/visits/:visitId/gerber', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { fat_percentage, clr, snf, sample_temp, remarks } = req.body;

  const { data: visit } = await adminClient.from('trip_bmc_visits').select('trip_id').eq('id', req.params.visitId).single();
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });
  const { data: trip } = await adminClient.from('trips').select('worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });

  let overall_result = 'pass';
  if (fat_percentage !== undefined && fat_percentage < 3.0) overall_result = 'fail';
  if (clr !== undefined && (clr < 26 || clr > 32)) overall_result = 'warning';

  const { data: existing } = await adminClient.from('gerber_tests').select('id').eq('visit_id', req.params.visitId).maybeSingle();
  let result;
  const payload = {
    visit_id: req.params.visitId,
    fat_percentage, clr, snf, sample_temp, overall_result, remarks,
    tested_at: new Date()
  };
  if (existing) {
    result = await adminClient.from('gerber_tests').update(payload).eq('id', existing.id).select().single();
  } else {
    result = await adminClient.from('gerber_tests').insert(payload).select().single();
  }

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.json({ gerber: result.data });
});

// ─── POST /api/visits/:visitId/requirements ───────────────────────────────────
app.post('/api/visits/:visitId/requirements', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const fields = ['seal_cutter_available','seal_cutter_working','acid_available','acid_condition',
    'ftir_machine_available','ftir_machine_working','cooling_system_working',
    'power_backup_available','weighing_scale_working','remarks'];
  const payload = { visit_id: req.params.visitId };
  for (const f of fields) { if (req.body[f] !== undefined) payload[f] = req.body[f]; }

  const { data: visit } = await adminClient.from('trip_bmc_visits').select('trip_id').eq('id', req.params.visitId).single();
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });
  const { data: trip } = await adminClient.from('trips').select('worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });

  const { data: existing } = await adminClient.from('requirement_checks').select('id').eq('visit_id', req.params.visitId).maybeSingle();
  let result;
  if (existing) {
    result = await adminClient.from('requirement_checks').update(payload).eq('id', existing.id).select().single();
  } else {
    result = await adminClient.from('requirement_checks').insert(payload).select().single();
  }

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.json({ requirements: result.data });
});

// ─── POST /api/visits/:visitId/issues ────────────────────────────────────────
app.post('/api/visits/:visitId/issues', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { category, description, severity, remarks, image_url } = req.body;
  if (!category || !description) return res.status(400).json({ error: 'category and description are required.' });

  const { data: visit } = await adminClient.from('trip_bmc_visits').select('trip_id').eq('id', req.params.visitId).single();
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });
  const { data: trip } = await adminClient.from('trips').select('worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });

  const { data, error } = await adminClient.from('bmc_issues').insert({
    visit_id: req.params.visitId,
    category, description,
    severity: severity || 'medium',
    remarks, image_url
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ issue: data });
});

// ─── DELETE /api/issues/:issueId ─────────────────────────────────────────────
app.delete('/api/issues/:issueId', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { data: issue } = await adminClient.from('bmc_issues').select('visit_id').eq('id', req.params.issueId).single();
  if (!issue) return res.status(404).json({ error: 'Issue not found.' });
  const { data: visit } = await adminClient.from('trip_bmc_visits').select('trip_id').eq('id', issue.visit_id).single();
  const { data: trip } = await adminClient.from('trips').select('worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });
  await adminClient.from('bmc_issues').delete().eq('id', req.params.issueId);
  res.json({ success: true });
});

// ─── POST /api/visits/:visitId/rating ────────────────────────────────────────
app.post('/api/visits/:visitId/rating', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { behaviour, cooperation, cleanliness, infrastructure, remarks } = req.body;

  const { data: visit } = await adminClient.from('trip_bmc_visits').select('trip_id').eq('id', req.params.visitId).single();
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });
  const { data: trip } = await adminClient.from('trips').select('worker_id').eq('id', visit.trip_id).single();
  if (!trip || trip.worker_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });

  const { data: existing } = await adminClient.from('bmc_ratings').select('id').eq('visit_id', req.params.visitId).maybeSingle();
  let result;
  const payload = { visit_id: req.params.visitId, behaviour, cooperation, cleanliness, infrastructure, remarks };
  if (existing) {
    result = await adminClient.from('bmc_ratings').update(payload).eq('id', existing.id).select().single();
  } else {
    result = await adminClient.from('bmc_ratings').insert(payload).select().single();
  }

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.json({ rating: result.data });
});

// ─── GET /api/analysis ────────────────────────────────────────────────────────
app.get('/api/analysis', async (req, res) => {
  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  try {
    let { startDate, endDate } = req.query;
    let startIso, endIso;

    if (startDate) {
      startIso = new Date(startDate + 'T00:00:00.000Z').toISOString();
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      startIso = d.toISOString();
    }

    if (endDate) {
      endIso = new Date(endDate + 'T23:59:59.999Z').toISOString();
    } else {
      endIso = new Date().toISOString();
    }

    const { data: trips } = await adminClient
      .from('trips')
      .select('*, driver:drivers(name), tanker:tankers(board_number)')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select(`*, bmc:bmcs(*),
        ftir_tests(*), gerber_tests(*),
        requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    const tripList = trips || [];
    const visitList = visits || [];

    const totalTrips = tripList.length;
    const completedTrips = tripList.filter(t => t.status === 'completed').length;
    const activeTrips = tripList.filter(t => t.status === 'active').length;

    const totalBmcVisited = visitList.length;
    const completedVisits = visitList.filter(v => v.status === 'completed').length;

    let totalMilkKg = 0;
    let ftirPass = 0, ftirWarn = 0, ftirFail = 0;
    let gerberPass = 0, gerberWarn = 0, gerberFail = 0;
    let totalIssues = 0;
    let ratingSum = 0, ratingCount = 0;

    visitList.forEach(v => {
      if (v.milk_quantity_liters) totalMilkKg += Number(v.milk_quantity_liters);

      const ftir = Array.isArray(v.ftir_tests) ? v.ftir_tests[0] : v.ftir_tests;
      if (ftir && ftir.overall_result) {
        if (ftir.overall_result === 'pass') ftirPass++;
        else if (ftir.overall_result === 'warning') ftirWarn++;
        else if (ftir.overall_result === 'fail') ftirFail++;
      }

      const gerber = Array.isArray(v.gerber_tests) ? v.gerber_tests[0] : v.gerber_tests;
      if (gerber && gerber.overall_result) {
        if (gerber.overall_result === 'pass') gerberPass++;
        else if (gerber.overall_result === 'warning') gerberWarn++;
        else if (gerber.overall_result === 'fail') gerberFail++;
      }

      if (v.bmc_issues && Array.isArray(v.bmc_issues)) {
        totalIssues += v.bmc_issues.length;
      }

      const rating = Array.isArray(v.bmc_ratings) ? v.bmc_ratings[0] : v.bmc_ratings;
      if (rating) {
        const score = rating.behaviour || rating.overall_rating || 5;
        ratingSum += Number(score);
        ratingCount++;
      }
    });

    const avgRating = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : '5.0';

    res.json({
      filter: { startDate, endDate, startIso, endIso },
      kpis: {
        total_trips: totalTrips,
        completed_trips: completedTrips,
        active_trips: activeTrips,
        total_bmc_visited: totalBmcVisited,
        completed_visits: completedVisits,
        total_milk_kg: Math.round(totalMilkKg),
        total_issues: totalIssues,
        avg_rating: avgRating,
        ftir_stats: { pass: ftirPass, warning: ftirWarn, fail: ftirFail },
        gerber_stats: { pass: gerberPass, warning: gerberWarn, fail: gerberFail }
      },
      trips: tripList,
      visits: visitList
    });
  } catch (err) {
    console.error('Analysis API error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch analysis.' });
  }
});



// ─── TRANSPORT OFFICER MIDDLEWARE ────────────────────────────────────────────
async function requireTransportOfficer(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (profile.role !== 'transport_officer' && profile.role !== 'driver' && profile.role !== 'admin') {
    return res.status(403).json({ error: 'Transport Officer or Driver access required.' });
  }
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Account not yet approved.' });

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

// Helper: Fetch unified list of drivers from profiles and drivers tables
async function getUnifiedDrivers(adminClient) {
  try {
    const [dbDriversRes, profileDriversRes, driverTripsRes, workerTripsRes] = await Promise.all([
      adminClient.from('drivers').select('*'),
      adminClient.from('profiles').select('*').eq('role', 'driver'),
      adminClient.from('driver_trips').select('*').neq('status', 'deleted'),
      adminClient.from('trips').select('*').neq('status', 'deleted')
    ]);

    const dbDrivers = dbDriversRes.data || [];
    const profileDrivers = profileDriversRes.data || [];
    const driverTrips = driverTripsRes.data || [];
    const workerTrips = workerTripsRes.data || [];

    const map = new Map();

    dbDrivers.forEach(d => {
      const key = d.id || d.name.toLowerCase().trim();
      map.set(key, {
        id: d.id,
        name: d.name,
        license_number: d.license_number || '',
        phone: d.phone || '',
        is_active: d.is_active !== false,
        status: d.is_active !== false ? 'approved' : 'pending',
        source: 'drivers_table'
      });
    });

    profileDrivers.forEach(p => {
      let existingKey = p.id;
      for (const [k, v] of map.entries()) {
        if (v.id === p.id || (v.name && v.name.toLowerCase().trim() === p.name.toLowerCase().trim())) {
          existingKey = k;
          break;
        }
      }

      const existing = map.get(existingKey) || {};
      map.set(existingKey, {
        id: p.id,
        name: p.name || existing.name,
        license_number: existing.license_number || '',
        phone: existing.phone || p.phone || '',
        email: p.email || '',
        is_active: p.status === 'approved' || existing.is_active !== false,
        status: p.status || 'approved',
        profile_image_url: p.profile_image_url || null,
        source: 'profiles_table'
      });
    });

    const unifiedList = Array.from(map.values());

    return unifiedList.map(driver => {
      const dTrips = driverTrips.filter(t => t.assigned_driver_id === driver.id || (t.driver_name && t.driver_name.toLowerCase() === driver.name.toLowerCase()));
      const wTrips = workerTrips.filter(t => t.driver_name && t.driver_name.toLowerCase() === driver.name.toLowerCase());
      const totalTrips = dTrips.length + wTrips.length;

      const allTrips = [
        ...dTrips.map(t => ({ date: t.created_at || t.scheduled_start_time, vehicle: t.vehicle_number })),
        ...wTrips.map(t => ({ date: t.created_at, vehicle: t.tanker_number }))
      ].filter(t => t.date).sort((a, b) => new Date(b.date) - new Date(a.date));

      const latest = allTrips[0];

      return {
        ...driver,
        total_trips: totalTrips,
        assigned_vehicle: latest?.vehicle || null,
        last_activity: latest?.date || null
      };
    });
  } catch (err) {
    console.error('getUnifiedDrivers error:', err);
    return [];
  }
}

// ─── GET /api/transport/dashboard ─────────────────────────────────────────────
app.get('/api/transport/dashboard', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;

  try {
    const [drivers, vehiclesRes, workerTripsRes, driverTripsRes] = await Promise.all([
      getUnifiedDrivers(adminClient),
      adminClient.from('tankers').select('*'),
      adminClient.from('trips').select('*').neq('status', 'deleted'),
      adminClient.from('driver_trips').select('*').neq('status', 'deleted')
    ]);

    const vehicles = vehiclesRes.data || [];
    const workerTrips = workerTripsRes.data || [];
    const driverTrips = driverTripsRes.data || [];
    const allTrips = [...workerTrips, ...driverTrips];

    const activeDrivers = drivers.filter(d => d.is_active).length;
    const availableVehicles = vehicles.filter(v => v.is_active !== false).length;

    const activeTrips = allTrips.filter(t => ['active', 'in_progress', 'ready', 'assigned'].includes(t.status));
    const vehiclesOnTrip = new Set(activeTrips.map(t => t.tanker_number || t.vehicle_number).filter(Boolean)).size;

    const completedTrips = allTrips.filter(t => t.status === 'completed').length;
    const todayDuties = driverTrips.length;

    const vehicleUtilization = [
      { label: 'Active', value: vehiclesOnTrip },
      { label: 'Available', value: Math.max(0, availableVehicles - vehiclesOnTrip) },
      { label: 'Inactive', value: Math.max(0, vehicles.length - availableVehicles) }
    ];

    const driverTripsMap = {};
    driverTrips.forEach(t => {
      const driverName = t.driver_name || 'Driver';
      driverTripsMap[driverName] = (driverTripsMap[driverName] || 0) + 1;
    });

    const driverPerformance = Object.entries(driverTripsMap)
      .map(([name, trips]) => ({ name, trips }))
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 10);

    const driverStats = {};
    drivers.forEach(d => {
      driverStats[d.id] = {
        total_trips: d.total_trips,
        assigned_vehicle: d.assigned_vehicle,
        last_activity: d.last_activity
      };
    });

    res.json({
      totalVehicles: vehicles.length,
      totalDrivers: drivers.length,
      activeDrivers,
      availableVehicles,
      vehiclesOnTrip,
      todayDuties,
      completedTrips,
      vehicleUtilization,
      driverPerformance,
      recentDuties: driverTrips.slice(0, 5),
      activeDrivers: drivers,
      driverStats
    });

  } catch (err) {
    console.error('Transport dashboard error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard data' });
  }
});

// ─── TRANSPORT DRIVER ENDPOINTS ───────────────────────────────────────────────
app.get('/api/transport/drivers', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;

  try {
    const drivers = await getUnifiedDrivers(adminClient);
    res.json({ drivers });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch drivers' });
  }
});

app.post('/api/transport/drivers', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const { name, license_number, phone, is_active } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Driver name and phone are required' });
  }

  try {
    const { data, error } = await adminClient
      .from('drivers')
      .insert({ name, license_number, phone, is_active: is_active !== false })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ driver: data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create driver' });
  }
});

app.put('/api/transport/drivers/:id', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const { name, license_number, phone, is_active } = req.body;

  try {
    const { data, error } = await adminClient
      .from('drivers')
      .update({ name, license_number, phone, is_active, updated_at: new Date() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ driver: data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update driver' });
  }
});

app.delete('/api/transport/drivers/:id', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const driverId = req.params.id;

  try {
    // Unlink driver from historical trips to prevent foreign key error while keeping trip records intact
    await adminClient.from('trips').update({ driver_id: null }).eq('driver_id', driverId);
    await adminClient.from('driver_trips').update({ assigned_driver_id: null }).eq('assigned_driver_id', driverId);

    const { error } = await adminClient.from('drivers').delete().eq('id', driverId);
    if (error) throw error;
    res.json({ success: true, message: 'Driver deleted successfully. Historical trip records preserved.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete driver' });
  }
});

app.get('/api/transport/drivers/:id/performance', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;

  try {
    const { data: driver } = await adminClient.from('drivers').select('*').eq('id', req.params.id).single();
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    const { data: trips } = await adminClient.from('trips').select('*').neq('status', 'deleted');
    const driverTrips = (trips || []).filter(t => t.driver_name === driver.name);

    const completedTrips = driverTrips.filter(t => t.status === 'completed');

    // Get visits count
    const tripIds = driverTrips.map(t => t.id);
    let totalVisits = 0;
    if (tripIds.length > 0) {
      const { data: visits } = await adminClient.from('trip_bmc_visits').select('id').in('trip_id', tripIds);
      totalVisits = (visits || []).length;
    }

    // Calculate average duration
    const durationsMs = completedTrips
      .filter(t => t.out_time && t.in_time)
      .map(t => new Date(t.in_time) - new Date(t.out_time))
      .filter(d => d > 0);

    const avgDurationMs = durationsMs.length > 0
      ? durationsMs.reduce((sum, d) => sum + d, 0) / durationsMs.length
      : null;

    res.json({
      total_trips: driverTrips.length,
      completed_trips: completedTrips.length,
      total_visits: totalVisits,
      avg_duration_ms: avgDurationMs
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch driver performance' });
  }
});

// ─── TRANSPORT VEHICLE ENDPOINTS ──────────────────────────────────────────────
app.get('/api/transport/vehicles', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;

  try {
    const { data: vehicles } = await adminClient.from('tankers').select('*').order('board_number');
    const { data: trips } = await adminClient.from('trips').select('*').neq('status', 'deleted');

    const vehiclesWithStats = (vehicles || []).map(vehicle => {
      const vehicleTrips = (trips || []).filter(t => t.tanker_number === vehicle.board_number);
      const lastTrip = vehicleTrips.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

      return {
        ...vehicle,
        total_trips: vehicleTrips.length,
        assigned_driver: lastTrip?.driver_name || null,
        last_used: lastTrip?.created_at || null
      };
    });

    res.json({ vehicles: vehiclesWithStats });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch vehicles' });
  }
});

app.post('/api/transport/vehicles', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const { board_number, capacity_liters, compartments, is_active } = req.body;

  if (!board_number) {
    return res.status(400).json({ error: 'Vehicle board number is required' });
  }

  try {
    const { data, error } = await adminClient
      .from('tankers')
      .insert({
        board_number,
        capacity_liters: capacity_liters || 5000,
        compartments: compartments || 2,
        is_active: is_active !== false
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ vehicle: data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create vehicle' });
  }
});

app.put('/api/transport/vehicles/:id', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const { board_number, capacity_liters, compartments, is_active } = req.body;

  try {
    const { data, error } = await adminClient
      .from('tankers')
      .update({ board_number, capacity_liters, compartments, is_active, updated_at: new Date() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ vehicle: data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update vehicle' });
  }
});

app.delete('/api/transport/vehicles/:id', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;

  try {
    const { error } = await adminClient.from('tankers').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete vehicle' });
  }
});

app.get('/api/transport/vehicles/:id/performance', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;

  try {
    const { data: vehicle } = await adminClient.from('tankers').select('*').eq('id', req.params.id).single();
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const { data: trips } = await adminClient.from('trips').select('*').neq('status', 'deleted');
    const vehicleTrips = (trips || []).filter(t => t.tanker_number === vehicle.board_number);

    const lastTrip = vehicleTrips.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    // Get visits count
    const tripIds = vehicleTrips.map(t => t.id);
    let totalVisits = 0;
    if (tripIds.length > 0) {
      const { data: visits } = await adminClient.from('trip_bmc_visits').select('id').in('trip_id', tripIds);
      totalVisits = (visits || []).length;
    }

    res.json({
      total_trips: vehicleTrips.length,
      assigned_driver: lastTrip?.driver_name || null,
      total_visits: totalVisits,
      last_used: lastTrip?.created_at || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch vehicle performance' });
  }
});

// ─── TRANSPORT DUTY ENDPOINTS ─────────────────────────────────────────────────
app.get('/api/transport/duties', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const { date, status, dateRange } = req.query;

  try {
    // For now, return duties based on trips (placeholder until duties table is created)
    let query = adminClient.from('trips').select('*').neq('status', 'deleted');

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      query = query.gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString());
    } else if (dateRange === 'this_week') {
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      query = query.gte('created_at', startOfWeek.toISOString());
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: trips } = await query.order('created_at', { ascending: false });

    const { data: profiles } = await adminClient.from('profiles').select('id, name');
    const profileMap = {};
    (profiles || []).forEach(p => profileMap[p.id] = p.name);

    const duties = (trips || []).map(trip => ({
      id: trip.id,
      duty_number: trip.trip_number,
      duty_date: trip.created_at,
      duty_time: new Date(trip.out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      driver_name: trip.driver_name,
      vehicle_number: trip.tanker_number,
      route: trip.trip_name,
      task: trip.trip_name,
      worker_name: profileMap[trip.worker_id] || null,
      status: trip.status,
      remarks: trip.remarks
    }));

    res.json({ duties });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch duties' });
  }
});

// ─── TRANSPORT DRIVER ANALYSIS ────────────────────────────────────────────────
app.get('/api/transport/driver-analysis', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const { driverId, startDate, endDate } = req.query;

  if (!driverId || !startDate || !endDate) {
    return res.status(400).json({ error: 'driverId, startDate, and endDate are required' });
  }

  try {
    // Step 1: Resolve driver — first check profiles (registered users), then legacy drivers table
    let driverName = null;
    let driverEmail = null;

    const { data: profileDriver } = await adminClient
      .from('profiles')
      .select('id, name, email')
      .eq('id', driverId)
      .maybeSingle();

    if (profileDriver) {
      driverName = profileDriver.name;
      driverEmail = profileDriver.email;
    } else {
      // Fallback: legacy drivers table
      const { data: legacyDriver } = await adminClient
        .from('drivers')
        .select('id, name')
        .eq('id', driverId)
        .maybeSingle();
      if (!legacyDriver) {
        return res.status(404).json({ error: 'Driver not found. Ensure the driver has registered via Gmail.' });
      }
      driverName = legacyDriver.name;
    }

    const startIso = new Date(startDate).toISOString();
    const endD = new Date(endDate);
    endD.setHours(23, 59, 59, 999);
    const endIso = endD.toISOString();

    // Step 2: Fetch driver_trips (profile-based trip assignments) first
    const { data: driverTripsData } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .gte('created_at', startIso)
      .lte('created_at', endIso);

    // Step 3: Fetch legacy trips matched by driver_name as fallback
    const { data: legacyTripsData } = await adminClient
      .from('trips')
      .select('*')
      .gte('created_at', startIso)
      .lte('created_at', endIso);

    const legacyTrips = (legacyTripsData || []).filter(t =>
      t.driver_name && driverName && t.driver_name.toLowerCase().trim() === driverName.toLowerCase().trim()
    );

    // Use driver_trips as primary (profile-based), merge legacy if needed
    const primaryTrips = (driverTripsData || []).map(t => ({
      ...t,
      trip_name: t.route || t.destination || 'Trip',
      out_time: t.started_at,
      in_time: t.completed_at,
      tanker_number: t.vehicle_number,
      source: 'driver_trips'
    }));

    const allTrips = primaryTrips.length > 0 ? primaryTrips : legacyTrips.map(t => ({ ...t, source: 'trips' }));

    // Step 4: Get BMC visits for driver_trip IDs
    const driverTripIds = primaryTrips.map(t => t.id);
    const legacyTripIds = legacyTrips.map(t => t.id);
    let visits = [];
    if (driverTripIds.length > 0) {
      const { data: v1 } = await adminClient
        .from('driver_trip_bmc_visits')
        .select('*')
        .in('driver_trip_id', driverTripIds);
      // Fallback to trip_bmc_visits with driver_trip_id
      const { data: v2 } = await adminClient
        .from('trip_bmc_visits')
        .select('*')
        .in('trip_id', [...driverTripIds, ...legacyTripIds]);
      visits = [...(v1 || []), ...(v2 || [])];
    } else if (legacyTripIds.length > 0) {
      const { data: v } = await adminClient
        .from('trip_bmc_visits')
        .select('*')
        .in('trip_id', legacyTripIds);
      visits = v || [];
    }

    // Step 5: Calculate metrics
    const completedTrips = allTrips.filter(t => t.status === 'completed');
    const totalVisits = visits.length;

    const durationsMs = completedTrips
      .filter(t => t.out_time && t.in_time)
      .map(t => new Date(t.in_time) - new Date(t.out_time))
      .filter(d => d > 0);

    const avgDurationMs = durationsMs.length > 0
      ? durationsMs.reduce((sum, d) => sum + d, 0) / durationsMs.length
      : 0;

    const totalHoursMs = durationsMs.reduce((sum, d) => sum + d, 0);
    const daysDiff = Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)));
    const tripsPerDay = allTrips.length / daysDiff;
    const visitsPerTrip = allTrips.length > 0 ? totalVisits / allTrips.length : 0;

    const metrics = {
      total_trips: allTrips.length,
      completed_trips: completedTrips.length,
      total_visits: totalVisits,
      avg_duration_ms: Math.round(avgDurationMs),
      total_hours_ms: totalHoursMs,
      trips_per_day: tripsPerDay,
      visits_per_trip: visitsPerTrip
    };

    // Step 6: Chart data — group by date
    const dateMap = {};
    allTrips.forEach(trip => {
      const date = new Date(trip.created_at).toISOString().split('T')[0];
      if (!dateMap[date]) dateMap[date] = { trips: 0, visits: 0, duration: 0, dutyHours: 0 };
      dateMap[date].trips += 1;

      const tripVisits = visits.filter(v => v.trip_id === trip.id || v.driver_trip_id === trip.id).length;
      dateMap[date].visits += tripVisits;

      if (trip.out_time && trip.in_time) {
        const durationMs = new Date(trip.in_time) - new Date(trip.out_time);
        if (durationMs > 0) {
          dateMap[date].duration += durationMs / (1000 * 60 * 60);
          dateMap[date].dutyHours += durationMs / (1000 * 60 * 60);
        }
      }
    });

    const dates = Object.keys(dateMap).sort();
    const chartData = {
      dates: dates.map(d => new Date(d).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })),
      trips_by_date: dates.map(d => dateMap[d].trips),
      visits_by_date: dates.map(d => dateMap[d].visits),
      duration_by_date: dates.map(d => dateMap[d].duration.toFixed(1)),
      duty_hours_by_date: dates.map(d => dateMap[d].dutyHours.toFixed(1))
    };

    // Step 7: Enrich trips for history table
    const enrichedTrips = allTrips.map(trip => {
      const tripVisits = visits.filter(v => v.trip_id === trip.id || v.driver_trip_id === trip.id);
      let durationMs = null;
      if (trip.out_time && trip.in_time) {
        durationMs = new Date(trip.in_time) - new Date(trip.out_time);
      }
      return {
        ...trip,
        visits_count: tripVisits.length,
        duration_ms: durationMs,
        vehicle_number: trip.vehicle_number || trip.tanker_number || '—'
      };
    });

    res.json({
      driver: { id: driverId, name: driverName, email: driverEmail },
      metrics,
      chartData,
      trips: enrichedTrips
    });

  } catch (err) {
    console.error('Driver analysis error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch driver analysis' });
  }
});




// ─── DRIVER MIDDLEWARE ────────────────────────────────────────────────────────
async function requireDriver(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server database not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient.from('profiles').select('*').eq('id', user.id).single();
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (profile.role !== 'driver' && profile.role !== 'admin') {
    return res.status(403).json({ error: 'Driver access required.' });
  }
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Account not yet approved.' });

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

// ─── Helper: Calculate Mileage ────────────────────────────────────────────────
function calcMileage(outWeight, inWeight, outKm, inKm) {
  const weightDiff = Number(outWeight) - Number(inWeight);
  const kmTravelled = Number(inKm) - Number(outKm);
  if (weightDiff === 0) {
    return { weightDiff: 0, kmTravelled, dieselConsumption: 0, averageMileage: null };
  }
  const dieselConsumption = weightDiff / 0.832;
  const averageMileage = dieselConsumption > 0 ? kmTravelled / dieselConsumption : null;
  return {
    weightDiff: Number(weightDiff.toFixed(4)),
    kmTravelled: Number(kmTravelled.toFixed(4)),
    dieselConsumption: Number(dieselConsumption.toFixed(4)),
    averageMileage: averageMileage !== null ? Number(averageMileage.toFixed(4)) : null
  };
}

// ─── GET /api/driver/dashboard ────────────────────────────────────────────────
app.get('/api/driver/dashboard', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const today = new Date();
    const startOfDay = new Date(today); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today); endOfDay.setHours(23, 59, 59, 999);

    // Fetch driver trips
    const { data: trips } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('assigned_driver_id', profile.id)
      .order('created_at', { ascending: false });

    const allTrips = trips || [];
    const completedTrips = allTrips.filter(t => t.status === 'completed');
    const todayTrips = allTrips.filter(t => {
      const d = new Date(t.scheduled_start_time || t.created_at);
      return d >= startOfDay && d <= endOfDay;
    });
    const activeTrip = allTrips.find(t => ['assigned','accepted','ready','in_progress','returning'].includes(t.status));

    // Today's work time
    const todayCompleted = completedTrips.filter(t => {
      const d = new Date(t.completed_at || t.updated_at);
      return t.started_at && t.completed_at && d >= startOfDay && d <= endOfDay;
    });
    const todayWorkMs = todayCompleted.reduce((sum, t) =>
      sum + (new Date(t.completed_at) - new Date(t.started_at)), 0);

    // Total KM
    const totalKm = completedTrips.reduce((sum, t) => sum + (Number(t.km_travelled) || 0), 0);

    // Assigned vehicle
    const { data: vehicle } = await adminClient
      .from('tankers')
      .select('*')
      .eq('assigned_driver_id', profile.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    res.json({
      driver: { id: profile.id, name: profile.name, email: profile.email, profile_image_url: profile.profile_image_url },
      total_trips: allTrips.length,
      today_trips: todayTrips.length,
      completed_trips: completedTrips.length,
      today_work_ms: todayWorkMs,
      total_km: Number(totalKm.toFixed(2)),
      active_trip: activeTrip || null,
      vehicle: vehicle || null,
      trips: allTrips.slice(0, 20)
    });
  } catch (err) {
    console.error('Driver dashboard error:', err);
    res.status(500).json({ error: err.message || 'Failed to load driver dashboard.' });
  }
});

// ─── GET /api/driver/trips ────────────────────────────────────────────────────
app.get('/api/driver/trips', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const { data: trips, error } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('assigned_driver_id', profile.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ trips: trips || [] });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch trips.' });
  }
});

// ─── GET /api/driver/trips/:id ────────────────────────────────────────────────
app.get('/api/driver/trips/:id', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const { data: trip, error } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('id', req.params.id)
      .eq('assigned_driver_id', profile.id)
      .single();

    if (error || !trip) return res.status(404).json({ error: 'Trip not found or access denied.' });
    res.json({ trip });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch trip.' });
  }
});

// ─── POST /api/driver/trips/:id/accept ────────────────────────────────────────
app.post('/api/driver/trips/:id/accept', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    // Fetch trip
    const { data: trip } = await adminClient
      .from('driver_trips').select('*').eq('id', req.params.id).single();

    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (trip.assigned_driver_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });
    if (trip.status !== 'assigned') return res.status(400).json({ error: `Cannot accept trip with status: ${trip.status}.` });

    // Atomic update — only update if status is still 'assigned' (race condition protection)
    const { data: updated, error } = await adminClient
      .from('driver_trips')
      .update({ status: 'accepted', accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('status', 'assigned') // Ensures atomic check
      .select()
      .single();

    if (error || !updated) {
      return res.status(409).json({ error: 'Trip was already accepted or modified. Please refresh.' });
    }

    res.json({ trip: updated, message: 'Trip accepted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to accept trip.' });
  }
});

// ─── POST /api/driver/trips/:id/start ────────────────────────────────────────
app.post('/api/driver/trips/:id/start', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  const { out_km, out_km_photo, out_tanker_weight, latitude, longitude } = req.body;

  if (out_km === undefined || out_km === null || out_km === '') return res.status(400).json({ error: 'out_km is required.' });
  if (!out_km_photo) return res.status(400).json({ error: 'out_km_photo (Out KM photo proof) is required.' });
  if (out_tanker_weight === undefined || out_tanker_weight === null || out_tanker_weight === '') return res.status(400).json({ error: 'out_tanker_weight is required.' });
  if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) return res.status(400).json({ error: 'Current GPS location (latitude, longitude) is required.' });

  try {
    const { data: trip } = await adminClient
      .from('driver_trips').select('*').eq('id', req.params.id).single();

    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (trip.assigned_driver_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });
    if (!['assigned', 'accepted', 'ready'].includes(trip.status)) {
      return res.status(400).json({ error: `Cannot start trip with status: ${trip.status}.` });
    }

    // Prevent duplicate start
    if (trip.started_at || trip.status === 'in_progress') {
      return res.status(409).json({ error: 'Trip has already been started.' });
    }

    // If photo is a raw base64 DataURL (storage fallback), truncate to avoid
    // Supabase PostgREST rejecting the oversized update payload.
    const safePhotoValue = (out_km_photo && out_km_photo.startsWith('data:'))
      ? out_km_photo.substring(0, 500) + '...[base64_truncated]'
      : out_km_photo;

    const { data: updated, error } = await adminClient
      .from('driver_trips')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
        out_km: Number(out_km),
        out_weight: Number(out_tanker_weight),
        out_weight_photo: safePhotoValue,
        start_lat: Number(latitude),
        start_lng: Number(longitude),
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .in('status', ['assigned', 'accepted', 'ready']) // Atomic check
      .select()
      .single();

    if (error || !updated) {
      return res.status(409).json({ error: 'Trip status changed while starting. Please refresh.' });
    }

    res.json({ trip: updated, message: 'Trip started successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to start trip.' });
  }
});

// ─── POST /api/driver/trips/:id/complete ─────────────────────────────────────
app.post('/api/driver/trips/:id/complete', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  const { in_km, in_weight, in_weight_photo, end_lat, end_lng, remarks } = req.body;

  if (!in_km && in_km !== 0) return res.status(400).json({ error: 'in_km is required.' });
  if (!in_weight && in_weight !== 0) return res.status(400).json({ error: 'in_weight is required.' });
  if (!in_weight_photo) return res.status(400).json({ error: 'in_weight_photo is required.' });
  if (!end_lat || !end_lng) return res.status(400).json({ error: 'GPS location (end_lat, end_lng) is required.' });

  try {
    const { data: trip } = await adminClient
      .from('driver_trips').select('*').eq('id', req.params.id).single();

    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (trip.assigned_driver_id !== profile.id) return res.status(403).json({ error: 'Access denied.' });
    if (!['in_progress', 'returning'].includes(trip.status)) {
      return res.status(400).json({ error: `Cannot complete trip with status: ${trip.status}.` });
    }
    if (trip.completed_at) {
      return res.status(409).json({ error: 'Trip has already been completed.' });
    }

    // Validations
    const inKmNum = Number(in_km);
    const inWeightNum = Number(in_weight);
    const outKm = trip.out_km;
    const outWeight = trip.out_weight;

    if (outKm !== null && outKm !== undefined && inKmNum < outKm) {
      return res.status(400).json({ error: `In KM (${inKmNum}) cannot be less than Out KM (${outKm}).` });
    }
    if (outWeight !== null && outWeight !== undefined && inWeightNum > outWeight) {
      return res.status(400).json({ error: `In Weight (${inWeightNum}) cannot exceed Out Weight (${outWeight} kg).` });
    }

    // Calculate mileage
    let mileageData = {};
    if (outKm !== null && outWeight !== null && outKm !== undefined && outWeight !== undefined) {
      const calc = calcMileage(outWeight, inWeightNum, outKm, inKmNum);
      mileageData = {
        km_travelled: calc.kmTravelled,
        weight_difference: calc.weightDiff,
        diesel_consumption: calc.dieselConsumption,
        average_mileage: calc.averageMileage
      };
    }

    const { data: updated, error } = await adminClient
      .from('driver_trips')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        in_km: inKmNum,
        in_weight: inWeightNum,
        in_weight_photo,
        end_lat: Number(end_lat),
        end_lng: Number(end_lng),
        remarks: remarks || null,
        ...mileageData,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .in('status', ['in_progress', 'returning']) // Atomic check
      .select()
      .single();

    if (error || !updated) {
      return res.status(409).json({ error: 'Trip status changed while completing. Please refresh.' });
    }

    res.json({ trip: updated, message: 'Trip completed successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to complete trip.' });
  }
});

// Helper: Calculate distance in meters between two lat/lng points
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// ─── PATCH /api/driver/trips/:id/location ────────────────────────────────────
app.patch('/api/driver/trips/:id/location', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  const { lat, lng, points, tracking_status } = req.body;

  try {
    const { data: trip } = await adminClient
      .from('driver_trips')
      .select('id, assigned_driver_id, status, remarks, start_lat, start_lng, end_lat, end_lng, journey_path')
      .eq('id', req.params.id)
      .single();

    if (!trip || trip.assigned_driver_id !== profile.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (!['started', 'in_progress', 'active', 'returning'].includes(trip.status)) {
      return res.status(400).json({ error: 'Trip is not currently active.' });
    }

    // Decode existing journey points
    let journey = [];
    if (Array.isArray(trip.journey_path) && trip.journey_path.length > 0) {
      journey = [...trip.journey_path];
    } else if (trip.remarks && trip.remarks.includes('__JOURNEY_DATA__=')) {
      try {
        const jStr = trip.remarks.split('__JOURNEY_DATA__=')[1].split('\n')[0];
        journey = JSON.parse(jStr);
      } catch(e) {}
    }

    if (journey.length === 0 && trip.start_lat && trip.start_lng) {
      journey.push({ lat: Number(trip.start_lat), lng: Number(trip.start_lng), timestamp: trip.started_at || new Date().toISOString() });
    }

    const newPoints = [];
    if (Array.isArray(points) && points.length > 0) {
      points.forEach(pt => {
        if (pt && pt.lat && pt.lng) {
          newPoints.push({ lat: Number(pt.lat), lng: Number(pt.lng), timestamp: pt.timestamp || new Date().toISOString() });
        }
      });
    } else if (lat && lng) {
      newPoints.push({ lat: Number(lat), lng: Number(lng), timestamp: new Date().toISOString() });
    }

    // Append new points while avoiding unnecessary duplicates (<5 meters & <30s)
    let addedCount = 0;
    newPoints.forEach(pt => {
      if (journey.length > 0) {
        const lastPt = journey[journey.length - 1];
        const dist = calculateDistanceMeters(lastPt.lat, lastPt.lng, pt.lat, pt.lng);
        const timeDiffMs = new Date(pt.timestamp).getTime() - new Date(lastPt.timestamp || 0).getTime();
        
        if (dist >= 5 || timeDiffMs >= 30000) {
          journey.push(pt);
          addedCount++;
        }
      } else {
        journey.push(pt);
        addedCount++;
      }
    });

    const latestPt = journey[journey.length - 1] || (newPoints.length > 0 ? newPoints[newPoints.length - 1] : null);
    const endLat = latestPt ? latestPt.lat : trip.end_lat;
    const endLng = latestPt ? latestPt.lng : trip.end_lng;

    // Decode existing interruptions
    let interruptions = [];
    let cleanRemarks = trip.remarks || '';
    if (cleanRemarks.includes('__INTERRUPTIONS_DATA__=')) {
      try {
        const iStr = cleanRemarks.split('__INTERRUPTIONS_DATA__=')[1].split('\n')[0];
        interruptions = JSON.parse(iStr);
      } catch(e) {}
    }
    
    if (tracking_status) {
      interruptions.push({ status: tracking_status, timestamp: new Date().toISOString() });
    }

    // Reconstruct remarks string with embedded data for full backward compatibility
    let baseRemarks = (cleanRemarks.split('\n__JOURNEY_DATA__=')[0] || '').split('\n__INTERRUPTIONS_DATA__=')[0].trim();
    let updatedRemarks = baseRemarks;
    if (journey.length > 0) {
      updatedRemarks += `\n__JOURNEY_DATA__=${JSON.stringify(journey)}`;
    }
    if (interruptions.length > 0) {
      updatedRemarks += `\n__INTERRUPTIONS_DATA__=${JSON.stringify(interruptions)}`;
    }

    const updatePayload = {
      end_lat: endLat,
      end_lng: endLng,
      remarks: updatedRemarks,
      updated_at: new Date().toISOString()
    };

    // Also update journey_path column if column exists
    try {
      updatePayload.journey_path = journey;
    } catch(e) {}

    const { data, error } = await adminClient
      .from('driver_trips')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select('id, end_lat, end_lng, updated_at')
      .single();

    if (error) throw error;

    res.json({
      success: true,
      points_added: addedCount,
      total_points: journey.length,
      latest_location: { lat: endLat, lng: endLng },
      updated_at: data.updated_at
    });
  } catch (err) {
    console.error('Location update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update location.' });
  }
});

// ─── GET /api/transport/active-duties-locations ──────────────────────────────
app.get('/api/transport/active-duties-locations', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: activeTrips, error } = await adminClient
      .from('driver_trips')
      .select('id, trip_number, assigned_driver_id, vehicle_number, route, destination, bmc_name, status, start_lat, start_lng, end_lat, end_lng, remarks, journey_path, updated_at, started_at')
      .in('status', ['started', 'in_progress', 'active', 'returning']);

    if (error) throw error;

    // Enrich driver profiles
    const driverIds = (activeTrips || []).map(t => t.assigned_driver_id).filter(Boolean);
    let driverMap = {};
    if (driverIds.length > 0) {
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('id, name, phone')
        .in('id', driverIds);
      (profiles || []).forEach(p => { driverMap[p.id] = p; });
    }

    const result = (activeTrips || []).map(trip => {
      let journey = [];
      if (Array.isArray(trip.journey_path) && trip.journey_path.length > 0) {
        journey = trip.journey_path;
      } else if (trip.remarks && trip.remarks.includes('__JOURNEY_DATA__=')) {
        try {
          const jStr = trip.remarks.split('__JOURNEY_DATA__=')[1].split('\n')[0];
          journey = JSON.parse(jStr);
        } catch(e) {}
      }

      if (journey.length === 0 && trip.start_lat && trip.start_lng) {
        journey.push({ lat: Number(trip.start_lat), lng: Number(trip.start_lng), timestamp: trip.started_at || trip.updated_at });
      }

      const driverProfile = driverMap[trip.assigned_driver_id] || {};
      const driverName = driverProfile.name || 'Driver';

      const latestPt = journey.length > 0 ? journey[journey.length - 1] : (trip.end_lat && trip.end_lng ? { lat: Number(trip.end_lat), lng: Number(trip.end_lng), timestamp: trip.updated_at } : null);

      return {
        id: trip.id,
        trip_number: trip.trip_number,
        driver_id: trip.assigned_driver_id,
        driver_name: driverName,
        vehicle_number: trip.vehicle_number || '—',
        route: trip.route || trip.destination || trip.bmc_name || 'Route',
        status: trip.status,
        latest_location: latestPt,
        journey_path: journey,
        updated_at: trip.updated_at
      };
    });

    res.json({ activeDuties: result });
  } catch (err) {
    console.error('Failed to fetch active duties locations:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch active duties locations' });
  }
});


// ─── GET /api/driver/history ──────────────────────────────────────────────────
app.get('/api/driver/history', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  const { range, startDate, endDate } = req.query;

  try {
    let startIso, endIso;
    const now = new Date();

    if (range === 'today') {
      const s = new Date(now); s.setHours(0,0,0,0);
      const e = new Date(now); e.setHours(23,59,59,999);
      startIso = s.toISOString(); endIso = e.toISOString();
    } else if (range === 'yesterday') {
      const s = new Date(now); s.setDate(s.getDate()-1); s.setHours(0,0,0,0);
      const e = new Date(now); e.setDate(e.getDate()-1); e.setHours(23,59,59,999);
      startIso = s.toISOString(); endIso = e.toISOString();
    } else if (range === 'week') {
      const s = new Date(now); s.setDate(now.getDate() - now.getDay()); s.setHours(0,0,0,0);
      startIso = s.toISOString(); endIso = now.toISOString();
    } else if (range === 'month') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      startIso = s.toISOString(); endIso = now.toISOString();
    } else if (range === 'custom' && startDate && endDate) {
      startIso = new Date(startDate + 'T00:00:00').toISOString();
      const e = new Date(endDate + 'T23:59:59');
      endIso = e.toISOString();
    } else {
      // Default: last 30 days
      const s = new Date(now); s.setDate(s.getDate()-30);
      startIso = s.toISOString(); endIso = now.toISOString();
    }

    const { data: trips, error } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('assigned_driver_id', profile.id)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ trips: trips || [] });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch trip history.' });
  }
});

// ─── GET /api/driver/worktime ─────────────────────────────────────────────────
app.get('/api/driver/worktime', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const now = new Date();

    // Time ranges
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate()-now.getDay()); weekStart.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const { data: trips } = await adminClient
      .from('driver_trips')
      .select('started_at, completed_at, km_travelled, status, scheduled_start_time, created_at')
      .eq('assigned_driver_id', profile.id)
      .eq('status', 'completed')
      .not('started_at', 'is', null)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false });

    const allTrips = trips || [];

    function sumWorkMs(tripList) {
      return tripList.reduce((sum, t) => {
        const ms = new Date(t.completed_at) - new Date(t.started_at);
        return sum + (ms > 0 ? ms : 0);
      }, 0);
    }

    const todayTrips = allTrips.filter(t => new Date(t.completed_at) >= todayStart);
    const weekTrips = allTrips.filter(t => new Date(t.completed_at) >= weekStart);
    const monthTrips = allTrips.filter(t => new Date(t.completed_at) >= monthStart);

    // Daily breakdown for current week (Mon–Sun)
    const daily = {};
    weekTrips.forEach(t => {
      const dateKey = new Date(t.completed_at).toISOString().split('T')[0];
      if (!daily[dateKey]) daily[dateKey] = { date: dateKey, trips_completed: 0, work_ms: 0, km_travelled: 0 };
      const ms = new Date(t.completed_at) - new Date(t.started_at);
      daily[dateKey].trips_completed++;
      daily[dateKey].work_ms += ms > 0 ? ms : 0;
      daily[dateKey].km_travelled += Number(t.km_travelled) || 0;
    });

    const dailyBreakdown = Object.keys(daily).sort().map(d => ({
      date: d,
      date_label: new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      trips_completed: daily[d].trips_completed,
      work_ms: daily[d].work_ms,
      km_travelled: Number(daily[d].km_travelled.toFixed(2))
    }));

    res.json({
      today_ms: sumWorkMs(todayTrips),
      today_trips: todayTrips.length,
      week_ms: sumWorkMs(weekTrips),
      week_trips: weekTrips.length,
      month_ms: sumWorkMs(monthTrips),
      month_trips: monthTrips.length,
      daily_breakdown: dailyBreakdown
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch work time.' });
  }
});

// ─── GET /api/driver/vehicle ──────────────────────────────────────────────────
app.get('/api/driver/vehicle', requireDriver, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const { data: vehicle } = await adminClient
      .from('tankers')
      .select('*')
      .eq('assigned_driver_id', profile.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    res.json({ vehicle: vehicle || null });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch vehicle.' });
  }
});

// ─── POST /api/driver/upload ──────────────────────────────────────────────────
app.post('/api/driver/upload', requireDriver, async (req, res) => {
  const { adminClient } = req;
  const { imageBase64, filename } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Image data is required.' });

  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = (filename && filename.split('.').pop()) || 'jpg';
    const filePath = `driver-photos/${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;

    const { error: uploadErr } = await adminClient.storage
      .from('profile_images')
      .upload(filePath, buffer, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`, upsert: true });

    if (uploadErr) {
      console.warn('Driver photo upload error, returning data URL:', uploadErr.message);
      return res.json({ publicUrl: imageBase64 });
    }

    const { data: publicUrlData } = adminClient.storage.from('profile_images').getPublicUrl(filePath);
    res.json({ publicUrl: publicUrlData.publicUrl });
  } catch (err) {
    console.error('Driver upload error:', err);
    res.json({ publicUrl: imageBase64 }); // Fallback: return base64
  }
});

// ─── TRANSPORT OFFICER: Assign Driver Trips ────────────────────────────────────
app.post('/api/transport/driver-trips', requireTransportOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  const {
    assigned_driver_id, vehicle_id, vehicle_number,
    bmc_id, bmc_ids, bmc_name, bmc_names, selected_bmcs, route,
    duty_type, scheduled_start_time, remarks
  } = req.body;

  if (!assigned_driver_id) return res.status(400).json({ error: 'assigned_driver_id is required.' });

  try {
    // Verify driver exists
    const drivers = await getUnifiedDrivers(adminClient);
    const driverProfile = drivers.find(d => d.id === assigned_driver_id || d.name === assigned_driver_id);
    if (!driverProfile) {
      return res.status(400).json({ error: 'Invalid driver selected.' });
    }

    let computedBmcName = bmc_name;
    if (Array.isArray(selected_bmcs) && selected_bmcs.length > 0) {
      computedBmcName = selected_bmcs.map((b, idx) => `${idx + 1}. ${b.bmc_name || 'BMC'} — ${b.compartment || 'Front'}`).join(' | ');
    } else if (Array.isArray(bmc_names) && bmc_names.length > 0) {
      computedBmcName = bmc_names.join(' ➔ ');
    }

    // Embed BMC data backup into remarks to guarantee zero data loss
    let bmcJsonBackup = '';
    if (Array.isArray(selected_bmcs) && selected_bmcs.length > 0) {
      bmcJsonBackup = `\n__BMC_DATA__=${JSON.stringify(selected_bmcs)}`;
    }
    const finalRemarks = (remarks || '') + bmcJsonBackup;

    const payload = {
      assigned_driver_id: driverProfile.id,
      assigned_by: profile.id,
      vehicle_id: vehicle_id || null,
      vehicle_number: vehicle_number || null,
      bmc_id: bmc_id || (Array.isArray(selected_bmcs) && selected_bmcs[0]?.bmc_id) || (Array.isArray(bmc_ids) && bmc_ids[0]) || null,
      bmc_name: computedBmcName || null,
      destination: computedBmcName || null,
      route: route || null,
      duty_type: duty_type || 'Morning Duty',
      selected_bmcs: Array.isArray(selected_bmcs) ? selected_bmcs : [],
      scheduled_start_time: scheduled_start_time || new Date().toISOString(),
      remarks: finalRemarks || null,
      status: 'assigned'
    };

    let { data: newTrip, error } = await adminClient
      .from('driver_trips')
      .insert(payload)
      .select()
      .single();

    // Fallback if schema does not yet have duty_type or selected_bmcs column
    if (error && (error.message?.includes('duty_type') || error.message?.includes('selected_bmcs'))) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.duty_type;
      delete fallbackPayload.selected_bmcs;
      const retry = await adminClient
        .from('driver_trips')
        .insert(fallbackPayload)
        .select()
        .single();
      newTrip = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    res.status(201).json({ trip: newTrip, message: 'Driver trip assigned successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to assign driver trip.' });
  }
});

// GET /api/transport/driver-trips — List all driver trips (for Transport Officer/GM view)
app.get('/api/transport/driver-trips', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const { status, driver_id, date } = req.query;

  try {
    let query = adminClient.from('driver_trips').select('*').neq('status', 'deleted').order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (driver_id) query = query.eq('assigned_driver_id', driver_id);
    if (date) {
      const s = new Date(date); s.setHours(0,0,0,0);
      const e = new Date(date); e.setHours(23,59,59,999);
      query = query.gte('created_at', s.toISOString()).lte('created_at', e.toISOString());
    }

    const { data: trips, error } = await query.limit(200);
    if (error) throw error;

    // Enrich with driver names
    const driverIds = [...new Set((trips || []).map(t => t.assigned_driver_id).filter(Boolean))];
    let driverMap = {};
    if (driverIds.length > 0) {
      const { data: profiles } = await adminClient
        .from('profiles').select('id, name').in('id', driverIds);
      (profiles || []).forEach(p => { driverMap[p.id] = p.name; });
    }

    const enriched = (trips || []).map(t => ({
      ...t,
      driver_name: driverMap[t.assigned_driver_id] || '—'
    }));

    res.json({ trips: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch driver trips.' });
  }
});

// GET /api/transport/driver-trips/:id — Get driver trip by ID or all trips for a specific driver ID
app.get('/api/transport/driver-trips/:id', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;

  try {
    // 1. First check if id matches a single driver_trips record ID
    const { data: singleTrip } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (singleTrip) {
      let driverName = '—';
      if (singleTrip.assigned_driver_id) {
        const { data: p } = await adminClient
          .from('profiles')
          .select('name')
          .eq('id', singleTrip.assigned_driver_id)
          .maybeSingle();
        if (p) driverName = p.name;
      }
      const enrichedTrip = { ...singleTrip, driver_name: driverName };
      return res.json({ success: true, trip: enrichedTrip, trips: [enrichedTrip] });
    }

    // 2. Otherwise check if id matches an assigned_driver_id
    const { data: driverTrips, error: driverErr } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('assigned_driver_id', id)
      .order('created_at', { ascending: false });

    if (driverErr) throw driverErr;

    const { data: driverProfile } = await adminClient
      .from('profiles')
      .select('name')
      .eq('id', id)
      .maybeSingle();

    const driverName = driverProfile?.name || '—';
    const enrichedTrips = (driverTrips || []).map(t => ({ ...t, driver_name: driverName }));

    return res.json({
      success: true,
      trips: enrichedTrips,
      trip: enrichedTrips[0] || null,
      message: enrichedTrips.length === 0 ? 'No trips assigned to driver.' : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch driver trip.' });
  }
});

// PUT /api/transport/driver-trips/:id — Update/cancel a driver trip
app.put('/api/transport/driver-trips/:id', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const allowed = ['status', 'vehicle_id', 'vehicle_number', 'bmc_id', 'bmc_name', 'destination',
    'route', 'duty_type', 'selected_bmcs', 'scheduled_start_time', 'scheduled_return_time', 'remarks'];
  const updates = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  try {
    const { data, error } = await adminClient
      .from('driver_trips').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ trip: data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update driver trip.' });
  }
});

// DELETE /api/transport/driver-trips/:id & DELETE /api/transport/duties/:id — Safely delete a driver trip duty
const safeDeleteDutyHandler = async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;

  try {
    // 1. Attempt delete from driver_trips
    const { data: driverTrip } = await adminClient
      .from('driver_trips')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (driverTrip) {
      const { error } = await adminClient
        .from('driver_trips')
        .update({ status: 'deleted' })
        .eq('id', id);

      if (error) throw error;
      return res.json({ success: true, message: 'Duty deleted successfully.' });
    }

    // 2. Attempt delete from trips table if present
    const { data: mainTrip } = await adminClient
      .from('trips')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (mainTrip) {
      const { error } = await adminClient
        .from('trips')
        .update({ status: 'deleted' })
        .eq('id', id);

      if (error) throw error;
      return res.json({ success: true, message: 'Duty deleted successfully.' });
    }

    // Idempotent success if record is already gone
    return res.json({ success: true, message: 'Duty deleted or record no longer present.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete driver trip duty.' });
  }
};

app.delete('/api/transport/driver-trips/:id', requireTransportOfficer, safeDeleteDutyHandler);
app.delete('/api/transport/duties/:id', requireTransportOfficer, safeDeleteDutyHandler);

// GET /api/transport/drivers-list — Get driver-role users for assignment dropdown
app.get('/api/transport/drivers-list', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  try {
    const drivers = await getUnifiedDrivers(adminClient);
    res.json({ drivers });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch drivers list.' });
  }
});

// GET /api/transport/bmcs-list — Get list of active BMCs for assignment dropdown
app.get('/api/transport/bmcs-list', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: bmcs, error } = await adminClient
      .from('bmcs')
      .select('id, name, location, is_active')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    res.json({ bmcs: bmcs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch BMCs list.' });
  }
});

// API 404 Fallback — ensures API routes return JSON, never HTML index.html
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `API route ${req.originalUrl} not found.` });
});

// Catch-all: serve landing page for SPA navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  const hasUrl = process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('your-supabase');
  const hasSvcKey = process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith('y');
  console.log(`====================================================`);
  console.log(`🚀 AAVIN BMC Monitoring System → http://localhost:${PORT}`);
  console.log(`📁 Frontend: ${frontendPath}`);
  console.log(`🔑 Supabase URL:  ${hasUrl ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🔐 Service Key:   ${hasSvcKey ? '✅ Configured' : '❌ Missing (admin features limited)'}`);
  console.log(`====================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️  Port ${PORT} in use. Server is already running on http://localhost:${PORT}`);
  } else {
    console.error('Server error:', err);
  }
});


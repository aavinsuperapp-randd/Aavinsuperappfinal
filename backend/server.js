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
  if (!['user', 'gm', 'pi_agm', 'driver', 'transport_officer', 'executive_officer', 'qc_worker', 'qc_agm'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be user, gm, pi_agm, driver, transport_officer, executive_officer, qc_worker, or qc_agm.' });
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

// Helper function for safe table cleanup without builder syntax errors
async function safeDeleteTable(client, tableName) {
  try {
    const dummyId = '00000000-0000-0000-0000-000000000000';
    const { error } = await client.from(tableName).delete().neq('id', dummyId);
    if (error) console.warn(`Notice deleting from ${tableName}:`, error.message);
  } catch (err) {
    console.warn(`Notice deleting from ${tableName}:`, err.message);
  }
}

// ─── ADMIN WEBSITE DATA RESET ENDPOINT ─────────────────────────────────────
// Deletes dynamic operational data (Excel imports, duty data, MACS readings, spot analyzer records, diary tests)
// PRESERVES master entities: BMC management list, Tankers fleet, Drivers list, User profiles, EO assignments, etc.
app.post('/api/admin/website-data-reset', requireAdminRole, async (req, res) => {
  const { adminClient } = req;
  const { scope } = req.body || {};

  try {
    const targetScope = scope || 'all';

    // 1. Diary / Dairy Tests & Quality Visit Data
    if (targetScope === 'all' || targetScope === 'diary') {
      await safeDeleteTable(adminClient, 'qc_test_reviews');
      await safeDeleteTable(adminClient, 'qc_lab_tests');
      await safeDeleteTable(adminClient, 'ftir_tests');
      await safeDeleteTable(adminClient, 'gerber_tests');
      await safeDeleteTable(adminClient, 'requirement_checks');
      await safeDeleteTable(adminClient, 'bmc_issues');
      await safeDeleteTable(adminClient, 'bmc_ratings');
      await safeDeleteTable(adminClient, 'bmc_requirements');
      await safeDeleteTable(adminClient, 'qc_audit_logs');
      await safeDeleteTable(adminClient, 'trip_bmc_visits');
    }

    // 2. Excel Import Data
    if (targetScope === 'all' || targetScope === 'excel') {
      await safeDeleteTable(adminClient, 'qc_excel_import_rows');
      await safeDeleteTable(adminClient, 'qc_excel_imports');
    }

    // 3. MACS Data
    if (targetScope === 'all' || targetScope === 'macs') {
      await safeDeleteTable(adminClient, 'macs_readings');
      await safeDeleteTable(adminClient, 'macs_import_batches');
    }

    // 4. Spot Analyzer Data
    if (targetScope === 'all' || targetScope === 'spot') {
      await safeDeleteTable(adminClient, 'bmc_daily_records');
    }

    // 5. Duty Data (Worker Trips & Driver Trips)
    if (targetScope === 'all' || targetScope === 'duty') {
      await safeDeleteTable(adminClient, 'trip_bmc_visits');
      await safeDeleteTable(adminClient, 'driver_trips');
      await safeDeleteTable(adminClient, 'trips');
    }

    console.log(`🧹 Website Data Reset executed by Admin (${req.user?.email || 'admin'}). Scope: ${targetScope}`);

    return res.json({
      success: true,
      message: targetScope === 'all' 
        ? 'Website data reset completed successfully! All excel import data, duty data, macs readings, spot analyzer records, and diary test logs have been deleted.'
        : `Website data reset for category '${targetScope}' completed successfully.`,
      scope: targetScope,
      preserved: [
        'List of BMCs (BMC Management)',
        'Tankers Fleet',
        'Drivers List',
        'User Profiles & Approvals',
        'Executive Officer BMC Assignments',
        'QC Variance Thresholds'
      ]
    });
  } catch (err) {
    console.error('❌ Website Data Reset Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to execute website data reset.' });
  }
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
async function findBmcByIdOrCode(adminClient, idOrCode) {
  if (!idOrCode) return null;
  const strVal = String(idOrCode).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strVal);
  
  if (isUuid) {
    const { data } = await adminClient.from('bmcs').select('*').eq('id', strVal).maybeSingle();
    if (data) return data;
  }
  
  const { data: byCode } = await adminClient.from('bmcs').select('*').eq('bmc_code', strVal).maybeSingle();
  if (byCode) return byCode;

  if (!isNaN(strVal)) {
    const { data: byNumCode } = await adminClient.from('bmcs').select('*').eq('bmc_code', String(Number(strVal))).maybeSingle();
    if (byNumCode) return byNumCode;
  }
  
  return null;
}

const safeDeleteBmcHandler = async (req, res) => {
  const adminClient = req.adminClient || getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const paramId = req.params.id || req.params.bmcCode;
  const target = await findBmcByIdOrCode(adminClient, paramId);
  if (!target) return res.status(404).json({ error: 'BMC record not found.' });

  try {
    const bmcId = target.id;
    // 1. Delete silos referencing this BMC
    await adminClient.from('bmc_silos').delete().eq('bmc_id', bmcId);
    // 2. Delete EO assignments referencing this BMC
    await adminClient.from('eo_bmc_assignments').delete().eq('bmc_id', bmcId);
    
    // 2.5 Delete historical records to satisfy foreign key constraints and allow deletion
    try {
      await adminClient.from('driver_trips').delete().eq('bmc_id', bmcId);
      await adminClient.from('trips').delete().eq('bmc_id', bmcId);
      await adminClient.from('qc_excel_import_rows').delete().eq('bmc_id', bmcId);
    } catch (cleanupErr) {
      console.warn('Warning deleting historical bmc_id references:', cleanupErr.message);
    }
    
    // 3. Delete trip visits and their dependencies referencing this BMC
    try {
      if (bmcId) {
        await adminClient.from('bmc_issues').delete().eq('bmc_id', bmcId);
        await adminClient.from('bmc_requirements').delete().eq('bmc_id', bmcId);
      }
      if (target.bmc_code) {
        await adminClient.from('bmc_issues').delete().eq('bmc_code', target.bmc_code);
        await adminClient.from('bmc_requirements').delete().eq('bmc_code', target.bmc_code);
      }

      const { data: visits } = await adminClient.from('trip_bmc_visits').select('id').eq('bmc_id', bmcId);
      if (visits && visits.length > 0) {
        const visitIds = visits.map(v => v.id);
        await adminClient.from('bmc_issues').delete().in('visit_id', visitIds);
        await adminClient.from('bmc_ratings').delete().in('visit_id', visitIds);
        await adminClient.from('requirement_checks').delete().in('visit_id', visitIds);
        await adminClient.from('ftir_tests').delete().in('visit_id', visitIds);
        await adminClient.from('gerber_tests').delete().in('visit_id', visitIds);
        await adminClient.from('trip_bmc_visits').delete().in('id', visitIds);
      }
    } catch (vErr) {
      console.warn('Warning deleting trip_bmc_visits dependencies:', vErr.message);
    }
    
    // 4. Delete BMC main record
    const { error } = await adminClient.from('bmcs').delete().eq('id', bmcId);
    if (error) throw error;

    res.json({ success: true, message: 'BMC deleted successfully.' });
  } catch (err) {
    console.error('❌ Delete BMC Error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete BMC.' });
  }
};

app.delete('/api/admin/bmcs/all', requireGm, async (req, res) => {
  const { error } = await req.adminClient.from('bmcs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'All BMC records deleted successfully.' });
});

app.delete('/api/admin/bmcs/:id', requireGm, safeDeleteBmcHandler);
app.delete('/api/gm/bmcs/:id', requirePiAgm, safeDeleteBmcHandler);


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

// ─── P&I AGM JWT Middleware ───────────────────────────────────────────────────
async function requirePiAgm(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (profile.role !== 'pi_agm' && profile.role !== 'gm' && profile.role !== 'admin') {
    return res.status(403).json({ error: 'P&I AGM or GM access required.' });
  }
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Account not yet approved.' });

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}


// ─── Transport Officer JWT Middleware ─────────────────────────────────────────
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
  if (profile.role !== 'transport_officer' && profile.role !== 'admin' && profile.role !== 'gm' && profile.role !== 'pi_agm') {
    return res.status(403).json({ error: 'Transport Officer access required.' });
  }
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Account not yet approved.' });

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

// ─── Any Authenticated User Middleware ──────────────────────────────────────
async function requireAuthAny(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).maybeSingle();

  req.user = user;
  req.profile = profile || { id: user.id, role: 'user' };
  req.adminClient = adminClient;
  next();
}

// ─── QC Worker JWT Middleware ──────────────────────────────────────────────────
async function requireQcWorker(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (profile.role !== 'qc_worker' && profile.role !== 'admin') {
    return res.status(403).json({ error: 'QC Worker access required.' });
  }
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Account not yet approved.' });

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

// ─── QC AGM JWT Middleware ────────────────────────────────────────────────────
async function requireQcAgm(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (!['qc_agm', 'admin', 'gm', 'pi_agm'].includes(profile.role)) {
    return res.status(403).json({ error: 'QC AGM or GM access required.' });
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
app.get('/api/gm/dashboard', requirePiAgm, async (req, res) => {
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
      .neq('status', 'deleted')
      .neq('assignment_status', 'deleted')
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

// ─── GET /api/gm/dashboard-v2 (SINGLE-DATE / DATE-RANGE COMPREHENSIVE DASHBOARD) ──────────
app.get('/api/gm/dashboard-v2', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  const dateParam = req.query.date; // YYYY-MM-DD
  const startDateParam = req.query.startDate; // YYYY-MM-DD
  const endDateParam = req.query.endDate; // YYYY-MM-DD

  // Calculate date range & lookback
  let dayStartIso, dayEndIso, displayDateStr, fetchStartIso;
  if (startDateParam && endDateParam) {
    dayStartIso = new Date(startDateParam + 'T00:00:00.000Z').toISOString();
    dayEndIso = new Date(endDateParam + 'T23:59:59.999Z').toISOString();
    displayDateStr = startDateParam === endDateParam ? startDateParam : `${startDateParam} to ${endDateParam}`;
  } else if (dateParam && dateParam !== 'all') {
    dayStartIso = new Date(dateParam + 'T00:00:00.000Z').toISOString();
    dayEndIso = new Date(dateParam + 'T23:59:59.999Z').toISOString();
    displayDateStr = dateParam;
  } else {
    dayStartIso = new Date('2020-01-01T00:00:00.000Z').toISOString();
    dayEndIso = new Date('2030-12-31T23:59:59.999Z').toISOString();
    displayDateStr = 'All Available Operations';
  }

  fetchStartIso = dayStartIso;
  if (startDateParam || (dateParam && dateParam !== 'all')) {
    const lookback = new Date(dayStartIso);
    lookback.setDate(lookback.getDate() - 7);
    fetchStartIso = lookback.toISOString();
  }

  // Also calculate last 7 days for trend charts
  const dayStart = new Date(dayStartIso);
  const targetDate = new Date(dayStartIso);
  const trendStart = new Date(dayStartIso);
  trendStart.setDate(trendStart.getDate() - 6);
  trendStart.setHours(0, 0, 0, 0);
  const trendStartIso = trendStart.toISOString();

  try {
    let macsQuery = adminClient.from('qc_excel_import_rows').select('*');
    if (startDateParam && endDateParam) {
      macsQuery = macsQuery.gte('test_date', startDateParam).lte('test_date', endDateParam);
    } else if (dateParam && dateParam !== 'all' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      macsQuery = macsQuery.eq('test_date', dateParam);
    }

    const [
      tripsRes, driverTripsRes, trendTripsRes, visitsRes,
      profilesRes, driversRes, tankersRes, bmcsRes, macsRes
    ] = await Promise.all([
      // Trips for selected date range with lookback (exclude status='deleted')
      adminClient.from('trips').select('*').neq('status', 'deleted').neq('assignment_status', 'deleted').gte('created_at', fetchStartIso).lte('created_at', dayEndIso).order('created_at', { ascending: false }),
      // Driver trips for selected date range with lookback (exclude status='deleted')
      adminClient.from('driver_trips').select('*').neq('status', 'deleted').gte('created_at', fetchStartIso).lte('created_at', dayEndIso).order('created_at', { ascending: false }),
      // Trips for trend (exclude status='deleted')
      adminClient.from('trips').select('id, status, created_at').neq('status', 'deleted').neq('assignment_status', 'deleted').gte('created_at', trendStartIso).lte('created_at', dayEndIso),
      // All BMC visits
      adminClient.from('trip_bmc_visits').select('*').order('visit_sequence'),
      // All profiles (workers/GMs)
      adminClient.from('profiles').select('id, name, email, role, status, profile_image_url'),
      // All drivers
      adminClient.from('drivers').select('*').order('name'),
      // All tankers
      adminClient.from('tankers').select('*').order('board_number'),
      // All BMCs
      adminClient.from('bmcs').select('*').order('name'),
      // MACS data for selected date / date range
      macsQuery
    ]);

    const rawTrips = (tripsRes.data || []).filter(t => t.status !== 'deleted' && t.assignment_status !== 'deleted');
    const rawDriverTrips = (driverTripsRes.data || []).filter(dt => dt.status !== 'deleted' && (dt.assignment_status ? dt.assignment_status !== 'deleted' : true));
    const trendTripList = (trendTripsRes.data || []).filter(t => t.status !== 'deleted' && t.assignment_status !== 'deleted');

    // Build unified trip map, merging driver_trips (Transport Manager duties) with trips
    const tripMapById = {};
    rawTrips.forEach(t => {
      tripMapById[t.id] = { ...t };
    });

    rawDriverTrips.forEach(dt => {
      if (tripMapById[dt.id]) {
        const existing = tripMapById[dt.id];
        if (!existing.driver_name && dt.driver_name) existing.driver_name = dt.driver_name;
        if (!existing.tanker_number && (dt.vehicle_number || dt.tanker_number)) existing.tanker_number = dt.vehicle_number || dt.tanker_number;
        if (!existing.route && (dt.route || dt.destination || dt.bmc_name)) existing.route = dt.route || dt.destination || dt.bmc_name;
        if (dt.assigned_worker_id && !existing.worker_id) existing.worker_id = dt.assigned_worker_id;
      } else {
        tripMapById[dt.id] = {
          id: dt.id,
          trip_name: dt.route || dt.destination || dt.bmc_name || `Duty #${dt.trip_number || dt.id.slice(0, 8)}`,
          trip_number: dt.trip_number || dt.id.slice(0, 8).toUpperCase(),
          worker_id: dt.assigned_worker_id || dt.worker_id || null,
          driver_name: dt.driver_name || null,
          tanker_number: dt.vehicle_number || dt.tanker_number || null,
          route: dt.route || dt.destination || dt.bmc_name || null,
          out_time: dt.scheduled_start_time || dt.created_at,
          in_time: dt.in_time || null,
          status: dt.status || 'pending',
          created_at: dt.created_at,
          visits: []
        };
      }
    });

    let tripList = Object.values(tripMapById);

    // Filter tripList based on Spot Analyzer start time (started_at || out_time || created_at)
    function getTripOperationalDateStr(isoOrDateStr) {
      if (!isoOrDateStr) return null;
      try {
        const d = new Date(isoOrDateStr);
        if (isNaN(d.getTime())) return null;
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      } catch (e) {
        return null;
      }
    }

    if (startDateParam && endDateParam) {
      tripList = tripList.filter(t => {
        const spotStartTime = t.started_at || t.out_time || t.created_at;
        const dateStr = getTripOperationalDateStr(spotStartTime);
        if (!dateStr) return true;
        return dateStr >= startDateParam && dateStr <= endDateParam;
      });
    } else if (dateParam && dateParam !== 'all' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      tripList = tripList.filter(t => {
        const spotStartTime = t.started_at || t.out_time || t.created_at;
        const dateStr = getTripOperationalDateStr(spotStartTime);
        if (!dateStr) return true;
        return dateStr === dateParam;
      });
    }
    const tripIds = tripList.map(t => t.id);
    const visitList = (visitsRes.data || []).filter(v => tripIds.includes(v.trip_id));
    const profilesList = profilesRes.data || [];
    const driversList = driversRes.data || [];
    const tankersList = tankersRes.data || [];
    const bmcsList = bmcsRes.data || [];
    const macsList = macsRes.data || [];

    // Build lookup maps
    const profileMap = {};
    profilesList.forEach(p => profileMap[p.id] = p);
    const bmcMap = {};
    bmcsList.forEach(b => bmcMap[b.id] = b);
    const driverMap = {};
    driversList.forEach(d => driverMap[d.id] = d.name || d.driver_name);

    // ── KPIs ──
    const total_trips = tripList.length;
    const active_trips = tripList.filter(t => t.status === 'active').length;
    const completed_trips = tripList.filter(t => t.status === 'completed').length;
    const total_bmc_visits = visitList.length;

    let total_milk_liters = 0;
    visitList.forEach(v => {
      const milkVal = v.milk_quantity_kg || v.in_weight || v.milk_quantity_liters;
      if (milkVal) total_milk_liters += Number(milkVal);
    });

    // ── Fetch test data, issues, ratings, and QC lab tests for visits ──
    const visitIds = visitList.map(v => v.id);
    let ftirList = [], gerberList = [], issueList = [], ratingList = [], qcLabList = [];
    if (visitIds.length > 0) {
      const [fRes, gRes, iRes, rRes, qRes] = await Promise.all([
        adminClient.from('ftir_tests').select('*').in('visit_id', visitIds),
        adminClient.from('gerber_tests').select('*').in('visit_id', visitIds),
        adminClient.from('bmc_issues').select('*').in('visit_id', visitIds),
        adminClient.from('bmc_ratings').select('*').in('visit_id', visitIds),
        adminClient.from('qc_lab_tests').select('*').in('visit_id', visitIds)
      ]);
      ftirList = fRes.data || [];
      gerberList = gRes.data || [];
      issueList = iRes.data || [];
      ratingList = rRes.data || [];
      qcLabList = qRes.data || [];
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
      const driverName = (t.assigned_driver_id && driverMap[t.assigned_driver_id]) || 
                         (t.driver_id && driverMap[t.driver_id]) || 
                         profileMap[t.assigned_driver_id]?.name || 
                         t.driver_name || null;
      const tankerNumber = t.tanker_number || t.vehicle_number || null;
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
          const vIssues = issueList.filter(i => i.visit_id === v.id);
          const vRating = ratingList.find(r => r.visit_id === v.id);
          const qcTest = qcLabList.find(q => q.visit_id === v.id);
          const lastIssue = vIssues.length > 0 ? vIssues[vIssues.length - 1] : null;

          // FTIR: show actual saved values only, never fake 0
          let ftir_result = '—';
          if (ftir) {
            const fatVal = ftir.fat !== null && ftir.fat !== undefined ? ftir.fat : null;
            const snfVal = ftir.snf !== null && ftir.snf !== undefined ? ftir.snf : null;
            if (fatVal !== null || snfVal !== null) {
              ftir_result = `FAT: ${fatVal !== null ? fatVal : '—'}%, SNF: ${snfVal !== null ? snfVal : '—'}%`;
            }
          } else if (v.status !== 'completed' && v.status !== 'visited') {
            ftir_result = 'Pending';
          }

          // Gerber: show actual saved values only, never fake 0
          let gerber_result = '—';
          if (gerber) {
            const fatVal = gerber.fat_percentage !== null && gerber.fat_percentage !== undefined ? gerber.fat_percentage : null;
            const snfVal = gerber.snf !== null && gerber.snf !== undefined ? gerber.snf : null;
            const clrVal = gerber.clr !== null && gerber.clr !== undefined ? gerber.clr : null;
            if (fatVal !== null || snfVal !== null) {
              gerber_result = `FAT: ${fatVal !== null ? fatVal : '—'}%, SNF: ${snfVal !== null ? snfVal : '—'}%`;
              if (clrVal !== null) gerber_result += `, CLR: ${clrVal}`;
            }
          } else if (v.status !== 'completed' && v.status !== 'visited') {
            gerber_result = 'Pending';
          }

          // MACS: match by bmc_id, sample_ref (code), or bmc_name
          const bmcCode = String(bmcMap[v.bmc_id]?.bmc_code || '').trim();
          const bmcNameClean = String(bmcMap[v.bmc_id]?.name || '').trim().toLowerCase();
          const macsData = macsList.find(m => 
            (v.bmc_id && m.bmc_id === v.bmc_id) || 
            (bmcCode && String(m.sample_ref || m.raw_data?.bmc_code || '').trim().toLowerCase() === bmcCode.toLowerCase()) ||
            (bmcNameClean && String(m.bmc_name || m.raw_data?.bmc_name || '').trim().toLowerCase() === bmcNameClean)
          );
          let macs_result = '—';
          if (macsData) {
            const liters = macsData.raw_data?.macs_quantity_liters ?? macsData.raw_data?.liters ?? macsData.raw_data?.quantity ?? macsData.liters ?? macsData.quantity ?? null;
            const fat = macsData.fat !== null && macsData.fat !== undefined ? macsData.fat : (macsData.raw_data?.fat ?? null);
            const snf = macsData.snf !== null && macsData.snf !== undefined ? macsData.snf : (macsData.raw_data?.snf ?? null);
            const parts = [];
            if (liters !== null && liters !== undefined) parts.push(`Qty: ${liters} L`);
            if (fat !== null && fat !== undefined) parts.push(`FAT: ${fat}%`);
            if (snf !== null && snf !== undefined) parts.push(`SNF: ${snf}%`);
            if (parts.length > 0) macs_result = parts.join(' | ');
          }

          // Diary / QC Lab Test: combine QC AGM test result & visit milk weight
          let diary_result = '—';
          const visitMilkKg = v.milk_quantity_kg || v.in_weight || null;
          const diaryParts = [];
          if (visitMilkKg !== null && visitMilkKg !== undefined) {
            diaryParts.push(`${visitMilkKg} kg`);
          }
          if (qcTest) {
            if (qcTest.fat !== null && qcTest.fat !== undefined) {
              diaryParts.push(`FAT: ${qcTest.fat}%`);
            }
            if (qcTest.snf !== null && qcTest.snf !== undefined) {
              diaryParts.push(`SNF: ${qcTest.snf}%`);
            }
            if (qcTest.clr !== null && qcTest.clr !== undefined) {
              diaryParts.push(`CLR: ${qcTest.clr}`);
            }
          }
          if (diaryParts.length > 0) {
            diary_result = diaryParts.join(' | ');
          }

          return {
            id: v.id,
            visit_sequence: v.visit_sequence || (idx + 1),
            bmc_id: v.bmc_id,
            bmc_name: displayName,
            compartment: v.compartment || null,
            milk_quantity_liters: v.milk_quantity_liters || null,
            milk_quantity_kg: v.milk_quantity_kg || null,
            milk_quantity_formatted: v.milk_quantity_liters ? `${v.milk_quantity_liters} L` : '—',
            status: v.status || 'pending',
            ftir_fat: ftir?.fat ?? null,
            ftir_snf: ftir?.snf ?? null,
            ftir_result,
            gerber_fat: gerber?.fat_percentage ?? null,
            gerber_snf: gerber?.snf ?? null,
            gerber_clr: gerber?.clr ?? null,
            gerber_result,
            macs_result,
            diary_result,
            report: lastIssue?.description || null,
            report_priority: lastIssue?.severity || null,
            rating: vRating?.overall_rating ?? null,
            rating_remarks: vRating?.remarks || null,
            ftir_tests: ftir ? [ftir] : [],
            gerber_tests: gerber ? [gerber] : [],
            bmc_issues: vIssues || [],
            bmc_ratings: vRating ? [vRating] : []
          };
        });

      const visitBmcNames = formattedVisits.map(v => v.bmc_name).join(' → ');

      return {
        id: t.id,
        trip_name: t.trip_name,
        worker_id: t.worker_id,
        worker_name: worker ? worker.name : '-',
        driver_name: driverName || '-',
        tanker_number: tankerNumber || '-',
        out_time: t.out_time,
        in_time: t.in_time,
        status: t.status,
        created_at: t.created_at,
        started_at: t.started_at || null,
        remarks: t.remarks || null,
        start_lat: t.start_lat || null,
        start_lng: t.start_lng || null,
        end_lat: t.end_lat || null,
        end_lng: t.end_lng || null,
        journey_path: t.journey_path || null,
        route_description: t.route_description || null,
        visits_count: tVisits.length,
        ftir_count: tFtir,
        gerber_count: tGerber,
        issues_count: tIssues,
        duration_ms,
        duration_formatted: formatDurationMs(duration_ms),
        last_bmc: lastBmc,
        route: visitBmcNames || t.route_description || t.trip_name || '-',
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
app.post('/api/gm/create-bmc', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  const { bmc_code, name, district, location, contact_number, latitude, longitude, profile_image_url, total_capacity, silos, route_id } = req.body;

  if (!bmc_code || !name || !district || !location || !contact_number) {
    return res.status(400).json({ error: 'BMC Code, Name, district, location, and contact number are required.' });
  }
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null || latitude === '' || longitude === '') {
    return res.status(400).json({ error: 'GPS coordinates (latitude and longitude) are required.' });
  }

  try {
    const { data: existing } = await adminClient
      .from('bmcs')
      .select('id')
      .eq('bmc_code', String(bmc_code).trim())
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: `A BMC with code ${bmc_code} already exists.` });
    }

    const bmcPayload = {
      bmc_code: String(bmc_code).trim(),
      name: name.trim(),
      district: district.trim(),
      location: location.trim(),
      contact_number: contact_number.trim(),
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      profile_image_url: profile_image_url || null,
      is_active: true
    };
    if (route_id) bmcPayload.route_id = route_id;
    if (total_capacity !== undefined && total_capacity !== null) {
      bmcPayload.total_capacity = parseFloat(total_capacity) || 0;
    }

    let data = null;
    let error = null;

    const result = await adminClient.from('bmcs').insert(bmcPayload).select();

    if (result.error) {
      if (result.error.code === '42703' || (result.error.message && (result.error.message.includes('total_capacity') || result.error.message.includes('route_id')))) {
        const retryPayload = { ...bmcPayload };
        delete retryPayload.total_capacity;
        delete retryPayload.route_id;
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
app.get('/api/gm/analysis', requirePiAgm, async (req, res) => {
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
app.get('/api/gm/requirements', requirePiAgm, async (req, res) => {
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
app.patch('/api/gm/requirements/:id/complete', requirePiAgm, async (req, res) => {
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
app.get('/api/gm/issues', requirePiAgm, async (req, res) => {
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

      const isPrioritized = (item.remarks || '').includes('[PRIORITIZED_BY:');
      let prioritizedBy = '';
      if (isPrioritized) {
        const m = (item.remarks || '').match(/\[PRIORITIZED_BY:\s*([^\]]+)\]/);
        if (m) prioritizedBy = m[1].trim();
      }

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
        is_prioritized: isPrioritized,
        prioritized_by: prioritizedBy,
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
app.patch('/api/gm/issues/:id/complete', requirePiAgm, async (req, res) => {
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

// ─── PATCH /api/gm/issues/:id/prioritize (MARK ISSUE AS PRIORITIZED) ─────────
app.patch('/api/gm/issues/:id/prioritize', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  const issueId = req.params.id;
  const profileName = req.profile?.name || req.body?.username || 'P&I AGM';

  try {
    const { data: existing, error: getErr } = await adminClient
      .from('bmc_issues')
      .select('remarks')
      .eq('id', issueId)
      .maybeSingle();

    if (getErr) throw getErr;

    const existingRemarks = existing?.remarks || '';
    let newRemarks = existingRemarks;
    if (newRemarks.includes('[PRIORITIZED_BY:')) {
      newRemarks = newRemarks.replace(/\[PRIORITIZED_BY:\s*[^\]]+\]/g, `[PRIORITIZED_BY: ${profileName}]`);
    } else {
      newRemarks = (newRemarks ? newRemarks + ' ' : '') + `[PRIORITIZED_BY: ${profileName}]`;
    }

    const { data, error } = await adminClient
      .from('bmc_issues')
      .update({ remarks: newRemarks })
      .eq('id', issueId)
      .select();

    if (error) throw error;
    const updatedRecord = (data && data.length > 0) ? data[0] : null;
    res.json({ success: true, issue: updatedRecord });
  } catch (err) {
    console.error('❌ Error prioritizing issue:', err);
    res.status(500).json({ error: err.message || 'Failed to prioritize issue.' });
  }
});

// ─── GET /api/gm/routes (LIST ALL BMC ROUTES) ──────────────────────────────────
app.get('/api/gm/routes', requirePiAgm, async (req, res) => {
  const { data, error } = await req.adminClient.from('bmc_routes').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ routes: data });
});

// ─── POST /api/gm/routes (CREATE NEW BMC ROUTE) ──────────────────────────────
app.post('/api/gm/routes', requirePiAgm, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Route name is required' });
  const { data, error } = await req.adminClient.from('bmc_routes').insert({ name: name.trim() }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ route: data });
});

// ─── GET /api/gm/bmcs (LIST ALL BMCS WITH FULL DATA FOR GM) ───────────────────
app.get('/api/gm/bmcs', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: bmcs, error } = await adminClient
      .from('bmcs')
      .select('*, bmc_routes(name)')
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
app.put('/api/gm/bmcs/:bmcCode', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  const target = await findBmcByIdOrCode(adminClient, req.params.bmcCode);
  if (!target) return res.status(404).json({ error: 'BMC not found' });
  const bmcId = target.id;
  const { bmc_code, name, district, location, contact_number, latitude, longitude, profile_image_url, total_capacity, silos, route_id } = req.body;

  console.log(`[GM BMC UPDATE] id=${bmcId} code=${bmc_code} total_capacity=${total_capacity} route_id=${route_id}`);

  if (!bmc_code || !name || !district || !location || !contact_number) {
    return res.status(400).json({ error: 'BMC Code, Name, district, location, and contact number are required.' });
  }

  try {
    const { data: existing } = await adminClient
      .from('bmcs')
      .select('id')
      .eq('bmc_code', String(bmc_code).trim())
      .neq('id', bmcId)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: `Another BMC with code ${bmc_code} already exists.` });
    }

    const payload = {
      bmc_code: String(bmc_code).trim(),
      name: name.trim(),
      district: district.trim(),
      location: location.trim(),
      contact_number: contact_number.trim(),
      latitude: latitude !== undefined && latitude !== null && latitude !== '' ? parseFloat(latitude) : null,
      longitude: longitude !== undefined && longitude !== null && longitude !== '' ? parseFloat(longitude) : null,
      route_id: route_id || null
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
      if (result.error.code === '42703' || (result.error.message && (result.error.message.includes('total_capacity') || result.error.message.includes('route_id')))) {
        console.warn('[GM BMC UPDATE] Retrying update without total_capacity/route_id...');
        const retryPayload = { ...payload };
        delete retryPayload.total_capacity;
        delete retryPayload.route_id;
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
app.put('/api/gm/bmcs/:bmcCode/toggle', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  const target = await findBmcByIdOrCode(adminClient, req.params.bmcCode);
  if (!target) return res.status(404).json({ error: 'BMC not found' });
  const bmcId = target.id;
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
app.get('/api/gm/bmcs/:bmcCode/profile', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  const target = await findBmcByIdOrCode(adminClient, req.params.bmcCode);
  if (!target) return res.status(404).json({ error: 'BMC not found' });
  const bmcId = target.id;


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
      adminClient.from('trips').select('id, status').eq('worker_id', profile.id).neq('status', 'deleted'),
      adminClient.from('trip_bmc_visits').select('id, status, trip_id')
        .in('trip_id',
          (await adminClient.from('trips').select('id').eq('worker_id', profile.id).neq('status', 'deleted')).data?.map(t => t.id) || []
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
    let { data: trip } = await adminClient
      .from('trips')
      .select('*')
      .eq('worker_id', profile.id)
      .in('status', ['active', 'in_progress'])
      .not('started_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!trip) {
      const { data: dTrip } = await adminClient
        .from('driver_trips')
        .select('*')
        .eq('assigned_driver_id', profile.id)
        .in('status', ['active', 'in_progress'])
        .not('started_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dTrip) {
        trip = {
          ...dTrip,
          trip_name: dTrip.route || dTrip.destination || dTrip.bmc_name || 'Planned Duty',
          driver_name: dTrip.driver_name,
          tanker_number: dTrip.vehicle_number,
          out_time: dTrip.started_at || dTrip.scheduled_start_time
        };
      }
    }

    if (!trip) return res.json({ trip: null, visits: [] });

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
// ─── POST /api/worker/create-bmc — DISABLED (backend enforcement) ─────────────
// Field Workers are no longer permitted to create BMC records.
// BMC management is handled by P&I AGM and Administrators only.
app.post('/api/worker/create-bmc', requireWorker, (req, res) => {
  return res.status(403).json({
    error: 'Field Workers are no longer permitted to create BMC records. Contact the P&I AGM to add or manage BMCs.'
  });
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

// ─── POST /api/trips — DISABLED (backend enforcement) ────────────────────────
// Field Workers can no longer independently create trips.
// All trips are created by the Transport Manager and assigned to workers by the P&I AGM.
app.post('/api/trips', requireWorker, (req, res) => {
  return res.status(403).json({
    error: 'Workers cannot independently create trips. Trips are created by the Transport Manager and assigned to you by the P&I AGM. Check "My Assigned Trips" on your dashboard.'
  });
});

// ─── GET /api/trips ───────────────────────────────────────────────────────────
app.get('/api/trips', requireWorker, async (req, res) => {
  const { data, error } = await req.adminClient
    .from('trips')
    .select('*')
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ trips: data || [] });
});

// ─── GET /api/trips/:id ───────────────────────────────────────────────────────
app.get('/api/trips/:id', requireAuthAny, async (req, res) => {
  const { adminClient } = req;
  
  // Try trips table first
  let { data: trip, error } = await adminClient
    .from('trips')
    .select('*, assigned_bmc:bmcs(*)')
    .eq('id', req.params.id)
    .maybeSingle();

  // Always fetch driver_trips as the Single Source of Truth for planning data
  const { data: dTrip } = await adminClient
    .from('driver_trips')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (trip && dTrip) {
    trip.selected_bmcs = dTrip.selected_bmcs || [];
    trip.route_description = trip.route_description || dTrip.route || dTrip.destination || '—';
    trip.trip_number = trip.trip_number || dTrip.trip_number || dTrip.id.slice(0, 8).toUpperCase();
    if (!trip.driver_name && dTrip.driver_name) trip.driver_name = dTrip.driver_name;
    if (!trip.tanker_number && (dTrip.vehicle_number || dTrip.tanker_number)) trip.tanker_number = dTrip.vehicle_number || dTrip.tanker_number;
  } else if (!trip && dTrip) {
    trip = {
      ...dTrip,
      trip_name: dTrip.route || dTrip.destination || dTrip.bmc_name || 'Planned Duty',
      trip_number: dTrip.trip_number || dTrip.id.slice(0, 8).toUpperCase(),
      driver_name: dTrip.driver_name,
      tanker_number: dTrip.vehicle_number || dTrip.tanker_number,
      route_description: dTrip.route || dTrip.destination || '—',
      out_time: dTrip.started_at || dTrip.scheduled_start_time,
      in_time: dTrip.completed_at,
      out_km: dTrip.out_km,
      out_tanker_weight: dTrip.out_weight,
      in_km: dTrip.in_km,
      selected_bmcs: dTrip.selected_bmcs || []
    };
  }

  if (!trip) return res.status(404).json({ error: 'Trip not found.' });

  // Resolve driver_name if missing or generic
  if (!trip.driver_name || trip.driver_name === 'Driver' || trip.driver_name === 'Assigned Driver' || trip.driver_name === '—') {
    const driverId = trip.assigned_driver_id || trip.driver_id || dTrip?.assigned_driver_id || dTrip?.driver_id;
    if (driverId) {
      const { data: dRec } = await adminClient.from('drivers').select('name').eq('id', driverId).maybeSingle();
      if (dRec && dRec.name) {
        trip.driver_name = dRec.name;
      } else {
        const { data: pRec } = await adminClient.from('profiles').select('name').eq('id', driverId).maybeSingle();
        if (pRec && pRec.name) trip.driver_name = pRec.name;
      }
    }
  }

  const { data: dbVisits } = await adminClient
    .from('trip_bmc_visits')
    .select(`*, bmc:bmcs(*),
      ftir_tests(*), gerber_tests(*),
      requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
    .eq('trip_id', trip.id)
    .order('visit_sequence');

  const selectedBmcs = trip.selected_bmcs || [];
  let rawVisits = [];

  if (selectedBmcs.length > 0) {
    rawVisits = selectedBmcs.map((sb, idx) => {
      const sbBmcId = sb.bmc_id || sb.id;
      const sbCode = sb.bmc_code || sb.code || sb.bmc_name || sb.name;

      const matchedDb = (dbVisits || []).find(v => {
        if (sbBmcId && v.bmc_id === sbBmcId) return true;
        if (v.bmc && sbCode && (v.bmc.bmc_code === sbCode || v.bmc.name === sbCode)) return true;
        if (v.visit_sequence === idx + 1) return true;
        return false;
      });

      if (matchedDb) {
        return {
          ...matchedDb,
          visit_sequence: idx + 1,
          bmc_name: matchedDb.bmc ? matchedDb.bmc.name : (sb.bmc_name || sb.name || 'BMC'),
          bmc_code: matchedDb.bmc ? (matchedDb.bmc.bmc_code || matchedDb.bmc.district) : (sb.bmc_code || sb.code || '')
        };
      }

      return {
        id: `virtual-${idx}`,
        trip_id: trip.id,
        bmc_id: sbBmcId || null,
        bmc_code: sb.bmc_code || sb.code || '',
        bmc_name: sb.bmc_name || sb.name || 'BMC',
        visit_sequence: idx + 1,
        status: 'pending',
        compartment: sb.compartment || 'Front',
        bmc: {
          id: sbBmcId || null,
          name: sb.bmc_name || sb.name || 'BMC',
          bmc_code: sb.bmc_code || sb.code || '',
          district: sb.district || ''
        }
      };
    });
  } else if (dbVisits && dbVisits.length > 0) {
    rawVisits = dbVisits;
  }

  const visits = rawVisits.map((v, idx, arr) => {
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

// Helper function to verify visit existence and parent trip validity
async function verifyVisitOwnership(adminClient, visitId) {
  if (!visitId || typeof visitId !== 'string' || visitId.startsWith('virtual-')) {
    return { error: 'Invalid visit ID.', code: 400 };
  }

  const { data: visit } = await adminClient
    .from('trip_bmc_visits')
    .select('*, bmc:bmcs(*)')
    .eq('id', visitId)
    .maybeSingle();

  if (!visit) {
    return { error: 'Visit not found in database.', code: 404 };
  }

  return { visit };
}

async function ensureTripRecordExists(adminClient, tripId) {
  if (!tripId) return null;

  const { data: existingTrip } = await adminClient
    .from('trips')
    .select('*, assigned_bmc:bmcs(*)')
    .eq('id', tripId)
    .maybeSingle();

  if (existingTrip) return existingTrip;

  const { data: dTrip } = await adminClient
    .from('driver_trips')
    .select('*')
    .eq('id', tripId)
    .maybeSingle();

  if (!dTrip) return null;

  let mappedStatus = 'active';
  if (dTrip.status === 'completed') mappedStatus = 'completed';
  else if (dTrip.status === 'planned') mappedStatus = 'planned';

  const tripInsertPayload = {
    id: dTrip.id,
    trip_number: dTrip.trip_number || dTrip.id.slice(0, 8).toUpperCase(),
    trip_name: dTrip.route || dTrip.destination || dTrip.bmc_name || 'Planned Duty',
    route_description: dTrip.route || dTrip.destination || 'Planned Duty',
    driver_name: dTrip.driver_name || 'Assigned Driver',
    tanker_number: dTrip.vehicle_number || 'Unassigned',
    status: mappedStatus,
    bmc_id: dTrip.bmc_id || null,
    created_at: dTrip.created_at || new Date().toISOString()
  };

  const { data: syncedTrip, error: syncErr } = await adminClient
    .from('trips')
    .upsert(tripInsertPayload, { onConflict: 'id' })
    .select('*, assigned_bmc:bmcs(*)')
    .maybeSingle();

  if (syncErr) {
    console.error('ensureTripRecordExists sync error:', syncErr);
    return dTrip;
  }

  return syncedTrip || dTrip;
}

// ─── POST /api/trips/:tripId/visits ──────────────────────────────────────────
app.post('/api/trips/:tripId/visits', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const bmc_id = req.body.bmc_id || req.body.bmc_code || req.body.visitId;

  // Ensure parent trip record exists in trips table (satisfying foreign key constraint)
  const activeTripObj = await ensureTripRecordExists(adminClient, req.params.tripId);
  if (!activeTripObj) return res.status(404).json({ error: 'Trip not found.' });

  // 1. Resolve real BMC UUID
  let realBmcId = null;
  const inputBmcStr = String(bmc_id || '').trim();
  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(inputBmcStr);

  if (isUuid) {
    const { data: bmcById } = await adminClient
      .from('bmcs').select('id').eq('id', inputBmcStr).maybeSingle();
    if (bmcById) realBmcId = bmcById.id;
  }

  if (!realBmcId && inputBmcStr && !inputBmcStr.startsWith('virtual-')) {
    const { data: bmcByCode } = await adminClient
      .from('bmcs').select('id').eq('bmc_code', inputBmcStr).maybeSingle();
    if (bmcByCode) {
      realBmcId = bmcByCode.id;
    } else {
      const { data: bmcByName } = await adminClient
        .from('bmcs').select('id').eq('name', inputBmcStr).maybeSingle();
      if (bmcByName) realBmcId = bmcByName.id;
    }
  }

  // Fallback: Resolve BMC from the trip's selected_bmcs or assigned_bmc
  if (!realBmcId) {
    const selBmcs = activeTripObj.selected_bmcs || [];
    let matchedSel = null;

    if (inputBmcStr && inputBmcStr.startsWith('virtual-')) {
      const idx = parseInt(inputBmcStr.replace('virtual-', ''), 10);
      if (!isNaN(idx) && selBmcs[idx]) {
        matchedSel = selBmcs[idx];
      }
    }

    if (!matchedSel && selBmcs.length > 0) {
      matchedSel = selBmcs[0];
    }

    if (matchedSel) {
      const selId = matchedSel.bmc_id || matchedSel.id;
      if (selId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(selId)) {
        realBmcId = selId;
      } else {
        const codeToFind = matchedSel.bmc_code || matchedSel.bmc_name || matchedSel.code || matchedSel.name;
        if (codeToFind) {
          const { data: bmcMatch } = await adminClient
            .from('bmcs').select('id').eq('bmc_code', codeToFind).maybeSingle();
          if (bmcMatch) realBmcId = bmcMatch.id;
          else {
            const { data: bmcMatch2 } = await adminClient
              .from('bmcs').select('id').eq('name', codeToFind).maybeSingle();
            if (bmcMatch2) realBmcId = bmcMatch2.id;
          }
        }
      }
    }

    if (!realBmcId) {
      realBmcId = activeTripObj.assigned_bmc_id || (activeTripObj.assigned_bmc ? activeTripObj.assigned_bmc.id : null);
    }
  }

  // Ultimate Fallback: First BMC in bmcs table
  if (!realBmcId) {
    const { data: anyBmc } = await adminClient.from('bmcs').select('id').limit(1).maybeSingle();
    if (anyBmc) realBmcId = anyBmc.id;
  }

  if (!realBmcId) {
    return res.status(400).json({ error: 'Valid BMC record could not be determined for this trip.' });
  }

  // 2. Check if a visit record already exists for this trip + realBmcId
  const { data: existingVisits } = await adminClient
    .from('trip_bmc_visits')
    .select(`*, bmc:bmcs(*),
      ftir_tests(*), gerber_tests(*),
      requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
    .eq('trip_id', req.params.tripId)
    .eq('bmc_id', realBmcId)
    .order('visit_sequence', { ascending: true })
    .limit(1);

  if (existingVisits && existingVisits.length > 0) {
    return res.json({ visit: existingVisits[0] });
  }

  // 3. Insert new visit record if not present
  const { data: existingSeq } = await adminClient
    .from('trip_bmc_visits')
    .select('visit_sequence')
    .eq('trip_id', req.params.tripId)
    .order('visit_sequence', { ascending: false })
    .limit(1);

  const nextSeq = existingSeq && existingSeq.length > 0 ? existingSeq[0].visit_sequence + 1 : 1;

  const insertPayload = {
    trip_id: req.params.tripId,
    bmc_id: realBmcId,
    visit_sequence: nextSeq,
    status: 'pending'
  };

  let { data, error } = await adminClient
    .from('trip_bmc_visits')
    .insert(insertPayload)
    .select(`*, bmc:bmcs(*),
      ftir_tests(*), gerber_tests(*),
      requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
    .maybeSingle();

  if (error) {
    const { data: fallbackVisits } = await adminClient
      .from('trip_bmc_visits')
      .select(`*, bmc:bmcs(*),
        ftir_tests(*), gerber_tests(*),
        requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
      .eq('trip_id', req.params.tripId)
      .eq('bmc_id', realBmcId)
      .limit(1);

    if (fallbackVisits && fallbackVisits.length > 0) {
      return res.json({ visit: fallbackVisits[0] });
    }
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ visit: data });
});

// ─── GET /api/visits/:visitId ────────────────────────────────────────────────
app.get('/api/visits/:visitId', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { visit, error, code } = await verifyVisitOwnership(adminClient, req.params.visitId);
  if (error) return res.status(code || 400).json({ error });

  const { data: completeVisit } = await adminClient
    .from('trip_bmc_visits')
    .select(`*, bmc:bmcs(*),
      ftir_tests(*), gerber_tests(*),
      requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
    .eq('id', req.params.visitId)
    .single();

  res.json({ visit: completeVisit || visit });
});

// ─── PATCH /api/visits/:visitId ───────────────────────────────────────────────
app.patch('/api/visits/:visitId', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { visit, error, code } = await verifyVisitOwnership(adminClient, req.params.visitId);
  if (error) return res.status(code || 400).json({ error });

  // Dynamically inspect existing columns of trip_bmc_visits to prevent schema cache missing column errors
  const { data: sampleRows } = await adminClient.from('trip_bmc_visits').select('*').limit(1);
  const existingCols = sampleRows && sampleRows.length > 0
    ? Object.keys(sampleRows[0])
    : ['compartment', 'status', 'visit_start_time', 'visit_end_time', 'milk_quantity_liters', 'remarks'];

  const updates = {};

  // Extract weight in KG or Liters
  let weightKg = null;
  if (req.body.milk_quantity_kg !== undefined && req.body.milk_quantity_kg !== null) {
    weightKg = parseFloat(req.body.milk_quantity_kg);
  } else if (req.body.in_weight !== undefined && req.body.in_weight !== null) {
    weightKg = parseFloat(req.body.in_weight);
  }

  if (weightKg !== null && !isNaN(weightKg)) {
    if (existingCols.includes('milk_quantity_liters')) {
      updates.milk_quantity_liters = parseFloat((weightKg / 1.03).toFixed(2));
    }
    if (existingCols.includes('milk_quantity_kg')) {
      updates.milk_quantity_kg = weightKg;
    }
    if (existingCols.includes('in_weight')) {
      updates.in_weight = weightKg;
    }
  } else if (req.body.milk_quantity_liters !== undefined && existingCols.includes('milk_quantity_liters')) {
    updates.milk_quantity_liters = parseFloat(req.body.milk_quantity_liters);
  }

  // Handle compartment (strictly 'front' or 'back' to satisfy trip_bmc_visits_compartment_check)
  if (req.body.compartment !== undefined && existingCols.includes('compartment')) {
    const compStr = String(req.body.compartment).toLowerCase().trim();
    updates.compartment = compStr === 'back' ? 'back' : 'front';
  }

  // Handle other allowed columns dynamically
  const otherKeys = ['status', 'visit_start_time', 'visit_end_time', 'remarks'];
  for (const key of otherKeys) {
    if (req.body[key] !== undefined && existingCols.includes(key)) {
      updates[key] = req.body[key];
    }
  }
  updates.updated_at = new Date();

  const { data, error: updateErr } = await adminClient
    .from('trip_bmc_visits')
    .update(updates)
    .eq('id', req.params.visitId)
    .select(`*, bmc:bmcs(*),
      ftir_tests(*), gerber_tests(*),
      requirement_checks(*), bmc_issues(*), bmc_ratings(*)`)
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  if (data) {
    if (!data.milk_quantity_kg && data.milk_quantity_liters) {
      data.milk_quantity_kg = Math.round(data.milk_quantity_liters * 1.03 * 10) / 10;
    }
    if (!data.in_weight) {
      data.in_weight = data.milk_quantity_kg || (data.milk_quantity_liters ? Math.round(data.milk_quantity_liters * 1.03 * 10) / 10 : null);
    }
  }

  res.json({ visit: data });
});

// ─── DELETE /api/visits/:visitId ──────────────────────────────────────────────
app.delete('/api/visits/:visitId', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { visit, error, code } = await verifyVisitOwnership(adminClient, req.params.visitId);
  if (error) return res.status(code || 400).json({ error });

  const { error: delErr } = await adminClient.from('trip_bmc_visits').delete().eq('id', req.params.visitId);
  if (delErr) return res.status(500).json({ error: delErr.message });

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
  const { adminClient } = req;
  const { fat, snf, protein, lactose, water_percentage, temperature, remarks, image_url } = req.body;

  const { visit, error, code } = await verifyVisitOwnership(adminClient, req.params.visitId);
  if (error) return res.status(code || 400).json({ error });

  let overall_result = 'pass';
  if (fat !== undefined && fat < 3.0) overall_result = 'fail';
  else if (snf !== undefined && snf < 8.0) overall_result = 'fail';
  else if (water_percentage !== undefined && water_percentage > 5) overall_result = 'warning';

  const { data: existing } = await adminClient.from('ftir_tests').select('id').eq('visit_id', req.params.visitId).maybeSingle();

  let formattedRemarks = remarks || '';
  if (image_url && !formattedRemarks.includes('[FTIR_IMAGE:')) {
    formattedRemarks = formattedRemarks ? `${formattedRemarks} [FTIR_IMAGE: ${image_url}]` : `[FTIR_IMAGE: ${image_url}]`;
  }

  const payload = {
    visit_id: req.params.visitId,
    fat: fat !== undefined ? fat : null,
    snf: snf !== undefined ? snf : null,
    protein: protein || null,
    lactose: lactose || null,
    water_percentage: water_percentage || null,
    temperature: temperature || null,
    overall_result,
    remarks: formattedRemarks,
    tested_at: new Date()
  };

  if (image_url) {
    payload.image_url = image_url;
  }

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
  res.json({ ftir: result.data });
});

// ─── POST /api/visits/:visitId/gerber ────────────────────────────────────────
app.post('/api/visits/:visitId/gerber', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { fat_percentage, clr, snf, sample_temp, remarks } = req.body;

  const { visit, error, code } = await verifyVisitOwnership(adminClient, req.params.visitId);
  if (error) return res.status(code || 400).json({ error });

  let overall_result = 'pass';
  if (fat_percentage !== undefined && fat_percentage < 3.0) overall_result = 'fail';
  if (clr !== undefined && (clr < 26 || clr > 32)) overall_result = 'warning';

  const { data: existing } = await adminClient.from('gerber_tests').select('id').eq('visit_id', req.params.visitId).maybeSingle();
  let result;
  const payload = {
    visit_id: req.params.visitId,
    fat_percentage: fat_percentage !== undefined ? fat_percentage : null,
    clr: clr !== undefined ? clr : null,
    snf: snf !== undefined ? snf : null,
    sample_temp: sample_temp || null,
    overall_result,
    remarks: remarks || '',
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
  const { adminClient } = req;
  const fields = ['seal_cutter_available','seal_cutter_working','acid_available','acid_condition',
    'ftir_machine_available','ftir_machine_working','cooling_system_working',
    'power_backup_available','weighing_scale_working','remarks'];
  const payload = { visit_id: req.params.visitId };
  for (const f of fields) { if (req.body[f] !== undefined) payload[f] = req.body[f]; }

  const { visit, error, code } = await verifyVisitOwnership(adminClient, req.params.visitId);
  if (error) return res.status(code || 400).json({ error });

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
  const { adminClient } = req;
  const { category, description, severity, remarks, image_url } = req.body;
  if (!category || !description) return res.status(400).json({ error: 'category and description are required.' });

  const { visit, error, code } = await verifyVisitOwnership(adminClient, req.params.visitId);
  if (error) return res.status(code || 400).json({ error });

  const validCategories = ['cleanliness', 'temperature', 'maintenance', 'equipment', 'operational', 'other'];
  const catLower = String(category || '').toLowerCase().trim();
  const safeCategory = validCategories.includes(catLower) ? catLower : 'equipment';

  const { data: existing } = await adminClient.from('bmc_issues').select('id').eq('visit_id', req.params.visitId).maybeSingle();

  const payload = {
    visit_id: req.params.visitId,
    category: safeCategory,
    description,
    severity: severity ? String(severity).toLowerCase() : 'medium',
    remarks: remarks || description,
    image_url
  };

  let result;
  if (existing) {
    result = await adminClient.from('bmc_issues').update(payload).eq('id', existing.id).select().single();
  } else {
    result = await adminClient.from('bmc_issues').insert(payload).select().single();
  }

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.status(200).json({ issue: result.data });
});

// ─── DELETE /api/issues/:issueId ─────────────────────────────────────────────
app.delete('/api/issues/:issueId', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { data: issue } = await adminClient.from('bmc_issues').select('visit_id').eq('id', req.params.issueId).single();
  if (!issue) return res.status(404).json({ error: 'Issue not found.' });

  const { visit, error, code } = await verifyVisitOwnership(adminClient, issue.visit_id);
  if (error) return res.status(code || 400).json({ error });

  await adminClient.from('bmc_issues').delete().eq('id', req.params.issueId);
  res.json({ success: true });
});

// ─── POST /api/visits/:visitId/rating ────────────────────────────────────────
app.post('/api/visits/:visitId/rating', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { behaviour, cooperation, cleanliness, infrastructure, remarks } = req.body;

  const { visit, error, code } = await verifyVisitOwnership(adminClient, req.params.visitId);
  if (error) return res.status(code || 400).json({ error });

  const { data: existing } = await adminClient.from('bmc_ratings').select('id').eq('visit_id', req.params.visitId).maybeSingle();
  let result;
  const payload = {
    visit_id: req.params.visitId,
    behaviour: behaviour || 5,
    cooperation: cooperation || 5,
    cleanliness: cleanliness || 5,
    infrastructure: infrastructure || 5,
    remarks: remarks || ''
  };

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
  if (profile.role !== 'transport_officer' && profile.role !== 'driver' && profile.role !== 'admin' && profile.role !== 'gm' && profile.role !== 'pi_agm') {
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
      adminClient.from('trips').select('*').neq('status', 'deleted').order('created_at', { ascending: false }),
      adminClient.from('driver_trips').select('*').neq('status', 'deleted').order('created_at', { ascending: false })
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
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  try {
    const { data: vehicles } = await adminClient.from('tankers').select('*').order('board_number');
    const { data: trips } = await adminClient.from('trips').select('*').neq('status', 'deleted');

    const vehiclesWithStats = (vehicles || []).map(vehicle => {
      const vehicleTrips = (trips || []).filter(t => t.tanker_number === vehicle.board_number);
      const lastTrip = vehicleTrips.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      const capacityVal = vehicle.capacity_liters ?? vehicle.capacity ?? 5000;

      return {
        ...vehicle,
        capacity_liters: capacityVal,
        capacity: capacityVal,
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
  const { board_number, capacity_liters, capacity, compartments, is_active } = req.body;

  if (!board_number) {
    return res.status(400).json({ error: 'Vehicle board number is required' });
  }

  const rawCap = capacity_liters !== undefined ? capacity_liters : capacity;
  const capVal = rawCap ? parseInt(rawCap) : 5000;

  try {
    const insertData = {
      board_number,
      capacity_liters: capVal,
      capacity: capVal,
      compartments: compartments || 2,
      is_active: is_active !== false
    };

    let { data, error } = await adminClient
      .from('tankers')
      .insert(insertData)
      .select();

    if (error && error.message && (error.message.includes('capacity_liters') || error.message.includes('capacity'))) {
      delete insertData.capacity;
      let res1 = await adminClient.from('tankers').insert(insertData).select();
      if (res1.error) {
        delete insertData.capacity_liters;
        insertData.capacity = capVal;
        res1 = await adminClient.from('tankers').insert(insertData).select();
      }
      data = res1.data;
      error = res1.error;
    }

    if (error) throw error;
    res.status(201).json({ vehicle: data && data.length > 0 ? data[0] : null });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create vehicle' });
  }
});

app.put('/api/transport/vehicles/:id', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  const vehicleId = req.params.id;
  const body = req.body;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[VEHICLE UPDATE] ID:', vehicleId);
  console.log('[VEHICLE UPDATE] Body:', JSON.stringify(body));

  const capValue = body.capacity_liters !== undefined ? parseInt(body.capacity_liters) :
                    body.capacity !== undefined ? parseInt(body.capacity) : undefined;

  const updateData = {};
  if (body.board_number !== undefined) updateData.board_number = body.board_number;
  if (capValue !== undefined) {
    updateData.capacity_liters = capValue;
    updateData.capacity = capValue;
  }
  if (body.compartments !== undefined) updateData.compartments = parseInt(body.compartments);
  if (body.is_active !== undefined) updateData.is_active = body.is_active;

  console.log('[VEHICLE UPDATE] Update payload:', JSON.stringify(updateData));

  try {
    // Attempt 1: send both capacity columns
    let { data, error } = await adminClient
      .from('tankers')
      .update(updateData)
      .eq('id', vehicleId)
      .select();

    console.log('[VEHICLE UPDATE] Attempt 1 - error:', error ? error.message : 'none');
    console.log('[VEHICLE UPDATE] Attempt 1 - data:', JSON.stringify(data));

    // Attempt 2: remove 'capacity' if it caused the error
    if (error) {
      console.log('[VEHICLE UPDATE] Attempt 2 - removing capacity column...');
      delete updateData.capacity;
      const r2 = await adminClient.from('tankers').update(updateData).eq('id', vehicleId).select();
      console.log('[VEHICLE UPDATE] Attempt 2 - error:', r2.error ? r2.error.message : 'none');
      console.log('[VEHICLE UPDATE] Attempt 2 - data:', JSON.stringify(r2.data));
      data = r2.data;
      error = r2.error;
    }

    // Attempt 3: remove 'capacity_liters', use 'capacity' only
    if (error) {
      console.log('[VEHICLE UPDATE] Attempt 3 - using capacity only...');
      delete updateData.capacity_liters;
      updateData.capacity = capValue;
      const r3 = await adminClient.from('tankers').update(updateData).eq('id', vehicleId).select();
      console.log('[VEHICLE UPDATE] Attempt 3 - error:', r3.error ? r3.error.message : 'none');
      console.log('[VEHICLE UPDATE] Attempt 3 - data:', JSON.stringify(r3.data));
      data = r3.data;
      error = r3.error;
    }

    if (error) throw error;

    const vehicle = data && data.length > 0 ? data[0] : null;
    console.log('[VEHICLE UPDATE] SUCCESS. Returned capacity_liters:', vehicle?.capacity_liters, 'capacity:', vehicle?.capacity);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    res.json({ vehicle });
  } catch (err) {
    console.error('[VEHICLE UPDATE] EXCEPTION:', err.message);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
      .neq('status', 'deleted')
      .gte('created_at', startIso)
      .lte('created_at', endIso);

    // Step 3: Fetch legacy trips matched by driver_name as fallback
    const { data: legacyTripsData } = await adminClient
      .from('trips')
      .select('*')
      .neq('status', 'deleted')
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
  const outKmNum = Number(outKm || 0);
  const inKmNum = Number(inKm || 0);
  const kmTravelled = (inKmNum > 0 && outKmNum > 0 && inKmNum >= outKmNum) 
    ? parseFloat((inKmNum - outKmNum).toFixed(2)) 
    : (inKmNum > 0 && inKmNum >= outKmNum ? parseFloat((inKmNum - outKmNum).toFixed(2)) : 0);

  const hasInWeight = inWeight !== undefined && inWeight !== null && inWeight !== '' && inWeight !== '—';
  const outWeightNum = Number(outWeight || 0);
  const inWeightNum = hasInWeight ? Number(inWeight) : null;

  if (!hasInWeight || isNaN(inWeightNum) || outWeightNum <= 0 || outWeightNum <= inWeightNum) {
    return {
      weightDiff: null,
      kmTravelled,
      dieselConsumption: null,
      averageMileage: null
    };
  }

  const dieselKg = parseFloat((outWeightNum - inWeightNum).toFixed(2));
  const dieselConsumption = parseFloat((dieselKg / 0.832).toFixed(2));
  const averageMileage = (dieselConsumption > 0 && kmTravelled > 0) 
    ? parseFloat((kmTravelled / dieselConsumption).toFixed(2)) 
    : null;

  return {
    weightDiff: dieselKg,
    kmTravelled,
    dieselConsumption,
    averageMileage
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
      .neq('status', 'deleted')
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
      .neq('status', 'deleted')
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
      .select('id, assigned_driver_id, status, remarks, start_lat, start_lng, end_lat, end_lng')
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

    // journey_path column does not exist in schema, relying solely on remarks encoded data

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
    // 1. Fetch all active/in-progress driver trips (not completed, cancelled, or deleted)
    const { data: activeTrips, error } = await adminClient
      .from('driver_trips')
      .select('id, trip_number, assigned_driver_id, vehicle_number, route, destination, bmc_name, status, start_lat, start_lng, end_lat, end_lng, remarks, updated_at, started_at, created_at')
      .not('status', 'in', '("completed","cancelled","deleted")');

    if (error) throw error;

    // 2. Fetch unified drivers map for reliable names & fallback locations
    const drivers = await getUnifiedDrivers(adminClient);
    const driverMap = {};
    drivers.forEach(d => {
      if (d.id) driverMap[d.id] = d;
      if (d.name) driverMap[d.name.toLowerCase().trim()] = d;
    });

    // 3. Also fetch the most recent completed trips with location as fallback for drivers without current trip coordinates
    const { data: recentCompletedTrips } = await adminClient
      .from('driver_trips')
      .select('assigned_driver_id, end_lat, end_lng, updated_at')
      .not('end_lat', 'is', null)
      .not('end_lng', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(50);

    const driverLastLocationMap = {};
    (recentCompletedTrips || []).forEach(t => {
      if (t.assigned_driver_id && !driverLastLocationMap[t.assigned_driver_id] && Number(t.end_lat) !== 0) {
        driverLastLocationMap[t.assigned_driver_id] = {
          lat: Number(t.end_lat),
          lng: Number(t.end_lng),
          timestamp: t.updated_at,
          source: 'previous_duty'
        };
      }
    });

    const now = Date.now();
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

      // Filter and clean journey points
      journey = (journey || []).filter(pt => pt && !isNaN(Number(pt.lat)) && !isNaN(Number(pt.lng)) && Number(pt.lat) !== 0 && Number(pt.lng) !== 0);

      // If journey has no points but start_lat/lng exists, push start point
      if (journey.length === 0 && trip.start_lat && trip.start_lng && Number(trip.start_lat) !== 0) {
        journey.push({
          lat: Number(trip.start_lat),
          lng: Number(trip.start_lng),
          timestamp: trip.started_at || trip.created_at || trip.updated_at
        });
      }

      const driverProfile = driverMap[trip.assigned_driver_id] || {};
      const driverName = driverProfile.name || 'Driver';

      // Determine latest point & location source
      let latestPt = null;
      let locationType = 'none';

      if (journey.length > 0) {
        latestPt = journey[journey.length - 1];
        locationType = journey.length > 1 ? 'live_track' : 'trip_start';
      } else if (trip.end_lat && trip.end_lng && Number(trip.end_lat) !== 0) {
        latestPt = { lat: Number(trip.end_lat), lng: Number(trip.end_lng), timestamp: trip.updated_at };
        locationType = 'last_recorded';
      } else if (trip.start_lat && trip.start_lng && Number(trip.start_lat) !== 0) {
        latestPt = { lat: Number(trip.start_lat), lng: Number(trip.start_lng), timestamp: trip.started_at || trip.created_at };
        locationType = 'trip_start';
      } else if (driverLastLocationMap[trip.assigned_driver_id]) {
        latestPt = driverLastLocationMap[trip.assigned_driver_id];
        locationType = 'previous_duty';
      }

      // Check if location is "live" (updated within last 10 minutes and trip in active state)
      let isLive = false;
      if (latestPt && latestPt.timestamp) {
        const timeDiffMs = now - new Date(latestPt.timestamp).getTime();
        const activeState = ['started', 'in_progress', 'active', 'returning'].includes(trip.status);
        if (activeState && timeDiffMs < 10 * 60 * 1000) { // 10 minutes
          isLive = true;
        }
      }

      return {
        id: trip.id,
        trip_number: trip.trip_number,
        driver_id: trip.assigned_driver_id,
        driver_name: driverName,
        driver_phone: driverProfile.phone || '',
        vehicle_number: trip.vehicle_number || '—',
        route: trip.route || trip.destination || trip.bmc_name || 'Route',
        status: trip.status,
        latest_location: latestPt,
        is_live: isLive,
        location_type: locationType,
        journey_path: journey,
        updated_at: trip.updated_at,
        started_at: trip.started_at
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

// ─── Unified Trip Management JWT Middleware ─────────────────────────────────
async function requireTripManager(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });

  const allowedRoles = ['transport_officer', 'pi_agm', 'gm', 'admin', 'qc_agm', 'worker', 'driver'];
  if (!allowedRoles.includes(profile.role)) {
    return res.status(403).json({ error: 'Management authorization required.' });
  }

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

// DELETE /api/gm/trips/:id, /api/transport/driver-trips/:id, /api/transport/duties/:id — Safely & permanently delete a duty from all tables
const safeDeleteDutyHandler = async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;

  console.log(`[Trip Deletion Request] Initiated for ID: ${id} by user: ${req.profile?.name || 'Unknown'} (${req.profile?.role || 'Unknown'})`);

  try {
    if (!id) {
      return res.status(400).json({ success: false, message: 'Trip ID is required.' });
    }

    let driverTripId = id;
    let tripId = id;

    // 1. Authoritative lookup of both driver_trips and trips
    // Note: driver_trips does NOT have a driver_name column; we query valid columns only.
    const { data: dtExists, error: dtCheckErr } = await adminClient
      .from('driver_trips')
      .select('id, created_at, vehicle_number, assigned_driver_id, status')
      .eq('id', id)
      .maybeSingle();

    if (dtCheckErr) {
      console.warn(`Warning checking driver_trips for ID ${id}:`, dtCheckErr.message);
    }

    const { data: tExists, error: tCheckErr } = await adminClient
      .from('trips')
      .select('id, created_at, driver_name, tanker_number, status')
      .eq('id', id)
      .maybeSingle();

    if (tCheckErr) {
      console.warn(`Warning checking trips for ID ${id}:`, tCheckErr.message);
    }

    // Resolve linkage for legacy records where IDs may differ
    if (dtExists && !tExists) {
      let dName = null;
      if (dtExists.assigned_driver_id) {
        const { data: p } = await adminClient.from('profiles').select('name').eq('id', dtExists.assigned_driver_id).maybeSingle();
        if (p) dName = p.name;
      }
      if (dName && dtExists.vehicle_number) {
        const { data: candidates } = await adminClient
          .from('trips')
          .select('id, created_at')
          .eq('driver_name', dName)
          .eq('tanker_number', dtExists.vehicle_number)
          .neq('status', 'deleted');

        if (candidates && candidates.length > 0) {
          const dtTime = new Date(dtExists.created_at).getTime();
          let best = null;
          let minDiff = Infinity;
          for (const cand of candidates) {
            const diff = Math.abs(dtTime - new Date(cand.created_at).getTime());
            if (diff < minDiff && diff < 15 * 60 * 1000) {
              minDiff = diff;
              best = cand;
            }
          }
          if (best) {
            tripId = best.id;
            console.log(`[Trip Deletion Linkage] Resolved driver_trip ID ${id} to trip ID ${tripId}`);
          }
        }
      }
    } else if (tExists && !dtExists) {
      if (tExists.driver_name && tExists.tanker_number) {
        const { data: candidates } = await adminClient
          .from('driver_trips')
          .select('id, created_at')
          .eq('vehicle_number', tExists.tanker_number)
          .neq('status', 'deleted');

        if (candidates && candidates.length > 0) {
          const tTime = new Date(tExists.created_at).getTime();
          let best = null;
          let minDiff = Infinity;
          for (const cand of candidates) {
            const diff = Math.abs(tTime - new Date(cand.created_at).getTime());
            if (diff < minDiff && diff < 15 * 60 * 1000) {
              minDiff = diff;
              best = cand;
            }
          }
          if (best) {
            driverTripId = best.id;
            console.log(`[Trip Deletion Linkage] Resolved trip ID ${id} to driver_trip ID ${driverTripId}`);
          }
        }
      }
    }

    const allTargetTripIds = [...new Set([id, tripId, driverTripId].filter(Boolean))];
    console.log(`[Trip Deletion Execute] Target trip IDs for cleanup:`, allTargetTripIds);

    // Helper to safely execute table deletes without blowing up if table/column missing
    const safeDeleteRows = async (tableName, matchColumn, matchValues) => {
      if (!matchValues || matchValues.length === 0) return;
      try {
        if (Array.isArray(matchValues)) {
          await adminClient.from(tableName).delete().in(matchColumn, matchValues);
        } else {
          await adminClient.from(tableName).delete().eq(matchColumn, matchValues);
        }
      } catch (err) {
        console.warn(`Safe delete notice for table ${tableName}:`, err.message);
      }
    };

    // 2. Clean up child records referencing trip_bmc_visits
    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('id')
      .in('trip_id', allTargetTripIds);

    const visitIds = (visits || []).map(v => v.id);

    if (visitIds.length > 0) {
      await safeDeleteRows('ftir_tests', 'visit_id', visitIds);
      await safeDeleteRows('gerber_tests', 'visit_id', visitIds);
      await safeDeleteRows('bmc_issues', 'visit_id', visitIds);
      await safeDeleteRows('bmc_ratings', 'visit_id', visitIds);
      await safeDeleteRows('requirement_checks', 'visit_id', visitIds);
      await safeDeleteRows('qc_lab_tests', 'visit_id', visitIds);
      await safeDeleteRows('qc_test_reviews', 'visit_id', visitIds);
      await safeDeleteRows('qc_audit_logs', 'visit_id', visitIds);
      await safeDeleteRows('trip_bmc_visits', 'id', visitIds);
    }

    await safeDeleteRows('trip_bmc_visits', 'trip_id', allTargetTripIds);

    // 3. Soft delete attempt (update status to deleted)
    try {
      await adminClient.from('driver_trips').update({ status: 'deleted' }).in('id', allTargetTripIds);
      await adminClient.from('trips').update({ status: 'deleted', assignment_status: 'deleted' }).in('id', allTargetTripIds);
    } catch (softErr) {
      console.warn('Warning during soft delete phase:', softErr.message);
    }

    // 4. Authoritative Hard Delete from both driver_trips and trips
    const { error: dtHardErr } = await adminClient.from('driver_trips').delete().in('id', allTargetTripIds);
    if (dtHardErr) console.warn(`Notice deleting driver_trips: ${dtHardErr.message}`);

    const { error: tHardErr } = await adminClient.from('trips').delete().in('id', allTargetTripIds);
    if (tHardErr) console.warn(`Notice deleting trips: ${tHardErr.message}`);

    console.log(`[Trip Deletion Success] Permanently deleted trip ${id} from driver_trips, trips, and visit tables.`);
    return res.json({ success: true, message: 'Trip deleted permanently.', tripId: id });
  } catch (err) {
    console.error('❌ Error in safeDeleteDutyHandler:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to delete driver trip duty.' });
  }
};

app.delete('/api/gm/trips/:id', requireTripManager, safeDeleteDutyHandler);
app.delete('/api/gm/pending-trips/:id', requireTripManager, safeDeleteDutyHandler);
app.delete('/api/transport/driver-trips/:id', requireTripManager, safeDeleteDutyHandler);
app.delete('/api/transport/duties/:id', requireTripManager, safeDeleteDutyHandler);
app.delete('/api/pi-agm/trips/:id', requireTripManager, safeDeleteDutyHandler);
app.delete('/api/admin/trips/:id', requireTripManager, safeDeleteDutyHandler);

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
// Query params: ?date=YYYY-MM-DD&period=morning|evening|both
app.get('/api/transport/bmcs-list', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: bmcs, error } = await adminClient
      .from('bmcs')
      .select('id, name, location, is_active, total_capacity, bmc_code')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;

    // Use query param date or default to today
    let dateStr = req.query.date || new Date().toISOString().split('T')[0];
    const period = (req.query.period || 'both').toLowerCase();

    let { data: macsRows } = await adminClient
      .from('qc_excel_import_rows')
      .select('sample_ref, raw_data, bmc_id, bmc_name, test_date')
      .eq('test_date', dateStr);

    // Fallback: If no MACS rows for selected date, fetch the latest date available
    if (!macsRows || macsRows.length === 0) {
      const { data: latestRow } = await adminClient
        .from('qc_excel_import_rows')
        .select('test_date')
        .order('test_date', { ascending: false })
        .limit(1);

      if (latestRow && latestRow.length > 0) {
        dateStr = latestRow[0].test_date;
        const { data: fallbackRows } = await adminClient
          .from('qc_excel_import_rows')
          .select('sample_ref, raw_data, bmc_id, bmc_name, test_date')
          .eq('test_date', dateStr);
        macsRows = fallbackRows || [];
      }
    }

    // Build MACS KG Map keyed by bmc_id, bmc_code, sample_ref, and lowercase bmc_name
    const bmcKgMap = {};
    (macsRows || []).forEach(r => {
      const raw = r.raw_data || {};
      const rowPeriod = (raw.period || '').toLowerCase();
      if (period === 'morning' && !(rowPeriod === 'morning' || rowPeriod === 'both')) return;
      if (period === 'evening' && !(rowPeriod === 'evening' || rowPeriod === 'both')) return;

      let kg = raw.macs_quantity_kg ?? (raw.macs_quantity_liters ? Number(raw.macs_quantity_liters) * 1.03 : null);
      if (kg !== null && !isNaN(kg) && Number(kg) > 0) {
        const val = parseFloat(Number(kg).toFixed(2));
        if (r.bmc_id) bmcKgMap[r.bmc_id] = Math.max(bmcKgMap[r.bmc_id] || 0, val);
        if (raw.bmc_id) bmcKgMap[raw.bmc_id] = Math.max(bmcKgMap[raw.bmc_id] || 0, val);
        const code = String(r.sample_ref || raw.bmc_code || '').trim();
        if (code) bmcKgMap[code] = Math.max(bmcKgMap[code] || 0, val);
        const nameKey = String(r.bmc_name || raw.bmc_name || '').trim().toLowerCase();
        if (nameKey) bmcKgMap[nameKey] = Math.max(bmcKgMap[nameKey] || 0, val);
      }
    });

    const enrichedBmcs = (bmcs || []).map(b => {
      const nameKey = String(b.name || '').trim().toLowerCase();
      const bmcCodeStr = String(b.bmc_code || '').trim();
      const totalKg = bmcKgMap[b.id] ?? bmcKgMap[bmcCodeStr] ?? bmcKgMap[nameKey] ?? null;

      return {
        ...b,
        macs_quantity_today: totalKg !== null ? parseFloat((totalKg / 1.03).toFixed(2)) : null,
        macs_quantity_kg: totalKg
      };
    });

    res.json({ bmcs: enrichedBmcs, date: dateStr, period });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch BMCs list.' });
  }
});

// GET /api/transport/macs-summary — Detailed MACS data table for Transport Officer
// Query params: ?date=YYYY-MM-DD&period=morning|evening|both|all
app.get('/api/transport/macs-summary', requireTransportOfficer, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: bmcs, error } = await adminClient
      .from('bmcs')
      .select('id, name, bmc_code, location, is_active, total_capacity')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;

    let dateStr = req.query.date || new Date().toISOString().split('T')[0];
    const period = (req.query.period || 'all').toLowerCase();

    let { data: macsRows } = await adminClient
      .from('qc_excel_import_rows')
      .select('sample_ref, raw_data, bmc_id, bmc_name, test_date')
      .eq('test_date', dateStr);

    // Fallback: If no MACS rows for selected date, fetch the latest date available
    if (!macsRows || macsRows.length === 0) {
      const { data: latestRow } = await adminClient
        .from('qc_excel_import_rows')
        .select('test_date')
        .order('test_date', { ascending: false })
        .limit(1);

      if (latestRow && latestRow.length > 0) {
        dateStr = latestRow[0].test_date;
        const { data: fallbackRows } = await adminClient
          .from('qc_excel_import_rows')
          .select('sample_ref, raw_data, bmc_id, bmc_name, test_date')
          .eq('test_date', dateStr);
        macsRows = fallbackRows || [];
      }
    }

    const bmcDataMap = {};
    (macsRows || []).forEach(r => {
      const raw = r.raw_data || {};
      const rowPeriod = (raw.period || '').toLowerCase();
      if (period === 'morning' && !(rowPeriod === 'morning' || rowPeriod === 'both')) return;
      if (period === 'evening' && !(rowPeriod === 'evening' || rowPeriod === 'both')) return;

      const kgVal = raw.macs_quantity_kg ?? (raw.macs_quantity_liters ? Number(raw.macs_quantity_liters) * 1.03 : null);
      const litersVal = raw.macs_quantity_liters ?? (raw.macs_quantity_kg ? Number(raw.macs_quantity_kg) / 1.03 : null);

      if ((kgVal !== null && kgVal !== undefined && Number(kgVal) > 0) || (litersVal !== null && litersVal !== undefined && Number(litersVal) > 0)) {
        const kg = kgVal ? parseFloat(Number(kgVal).toFixed(2)) : null;
        const liters = litersVal ? parseFloat(Number(litersVal).toFixed(2)) : null;
        const displayBatch = rowPeriod ? (rowPeriod.charAt(0).toUpperCase() + rowPeriod.slice(1)) : 'Both';

        const item = {
          kg,
          liters,
          batch: displayBatch,
          test_date: r.test_date || dateStr
        };

        if (r.bmc_id) bmcDataMap[r.bmc_id] = item;
        if (raw.bmc_id) bmcDataMap[raw.bmc_id] = item;
        const code = String(r.sample_ref || raw.bmc_code || '').trim();
        if (code) bmcDataMap[code] = item;
        const nameKey = String(r.bmc_name || raw.bmc_name || '').trim().toLowerCase();
        if (nameKey) bmcDataMap[nameKey] = item;
      }
    });

    let totalKgSum = 0;
    let totalLitersSum = 0;
    let matchedCount = 0;

    const list = (bmcs || []).map(b => {
      const nameKey = String(b.name || '').trim().toLowerCase();
      const codeKey = String(b.bmc_code || '').trim();
      const match = bmcDataMap[b.id] || bmcDataMap[codeKey] || bmcDataMap[nameKey] || null;

      if (match) {
        matchedCount++;
        if (match.kg) totalKgSum += match.kg;
        if (match.liters) totalLitersSum += match.liters;
      }

      return {
        id: b.id,
        bmc_code: b.bmc_code || '-',
        bmc_name: b.name,
        location: b.location || '',
        date: dateStr,
        batch: match ? match.batch : '-',
        capacity_kg: match && match.kg !== null ? match.kg : null,
        capacity_litre: match && match.liters !== null ? match.liters : null,
        has_macs_data: !!match
      };
    });

    res.json({
      date: dateStr,
      period,
      summary: {
        total_bmcs: list.length,
        matched_bmcs: matchedCount,
        total_kg: parseFloat(totalKgSum.toFixed(2)),
        total_liters: parseFloat(totalLitersSum.toFixed(2))
      },
      bmcs: list
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch MACS summary.' });
  }
});

// ─── EXECUTIVE OFFICER MIDDLEWARE & HELPER ────────────────────────────────────
async function requireExecutiveOfficer(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  const adminClient = getAdminClient();
  if (!adminClient) return res.status(503).json({ error: 'Server not configured.' });

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await adminClient
    .from('profiles').select('*').eq('id', user.id).single();

  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (profile.role !== 'executive_officer' && profile.role !== 'admin') {
    return res.status(403).json({ error: 'Executive Officer access required.' });
  }
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Account not yet approved.' });

  req.user = user;
  req.profile = profile;
  req.adminClient = adminClient;
  next();
}

async function getEoAssignedBmcIds(adminClient, eoId) {
  try {
    const { data, error } = await adminClient
      .from('eo_bmc_assignments')
      .select('bmc_id')
      .eq('eo_id', eoId)
      .eq('status', 'active');
    if (error) {
      console.warn('Could not fetch eo_bmc_assignments (table might be initializing):', error.message);
      return [];
    }
    return (data || []).map(r => r.bmc_id).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// ─── EXECUTIVE OFFICER API ENDPOINTS ──────────────────────────────────────────

// GET /api/eo/dashboard — Summary statistics and assigned BMC cards
app.get('/api/eo/dashboard', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);

    if (assignedBmcIds.length === 0) {
      return res.json({
        summary: {
          total_assigned_bmcs: 0,
          active_bmcs: 0,
          total_reports: 0,
          pending_reports: 0,
          todays_tests: 0,
          quality_alerts: 0
        },
        bmcs: []
      });
    }

    // Fetch assigned BMCs
    const { data: bmcs } = await adminClient
      .from('bmcs')
      .select('*')
      .in('id', assignedBmcIds);

    // Fetch visits for these BMCs
    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*')
      .in('bmc_id', assignedBmcIds)
      .order('visited_at', { ascending: false });

    const visitIds = (visits || []).map(v => v.id);

    // Fetch FTIR & Gerber tests
    let ftirTests = [];
    let gerberTests = [];
    if (visitIds.length > 0) {
      const ftirRes = await adminClient.from('ftir_tests').select('*').in('visit_id', visitIds);
      const gerberRes = await adminClient.from('gerber_tests').select('*').in('visit_id', visitIds);
      ftirTests = ftirRes.data || [];
      gerberTests = gerberRes.data || [];
    }

    // Fetch issues/reports
    let bmcIssues = [];
    if (visitIds.length > 0) {
      const { data: issues } = await adminClient.from('bmc_issues').select('*').in('visit_id', visitIds);
      bmcIssues = issues || [];
    }

    // Calculate dates
    const todayStr = new Date().toISOString().split('T')[0];

    // Compute stats
    let todaysTestsCount = 0;
    let qualityAlertsCount = 0;

    const allTests = [...ftirTests, ...gerberTests];
    allTests.forEach(t => {
      const testDate = (t.created_at || t.test_time || '').split('T')[0];
      if (testDate === todayStr) todaysTestsCount++;
      if (t.status === 'fail' || t.status === 'warning' || (t.quality_grade && t.quality_grade.toLowerCase().includes('fail'))) {
        qualityAlertsCount++;
      }
    });

    const activeBmcsCount = (bmcs || []).filter(b => b.is_active !== false).length;
    const totalReports = (bmcIssues || []).length;
    const pendingReports = (bmcIssues || []).filter(i => i.status === 'open' || i.status === 'pending').length;

    // Build enriched BMC cards
    const enrichedBmcs = (bmcs || []).map(bmc => {
      const bmcVisits = (visits || []).filter(v => v.bmc_id === bmc.id);
      const bmcVisitIds = new Set(bmcVisits.map(v => v.id));
      const bmcTests = allTests.filter(t => bmcVisitIds.has(t.visit_id));
      const bmcTodayTests = bmcTests.filter(t => (t.created_at || t.test_time || '').split('T')[0] === todayStr);

      const latestTest = bmcTests.sort((a, b) => new Date(b.created_at || b.test_time || 0) - new Date(a.created_at || a.test_time || 0))[0] || null;
      const latestVisit = bmcVisits[0] || null;
      const uniqueWorkers = new Set(bmcVisits.map(v => v.worker_id).filter(Boolean)).size;

      return {
        id: bmc.id,
        name: bmc.name,
        code: bmc.code || bmc.bmc_code || `BMC-${bmc.id.substring(0, 4)}`,
        district: bmc.district || '—',
        location: bmc.location || '—',
        association_name: bmc.association_name || 'Milk Producers Association',
        is_active: bmc.is_active !== false,
        status: bmc.is_active !== false ? 'Active' : 'Inactive',
        assigned_workers_count: uniqueWorkers,
        todays_test_count: bmcTodayTests.length,
        latest_test_date: latestTest ? (latestTest.created_at || latestTest.test_time) : null,
        latest_test_result: latestTest ? (latestTest.status || latestTest.quality_grade || 'Normal') : 'No tests',
        latest_report_date: latestVisit ? latestVisit.visited_at : null,
        last_activity: latestVisit ? latestVisit.visited_at : (bmc.updated_at || bmc.created_at)
      };
    });

    res.json({
      summary: {
        total_assigned_bmcs: assignedBmcIds.length,
        active_bmcs: activeBmcsCount,
        total_reports: totalReports,
        pending_reports: pendingReports,
        todays_tests: todaysTestsCount,
        quality_alerts: qualityAlertsCount
      },
      bmcs: enrichedBmcs
    });
  } catch (err) {
    console.error('EO Dashboard API Error:', err);
    res.status(500).json({ error: err.message || 'Failed to load EO dashboard.' });
  }
});

// GET /api/eo/bmcs — Get assigned BMCs list
app.get('/api/eo/bmcs', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);
    if (assignedBmcIds.length === 0) return res.json({ bmcs: [] });

    const { data: bmcs, error } = await adminClient
      .from('bmcs')
      .select('*')
      .in('id', assignedBmcIds)
      .order('name');

    if (error) throw error;
    res.json({ bmcs: bmcs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch assigned BMCs.' });
  }
});

// GET /api/eo/bmcs/:id — Get single assigned BMC details
app.get('/api/eo/bmcs/:bmcCode', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  const { data: bmcData } = await adminClient.from('bmcs').select('id').eq('bmc_code', req.params.bmcCode).single();
  if (!bmcData) return res.status(404).json({ error: 'BMC not found' });
  const bmcId = bmcData.id;

  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);
    if (!assignedBmcIds.includes(bmcId)) {
      return res.status(403).json({ error: 'Access denied. BMC is not assigned to this Executive Officer.' });
    }

    const { data: bmc, error } = await adminClient
      .from('bmcs')
      .select('*')
      .eq('id', bmcId)
      .single();

    if (error || !bmc) return res.status(404).json({ error: 'BMC not found.' });

    // Fetch visits & workers
    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*')
      .eq('bmc_id', bmcId)
      .order('visited_at', { ascending: false });

    const workerIds = Array.from(new Set((visits || []).map(v => v.worker_id).filter(Boolean)));
    let workerProfiles = [];
    if (workerIds.length > 0) {
      const { data: wp } = await adminClient.from('profiles').select('id, name, email').in('id', workerIds);
      workerProfiles = wp || [];
    }

    res.json({
      bmc: {
        ...bmc,
        assigned_eo_name: profile.name,
        assigned_workers: workerProfiles
      },
      recent_visits: visits || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch BMC details.' });
  }
});

// GET /api/eo/test-results — Read-only milk test results across assigned BMCs
app.get('/api/eo/test-results', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  const { dateFilter, startDate, endDate, bmcId, quality, sortBy } = req.query;

  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);
    if (assignedBmcIds.length === 0) return res.json({ testResults: [] });

    let allowedBmcIds = assignedBmcIds;
    if (bmcId) {
      if (!assignedBmcIds.includes(bmcId)) {
        return res.status(403).json({ error: 'Access denied for requested BMC.' });
      }
      allowedBmcIds = [bmcId];
    }

    // Fetch visits for allowed BMCs
    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('id, bmc_id, bmc_name, worker_id, visited_at')
      .in('bmc_id', allowedBmcIds);

    if (!visits || visits.length === 0) return res.json({ testResults: [] });

    const visitMap = {};
    visits.forEach(v => { visitMap[v.id] = v; });
    const visitIds = visits.map(v => v.id);

    // Fetch FTIR & Gerber tests
    const [ftirRes, gerberRes, profilesRes] = await Promise.all([
      adminClient.from('ftir_tests').select('*').in('visit_id', visitIds),
      adminClient.from('gerber_tests').select('*').in('visit_id', visitIds),
      adminClient.from('profiles').select('id, name')
    ]);

    const profileMap = {};
    (profilesRes.data || []).forEach(p => { profileMap[p.id] = p.name; });

    let tests = [];

    (ftirRes.data || []).forEach(t => {
      const v = visitMap[t.visit_id] || {};
      tests.push({
        id: `ftir_${t.id}`,
        raw_id: t.id,
        test_type: 'FTIR',
        bmc_id: v.bmc_id,
        bmc_name: v.bmc_name || 'BMC',
        test_time: t.created_at || t.test_time || v.visited_at,
        fat: t.fat != null ? Number(t.fat) : null,
        snf: t.snf != null ? Number(t.snf) : null,
        clr: t.clr != null ? Number(t.clr) : null,
        protein: t.protein != null ? Number(t.protein) : null,
        lactose: t.lactose != null ? Number(t.lactose) : null,
        added_water: t.added_water != null ? Number(t.added_water) : 0,
        milk_quantity: t.quantity != null ? Number(t.quantity) : null,
        temperature: t.temperature != null ? Number(t.temperature) : null,
        quality_grade: t.status || t.quality_grade || 'PASS',
        rate: t.rate != null ? Number(t.rate) : null,
        worker_name: profileMap[v.worker_id] || 'Worker',
        remarks: t.remarks || '',
        photo_url: t.photo_url || null
      });
    });

    (gerberRes.data || []).forEach(t => {
      const v = visitMap[t.visit_id] || {};
      tests.push({
        id: `gerber_${t.id}`,
        raw_id: t.id,
        test_type: 'Gerber',
        bmc_id: v.bmc_id,
        bmc_name: v.bmc_name || 'BMC',
        test_time: t.created_at || t.test_time || v.visited_at,
        fat: t.fat != null ? Number(t.fat) : null,
        snf: t.snf != null ? Number(t.snf) : null,
        clr: t.clr != null ? Number(t.clr) : null,
        milk_quantity: t.quantity != null ? Number(t.quantity) : null,
        temperature: t.temperature != null ? Number(t.temperature) : null,
        quality_grade: t.status || t.quality_grade || 'PASS',
        rate: t.rate != null ? Number(t.rate) : null,
        worker_name: profileMap[v.worker_id] || 'Worker',
        remarks: t.remarks || '',
        photo_url: t.photo_url || null
      });
    });

    // Date filtering
    const now = new Date();
    if (dateFilter === 'today') {
      const todayStr = now.toISOString().split('T')[0];
      tests = tests.filter(t => (t.test_time || '').startsWith(todayStr));
    } else if (dateFilter === 'yesterday') {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      tests = tests.filter(t => (t.test_time || '').startsWith(yStr));
    } else if (dateFilter === 'this_week') {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      tests = tests.filter(t => new Date(t.test_time) >= startOfWeek);
    } else if (dateFilter === 'this_month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      tests = tests.filter(t => new Date(t.test_time) >= startOfMonth);
    } else if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      tests = tests.filter(t => {
        const d = new Date(t.test_time);
        return d >= s && d <= e;
      });
    }

    // Quality filter
    if (quality && quality !== 'all') {
      tests = tests.filter(t => String(t.quality_grade).toLowerCase() === quality.toLowerCase());
    }

    // Sorting
    if (sortBy === 'oldest') {
      tests.sort((a, b) => new Date(a.test_time) - new Date(b.test_time));
    } else if (sortBy === 'highest_fat') {
      tests.sort((a, b) => (b.fat || 0) - (a.fat || 0));
    } else if (sortBy === 'lowest_fat') {
      tests.sort((a, b) => (a.fat || 0) - (b.fat || 0));
    } else if (sortBy === 'highest_snf') {
      tests.sort((a, b) => (b.snf || 0) - (a.snf || 0));
    } else if (sortBy === 'lowest_snf') {
      tests.sort((a, b) => (a.snf || 0) - (b.snf || 0));
    } else {
      // Default: latest
      tests.sort((a, b) => new Date(b.test_time) - new Date(a.test_time));
    }

    res.json({ testResults: tests });
  } catch (err) {
    console.error('EO Test Results Error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch test results.' });
  }
});

// GET /api/eo/test-results/:id — Read-only single test detail
app.get('/api/eo/test-results/:id', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  const testIdStr = req.params.id;

  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);
    const isFtir = testIdStr.startsWith('ftir_');
    const rawId = testIdStr.replace('ftir_', '').replace('gerber_', '');

    const table = isFtir ? 'ftir_tests' : 'gerber_tests';
    const { data: testRecord, error } = await adminClient.from(table).select('*').eq('id', rawId).single();

    if (error || !testRecord) return res.status(404).json({ error: 'Test result not found.' });

    // Verify BMC assignment
    const { data: visit } = await adminClient.from('trip_bmc_visits').select('*').eq('id', testRecord.visit_id).single();
    if (!visit || !assignedBmcIds.includes(visit.bmc_id)) {
      return res.status(403).json({ error: 'Access denied. Test result belongs to an unassigned BMC.' });
    }

    const { data: worker } = await adminClient.from('profiles').select('name').eq('id', visit.worker_id).single();

    res.json({
      testResult: {
        ...testRecord,
        test_type: isFtir ? 'FTIR' : 'Gerber',
        bmc_name: visit.bmc_name,
        worker_name: worker ? worker.name : 'Worker',
        visited_at: visit.visited_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch test result details.' });
  }
});

// GET /api/eo/reports — Worker reports & visits for assigned BMCs
app.get('/api/eo/reports', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);
    if (assignedBmcIds.length === 0) return res.json({ reports: [] });

    // Fetch visits for assigned BMCs
    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*')
      .in('bmc_id', assignedBmcIds)
      .order('visited_at', { ascending: false });

    const visitIds = (visits || []).map(v => v.id);

    let issues = [];
    if (visitIds.length > 0) {
      const { data: bmcIssues } = await adminClient.from('bmc_issues').select('*').in('visit_id', visitIds);
      issues = bmcIssues || [];
    }

    const { data: profiles } = await adminClient.from('profiles').select('id, name');
    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.id] = p.name; });

    const issueMap = {};
    issues.forEach(i => { issueMap[i.visit_id] = i; });

    const reports = (visits || []).map(v => {
      const issue = issueMap[v.id];
      return {
        id: v.id,
        bmc_id: v.bmc_id,
        bmc_name: v.bmc_name || 'BMC',
        worker_id: v.worker_id,
        worker_name: profileMap[v.worker_id] || 'Worker',
        visited_at: v.visited_at,
        report_type: issue ? (issue.issue_type || 'Worker Inspection') : 'BMC Visit Report',
        description: issue ? issue.description : (v.remarks || 'Standard BMC inspection completed.'),
        status: issue ? (issue.status || 'open') : 'completed',
        photos: v.photos || (issue && issue.photos) || [],
        audio_url: v.audio_url || null
      };
    });

    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch worker reports.' });
  }
});

// GET /api/eo/reports/:id — Read-only single report detail
app.get('/api/eo/reports/:id', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);
    const { data: visit, error } = await adminClient.from('trip_bmc_visits').select('*').eq('id', req.params.id).single();

    if (error || !visit) return res.status(404).json({ error: 'Report not found.' });

    if (!assignedBmcIds.includes(visit.bmc_id)) {
      return res.status(403).json({ error: 'Access denied. Report belongs to an unassigned BMC.' });
    }

    const { data: worker } = await adminClient.from('profiles').select('name').eq('id', visit.worker_id).single();
    const { data: issue } = await adminClient.from('bmc_issues').select('*').eq('visit_id', visit.id).single();

    res.json({
      report: {
        id: visit.id,
        bmc_id: visit.bmc_id,
        bmc_name: visit.bmc_name,
        worker_name: worker ? worker.name : 'Worker',
        visited_at: visit.visited_at,
        status: visit.status,
        remarks: visit.remarks,
        issue: issue || null,
        photos: visit.photos || []
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch report detail.' });
  }
});

// GET /api/eo/worker-assignments — Worker assignments & tasks for assigned BMCs
app.get('/api/eo/worker-assignments', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);
    if (assignedBmcIds.length === 0) return res.json({ assignments: [] });

    const { data: trips } = await adminClient
      .from('trips')
      .select('*')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*')
      .in('bmc_id', assignedBmcIds);

    const relevantTripIds = new Set((visits || []).map(v => v.trip_id));
    const relevantTrips = (trips || []).filter(t => relevantTripIds.has(t.id));

    const { data: profiles } = await adminClient.from('profiles').select('id, name');
    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.id] = p.name; });

    const assignments = relevantTrips.map(trip => {
      const tripVisits = (visits || []).filter(v => v.trip_id === trip.id);
      return {
        id: trip.id,
        trip_number: trip.trip_number,
        worker_name: profileMap[trip.worker_id] || trip.driver_name || 'Worker',
        bmcs_covered: tripVisits.map(v => v.bmc_name).join(', ') || 'Assigned BMC',
        date: trip.created_at,
        status: trip.status
      };
    });

    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch worker assignments.' });
  }
});

// GET /api/eo/summary — Aggregated chart data for assigned BMCs
app.get('/api/eo/summary', requireExecutiveOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const assignedBmcIds = await getEoAssignedBmcIds(adminClient, profile.id);
    if (assignedBmcIds.length === 0) {
      return res.json({
        dailyTests: [],
        fatTrend: [],
        snfTrend: [],
        qualityDistribution: { pass: 0, warning: 0, fail: 0 },
        workerActivity: []
      });
    }

    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*')
      .in('bmc_id', assignedBmcIds);

    if (!visits || visits.length === 0) {
      return res.json({
        dailyTests: [],
        fatTrend: [],
        snfTrend: [],
        qualityDistribution: { pass: 0, warning: 0, fail: 0 },
        workerActivity: []
      });
    }

    const visitIds = visits.map(v => v.id);
    const [ftirRes, gerberRes, profilesRes] = await Promise.all([
      adminClient.from('ftir_tests').select('*').in('visit_id', visitIds),
      adminClient.from('gerber_tests').select('*').in('visit_id', visitIds),
      adminClient.from('profiles').select('id, name')
    ]);

    const profileMap = {};
    (profilesRes.data || []).forEach(p => { profileMap[p.id] = p.name; });

    const allTests = [...(ftirRes.data || []), ...(gerberRes.data || [])];

    // Aggregation maps
    const dateCounts = {};
    const fatByDate = {};
    const snfByDate = {};
    const workerCounts = {};
    let passCount = 0, warnCount = 0, failCount = 0;

    allTests.forEach(t => {
      const dateStr = (t.created_at || t.test_time || new Date().toISOString()).split('T')[0];
      dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;

      if (t.fat != null) {
        if (!fatByDate[dateStr]) fatByDate[dateStr] = [];
        fatByDate[dateStr].push(Number(t.fat));
      }

      if (t.snf != null) {
        if (!snfByDate[dateStr]) snfByDate[dateStr] = [];
        snfByDate[dateStr].push(Number(t.snf));
      }

      const st = String(t.status || t.quality_grade || 'pass').toLowerCase();
      if (st.includes('fail')) failCount++;
      else if (st.includes('warn')) warnCount++;
      else passCount++;
    });

    visits.forEach(v => {
      const workerName = profileMap[v.worker_id] || 'Worker';
      workerCounts[workerName] = (workerCounts[workerName] || 0) + 1;
    });

    const sortedDates = Object.keys(dateCounts).sort();

    res.json({
      dailyTests: sortedDates.map(d => ({ date: d, count: dateCounts[d] })),
      fatTrend: sortedDates.map(d => ({
        date: d,
        avgFat: fatByDate[d] ? Number((fatByDate[d].reduce((a, b) => a + b, 0) / fatByDate[d].length).toFixed(2)) : 4.0
      })),
      snfTrend: sortedDates.map(d => ({
        date: d,
        avgSnf: snfByDate[d] ? Number((snfByDate[d].reduce((a, b) => a + b, 0) / snfByDate[d].length).toFixed(2)) : 8.5
      })),
      qualityDistribution: { pass: passCount, warning: warnCount, fail: failCount },
      workerActivity: Object.keys(workerCounts).map(w => ({ worker: w, count: workerCounts[w] }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch summary metrics.' });
  }
});


// ─── ADMIN EXECUTIVE OFFICER MANAGEMENT ENDPOINTS ─────────────────────────────

// GET /api/admin/executive-officers — Get list of EOs and their assigned BMCs
app.get('/api/admin/executive-officers', requireAdminRole, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: eoProfiles, error: pError } = await adminClient
      .from('profiles')
      .select('id, name, email, status, created_at')
      .eq('role', 'executive_officer');

    if (pError) throw pError;

    // Fetch active BMC assignments
    const { data: assignments, error: assignmentError } = await adminClient
      .from('eo_bmc_assignments')
      .select('eo_id, bmc_id, assigned_at')
      .eq('status', 'active');

    if (assignmentError) throw assignmentError;

    const bmcIds = Array.from(new Set((assignments || []).map(a => a.bmc_id)));
    let bmcMap = {};
    if (bmcIds.length > 0) {
      const { data: bmcs, error: bmcError } = await adminClient.from('bmcs').select('id, name, district, location').in('id', bmcIds);
      if (bmcError) throw bmcError;
      (bmcs || []).forEach(b => { bmcMap[b.id] = b; });
    }

    const eoList = (eoProfiles || []).map(eo => {
      const eoAssignments = (assignments || []).filter(a => a.eo_id === eo.id);
      const assignedBmcs = eoAssignments.map(a => bmcMap[a.bmc_id]).filter(Boolean);

      return {
        id: eo.id,
        name: eo.name,
        email: eo.email,
        phone: eo.phone || '—',
        status: eo.status,
        created_at: eo.created_at,
        assigned_bmc_count: assignedBmcs.length,
        assigned_bmcs: assignedBmcs
      };
    });

    res.json({ executive_officers: eoList });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch executive officers.' });
  }
});

// POST /api/admin/executive-officers/:id/bmcs — Assign a BMC to an EO
app.post('/api/admin/executive-officers/:id/bmcs', requireAdminRole, async (req, res) => {
  const { adminClient, profile: adminProfile } = req;
  const eoId = req.params.id;
  const { bmc_id, bmc_ids } = req.body;
  const targetBmcIds = bmc_ids !== undefined ? bmc_ids : (bmc_id ? [bmc_id] : []);

  try {
    // Verify target user is an EO
    const { data: eoUser } = await adminClient.from('profiles').select('id, role, name').eq('id', eoId).single();
    if (!eoUser || eoUser.role !== 'executive_officer') {
      return res.status(400).json({ error: 'Selected user is not an Executive Officer.' });
    }

    // Get current active assignments
    const { data: existing } = await adminClient
      .from('eo_bmc_assignments')
      .select('id, bmc_id')
      .eq('eo_id', eoId)
      .eq('status', 'active');

    const currentAssignedIds = (existing || []).map(a => a.bmc_id);
    
    // BMCs to deactivate
    const toDeactivate = currentAssignedIds.filter(id => !targetBmcIds.includes(id));
    if (toDeactivate.length > 0) {
      const { error: deactError } = await adminClient
        .from('eo_bmc_assignments')
        .update({ status: 'inactive', updated_at: new Date().toISOString() })
        .eq('eo_id', eoId)
        .eq('status', 'active')
        .in('bmc_id', toDeactivate);
      if (deactError) throw deactError;
    }

    // BMCs to activate/insert
    const toActivate = targetBmcIds.filter(id => !currentAssignedIds.includes(id));
    if (toActivate.length > 0) {
      for (const bId of toActivate) {
        const { data: inactiveRecord, error: findError } = await adminClient
          .from('eo_bmc_assignments')
          .select('id')
          .eq('eo_id', eoId)
          .eq('bmc_id', bId)
          .eq('status', 'inactive')
          .maybeSingle();

        if (findError) throw findError;

        if (inactiveRecord) {
          const { error: updateError } = await adminClient
            .from('eo_bmc_assignments')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('id', inactiveRecord.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await adminClient
            .from('eo_bmc_assignments')
            .insert({
              eo_id: eoId,
              bmc_id: bId,
              assigned_by: adminProfile.id,
              assigned_at: new Date().toISOString(),
              status: 'active'
            });
          if (insertError) throw insertError;
        }
      }
    }

    res.status(201).json({
      message: `BMC assignments updated successfully for ${eoUser.name}.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update BMC assignments.' });
  }
});

// DELETE /api/admin/executive-officers/:id/bmcs/:bmcId — Unassign a BMC from an EO
app.delete('/api/admin/executive-officers/:id/bmcs/:bmcId', requireAdminRole, async (req, res) => {
  const { adminClient } = req;
  const { id: eoId, bmcId } = req.params;

  try {
    const { error } = await adminClient
      .from('eo_bmc_assignments')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('eo_id', eoId)
      .eq('bmc_id', bmcId)
      .eq('status', 'active');

    if (error) throw error;

    res.json({ message: 'BMC assignment removed successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to remove BMC assignment.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ──  P&I AGM WORKFLOW ROUTES (Transport Manager → P&I AGM → Field Worker)  ──
// ─────────────────────────────────────────────────────────────────────────────

// ─── POST /api/transport/create-trip ─────────────────────────────────────────
// Transport Manager creates a trip that will be assigned to a Field Worker by P&I AGM
app.post('/api/transport/create-trip', requireTransportOfficer, async (req, res) => {
  const { adminClient, profile } = req;
  const {
    id, trip_name, driver_name, tanker_number,
    route_description, bmc_id, out_time
  } = req.body;

  if (!trip_name || !driver_name || !tanker_number) {
    return res.status(400).json({ error: 'trip_name, driver_name, and tanker_number are required.' });
  }

  try {
    // Generate a unique trip number
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const { count } = await adminClient
      .from('trips').select('id', { count: 'exact', head: true })
      .eq('created_by_to', true);
    const tripNum = `TO-${dateStr}-${String((count || 0) + 1).padStart(4, '0')}`;

    const insertPayload = {
      ...(id ? { id } : {}),
      trip_name: trip_name.trim(),
      trip_number: tripNum,
      worker_id: null,                          // Set to null until P&I AGM assigns
      created_by_to: true,
      transport_officer_id: profile.id,
      assignment_status: 'pending_assignment',
      driver_name: (driver_name || '').trim(),
      tanker_number: (tanker_number || '').trim(),
      route_description: (route_description || '').trim() || null,
      bmc_id: bmc_id || null,
      out_time: out_time || new Date().toISOString(),
      status: 'planned'
    };

    const { data, error } = await adminClient.from('trips').insert(insertPayload).select().single();

    if (error) throw error;

    console.log(`[TO Trip Created] ${tripNum} by ${profile.name} (id=${profile.id})`);
    res.status(201).json({ trip: data, message: 'Trip created. P&I AGM will assign a Field Worker.' });
  } catch (err) {
    console.error('❌ Transport Officer create-trip error:', err);
    res.status(500).json({ error: err.message || 'Failed to create trip.' });
  }
});

// ─── GET /api/gm/pending-trips ────────────────────────────────────────────────
// P&I AGM sees all Transport Manager-created trips with assignment status (excluding deleted duties)
app.get('/api/gm/pending-trips', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const [tripsRes, driverTripsRes] = await Promise.all([
      adminClient
        .from('trips')
        .select('*')
        .eq('created_by_to', true)
        .neq('status', 'deleted')
        .neq('assignment_status', 'deleted')
        .order('created_at', { ascending: false }),
      adminClient
        .from('driver_trips')
        .select('*')
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
    ]);

    const trips = (tripsRes.data || []).filter(t => t.status !== 'deleted' && t.assignment_status !== 'deleted');
    const driverTrips = (driverTripsRes.data || []).filter(dt => dt.status !== 'deleted' && (dt.assignment_status ? dt.assignment_status !== 'deleted' : true));

    const pendingMap = {};
    trips.forEach(t => {
      pendingMap[t.id] = t;
    });

    driverTrips.forEach(dt => {
      if (!pendingMap[dt.id]) {
        pendingMap[dt.id] = {
          id: dt.id,
          trip_number: dt.trip_number || dt.id.slice(0, 8).toUpperCase(),
          trip_name: dt.route || dt.destination || dt.bmc_name || `Duty #${dt.trip_number || dt.id.slice(0, 8)}`,
          driver_name: dt.driver_name || '—',
          tanker_number: dt.vehicle_number || dt.tanker_number || '—',
          route_description: dt.route || dt.destination || dt.bmc_name || '—',
          out_time: dt.scheduled_start_time || dt.created_at,
          status: dt.status || 'pending',
          assignment_status: dt.assigned_worker_id ? 'worker_assigned' : 'pending_assignment',
          created_at: dt.created_at,
          assigned_at: dt.updated_at || dt.created_at,
          transport_officer_id: dt.assigned_by || null,
          worker_id: dt.assigned_worker_id || null,
          bmc_id: dt.bmc_id || null
        };
      }
    });

    const tripList = Object.values(pendingMap);

    // Collect unique profile IDs to resolve names
    const profileIds = new Set();
    tripList.forEach(t => {
      if (t.transport_officer_id) profileIds.add(t.transport_officer_id);
      if (t.worker_id) profileIds.add(t.worker_id);
      if (t.assigned_by_gm_id) profileIds.add(t.assigned_by_gm_id);
    });

    let profileMap = {};
    if (profileIds.size > 0) {
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('id, name, email')
        .in('id', Array.from(profileIds));
      (profiles || []).forEach(p => profileMap[p.id] = p);
    }

    // Resolve BMC names
    const bmcIds = tripList.filter(t => t.bmc_id).map(t => t.bmc_id);
    let bmcMap = {};
    if (bmcIds.length > 0) {
      const { data: bmcs } = await adminClient
        .from('bmcs').select('id, name, district, location').in('id', bmcIds);
      (bmcs || []).forEach(b => bmcMap[b.id] = b);
    }

    const enriched = tripList.map(t => {
      const to = profileMap[t.transport_officer_id] || {};
      const worker = t.worker_id ? (profileMap[t.worker_id] || {}) : null;
      const gm = t.assigned_by_gm_id ? (profileMap[t.assigned_by_gm_id] || {}) : null;
      const bmc = t.bmc_id ? (bmcMap[t.bmc_id] || null) : null;
      return {
        id: t.id,
        trip_number: t.trip_number || t.id.slice(0, 8).toUpperCase(),
        trip_name: t.trip_name,
        driver_name: t.driver_name,
        tanker_number: t.tanker_number,
        route_description: t.route_description || '—',
        out_time: t.out_time,
        status: t.status,
        assignment_status: t.assignment_status || 'pending_assignment',
        created_at: t.created_at,
        assigned_at: t.assigned_at,
        transport_officer_name: to.name || 'Unknown TO',
        transport_officer_id: t.transport_officer_id,
        assigned_worker_id: t.worker_id,
        assigned_worker_name: worker ? worker.name : null,
        assigned_by_gm_name: gm ? gm.name : null,
        bmc: bmc
      };
    });

    res.json({ trips: enriched });
  } catch (err) {
    console.error('❌ GM Pending Trips error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch pending trips.' });
  }
});

// ─── POST /api/gm/trips/:id/assign-worker ────────────────────────────────────
// P&I AGM assigns a Field Worker to a Transport Manager trip
app.post('/api/gm/trips/:id/assign-worker', requirePiAgm, async (req, res) => {
  const { adminClient, profile } = req;
  const tripId = req.params.id;
  const { worker_id } = req.body;

  if (!worker_id) {
    return res.status(400).json({ error: 'worker_id is required.' });
  }

  try {
    // 1. Fetch the trip — must be a TO-created trip
    const { data: trip, error: tripErr } = await adminClient
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .eq('created_by_to', true)
      .maybeSingle();

    if (tripErr || !trip) {
      return res.status(404).json({ error: 'Trip not found or is not a Transport Manager trip.' });
    }

    // 2. Verify the target worker exists and has the correct role
    const { data: worker, error: workerErr } = await adminClient
      .from('profiles')
      .select('id, name, role, status')
      .eq('id', worker_id)
      .single();

    if (workerErr || !worker) {
      return res.status(404).json({ error: 'Field Worker not found.' });
    }
    if (worker.role !== 'user') {
      return res.status(400).json({ error: 'Only Field Workers (role=user) can be assigned to trips.' });
    }
    if (worker.status !== 'approved') {
      return res.status(400).json({ error: 'This worker account is not approved.' });
    }

    // 3. Check if already assigned to the same worker — prevent duplicate update
    if (trip.worker_id === worker_id) {
      return res.json({
        success: true,
        message: 'This worker is already assigned to this trip.',
        already_assigned: true,
        trip: {
          id: trip.id,
          assignment_status: trip.assignment_status,
          worker_id: trip.worker_id,
          worker_name: worker.name
        }
      });
    }

    // 4. Perform the assignment — write worker_id (the single source of truth)
    const { data: updated, error: updateErr } = await adminClient
      .from('trips')
      .update({
        worker_id: worker_id,
        assignment_status: 'worker_assigned',
        assigned_at: new Date().toISOString(),
        assigned_by_gm_id: profile.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', tripId)
      .select()
      .single();

    if (updateErr || !updated) {
      throw updateErr || new Error('Assignment update failed.');
    }

    console.log(`[Worker Assignment] Trip ${tripId} assigned to worker ${worker.name} (${worker_id}) by GM ${profile.name}`);

    res.json({
      success: true,
      message: `Field Worker "${worker.name}" successfully assigned to trip.`,
      trip: {
        id: updated.id,
        trip_name: updated.trip_name,
        assignment_status: updated.assignment_status,
        worker_id: updated.worker_id,
        worker_name: worker.name,
        assigned_at: updated.assigned_at
      }
    });
  } catch (err) {
    console.error('❌ Worker Assignment error:', err);
    res.status(500).json({ error: err.message || 'Failed to assign worker.' });
  }
});

// ─── GET /api/worker/assigned-trips ──────────────────────────────────────────
// Field Worker sees ALL duties planned by Transport Manager
app.get('/api/worker/assigned-trips', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const workerProfileId = profile?.id;
  const { date, startDate, endDate, status } = req.query; // single date or date range YYYY-MM-DD
  try {
    // 1. Fetch all planned/assigned/completed trips EXCLUSIVELY from driver_trips (Single Source of Truth)
    let query = adminClient
      .from('driver_trips')
      .select('*')
      .neq('status', 'deleted')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: driverTripsData, error } = await query;
    if (error) throw error;

    let tripsMap = new Map();

    (driverTripsData || []).forEach(dt => {
      // Planned out time is for reference only; trip is strictly in_progress ONLY if started_at exists
      const hasActuallyStarted = Boolean(dt.started_at);
      const isActiveTrip = (dt.status === 'in_progress' || dt.status === 'active') && hasActuallyStarted;
      const isCompletedTrip = dt.status === 'completed';
      const effectiveStatus = isCompletedTrip ? 'completed' : (isActiveTrip ? 'in_progress' : 'planned');

      // Worker Isolation Rule:
      // - Available duties (planned/pending) are shown to all workers until started.
      // - Once a trip is started (in_progress) or completed, it is tied exclusively to the worker who started/completed it.
      if (isActiveTrip || isCompletedTrip) {
        const ownerId = dt.assigned_driver_id || dt.driver_id;
        if (ownerId && workerProfileId && ownerId !== workerProfileId) {
          return; // Skip started or completed trips belonging to another worker
        }
      }

      // Server-side Date Filtering (preserve active in-progress trips across dates)
      const tripDateStr = dt.scheduled_start_time || dt.started_at || dt.created_at;
      if (!isActiveTrip && tripDateStr && (date || (startDate && endDate))) {
        const tripDate = new Date(tripDateStr);
        const tzOffset = tripDate.getTimezoneOffset() * 60000;
        const tripLocalISO = (new Date(tripDate - tzOffset)).toISOString().slice(0, 10);
        
        if (startDate && endDate) {
          if (tripLocalISO < startDate || tripLocalISO > endDate) return;
        } else if (date) {
          if (tripLocalISO !== date) return;
        }
      }

      tripsMap.set(dt.id, {
        id: dt.id,
        trip_number: dt.trip_number || dt.id.slice(0, 8).toUpperCase(),
        trip_name: dt.route || dt.destination || dt.bmc_name || 'Planned Duty',
        assigned_driver_id: dt.assigned_driver_id,
        tanker_number: dt.vehicle_number || '—',
        route_description: dt.route || dt.destination || dt.bmc_name || '—',
        status: effectiveStatus,
        assignment_status: 'worker_assigned',
        out_time: dt.started_at || dt.scheduled_start_time || dt.created_at,
        scheduled_out_time: dt.scheduled_start_time || dt.created_at,
        in_time: dt.completed_at || dt.in_time,
        started_at: dt.started_at || null,
        completed_at: dt.completed_at || null,
        assigned_at: dt.created_at,
        created_at: dt.created_at,
        selected_bmcs: dt.selected_bmcs || [],
        remarks: dt.remarks,
        out_km: dt.out_km !== null && dt.out_km !== undefined ? dt.out_km : null,
        out_weight: dt.out_weight !== null && dt.out_weight !== undefined ? dt.out_weight : (dt.out_tanker_weight !== null && dt.out_tanker_weight !== undefined ? dt.out_tanker_weight : null),
        out_tanker_weight: dt.out_weight !== null && dt.out_weight !== undefined ? dt.out_weight : (dt.out_tanker_weight !== null && dt.out_tanker_weight !== undefined ? dt.out_tanker_weight : null),
        in_km: dt.in_km !== null && dt.in_km !== undefined ? dt.in_km : null,
        in_weight: dt.in_weight !== null && dt.in_weight !== undefined ? dt.in_weight : null,
        km_travelled: dt.km_travelled !== null && dt.km_travelled !== undefined ? dt.km_travelled : null,
        weight_difference: dt.weight_difference !== null && dt.weight_difference !== undefined ? dt.weight_difference : null,
        diesel_consumption: dt.diesel_consumption !== null && dt.diesel_consumption !== undefined ? dt.diesel_consumption : null,
        average_mileage: dt.average_mileage !== null && dt.average_mileage !== undefined ? dt.average_mileage : null,
        transport_officer_name: 'Transport Manager'
      });
    });

    const tripList = Array.from(tripsMap.values());

    // Resolve driver profile names
    const driverIds = [...new Set(tripList.map(dt => dt.assigned_driver_id).filter(Boolean))];
    let driverProfileMap = {};
    if (driverIds.length > 0) {
      const { data: dProfiles } = await adminClient.from('profiles').select('id, name').in('id', driverIds);
      (dProfiles || []).forEach(p => driverProfileMap[p.id] = p.name);
    }
    
    tripList.forEach(t => {
      t.driver_name = driverProfileMap[t.assigned_driver_id] || 'Assigned Driver';
      delete t.assigned_driver_id;
    });

    // Collect TO profile IDs
    const toIds = [...new Set(tripList.filter(t => t.transport_officer_id).map(t => t.transport_officer_id))];
    let toMap = {};
    if (toIds.length > 0) {
      const { data: tos } = await adminClient
        .from('profiles').select('id, name').in('id', toIds);
      (tos || []).forEach(p => toMap[p.id] = p.name);
    }

    // Collect BMC IDs
    const bmcIds = [...new Set(tripList.filter(t => t.bmc_id).map(t => t.bmc_id))];
    let bmcMap = {};
    if (bmcIds.length > 0) {
      const { data: bmcs } = await adminClient
        .from('bmcs').select('id, name, district, location, contact_number').in('id', bmcIds);
      (bmcs || []).forEach(b => bmcMap[b.id] = b);
    }

    // Enrich with BMC visit counts for progress display
    const tripIds = tripList.map(t => t.id);
    let visitCounts = {};
    if (tripIds.length > 0) {
      const { data: visits } = await adminClient
        .from('trip_bmc_visits')
        .select('trip_id, status')
        .in('trip_id', tripIds);
      (visits || []).forEach(v => {
        if (!visitCounts[v.trip_id]) visitCounts[v.trip_id] = { total: 0, completed: 0 };
        visitCounts[v.trip_id].total++;
        if (v.status === 'completed' || v.status === 'visited') visitCounts[v.trip_id].completed++;
      });
    }

    const enriched = tripList.map(t => ({
      id: t.id,
      trip_number: t.trip_number || t.id.slice(0, 8).toUpperCase(),
      trip_name: t.trip_name || t.route_description || 'Planned Duty',
      driver_name: t.driver_name || '—',
      tanker_number: t.tanker_number || t.vehicle_number || '—',
      route_description: t.route_description || t.route || '—',
      status: t.status,
      assignment_status: t.assignment_status || 'worker_assigned',
      out_time: t.out_time || t.scheduled_out_time || t.scheduled_start_time,
      scheduled_out_time: t.scheduled_out_time || t.scheduled_start_time || t.out_time,
      in_time: t.in_time,
      started_at: t.started_at,
      completed_at: t.completed_at,
      assigned_at: t.assigned_at || t.created_at,
      created_at: t.created_at,
      selected_bmcs: t.selected_bmcs || [],
      remarks: t.remarks,
      out_km: t.out_km,
      out_weight: t.out_weight,
      out_tanker_weight: t.out_tanker_weight,
      in_km: t.in_km,
      in_weight: t.in_weight,
      km_travelled: t.km_travelled,
      weight_difference: t.weight_difference,
      diesel_consumption: t.diesel_consumption,
      average_mileage: t.average_mileage,
      transport_officer_name: toMap[t.transport_officer_id] || t.transport_officer_name || 'Transport Manager',
      bmc: t.bmc_id ? (bmcMap[t.bmc_id] || null) : null,
      visits_total: (visitCounts[t.id] || {}).total || 0,
      visits_completed: (visitCounts[t.id] || {}).completed || 0
    }));

    res.json({ trips: enriched });
  } catch (err) {
    console.error('❌ Worker Assigned Trips error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch assigned trips.' });
  }
});

// ─── GET /api/gm/available-workers ───────────────────────────────────────────
// P&I AGM fetches list of available approved Field Workers for assignment modal
app.get('/api/gm/available-workers', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: workers, error } = await adminClient
      .from('profiles')
      .select('id, name, email, status, profile_image_url')
      .eq('role', 'user')
      .eq('status', 'approved')
      .order('name');

    if (error) throw error;

    // For each worker, get their current active trip count
    const workerIds = (workers || []).map(w => w.id);
    let activeTripCounts = {};
    if (workerIds.length > 0) {
      const { data: activeTrips } = await adminClient
        .from('trips')
        .select('worker_id')
        .in('worker_id', workerIds)
        .eq('status', 'active');
      (activeTrips || []).forEach(t => {
        activeTripCounts[t.worker_id] = (activeTripCounts[t.worker_id] || 0) + 1;
      });
    }

    const enriched = (workers || []).map(w => ({
      id: w.id,
      name: w.name,
      email: w.email,
      profile_image_url: w.profile_image_url,
      active_trips: activeTripCounts[w.id] || 0,
      availability: (activeTripCounts[w.id] || 0) === 0 ? 'Available' : 'On Active Trip'
    }));

    res.json({ workers: enriched });
  } catch (err) {
    console.error('❌ Available Workers error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch workers.' });
  }
});

// ─── QC WORKER & QC AGM API ROUTES ───────────────────────────────────────────

// GET /api/qc-worker/profile
app.get('/api/qc-worker/profile', requireQcWorker, (req, res) => {
  res.json({ profile: req.profile });
});

// GET /api/qc-worker/dashboard-stats
app.get('/api/qc-worker/dashboard-stats', requireQcWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { date } = req.query;
  try {
    let startIso, endIso;
    if (date) {
      const d = new Date(date + 'T00:00:00.000Z');
      startIso = d.toISOString();
      const endD = new Date(date + 'T23:59:59.999Z');
      endIso = endD.toISOString();
    }

    let visitsQuery = adminClient.from('trip_bmc_visits').select('id').eq('status', 'completed');
    if (startIso && endIso) {
      visitsQuery = visitsQuery.gte('visit_end_time', startIso).lte('visit_end_time', endIso);
    }
    const { data: visits } = await visitsQuery;
    const totalVisits = visits ? visits.length : 0;
    const visitIds = visits ? visits.map(v => v.id) : [];

    let testsQuery = adminClient.from('qc_lab_tests').select('id, status, created_at, visit_id').eq('qc_worker_id', profile.id);
    if (visitIds.length > 0) {
      testsQuery = testsQuery.in('visit_id', visitIds);
    } else if (startIso && endIso) {
      testsQuery = testsQuery.gte('created_at', startIso).lte('created_at', endIso);
    }
    const { data: tests } = await testsQuery;

    const testedVisits = new Set((tests || []).map(t => t.visit_id));
    const pendingSamplesCount = (visits || []).filter(v => !testedVisits.has(v.id)).length;
    const submittedCount = (tests || []).filter(t => t.status === 'submitted' || t.status === 'approved').length;
    
    // The user requested only Pending, Tested Report, and Total Samples.
    res.json({
      samples_pending: pendingSamplesCount,
      reports_submitted: submittedCount,
      total_samples: totalVisits || 0
    });
  } catch (err) {
    console.error('❌ QC Worker Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-worker/dashboard-bmcs
app.get('/api/qc-worker/dashboard-bmcs', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  try {
    // 1. Fetch master BMCs
    const { data: masterBmcs } = await adminClient
      .from('bmcs')
      .select('*, bmc_routes(*)');

    // 2. Fetch all visits
    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*, bmc:bmcs(*), ftir_tests(*), gerber_tests(*), bmc_issues(*), bmc_ratings(*), qc_test:qc_lab_tests(*), trip:trips(*)');

    // 3. Fetch MACS excel rows
    const { data: macsRows } = await adminClient
      .from('qc_excel_import_rows')
      .select('*');

    const visitsByCode = {};
    const visitsByBmcId = {};
    (visits || []).forEach(v => {
      const code = String(v.bmc?.bmc_code || v.bmc_code || '').trim();
      const bId = v.bmc_id || v.bmc?.id;
      if (code) visitsByCode[code] = v;
      if (bId) visitsByBmcId[bId] = v;
    });

    const macsByCode = {};
    (macsRows || []).forEach(m => {
      const code = String(m.sample_ref || m.raw_data?.bmc_code || '').trim();
      if (code) macsByCode[code] = m;
    });

    const bmcList = (masterBmcs || []).map(b => {
      const bCode = String(b.bmc_code || b.code || '').trim();
      const routeName = b.bmc_routes?.name || b.route_name || 'Unassigned Route';

      const visit = visitsByCode[bCode] || visitsByBmcId[b.id] || null;
      const macsRow = macsByCode[bCode] || (macsRows || []).find(m => String(m.bmc_name || m.bmc?.name || '').trim().toLowerCase() === String(b.name || '').toLowerCase());

      let macsData = null;
      if (macsRow) {
        let macsLit = macsRow.raw_data?.macs_quantity_liters ?? macsRow.raw_data?.liters ?? macsRow.liters ?? macsRow.quantity ?? null;
        let macsKg = macsRow.raw_data?.macs_quantity_kg ?? macsRow.raw_data?.kg ?? (macsLit ? parseFloat((macsLit * 1.03).toFixed(2)) : null);
        macsData = {
          liters: macsLit,
          kg: macsKg,
          fat: macsRow.fat ?? null,
          snf: macsRow.snf ?? null
        };
      }

      let spotData = null;
      let visitId = visit ? visit.id : `bmc_${b.id}`;
      if (visit) {
        const unpack = (rel) => !rel ? {} : (Array.isArray(rel) ? rel[rel.length - 1] || {} : rel);
        const ftir = unpack(visit.ftir_tests);
        const gerber = unpack(visit.gerber_tests);

        const spotLit = visit.sample_liters || visit.milk_quantity_liters || null;
        const spotKg = visit.milk_quantity_kg || visit.in_weight || (spotLit ? parseFloat((spotLit * 1.03).toFixed(2)) : null);
        const spotFat = ftir.fat ?? gerber.fat_percentage ?? null;
        const spotSnf = ftir.snf ?? gerber.snf ?? null;

        if (spotLit !== null || spotFat !== null || visit.status === 'completed' || visit.status === 'visited') {
          spotData = {
            liters: spotLit,
            kg: spotKg,
            fat: spotFat,
            snf: spotSnf
          };
        }
      }

      const unpack = (rel) => !rel ? {} : (Array.isArray(rel) ? rel[rel.length - 1] || {} : rel);
      const qcTest = visit ? unpack(visit.qc_test) : null;
      const isTested = Boolean(qcTest && (qcTest.fat !== null || qcTest.snf !== null || qcTest.status === 'submitted' || qcTest.status === 'approved' || qcTest.status === 'completed'));
      const diaryData = isTested ? {
        fat: qcTest.fat,
        snf: qcTest.snf,
        status: qcTest.status || 'submitted',
        overall_result: qcTest.overall_result || 'pass'
      } : null;

      return {
        bmc_id: b.id,
        bmc_code: bCode || 'BMC',
        bmc_name: b.name || 'BMC Center',
        route_name: routeName,
        visit_id: visitId,
        macs: macsData,
        field_worker: spotData,
        diary: diaryData,
        is_tested: isTested
      };
    });

    res.json({ bmcs: bmcList });
  } catch (err) {
    console.error('Error fetching QC worker dashboard BMCs:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard BMCs.' });
  }
});

// GET /api/qc-worker/dashboard-trips
app.get('/api/qc-worker/dashboard-trips', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  const { startDate, endDate } = req.query;

  try {
    let startIso, endIso;
    if (startDate) {
      startIso = new Date(startDate + 'T00:00:00.000Z').toISOString();
    } else {
      const d = new Date();
      startIso = new Date(d.setHours(0, 0, 0, 0)).toISOString();
    }

    if (endDate) {
      endIso = new Date(endDate + 'T23:59:59.999Z').toISOString();
    } else {
      endIso = new Date().toISOString();
    }

    // 1. Fetch from trips table
    const { data: trips } = await adminClient
      .from('trips')
      .select('*')
      .neq('status', 'deleted')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    // 2. Fetch from driver_trips table (profile-based)
    const { data: dTrips } = await adminClient
      .from('driver_trips')
      .select('*')
      .neq('status', 'deleted')
      .neq('status', 'cancelled')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    // Merge trips into a unified list
    const tripsMap = new Map();
    (trips || []).forEach(t => tripsMap.set(t.id, t));
    (dTrips || []).forEach(dt => {
      if (!tripsMap.has(dt.id)) {
        tripsMap.set(dt.id, {
          id: dt.id,
          trip_number: dt.trip_number || dt.id.slice(0, 8).toUpperCase(),
          trip_name: dt.route || dt.destination || dt.bmc_name || 'Assigned Duty',
          driver_name: dt.driver_name || 'Assigned Driver',
          tanker_number: dt.vehicle_number || '—',
          route_description: dt.route || dt.destination || '—',
          status: dt.status,
          created_at: dt.created_at
        });
      }
    });

    const tripList = Array.from(tripsMap.values());
    const tripIds = tripList.map(t => t.id);

    let visitList = [];
    if (tripIds.length > 0) {
      const { data: visits } = await adminClient
        .from('trip_bmc_visits')
        .select('*, bmc:bmcs(*), ftir_tests(*), gerber_tests(*), bmc_issues(*), bmc_ratings(*), qc_test:qc_lab_tests(*)')
        .in('trip_id', tripIds)
        .order('created_at', { ascending: true });
      visitList = visits || [];
    }

    // Fetch MACS excel import rows for the date range
    const { data: macsRows } = await adminClient
      .from('qc_excel_import_rows')
      .select('*')
      .gte('created_at', startIso)
      .lte('created_at', endIso);

    // Enrich visits with MACS and Spot Analyzer data
    (visitList || []).forEach(v => {
      const bmcCode = String(v.bmc?.bmc_code || v.bmc_code || '').trim();
      const bmcName = String(v.bmc?.name || v.bmc_name || '').trim().toLowerCase();

      // MACS lookup
      const macsRow = (macsRows || []).find(m => {
        const mRef = String(m.sample_ref || m.raw_data?.bmc_code || '').trim();
        const mName = String(m.bmc_name || m.bmc?.name || '').trim().toLowerCase();
        return (bmcCode && mRef && mRef === bmcCode) || (bmcName && mName && mName === bmcName);
      });

      let macsLit = macsRow ? (macsRow.raw_data?.macs_quantity_liters ?? macsRow.raw_data?.liters ?? macsRow.liters ?? macsRow.quantity ?? null) : null;
      let macsKg = macsRow ? (macsRow.raw_data?.macs_quantity_kg ?? macsRow.raw_data?.kg ?? (macsLit ? parseFloat((macsLit * 1.03).toFixed(2)) : null)) : null;
      let macsFat = macsRow ? macsRow.fat : null;
      let macsSnf = macsRow ? macsRow.snf : null;

      // Spot Analyzer (FTIR / Gerber)
      const unpack = (rel) => !rel ? {} : (Array.isArray(rel) ? rel[rel.length - 1] || {} : rel);
      const ftir = unpack(v.ftir_tests);
      const gerber = unpack(v.gerber_tests);

      const spotLit = v.sample_liters || v.milk_quantity_liters || null;
      const spotKg = v.milk_quantity_kg || v.in_weight || (spotLit ? parseFloat((spotLit * 1.03).toFixed(2)) : null);
      const spotFat = ftir.fat ?? gerber.fat_percentage ?? null;
      const spotSnf = ftir.snf ?? gerber.snf ?? null;

      v.macs = {
        liters: macsLit,
        kg: macsKg,
        fat: macsFat,
        snf: macsSnf
      };

      v.spot = {
        liters: spotLit,
        kg: spotKg,
        fat: spotFat,
        snf: spotSnf
      };
      v.spot_analyzer = v.spot;

      v.diary = {
        liters: v.diary_quantity_liters || null,
        kg: v.diary_quantity_kg || null,
        fat: v.diary_fat || null,
        snf: v.diary_snf || null
      };
    });

    res.json({
      trips: tripList,
      visits: visitList
    });
  } catch (err) {
    console.error('Error fetching QC worker dashboard trips:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard trips.' });
  }
});

// GET /api/qc-worker/samples
app.get('/api/qc-worker/samples', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  const { date } = req.query;
  try {
    let query = adminClient
      .from('trip_bmc_visits')
      .select(`
        *,
        bmc:bmcs(*),
        trip:trips(*, worker:profiles!trips_worker_id_fkey(*)),
        ftir_tests(*),
        gerber_tests(*),
        qc_test:qc_lab_tests(*)
      `)
      .in('status', ['completed', 'visited']);

    if (date) {
      const d = new Date(date + 'T00:00:00.000Z');
      const endD = new Date(date + 'T23:59:59.999Z');
      query = query.gte('visit_end_time', d.toISOString()).lte('visit_end_time', endD.toISOString());
    }

    const { data: rawVisits, error } = await query.order('visit_end_time', { ascending: false });

    if (error) throw error;
    res.json({ samples: rawVisits || [] });
  } catch (err) {
    console.error('❌ QC Worker Samples error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-worker/samples/:id
app.get('/api/qc-worker/samples/:id', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  try {
    const rawId = req.params.id;
    if (rawId && rawId.startsWith('bmc_')) {
      const bmcId = rawId.replace('bmc_', '');
      const { data: existingVisits } = await adminClient
        .from('trip_bmc_visits')
        .select('*, bmc:bmcs(*), trip:trips(*, worker:profiles!trips_worker_id_fkey(*)), ftir_tests(*), gerber_tests(*), qc_test:qc_lab_tests(*)')
        .eq('bmc_id', bmcId)
        .order('created_at', { ascending: false });

      if (existingVisits && existingVisits.length > 0) {
        return res.json({ sample: existingVisits[0] });
      }

      const { data: bmc } = await adminClient.from('bmcs').select('*').eq('id', bmcId).single();
      if (!bmc) return res.status(404).json({ error: 'BMC not found.' });

      const { data: newVisit, error: vErr } = await adminClient
        .from('trip_bmc_visits')
        .insert([{
          bmc_id: bmc.id,
          status: 'visited',
          created_at: new Date().toISOString()
        }])
        .select('*, bmc:bmcs(*), ftir_tests(*), gerber_tests(*), qc_test:qc_lab_tests(*)')
        .single();

      if (vErr || !newVisit) throw vErr || new Error('Failed to create sample visit.');
      return res.json({ sample: newVisit });
    }

    const { data: visit, error } = await adminClient
      .from('trip_bmc_visits')
      .select(`
        *,
        bmc:bmcs(*),
        trip:trips(*, worker:profiles!trips_worker_id_fkey(*)),
        ftir_tests(*),
        gerber_tests(*),
        qc_test:qc_lab_tests(*)
      `)
      .eq('id', rawId)
      .single();

    if (error || !visit) return res.status(404).json({ error: 'Sample visit record not found.' });
    res.json({ sample: visit });
  } catch (err) {
    console.error('❌ QC Worker Sample detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-worker/macs/dates
app.get('/api/qc-worker/macs/dates', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: rows, error } = await adminClient
      .from('qc_excel_import_rows')
      .select('test_date')
      .order('test_date', { ascending: false });

    if (error) throw error;
    const dates = Array.from(new Set((rows || []).map(r => r.test_date).filter(Boolean)));
    res.json({ dates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-worker/bmcs
app.get('/api/qc-worker/bmcs', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: bmcs, error } = await adminClient
      .from('bmcs')
      .select('*, bmc_routes(*)')
      .order('name');
    if (error) throw error;
    res.json({ bmcs: bmcs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-worker/dashboard
app.get('/api/qc-worker/dashboard', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  const date = req.query.date;
  const period = (req.query.period || 'both').toLowerCase();
  try {
    const { count: totalBmcs } = await adminClient
      .from('bmcs')
      .select('id', { count: 'exact', head: true });

    let visitsQuery = adminClient
      .from('trip_bmc_visits')
      .select('milk_quantity_liters, milk_quantity_kg, in_weight, visit_end_time, remarks, created_at')
      .eq('status', 'completed');

    if (date) {
      const fromIso = new Date(date + 'T00:00:00.000Z').toISOString();
      const toIso = new Date(date + 'T23:59:59.999Z').toISOString();
      visitsQuery = visitsQuery.gte('visit_end_time', fromIso).lte('visit_end_time', toIso);
    }

    const { data: spotVisits } = await visitsQuery;
    let spotVisitsFiltered = spotVisits || [];

    if (period !== 'both') {
      spotVisitsFiltered = spotVisitsFiltered.filter(v => {
        const r = (v.remarks || '').toLowerCase();
        if (period === 'morning') return r.includes('morning') || !r.includes('evening');
        if (period === 'evening') return r.includes('evening');
        return true;
      });
    }

    let totalQuantityKg = 0;
    spotVisitsFiltered.forEach(v => {
      const lit = parseFloat(v.milk_quantity_liters || 0);
      const kg = parseFloat(v.milk_quantity_kg || v.in_weight || 0);
      if (kg > 0) {
        totalQuantityKg += kg;
      } else if (lit > 0) {
        totalQuantityKg += (lit * 1.03);
      }
    });

    res.json({
      total_bmcs: totalBmcs || 0,
      total_quantity_kg: parseFloat(totalQuantityKg.toFixed(2))
    });
  } catch (err) {
    console.error('❌ QC Worker Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-worker/macs/readings
app.get('/api/qc-worker/macs/readings', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  const date = req.query.date;

  try {
    let query = adminClient
      .from('qc_excel_import_rows')
      .select('*, bmc:bmcs(*), batch:qc_excel_imports(*)');

    if (date) {
      query = query.eq('test_date', date);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    let visitsQuery = adminClient
      .from('trip_bmc_visits')
      .select('*, bmc:bmcs(*, bmc_routes(*)), ftir_tests(*), gerber_tests(*), bmc_issues(*), bmc_ratings(*), qc_test:qc_lab_tests(*)');

    if (date) {
      const fromIso = new Date(date + 'T00:00:00.000Z').toISOString();
      const toIso = new Date(date + 'T23:59:59.999Z').toISOString();
      visitsQuery = visitsQuery.gte('created_at', fromIso).lte('created_at', toIso);
    }

    const { data: visits } = await visitsQuery;
    const visitsMap = {};
    (visits || []).forEach(v => {
      const bCode = String(v.bmc?.bmc_code || v.bmc_code || '').trim();
      if (bCode) {
        visitsMap[bCode] = v;
      }
    });

    const bmcMap = {};

    (rows || []).forEach(r => {
      const bmcCode = String(r.sample_ref || (r.raw_data && r.raw_data.bmc_code) || r.bmc_name || '').trim();
      const key = `${bmcCode}_${r.test_date}`;

      if (!bmcMap[key]) {
        const liters = r.raw_data?.macs_quantity_liters ?? r.raw_data?.liters ?? r.raw_data?.quantity ?? r.liters ?? r.quantity ?? null;
        const kg = r.raw_data?.macs_quantity_kg ?? r.raw_data?.kg ?? (liters ? parseFloat((liters * 1.03).toFixed(2)) : null);

        bmcMap[key] = {
          bmc_code: bmcCode,
          bmc_name: r.bmc_name || r.bmc?.name || 'N/A',
          bmc_id: r.bmc_id || r.bmc?.id,
          reading_date: r.test_date,
          worker: null,
          qc: null,
          macs: {
            quantity_liters: liters,
            quantity_kg: kg,
            fat: r.fat,
            snf: r.snf
          },
          spot: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, visited: false },
          diary: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, recorded: false },
          fat_diff: null,
          snf_diff: null,
          status: 'NO_DATA',
          visit_id: null,
          is_tested: false
        };
      }

      const src = r.overall_result || (r.raw_data && r.raw_data.source) || 'worker';
      if (src === 'worker') {
        bmcMap[key].worker = { fat: r.fat, snf: r.snf, id: r.id, raw: r.raw_data };
      } else if (src === 'qc') {
        bmcMap[key].qc = { fat: r.fat, snf: r.snf, id: r.id, raw: r.raw_data };
      }

      const unpack = (rel) => !rel ? {} : (Array.isArray(rel) ? rel[rel.length - 1] || {} : rel);
      const spotVisit = visitsMap[bmcCode];
      if (spotVisit) {
        const ftir = unpack(spotVisit.ftir_tests);
        const gerber = unpack(spotVisit.gerber_tests);
        const issue = unpack(spotVisit.bmc_issues);
        const rating = unpack(spotVisit.bmc_ratings);
        const qcTest = unpack(spotVisit.qc_test);

        const lit = spotVisit.sample_liters || spotVisit.milk_quantity_liters || null;
        const kg = spotVisit.milk_quantity_kg || spotVisit.in_weight || (lit ? parseFloat((lit * 1.03).toFixed(2)) : null);

        bmcMap[key].visit_id = spotVisit.id;

        bmcMap[key].spot = {
          compartment: spotVisit.compartment || null,
          quantity_liters: lit,
          quantity_kg: kg,
          fat: ftir.fat ?? gerber.fat_percentage ?? null,
          snf: ftir.snf ?? gerber.snf ?? null,
          visited: spotVisit.status === 'completed' || spotVisit.status === 'visited' || Boolean(spotVisit.visit_end_time),
          status: spotVisit.status || 'visited'
        };

        const hasRealFat = qcTest.fat !== undefined && qcTest.fat !== null && !isNaN(parseFloat(qcTest.fat));
        const hasRealSnf = qcTest.snf !== undefined && qcTest.snf !== null && !isNaN(parseFloat(qcTest.snf));
        const isSubmittedStatus = Boolean(qcTest.status && ['submitted', 'approved', 'completed'].includes(qcTest.status));

        if (qcTest && qcTest.id && (hasRealFat || hasRealSnf || isSubmittedStatus)) {
          bmcMap[key].diary = {
            quantity_liters: qcTest.sample_liters || lit,
            quantity_kg: qcTest.sample_kg || kg,
            fat: hasRealFat ? parseFloat(qcTest.fat) : null,
            snf: hasRealSnf ? parseFloat(qcTest.snf) : null,
            recorded: true
          };
          bmcMap[key].is_tested = true;
        }
      }
    });

    const macsComparisons = Object.values(bmcMap).map(item => {
      const diary = item.diary;
      const macs = item.macs;

      const dFat = (diary && diary.recorded && diary.fat !== null && diary.fat !== undefined) ? parseFloat(diary.fat) : null;
      const mFat = (macs && macs.fat !== null && macs.fat !== undefined) ? parseFloat(macs.fat) : null;
      const dSnf = (diary && diary.recorded && diary.snf !== null && diary.snf !== undefined) ? parseFloat(diary.snf) : null;
      const mSnf = (macs && macs.snf !== null && macs.snf !== undefined) ? parseFloat(macs.snf) : null;

      const fatDiff = (dFat !== null && mFat !== null && !isNaN(dFat) && !isNaN(mFat)) ? parseFloat((dFat - mFat).toFixed(2)) : null;
      const snfDiff = (dSnf !== null && mSnf !== null && !isNaN(dSnf) && !isNaN(mSnf)) ? parseFloat((dSnf - mSnf).toFixed(2)) : null;

      item.fat_diff = fatDiff;
      item.snf_diff = snfDiff;

      if (!diary || !diary.recorded) {
        item.status = 'QC_NOT_TESTED';
      } else if (fatDiff === 0 && snfDiff === 0) {
        item.status = 'MATCHED';
      } else if (fatDiff !== null || snfDiff !== null) {
        item.status = 'MISMATCH';
      } else {
        item.status = 'PARTIAL_DATA';
      }

      if (!item.visit_id) {
        item.visit_id = item.bmc_id ? `bmc_${item.bmc_id}` : `bmc_code_${item.bmc_code}`;
      }

      return item;
    });

    const matchedMacsCodes = new Set(Object.values(bmcMap).map(m => m.bmc_code));
    const noMacsReadings = [];

    const unpack = (rel) => !rel ? {} : (Array.isArray(rel) ? rel[rel.length - 1] || {} : rel);
    (visits || []).forEach(v => {
      const bCode = String(v.bmc?.bmc_code || v.bmc_code || '').trim();
      const bName = v.bmc?.name || v.bmc_name || 'N/A';
      if (bCode && !matchedMacsCodes.has(bCode)) {
        const ftir = unpack(v.ftir_tests);
        const gerber = unpack(v.gerber_tests);
        const qcTest = unpack(v.qc_test);

        const lit = v.sample_liters || v.milk_quantity_liters || null;
        const kg = v.milk_quantity_kg || v.in_weight || (lit ? parseFloat((lit * 1.03).toFixed(2)) : null);
        const vDate = v.visit_end_time ? new Date(v.visit_end_time).toISOString().split('T')[0] : (date || new Date().toISOString().split('T')[0]);

        let isTested = false;
        let diaryObj = { quantity_liters: null, quantity_kg: null, fat: null, snf: null, recorded: false };

        const hasRealFat2 = qcTest.fat !== undefined && qcTest.fat !== null && !isNaN(parseFloat(qcTest.fat));
        const hasRealSnf2 = qcTest.snf !== undefined && qcTest.snf !== null && !isNaN(parseFloat(qcTest.snf));
        const isSubmittedStatus2 = Boolean(qcTest.status && ['submitted', 'approved', 'completed'].includes(qcTest.status));

        if (qcTest && qcTest.id && (hasRealFat2 || hasRealSnf2 || isSubmittedStatus2)) {
          diaryObj = {
            quantity_liters: qcTest.sample_liters || lit,
            quantity_kg: qcTest.sample_kg || kg,
            fat: hasRealFat2 ? parseFloat(qcTest.fat) : null,
            snf: hasRealSnf2 ? parseFloat(qcTest.snf) : null,
            recorded: true
          };
          isTested = true;
        }

        noMacsReadings.push({
          bmc_code: bCode,
          bmc_name: bName,
          bmc_id: v.bmc_id || v.bmc?.id,
          reading_date: vDate,
          visit_id: v.id,
          is_tested: isTested,
          spot: {
            compartment: v.compartment || null,
            quantity_liters: lit,
            quantity_kg: kg,
            fat: ftir.fat ?? gerber.fat_percentage ?? null,
            snf: ftir.snf ?? gerber.snf ?? null,
            visited: v.status === 'completed' || v.status === 'visited' || Boolean(v.visit_end_time),
            status: v.status || 'visited'
          },
          diary: diaryObj,
          fat_diff: null,
          snf_diff: null,
          status: 'NO_MACS_DATA'
        });
      }
    });

    res.json({
      readings: macsComparisons,
      no_macs_readings: noMacsReadings
    });
  } catch (err) {
    console.error('❌ QC Worker MACS Readings error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qc-worker/tests (Save/Upsert Draft)
app.post('/api/qc-worker/tests', requireQcWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const {
    visit_id,
    sample_received_at,
    sample_condition,
    fat,
    snf,
    clr,
    temperature,
    acidity,
    protein,
    lactose,
    density,
    water_percentage,
    test_start_time,
    test_end_time,
    equipment_used,
    instrument_id,
    overall_result,
    remarks,
    additional_observations
  } = req.body;

  if (!visit_id) return res.status(400).json({ error: 'visit_id is required.' });

  try {
    const { data: existing } = await adminClient
      .from('qc_lab_tests')
      .select('id, status')
      .eq('visit_id', visit_id)
      .maybeSingle();

    const payload = {
      visit_id,
      qc_worker_id: profile.id,
      sample_received_at: sample_received_at || new Date().toISOString(),
      sample_condition: sample_condition || 'good',
      fat: fat !== undefined && fat !== '' && fat !== null ? parseFloat(fat) : null,
      snf: snf !== undefined && snf !== '' && snf !== null ? parseFloat(snf) : null,
      clr: clr !== undefined && clr !== '' && clr !== null ? parseFloat(clr) : null,
      temperature: temperature !== undefined && temperature !== '' && temperature !== null ? parseFloat(temperature) : null,
      acidity: acidity !== undefined && acidity !== '' && acidity !== null ? parseFloat(acidity) : null,
      protein: protein !== undefined && protein !== '' && protein !== null ? parseFloat(protein) : null,
      lactose: lactose !== undefined && lactose !== '' && lactose !== null ? parseFloat(lactose) : null,
      density: density !== undefined && density !== '' && density !== null ? parseFloat(density) : null,
      water_percentage: water_percentage !== undefined && water_percentage !== '' && water_percentage !== null ? parseFloat(water_percentage) : null,
      test_start_time: test_start_time || new Date().toISOString(),
      test_end_time: test_end_time || null,
      equipment_used: equipment_used || null,
      instrument_id: instrument_id || null,
      overall_result: overall_result || 'pass',
      remarks: remarks || null,
      additional_observations: additional_observations || null,
      status: existing ? (existing.status === 'returned' ? 'in_progress' : existing.status) : 'in_progress',
      updated_at: new Date().toISOString()
    };

    let resultData;
    if (existing) {
      const { data, error } = await adminClient
        .from('qc_lab_tests')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      resultData = data;
    } else {
      const { data, error } = await adminClient
        .from('qc_lab_tests')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      resultData = data;
    }

    res.json({ success: true, test: resultData });
  } catch (err) {
    console.error('❌ Save QC Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qc-worker/tests/:id/submit
app.post('/api/qc-worker/tests/:id/submit', requireQcWorker, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const { data: test, error: fetchErr } = await adminClient
      .from('qc_lab_tests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !test) return res.status(404).json({ error: 'QC Test not found.' });
    if (test.qc_worker_id !== profile.id && profile.role !== 'admin') {
      return res.status(403).json({ error: 'You are not authorized to submit this test.' });
    }

    const { data: updated, error: updateErr } = await adminClient
      .from('qc_lab_tests')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    await adminClient.from('qc_audit_logs').insert({
      entity_type: 'qc_lab_test',
      entity_id: req.params.id,
      action: 'submitted',
      actor_id: profile.id,
      old_values: { status: test.status },
      new_values: { status: 'submitted' }
    });

    res.json({ success: true, message: 'QC Test Report submitted successfully!', test: updated });
  } catch (err) {
    console.error('❌ Submit QC Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-worker/history
app.get('/api/qc-worker/history', requireQcWorker, async (req, res) => {
  const { adminClient, profile } = req;
  try {
    const { data: tests, error } = await adminClient
      .from('qc_lab_tests')
      .select(`
        *,
        visit:trip_bmc_visits(
          *,
          bmc:bmcs(*),
          trip:trips(*, worker:profiles!trips_worker_id_fkey(*)),
          ftir_tests(*),
          gerber_tests(*)
        ),
        reviews:qc_test_reviews(*)
      `)
      .eq('qc_worker_id', profile.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json({ tests: tests || [] });
  } catch (err) {
    console.error('❌ QC Worker History error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-worker/reports-testing
app.get('/api/qc-worker/reports-testing', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: issues, error } = await adminClient
      .from('bmc_issues')
      .select('*')
      .eq('category', 'other')
      .ilike('description', '%"type":"qc_lab_issue"%')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formattedIssues = (issues || []).map((iss, index) => {
      let meta = {};
      try {
        meta = typeof iss.description === 'string' ? JSON.parse(iss.description) : (iss.description || {});
      } catch (e) {}

      return {
        id: iss.id,
        bmc_code: meta.bmc_code || 'N/A',
        bmc_name: meta.bmc_name || 'N/A',
        district: meta.district || 'N/A',
        date: meta.date || iss.created_at?.slice(0, 10),
        rejected_item: meta.rejected_item || null,
        agm_remarks: iss.remarks || 'No remarks provided',
        worker_remarks: meta.worker_remarks || null,
        status: iss.status || 'rejected',
        created_at: iss.created_at
      };
    });

    res.json({ reports: formattedIssues });
  } catch (err) {
    console.error('❌ GET QC Worker Reports error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/qc-worker/reports-testing/:id/done
app.patch('/api/qc-worker/reports-testing/:id/done', requireQcWorker, async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;
  const { remarks } = req.body;

  if (!remarks) {
    return res.status(400).json({ error: 'Remarks are required.' });
  }

  try {
    const { data: issue } = await adminClient.from('bmc_issues').select('*').eq('id', id).single();
    if (!issue) return res.status(404).json({ error: 'Report not found.' });

    let meta = {};
    try {
      meta = typeof issue.description === 'string' ? JSON.parse(issue.description) : (issue.description || {});
    } catch (e) {}

    meta.worker_remarks = remarks;

    const { data: updated, error } = await adminClient
      .from('bmc_issues')
      .update({
        status: 'report_done',
        description: JSON.stringify(meta)
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, message: 'Report marked as done.', report: updated });
  } catch (err) {
    console.error('❌ QC Worker Report Done error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── QC AGM APIs ─────────────────────────────────────────────────────────────

// GET /api/qc-agm/profile
app.get('/api/qc-agm/profile', requireQcAgm, (req, res) => {
  res.json({ profile: req.profile });
});

// PUT /api/qc-agm/profile — Update QC Manager Name and DOB
app.put('/api/qc-agm/profile', requireQcAgm, async (req, res) => {
  const { adminClient, user } = req;
  const { name, dob } = req.body;
  if (!name || !dob) {
    return res.status(400).json({ error: 'Name and Date of Birth are required.' });
  }
  try {
    const { data: updatedProfile, error } = await adminClient
      .from('profiles')
      .update({ name, dob, updated_at: new Date() })
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, profile: updatedProfile });
  } catch (err) {
    console.error('❌ QC AGM Profile update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/dashboard — Metrics for QC Manager Dashboard Overview
app.get('/api/qc-agm/dashboard', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  const date = req.query.date;
  const period = (req.query.period || 'both').toLowerCase();
  try {
    // 1. Total BMC count (master BMCs in website/database)
    const { count: totalBmcs } = await adminClient
      .from('bmcs')
      .select('id', { count: 'exact', head: true });

    // 2. Total Quantity Collected (KG) — calculated using completed Spot Analyzer values, NOT MACS values
    let visitsQuery = adminClient
      .from('trip_bmc_visits')
      .select('milk_quantity_liters, milk_quantity_kg, in_weight, visit_end_time, remarks, created_at')
      .eq('status', 'completed');

    if (date) {
      const fromIso = new Date(date + 'T00:00:00.000Z').toISOString();
      const toIso = new Date(date + 'T23:59:59.999Z').toISOString();
      visitsQuery = visitsQuery.gte('visit_end_time', fromIso).lte('visit_end_time', toIso);
    }

    const { data: spotVisits } = await visitsQuery;
    let spotVisitsFiltered = spotVisits || [];

    if (period !== 'both') {
      spotVisitsFiltered = spotVisitsFiltered.filter(v => {
        const r = (v.remarks || '').toLowerCase();
        if (period === 'morning') return r.includes('morning') || !r.includes('evening');
        if (period === 'evening') return r.includes('evening');
        return true;
      });
    }

    let totalQuantityKg = 0;
    spotVisitsFiltered.forEach(v => {
      const lit = parseFloat(v.milk_quantity_liters || 0);
      const kg = parseFloat(v.milk_quantity_kg || v.in_weight || 0);
      if (kg > 0) {
        totalQuantityKg += kg;
      } else if (lit > 0) {
        totalQuantityKg += (lit * 1.03);
      }
    });

    // 3. MACS Total BMC count for selected date & period
    const { data: masterBmcsList } = await adminClient
      .from('bmcs')
      .select('bmc_code');
    const masterCodesSet = new Set((masterBmcsList || []).map(b => String(b.bmc_code || '').trim().toLowerCase()).filter(Boolean));

    let macsQuery = adminClient.from('qc_excel_import_rows').select('sample_ref, bmc_name, raw_data, bmc_id, fat, snf');
    if (date) macsQuery = macsQuery.eq('test_date', date);

    const { data: macsRows } = await macsQuery;
    let macsRowsFiltered = macsRows || [];

    if (period !== 'both') {
      macsRowsFiltered = macsRowsFiltered.filter(r => {
        const p = (r.raw_data?.period || 'morning').toLowerCase();
        return p === period;
      });
    }

    const validMatchedBmcs = new Set();
    macsRowsFiltered.forEach(r => {
      const code = String(r.sample_ref || r.raw_data?.bmc_code || '').trim().toLowerCase();
      const lit = parseFloat(r.raw_data?.macs_quantity_liters || r.raw_data?.liters || r.raw_data?.quantity || 0);
      const kg = parseFloat(r.raw_data?.macs_quantity_kg || 0);
      const fat = parseFloat(r.fat || r.raw_data?.macs_fat || 0);
      const snf = parseFloat(r.snf || r.raw_data?.macs_snf || 0);

      const hasValue = (lit > 0 || kg > 0 || fat > 0 || snf > 0);
      const matchesMaster = masterCodesSet.has(code);

      if (code && matchesMaster && hasValue) {
        validMatchedBmcs.add(code);
      }
    });

    res.json({
      total_bmcs: totalBmcs || 0,
      total_quantity_kg: parseFloat(totalQuantityKg.toFixed(2)),
      macs_total_bmcs: validMatchedBmcs.size
    });
  } catch (err) {
    console.error('❌ QC AGM Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});


// GET /api/qc-agm/bmcs/:bmcCode/details — BMC Info & readings table for BMC Details page
app.get('/api/qc-agm/bmcs/:bmcCode/details', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  const bmcCode = req.params.bmcCode;

  try {
    // 1. Fetch BMC info safely
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bmcCode);
    let bmcQuery = adminClient.from('bmcs').select('*');
    if (isUuid) {
      bmcQuery = bmcQuery.or(`bmc_code.eq.${bmcCode},id.eq.${bmcCode}`);
    } else {
      bmcQuery = bmcQuery.eq('bmc_code', bmcCode);
    }

    let { data: bmc } = await bmcQuery.maybeSingle();

    if (!bmc) {
      const { data: bmcList } = await adminClient.from('bmcs').select('*');
      bmc = (bmcList || []).find(b => String(b.bmc_code || '').trim().toLowerCase() === String(bmcCode).trim().toLowerCase());
    }

    if (!bmc) {
      bmc = { bmc_code: bmcCode, name: `BMC ${bmcCode}`, district: 'Coimbatore', rating: 4.5 };
    } else {
      const { data: ratings } = await adminClient
        .from('bmc_ratings')
        .select('overall_rating')
        .eq('bmc_id', bmc.id);

      if (ratings && ratings.length > 0) {
        const sum = ratings.reduce((acc, r) => acc + (parseFloat(r.overall_rating) || 5), 0);
        bmc.rating = parseFloat((sum / ratings.length).toFixed(1));
      } else {
        bmc.rating = 4.5;
      }
    }

    // 2. Fetch MACS import rows for this BMC
    const { data: excelRows } = await adminClient
      .from('qc_excel_import_rows')
      .select('*')
      .or(`bmc_id.eq.${bmc.id || '00000000-0000-0000-0000-000000000000'},sample_ref.eq.${bmcCode},bmc_name.eq.${bmc.name}`)
      .order('test_date', { ascending: false });

    // 3. Fetch Spot Analyzer visits for this BMC
    let visitsQuery = adminClient
      .from('trip_bmc_visits')
      .select('*, ftir_tests(*), gerber_tests(*), bmc_issues(*), bmc_ratings(*)')
      .in('status', ['completed', 'visited']);
      
    if (bmc.id) {
      visitsQuery = visitsQuery.eq('bmc_id', bmc.id);
    }
    const { data: visits } = await visitsQuery;

    // 4. Fetch rejected issues for this BMC
    const { data: rejectedIssues } = await adminClient
      .from('bmc_issues')
      .select('*')
      .eq('category', 'other')
      .ilike('description', '%"type":"qc_lab_issue"%');

    const bmcIssuesMap = {};
    (rejectedIssues || []).forEach(iss => {
      try {
        const meta = typeof iss.description === 'string' ? JSON.parse(iss.description) : (iss.description || {});
        if (String(meta.bmc_code || '').trim().toLowerCase() === String(bmcCode).trim().toLowerCase()) {
          bmcIssuesMap[meta.date || iss.created_at?.slice(0,10)] = iss;
        }
      } catch (e) {}
    });

    // Group records date-wise
    const recordsMap = {};

    (excelRows || []).forEach(r => {
      const d = r.test_date || new Date(r.created_at).toISOString().split('T')[0];
      if (!recordsMap[d]) {
        recordsMap[d] = { date: d, macs: null, spot: null, diary: null };
      }
      const lit = r.raw_data?.macs_quantity_liters ?? r.raw_data?.liters ?? (r.fat ? r.raw_data?.quantity : null);
      const kg = r.raw_data?.macs_quantity_kg ?? (lit ? parseFloat((lit * 1.03).toFixed(2)) : null);
      recordsMap[d].macs = {
        liters: lit,
        kg: kg,
        fat: r.fat,
        snf: r.snf
      };
    });

    (visits || []).forEach(v => {
      const d = v.visit_end_time ? new Date(v.visit_end_time).toISOString().split('T')[0] : new Date(v.created_at).toISOString().split('T')[0];
      if (!recordsMap[d]) {
        recordsMap[d] = { date: d, macs: null, spot: null, diary: null };
      }
      const unpack = (rel) => !rel ? {} : (Array.isArray(rel) ? rel[rel.length - 1] || {} : rel);
      const ftir = unpack(v.ftir_tests);
      const gerber = unpack(v.gerber_tests);
      const issue = unpack(v.bmc_issues);
      const rating = unpack(v.bmc_ratings);

      const lit = v.sample_liters || v.milk_quantity_liters || null;
      const kg = v.milk_quantity_kg || v.in_weight || (lit ? parseFloat((lit * 1.03).toFixed(2)) : null);

      recordsMap[d].spot = {
        compartment: v.compartment || null,
        liters: lit,
        kg: kg,
        fat: ftir.fat ?? gerber.fat_percentage ?? null,
        snf: ftir.snf ?? gerber.snf ?? null,
        ftir_fat: ftir.fat ?? null,
        ftir_snf: ftir.snf ?? null,
        gerber_fat: gerber.fat_percentage ?? null,
        gerber_snf: gerber.snf ?? null,
        gerber_clr: gerber.clr ?? null,
        report: issue.description || issue.remarks || null,
        priority: issue.severity || null,
        rating: rating.overall_rating ?? null,
        remarks: rating.remarks || v.remarks || null,
        visited: v.status === 'completed' || v.status === 'visited' || Boolean(v.visit_end_time),
        status: v.status || 'visited'
      };
    });

    // Attach issues and differences
    const recordsList = Object.keys(recordsMap).sort((a, b) => b.localeCompare(a)).map((d, index) => {
      const item = recordsMap[d];
      const issue = bmcIssuesMap[d];

      let diffStr = '-';
      if (item.macs && item.spot && item.macs.fat !== null && item.spot.fat !== null) {
        const fDiff = parseFloat((item.macs.fat - item.spot.fat).toFixed(2));
        const sDiff = (item.macs.snf !== null && item.spot.snf !== null) 
          ? parseFloat((item.macs.snf - item.spot.snf).toFixed(2)) 
          : 0;
        const fSign = fDiff > 0 ? `+${fDiff}` : `${fDiff}`;
        const sSign = sDiff > 0 ? `+${sDiff}` : `${sDiff}`;
        diffStr = `FAT: ${fSign} | SNF: ${sSign}`;
      }

      return {
        s_no: index + 1,
        date: d,
        macs: item.macs,
        spot: item.spot,
        diary: item.diary,
        difference: diffStr,
        is_denied: !!issue,
        remarks: issue ? issue.remarks : ''
      };
    });

    res.json({ bmc, records: recordsList });
  } catch (err) {
    console.error('❌ GET BMC Details error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qc-agm/deny-reading — Deny/Reject item and record in Lab Issue Report
app.post('/api/qc-agm/deny-reading', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  const { bmc_code, bmc_name, district, date, remarks, rejected_item } = req.body;

  if (!bmc_code || !remarks) {
    return res.status(400).json({ error: 'bmc_code and remarks are required.' });
  }

  try {
    const { data: bmc } = await adminClient
      .from('bmcs')
      .select('id, name, district')
      .eq('bmc_code', bmc_code)
      .maybeSingle();

    const bmcId = bmc ? bmc.id : null;
    const finalBmcName = bmc_name || (bmc ? bmc.name : `BMC ${bmc_code}`);
    const finalDistrict = district || (bmc ? bmc.district || bmc.location : 'N/A');

    // Get valid visit_id for foreign key constraint
    let visitId = null;
    if (bmcId) {
      const { data: bmcVisit } = await adminClient.from('trip_bmc_visits').select('id').eq('bmc_id', bmcId).limit(1).maybeSingle();
      if (bmcVisit) visitId = bmcVisit.id;
    }
    if (!visitId) {
      const { data: anyVisit } = await adminClient.from('trip_bmc_visits').select('id').limit(1).maybeSingle();
      if (anyVisit) visitId = anyVisit.id;
    }

    const issuePayload = {
      visit_id: visitId,
      category: 'other',
      description: JSON.stringify({
        type: 'qc_lab_issue',
        bmc_code,
        bmc_name: finalBmcName,
        district: finalDistrict,
        date: date || new Date().toISOString().split('T')[0],
        rejected_item: rejected_item || {}
      }),
      severity: 'high',
      remarks: remarks,
      status: 'rejected'
    };

    const { data: issue, error } = await adminClient
      .from('bmc_issues')
      .insert(issuePayload)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Reading denied successfully and sent to Lab Issue Report.',
      issue
    });
  } catch (err) {
    console.error('❌ Deny reading error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/lab-issues — Retrieve all rejected items for Lab Issue Report tab
app.get('/api/qc-agm/lab-issues', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: issues, error } = await adminClient
      .from('bmc_issues')
      .select('*')
      .eq('category', 'other')
      .ilike('description', '%"type":"qc_lab_issue"%')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formattedIssues = (issues || []).map((iss, index) => {
      let meta = {};
      try {
        meta = typeof iss.description === 'string' ? JSON.parse(iss.description) : (iss.description || {});
      } catch (e) {}

      return {
        s_no: index + 1,
        id: iss.id,
        bmc_code: meta.bmc_code || 'N/A',
        bmc_name: meta.bmc_name || 'N/A',
        district: meta.district || 'N/A',
        date: meta.date || iss.created_at?.slice(0, 10),
        rejected_item: meta.rejected_item || null,
        remarks: iss.remarks || 'No remarks provided',
        worker_remarks: meta.worker_remarks || null,
        status: iss.status || 'rejected',
        created_at: iss.created_at
      };
    });

    res.json({ issues: formattedIssues });
  } catch (err) {
    console.error('❌ GET Lab Issues error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/tests
app.get('/api/qc-agm/tests', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  const date = req.query.date;
  try {
    let query = adminClient
      .from('trip_bmc_visits')
      .select(`
        *,
        bmc:bmcs(*),
        trip:trips(*, worker:profiles!trips_worker_id_fkey(*)),
        ftir_tests(*),
        gerber_tests(*),
        bmc_issues(*),
        bmc_ratings(*),
        qc_test:qc_lab_tests(*, qc_worker:profiles(*), reviews:qc_test_reviews(*))
      `)
      .in('status', ['completed', 'visited'])
      .order('visit_end_time', { ascending: false });
      
    if (date) {
      const fromIso = new Date(date + 'T00:00:00.000Z').toISOString();
      const toIso = new Date(date + 'T23:59:59.999Z').toISOString();
      query = query.gte('visit_end_time', fromIso).lte('visit_end_time', toIso);
    }

    const { data: visits, error } = await query;
    if (error) throw error;

    const bmcIds = [...new Set((visits || []).map(v => v.bmc_id).filter(Boolean))];
    let excelRows = [];
    if (bmcIds.length > 0) {
      const { data: xRows } = await adminClient
        .from('qc_excel_import_rows')
        .select('*')
        .in('bmc_id', bmcIds);
      excelRows = xRows || [];
    }
    
    (visits || []).forEach(v => {
      const vDate = v.visit_end_time ? new Date(v.visit_end_time).toISOString().split('T')[0] : null;
      v.macs_qc = excelRows.find(x => x.bmc_id === v.bmc_id && x.test_date === vDate && x.overall_result === 'qc') || null;
      v.macs_worker = excelRows.find(x => x.bmc_id === v.bmc_id && x.test_date === vDate && x.overall_result === 'worker') || null;
    });

    res.json({ tests: visits || [] });
  } catch (err) {
    console.error('❌ QC AGM All Tests error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/tests/:id
app.get('/api/qc-agm/tests/:id', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: visit, error } = await adminClient
      .from('trip_bmc_visits')
      .select(`
        *,
        bmc:bmcs(*),
        trip:trips(*, worker:profiles!trips_worker_id_fkey(*)),
        ftir_tests(*),
        gerber_tests(*),
        bmc_issues(*),
        bmc_ratings(*),
        qc_test:qc_lab_tests(*, qc_worker:profiles(*), reviews:qc_test_reviews(*))
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !visit) return res.status(404).json({ error: 'Test details not found.' });

    let excelRows = [];
    if (visit.bmc_id) {
      const { data: xRows } = await adminClient
        .from('qc_excel_import_rows')
        .select('*, batch:qc_excel_imports(*)')
        .eq('bmc_id', visit.bmc_id)
        .order('test_date', { ascending: false });
      excelRows = xRows || [];
    }

    res.json({ test: visit, excel_rows: excelRows });
  } catch (err) {
    console.error('❌ QC AGM Single Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qc-agm/tests/:id/review (approve or return)
app.post('/api/qc-agm/tests/:id/review', requireQcAgm, async (req, res) => {
  const { adminClient, profile } = req;
  const { action, remarks } = req.body;

  if (!['approved', 'returned'].includes(action)) {
    return res.status(400).json({ error: 'Action must be "approved" or "returned".' });
  }
  if (action === 'returned' && (!remarks || !remarks.trim())) {
    return res.status(400).json({ error: 'Remarks are required when returning a report for correction.' });
  }

  try {
    const { data: test, error: fetchErr } = await adminClient
      .from('qc_lab_tests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !test) return res.status(404).json({ error: 'QC Test not found.' });

    const newStatus = action === 'approved' ? 'approved' : 'returned';
    const { data: updated, error: updateErr } = await adminClient
      .from('qc_lab_tests')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    await adminClient.from('qc_test_reviews').insert({
      qc_test_id: req.params.id,
      reviewer_id: profile.id,
      action: action,
      remarks: remarks || null
    });

    await adminClient.from('qc_audit_logs').insert({
      entity_type: 'qc_lab_test',
      entity_id: req.params.id,
      action: action,
      actor_id: profile.id,
      old_values: { status: test.status },
      new_values: { status: newStatus, remarks }
    });

    res.json({ success: true, message: `Report successfully ${action}!`, test: updated });
  } catch (err) {
    console.error('❌ Review QC Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/bmcs
app.get('/api/qc-agm/bmcs', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: bmcs, error } = await adminClient.from('bmcs').select('*, bmc_routes(*)').order('name');
    if (error) throw error;
    res.json({ bmcs: bmcs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/bmcs/:id/tests
app.get('/api/qc-agm/bmcs/:bmcCode/tests', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: bmcData } = await adminClient.from('bmcs').select('id').eq('bmc_code', req.params.bmcCode).single();
    if (!bmcData) return res.status(404).json({ error: 'BMC not found' });
    const bmcId = bmcData.id;
    const { data: visits, error } = await adminClient
      .from('trip_bmc_visits')
      .select(`
        *,
        bmc:bmcs(*),
        trip:trips(*, worker:profiles!trips_worker_id_fkey(*)),
        ftir_tests(*),
        gerber_tests(*),
        qc_test:qc_lab_tests(*, qc_worker:profiles(*))
      `)
      .eq('bmc_id', bmcId)
      .eq('status', 'completed')
      .order('visit_end_time', { ascending: false });

    if (error) throw error;

    const { data: excelRows } = await adminClient
      .from('qc_excel_import_rows')
      .select('*, batch:qc_excel_imports(*)')
      .eq('bmc_id', bmcId)
      .order('test_date', { ascending: false });

    res.json({ visits: visits || [], excel_rows: excelRows || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qc-agm/import/excel
app.post('/api/qc-agm/import/excel', requireQcAgm, async (req, res) => {
  const { adminClient, profile } = req;
  const { file_name, rows, notes } = req.body;

  if (!file_name || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'file_name and rows array are required.' });
  }

  try {
    const { data: importBatch, error: importErr } = await adminClient
      .from('qc_excel_imports')
      .insert({
        file_name,
        imported_by: profile.id,
        total_rows: rows.length,
        notes: notes || null,
        status: 'completed'
      })
      .select()
      .single();

    if (importErr) throw importErr;

    const { data: bmcs } = await adminClient.from('bmcs').select('id, name, district');
    const bmcMap = {};
    (bmcs || []).forEach(b => {
      bmcMap[b.name.toLowerCase().trim()] = b.id;
    });

    let successCount = 0;
    let errorCount = 0;

    const insertRows = rows.map((r, idx) => {
      const matchedBmcId = r.bmc_id || (r.bmc_name ? bmcMap[r.bmc_name.toLowerCase().trim()] : null);
      let rStatus = 'imported';
      let errMsgs = [];

      if (!r.fat && !r.snf) {
        rStatus = 'error';
        errMsgs.push('Missing Fat and SNF');
        errorCount++;
      } else {
        successCount++;
      }

      return {
        import_id: importBatch.id,
        bmc_id: matchedBmcId || null,
        bmc_name: r.bmc_name || null,
        sample_ref: r.sample_id || r.sample_ref || `ROW-${idx + 1}`,
        test_date: r.test_date || new Date().toISOString().split('T')[0],
        fat: r.fat !== undefined && r.fat !== '' && r.fat !== null ? parseFloat(r.fat) : null,
        snf: r.snf !== undefined && r.snf !== '' && r.snf !== null ? parseFloat(r.snf) : null,
        clr: r.clr !== undefined && r.clr !== '' && r.clr !== null ? parseFloat(r.clr) : null,
        temperature: r.temperature !== undefined && r.temperature !== '' && r.temperature !== null ? parseFloat(r.temperature) : null,
        acidity: r.acidity !== undefined && r.acidity !== '' && r.acidity !== null ? parseFloat(r.acidity) : null,
        protein: r.protein !== undefined && r.protein !== '' && r.protein !== null ? parseFloat(r.protein) : null,
        lactose: r.lactose !== undefined && r.lactose !== '' && r.lactose !== null ? parseFloat(r.lactose) : null,
        density: r.density !== undefined && r.density !== '' && r.density !== null ? parseFloat(r.density) : null,
        overall_result: r.overall_result || 'pass',
        raw_data: r,
        row_status: rStatus,
        error_message: errMsgs.join('; ') || null
      };
    });

    if (insertRows.length > 0) {
      const { error: rowErr } = await adminClient.from('qc_excel_import_rows').insert(insertRows);
      if (rowErr) throw rowErr;
    }

    await adminClient.from('qc_excel_imports').update({
      successful_rows: successCount,
      failed_rows: errorCount,
      duplicate_rows: 0
    }).eq('id', importBatch.id);

    res.json({
      success: true,
      message: `Successfully imported ${successCount} records (${errorCount} failed).`,
      import_id: importBatch.id
    });
  } catch (err) {
    console.error('❌ Excel Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/imports
app.get('/api/qc-agm/imports', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: imports, error } = await adminClient
      .from('qc_excel_imports')
      .select('*, importer:profiles(id, name, email)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ imports: imports || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/imports/:id
app.get('/api/qc-agm/imports/:id', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: batch, error: batchErr } = await adminClient
      .from('qc_excel_imports')
      .select('*, importer:profiles(id, name, email)')
      .eq('id', req.params.id)
      .single();

    if (batchErr || !batch) return res.status(404).json({ error: 'Import batch not found.' });

    const { data: rows, error: rowsErr } = await adminClient
      .from('qc_excel_import_rows')
      .select('*, bmc:bmcs(*)')
      .eq('import_id', req.params.id)
      .order('created_at', { ascending: true });

    if (rowsErr) throw rowsErr;

    res.json({ import_batch: batch, rows: rows || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/excel-data
app.get('/api/qc-agm/excel-data', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: rows, error } = await adminClient
      .from('qc_excel_import_rows')
      .select('*, bmc:bmcs(*), batch:qc_excel_imports(*)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ rows: rows || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MACS READING API ENDPOINTS ─────────────────────────────────────────────

// GET /api/qc-agm/macs/dates
app.get('/api/qc-agm/macs/dates', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { data: rows, error } = await adminClient
      .from('qc_excel_import_rows')
      .select('test_date')
      .order('test_date', { ascending: false });

    if (error) throw error;
    const dates = Array.from(new Set((rows || []).map(r => r.test_date).filter(Boolean)));
    res.json({ dates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qc-agm/macs/readings
app.get('/api/qc-agm/macs/readings', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  const date = req.query.date;

  try {
    let query = adminClient
      .from('qc_excel_import_rows')
      .select('*, bmc:bmcs(*, bmc_routes(*)), batch:qc_excel_imports(*)');

    if (date) {
      query = query.eq('test_date', date);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    // Fetch Spot Analyzer visit records for the date if date is given
    let visitsQuery = adminClient
      .from('trip_bmc_visits')
      .select('*, bmc:bmcs(*, bmc_routes(*)), ftir_tests(*), gerber_tests(*), bmc_issues(*), bmc_ratings(*), qc_test:qc_lab_tests(*)')
      .in('status', ['completed', 'visited']);

    if (date) {
      const fromIso = new Date(date + 'T00:00:00.000Z').toISOString();
      const toIso = new Date(date + 'T23:59:59.999Z').toISOString();
      visitsQuery = visitsQuery.gte('visit_end_time', fromIso).lte('visit_end_time', toIso);
    }

    const { data: visits } = await visitsQuery;
    const visitsMap = {};
    (visits || []).forEach(v => {
      const bCode = String(v.bmc?.bmc_code || '').trim();
      if (bCode) {
        visitsMap[bCode] = v;
      }
    });

    const bmcMap = {};

    (rows || []).forEach(r => {
      const bmcCode = String(r.sample_ref || (r.raw_data && r.raw_data.bmc_code) || r.bmc_name || '').trim();
      const key = `${bmcCode}_${r.test_date}`;

      if (!bmcMap[key]) {
        const liters = r.raw_data?.macs_quantity_liters ?? r.raw_data?.liters ?? r.raw_data?.quantity ?? r.liters ?? r.quantity ?? null;
        const kg = r.raw_data?.macs_quantity_kg ?? r.raw_data?.kg ?? (liters ? parseFloat((liters * 1.03).toFixed(2)) : null);

        const routeName = r.bmc?.bmc_routes?.name || r.bmc?.route_name || null;
        bmcMap[key] = {
          bmc_code: bmcCode,
          bmc_name: r.bmc_name || r.bmc?.name || 'N/A',
          bmc_id: r.bmc_id,
          route_name: routeName,
          bmc_routes: routeName ? { name: routeName } : null,
          reading_date: r.test_date,
          worker: null,
          qc: null,
          macs: {
            quantity_liters: liters,
            quantity_kg: kg,
            fat: r.fat,
            snf: r.snf
          },
          spot: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, visited: false },
          diary: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, recorded: false },
          fat_diff: null,
          snf_diff: null,
          status: 'NO_DATA'
        };
      }

      const src = r.overall_result || (r.raw_data && r.raw_data.source) || 'worker';
      if (src === 'worker') {
        bmcMap[key].worker = { fat: r.fat, snf: r.snf, id: r.id, raw: r.raw_data };
      } else if (src === 'qc') {
        bmcMap[key].qc = { fat: r.fat, snf: r.snf, id: r.id, raw: r.raw_data };
      }

      const unpack = (rel) => !rel ? {} : (Array.isArray(rel) ? rel[rel.length - 1] || {} : rel);
      const spotVisit = visitsMap[bmcCode];
      if (spotVisit) {
        const ftir = unpack(spotVisit.ftir_tests);
        const gerber = unpack(spotVisit.gerber_tests);
        const issue = unpack(spotVisit.bmc_issues);
        const rating = unpack(spotVisit.bmc_ratings);

        const lit = spotVisit.sample_liters || spotVisit.milk_quantity_liters || null;
        const kg = spotVisit.milk_quantity_kg || spotVisit.in_weight || (lit ? parseFloat((lit * 1.03).toFixed(2)) : null);

        bmcMap[key].spot = {
          compartment: spotVisit.compartment || null,
          quantity_liters: lit,
          quantity_kg: kg,
          fat: ftir.fat ?? gerber.fat_percentage ?? null,
          snf: ftir.snf ?? gerber.snf ?? null,
          ftir_fat: ftir.fat ?? null,
          ftir_snf: ftir.snf ?? null,
          gerber_fat: gerber.fat_percentage ?? null,
          gerber_snf: gerber.snf ?? null,
          gerber_clr: gerber.clr ?? null,
          report: issue.description || issue.remarks || null,
          priority: issue.severity || null,
          rating: rating.overall_rating ?? null,
          remarks: rating.remarks || spotVisit.remarks || null,
          visited: spotVisit.status === 'completed' || spotVisit.status === 'visited' || Boolean(spotVisit.visit_end_time),
          status: spotVisit.status || 'visited'
        };

        // Populate diary from QC worker's saved lab test (qc_lab_tests)
        const qcTest = unpack(spotVisit.qc_test);
        if (qcTest && qcTest.id) {
          const dFat = qcTest.fat !== null && qcTest.fat !== undefined ? parseFloat(qcTest.fat) : null;
          const dSnf = qcTest.snf !== null && qcTest.snf !== undefined ? parseFloat(qcTest.snf) : null;
          const hasDiaryData = dFat !== null || dSnf !== null;
          bmcMap[key].diary = {
            quantity_liters: lit,
            quantity_kg: kg,
            fat: dFat,
            snf: dSnf,
            clr: qcTest.clr ?? null,
            temperature: qcTest.temperature ?? null,
            status: qcTest.status || null,
            recorded: hasDiaryData
          };
        }

        // Enrich route from BMC if not already set
        if (!bmcMap[key].route_name && spotVisit.bmc?.bmc_routes?.name) {
          bmcMap[key].route_name = spotVisit.bmc.bmc_routes.name;
          bmcMap[key].bmc_routes = { name: spotVisit.bmc.bmc_routes.name };
        }
      }
    });

    const macsComparisons = Object.values(bmcMap).map(item => {
      const w = item.worker;
      const q = item.qc;

      const hasWorker = w && (w.fat !== null || w.snf !== null);
      const hasQc = q && (q.fat !== null || q.snf !== null);

      if (!hasWorker && hasQc) {
        item.status = 'WORKER READING MISSING';
      } else if (hasWorker && !hasQc) {
        item.status = 'QC READING MISSING';
      } else if (!hasWorker && !hasQc) {
        item.status = 'NO_DATA';
      } else {
        const wFat = w.fat !== null && w.fat !== undefined ? parseFloat(w.fat) : null;
        const qFat = q.fat !== null && q.fat !== undefined ? parseFloat(q.fat) : null;
        const wSnf = w.snf !== null && w.snf !== undefined ? parseFloat(w.snf) : null;
        const qSnf = q.snf !== null && q.snf !== undefined ? parseFloat(q.snf) : null;

        const fatDiff = (qFat !== null && wFat !== null && !isNaN(qFat) && !isNaN(wFat)) ? parseFloat((qFat - wFat).toFixed(2)) : null;
        const snfDiff = (qSnf !== null && wSnf !== null && !isNaN(qSnf) && !isNaN(wSnf)) ? parseFloat((qSnf - wSnf).toFixed(2)) : null;

        item.fat_diff = fatDiff;
        item.snf_diff = snfDiff;

        if (fatDiff === 0 && snfDiff === 0) {
          item.status = 'MATCHED';
        } else if (fatDiff !== null || snfDiff !== null) {
          item.status = 'MISMATCH';
        } else {
          item.status = 'PARTIAL_DATA';
        }
      }

      return item;
    });

    // Build Table 2: No MACS Data — Spot Analyzer Visits ONLY
    const matchedMacsCodes = new Set(Object.values(bmcMap).map(m => m.bmc_code));
    const noMacsReadings = [];

    (visits || []).forEach(v => {
      const bCode = String(v.bmc?.bmc_code || '').trim();
      const bName = v.bmc?.name || 'N/A';
      const routeNameNoMacs = v.bmc?.bmc_routes?.name || null;
      if (bCode && !matchedMacsCodes.has(bCode)) {
        const ftir = unpack(v.ftir_tests);
        const gerber = unpack(v.gerber_tests);
        const issue = unpack(v.bmc_issues);
        const rating = unpack(v.bmc_ratings);

        const lit = v.sample_liters || v.milk_quantity_liters || null;
        const kg = v.milk_quantity_kg || v.in_weight || (lit ? parseFloat((lit * 1.03).toFixed(2)) : null);
        const vDate = v.visit_end_time ? new Date(v.visit_end_time).toISOString().split('T')[0] : (date || new Date().toISOString().split('T')[0]);

        // Populate diary from QC worker's saved lab test
        const qcTestNoMacs = unpack(v.qc_test);
        let diaryNoMacs = { quantity_liters: null, quantity_kg: null, fat: null, snf: null, recorded: false };
        if (qcTestNoMacs && qcTestNoMacs.id) {
          const dFat = qcTestNoMacs.fat !== null && qcTestNoMacs.fat !== undefined ? parseFloat(qcTestNoMacs.fat) : null;
          const dSnf = qcTestNoMacs.snf !== null && qcTestNoMacs.snf !== undefined ? parseFloat(qcTestNoMacs.snf) : null;
          diaryNoMacs = {
            quantity_liters: lit,
            quantity_kg: kg,
            fat: dFat,
            snf: dSnf,
            clr: qcTestNoMacs.clr ?? null,
            temperature: qcTestNoMacs.temperature ?? null,
            status: qcTestNoMacs.status || null,
            recorded: dFat !== null || dSnf !== null
          };
        }

        noMacsReadings.push({
          bmc_code: bCode,
          bmc_name: bName,
          route_name: routeNameNoMacs,
          bmc_routes: routeNameNoMacs ? { name: routeNameNoMacs } : null,
          reading_date: vDate,
          spot: {
            compartment: v.compartment || null,
            quantity_liters: lit,
            quantity_kg: kg,
            fat: ftir.fat ?? gerber.fat_percentage ?? null,
            snf: ftir.snf ?? gerber.snf ?? null,
            ftir_fat: ftir.fat ?? null,
            ftir_snf: ftir.snf ?? null,
            gerber_fat: gerber.fat_percentage ?? null,
            gerber_snf: gerber.snf ?? null,
            gerber_clr: gerber.clr ?? null,
            report: issue.description || issue.remarks || null,
            priority: issue.severity || null,
            rating: rating.overall_rating ?? null,
            remarks: rating.remarks || v.remarks || null,
            visited: v.status === 'completed' || v.status === 'visited' || Boolean(v.visit_end_time),
            status: v.status || 'visited'
          },
          diary: diaryNoMacs,
          fat_diff: null,
          snf_diff: null,
          status: 'NO_MACS_DATA'
        });
      }
    });

    res.json({ readings: macsComparisons, no_macs_readings: noMacsReadings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qc-agm/macs/import
app.post('/api/qc-agm/macs/import', requireQcAgm, async (req, res) => {
  const { adminClient, profile } = req;
  const { file_name, import_date, period = 'both', readings, notes } = req.body;

  if (!file_name || !Array.isArray(readings)) {
    return res.status(400).json({ error: 'file_name and readings array are required.' });
  }

  const targetDate = import_date || new Date().toISOString().split('T')[0];

  try {
    const { data: bmcMaster } = await adminClient.from('bmcs').select('id, name, bmc_code');
    const bmcCodeToIdMap = {};
    (bmcMaster || []).forEach(b => {
      if (b.bmc_code) bmcCodeToIdMap[String(b.bmc_code).trim().toLowerCase()] = b;
    });

    const { data: importBatch, error: batchErr } = await adminClient
      .from('qc_excel_imports')
      .insert({
        file_name,
        imported_by: profile.id,
        total_rows: readings.length,
        notes: notes || `MACS Reading Import (${period.toUpperCase()} - ${targetDate})`,
        status: 'completed'
      })
      .select()
      .single();

    if (batchErr) throw batchErr;

    const matchedRows = [];
    const unmatchedRows = [];
    let bmcCodeMissingCount = 0;
    let bmcCodeNotFoundCount = 0;
    let duplicateRowsCount = 0;
    let workerRowsCount = 0;
    let qcRowsCount = 0;
    let totalLitersSum = 0;
    let totalKgSum = 0;

    for (const r of readings) {
      const rawCode = String(r.bmc_code || r.sample_ref || r.code || '').trim();
      const codeKey = rawCode.toLowerCase();
      const matchedBmc = codeKey ? bmcCodeToIdMap[codeKey] : null;

      const liters = parseFloat(r.quantity_liters || r.liters || r.quantity || 0);
      const kg = parseFloat((liters * 1.03).toFixed(2));
      const rDate = r.reading_date || targetDate;
      const rPeriod = (r.period || period || 'morning').toLowerCase();

      if (!rawCode) {
        bmcCodeMissingCount++;
        unmatchedRows.push({
          bmc_code: 'MISSING',
          bmc_name: r.bmc_name || r.society_name || 'Unknown',
          reading_date: rDate,
          period: rPeriod,
          liters,
          kg,
          reason: 'BMC Code Missing'
        });
        continue;
      }

      if (!matchedBmc) {
        bmcCodeNotFoundCount++;
        unmatchedRows.push({
          bmc_code: rawCode,
          bmc_name: r.bmc_name || r.society_name || 'Unknown',
          reading_date: rDate,
          period: rPeriod,
          liters,
          kg,
          reason: `BMC Code Not Found (${rawCode})`
        });
        continue;
      }

      totalLitersSum += liters;
      totalKgSum += kg;

      const source = r.source === 'qc' ? 'qc' : 'worker';
      if (source === 'worker') workerRowsCount++; else qcRowsCount++;

      const payload = {
        import_id: importBatch.id,
        bmc_id: matchedBmc.id,
        bmc_name: matchedBmc.name,
        sample_ref: matchedBmc.bmc_code,
        test_date: rDate,
        fat: r.fat !== undefined && r.fat !== '' && r.fat !== null ? parseFloat(r.fat) : null,
        snf: r.snf !== undefined && r.snf !== '' && r.snf !== null ? parseFloat(r.snf) : null,
        overall_result: rPeriod,
        raw_data: {
          bmc_code: matchedBmc.bmc_code,
          bmc_name: matchedBmc.name,
          bmc_id: matchedBmc.id,
          society_name: r.society_name || r.soc || matchedBmc.name,
          reading_date: rDate,
          period: rPeriod,
          macs_quantity_liters: liters,
          macs_quantity_kg: kg,
          macs_fat: r.fat,
          macs_snf: r.snf,
          macs_status: 'completed',
          spot_status: 'pending',
          diary_status: 'pending',
          source
        },
        row_status: 'imported',
        error_message: null
      };

      matchedRows.push(payload);
    }

    if (matchedRows.length > 0) {
      // Deduplication: Remove existing rows for exact same sample_ref, test_date, and period to prevent duplicate daily records
      for (const mRow of matchedRows) {
        const { data: existingRows } = await adminClient
          .from('qc_excel_import_rows')
          .select('id')
          .eq('sample_ref', mRow.sample_ref)
          .eq('test_date', mRow.test_date)
          .eq('overall_result', mRow.overall_result);

        if (existingRows && existingRows.length > 0) {
          duplicateRowsCount += existingRows.length;
          await adminClient
            .from('qc_excel_import_rows')
            .delete()
            .eq('sample_ref', mRow.sample_ref)
            .eq('test_date', mRow.test_date)
            .eq('overall_result', mRow.overall_result);
        }
      }

      const { error: insErr } = await adminClient.from('qc_excel_import_rows').insert(matchedRows);
      if (insErr) throw insErr;
    }

    await adminClient.from('qc_excel_imports').update({
      successful_rows: matchedRows.length,
      failed_rows: unmatchedRows.length,
      duplicate_rows: duplicateRowsCount
    }).eq('id', importBatch.id);

    res.json({
      success: true,
      message: `MACS Readings imported! (${matchedRows.length} mapped & saved, ${bmcCodeMissingCount} code missing, ${bmcCodeNotFoundCount} code not found, ${duplicateRowsCount} updated/deduplicated).`,
      import_id: importBatch.id,
      stats: {
        total_excel_rows: readings.length,
        successfully_mapped: matchedRows.length,
        bmc_code_missing: bmcCodeMissingCount,
        bmc_code_not_found: bmcCodeNotFoundCount,
        duplicate_conflicting: duplicateRowsCount,
        worker: workerRowsCount,
        qc: qcRowsCount,
        total_liters: totalLitersSum,
        total_kg: totalKgSum
      },
      unmatched_rows: unmatchedRows
    });
  } catch (err) {
    console.error('❌ MACS Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/qc-agm/macs/delete-all — Delete all imported MACS data
app.delete('/api/qc-agm/macs/delete-all', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  try {
    const { error: rowErr } = await adminClient.from('qc_excel_import_rows').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error: batchErr } = await adminClient.from('qc_excel_imports').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (rowErr) throw rowErr;
    if (batchErr) throw batchErr;
    res.json({ success: true, message: 'All imported MACS data safely deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/qc-agm/macs/delete-date — Delete imported MACS data for a specific date
app.delete('/api/qc-agm/macs/delete-date', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query parameter is required' });

  try {
    const { error } = await adminClient
      .from('qc_excel_import_rows')
      .delete()
      .eq('test_date', date);
    if (error) throw error;
    res.json({ success: true, message: `Imported MACS data for date ${date} deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/qc-agm/macs/readings/:id — Delete single imported MACS reading
app.delete('/api/qc-agm/macs/readings/:id', requireQcAgm, async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;

  try {
    const { error } = await adminClient
      .from('qc_excel_import_rows')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'MACS reading deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/qc-agm/macs/import-batch/:batchId — Delete MACS import batch & all mapped daily rows
async function handleDeleteImportBatch(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization header required.' });

  try {
    const adminClient = req.adminClient || getAdminClient();
    if (!adminClient) return res.status(503).json({ error: 'Database client not available.' });

    const batchId = req.params.batchId || req.params.id;

    // 1. Delete all mapped rows for this import batch
    const { error: rowErr } = await adminClient
      .from('qc_excel_import_rows')
      .delete()
      .eq('import_id', batchId);

    if (rowErr) console.warn('Warning deleting import rows:', rowErr);

    // 2. Delete the import batch header
    const { error: batchErr } = await adminClient
      .from('qc_excel_imports')
      .delete()
      .eq('id', batchId);

    if (batchErr) throw batchErr;

    res.json({ success: true, message: 'MACS Excel batch and all mapped daily records deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.delete('/api/qc-agm/macs/import-batch/:batchId', handleDeleteImportBatch);
app.delete('/api/qc-agm/macs/import/:id', handleDeleteImportBatch);

// GET /api/pi-agm/bmcs/:bmcCode/daily-comparison — Side-by-side MACS vs Spot vs Diary comparison
app.get('/api/pi-agm/bmcs/:bmcCode/daily-comparison', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  const { bmcCode } = req.params;
  const { from_date, to_date, period = 'all' } = req.query;

  try {
    const { data: bmc } = await adminClient
      .from('bmcs')
      .select('id, name, bmc_code, district, location')
      .eq('bmc_code', bmcCode)
      .maybeSingle();

    if (!bmc) {
      return res.status(404).json({ error: `BMC with code '${bmcCode}' not found.` });
    }

    let macsQuery = adminClient
      .from('qc_excel_import_rows')
      .select('*')
      .or(`sample_ref.eq.${bmcCode},bmc_id.eq.${bmc.id}`);

    if (from_date) macsQuery = macsQuery.gte('test_date', from_date);
    if (to_date) macsQuery = macsQuery.lte('test_date', to_date);

    const { data: rows } = await macsQuery;

    const dailyMap = {};

    (rows || []).forEach(r => {
      const d = r.test_date;
      
      let p = (r.overall_result || 'morning').toLowerCase();
      if (p === 'worker' || p === 'qc' || p === 'both') p = 'morning';

      if (period !== 'all' && p !== period.toLowerCase()) return;

      const key = `${d}_${p}`;
      if (!dailyMap[key]) {
        dailyMap[key] = {
          date: d,
          period: p === 'morning' ? 'Morning' : 'Evening',
          macs: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, status: 'pending' },
          spot: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, status: 'pending' },
          diary: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, status: 'pending' }
        };
      }

      const entry = dailyMap[key];

      // Treat ALL rows from qc_excel_import_rows as MACS data.
      // Do not falsely map them to Spot Analyzer or Diary.
      const liters = r.raw_data?.macs_quantity_liters ?? r.raw_data?.liters ?? r.raw_data?.quantity ?? r.liters ?? r.quantity ?? null;
      const kg = r.raw_data?.macs_quantity_kg ?? r.raw_data?.kg ?? (liters ? parseFloat((liters * 1.03).toFixed(2)) : null);

      if (liters !== null && entry.macs.quantity_liters === null) entry.macs.quantity_liters = liters;
      if (kg !== null && entry.macs.quantity_kg === null) entry.macs.quantity_kg = kg;
      
      if (r.fat !== null && r.fat !== undefined) entry.macs.fat = r.fat;
      else if (r.raw_data?.fat !== undefined) entry.macs.fat = r.raw_data.fat;
      
      if (r.snf !== null && r.snf !== undefined) entry.macs.snf = r.snf;
      else if (r.raw_data?.snf !== undefined) entry.macs.snf = r.raw_data.snf;
      
      entry.macs.status = 'completed';
    });

    // Fetch Spot Analyzer (trip_bmc_visits) and Diary (trips)
    let visitsQuery = adminClient
      .from('trip_bmc_visits')
      .select('*, trips(id, out_time, in_time, out_weight, in_weight, status), ftir_tests(*)')
      .eq('status', 'completed');
      
    if (bmc.id) {
      visitsQuery = visitsQuery.eq('bmc_id', bmc.id);
    }
    const { data: visits } = await visitsQuery;

    (visits || []).forEach(v => {
      const d = v.visit_end_time ? new Date(v.visit_end_time).toISOString().split('T')[0] : new Date(v.created_at).toISOString().split('T')[0];
      
      if (from_date && d < from_date) return;
      if (to_date && d > to_date) return;
      
      // Default period to Morning for Spot/Diary visits for now, or detect based on time
      const p = 'morning'; 
      if (period !== 'all' && p !== period.toLowerCase()) return;
      
      const key = `${d}_${p}`;
      if (!dailyMap[key]) {
        dailyMap[key] = {
          date: d,
          period: 'Morning',
          macs: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, status: 'pending' },
          spot: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, status: 'pending' },
          diary: { quantity_liters: null, quantity_kg: null, fat: null, snf: null, status: 'pending' }
        };
      }
      
      const entry = dailyMap[key];
      const ftir = (v.ftir_tests && v.ftir_tests[0]) || {};
      const lit = v.sample_liters || v.milk_quantity_liters || null;
      const kg = lit ? parseFloat((lit * 1.03).toFixed(2)) : null;
      
      entry.spot = {
        liters: lit,
        kg: kg,
        fat: ftir.fat ?? null,
        snf: ftir.snf ?? null,
        status: 'completed'
      };
      
      // Diary data from trip
      const t = v.trips || {};
      const diaryKg = t.in_weight || null;
      const diaryLit = diaryKg ? parseFloat((diaryKg / 1.03).toFixed(2)) : null;
      
      if (t.status === 'completed' && diaryKg) {
        entry.diary = {
          liters: diaryLit,
          kg: diaryKg,
          fat: null, // Diary fat is typically not recorded here, but if available it can be added
          snf: null,
          status: 'completed'
        };
      } else {
        entry.diary = {
          liters: null,
          kg: null,
          fat: null,
          snf: null,
          status: 'pending'
        };
      }
    });

    res.json({ bmc, daily_records: Object.values(dailyMap) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trips/:id — Fetch single trip details for worker & close trip modal
app.get('/api/trips/:id', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;
  try {
    const { data: dt, error } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    let tripObj = null;

    if (dt) {
      tripObj = {
        ...dt,
        out_km: dt.out_km !== null && dt.out_km !== undefined ? dt.out_km : null,
        out_weight: dt.out_weight !== null && dt.out_weight !== undefined ? dt.out_weight : (dt.out_tanker_weight !== null && dt.out_tanker_weight !== undefined ? dt.out_tanker_weight : null),
        out_tanker_weight: dt.out_weight !== null && dt.out_weight !== undefined ? dt.out_weight : (dt.out_tanker_weight !== null && dt.out_tanker_weight !== undefined ? dt.out_tanker_weight : null),
        in_km: dt.in_km !== null && dt.in_km !== undefined ? dt.in_km : null,
        in_weight: dt.in_weight !== null && dt.in_weight !== undefined ? dt.in_weight : null
      };
    } else {
      const { data: t } = await adminClient
        .from('trips')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!t) return res.status(404).json({ error: 'Trip not found.' });
      tripObj = t;
    }

    const { data: visits } = await adminClient
      .from('trip_bmc_visits')
      .select('*, bmc:bmcs(*)')
      .eq('trip_id', id)
      .order('visit_sequence', { ascending: true });

    res.json({ trip: tripObj, visits: visits || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/trips/:id/start-worker — Worker measurement start trip input (transitions status to in_progress)
app.patch('/api/trips/:id/start-worker', requireWorker, async (req, res) => {
  const { adminClient, profile } = req;
  const { id } = req.params;
  const { out_km, out_tanker_weight, out_km_photo, odometer_photo_out, latitude, longitude, start_lat, start_lng } = req.body;

  const photoProof = out_km_photo || odometer_photo_out || null;

  if (out_km === undefined || out_tanker_weight === undefined) {
    return res.status(400).json({ error: 'OUT KM and OUT Tanker Weight are required.' });
  }

  try {
    const startedAt = new Date().toISOString();
    const lat = latitude || start_lat || null;
    const lng = longitude || start_lng || null;

    const updatePayload = {
      status: 'in_progress',
      assigned_driver_id: profile.id,
      out_km: parseFloat(out_km),
      out_weight: parseFloat(out_tanker_weight),
      out_weight_photo: photoProof,
      started_at: startedAt,
      start_lat: lat,
      start_lng: lng
    };

    // Update existing Transport Manager trip in driver_trips
    const { data: dtRecord, error: dtErr } = await adminClient
      .from('driver_trips')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (dtErr) {
      console.error('❌ Error updating driver_trips:', dtErr);
      throw dtErr;
    }

    // Sync metrics and timestamps to trips table (set status to in_progress)
    const tripPayload = {
      id: id,
      status: 'in_progress',
      worker_id: profile.id,
      out_time: startedAt,
      remarks: `OUT KM: ${out_km} | OUT Wt: ${out_tanker_weight} KG`,
      trip_name: dtRecord ? (dtRecord.route || dtRecord.destination || dtRecord.bmc_name || 'Assigned Duty') : 'Worker Trip',
      driver_name: dtRecord ? (dtRecord.driver_name || 'Assigned Driver') : 'Assigned Driver',
      tanker_number: dtRecord ? (dtRecord.vehicle_number || 'Unassigned') : 'Unassigned'
    };

    // Try update first
    let { data: trip, error: updateErr } = await adminClient
      .from('trips')
      .update({
        status: 'in_progress',
        worker_id: profile.id,
        out_time: startedAt,
        remarks: tripPayload.remarks
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (!trip) {
      // If update returns nothing, insert matching record into trips table
      const { data: newTrip, error: insertErr } = await adminClient
        .from('trips')
        .insert([tripPayload])
        .select()
        .single();
      if (insertErr) {
        console.warn('⚠️ Warning: trips table sync insert failed:', insertErr.message);
      }
      trip = newTrip || dtRecord;
    }

    // Now securely generate trip_bmc_visits if there are planned BMCs
    if (dtRecord && dtRecord.selected_bmcs && dtRecord.selected_bmcs.length > 0) {
      const { data: existingVisits } = await adminClient
        .from('trip_bmc_visits')
        .select('id')
        .eq('trip_id', id);
      
      if (!existingVisits || existingVisits.length === 0) {
        const visitsToInsert = dtRecord.selected_bmcs.map((b, idx) => ({
          trip_id: id,
          bmc_id: b.bmc_id,
          visit_sequence: idx + 1,
          status: 'pending',
          compartment: b.compartment || 'Front'
        }));
        try {
          await adminClient.from('trip_bmc_visits').insert(visitsToInsert);
        } catch (vErr) {
          console.warn('⚠️ Warning: trip_bmc_visits insert failed:', vErr.message);
        }
      }
    }

    res.json({ success: true, message: 'Trip started successfully!', trip: dtRecord || trip });
  } catch (err) {
    console.error('❌ start-worker error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trips/:id/start-spot & PATCH /api/trips/:id/start-spot — Spot Analyzer starts trip (transitions duty to In Progress)
const handleStartSpotTrip = async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;

  try {
    const startedAt = new Date().toISOString();

    const { data: dtRecord, error: dtErr } = await adminClient
      .from('driver_trips')
      .update({
        status: 'in_progress',
        updated_at: startedAt
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (dtErr) throw dtErr;

    await adminClient
      .from('trips')
      .update({
        status: 'active',
        out_time: startedAt
      })
      .eq('id', id);

    res.json({ success: true, message: 'Trip status updated to In Progress by Spot Analyzer!', trip: dtRecord });
  } catch (err) {
    console.error('❌ start-spot error:', err);
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/trips/:id/start-spot', handleStartSpotTrip);
app.patch('/api/trips/:id/start-spot', handleStartSpotTrip);

// PATCH /api/trips/:id/complete-worker — Worker measurement complete/end trip input
app.patch('/api/trips/:id/complete-worker', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;
  const { in_km, empty_tanker_weight, in_km_photo, odometer_photo_in, end_lat, end_lng, remarks, in_time, end_time } = req.body;

  if (in_km === undefined || in_km === null || in_km === '') {
    return res.status(400).json({ error: 'IN KM is required to complete trip.' });
  }

  try {
    // Try driver_trips first, fall back to trips table for out_km data
    let existing = null;
    const { data: dtExisting } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    existing = dtExisting;

    if (!existing) {
      const { data: tExisting } = await adminClient
        .from('trips')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      existing = tExisting;
    }

    const outKm = existing?.out_km || 0;
    const outWeight = existing?.out_weight || existing?.out_tanker_weight || 0;
    const inKmNum = parseFloat(in_km);

    if (isNaN(inKmNum) || (outKm > 0 && inKmNum <= outKm)) {
      return res.status(400).json({ error: `IN KM (${inKmNum}) must be greater than OUT KM (${outKm}).` });
    }

    const hasEmptyWeight = empty_tanker_weight !== undefined && empty_tanker_weight !== '' && empty_tanker_weight !== null;
    const emptyWeightNum = hasEmptyWeight ? parseFloat(empty_tanker_weight) : null;

    if (hasEmptyWeight && outWeight > 0 && emptyWeightNum >= outWeight) {
      return res.status(400).json({ error: `IN Empty Weight (${emptyWeightNum} kg) must be less than OUT Tanker Weight (${outWeight} kg).` });
    }

    const calc = calcMileage(outWeight, emptyWeightNum, outKm, inKmNum);

    const completedAt = in_time || end_time || new Date().toISOString();
    const photoIn = in_km_photo || odometer_photo_in || null;

    const updatePayload = {
      status: 'completed',
      in_km: inKmNum,
      in_weight: emptyWeightNum,
      km_travelled: calc.kmTravelled,
      weight_difference: calc.weightDiff,
      diesel_consumption: calc.dieselConsumption,
      average_mileage: calc.averageMileage,
      in_weight_photo: photoIn,
      end_lat: end_lat || null,
      end_lng: end_lng || null,
      completed_at: completedAt,
      remarks: remarks || existing?.remarks
    };

    await adminClient.from('driver_trips').update(updatePayload).eq('id', id);
    await adminClient.from('trips').update({
      status: 'completed',
      in_time: completedAt,
      remarks: remarks || existing?.remarks
    }).eq('id', id);

    res.json({
      success: true,
      message: 'Trip completed successfully!',
      summary: {
        km_travelled: calc.kmTravelled,
        weight_difference: calc.weightDiff,
        diesel_consumption: calc.dieselConsumption,
        mileage: calc.averageMileage
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/worker/trips/:id — Worker trip deletion with exact Route Name verification
app.delete('/api/worker/trips/:id', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;
  const routeName = (req.body.route_name || req.query.route_name || '').trim();

  if (!routeName) {
    return res.status(400).json({ error: 'Please enter the exact Route Name to confirm deletion.' });
  }

  try {
    let tripName = null;

    // Try trips table first
    const { data: trip } = await adminClient
      .from('trips')
      .select('trip_name, route_description')
      .eq('id', id)
      .maybeSingle();

    if (trip) {
      tripName = (trip.trip_name || trip.route_description || '').trim();
    } else {
      // Try driver_trips table
      const { data: dTrip } = await adminClient
        .from('driver_trips')
        .select('route, destination, bmc_name')
        .eq('id', id)
        .maybeSingle();
      
      if (dTrip) {
         tripName = (dTrip.route || dTrip.destination || dTrip.bmc_name || '').trim();
      }
    }

    if (tripName === null) {
      return res.status(404).json({ error: 'Trip not found or unauthorized.' });
    }

    if (tripName.toLowerCase() !== routeName.toLowerCase()) {
      return res.status(400).json({ error: `Route Name "${routeName}" does not match trip route "${tripName}". Deletion cancelled.` });
    }

    const { error: tErr } = await adminClient.from('trips').update({ status: 'deleted' }).eq('id', id);
    if (tErr) {
      await adminClient.from('trips').delete().eq('id', id).catch(() => {});
    }

    const { error: dErr } = await adminClient.from('driver_trips').update({ status: 'deleted' }).eq('id', id);
    if (dErr) {
      await adminClient.from('driver_trips').delete().eq('id', id).catch(() => {});
    }

    res.json({ success: true, message: `Trip "${tripName}" successfully deleted.` });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete trip.' });
  }
});

// PATCH /api/worker/trips/:id — Worker edit existing trip data
app.patch('/api/worker/trips/:id', requireWorker, async (req, res) => {
  const { adminClient } = req;
  const { id } = req.params;
  const { out_km, in_km, out_weight, empty_tanker_weight, remarks, in_time, end_time } = req.body;

  try {
    const { data: trip } = await adminClient
      .from('trips')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    const tripsUpdate = {};
    if (remarks !== undefined) tripsUpdate.remarks = remarks;
    if (in_time || end_time) tripsUpdate.in_time = in_time || end_time;
    if (trip && Object.keys(tripsUpdate).length > 0) {
      await adminClient.from('trips').update(tripsUpdate).eq('id', id);
    }

    const { data: dTrip } = await adminClient
      .from('driver_trips')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!dTrip && !trip) {
      return res.status(404).json({ error: 'Trip not found.' });
    }

    if (dTrip) {
      const dUpdate = {};
      const outKmNum = out_km !== undefined && out_km !== '' && out_km !== null ? parseFloat(out_km) : (dTrip.out_km || 0);
      const inKmNum = in_km !== undefined && in_km !== '' && in_km !== null ? parseFloat(in_km) : (dTrip.in_km || 0);
      const outWNum = out_weight !== undefined && out_weight !== '' && out_weight !== null ? parseFloat(out_weight) : (dTrip.out_weight || dTrip.out_tanker_weight || 0);
      
      const hasInWeight = empty_tanker_weight !== undefined && empty_tanker_weight !== '' && empty_tanker_weight !== null;
      const inWNum = hasInWeight ? parseFloat(empty_tanker_weight) : (empty_tanker_weight === null || empty_tanker_weight === '' ? null : dTrip.in_weight);

      if (out_km !== undefined && out_km !== '') dUpdate.out_km = outKmNum;
      if (in_km !== undefined && in_km !== '') dUpdate.in_km = inKmNum;
      if (out_weight !== undefined && out_weight !== '') {
        dUpdate.out_weight = outWNum;
        dUpdate.out_tanker_weight = outWNum;
      }
      if (empty_tanker_weight !== undefined) dUpdate.in_weight = inWNum;
      if (remarks !== undefined) dUpdate.remarks = remarks;
      if (in_time || end_time) dUpdate.completed_at = in_time || end_time;

      const calc = calcMileage(outWNum, inWNum, outKmNum, inKmNum);

      dUpdate.km_travelled = calc.kmTravelled;
      dUpdate.weight_difference = calc.weightDiff;
      dUpdate.diesel_consumption = calc.dieselConsumption;
      dUpdate.average_mileage = calc.averageMileage;

      await adminClient.from('driver_trips').update(dUpdate).eq('id', id);
    }

    res.json({ success: true, message: 'Trip updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update trip.' });
  }
});

// GET /api/worker/analysis & GET /api/analysis — Field Worker Operational Analytics
async function workerAnalysisHandler(req, res) {
  const { adminClient, profile } = req;
  const workerProfileId = profile?.id;
  const { startDate, endDate } = req.query;

  try {
    let startIso, endIso;
    if (startDate) {
      startIso = new Date(startDate + 'T00:00:00.000Z').toISOString();
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      startIso = d.toISOString();
    }

    if (endDate) {
      endIso = new Date(endDate + 'T23:59:59.999Z').toISOString();
    } else {
      endIso = new Date().toISOString();
    }

    // Query driver_trips for worker duties (isolated per worker)
    let query = adminClient
      .from('driver_trips')
      .select('*')
      .neq('status', 'deleted')
      .neq('status', 'cancelled')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    if (workerProfileId) {
      query = query.eq('assigned_driver_id', workerProfileId);
    }

    const { data: dTrips, error: tripsErr } = await query;

    if (tripsErr) throw tripsErr;

    const tripList = dTrips || [];
    const tripIds = tripList.map(t => t.id);

    let visitList = [];
    if (tripIds.length > 0) {
      const { data: visits } = await adminClient
        .from('trip_bmc_visits')
        .select('*, bmc:bmcs(name, location, district)')
        .in('trip_id', tripIds)
        .order('created_at', { ascending: false });
      visitList = visits || [];
    }

    const verifiedVisits = visitList.filter(v => v.status === 'completed' || v.status === 'visited' || v.visit_end_time);
    const completedTrips = tripList.filter(t => t.status === 'completed');

    let totalWorkMinutes = 0;
    const enrichedTrips = completedTrips.map(t => {
      const startMs = t.started_at ? new Date(t.started_at).getTime() : (t.scheduled_start_time ? new Date(t.scheduled_start_time).getTime() : new Date(t.created_at).getTime());
      const endMs = t.completed_at ? new Date(t.completed_at).getTime() : Date.now();
      const durationMins = Math.max(0, Math.round((endMs - startMs) / (1000 * 60)));

      totalWorkMinutes += durationMins;

      const tripVisits = verifiedVisits.filter(v => v.trip_id === t.id);

      return {
        id: t.id,
        trip_name: t.route || t.destination || t.bmc_name || 'Completed Duty',
        route_description: t.route || t.destination || t.bmc_name || '—',
        driver_name: t.driver_name || '—',
        tanker_number: t.vehicle_number || '—',
        out_time: t.started_at || t.scheduled_start_time || t.created_at,
        in_time: t.completed_at || t.updated_at,
        status: t.status,
        duration_minutes: durationMins,
        work_time_formatted: `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`,
        visits_count: tripVisits.length,
        distance_km: t.km_travelled || (t.in_km && t.out_km && t.in_km >= t.out_km ? t.in_km - t.out_km : '—')
      };
    });

    const hours = Math.floor(totalWorkMinutes / 60);
    const mins = totalWorkMinutes % 60;
    const workTimeFormatted = hours > 0 ? `${hours} hrs ${mins} mins` : `${mins} mins`;

    res.json({
      filter: { startDate, endDate },
      kpis: {
        total_bmcs_visited: verifiedVisits.length,
        total_work_time_minutes: totalWorkMinutes,
        work_time_formatted: workTimeFormatted,
        total_trips: tripList.length,
        completed_trips: completedTrips.length,
        active_trips: tripList.filter(t => t.status === 'active' || t.status === 'in_progress').length
      },
      trips: enrichedTrips,
      visits: verifiedVisits
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch worker analysis.' });
  }
}

app.get('/api/worker/analysis', requireWorker, workerAnalysisHandler);
app.get('/api/analysis', requireWorker, workerAnalysisHandler);

// GET /api/pi-agm/mileage — P&I Mileage Dashboard Endpoint
app.get('/api/pi-agm/mileage', requirePiAgm, async (req, res) => {
  const { adminClient } = req;
  const { status_filter = 'all', from_date, to_date, driver_id = 'all', vehicle_id = 'all', search } = req.query;

  try {
    let query = adminClient
      .from('driver_trips')
      .select('*')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    if (from_date) query = query.gte('created_at', `${from_date}T00:00:00`);
    if (to_date) query = query.lte('created_at', `${to_date}T23:59:59`);

    if (driver_id && driver_id !== 'all') {
      query = query.or(`assigned_driver_id.eq.${driver_id},driver_name.ilike.%${driver_id}%`);
    }
    if (vehicle_id && vehicle_id !== 'all') {
      query = query.or(`assigned_vehicle_id.eq.${vehicle_id},vehicle_number.ilike.%${vehicle_id}%`);
    }

    const { data: trips, error } = await query;
    if (error) throw error;

    let records = [];
    let inTransitTrips = [];
    let doneTrips = [];

    let totalDistSum = 0;
    let totalDieselSum = 0;
    let validMileageCount = 0;
    let sumMileage = 0;

    (trips || []).forEach(t => {
      const isDone = t.status === 'completed';
      const isCancelled = t.status === 'cancelled' || t.status === 'deleted' || (t.assignment_status && t.assignment_status === 'deleted');
      if (isCancelled) return;

      const normStatus = isDone ? 'done' : 'in_transit';

      // Status filter check
      if (status_filter !== 'all' && status_filter.toLowerCase() !== normStatus) {
        return;
      }

      // Search term filter check
      if (search) {
        const q = search.toLowerCase();
        const matchVehicle = (t.vehicle_number || '').toLowerCase().includes(q);
        const matchDriver = (t.driver_name || t.bmc_name || '').toLowerCase().includes(q);
        const matchTripNum = (t.trip_number || t.id || '').toLowerCase().includes(q);
        if (!matchVehicle && !matchDriver && !matchTripNum) return;
      }

      if (isDone) {
        const outW = t.out_weight !== null && t.out_weight !== undefined ? t.out_weight : t.out_tanker_weight;
        const calc = calcMileage(outW, t.in_weight, t.out_km, t.in_km);
        
        const dist = (calc.kmTravelled > 0 || (t.in_km !== null && t.out_km !== null)) ? calc.kmTravelled : (t.km_travelled !== null && t.km_travelled !== undefined ? Number(t.km_travelled) : null);
        const milkWeight = calc.weightDiff;
        const diesel = calc.dieselConsumption;
        const mileage = calc.averageMileage;

        if (dist !== null) totalDistSum += Number(dist);
        if (diesel !== null) totalDieselSum += Number(diesel);
        if (mileage !== null) { validMileageCount++; sumMileage += Number(mileage); }

        const rec = {
          id: t.id,
          date: t.completed_at ? t.completed_at.split('T')[0] : (t.created_at ? t.created_at.split('T')[0] : '—'),
          trip_number: t.trip_number || t.id.substring(0, 8),
          vehicle_number: t.vehicle_number || 'N/A',
          driver_name: t.driver_name || 'Driver',
          route: t.route || t.destination || 'Milk Route',
          out_km: t.out_km !== null ? t.out_km : 'Pending',
          out_weight: t.out_weight !== null ? `${t.out_weight} KG` : 'Pending',
          in_km: t.in_km !== null ? t.in_km : 'Pending',
          empty_weight: t.in_weight !== null ? `${t.in_weight} KG` : 'Pending',
          distance_km: dist !== null ? dist : 'Pending',
          total_milk_weight_kg: milkWeight !== null ? `${milkWeight} KG` : 'Pending',
          diesel_litres: diesel !== null ? diesel : 'Pending',
          mileage_kml: mileage !== null ? mileage : 'Pending',
          status: 'Done',
          completed_at: t.completed_at || t.updated_at
        };

        doneTrips.push(rec);
        records.push(rec);
      } else {
        // In Transit Trip
        const rec = {
          id: t.id,
          date: t.started_at ? t.started_at.split('T')[0] : (t.created_at ? t.created_at.split('T')[0] : '—'),
          trip_number: t.trip_number || t.id.substring(0, 8),
          vehicle_number: t.vehicle_number || 'N/A',
          driver_name: t.driver_name || 'Driver',
          route: t.route || t.destination || 'Milk Route',
          out_km: t.out_km !== null ? t.out_km : 'Pending',
          out_weight: t.out_weight !== null ? `${t.out_weight} KG` : 'Pending',
          in_km: 'Pending',
          empty_weight: 'Pending',
          distance_km: 'Pending',
          total_milk_weight_kg: 'Pending',
          diesel_litres: 'Pending',
          mileage_kml: 'Pending',
          status: 'In Transit',
          started_at: t.started_at || t.created_at
        };

        inTransitTrips.push(rec);
        records.push(rec);
      }
    });

    const avgMileage = validMileageCount > 0 ? parseFloat((sumMileage / validMileageCount).toFixed(2)) : 0;

    res.json({
      summary: {
        total_trips: records.length,
        in_transit_count: inTransitTrips.length,
        done_count: doneTrips.length,
        total_distance_km: parseFloat(totalDistSum.toFixed(2)),
        total_diesel_litres: parseFloat(totalDieselSum.toFixed(2)),
        average_mileage_kml: avgMileage
      },
      records: records,
      in_transit_trips: inTransitTrips,
      done_trips: doneTrips
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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


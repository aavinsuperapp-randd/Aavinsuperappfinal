// gm-api.js — API Helper for P&I AGM Portal

async function gmFetch(endpoint, options = {}) {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase configuration missing.');

  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('No active session. Please log in.');

  const token = session.access_token;

  const baseUrl = endpoint.startsWith('http') ? '' : (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com');
  const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Server returned non-JSON response (${res.status}). Ensure backend is active at ${baseUrl || 'https://aavin-backend.onrender.com'}`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// Fetch GM Dashboard Data (Fixed Last 7 Days - Legacy)
async function apiGetGmDashboard() {
  return gmFetch('/api/gm/dashboard');
}

// Fetch Comprehensive GM Dashboard V2 (Single Date or Date Range)
async function apiGetGmDashboardV2(param = '') {
  let query = '';
  if (typeof param === 'string' && param) {
    query = `?date=${encodeURIComponent(param)}`;
  } else if (typeof param === 'object' && param) {
    if (param.startDate && param.endDate) {
      query = `?startDate=${encodeURIComponent(param.startDate)}&endDate=${encodeURIComponent(param.endDate)}`;
    } else if (param.date) {
      query = `?date=${encodeURIComponent(param.date)}`;
    }
  }
  return gmFetch(`/api/gm/dashboard-v2${query}`);
}

// Create BMC via P&I AGM Portal
async function apiGmCreateBmc(data) {
  return gmFetch('/api/gm/create-bmc', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// Update BMC via P&I AGM Portal
async function apiGmUpdateBmc(id, data) {
  return gmFetch(`/api/gm/bmcs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

// Fetch P&I AGM Operational Analysis Data
async function apiGetGmAnalysis({ type = 'vehicle', entityId = '', startDate = '', endDate = '' } = {}) {
  const queryParams = new URLSearchParams();
  if (type) queryParams.set('type', type);
  if (entityId) queryParams.set('entityId', entityId);
  if (startDate) queryParams.set('startDate', startDate);
  if (endDate) queryParams.set('endDate', endDate);
  return gmFetch(`/api/gm/analysis?${queryParams.toString()}`);
}

// Fetch BMC Requirements
async function apiGetGmRequirements({ bmcId = '', status = 'all', search = '' } = {}) {
  const queryParams = new URLSearchParams();
  if (bmcId) queryParams.set('bmcId', bmcId);
  if (status) queryParams.set('status', status);
  if (search) queryParams.set('search', search);
  return gmFetch(`/api/gm/requirements?${queryParams.toString()}`);
}

// Complete BMC Requirement
async function apiCompleteGmRequirement(id) {
  return gmFetch(`/api/gm/requirements/${id}/complete`, { method: 'PATCH' });
}

// Fetch BMC Issues
async function apiGetGmIssues({ bmcId = '', status = 'all', category = '', severity = '', search = '' } = {}) {
  const queryParams = new URLSearchParams();
  if (bmcId) queryParams.set('bmcId', bmcId);
  if (status) queryParams.set('status', status);
  if (category) queryParams.set('category', category);
  if (severity) queryParams.set('severity', severity);
  if (search) queryParams.set('search', search);
  return gmFetch(`/api/gm/issues?${queryParams.toString()}`);
}

// Complete BMC Issue
async function apiCompleteGmIssue(id) {
  return gmFetch(`/api/gm/issues/${id}/complete`, { method: 'PATCH' });
}

// Prioritize BMC Issue
async function apiPrioritizeGmIssue(id, username = '') {
  return gmFetch(`/api/gm/issues/${id}/prioritize`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
}

// Fetch List of BMCs
async function apiGetGmBmcs() {
  return gmFetch('/api/gm/bmcs');
}

// Fetch Single BMC Profile
async function apiGetGmBmcProfile(bmcId) {
  return gmFetch(`/api/gm/bmcs/${bmcId}/profile`);
}

// ── P&I AGM WORKFLOW APIs ─────────────────────────────────────────────────────

// Fetch all Transport Manager-created trips with assignment status
async function apiGetGmPendingTrips() {
  return gmFetch('/api/gm/pending-trips');
}

// Fetch available approved Field Workers for the assignment modal
async function apiGetGmAvailableWorkers() {
  return gmFetch('/api/gm/available-workers');
}

// Assign a Field Worker to a Transport Manager trip (P&I AGM action)
async function apiAssignWorkerToTrip(tripId, workerId) {
  return gmFetch(`/api/gm/trips/${tripId}/assign-worker`, {
    method: 'POST',
    body: JSON.stringify({ worker_id: workerId })
  });
}

// Transport Officer: create a P&I workflow trip via gmFetch (uses same token mechanism)
async function apiCreateTransportTrip(data) {
  return gmFetch('/api/transport/create-trip', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// ── GM EXECUTIVE DELETE APIs ──────────────────────────────────────────────────
async function apiGmDeleteBmc(id) {
  try {
    return await gmFetch(`/api/gm/bmcs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (apiErr) {
    console.warn('[apiGmDeleteBmc] Backend API delete failed, using direct Supabase fallback:', apiErr);
    const client = await initSupabase();
    if (!client) throw new Error('Supabase client uninitialized.');

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      await client.from('bmc_silos').delete().eq('bmc_id', id);
      await client.from('eo_bmc_assignments').delete().eq('bmc_id', id);
    }
    const { error } = isUuid
      ? await client.from('bmcs').delete().eq('id', id)
      : await client.from('bmcs').delete().eq('bmc_code', id);
    if (error) throw error;
    return { success: true };
  }
}

async function apiGmDeleteTrip(tripId) {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase client uninitialized.');
  await client.from('trip_bmc_visits').delete().eq('trip_id', tripId);
  await client.from('trips').delete().eq('id', tripId); // Delete from trips as well!
  const { error } = await client.from('driver_trips').delete().eq('id', tripId);
  if (error) throw error;
  return { success: true };
}

async function apiGmDeleteIssue(issueId) {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase client uninitialized.');
  const { error } = await client.from('issues').delete().eq('id', issueId);
  if (error) throw error;
  return { success: true };
}

async function apiGmDeleteVehicle(vehicleId) {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase client uninitialized.');
  const { error } = await client.from('tankers').delete().eq('id', vehicleId);
  if (error) throw error;
  return { success: true };
}

// ── Sidebar Toggle (shared across all P&I AGM portal pages) ──────────────────
function initGmSidebarToggle() {
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.querySelector('.admin-sidebar');
  const main = document.querySelector('.admin-main');
  const overlay = document.getElementById('sidebar-overlay');

  function toggleSidebar() {
    if (window.innerWidth > 900) {
      if (sidebar) sidebar.classList.toggle('collapsed');
      if (main) main.classList.toggle('expanded');
    } else {
      if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
      } else {
        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
      }
    }
  }

  function closeSidebar() {
    if (window.innerWidth <= 900) {
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('show');
    }
  }

  if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  if (sidebar) {
    sidebar.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeSidebar);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGmSidebarToggle);
} else {
  initGmSidebarToggle();
}

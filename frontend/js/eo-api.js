// gm-api.js — API Helper for P&I AGM Portal / GM Portal

async function getGmAuthToken() {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase configuration missing.');
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('No active session. Please log in.');
  return session.access_token;
}

async function eoFetch(endpoint, options = {}) {
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
  return eoFetch('/api/gm/dashboard');
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
  return eoFetch(`/api/gm/dashboard-v2${query}`);
}

// Create BMC via P&I AGM Portal
async function apiGmCreateBmc(data) {
  return eoFetch('/api/gm/create-bmc', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// Update BMC via P&I AGM Portal
async function apiGmUpdateBmc(id, data) {
  return eoFetch(`/api/gm/bmcs/${id}`, {
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
  return eoFetch(`/api/gm/analysis?${queryParams.toString()}`);
}

// Fetch BMC Requirements
async function apiGetGmRequirements({ bmcId = '', status = 'all', search = '' } = {}) {
  const queryParams = new URLSearchParams();
  if (bmcId) queryParams.set('bmcId', bmcId);
  if (status) queryParams.set('status', status);
  if (search) queryParams.set('search', search);
  return eoFetch(`/api/gm/requirements?${queryParams.toString()}`);
}

// Complete BMC Requirement
async function apiCompleteGmRequirement(id) {
  return eoFetch(`/api/gm/requirements/${id}/complete`, { method: 'PATCH' });
}

// Fetch BMC Issues
async function apiGetGmIssues({ bmcId = '', status = 'all', category = '', severity = '', search = '' } = {}) {
  const queryParams = new URLSearchParams();
  if (bmcId) queryParams.set('bmcId', bmcId);
  if (status) queryParams.set('status', status);
  if (category) queryParams.set('category', category);
  if (severity) queryParams.set('severity', severity);
  if (search) queryParams.set('search', search);
  return eoFetch(`/api/gm/issues?${queryParams.toString()}`);
}

// Complete BMC Issue
async function apiCompleteGmIssue(id) {
  return eoFetch(`/api/gm/issues/${id}/complete`, { method: 'PATCH' });
}

// Prioritize BMC Issue
async function apiPrioritizeGmIssue(id, username = '') {
  return eoFetch(`/api/gm/issues/${id}/prioritize`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
}

// Fetch List of BMCs
async function apiGetGmBmcs() {
  return eoFetch('/api/gm/bmcs');
}

// Fetch Single BMC Profile
async function apiGetGmBmcProfile(bmcId) {
  return eoFetch(`/api/gm/bmcs/${bmcId}/profile`);
}

// ── P&I AGM WORKFLOW APIs ─────────────────────────────────────────────────────

// Fetch all Transport Manager-created trips with assignment status
async function apiGetGmPendingTrips() {
  return eoFetch('/api/gm/pending-trips');
}

// Fetch available approved Field Workers for the assignment modal
async function apiGetGmAvailableWorkers() {
  return eoFetch('/api/gm/available-workers');
}

// Assign a Field Worker to a Transport Manager trip (P&I AGM action)
async function apiAssignWorkerToTrip(tripId, workerId) {
  return eoFetch(`/api/gm/trips/${tripId}/assign-worker`, {
    method: 'POST',
    body: JSON.stringify({ worker_id: workerId })
  });
}

// Transport Officer: create a P&I workflow trip via eoFetch (uses same token mechanism)
async function apiCreateTransportTrip(data) {
  return eoFetch('/api/transport/create-trip', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// ── GM EXECUTIVE DELETE APIs ──────────────────────────────────────────────────
async function apiGmDeleteBmc(id) {
  try {
    return await eoFetch(`/api/gm/bmcs/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
  const token = await getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}/api/gm/trips/${tripId}`, {
    method: 'DELETE',
    headers
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Failed to delete trip (${res.status})`);
  }
  return data;
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

// ── Sidebar Toggle (shared across all GM and P&I AGM portal pages) ──────────────────
function initGmSidebarToggle() {
  const toggleBtns = document.querySelectorAll('#sidebar-toggle-btn, .sidebar-toggle, #qc-agm-toggle-btn, .qc-mobile-btn');
  const sidebar = document.querySelector('.admin-sidebar, .qc-sidebar, #eo-sidebar, #worker-sidebar, #transport-sidebar');
  const main = document.querySelector('.admin-main, .qc-main, .worker-main, .transport-main');
  const overlay = document.querySelector('#sidebar-overlay, #qc-aeo-sidebar-overlay, .sidebar-overlay, .qc-sidebar-overlay');

  function toggleSidebar(e) {
    if (e) e.stopPropagation();
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

  toggleBtns.forEach(btn => {
    btn.removeEventListener('click', toggleSidebar);
    btn.addEventListener('click', toggleSidebar);
  });

  if (overlay) {
    overlay.removeEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);
  }

  if (sidebar) {
    sidebar.querySelectorAll('a, button').forEach(link => {
      link.addEventListener('click', closeSidebar);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGmSidebarToggle);
} else {
  initGmSidebarToggle();
}

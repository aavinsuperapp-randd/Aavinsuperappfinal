// gm-api.js — API Helper for General Manager Portal

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

// Fetch Comprehensive GM Dashboard V2 (Single Date)
async function apiGetGmDashboardV2(dateStr = '') {
  const query = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
  return gmFetch(`/api/gm/dashboard-v2${query}`);
}

// Create BMC via GM Portal
async function apiGmCreateBmc(data) {
  return gmFetch('/api/gm/create-bmc', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// Fetch GM Operational Analysis Data
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

// Fetch List of BMCs
async function apiGetGmBmcs() {
  return gmFetch('/api/gm/bmcs');
}

// Fetch Single BMC Profile
async function apiGetGmBmcProfile(bmcId) {
  return gmFetch(`/api/gm/bmcs/${bmcId}/profile`);
}

// Auto-initialize mobile sidebar toggle
function initGmSidebarToggle() {
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.querySelector('.admin-sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
  }
  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }

  if (toggleBtn) toggleBtn.addEventListener('click', openSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  // Close on nav link click (mobile)
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

// qc-worker-api.js — API Helper for QC Worker Dashboard

async function qcWorkerFetch(path, options = {}) {
  const client = await initSupabase();
  if (!client) throw new Error('Supabase configuration missing.');

  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('No active session. Please log in.');

  const token = session.access_token;
  const baseUrl = path.startsWith('http') ? '' : (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://aavin-backend.onrender.com');
  const fullUrl = path.startsWith('http') ? path : `${baseUrl}${path}`;

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
    throw new Error(`Server returned non-JSON response (${res.status}). Ensure backend is active.`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// APIs
async function apiQcGetProfile() {
  return qcWorkerFetch('/api/qc-worker/profile');
}
async function apiQcGetDashboardStats(date = '') {
  const url = date ? `/api/qc-worker/dashboard-stats?date=${date}` : '/api/qc-worker/dashboard-stats';
  return qcWorkerFetch(url);
}
async function apiQcWorkerGetDashboardTrips(startDate = '', endDate = '') {
  const url = `/api/qc-worker/dashboard-trips?startDate=${startDate}&endDate=${endDate}`;
  return qcWorkerFetch(url);
}
async function apiQcWorkerGetDashboardBmcs(startDate = '', endDate = '') {
  const url = `/api/qc-worker/dashboard-bmcs?startDate=${startDate}&endDate=${endDate}`;
  return qcWorkerFetch(url);
}
async function apiQcWorkerGetMacsDates() {
  return qcWorkerFetch('/api/qc-worker/macs/dates');
}
async function apiQcWorkerGetMacsReadings(date = '') {
  const url = date ? `/api/qc-worker/macs/readings?date=${encodeURIComponent(date)}` : '/api/qc-worker/macs/readings';
  return qcWorkerFetch(url);
}
async function apiQcWorkerGetBmcs() {
  return qcWorkerFetch('/api/qc-worker/bmcs');
}
async function apiQcWorkerGetDashboard(date = '', period = 'both') {
  const url = `/api/qc-worker/dashboard?date=${encodeURIComponent(date)}&period=${encodeURIComponent(period)}`;
  return qcWorkerFetch(url);
}
async function apiQcGetSamples(date = '') {
  const url = date ? `/api/qc-worker/samples?date=${date}` : '/api/qc-worker/samples';
  return qcWorkerFetch(url);
}
async function apiQcGetSampleDetail(visitId) {
  return qcWorkerFetch(`/api/qc-worker/samples/${visitId}`);
}
async function apiQcSaveTest(body) {
  return qcWorkerFetch('/api/qc-worker/tests', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}
async function apiQcSubmitTest(testId) {
  return qcWorkerFetch(`/api/qc-worker/tests/${testId}/submit`, {
    method: 'POST'
  });
}
async function apiQcGetHistory() {
  return qcWorkerFetch('/api/qc-worker/history');
}
async function apiQcWorkerGetReports() {
  return qcWorkerFetch('/api/qc-worker/reports-testing');
}
async function apiQcWorkerMarkReportDone(id, remarks) {
  return qcWorkerFetch(`/api/qc-worker/reports-testing/${id}/done`, {
    method: 'PATCH',
    body: JSON.stringify({ remarks })
  });
}

// Sidebar toggle for QC Worker shell
function initQcSidebarToggle() {
  const toggleBtn = document.getElementById('qc-mobile-toggle-btn');
  const sidebar = document.getElementById('qc-sidebar');
  const overlay = document.getElementById('qc-sidebar-overlay');

  function toggleSidebar() {
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('show');
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }

  if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQcSidebarToggle);
} else {
  initQcSidebarToggle();
}

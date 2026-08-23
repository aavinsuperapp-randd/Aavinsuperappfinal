// qc-agm-api.js — API Helper for QC AGM Dashboard

async function qcAgmFetch(path, options = {}) {
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
async function apiQcAgmGetProfile() {
  return qcAgmFetch('/api/qc-agm/profile');
}
async function apiQcAgmGetDashboard() {
  return qcAgmFetch('/api/qc-agm/dashboard');
}
async function apiQcAgmGetAllTests() {
  return qcAgmFetch('/api/qc-agm/tests');
}
async function apiQcAgmGetTestDetail(id) {
  return qcAgmFetch(`/api/qc-agm/tests/${id}`);
}
async function apiQcAgmReviewTest(id, action, remarks) {
  return qcAgmFetch(`/api/qc-agm/tests/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ action, remarks })
  });
}
async function apiQcAgmGetBmcs() {
  return qcAgmFetch('/api/qc-agm/bmcs');
}
async function apiQcAgmGetBmcTests(bmcId) {
  return qcAgmFetch(`/api/qc-agm/bmcs/${bmcId}/tests`);
}
async function apiQcAgmImportExcel(fileName, rows, notes) {
  return qcAgmFetch('/api/qc-agm/import/excel', {
    method: 'POST',
    body: JSON.stringify({ file_name: fileName, rows, notes })
  });
}
async function apiQcAgmGetImports() {
  return qcAgmFetch('/api/qc-agm/imports');
}
async function apiQcAgmGetImportDetail(id) {
  return qcAgmFetch(`/api/qc-agm/imports/${id}`);
}
async function apiQcAgmGetExcelData() {
  return qcAgmFetch('/api/qc-agm/excel-data');
}

// Sidebar toggle for QC AGM portal
function initQcAgmSidebarToggle() {
  const toggleBtn = document.getElementById('qc-agm-toggle-btn');
  const sidebar = document.getElementById('qc-agm-sidebar');
  const overlay = document.getElementById('qc-agm-sidebar-overlay');

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
  document.addEventListener('DOMContentLoaded', initQcAgmSidebarToggle);
} else {
  initQcAgmSidebarToggle();
}

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
async function apiQcWorkerGetMacsReadings(date = '', period = 'both') {
  let url = `/api/qc-worker/macs/readings?period=${encodeURIComponent(period)}`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
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

// Sidebar toggle for QC Worker shell
function initQcSidebarToggle() {
  const toggleBtns = document.querySelectorAll('#qc-mobile-toggle-btn, .qc-mobile-btn, #sidebar-toggle-btn, .sidebar-toggle');
  const sidebar = document.getElementById('qc-sidebar') || document.querySelector('.qc-sidebar');
  let overlay = document.getElementById('qc-sidebar-overlay') || document.querySelector('.qc-sidebar-overlay');

  if (!sidebar) return;

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'qc-sidebar-overlay';
    overlay.id = 'qc-sidebar-overlay';
    document.body.appendChild(overlay);
  }

  function handleQcWorkerToggle(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const isTabletOrMobile = window.innerWidth <= 1024;
    if (isTabletOrMobile) {
      const isOpen = sidebar.classList.contains('open') || sidebar.classList.contains('active');
      if (isOpen) {
        closeQcWorkerSidebar();
      } else {
        sidebar.classList.add('open', 'active');
        overlay.classList.add('show', 'active');
        document.body.classList.add('sidebar-open');
      }
    } else {
      sidebar.classList.toggle('collapsed');
      const main = document.querySelector('.qc-main');
      if (main) main.classList.toggle('expanded');
    }
  }

  function closeQcWorkerSidebar() {
    sidebar.classList.remove('open', 'active');
    overlay.classList.remove('show', 'active');
    document.body.classList.remove('sidebar-open');
  }

  if (!overlay.dataset.bound) {
    overlay.dataset.bound = 'true';
    overlay.addEventListener('click', closeQcWorkerSidebar);
  }

  toggleBtns.forEach(btn => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = 'true';
      btn.addEventListener('click', handleQcWorkerToggle);
    }
  });

  sidebar.querySelectorAll('a, button').forEach(link => {
    if (!link.dataset.closeBound) {
      link.dataset.closeBound = 'true';
      link.addEventListener('click', () => {
        if (window.innerWidth <= 1024) closeQcWorkerSidebar();
      });
    }
  });

  if (!window.qcWorkerResizeBound) {
    window.qcWorkerResizeBound = true;
    window.addEventListener('resize', () => {
      if (window.innerWidth > 1024) closeQcWorkerSidebar();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && window.innerWidth <= 1024) closeQcWorkerSidebar();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQcSidebarToggle);
} else {
  initQcSidebarToggle();
}


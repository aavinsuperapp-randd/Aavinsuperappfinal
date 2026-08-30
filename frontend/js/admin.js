// admin.js - Admin Dashboard and Verification Actions

async function adminFetch(endpoint, options = {}) {
  const client = await initSupabase();
  let token = '';
  if (client) {
    const { data: { session } } = await client.auth.getSession();
    if (session) token = session.access_token;
  }

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

// ── Admin Mobile Sidebar Toggle ──────────────────────────────────────────────
function initAdminSidebarToggle() {
  const toggleBtns = document.querySelectorAll('#sidebar-toggle-btn, .sidebar-toggle');
  const sidebar = document.querySelector('.admin-sidebar');
  const main = document.querySelector('.admin-main');

  if (!sidebar) return;

  let overlay = document.querySelector('.sidebar-overlay, #sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  function toggleSidebar(e) {
    if (e) e.stopPropagation();
    if (window.innerWidth > 900) {
      if (sidebar) sidebar.classList.toggle('collapsed');
      if (main) main.classList.toggle('expanded');
    } else {
      if (sidebar.classList.contains('open') || sidebar.classList.contains('active')) {
        sidebar.classList.remove('open', 'active');
        if (overlay) overlay.classList.remove('show', 'active');
      } else {
        sidebar.classList.add('open', 'active');
        if (overlay) overlay.classList.add('show', 'active');
      }
    }
  }

  function closeSidebar() {
    if (window.innerWidth <= 900) {
      if (sidebar) sidebar.classList.remove('open', 'active');
      if (overlay) overlay.classList.remove('show', 'active');
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
window.initAdminSidebarToggle = initAdminSidebarToggle;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminSidebarToggle);
} else {
  initAdminSidebarToggle();
}
document.addEventListener('DOMContentLoaded', async () => {

  // 1. Enforce admin auth check
  const profile = await checkAuth('admin');
  
  if (profile) {
    const mainContent = document.getElementById('main-admin-content');
    if (mainContent) mainContent.classList.remove('hidden');
    
    // Bind sidebar active states
    const path = window.location.pathname;
    const navItems = document.querySelectorAll('.admin-nav-item');
    navItems.forEach(item => {
      if (path.includes(item.getAttribute('href'))) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Handle Mobile sidebar toggle
    initAdminSidebarToggle();



    // Load registrations if on verification page
    if (path.includes('verification.html')) {
      setupVerificationPage();
      await loadUserRegistrations('pending');
    }

    // Initialize Website Data Reset module if present on page
    setupWebsiteDataReset();
  }

  // Attach logout handler
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleLogout();
    });
  }
});

let currentUserFilter = 'pending';
let allProfilesCache = [];

function setupVerificationPage() {


  const tabPending = document.getElementById('user-tab-pending');
  const tabAll = document.getElementById('user-tab-all');
  const tabApproved = document.getElementById('user-tab-approved');

  function setTab(activeTab, filter) {
    [tabPending, tabAll, tabApproved].forEach(t => {
      if (t) {
        t.classList.remove('active', 'btn-primary');
        t.classList.add('btn-outline');
      }
    });
    if (activeTab) {
      activeTab.classList.add('active', 'btn-primary');
      activeTab.classList.remove('btn-outline');
    }
    currentUserFilter = filter;
    renderUserRegistrations();
  }

  if (tabPending) tabPending.addEventListener('click', () => setTab(tabPending, 'pending'));
  if (tabAll) tabAll.addEventListener('click', () => setTab(tabAll, 'all'));
  if (tabApproved) tabApproved.addEventListener('click', () => setTab(tabApproved, 'approved'));
}

async function loadUserRegistrations(filter) {
  if (filter) currentUserFilter = filter;
  const container = document.getElementById('pending-list-container');
  if (!container) return;

  try {
    const data = await adminFetch('/api/admin/users');
    allProfilesCache = data.users || [];
    renderUserRegistrations();
  } catch (err) {
    console.error("❌ Failed to fetch user registrations:", err);
    container.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Failed to load registration data (${err.message}).</td></tr>`;
  }
}

function renderUserRegistrations() {
  const container = document.getElementById('pending-list-container');
  if (!container) return;

  let filtered = allProfilesCache;
  if (currentUserFilter === 'pending') {
    filtered = allProfilesCache.filter(u => u.status === 'pending');
  } else if (currentUserFilter === 'approved') {
    filtered = allProfilesCache.filter(u => u.status === 'approved');
  }

  if (filtered.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No users found for this category.</td></tr>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(user => {
    const row = document.createElement('tr');
    
    const roleBadge = user.role === 'admin' ? '<span class="badge badge-purple">Admin</span>' :
                      user.role === 'pi_agm' ? '<span class="badge badge-primary">P&I AGM</span>' :
                      user.role === 'gm' ? '<span class="badge badge-primary">General Manager</span>' :
                      user.role === 'transport_officer' ? '<span class="badge badge-info">Transport Manager</span>' :
                      user.role === 'executive_officer' ? '<span class="badge badge-secondary">Executive Officer</span>' :
                      user.role === 'driver' ? '<span class="badge badge-warning">Driver</span>' :
                      '<span class="badge badge-neutral">Field Worker</span>';

    const statusBadge = user.status === 'approved' ? '<span class="badge badge-success">Approved</span>' :
                        user.status === 'rejected' ? '<span class="badge badge-danger">Rejected</span>' :
                        '<span class="badge badge-warning">Pending Approval</span>';

    const dobFormatted = user.dob ? new Date(user.dob).toLocaleDateString('en-IN') : 'N/A';
    const regDate = user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN') : 'N/A';

    row.innerHTML = `
      <td>
        <div class="user-cell">
          <div class="user-avatar-sm">${user.name ? user.name.charAt(0).toUpperCase() : 'U'}</div>
          <div>
            <div class="user-name-bold">${user.name || 'Unnamed User'}</div>
            <div class="user-email-sub">${user.email}</div>
          </div>
        </div>
      </td>
      <td>${roleBadge}</td>
      <td>${dobFormatted}</td>
      <td>${regDate}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="d-flex gap-1">
          ${user.status !== 'approved' ? `<button class="btn btn-success btn-sm" onclick="processApproval('${user.id}', 'approved')">Approve</button>` : ''}
          ${user.status !== 'rejected' ? `<button class="btn btn-danger btn-sm" onclick="processApproval('${user.id}', 'rejected')">Reject</button>` : ''}
          <button class="btn btn-outline btn-sm text-danger" onclick="deleteUser('${user.id}')" title="Delete User">🗑️</button>
        </div>
      </td>
    `;
    container.appendChild(row);
  });
}

async function processApproval(userId, newStatus) {
  try {
    const client = await initSupabase();
    if (!client) throw new Error('Database not connected.');
    const { error } = await client.from('profiles').update({ status: newStatus, updated_at: new Date() }).eq('id', userId);
    if (error) throw error;
    showToast(`User ${newStatus} successfully!`, "success");
    await loadUserRegistrations();
  } catch (err) {
    showToast(err.message || "Action failed.", "error");
  }
}

window.deleteUser = async function(userId) {
  if (!confirm('Are you sure you want to delete this user profile?')) return;
  try {
    await adminFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    showToast('User profile deleted!', 'success');
    await loadUserRegistrations();
  } catch (err) {
    showToast(err.message || 'Failed to delete user.', 'error');
  }
};



// ─── WEBSITE DATA RESET CONTROLLER ───────────────────────────────────────────
let activeResetScope = 'all';

function setupWebsiteDataReset() {
  const masterResetBtn = document.getElementById('btn-master-reset');
  const categoryResetBtns = document.querySelectorAll('.btn-category-reset');
  const modal = document.getElementById('reset-confirm-modal');
  const closeBtn = document.getElementById('reset-modal-close-btn');
  const cancelBtn = document.getElementById('reset-modal-cancel-btn');
  const executeBtn = document.getElementById('reset-modal-execute-btn');
  const confirmInput = document.getElementById('reset-confirm-input');

  if (!modal) return;

  const scopeTitles = {
    all: { title: 'Master Website Data Reset', desc: 'Resets ALL dynamic operational data across Excel imports, Duty records, MACS readings, Spot analyzer data, and Diary quality test logs. Master BMCs, Tankers, and User profiles will be preserved.' },
    excel: { title: 'Reset Excel Import Data', desc: 'Resets all imported Excel spreadsheets and parsed rows (`qc_excel_imports`, `qc_excel_import_rows`). Master BMCs, Tankers, and User profiles will be preserved.' },
    duty: { title: 'Reset Duty & Field Trip Data', desc: 'Resets all driver duty logs and worker field trips (`driver_trips`, `trips`). Master BMCs, Tankers, and User profiles will be preserved.' },
    macs: { title: 'Reset MACS Readings Data', desc: 'Resets all MACS instrument readings and batch imports (`macs_readings`, `macs_import_batches`). Master BMCs, Tankers, and User profiles will be preserved.' },
    spot: { title: 'Reset Spot Analyzer Data', desc: 'Resets all daily spot analyzer measurements (`bmc_daily_records`). Master BMCs, Tankers, and User profiles will be preserved.' },
    diary: { title: 'Reset Diary / Quality Test Data', desc: 'Resets all FTIR tests, Gerber tests, quality reviews, & visit logs (`qc_lab_tests`, `trip_bmc_visits`, etc.). Master BMCs, Tankers, and User profiles will be preserved.' }
  };

  const openModal = (scope = 'all') => {
    activeResetScope = scope;
    const meta = scopeTitles[scope] || scopeTitles.all;
    
    const modalTitle = document.getElementById('reset-modal-title');
    const summaryTitle = document.getElementById('reset-modal-summary-title');
    const summaryDesc = document.getElementById('reset-modal-summary-desc');

    if (modalTitle) modalTitle.textContent = `⚠️ Confirm ${meta.title}`;
    if (summaryTitle) summaryTitle.textContent = `Are you sure you want to proceed with: ${meta.title}?`;
    if (summaryDesc) summaryDesc.textContent = meta.desc;

    if (confirmInput) {
      confirmInput.value = '';
    }
    if (executeBtn) {
      executeBtn.disabled = true;
    }
    modal.classList.remove('hidden');
    if (confirmInput) confirmInput.focus();
  };

  const closeModal = () => {
    modal.classList.add('hidden');
  };

  if (masterResetBtn) {
    masterResetBtn.addEventListener('click', () => openModal('all'));
  }

  categoryResetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const scope = btn.getAttribute('data-scope');
      openModal(scope);
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (confirmInput) {
    confirmInput.addEventListener('input', (e) => {
      const val = (e.target.value || '').trim().toUpperCase();
      if (executeBtn) {
        executeBtn.disabled = (val !== 'RESET');
      }
    });
  }

  if (executeBtn) {
    executeBtn.addEventListener('click', async () => {
      if (confirmInput && confirmInput.value.trim().toUpperCase() !== 'RESET') {
        showToast('Please type RESET to authorize this action.', 'error');
        return;
      }

      executeBtn.disabled = true;
      executeBtn.innerHTML = '⏳ Resetting Data...';

      try {
        const result = await adminFetch('/api/admin/website-data-reset', {
          method: 'POST',
          body: JSON.stringify({ scope: activeResetScope })
        });

        showToast(result.message || 'Website data reset completed successfully!', 'success');
        closeModal();
      } catch (err) {
        console.error('Website reset error:', err);
        showToast(err.message || 'Failed to reset website data.', 'error');
      } finally {
        executeBtn.disabled = false;
        executeBtn.innerHTML = '🗑️ Confirm & Delete Data';
      }
    });
  }
}


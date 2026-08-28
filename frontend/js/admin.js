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
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const navEl = document.querySelector('.admin-nav');
    if (toggleBtn && navEl) {
      toggleBtn.addEventListener('click', () => {
        navEl.classList.toggle('show');
      });
    }

    // Load Executive Officers if on executive-officers page
    if (path.includes('executive-officers.html')) {
      await setupExecutiveOfficersPage();
    }

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
                      user.role === 'driver' ? '<span class="badge badge-warning">Driver</span>' :
                      user.role === 'executive_officer' ? '<span class="badge badge-secondary">Executive Officer</span>' :
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

// ─── EXECUTIVE OFFICERS PAGE LOGIC ────────────────────────────────────────────
let eoCache = [];
let allBmcsCache = [];

async function setupExecutiveOfficersPage() {
  await loadExecutiveOfficersData();

  const modal = document.getElementById('assign-bmc-modal');
  const btnOpen = document.getElementById('btn-open-assign-modal');
  const btnClose = document.getElementById('close-assign-modal');
  const btnCancel = document.getElementById('cancel-assign-modal');
  const form = document.getElementById('assign-bmc-form');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      populateAssignModalOptions();
      if (modal) modal.classList.remove('hidden');
    });
  }

  const eoSelect = document.getElementById('modal-select-eo');
  if (eoSelect) {
    eoSelect.addEventListener('change', (e) => {
      populateAssignModalOptions(e.target.value);
    });
  }

  const closeModal = () => { if (modal) modal.classList.add('hidden'); };
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const eoId = document.getElementById('modal-select-eo').value;
      const selectedChips = document.querySelectorAll('#modal-bmc-chips-container .bmc-chip.selected');
      const bmcIds = Array.from(selectedChips).map(chip => chip.getAttribute('data-id'));

      if (!eoId) {
        showToast('Please select an Executive Officer.', 'error');
        return;
      }

      try {
        await adminFetch(`/api/admin/executive-officers/${eoId}/bmcs`, {
          method: 'POST',
          body: JSON.stringify({ bmc_ids: bmcIds })
        });
        showToast('BMC assignments updated successfully!', 'success');
        closeModal();
        await loadExecutiveOfficersData();
      } catch (err) {
        showToast(err.message || 'Failed to update BMC assignments.', 'error');
      }
    });
  }
}

async function loadExecutiveOfficersData() {
  const container = document.getElementById('eo-cards-container');
  try {
    const [eoData, bmcData] = await Promise.all([
      adminFetch('/api/admin/executive-officers'),
      adminFetch('/api/admin/bmcs').catch(() => adminFetch('/api/transport/bmcs-list'))
    ]);

    eoCache = eoData.executive_officers || [];
    allBmcsCache = bmcData.bmcs || [];

    // Stats
    const totalEo = eoCache.length;
    const activeEo = eoCache.filter(e => e.status === 'approved').length;
    let totalAssigned = 0;
    eoCache.forEach(e => totalAssigned += (e.assigned_bmc_count || 0));

    if (document.getElementById('stat-total-eo')) document.getElementById('stat-total-eo').textContent = totalEo;
    if (document.getElementById('stat-assigned-bmcs')) document.getElementById('stat-assigned-bmcs').textContent = totalAssigned;
    if (document.getElementById('stat-active-eo')) document.getElementById('stat-active-eo').textContent = activeEo;

    renderExecutiveOfficerCards();
  } catch (err) {
    console.error('Failed to load Executive Officers:', err);
    if (container) {
      container.innerHTML = `<div class="text-danger p-4">Failed to load Executive Officers (${err.message}).</div>`;
    }
  }
}

function renderExecutiveOfficerCards() {
  const container = document.getElementById('eo-cards-container');
  if (!container) return;

  if (eoCache.length === 0) {
    container.innerHTML = `
      <div class="card p-4 text-center text-muted" style="grid-column: 1 / -1;">
        <h4>No Executive Officers Found</h4>
        <p class="text-sm mt-1">There are currently no users registered with the Executive Officer role.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  eoCache.forEach(eo => {
    const card = document.createElement('div');
    card.className = 'eo-card';

    const bmcTagsHtml = (eo.assigned_bmcs || []).map(bmc => `
      <span class="bmc-tag">
        🏭 ${bmc.name} (${bmc.district || 'BMC'})
        <span class="remove-btn" title="Unassign BMC" onclick="unassignBmcFromEo('${eo.id}', '${bmc.id}', '${bmc.name}')">✕</span>
      </span>
    `).join('');

    card.innerHTML = `
      <div>
        <div class="eo-card-header">
          <div>
            <div class="eo-name">👔 ${eo.name || 'Executive Officer'}</div>
            <div class="eo-email">📧 ${eo.email}</div>
          </div>
          <span class="badge ${eo.status === 'approved' ? 'badge-success' : 'badge-warning'}">
            ${eo.status === 'approved' ? 'Active' : 'Pending'}
          </span>
        </div>

        <div style="font-size: 0.8rem; font-weight: 700; color: #64748B; margin-top: 10px;">
          ASSIGNED BMCS (${eo.assigned_bmc_count || 0})
        </div>

        <div class="eo-bmc-tags">
          ${bmcTagsHtml || '<div class="empty-bmc-text">No BMCs assigned yet. Click below to assign.</div>'}
        </div>
      </div>

      <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #F1F5F9; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.75rem; color: #94A3B8;">Phone: ${eo.phone}</span>
        <button class="btn btn-outline btn-sm" style="font-size: 0.78rem;" onclick="openAssignForSpecificEo('${eo.id}')">
          ✏️ Edit Assignments
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function populateAssignModalOptions(selectedEoId = '') {
  const eoSelect = document.getElementById('modal-select-eo');
  const bmcContainer = document.getElementById('modal-bmc-chips-container');

  if (eoSelect) {
    eoSelect.innerHTML = '<option value="">-- Choose Officer --</option>' +
      eoCache.map(e => `<option value="${e.id}" ${e.id === selectedEoId ? 'selected' : ''}>${e.name} (${e.email})</option>`).join('');
    eoSelect.value = selectedEoId;
  }

  if (bmcContainer) {
    const selectedEo = eoCache.find(e => e.id === selectedEoId);
    const assignedBmcIds = selectedEo ? (selectedEo.assigned_bmcs || []).map(b => b.id) : [];

    if (allBmcsCache.length === 0) {
      bmcContainer.innerHTML = '<div class="text-sm text-muted p-2">No BMCs available.</div>';
    } else {
      bmcContainer.innerHTML = allBmcsCache.map(b => {
        const isSelected = assignedBmcIds.includes(b.id);
        return `
          <div class="bmc-chip ${isSelected ? 'selected' : ''}" data-id="${b.id}" onclick="this.classList.toggle('selected')">
            <span style="font-weight: 700;">${b.name}</span>
            <span style="font-size: 0.75rem; color: inherit; opacity: 0.8;">${b.location || b.district || 'BMC'}</span>
          </div>
        `;
      }).join('');
    }
  }
}

window.openAssignForSpecificEo = function(eoId) {
  populateAssignModalOptions(eoId);
  const modal = document.getElementById('assign-bmc-modal');
  if (modal) modal.classList.remove('hidden');
};

window.unassignBmcFromEo = async function(eoId, bmcId, bmcName) {
  if (!confirm(`Are you sure you want to unassign BMC '${bmcName}' from this Executive Officer?`)) return;
  try {
    await adminFetch(`/api/admin/executive-officers/${eoId}/bmcs/${bmcId}`, { method: 'DELETE' });
    showToast(`BMC '${bmcName}' unassigned successfully.`, 'success');
    await loadExecutiveOfficersData();
  } catch (err) {
    showToast(err.message || 'Failed to remove BMC assignment.', 'error');
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


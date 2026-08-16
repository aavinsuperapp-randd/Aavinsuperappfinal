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

    // Load registrations if on verification page
    if (path.includes('verification.html')) {
      setupVerificationPage();
      await loadUserRegistrations('pending');
    }
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
  const purgeBtn = document.getElementById('purge-users-btn');
  if (purgeBtn) {
    purgeBtn.addEventListener('click', async () => {
      if (!confirm('⚠️ ARE YOU SURE?\nThis will permanently DELETE ALL registered non-admin users (Workers & GMs) from the system.')) return;
      try {
        await adminFetch('/api/admin/users/all', { method: 'DELETE' });
        showToast('All non-admin users removed successfully!', 'success');
        await loadUserRegistrations(currentUserFilter);
      } catch (err) {
        showToast(err.message || 'Failed to remove users.', 'error');
      }
    });
  }

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
    renderRegistrations();
  }

  if (tabPending) tabPending.addEventListener('click', () => setTab(tabPending, 'pending'));
  if (tabAll) tabAll.addEventListener('click', () => setTab(tabAll, 'all'));
  if (tabApproved) tabApproved.addEventListener('click', () => setTab(tabApproved, 'approved'));
}

async function loadUserRegistrations() {
  const container = document.getElementById('pending-list-container');
  if (!container) return;
  
  container.innerHTML = `
    <tr>
      <td colspan="6" class="text-center">
        <div class="spinner" style="margin: 20px auto;"></div>
      </td>
    </tr>
  `;
  
  try {
    const res = await adminFetch('/api/admin/users');
    allProfilesCache = res.users || [];
    renderRegistrations();
  } catch (err) {
    console.error("❌ Failed to query profiles:", err);
    showToast(err.message || "Failed to load verification list.", "error");
    container.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted">Error loading users from database.</td>
      </tr>
    `;
  }
}

function renderRegistrations() {
  const container = document.getElementById('pending-list-container');
  if (!container) return;

  let filtered = [...allProfilesCache];
  if (currentUserFilter === 'pending') {
    filtered = filtered.filter(p => p.status === 'pending');
  } else if (currentUserFilter === 'approved') {
    filtered = filtered.filter(p => p.status === 'approved');
  }
  
  if (!filtered || filtered.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">No user records found</div>
            <div class="empty-state-desc">No accounts found matching filter '${currentUserFilter.toUpperCase()}'.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  container.innerHTML = '';
  filtered.forEach(p => {
    const row = document.createElement('tr');
    
    const regDate = new Date(p.created_at || new Date()).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    
    const avatarImg = p.profile_image_url 
      ? `<img src="${p.profile_image_url}" alt="${p.name}" class="avatar avatar-sm">`
      : `<div class="avatar avatar-sm" style="display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--gray-500);">${p.name ? p.name.charAt(0) : 'U'}</div>`;
      
    const statusClass = p.status === 'approved' ? 'badge-success' : (p.status === 'rejected' ? 'badge-danger' : 'badge-pending');

    row.innerHTML = `
      <td>
        <div class="user-info-cell">
          ${avatarImg}
          <div class="user-details">
            <span class="user-name">${p.name || 'Anonymous User'}</span>
            <span class="user-email">${p.email}</span>
          </div>
        </div>
      </td>
      <td><span class="badge badge-neutral">${(p.role || 'user').toUpperCase()}</span></td>
      <td>${p.dob ? new Date(p.dob).toLocaleDateString('en-IN') : 'N/A'}</td>
      <td>${regDate}</td>
      <td><span class="badge ${statusClass}">${(p.status || 'pending').toUpperCase()}</span></td>
      <td>
        <div class="actions-cell" style="display:flex; gap:6px;">
          ${p.status !== 'approved' ? `<button class="btn btn-primary btn-sm" onclick="processApproval('${p.id}', 'approved')">Accept</button>` : ''}
          ${p.status !== 'rejected' ? `<button class="btn btn-outline btn-sm" onclick="processApproval('${p.id}', 'rejected')">Reject</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteUser('${p.id}')">🗑️</button>
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

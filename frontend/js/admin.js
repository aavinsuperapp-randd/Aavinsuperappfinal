// admin.js - Admin Dashboard and Verification Actions

async function adminFetch(endpoint, options = {}) {
  const client = await initSupabase();
  let token = '';
  if (client) {
    const { data: { session } } = await client.auth.getSession();
    if (session) token = session.access_token;
  }

  const baseUrl = (window.location.port === '5000' || window.location.origin.endsWith(':5000'))
    ? ''
    : 'http://localhost:5000';

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
    throw new Error(`Server returned non-JSON response (${res.status}). Ensure backend is running on http://localhost:5000`);
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

    // Load pending registrations if on the verification page
    if (path.includes('verification.html')) {
      await loadPendingRegistrations();
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

// Load pending user profiles
async function loadPendingRegistrations() {
  const container = document.getElementById('pending-list-container');
  if (!container) return;
  
  container.innerHTML = `
    <tr>
      <td colspan="6" class="text-center">
        <div class="spinner" style="margin: 20px auto;"></div>
      </td>
    </tr>
  `;
  
  const client = await initSupabase();
  
  // A. Guard check
  if (!client) {
    showToast("Supabase is not initialized.", "error");
    container.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted">Database configuration is missing.</td>
      </tr>
    `;
    return;
  }
  
  // B. Query Supabase
  try {
    const { data: profiles, error } = await client
      .from('profiles')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    renderRegistrations(profiles);
  } catch (err) {
    console.error("❌ Failed to query profiles:", err);
    showToast("Failed to load verification list.", "error");
    container.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted">Error querying registrations database.</td>
      </tr>
    `;
  }
}

// Render profiles lists to table
function renderRegistrations(list) {
  const container = document.getElementById('pending-list-container');
  if (!container) return;
  
  if (!list || list.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">No pending approvals</div>
            <div class="empty-state-desc">All user registrations have been verified and processed.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  container.innerHTML = '';
  list.forEach(p => {
    const row = document.createElement('tr');
    
    // Format Date
    const regDate = new Date(p.created_at || new Date()).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    
    const avatarImg = p.profile_image_url 
      ? `<img src="${p.profile_image_url}" alt="${p.name}" class="avatar avatar-sm">`
      : `<div class="avatar avatar-sm" style="display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--gray-500);">${p.name.charAt(0)}</div>`;
      
    row.innerHTML = `
      <td>
        <div class="user-info-cell">
          ${avatarImg}
          <div class="user-details">
            <span class="user-name">${p.name}</span>
            <span class="user-email">${p.email}</span>
          </div>
        </div>
      </td>
      <td><span class="badge badge-pending">${p.role}</span></td>
      <td>${p.dob ? new Date(p.dob).toLocaleDateString('en-IN') : 'N/A'}</td>
      <td>${regDate}</td>
      <td><span class="badge badge-pending">Pending</span></td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-primary btn-sm" onclick="processApproval('${p.id}', 'approved')">Accept</button>
          <button class="btn btn-danger btn-sm" onclick="processApproval('${p.id}', 'rejected')">Reject</button>
        </div>
      </td>
    `;
    
    container.appendChild(row);
  });
}

// Process Approve / Reject Actions
async function processApproval(userId, newStatus) {
  toggleLoading(true);
  const client = await initSupabase();
  
  // A. Guard check
  if (!client) {
    showToast("Supabase is not initialized.", "error");
    toggleLoading(false);
    return;
  }
  
  // B. Supabase Profile Update
  try {
    const { error } = await client
      .from('profiles')
      .update({ status: newStatus, updated_at: new Date() })
      .eq('id', userId);
      
    if (error) throw error;
    
    showToast(`User registration ${newStatus} successfully!`, "success");
    await loadPendingRegistrations();
  } catch (err) {
    console.error("❌ Failed processing registration action:", err);
    showToast(err.message || "Action failed.", "error");
  } finally {
    toggleLoading(false);
  }
}

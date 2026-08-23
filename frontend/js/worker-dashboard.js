// worker-dashboard.js — Field Worker Dashboard Logic
// BMC creation and independent trip creation are REMOVED.
// Workers now receive trips assigned by the P&I AGM.

document.addEventListener('DOMContentLoaded', async () => {
  // Enforce worker role auth
  const profile = await checkAuth('user');
  if (!profile) return;

  const mainArea = document.getElementById('main-content-area');
  if (mainArea) mainArea.classList.remove('hidden');

  document.getElementById('header-worker-name').textContent = profile.name;
  document.getElementById('welcome-name').textContent = profile.name;

  setupMobileMenu();
  setupSearchModal();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Assigned trips refresh button
  const refreshBtn = document.getElementById('refresh-assigned-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadAssignedTrips);

  // Nav scroll anchor
  const navAssigned = document.getElementById('nav-assigned-trips');
  if (navAssigned) {
    navAssigned.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('assigned-trips-section')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  await loadDashboardData();
  await loadAssignedTrips();
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('worker-sidebar') || document.querySelector('.worker-sidebar');
  const main = document.querySelector('.worker-main');
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

async function loadDashboardData() {
  try {
    // 1. Fetch Stats (total/completed trips for this worker)
    const stats = await apiGetStats();
    if (document.getElementById('stat-total-trips'))
      document.getElementById('stat-total-trips').textContent = stats.total_trips || 0;
    if (document.getElementById('stat-completed-trips'))
      document.getElementById('stat-completed-trips').textContent = stats.completed_trips || 0;

    // 2. Fetch Active Trip (for the active trip banner)
    const activeTripData = await apiGetActiveTrip();
    renderActiveTrip(activeTripData.trip, activeTripData.visits);

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Error loading dashboard data', 'error');
  }
}

// ── Assigned Trips (P&I AGM assigned TO trips) ────────────────────────────────

async function loadAssignedTrips() {
  const container = document.getElementById('assigned-trips-container');
  const badge = document.getElementById('assigned-count-badge');
  const statEl = document.getElementById('stat-assigned-trips');

  if (container) {
    container.innerHTML = `
      <div class="no-trips-info">
        <div class="no-trips-icon">🔄</div>
        <p>Loading your assigned trips...</p>
      </div>
    `;
  }

  try {
    const { trips = [] } = await apiGetAssignedTrips();

    if (badge) badge.textContent = trips.length;
    if (statEl) statEl.textContent = trips.length;

    renderAssignedTrips(trips, container);
  } catch (err) {
    console.error('Failed to load assigned trips:', err);
    if (container) {
      container.innerHTML = `
        <div class="no-trips-info" style="border-color:#FCA5A5;">
          <div class="no-trips-icon">⚠️</div>
          <p style="color:#EF4444;">Failed to load assigned trips: ${esc(err.message)}</p>
        </div>
      `;
    }
  }
}

function renderAssignedTrips(trips, container) {
  if (!container) return;

  if (trips.length === 0) {
    container.innerHTML = `
      <div class="no-trips-info">
        <div class="no-trips-icon">🚛</div>
        <p><strong>No trips assigned yet.</strong><br>
        The P&amp;I AGM will assign trips to you. Please check back later or contact your supervisor.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = trips.map(t => {
    const statusPill = `<span class="assign-status-pill ${t.assignment_status || 'worker_assigned'}">${formatAssignStatusWorker(t.assignment_status)}</span>`;
    const dateStr = t.assigned_at
      ? new Date(t.assigned_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : (t.created_at ? new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');

    const tripUrl = `trip.html?id=${t.id}`;
    const isActive = t.status === 'active';
    const visitsText = t.visits_total > 0
      ? `${t.visits_completed}/${t.visits_total} BMCs done`
      : 'No BMC visits yet';

    return `
      <div class="assigned-trip-card">
        <div class="assigned-trip-card-header">
          <div>
            <div class="assigned-trip-card-title">🚛 ${esc(t.trip_name)}</div>
            <div class="assigned-trip-card-id">${t.trip_number || t.id.slice(0, 8).toUpperCase()}</div>
          </div>
          <div>${statusPill}</div>
        </div>
        <div class="assigned-trip-meta">
          <span>🚗 Driver: <strong>${esc(t.driver_name || '—')}</strong></span>
          <span>🚛 Vehicle: <strong>${esc(t.tanker_number || '—')}</strong></span>
          <span>📅 Assigned: <strong>${dateStr}</strong></span>
          <span>👮 Assigned by: <strong>P&amp;I AGM</strong></span>
          ${t.bmc ? `<span>🏭 Primary BMC: <strong>${esc(t.bmc.name)}</strong></span>` : ''}
          ${t.route_description && t.route_description !== '—' ? `<span>📍 Route: <strong>${esc(t.route_description)}</strong></span>` : ''}
          <span>📊 Progress: <strong>${visitsText}</strong></span>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          ${isActive
            ? `<a href="${tripUrl}" class="btn-open-trip">Open Trip →</a>`
            : t.status === 'completed'
              ? `<a href="${tripUrl}" class="btn-open-trip" style="background:linear-gradient(135deg,#10B981,#059669);">View Completed Trip</a>`
              : `<a href="${tripUrl}" class="btn-open-trip">Open Trip →</a>`
          }
          ${t.transport_officer_name ? `<span style="font-size:0.75rem;color:#94A3B8;">📋 Created by: ${esc(t.transport_officer_name)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function formatAssignStatusWorker(status) {
  const map = {
    pending_assignment: 'Pending',
    worker_assigned: 'Assigned to You',
    in_progress: 'In Progress',
    testing_completed: 'Testing Done',
    report_submitted: 'Report Submitted',
    completed: 'Completed'
  };
  return map[status] || (status || 'Assigned');
}

// ── Active Trip Banner (for legacy or currently active trips) ────────────────

function renderActiveTrip(trip, visits = []) {
  const container = document.getElementById('active-trip-container');
  if (!container) return;

  if (!trip) {
    container.innerHTML = `
      <div class="form-section text-center" style="padding: 24px 20px;">
        <div style="font-size: 1.8rem; margin-bottom: 8px;">🚚</div>
        <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--gray-800); margin-bottom: 4px;">No Active Trip</h3>
        <p style="font-size: .84rem; color: var(--gray-500);">Open an assigned trip below to begin field operations.</p>
      </div>
    `;
    return;
  }

  const completedVisits = visits.filter(v => v.status === 'completed').length;
  const totalVisits = visits.length;
  const progressPct = totalVisits > 0 ? Math.round((completedVisits / totalVisits) * 100) : 0;
  const driverName = trip.driver_name || (trip.driver ? trip.driver.name : 'Unassigned');
  const tankerBoard = trip.tanker_number || (trip.tanker ? trip.tanker.board_number : 'N/A');
  const startTimeStr = new Date(trip.out_time).toLocaleString();

  container.innerHTML = `
    <div class="active-trip-banner">
      <div class="atb-header">
        <div class="atb-title">
          <span>🟢 ACTIVE TRIP:</span> ${esc(trip.trip_name)} (${esc(trip.trip_number || '')})
        </div>
        <a href="trip.html?id=${trip.id}" class="btn btn-primary btn-sm">
          Continue Trip →
        </a>
      </div>
      <div class="atb-meta">
        <div class="atb-meta-item">Driver: <strong>${esc(driverName)}</strong></div>
        <div class="atb-meta-item">Tanker: <strong>${esc(tankerBoard)}</strong></div>
        <div class="atb-meta-item">Out Time: <strong>${esc(startTimeStr)}</strong></div>
      </div>
      <div class="trip-progress">
        <div class="trip-progress-bar">
          <div class="trip-progress-fill" style="width: ${progressPct}%;"></div>
        </div>
        <div class="trip-progress-text">
          ${completedVisits} / ${totalVisits} BMCs Completed (${progressPct}%)
        </div>
      </div>
    </div>
  `;
}

// ── BMC Search Modal (read-only search) ───────────────────────────────────────

function setupSearchModal() {
  const searchBtn = document.getElementById('qa-search-bmc');
  // Try new IDs first, then fall back to old IDs
  const modal = document.getElementById('bmc-search-modal') || document.getElementById('modal-bmc');
  const closeBtn = document.getElementById('bmc-search-close') || document.getElementById('modal-bmc-close');
  const cancelBtn = document.getElementById('bmc-search-cancel');
  const input = document.getElementById('bmc-search-input') || document.getElementById('modal-bmc-input');
  const resultsDiv = document.getElementById('bmc-search-results') || document.getElementById('modal-bmc-results');

  if (!searchBtn || !modal) return;

  searchBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    if (input) input.focus();
    performSearch('');
  });

  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  let debounceTimer;
  if (input) {
    input.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => performSearch(e.target.value), 300);
    });
  }

  async function performSearch(q) {
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Searching...</div></div>';
    try {
      const res = await apiSearchBmcs(q);
      const list = res.bmcs || [];
      if (list.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">No BMCs found matching your query.</div></div>';
        return;
      }
      resultsDiv.innerHTML = list.map(b => `
        <div class="search-result-item">
          <div class="search-result-img">
            ${b.profile_image_url ? `<img src="${esc(b.profile_image_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" alt="${esc(b.name)}">` : '🏭'}
          </div>
          <div style="flex:1;">
            <div class="search-result-name">${esc(b.name)}</div>
            <div class="search-result-meta">📍 ${esc(b.location)}, ${esc(b.district)} | 📞 ${esc(b.contact_number)}</div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      resultsDiv.innerHTML = `<div class="empty-state"><div class="empty-state-desc">Error: ${esc(err.message)}</div></div>`;
    }
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

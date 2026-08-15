// worker-dashboard.js — Main Worker Dashboard Logic

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

  await loadDashboardData();
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('worker-sidebar') || document.querySelector('.worker-sidebar');
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

  if (sidebar) {
    sidebar.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeSidebar);
    });
  }
}

async function loadDashboardData() {
  try {
    // 1. Fetch Stats
    const stats = await apiGetStats();
    document.getElementById('stat-total-trips').textContent = stats.total_trips || 0;
    document.getElementById('stat-completed-trips').textContent = stats.completed_trips || 0;
    document.getElementById('stat-active-trips').textContent = stats.active_trips || 0;
    document.getElementById('stat-total-visits').textContent = stats.completed_bmc_visits || 0;

    // 2. Fetch Active Trip
    const activeTripData = await apiGetActiveTrip();
    renderActiveTrip(activeTripData.trip, activeTripData.visits);

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    showToast(err.message || 'Error loading dashboard data', 'error');
  }
}

function renderActiveTrip(trip, visits = []) {
  const container = document.getElementById('active-trip-container');
  const startTripBtn = document.getElementById('qa-start-trip');

  if (!trip) {
    if (startTripBtn) startTripBtn.style.opacity = '1';
    container.innerHTML = `
      <div class="form-section text-center" style="padding: 28px;">
        <div style="font-size: 2rem; margin-bottom: 8px;">🚚</div>
        <h3 style="font-size: 1rem; font-weight: 700; color: var(--gray-800); margin-bottom: 4px;">No Active Trip</h3>
        <p style="font-size: .84rem; color: var(--gray-500); margin-bottom: 16px;">You are currently not on a trip. Create a new trip to start visiting Bulk Milk Coolers.</p>
        <a href="trip-create.html" class="btn btn-primary">
          <span>+</span> Start New Trip
        </a>
      </div>
    `;
    return;
  }

  // Active Trip exists
  if (startTripBtn) {
    startTripBtn.href = '#';
    startTripBtn.onclick = (e) => {
      e.preventDefault();
      showToast('You already have an active trip. Complete it first.', 'warning');
    };
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

function setupSearchModal() {
  const searchBtn = document.getElementById('qa-search-bmc');
  const modal = document.getElementById('bmc-search-modal');
  const closeBtn = document.getElementById('modal-bmc-close');
  const input = document.getElementById('modal-bmc-input');
  const resultsDiv = document.getElementById('modal-bmc-results');

  if (!searchBtn || !modal) return;

  searchBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    input.focus();
    performSearch('');
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  let debounceTimer;
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      performSearch(e.target.value);
    }, 300);
  });

  async function performSearch(q) {
    resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Searching...</div></div>';
    try {
      const res = await apiSearchBmcs(q);
      const list = res.bmcs || [];
      if (list.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-state-desc">No BMCs found matching your query.</div></div>';
        return;
      }
      resultsDiv.innerHTML = list.map(b => `
        <div class="search-result-item" onclick="viewBmcDetail('${b.name}', '${b.district}', '${b.location}', '${b.contact_number}')">
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

window.viewBmcDetail = function(name, district, location, contact) {
  alert(`BMC Details:\n\nName: ${name}\nDistrict: ${district}\nLocation: ${location}\nContact: ${contact}`);
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

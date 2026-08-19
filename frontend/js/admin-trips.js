// admin-trips.js — Admin Trips Management (View Details & Delete Trips)

let allTripsCache = [];
let activeModalTripId = null;

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
    throw new Error(`Server returned non-JSON response (${res.status}).`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('admin');
  if (!profile) return;

  const mainContent = document.getElementById('main-admin-content');
  if (mainContent) mainContent.classList.remove('hidden');

  setupTripDetailModal();
  setupFilterHandlers();
  await loadAdminTrips();

  // Attach logout handler
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleLogout();
    });
  }
});

async function loadAdminTrips() {
  const tbody = document.getElementById('trips-table-body');
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4"><div class="spinner" style="margin:auto;"></div></td></tr>`;

  try {
    const res = await adminFetch('/api/admin/trips');
    allTripsCache = res.trips || [];
    renderKPIs();
    renderTripsTable();
  } catch (err) {
    console.error('Error loading admin trips:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to load trips.', 'error');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Failed to load trips data.</td></tr>`;
  }
}

function renderKPIs() {
  const total = allTripsCache.length;
  const active = allTripsCache.filter(t => t.status === 'active').length;
  const completed = allTripsCache.filter(t => t.status === 'completed').length;
  
  let totalMilkKg = 0;
  allTripsCache.forEach(t => {
    (t.visits || []).forEach(v => {
      if (v.milk_quantity_liters) totalMilkKg += Number(v.milk_quantity_liters);
    });
  });

  document.getElementById('stat-total-trips').textContent = total;
  document.getElementById('stat-active-trips').textContent = active;
  document.getElementById('stat-completed-trips').textContent = completed;
  document.getElementById('stat-total-milk').textContent = `${Math.round(totalMilkKg).toLocaleString()} kg`;
}

function renderTripsTable() {
  const tbody = document.getElementById('trips-table-body');
  if (!tbody) return;

  const search = (document.getElementById('trip-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('trip-filter-status')?.value || 'all';

  let filtered = [...allTripsCache];

  if (statusFilter !== 'all') {
    filtered = filtered.filter(t => (t.status || 'pending').toLowerCase() === statusFilter.toLowerCase());
  }

  if (search) {
    filtered = filtered.filter(t =>
      (t.trip_name || '').toLowerCase().includes(search) ||
      (t.worker_name || '').toLowerCase().includes(search) ||
      (t.driver_name || '').toLowerCase().includes(search) ||
      (t.tanker_number || '').toLowerCase().includes(search) ||
      (t.route || '').toLowerCase().includes(search)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No trips found matching filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const statusClass = (t.status || 'pending').toLowerCase();
    const shortId = t.id ? t.id.slice(0, 8) : 'TRIP';

    return `
      <tr onclick="openTripDetailModal('${t.id}')">
        <td><strong>${esc(t.trip_name)}</strong><div class="text-xs text-muted">ID: ${shortId}</div></td>
        <td>${esc(t.worker_name)}</td>
        <td>${esc(t.driver_name || '—')} <div class="text-xs text-muted">${esc(t.tanker_number || '—')}</div></td>
        <td><span class="text-sm" title="${esc(t.route)}">${esc(t.route || 'No BMCs yet')}</span></td>
        <td>${formatTime(t.out_time)}</td>
        <td>${t.in_time ? formatTime(t.in_time) : '—'}</td>
        <td><span class="status-badge ${statusClass}">${t.status || 'Pending'}</span></td>
        <td>
          <div class="d-flex gap-1" style="gap:4px;">
            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); openTripDetailModal('${t.id}')" title="View Trip Details">
              🔍 Details
            </button>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteTrip('${t.id}')" title="Delete Trip">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function setupFilterHandlers() {
  const searchInput = document.getElementById('trip-search');
  const statusSelect = document.getElementById('trip-filter-status');
  const purgeBtn = document.getElementById('purge-trips-btn');

  if (searchInput) searchInput.addEventListener('input', renderTripsTable);
  if (statusSelect) statusSelect.addEventListener('change', renderTripsTable);

  if (purgeBtn) {
    purgeBtn.addEventListener('click', async () => {
      if (!confirm('⚠️ ARE YOU SURE?\nThis will permanently DELETE ALL trip records from the system.')) return;
      try {
        await adminFetch('/api/admin/trips/all', { method: 'DELETE' });
        showToast('All trip records deleted successfully!', 'success');
        await loadAdminTrips();
      } catch (err) {
        showToast(err.message || 'Failed to delete trips.', 'error');
      }
    });
  }
}

function setupTripDetailModal() {
  const modal = document.getElementById('trip-detail-modal');
  const closeBtn = document.getElementById('trip-modal-close');
  const dismissBtn = document.getElementById('trip-modal-dismiss-btn');
  const deleteBtn = document.getElementById('modal-delete-trip-btn');

  function closeModal() {
    if (modal) modal.classList.add('hidden');
    activeModalTripId = null;
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (activeModalTripId) {
        await deleteTrip(activeModalTripId);
        closeModal();
      }
    });
  }
}

window.openTripDetailModal = function(tripId) {
  const trip = allTripsCache.find(t => t.id === tripId);
  if (!trip) return;

  const modal = document.getElementById('trip-detail-modal');
  if (!modal) return;

  document.getElementById('modal-trip-name').textContent = trip.trip_name;
  document.getElementById('modal-trip-meta').textContent = `Status: ${(trip.status || 'Pending').toUpperCase()} | Created: ${new Date(trip.created_at).toLocaleString()}`;
  document.getElementById('modal-worker-name').textContent = trip.worker_name;
  document.getElementById('modal-driver-vehicle').textContent = `${trip.driver_name || 'Driver'} (${trip.tanker_number || 'Tanker'})`;
  document.getElementById('modal-out-time').textContent = formatTime(trip.out_time);
  document.getElementById('modal-in-time').textContent = trip.in_time ? formatTime(trip.in_time) : 'Active In-Transit';

  const vBody = document.getElementById('modal-visits-body');
  if (vBody) {
    const visits = trip.visits || [];
    if (visits.length === 0) {
      vBody.innerHTML = `<tr><td colspan="5" class="text-muted text-center" style="padding:20px;">No BMC visits recorded for this trip yet.</td></tr>`;
    } else {
      vBody.innerHTML = visits.map(v => {
        const displayFtir = v.ftir_result ? v.ftir_result.replace(/\s*\[FAIL\]/gi, '').replace(/\s*\[PASS\]/gi, '') : '';
        const displayGerber = v.gerber_result ? v.gerber_result.replace(/\s*\[FAIL\]/gi, '').replace(/\s*\[PASS\]/gi, '') : '';

        return `
          <tr>
            <td><strong>${v.visit_sequence || '—'}</strong></td>
            <td><strong>${esc(v.bmc_name)}</strong></td>
            <td>${esc(v.milk_quantity_formatted || (v.milk_quantity_liters ? `${v.milk_quantity_liters} kg` : '—'))}</td>
            <td><span>${esc(displayFtir)}</span></td>
            <td><span>${esc(displayGerber)}</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  activeModalTripId = tripId;
  modal.classList.remove('hidden');
};

window.deleteTrip = async function(tripId) {
  if (!confirm('Are you sure you want to delete this trip record?')) return;
  try {
    await adminFetch(`/api/admin/trips/${tripId}`, { method: 'DELETE' });
    showToast('Trip record deleted!', 'success');
    await loadAdminTrips();
  } catch (err) {
    showToast(err.message || 'Failed to delete trip.', 'error');
  }
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

// driver-dashboard.js — Driver Dashboard Page Logic

let currentProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('driver');
  if (!profile) return;

  currentProfile = profile;
  initializeSidebar();
  initializeUI(profile);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadDashboard();
});

function initializeSidebar() {
  const sidebar = document.getElementById('driver-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar || !toggleBtn || !overlay) return;

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
}

function initializeUI(profile) {
  // Header
  const name = profile.name || 'Driver';
  document.getElementById('header-driver-name').textContent = name;
  document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  // Avatar initials
  const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('header-avatar').textContent = initials;
  document.getElementById('driver-avatar-initials').textContent = initials;

  // Profile section
  document.getElementById('driver-full-name').textContent = name;
  document.getElementById('driver-id-display').textContent = profile.id.substring(0, 8).toUpperCase();

  // Profile image
  if (profile.profile_image_url) {
    const img = document.getElementById('driver-profile-img');
    img.src = profile.profile_image_url;
    img.classList.remove('hidden');
    document.getElementById('driver-avatar-initials').style.display = 'none';
  }
}

async function loadDashboard() {
  showLoadingState();

  try {
    const [dashData, wtData] = await Promise.allSettled([
      apiGetDriverDashboard(),
      apiGetDriverWorkTime()
    ]);

    const dash = dashData.status === 'fulfilled' ? dashData.value : null;
    const wt = wtData.status === 'fulfilled' ? wtData.value : null;

    if (!dash) {
      showErrorState(dashData.reason?.message || 'Unable to load dashboard data.');
      return;
    }

    showDashboardContent();
    renderKPIs(dash);
    renderDriverStatus(dash);
    renderVehicle(dash.vehicle);
    renderWorkTime(wt);
    renderTrips(dash.trips || []);
    renderActiveTripAlert(dash.active_trip);

  } catch (err) {
    console.error('Dashboard load error:', err);
    showErrorState(err.message || 'Unable to load dashboard. Please try again.');
  }
}

function showLoadingState() {
  document.getElementById('loading-state').classList.remove('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('dashboard-content').classList.add('hidden');
}

function showErrorState(msg) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
  document.getElementById('dashboard-content').classList.add('hidden');
  document.getElementById('error-message').textContent = msg;
}

function showDashboardContent() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('dashboard-content').classList.remove('hidden');
}

function renderKPIs(dash) {
  document.getElementById('kpi-total-trips').textContent = dash.total_trips ?? 0;
  document.getElementById('kpi-today-trips').textContent = dash.today_trips ?? 0;
  document.getElementById('kpi-completed-trips').textContent = dash.completed_trips ?? 0;
  document.getElementById('kpi-work-time').textContent = formatDuration(dash.today_work_ms);
  document.getElementById('kpi-total-km').textContent = dash.total_km ? `${Math.round(dash.total_km)} km` : '0 km';
}

function renderDriverStatus(dash) {
  const statusBadge = document.getElementById('driver-current-status-badge');
  const statusText = document.getElementById('driver-current-status-text');
  const dot = statusBadge.querySelector('.status-dot');

  const activeTrip = dash.active_trip;
  let status = 'Available';
  let dotClass = '';

  if (activeTrip) {
    switch (activeTrip.status) {
      case 'assigned':  status = 'Trip Assigned'; dotClass = 'orange'; break;
      case 'accepted':  status = 'Trip Accepted'; dotClass = 'orange'; break;
      case 'ready':     status = 'Ready to Start'; dotClass = 'orange'; break;
      case 'in_progress': status = 'Trip In Progress'; dotClass = 'red'; break;
      case 'returning': status = 'Returning'; dotClass = 'blue'; break;
      default: status = 'Available'; break;
    }
  }

  statusText.textContent = status;
  document.getElementById('header-driver-status').textContent = status;

  if (dot) {
    dot.className = 'status-dot';
    if (dotClass) dot.classList.add(dotClass);
  }

  // Vehicle display in profile banner
  if (dash.vehicle) {
    document.getElementById('driver-vehicle-display').textContent = dash.vehicle.board_number || '—';
    document.getElementById('driver-vehicle-type').textContent = dash.vehicle.vehicle_type || 'Tanker';
  }
}

function renderVehicle(vehicle) {
  const loading = document.getElementById('vehicle-loading');
  const content = document.getElementById('vehicle-content');
  const empty = document.getElementById('vehicle-empty');

  loading.classList.add('hidden');

  if (!vehicle) {
    empty.classList.remove('hidden');
    return;
  }

  content.classList.remove('hidden');

  document.getElementById('veh-number').textContent = vehicle.board_number || '—';
  document.getElementById('veh-type').textContent = vehicle.vehicle_type || 'Tanker';
  document.getElementById('veh-model').textContent = vehicle.vehicle_model || '—';
  document.getElementById('veh-km').textContent = vehicle.current_km ? `${vehicle.current_km.toLocaleString('en-IN')} km` : '—';

  // Status badge
  const statusBadge = document.getElementById('veh-status-badge');
  const vStatus = vehicle.status || 'available';
  const vStatusMap = {
    'available': ['badge-success', 'Available'],
    'on_trip': ['badge-active', 'On Trip'],
    'maintenance': ['badge-warning', 'Maintenance'],
    'inactive': ['badge-neutral', 'Inactive']
  };
  const [cls, label] = vStatusMap[vStatus] || ['badge-neutral', vStatus];
  statusBadge.className = `badge ${cls}`;
  statusBadge.textContent = label;

  // Image
  if (vehicle.image_url) {
    const img = document.getElementById('vehicle-img');
    img.src = vehicle.image_url;
    img.classList.remove('hidden');
    document.getElementById('vehicle-img-placeholder').classList.add('hidden');
  }
}

function renderWorkTime(wt) {
  document.getElementById('wt-today').textContent = wt ? formatDuration(wt.today_ms) : '—';
  document.getElementById('wt-week').textContent = wt ? formatDuration(wt.week_ms) : '—';
  document.getElementById('wt-month').textContent = wt ? formatDuration(wt.month_ms) : '—';
}

function renderActiveTripAlert(activeTrip) {
  const alertEl = document.getElementById('active-trip-alert');
  if (!activeTrip || activeTrip.status === 'completed' || activeTrip.status === 'cancelled') {
    alertEl.classList.add('hidden');
    return;
  }

  alertEl.classList.remove('hidden');
  const alertText = document.getElementById('active-trip-alert-text');
  alertText.textContent = `Trip ${activeTrip.trip_number || ''} is ${getStatusLabel(activeTrip.status).toLowerCase()}.`;
}

function renderTrips(trips) {
  const loadingEl = document.getElementById('trips-loading');
  const contentEl = document.getElementById('trips-content');
  const emptyEl = document.getElementById('trips-empty');
  const listEl = document.getElementById('trips-list');

  loadingEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  // Filter to non-completed, non-cancelled trips first, then add recent history
  const relevantTrips = trips.filter(t => !['completed', 'cancelled'].includes(t.status));
  const recentHistory = trips.filter(t => t.status === 'completed').slice(0, 3);
  const displayTrips = [...relevantTrips, ...recentHistory];

  if (displayTrips.length === 0) {
    emptyEl.classList.remove('hidden');
    listEl.innerHTML = '';
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.innerHTML = displayTrips.map(trip => renderTripCard(trip)).join('');
}

function renderTripCard(trip) {
  const statusBadge = `<span class="badge ${getStatusBadgeClass(trip.status)}">${getStatusLabel(trip.status)}</span>`;
  const isActive = ['assigned', 'accepted', 'ready', 'in_progress', 'returning'].includes(trip.status);

  const acceptBtn = trip.status === 'assigned'
    ? `<button class="btn btn-primary btn-sm" onclick="acceptTrip('${trip.id}')">✅ Accept Trip</button>`
    : '';

  const viewBtn = isActive
    ? `<a href="trip.html?id=${trip.id}" class="btn btn-outline btn-sm">View →</a>`
    : `<a href="history.html" class="btn btn-ghost btn-sm">Details</a>`;

  return `
    <div class="driver-trip-card ${isActive ? 'active-trip' : ''}">
      <div class="trip-card-header">
        <div>
          <div class="trip-card-title">
            ${trip.trip_number || 'Trip'}
          </div>
          <div class="trip-card-subtitle">${trip.bmc_name || '—'} → ${trip.destination || '—'}</div>
        </div>
        ${statusBadge}
      </div>
      <div class="trip-card-meta">
        <div class="trip-card-meta-item">🚛 ${trip.vehicle_number || '—'}</div>
        <div class="trip-card-meta-item">📅 ${formatDate(trip.scheduled_start_time || trip.created_at)}</div>
        ${trip.scheduled_start_time ? `<div class="trip-card-meta-item">🕐 ${formatTime(trip.scheduled_start_time)}</div>` : ''}
        ${trip.route ? `<div class="trip-card-meta-item">🗺️ ${trip.route}</div>` : ''}
      </div>
      <div class="trip-card-actions">
        ${acceptBtn}
        ${viewBtn}
      </div>
    </div>
  `;
}

async function acceptTrip(tripId) {
  if (!confirm('Accept this trip? This will confirm you are ready for this duty.')) return;

  try {
    showToast('Accepting trip...', 'info');
    await apiAcceptTrip(tripId);
    showToast('Trip accepted successfully!', 'success');
    await loadDashboard();
  } catch (err) {
    console.error('Accept trip error:', err);
    showToast(err.message || 'Failed to accept trip.', 'error');
  }
}

// driver-history.js — Driver Trip History Page

let currentFilter = 'today';
let customStartDate = null;
let customEndDate = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('driver');
  if (!profile) return;

  initializeSidebar();
  updateHeaderUI(profile);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  setupFilters();
  await loadHistory();
});

function initializeSidebar() {
  const sidebar = document.getElementById('driver-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar || !toggleBtn || !overlay) return;
  toggleBtn.addEventListener('click', () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); });
  overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); });
}

function updateHeaderUI(profile) {
  const name = profile.name || 'Driver';
  document.getElementById('header-driver-name').textContent = name;
  document.getElementById('header-avatar').textContent = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function setupFilters() {
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.range;
      const customRange = document.getElementById('custom-date-range');
      if (currentFilter === 'custom') {
        customRange.classList.remove('hidden');
      } else {
        customRange.classList.add('hidden');
        loadHistory();
      }
    });
  });

  document.getElementById('apply-custom-filter').addEventListener('click', () => {
    customStartDate = document.getElementById('filter-start-date').value;
    customEndDate = document.getElementById('filter-end-date').value;
    if (!customStartDate || !customEndDate) {
      showToast('Please select both start and end dates.', 'error');
      return;
    }
    loadHistory();
  });
}

async function loadHistory() {
  document.getElementById('history-loading').classList.remove('hidden');
  document.getElementById('history-content').classList.add('hidden');
  document.getElementById('history-empty').classList.add('hidden');

  const filters = { range: currentFilter };
  if (currentFilter === 'custom') {
    filters.startDate = customStartDate;
    filters.endDate = customEndDate;
  }

  try {
    const data = await apiGetDriverHistory(filters);
    const trips = data.trips || [];

    document.getElementById('history-loading').classList.add('hidden');

    if (trips.length === 0) {
      document.getElementById('history-empty').classList.remove('hidden');
      return;
    }

    document.getElementById('history-content').classList.remove('hidden');
    renderHistoryTable(trips);
    renderSummary(trips);
  } catch (err) {
    document.getElementById('history-loading').classList.add('hidden');
    document.getElementById('history-empty').classList.remove('hidden');
    document.getElementById('history-empty').querySelector('p').textContent = err.message || 'Failed to load history.';
    showToast(err.message || 'Failed to load trip history.', 'error');
  }
}

function renderHistoryTable(trips) {
  const tbody = document.getElementById('history-table-body');
  tbody.innerHTML = trips.map(trip => {
    const duration = (trip.started_at && trip.completed_at)
      ? formatDuration(new Date(trip.completed_at) - new Date(trip.started_at))
      : '—';

    return `
      <tr>
        <td><strong>${trip.trip_number || '—'}</strong></td>
        <td>${formatDate(trip.scheduled_start_time || trip.created_at)}</td>
        <td>${trip.vehicle_number || '—'}</td>
        <td>${trip.bmc_name || '—'}</td>
        <td>${trip.out_km !== null && trip.out_km !== undefined ? formatNumber(trip.out_km, 1) : '—'}</td>
        <td>${trip.in_km !== null && trip.in_km !== undefined ? formatNumber(trip.in_km, 1) : '—'}</td>
        <td>${trip.km_travelled !== null && trip.km_travelled !== undefined ? formatNumber(trip.km_travelled, 1) + ' km' : '—'}</td>
        <td>${trip.out_weight !== null && trip.out_weight !== undefined ? formatNumber(trip.out_weight, 0) + ' kg' : '—'}</td>
        <td>${trip.in_weight !== null && trip.in_weight !== undefined ? formatNumber(trip.in_weight, 0) + ' kg' : '—'}</td>
        <td>${trip.weight_difference !== null && trip.weight_difference !== undefined ? formatNumber(trip.weight_difference, 0) + ' kg' : '—'}</td>
        <td>${trip.diesel_consumption !== null && trip.diesel_consumption !== undefined ? formatNumber(trip.diesel_consumption, 2) : '—'}</td>
        <td>${trip.average_mileage !== null && trip.average_mileage !== undefined ? formatNumber(trip.average_mileage, 3) + ' km/u' : '—'}</td>
        <td>${duration}</td>
        <td><span class="badge ${getStatusBadgeClass(trip.status)}">${getStatusLabel(trip.status)}</span></td>
      </tr>
    `;
  }).join('');
}

function renderSummary(trips) {
  const completed = trips.filter(t => t.status === 'completed');
  const totalKm = completed.reduce((sum, t) => sum + (Number(t.km_travelled) || 0), 0);
  const mileages = completed.filter(t => t.average_mileage !== null && t.average_mileage !== undefined).map(t => Number(t.average_mileage));
  const avgMileage = mileages.length > 0 ? mileages.reduce((a, b) => a + b, 0) / mileages.length : null;
  const totalWorkMs = completed
    .filter(t => t.started_at && t.completed_at)
    .reduce((sum, t) => sum + (new Date(t.completed_at) - new Date(t.started_at)), 0);

  document.getElementById('sum-trips').textContent = trips.length;
  document.getElementById('sum-km').textContent = totalKm > 0 ? `${Math.round(totalKm)} km` : '0 km';
  document.getElementById('sum-mileage').textContent = avgMileage !== null ? `${formatNumber(avgMileage, 3)} km/u` : '—';
  document.getElementById('sum-hours').textContent = formatDuration(totalWorkMs);
}

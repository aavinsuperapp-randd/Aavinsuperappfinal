// transport-dashboard.js — Transport Officer Dashboard Logic

let vehicleUtilizationChart = null;
let driverPerformanceChart = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('transport_officer');
  if (!profile) return;

  document.getElementById('main-to-content').classList.remove('hidden');
  document.getElementById('header-to-name').textContent = profile.name;

  // Setup sidebar toggle
  setupSidebarToggle();

  // Setup logout
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  // Setup search filters
  document.getElementById('duty-search-input')?.addEventListener('input', filterDuties);
  document.getElementById('driver-search-input')?.addEventListener('input', filterDrivers);

  // Load dashboard data
  await loadDashboard();
});

/**
 * Setup Sidebar Toggle for Mobile
 */
function setupSidebarToggle() {
  const sidebar = document.getElementById('transport-sidebar');
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

/**
 * Load Dashboard Data
 */
async function loadDashboard() {
  try {
    const data = await apiGetTransportDashboard();

    // Update KPIs
    document.getElementById('kpi-total-vehicles').textContent = data.totalVehicles || 0;
    document.getElementById('kpi-total-drivers').textContent = data.totalDrivers || 0;

    document.getElementById('kpi-available-vehicles').textContent = data.availableVehicles || 0;
    document.getElementById('kpi-vehicles-on-trip').textContent = data.vehiclesOnTrip || 0;
    document.getElementById('kpi-today-duties').textContent = data.todayDuties || 0;
    document.getElementById('kpi-completed-trips').textContent = data.completedTrips || 0;

    // Render charts
    renderVehicleUtilizationChart(data.vehicleUtilization || []);
    renderDriverPerformanceChart(data.driverPerformance || []);

    // Render duties table
    renderDutiesTable(data.recentDuties || []);

  } catch (err) {
    console.error('Failed to load dashboard:', err);
    showToast(err.message || 'Failed to load dashboard data', 'error');
  }
}

/**
 * Render Vehicle Utilization Chart
 */
function renderVehicleUtilizationChart(data) {
  const ctx = document.getElementById('vehicleUtilizationChart');
  if (!ctx) return;

  if (vehicleUtilizationChart) {
    vehicleUtilizationChart.destroy();
  }

  const labels = data.map(v => v.label || 'N/A');
  const values = data.map(v => v.value || 0);

  vehicleUtilizationChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: ['#10B981', '#2563EB', '#F59E0B', '#EF4444'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 12,
            font: { size: 12, family: 'Outfit' }
          }
        }
      }
    }
  });
}

/**
 * Render Driver Performance Chart
 */
function renderDriverPerformanceChart(data) {
  const ctx = document.getElementById('driverPerformanceChart');
  if (!ctx) return;

  if (driverPerformanceChart) {
    driverPerformanceChart.destroy();
  }

  const labels = data.map(d => d.name || 'N/A');
  const values = data.map(d => d.trips || 0);

  driverPerformanceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Trips (Last 7 Days)',
        data: values,
        backgroundColor: '#2563EB',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
            font: { family: 'Outfit' }
          }
        },
        x: {
          ticks: {
            font: { family: 'Outfit' }
          }
        }
      }
    }
  });
}

/**
 * Render Duties Table
 */
let allDuties = [];

function renderDutiesTable(duties) {
  allDuties = duties;
  const tbody = document.getElementById('duties-table-body');
  if (!tbody) return;

  if (duties.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">No recent duties found</td></tr>';
    return;
  }

  tbody.innerHTML = duties.map(duty => `
    <tr>
      <td>${formatDate(duty.duty_date)}</td>
      <td><strong>${duty.driver_name || '—'}</strong></td>
      <td>${duty.vehicle_number || '—'}</td>
      <td>${duty.route || duty.task || '—'}</td>
      <td><span class="badge badge-${getStatusBadge(duty.status)}">${duty.status || 'Pending'}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="viewDutyDetails('${duty.id}')">View</button>
      </td>
    </tr>
  `).join('');
}

function filterDuties() {
  const query = document.getElementById('duty-search-input')?.value.toLowerCase() || '';
  const filtered = allDuties.filter(duty => 
    (duty.driver_name || '').toLowerCase().includes(query) ||
    (duty.vehicle_number || '').toLowerCase().includes(query) ||
    (duty.route || '').toLowerCase().includes(query)
  );
  renderDutiesTable(filtered);
}

function viewDutyDetails(dutyId) {
  // Navigate to duty page with filter
  window.location.href = `duty.html?id=${dutyId}`;
}

/**
 * Helper: Get Status Badge Color
 */
function getStatusBadge(status) {
  const s = (status || 'pending').toLowerCase();
  if (s === 'completed') return 'success';
  if (s === 'in_progress' || s === 'assigned') return 'blue';
  if (s === 'cancelled') return 'danger';
  return 'neutral';
}

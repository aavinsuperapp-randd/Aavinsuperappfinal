// transport-driver-analysis.js — Deep Driver Analysis with Date Filtering

let allDrivers = [];
let currentDriverId = null;
let currentStartDate = '';
let currentEndDate = '';

let chart1 = null;
let chart2 = null;
let chart3 = null;
let chart4 = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('transport_officer');
  if (!profile) return;

  document.getElementById('main-to-content').classList.remove('hidden');
  document.getElementById('header-to-name').textContent = profile.name;

  setupSidebarToggle();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await loadDriverList();
  setupFilters();
  
  document.getElementById('apply-analysis-btn').addEventListener('click', runAnalysis);
});

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

async function loadDriverList() {
  try {
    const data = await apiGetDrivers();
    allDrivers = data.drivers || [];
    
    const select = document.getElementById('driver-select');
    select.innerHTML = '<option value="">-- Select Driver --</option>' +
      allDrivers.map(driver => `<option value="${driver.id}">${driver.name}</option>`).join('');
  } catch (err) {
    console.error('Failed to load drivers:', err);
    showToast(err.message || 'Failed to load drivers', 'error');
  }
}

function setupFilters() {
  const dateRangeSelect = document.getElementById('date-range-preset');
  const customInputs = document.getElementById('custom-date-inputs');

  dateRangeSelect.addEventListener('change', () => {
    if (dateRangeSelect.value === 'custom') {
      customInputs.classList.remove('hidden');
      customInputs.style.display = 'flex';
    } else {
      customInputs.classList.add('hidden');
      customInputs.style.display = 'none';
    }
  });
}

function getDateRange() {
  const preset = document.getElementById('date-range-preset').value;
  const today = new Date();
  let start, end;

  switch (preset) {
    case 'today':
      start = new Date(today);
      end = new Date(today);
      break;
    case 'this_week':
      start = new Date(today);
      start.setDate(today.getDate() - today.getDay());
      end = new Date(today);
      break;
    case 'last_week':
      start = new Date(today);
      start.setDate(today.getDate() - today.getDay() - 7);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      break;
    case 'this_month':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today);
      break;
    case 'last_month':
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
      break;
    case 'last_3_months':
      start = new Date(today);
      start.setMonth(today.getMonth() - 3);
      end = new Date(today);
      break;
    case 'custom':
      const startInput = document.getElementById('start-date-input').value;
      const endInput = document.getElementById('end-date-input').value;
      if (!startInput || !endInput) {
        throw new Error('Please select both start and end dates');
      }
      start = new Date(startInput);
      end = new Date(endInput);
      break;
    default:
      start = new Date(today);
      end = new Date(today);
  }

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0]
  };
}

async function runAnalysis() {
  const driverId = document.getElementById('driver-select').value;
  
  if (!driverId) {
    showToast('Please select a driver', 'error');
    return;
  }

  try {
    const { startDate, endDate } = getDateRange();
    currentDriverId = driverId;
    currentStartDate = startDate;
    currentEndDate = endDate;

    const data = await apiGetDriverAnalysis(driverId, startDate, endDate);
    
    // Show sections
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('selected-driver-header').classList.remove('hidden');
    document.getElementById('metrics-section').classList.remove('hidden');

    // Update header
    const driver = allDrivers.find(d => d.id === driverId);
    document.getElementById('analysis-driver-name').textContent = driver ? driver.name : 'Driver';
    document.getElementById('analysis-date-range').textContent = `${formatDate(startDate)} — ${formatDate(endDate)}`;

    // Update metrics
    updateMetrics(data.metrics || {});

    // Render charts
    renderCharts(data.chartData || {});

    // Render trip history
    renderTripHistory(data.trips || []);

  } catch (err) {
    console.error('Failed to run analysis:', err);
    showToast(err.message || 'Failed to run analysis', 'error');
  }
}

function updateMetrics(metrics) {
  document.getElementById('metric-total-trips').textContent = metrics.total_trips || 0;
  document.getElementById('metric-completed-trips').textContent = metrics.completed_trips || 0;
  document.getElementById('metric-total-visits').textContent = metrics.total_visits || 0;
  document.getElementById('metric-avg-duration').textContent = formatDurationMs(metrics.avg_duration_ms);
  document.getElementById('metric-total-hours').textContent = formatDurationMs(metrics.total_hours_ms);
  
  const tripsPerDay = metrics.trips_per_day || 0;
  document.getElementById('metric-trips-per-day').textContent = tripsPerDay.toFixed(1);
  
  const visitsPerTrip = metrics.visits_per_trip || 0;
  document.getElementById('metric-visits-per-trip').textContent = visitsPerTrip.toFixed(1);
}

function renderCharts(chartData) {
  // Trips Over Time
  const ctx1 = document.getElementById('tripsOverTimeChart');
  if (chart1) chart1.destroy();
  chart1 = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: chartData.dates || [],
      datasets: [{
        label: 'Trips',
        data: chartData.trips_by_date || [],
        borderColor: '#2563EB',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: 'Outfit' } } },
        x: { ticks: { font: { family: 'Outfit' } } }
      }
    }
  });

  // BMC Visits Over Time
  const ctx2 = document.getElementById('visitsOverTimeChart');
  if (chart2) chart2.destroy();
  chart2 = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: chartData.dates || [],
      datasets: [{
        label: 'BMC Visits',
        data: chartData.visits_by_date || [],
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: 'Outfit' } } },
        x: { ticks: { font: { family: 'Outfit' } } }
      }
    }
  });

  // Trip Duration Over Time
  const ctx3 = document.getElementById('durationOverTimeChart');
  if (chart3) chart3.destroy();
  chart3 = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: chartData.dates || [],
      datasets: [{
        label: 'Duration (hours)',
        data: chartData.duration_by_date || [],
        backgroundColor: '#F59E0B',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { family: 'Outfit' } } },
        x: { ticks: { font: { family: 'Outfit' } } }
      }
    }
  });

  // Duty Hours
  const ctx4 = document.getElementById('dutyHoursChart');
  if (chart4) chart4.destroy();
  chart4 = new Chart(ctx4, {
    type: 'bar',
    data: {
      labels: chartData.dates || [],
      datasets: [{
        label: 'Duty Hours',
        data: chartData.duty_hours_by_date || [],
        backgroundColor: '#8B5CF6',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { family: 'Outfit' } } },
        x: { ticks: { font: { family: 'Outfit' } } }
      }
    }
  });
}

function renderTripHistory(trips) {
  const tbody = document.getElementById('trip-history-body');
  document.getElementById('trip-count-label').textContent = `${trips.length} trip${trips.length !== 1 ? 's' : ''} in selected period`;

  if (trips.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">No trips found for selected period</td></tr>';
    return;
  }

  tbody.innerHTML = trips.map(trip => `
    <tr>
      <td>${formatDate(trip.created_at)}</td>
      <td><strong>${trip.trip_name || '—'}</strong></td>
      <td>${trip.vehicle_number || '—'}</td>
      <td>${trip.visits_count || 0}</td>
      <td>${formatTime(trip.out_time)}</td>
      <td>${formatTime(trip.in_time)}</td>
      <td>${formatDurationMs(trip.duration_ms)}</td>
      <td><span class="badge badge-${trip.status === 'completed' ? 'success' : 'blue'}">${trip.status || 'active'}</span></td>
    </tr>
  `).join('');
}

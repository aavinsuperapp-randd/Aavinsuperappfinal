// gm-analysis.js — GM Operational Analysis Page Logic

let currentType = 'vehicle';
let currentSummaryList = [];
let currentAllTrips = [];

let chart1Instance = null;
let chart2Instance = null;
let chart3Instance = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('pi_agm');
  if (!profile) return;

  document.getElementById('main-pi-agm-content').classList.remove('hidden');
  document.getElementById('header-pi-agm-name').textContent = profile.name;

  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  setupTypeToggle();
  setupDateFilters();
  setupModalEvents();

  document.getElementById('apply-filter-btn').addEventListener('click', loadAnalysisData);
  document.getElementById('search-filter-input').addEventListener('input', renderTableAndCharts);

  await loadAnalysisData();
});

function setupTypeToggle() {
  const buttons = document.querySelectorAll('.type-toggle-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
      await loadAnalysisData();
    });
  });
}

function setupDateFilters() {
  const select = document.getElementById('preset-date-select');
  const customInputs = document.getElementById('custom-date-inputs');

  select.addEventListener('change', () => {
    if (select.value === 'custom') {
      customInputs.classList.remove('hidden');
    } else {
      customInputs.classList.add('hidden');
    }
  });
}

function getFilterDates() {
  const select = document.getElementById('preset-date-select').value;
  let startDate = '';
  let endDate = '';

  if (select === 'last7') {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    startDate = start.toISOString().slice(0, 10);
    endDate = end.toISOString().slice(0, 10);
  } else if (select === 'last30') {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 29);
    startDate = start.toISOString().slice(0, 10);
    endDate = end.toISOString().slice(0, 10);
  } else if (select === 'custom') {
    startDate = document.getElementById('start-date-input').value;
    endDate = document.getElementById('end-date-input').value;
  }

  return { startDate, endDate };
}

async function loadAnalysisData() {
  const { startDate, endDate } = getFilterDates();
  try {
    const data = await apiGetGmAnalysis({ type: currentType, startDate, endDate });
    currentSummaryList = data.summary_list || [];
    currentAllTrips = data.all_trips || [];
    renderTimingHighlights();
    renderTableAndCharts();
  } catch (err) {
    console.error('Failed to load GM analysis data:', err);
    showToast(err.message || 'Failed to load analysis data.', 'error');
  }
}

function renderTimingHighlights() {
  const validDurations = currentAllTrips
    .map(t => t.duration_ms)
    .filter(d => d !== null && d !== undefined && d >= 0);

  if (validDurations.length === 0) {
    document.getElementById('timing-avg').textContent = 'N/A';
    document.getElementById('timing-min').textContent = 'N/A';
    document.getElementById('timing-max').textContent = 'N/A';
    document.getElementById('timing-total').textContent = 'N/A';
    return;
  }

  const totalMs = validDurations.reduce((acc, curr) => acc + curr, 0);
  const avgMs = Math.round(totalMs / validDurations.length);
  const minMs = Math.min(...validDurations);
  const maxMs = Math.max(...validDurations);

  document.getElementById('timing-avg').textContent = formatMs(avgMs);
  document.getElementById('timing-min').textContent = formatMs(minMs);
  document.getElementById('timing-max').textContent = formatMs(maxMs);
  document.getElementById('timing-total').textContent = formatMs(totalMs);
}

function getFilteredList() {
  const query = document.getElementById('search-filter-input').value.trim().toLowerCase();
  if (!query) return currentSummaryList;
  return currentSummaryList.filter(item => (item.name || '').toLowerCase().includes(query));
}

function renderTableAndCharts() {
  const list = getFilteredList();

  renderCharts(list);

  renderTable(list);
}

function renderCharts(list) {
  const labels = list.map(item => item.name);
  const tripsData = list.map(item => item.total_trips);
  const visitsData = list.map(item => item.total_visits);
  const avgDurationMins = list.map(item => item.avg_duration_ms ? Math.round(item.avg_duration_ms / (1000 * 60)) : 0);

  // Update chart titles
  if (currentType === 'vehicle') {
    document.getElementById('chart-1-title').textContent = 'Trips by Vehicle / Tanker';
    document.getElementById('chart-2-title').textContent = 'BMC Visits by Vehicle';
    document.getElementById('chart-3-title').textContent = 'Average Trip Duration by Vehicle';
  } else if (currentType === 'driver') {
    document.getElementById('chart-1-title').textContent = 'Trips by Driver';
    document.getElementById('chart-2-title').textContent = 'BMC Visits by Driver';
    document.getElementById('chart-3-title').textContent = 'Average Trip Duration by Driver';
  } else if (currentType === 'worker') {
    document.getElementById('chart-1-title').textContent = 'Trips by R&D Worker';
    document.getElementById('chart-2-title').textContent = 'BMC Visits by R&D Worker';
    document.getElementById('chart-3-title').textContent = 'Average Trip Duration by R&D Worker';
  }

  // Chart 1: Trips
  const ctx1 = document.getElementById('analysisChart1').getContext('2d');
  if (chart1Instance) chart1Instance.destroy();
  chart1Instance = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Trips', data: tripsData, backgroundColor: '#2563EB', borderRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });

  // Chart 2: Visits
  const ctx2 = document.getElementById('analysisChart2').getContext('2d');
  if (chart2Instance) chart2Instance.destroy();
  chart2Instance = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'BMC Visits', data: visitsData, backgroundColor: '#10B981', borderRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });

  // Chart 3: Duration (Horizontal bar chart)
  const ctx3 = document.getElementById('analysisChart3').getContext('2d');
  if (chart3Instance) chart3Instance.destroy();
  chart3Instance = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Avg Duration (Minutes)', data: avgDurationMins, backgroundColor: '#F59E0B', borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `Avg Duration: ${formatMinsToHours(ctx.parsed.x)}`
          }
        }
      },
      scales: { x: { beginAtZero: true } }
    }
  });
}

function renderTable(list) {
  const headEl = document.getElementById('analysis-table-head');
  const bodyEl = document.getElementById('analysis-table-body');
  const titleEl = document.getElementById('table-title');

  if (currentType === 'vehicle') {
    titleEl.textContent = '🚛 Tanker Vehicle Operational Table';
    headEl.innerHTML = `
      <tr>
        <th>Vehicle Board No.</th>
        <th>Total Trips</th>
        <th>BMC Visits</th>
        <th>Avg BMCs / Trip</th>
        <th>Total Duration</th>
        <th>Avg Duration</th>
        <th>Action</th>
      </tr>
    `;
    if (list.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No vehicle data found.</td></tr>`;
      return;
    }
    bodyEl.innerHTML = list.map(v => `
      <tr onclick="openDrilldownModal('${esc(v.id)}')">
        <td><strong>🚛 ${esc(v.board_number)}</strong></td>
        <td>${v.total_trips}</td>
        <td>${v.total_visits}</td>
        <td>${v.avg_bmcs_per_trip}</td>
        <td>${v.total_duration_formatted}</td>
        <td><span class="badge badge-neutral">${v.avg_duration_formatted}</span></td>
        <td><button class="btn btn-outline btn-sm">Inspect →</button></td>
      </tr>
    `).join('');

  } else if (currentType === 'driver') {
    titleEl.textContent = '👨‍✈️ Driver Operational Table';
    headEl.innerHTML = `
      <tr>
        <th>Driver Name</th>
        <th>Total Trips</th>
        <th>BMC Visits</th>
        <th>Avg BMCs / Trip</th>
        <th>Total Duration</th>
        <th>Avg Duration</th>
        <th>Action</th>
      </tr>
    `;
    if (list.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No driver data found.</td></tr>`;
      return;
    }
    bodyEl.innerHTML = list.map(d => `
      <tr onclick="openDrilldownModal('${esc(d.id)}')">
        <td><strong>👨‍✈️ ${esc(d.driver_name)}</strong></td>
        <td>${d.total_trips}</td>
        <td>${d.total_visits}</td>
        <td>${d.avg_bmcs_per_trip}</td>
        <td>${d.total_duration_formatted}</td>
        <td><span class="badge badge-neutral">${d.avg_duration_formatted}</span></td>
        <td><button class="btn btn-outline btn-sm">Inspect →</button></td>
      </tr>
    `).join('');

  } else if (currentType === 'worker') {
    titleEl.textContent = '🔬 R&D Worker Operational Table';
    headEl.innerHTML = `
      <tr>
        <th>Worker Name</th>
        <th>Trips</th>
        <th>Visits</th>
        <th>FTIR Tests</th>
        <th>Gerber Tests</th>
        <th>Issues</th>
        <th>Avg Rating</th>
        <th>Avg Duration</th>
        <th>Action</th>
      </tr>
    `;
    if (list.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No worker data found.</td></tr>`;
      return;
    }
    bodyEl.innerHTML = list.map(w => `
      <tr onclick="openDrilldownModal('${esc(w.id)}')">
        <td><strong>🔬 ${esc(w.worker_name)}</strong></td>
        <td>${w.total_trips}</td>
        <td>${w.total_visits}</td>
        <td>${w.total_ftir}</td>
        <td>${w.total_gerber}</td>
        <td><span class="badge ${w.total_issues > 0 ? 'badge-warning' : 'badge-neutral'}">${w.total_issues}</span></td>
        <td style="color:#10B981; font-weight:700;">${w.avg_bmc_rating ? w.avg_bmc_rating + ' ★' : '—'}</td>
        <td><span class="badge badge-neutral">${w.avg_duration_formatted}</span></td>
        <td><button class="btn btn-outline btn-sm">Inspect →</button></td>
      </tr>
    `).join('');
  }
}

function openDrilldownModal(entityId) {
  const entity = currentSummaryList.find(item => String(item.id).toLowerCase() === String(entityId).toLowerCase());
  if (!entity) return;

  const modal = document.getElementById('drilldown-modal');
  document.getElementById('drilldown-modal-title').textContent = `Detailed Performance Profile: ${entity.name}`;

  const headerContainer = document.getElementById('drilldown-summary-header');
  let assocHtml = '';
  if (currentType === 'vehicle') {
    assocHtml = `
      <div class="text-sm text-muted"><strong>Associated Drivers:</strong> ${entity.associated_drivers.join(', ') || 'None'}</div>
      <div class="text-sm text-muted"><strong>Associated Workers:</strong> ${entity.associated_workers.join(', ') || 'None'}</div>
      <div class="text-sm text-muted"><strong>First Trip:</strong> ${entity.first_trip_time} | <strong>Last Trip:</strong> ${entity.last_trip_time}</div>
    `;
  } else if (currentType === 'driver') {
    assocHtml = `
      <div class="text-sm text-muted"><strong>Associated Vehicles:</strong> ${entity.associated_tankers.join(', ') || 'None'}</div>
      <div class="text-sm text-muted"><strong>Associated Workers:</strong> ${entity.associated_workers.join(', ') || 'None'}</div>
      <div class="text-sm text-muted"><strong>First Trip:</strong> ${entity.first_trip_time} | <strong>Last Trip:</strong> ${entity.last_trip_time}</div>
    `;
  } else if (currentType === 'worker') {
    assocHtml = `
      <div class="text-sm text-muted"><strong>Associated Vehicles:</strong> ${entity.associated_tankers.join(', ') || 'None'}</div>
      <div class="text-sm text-muted"><strong>Associated Drivers:</strong> ${entity.associated_drivers.join(', ') || 'None'}</div>
      <div class="text-sm text-muted"><strong>FTIR Tests:</strong> ${entity.total_ftir} | <strong>Gerber Tests:</strong> ${entity.total_gerber} | <strong>Issues:</strong> ${entity.total_issues}</div>
    `;
  }

  headerContainer.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h4 style="font-size:1.1rem; font-weight:800;">${esc(entity.name)}</h4>
      <span class="badge badge-primary">${entity.total_trips} Total Trips</span>
    </div>
    ${assocHtml}
  `;

  const trips = entity.trips || [];
  document.getElementById('drilldown-trips-count').textContent = trips.length;
  const tripsBody = document.getElementById('drilldown-trips-body');

  if (trips.length === 0) {
    tripsBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No associated trips.</td></tr>`;
  } else {
    tripsBody.innerHTML = trips.map(t => `
      <tr>
        <td><strong>${esc(t.trip_name)}</strong></td>
        <td class="text-sm">${t.out_time ? new Date(t.out_time).toLocaleString() : '—'}</td>
        <td class="text-sm">${t.in_time ? new Date(t.in_time).toLocaleString() : '—'}</td>
        <td><span class="badge badge-neutral">${t.duration_formatted}</span></td>
        <td>${t.visits_count} BMCs</td>
        <td><span class="badge ${t.status === 'completed' ? 'badge-success' : 'badge-warning'}">${esc(t.status)}</span></td>
      </tr>
    `).join('');
  }

  modal.classList.remove('hidden');
}

function setupModalEvents() {
  const modal = document.getElementById('drilldown-modal');
  document.getElementById('drilldown-modal-close').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('drilldown-close-btn').addEventListener('click', () => modal.classList.add('hidden'));
}

function formatMs(ms) {
  if (!ms || ms < 0) return 'N/A';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatMinsToHours(mins) {
  if (!mins || mins < 0) return '0m';
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  if (hours > 0) return `${hours}h ${m}m`;
  return `${m}m`;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// worker-analysis.js — Streamlined Trips & BMC Visits Analytics

let activeRange = 'week';
let chartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('user');
  if (!profile) return;

  document.getElementById('header-worker-name').textContent = profile.name;
  setupMobileMenu();
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  bindFilterEvents();
  setRangeDates('week');
  await loadAnalysisData();
});

function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const nav = document.getElementById('ws-nav');
  if (toggleBtn && nav) {
    toggleBtn.addEventListener('click', () => nav.classList.toggle('open'));
  }
}

function bindFilterEvents() {
  const pillBtns = document.querySelectorAll('.filter-btn');
  pillBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      pillBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRange = btn.dataset.range;
      setRangeDates(activeRange);
      await loadAnalysisData();
    });
  });

  document.getElementById('apply-custom-btn').addEventListener('click', async () => {
    pillBtns.forEach(b => b.classList.remove('active'));
    activeRange = 'custom';
    await loadAnalysisData();
  });
}

function setRangeDates(range) {
  const today = new Date();
  const endDateStr = formatDateInput(today);
  let startDateStr = endDateStr;

  if (range === 'today') {
    startDateStr = endDateStr;
  } else if (range === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    startDateStr = formatDateInput(d);
  } else if (range === 'month') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    startDateStr = formatDateInput(d);
  }

  document.getElementById('start-date').value = startDateStr;
  document.getElementById('end-date').value = endDateStr;
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function loadAnalysisData() {
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;

  const label = document.getElementById('active-range-label');
  label.textContent = `Showing data from ${start} to ${end}`;

  try {
    const res = await workerFetch(`/api/analysis?startDate=${start}&endDate=${end}`);
    renderKPIs(res.kpis);
    renderGraph(res);
    renderVisitsTable(res.visits || []);
    renderTripsTable(res.trips || []);
  } catch (err) {
    console.error('Error loading analysis:', err);
    showToast(err.message || 'Failed to load analysis data.', 'error');
  }
}

function renderKPIs(kpis) {
  document.getElementById('kpi-trips').textContent = kpis.total_trips;
  document.getElementById('kpi-trips-sub').textContent = `${kpis.completed_trips} completed | ${kpis.active_trips} active`;

  document.getElementById('kpi-visits').textContent = kpis.total_bmc_visited;
  document.getElementById('kpi-visits-sub').textContent = `${kpis.completed_visits} visits completed`;

  document.getElementById('count-visits').textContent = kpis.total_bmc_visited;
  document.getElementById('count-trips').textContent = kpis.total_trips;
}

function renderGraph(res) {
  const visits = res.visits || [];
  const trips = res.trips || [];
  const kpis = res.kpis || {};

  const dateMap = {};

  trips.forEach(t => {
    const day = new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (!dateMap[day]) dateMap[day] = { trips: 0, visits: 0 };
    dateMap[day].trips += 1;
  });

  visits.forEach(v => {
    const day = new Date(v.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (!dateMap[day]) dateMap[day] = { trips: 0, visits: 0 };
    dateMap[day].visits += 1;
  });

  const labels = Object.keys(dateMap);
  const tripsData = labels.map(l => dateMap[l].trips);
  const visitsData = labels.map(l => dateMap[l].visits);

  const canvas = document.getElementById('performanceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['Current Period'],
      datasets: [
        {
          label: 'No. of Trips Done',
          data: tripsData.length ? tripsData : [kpis.total_trips || 0],
          backgroundColor: '#3b82f6',
          borderRadius: 6,
          barPercentage: 0.6
        },
        {
          label: 'No. of BMC Visited',
          data: visitsData.length ? visitsData : [kpis.total_bmc_visited || 0],
          backgroundColor: '#10b981',
          borderRadius: 6,
          barPercentage: 0.6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: 'Count' }
        }
      },
      plugins: {
        legend: { position: 'top' }
      }
    }
  });
}

function renderVisitsTable(visits) {
  const tbody = document.getElementById('visits-tbody');
  if (visits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">No BMC visits found for the selected date range.</td></tr>`;
    return;
  }

  tbody.innerHTML = visits.map(v => {
    const bmc = v.bmc || {};
    const bmcName = bmc.name || 'Unknown BMC';
    const location = `${bmc.location || '—'}, ${bmc.district || ''}`;
    const comp = v.compartment ? v.compartment.toUpperCase() : 'Not Set';
    const milkKg = v.milk_quantity_liters !== null ? `${v.milk_quantity_liters} Kg` : '—';
    const dateStr = new Date(v.created_at).toLocaleString();

    return `
      <tr>
        <td><strong>#${v.visit_sequence}</strong></td>
        <td><strong>${esc(bmcName)}</strong></td>
        <td>📍 ${esc(location)}</td>
        <td><span class="status-pill pill-active" style="font-size:0.75rem;">${esc(comp)}</span></td>
        <td><strong>${esc(milkKg)}</strong></td>
        <td class="text-xs text-muted">${dateStr}</td>
      </tr>
    `;
  }).join('');
}

function renderTripsTable(trips) {
  const tbody = document.getElementById('trips-tbody');
  if (trips.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">No collection trips found for the selected date range.</td></tr>`;
    return;
  }

  tbody.innerHTML = trips.map(t => {
    const driver = t.driver_name || (t.driver ? t.driver.name : '—');
    const tanker = t.tanker_number || (t.tanker ? t.tanker.board_number : '—');
    const outTime = new Date(t.out_time).toLocaleString();
    const inTime = t.in_time ? new Date(t.in_time).toLocaleString() : 'In Progress';
    const isDone = t.status === 'completed';

    return `
      <tr>
        <td><strong>${esc(t.trip_name)}</strong></td>
        <td>👨‍✈️ ${esc(driver)}</td>
        <td>🚛 ${esc(tanker)}</td>
        <td class="text-xs">${outTime}</td>
        <td class="text-xs">${inTime}</td>
        <td>
          <span class="status-pill ${isDone ? 'pill-completed' : 'pill-active'}">
            ${isDone ? '✓ Completed' : '● Active'}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

window.switchAnalysisTab = function(tabName) {
  const visitsTab = document.getElementById('tab-content-visits');
  const tripsTab = document.getElementById('tab-content-trips');
  const btns = document.querySelectorAll('.tab-link');

  btns.forEach(b => b.classList.remove('active'));

  if (tabName === 'visits') {
    visitsTab.classList.remove('hidden');
    tripsTab.classList.add('hidden');
    btns[0].classList.add('active');
  } else {
    visitsTab.classList.add('hidden');
    tripsTab.classList.remove('hidden');
    btns[1].classList.add('active');
  }
};

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

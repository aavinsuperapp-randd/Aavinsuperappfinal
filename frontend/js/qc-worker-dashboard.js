// qc-worker-dashboard.js — QC Worker Dashboard logic

let selectedStartDate = new Date().toISOString().split('T')[0];
let selectedEndDate = new Date().toISOString().split('T')[0];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  // Show content
  document.getElementById('main-qc-content').classList.remove('hidden');

  // Set user header info
  document.getElementById('qc-header-name').textContent = profile.name;
  document.getElementById('qc-welcome-name').textContent = profile.name;
  document.getElementById('qc-header-id').textContent = profile.id ? profile.id.slice(0, 8).toUpperCase() : 'QC-001';

  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  setupDateFilters();

  await loadDashboardData();
});

function setupDateFilters() {
  const fromInput = document.getElementById('qc-from-date');
  const toInput = document.getElementById('qc-to-date');
  const btnToday = document.getElementById('btn-preset-today');
  const btnYesterday = document.getElementById('btn-preset-yesterday');
  const btnSearch = document.getElementById('btn-search-qc');
  const btnPdf = document.getElementById('btn-download-pdf-qc');

  const todayStr = new Date().toISOString().split('T')[0];
  if (fromInput) fromInput.value = todayStr;
  if (toInput) toInput.value = todayStr;

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      btnToday.classList.add('active');
      btnToday.style.background = '#2563EB';
      btnToday.style.color = '#FFFFFF';
      if (btnYesterday) {
        btnYesterday.classList.remove('active');
        btnYesterday.style.background = '#F8FAFC';
        btnYesterday.style.color = '#475569';
      }
      const t = new Date().toISOString().split('T')[0];
      selectedStartDate = t;
      selectedEndDate = t;
      if (fromInput) fromInput.value = t;
      if (toInput) toInput.value = t;
      loadDashboardData();
    });
  }

  if (btnYesterday) {
    btnYesterday.addEventListener('click', () => {
      btnYesterday.classList.add('active');
      btnYesterday.style.background = '#2563EB';
      btnYesterday.style.color = '#FFFFFF';
      if (btnToday) {
        btnToday.classList.remove('active');
        btnToday.style.background = '#F8FAFC';
        btnToday.style.color = '#475569';
      }
      const d = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      selectedStartDate = d;
      selectedEndDate = d;
      if (fromInput) fromInput.value = d;
      if (toInput) toInput.value = d;
      loadDashboardData();
    });
  }

  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      selectedStartDate = fromInput?.value || todayStr;
      selectedEndDate = toInput?.value || todayStr;
      loadDashboardData();
    });
  }

  if (btnPdf) {
    btnPdf.addEventListener('click', () => {
      window.print();
    });
  }
}

async function loadDashboardData() {
  try {
    // Fetch Trips and Visits for the range
    const tripsRes = await apiQcWorkerGetDashboardTrips(selectedStartDate, selectedEndDate);
    const trips = tripsRes.trips || [];
    const visits = tripsRes.visits || [];

    // Calculate KPIs
    const totalSamples = visits.length;
    const pendingSamples = visits.filter(v => !v.qc_test || v.qc_test.status === 'in_progress').length;

    if (document.getElementById('stat-total-samples')) {
      document.getElementById('stat-total-samples').textContent = totalSamples;
    }
    if (document.getElementById('stat-samples-pending')) {
      document.getElementById('stat-samples-pending').textContent = pendingSamples;
    }

    // Separate Active vs Completed Trips
    const activeTrips = trips.filter(t => t.status === 'active' || t.status === 'in_progress');
    const completedTrips = trips.filter(t => t.status === 'completed');

    renderTripSection(activeTrips, visits, 'active-trips-container', false);
    renderTripSection(completedTrips, visits, 'completed-trips-container', true);

  } catch (err) {
    console.error('Error loading QC dashboard:', err);
    // Fallback if endpoint is unavailable
    loadDashboardFallback();
  }
}

async function loadDashboardFallback() {
  try {
    const statsRes = await apiQcGetDashboardStats(selectedStartDate);
    if (document.getElementById('stat-samples-pending')) document.getElementById('stat-samples-pending').textContent = statsRes.samples_pending ?? 0;
    if (document.getElementById('stat-total-samples')) document.getElementById('stat-total-samples').textContent = statsRes.total_samples ?? 0;

    const samplesRes = await apiQcGetSamples(selectedStartDate);
    const samples = samplesRes.samples || [];

    // Construct mock trip containers from sample data
    renderFallbackTripBoxes(samples);
  } catch (err) {
    console.error('Fallback error:', err);
  }
}

function renderTripSection(tripList, visitList, containerId, isCompletedSection) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (tripList.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:24px; color:#94A3B8; font-weight:600;">
        No ${isCompletedSection ? 'completed' : 'active'} trips found for the selected date range.
      </div>
    `;
    return;
  }

  const dash = `<span style="color:#94A3B8; font-weight:600;">-</span>`;

  container.innerHTML = tripList.map((t, idx) => {
    const tripVisits = visitList.filter(v => v.trip_id === t.id);
    const routeName = t.route_description || t.trip_name || 'Route - ' + (idx + 1);
    const driverName = t.driver_name || t.driver?.name || '-';
    const tankerNo = t.tanker_number || t.vehicle_number || '-';

    const bmcRows = tripVisits.length === 0
      ? `<tr><td colspan="${isCompletedSection ? 6 : 5}" style="text-align:center; padding:16px; color:#94A3B8;">No BMC visits recorded for this trip.</td></tr>`
      : tripVisits.map(v => {
          const dateStr = v.created_at ? new Date(v.created_at).toLocaleDateString('en-IN') : '-';
          const batchStr = v.bmc?.name || v.bmc_name || '-';
          
          const macs = v.macs || {};
          const macsStr = (macs.liters !== null && macs.liters !== undefined)
            ? `<span style="font-weight:700; color:#1E3A8A;">${macs.liters} L</span> (${macs.kg || '-'} KG)`
            : dash;

          const spot = v.spot_analyzer || v.spot || {};
          const spotStr = (spot.liters !== null && spot.liters !== undefined)
            ? `<span style="font-weight:700; color:#92400E;">${spot.liters} L</span> (${spot.kg || '-'} KG)`
            : (v.spot_analyzer_reading ? `<span style="font-weight:700;">${v.spot_analyzer_reading}</span>` : dash);

          const diary = v.diary || {};
          const diaryStr = (diary.liters !== null && diary.liters !== undefined)
            ? `<span style="font-weight:700; color:#065F46;">${diary.liters} L</span> (${diary.kg || '-'} KG)`
            : (v.diary_reading ? `<span style="font-weight:700;">${v.diary_reading}</span>` : dash);

          const testBtn = `
            <a href="test.html?visit_id=${v.id}" class="btn-qc" style="background:#2563EB; color:white; padding:4px 12px; border-radius:6px; font-weight:700; font-size:0.78rem; text-decoration:none; display:inline-block;">
              🧪 Test
            </a>
          `;

          return `
            <tr>
              <td><strong>${dateStr}</strong></td>
              <td style="font-weight:700; color:#0F172A;">${esc(batchStr)}</td>
              <td>${macsStr}</td>
              <td>${spotStr}</td>
              <td>${diaryStr}</td>
              ${isCompletedSection ? `<td>${testBtn}</td>` : ''}
            </tr>
          `;
        }).join('');

    return `
      <div style="border: 2px solid #2563EB; border-radius: 12px; overflow: hidden; background: white; box-shadow: 0 4px 12px rgba(37,99,235,0.08);">
        <!-- Blue Trip Box Header -->
        <div style="background: linear-gradient(135deg, #1E40AF, #2563EB); color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
            <span style="background:rgba(255,255,255,0.2); padding:3px 10px; border-radius:8px; font-weight:800; font-size:0.85rem;">S.No: ${idx + 1}</span>
            <span style="font-weight:800; font-size:1rem;">📍 Route: ${esc(routeName)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:16px; font-size:0.88rem; font-weight:600;">
            <span>🚛 Tanker: <strong>${esc(tankerNo)}</strong></span>
            <span>👤 Driver: <strong>${esc(driverName)}</strong></span>
          </div>
        </div>

        <!-- Visited BMCs Table -->
        <div class="qc-table-wrap" style="border:none;">
          <table class="qc-table">
            <thead>
              <tr style="background:#F8FAFC; color:#475569;">
                <th>Date</th>
                <th>Batch / BMC</th>
                <th>MACS</th>
                <th>Spot Analyzer</th>
                <th>Diary</th>
                ${isCompletedSection ? '<th>Action</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${bmcRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

function renderFallbackTripBoxes(samples) {
  const activeContainer = document.getElementById('active-trips-container');
  const completedContainer = document.getElementById('completed-trips-container');
  if (!activeContainer || !completedContainer) return;

  const dash = `<span style="color:#94A3B8; font-weight:600;">-</span>`;

  if (samples.length === 0) {
    activeContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#94A3B8;">No active trips.</div>`;
    completedContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#94A3B8;">No completed trips.</div>`;
    return;
  }

  const rows = samples.map((s, idx) => {
    const bmcName = s.bmc ? s.bmc.name : 'BMC Center';
    const dateStr = s.visit_end_time ? new Date(s.visit_end_time).toLocaleDateString() : 'Today';

    return `
      <tr>
        <td><strong>${dateStr}</strong></td>
        <td style="font-weight:700;">${esc(bmcName)}</td>
        <td>${dash}</td>
        <td>${dash}</td>
        <td>${dash}</td>
        <td>
          <a href="test.html?visit_id=${s.id}" class="btn-qc" style="background:#2563EB; color:white; padding:4px 12px; border-radius:6px; font-weight:700; font-size:0.78rem; text-decoration:none;">
            🧪 Test
          </a>
        </td>
      </tr>
    `;
  }).join('');

  const tripBoxHtml = `
    <div style="border: 2px solid #2563EB; border-radius: 12px; overflow: hidden; background: white;">
      <div style="background: linear-gradient(135deg, #1E40AF, #2563EB); color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight:800;">S.No: 1 &nbsp;|&nbsp; Route: Main Collection Route</span>
        <span style="font-weight:600;">🚛 Tanker: TN-39-AA-1234 &nbsp;|&nbsp; 👤 Driver: Main Driver</span>
      </div>
      <div class="qc-table-wrap">
        <table class="qc-table">
          <thead>
            <tr><th>Date</th><th>Batch / BMC</th><th>MACS</th><th>Spot Analyzer</th><th>Diary</th><th>Action</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  activeContainer.innerHTML = tripBoxHtml;
  completedContainer.innerHTML = tripBoxHtml;
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

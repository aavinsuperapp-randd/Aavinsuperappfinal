// gm-dashboard.js — Executive Overview Page Logic

let currentDashboardData = null;
let selectedDate = '';

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('gm');
  if (!profile) return;

  if (document.getElementById('header-gm-name')) {
    document.getElementById('header-gm-name').textContent = profile.name || 'General Manager';
  }

  function getLocalDateStr(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Setup Date Picker default (Today)
  const todayStr = getLocalDateStr();
  selectedDate = todayStr;
  const datePicker = document.getElementById('gm-date-picker');
  if (datePicker) {
    datePicker.value = todayStr;
    datePicker.addEventListener('change', (e) => {
      selectedDate = e.target.value;
      updatePresetButtonUI('');
      loadDashboardData();
    });
  }

  // Presets
  const btnToday = document.getElementById('btn-preset-today');
  const btnYesterday = document.getElementById('btn-preset-yesterday');

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      selectedDate = getLocalDateStr();
      if (datePicker) datePicker.value = selectedDate;
      updatePresetButtonUI('today');
      loadDashboardData();
    });
  }
  if (btnYesterday) {
    btnYesterday.addEventListener('click', () => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      selectedDate = getLocalDateStr(y);
      if (datePicker) datePicker.value = selectedDate;
      updatePresetButtonUI('yesterday');
      loadDashboardData();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // Exports
  const exportExcelBtn = document.getElementById('export-excel-btn');
  if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportToExcel);

  const exportPdfBtn = document.getElementById('export-pdf-btn');
  if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportToPDF);

  const searchInput = document.getElementById('trip-search-input');
  const statusFilter = document.getElementById('trip-status-filter');
  if (searchInput) searchInput.addEventListener('input', () => { if(currentDashboardData) renderTripsTable(currentDashboardData.trips); });
  if (statusFilter) statusFilter.addEventListener('change', () => { if(currentDashboardData) renderTripsTable(currentDashboardData.trips); });

  setupTripDetailModal();
  await loadDashboardData();
});

function updatePresetButtonUI(activeType) {
  const btnToday = document.getElementById('btn-preset-today');
  const btnYesterday = document.getElementById('btn-preset-yesterday');
  if (btnToday) btnToday.classList.toggle('active', activeType === 'today');
  if (btnYesterday) btnYesterday.classList.toggle('active', activeType === 'yesterday');
}

async function loadDashboardData() {
  try {
    const data = await apiGetGmDashboardV2(selectedDate);
    currentDashboardData = data;
    renderOverview(data);
  } catch (err) {
    console.error('Failed to load GM Overview:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Failed to load operational overview.', 'error');
    }
  }
}

function renderOverview(data) {
  if (!data) return;
  const { date_formatted, kpis = {}, trips = [] } = data;

  const subEl = document.getElementById('dashboard-date-subtitle');
  if (subEl) subEl.textContent = `Operational Report for ${date_formatted || selectedDate}`;

  // KPIs
  if (document.getElementById('kpi-total-trips')) document.getElementById('kpi-total-trips').textContent = kpis.total_trips ?? 0;
  if (document.getElementById('kpi-active-trips')) document.getElementById('kpi-active-trips').textContent = kpis.active_trips ?? 0;
  if (document.getElementById('kpi-completed-trips')) document.getElementById('kpi-completed-trips').textContent = kpis.completed_trips ?? 0;
  if (document.getElementById('kpi-total-milk')) document.getElementById('kpi-total-milk').textContent = `${(kpis.total_milk_liters || 0).toLocaleString()} kg`;

  // Trip Operations
  renderTripsTable(trips);
}



function exportToExcel() {
  if (!currentDashboardData || typeof XLSX === 'undefined') {
    alert('Excel library loading or data unavailable.');
    return;
  }

  const { date_formatted, kpis, trips, workers, bmcs } = currentDashboardData;
  const wb = XLSX.utils.book_new();

  const summaryData = [
    { Metric: 'Report Date', Value: date_formatted },
    { Metric: 'Total Trips', Value: kpis.total_trips },
    { Metric: 'Active Trips', Value: kpis.active_trips },
    { Metric: 'Completed Trips', Value: kpis.completed_trips },
    { Metric: 'Milk Collected (kg)', Value: kpis.total_milk_liters }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'Summary');

  const tripsData = trips.map(t => ({
    'Trip Name': t.trip_name,
    'Worker': t.worker_name,
    'Driver': t.driver_name,
    'Vehicle': t.tanker_number,
    'Route': t.route,
    'Out Time': t.out_time,
    'In Time': t.in_time || 'In Transit',
    'Status': t.status
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tripsData), 'All Trips');

  XLSX.writeFile(wb, `AAVIN_GM_Overview_${selectedDate}.xlsx`);
}

function exportToPDF() {
  if (!currentDashboardData || !window.jspdf) {
    window.print();
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const { date_formatted, kpis, trips } = currentDashboardData;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('AAVIN General Management Operational Report', 14, 18);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${date_formatted}`, 14, 25);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Operational Summary KPIs', 14, 40);

  const kpiRows = [
    ['Total Trips:', String(kpis.total_trips), 'Active Trips:', String(kpis.active_trips)],
    ['Finished Trips:', String(kpis.completed_trips), 'Milk Collected:', `${kpis.total_milk_liters} kg`]
  ];

  doc.autoTable({
    startY: 44,
    body: kpiRows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } }
  });

  doc.save(`AAVIN_GM_Executive_Report_${selectedDate}.pdf`);
}

// ── Trips Table & Modal Logic ────────────────────────────────────────────────
function renderTripsTable(trips = []) {
  const tbody = document.getElementById('trips-table-body');
  if (!tbody) return;

  const searchVal = (document.getElementById('trip-search-input')?.value || '').toLowerCase().trim();
  const statusFilter = (document.getElementById('trip-status-filter')?.value || '').toLowerCase();

  let filtered = trips.filter(t => {
    const matchSearch = !searchVal ||
      (t.trip_name || '').toLowerCase().includes(searchVal) ||
      (t.worker_name || '').toLowerCase().includes(searchVal) ||
      (t.driver_name || '').toLowerCase().includes(searchVal) ||
      (t.tanker_number || '').toLowerCase().includes(searchVal) ||
      (t.route || '').toLowerCase().includes(searchVal);
    const matchStatus = !statusFilter || (t.status || '').toLowerCase() === statusFilter;
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:24px;">No trips found matching criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const statusClass = (t.status || 'pending').toLowerCase();
    const shortId = t.id ? t.id.slice(0, 8) : 'TRIP';

    return `
      <tr onclick="openTripDetailModal('${t.id}')">
        <td><strong>${esc(t.trip_name)}</strong><div class="text-xs text-muted">ID: ${shortId}</div></td>
        <td>${esc(t.worker_name)}</td>
        <td>${esc(t.driver_name || '—')}</td>
        <td><span class="badge badge-neutral">${esc(t.tanker_number || '—')}</span></td>
        <td><span class="text-sm" title="${esc(t.route)}">${esc(t.route || 'No BMCs yet')}</span></td>
        <td>${formatTime(t.out_time)}</td>
        <td>${t.in_time ? formatTime(t.in_time) : '—'}</td>
        <td><span class="status-badge ${statusClass}">${t.status || 'Pending'}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); openTripDetailModal('${t.id}')">
            🔍 Details
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function setupTripDetailModal() {
  const modal = document.getElementById('trip-detail-modal');
  const closeBtn = document.getElementById('trip-modal-close');
  const dismissBtn = document.getElementById('trip-modal-dismiss-btn');

  function closeModal() {
    if (modal) modal.classList.add('hidden');
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }
}

window.openTripDetailModal = function(tripId) {
  if (!currentDashboardData || !currentDashboardData.trips) return;
  const trip = currentDashboardData.trips.find(t => t.id === tripId);
  if (!trip) return;

  const modal = document.getElementById('trip-detail-modal');
  if (!modal) return;

  document.getElementById('modal-trip-name').textContent = trip.trip_name;
  document.getElementById('modal-trip-meta').textContent = `Status: ${(trip.status || 'Pending').toUpperCase()} | Created: ${new Date(trip.created_at).toLocaleString()}`;
  document.getElementById('modal-worker-name').textContent = trip.worker_name;
  document.getElementById('modal-driver-vehicle').textContent = `${trip.driver_name || 'Driver'} (${trip.tanker_number || 'Tanker'})`;
  document.getElementById('modal-out-time').textContent = formatTime(trip.out_time);
  document.getElementById('modal-in-time').textContent = trip.in_time ? formatTime(trip.in_time) : 'Active In-Transit';

  // Render BMC visits
  const vBody = document.getElementById('modal-visits-body');
  if (vBody) {
    const visits = trip.visits || [];
    if (visits.length === 0) {
      vBody.innerHTML = `<tr><td colspan="5" class="text-muted text-center" style="padding:20px;">No BMC visits recorded for this trip yet.</td></tr>`;
    } else {
      vBody.innerHTML = visits.map(v => {
        const ftirBadge = v.ftir_result && v.ftir_result.includes('✓') ? 'completed' : (v.ftir_result === 'Not Tested' ? 'cancelled' : 'pending');
        const gerberBadge = v.gerber_result && v.gerber_result.includes('✓') ? 'completed' : (v.gerber_result === 'Not Tested' ? 'cancelled' : 'pending');

        return `
          <tr>
            <td><strong>${v.visit_sequence || '—'}</strong></td>
            <td><strong>${esc(v.bmc_name)}</strong></td>
            <td>${esc(v.milk_quantity_formatted || (v.milk_quantity_liters ? `${v.milk_quantity_liters} kg` : '—'))}</td>
            <td><span class="status-badge ${ftirBadge}">${esc(v.ftir_result)}</span></td>
            <td><span class="status-badge ${gerberBadge}">${esc(v.gerber_result)}</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  modal.classList.remove('hidden');
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

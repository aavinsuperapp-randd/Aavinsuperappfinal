// gm-dashboard.js — GM Portal Executive Overview Logic

let currentDashboardData = null;
let currentFilter = {
  preset: 'today',
  startDate: '',
  endDate: ''
};

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

  const todayStr = getLocalDateStr();
  const defaultFromDate = '2026-08-01'; // Default start of current operational period so data loads immediately
  currentFilter = { preset: 'custom', startDate: defaultFromDate, endDate: todayStr };

  const fromDateInput = document.getElementById('gm-from-date');
  const toDateInput = document.getElementById('gm-to-date');
  if (fromDateInput) fromDateInput.value = defaultFromDate;
  if (toDateInput) toDateInput.value = todayStr;

  // Presets
  const btnToday = document.getElementById('btn-preset-today');
  const btnYesterday = document.getElementById('btn-preset-yesterday');

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      const today = getLocalDateStr();
      currentFilter = { preset: 'today', startDate: today, endDate: today };
      if (fromDateInput) fromDateInput.value = today;
      if (toDateInput) toDateInput.value = today;
      updatePresetButtonUI('today');
      loadDashboardData();
    });
  }

  if (btnYesterday) {
    btnYesterday.addEventListener('click', () => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = getLocalDateStr(y);
      currentFilter = { preset: 'yesterday', startDate: yStr, endDate: yStr };
      if (fromDateInput) fromDateInput.value = yStr;
      if (toDateInput) toDateInput.value = yStr;
      updatePresetButtonUI('yesterday');
      loadDashboardData();
    });
  }

  // Date Range Search Button
  const searchBtn = document.getElementById('btn-date-search');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const sDate = fromDateInput?.value;
      const eDate = toDateInput?.value;
      if (!sDate || !eDate) {
        if (typeof showToast === 'function') showToast('Please select both From Date and To Date.', 'error');
        return;
      }
      if (sDate > eDate) {
        if (typeof showToast === 'function') showToast('From Date cannot be later than To Date.', 'error');
        return;
      }
      currentFilter = { preset: 'custom', startDate: sDate, endDate: eDate };
      updatePresetButtonUI('custom');
      loadDashboardData();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // Export PDF
  const exportPdfBtn = document.getElementById('export-pdf-btn');
  if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportToPDF);

  const searchInput = document.getElementById('trip-search-input');
  const statusFilter = document.getElementById('trip-status-filter');
  if (searchInput) searchInput.addEventListener('input', () => { if (currentDashboardData) renderTripBoxes(currentDashboardData.trips); });
  if (statusFilter) statusFilter.addEventListener('change', () => { if (currentDashboardData) renderTripBoxes(currentDashboardData.trips); });

  setupTripDetailModal();
  setupAssignWorkerModal();
  await loadDashboardData();
  if (document.getElementById('pending-trips-table-body')) {
    await loadPendingTrips();
  }
});

function updatePresetButtonUI(activeType) {
  const btnToday = document.getElementById('btn-preset-today');
  const btnYesterday = document.getElementById('btn-preset-yesterday');
  if (btnToday) btnToday.classList.toggle('active', activeType === 'today');
  if (btnYesterday) btnYesterday.classList.toggle('active', activeType === 'yesterday');
}

async function loadDashboardData() {
  try {
    let param;
    if (currentFilter.startDate === currentFilter.endDate) {
      param = currentFilter.startDate;
    } else {
      param = { startDate: currentFilter.startDate, endDate: currentFilter.endDate };
    }
    const data = await apiGetGmDashboardV2(param);
    currentDashboardData = data;
    renderOverview(data);
  } catch (err) {
    console.error('Failed to load GM Operational Overview:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Failed to load operational overview.', 'error');
    }
  }
}

function renderOverview(data) {
  if (!data) return;
  const { date_formatted, kpis = {}, trips = [] } = data;

  const subEl = document.getElementById('dashboard-date-subtitle');
  if (subEl) {
    const rangeText = currentFilter.startDate === currentFilter.endDate
      ? currentFilter.startDate
      : `${currentFilter.startDate} to ${currentFilter.endDate}`;
    subEl.textContent = `Operational Report for ${date_formatted || rangeText}`;
  }

  // KPIs
  if (document.getElementById('kpi-total-trips')) document.getElementById('kpi-total-trips').textContent = kpis.total_trips ?? trips.length;
  if (document.getElementById('kpi-active-trips')) document.getElementById('kpi-active-trips').textContent = kpis.active_trips ?? trips.filter(t => t.status === 'active').length;
  if (document.getElementById('kpi-completed-trips')) document.getElementById('kpi-completed-trips').textContent = kpis.completed_trips ?? trips.filter(t => t.status === 'completed').length;
  if (document.getElementById('kpi-total-milk')) document.getElementById('kpi-total-milk').textContent = `${(kpis.total_milk_liters || 0).toLocaleString()} kg`;

  // Trip Operations as Blue Boxes
  renderTripBoxes(trips);
}



function exportToExcel() {
  if (!currentDashboardData || typeof XLSX === 'undefined') {
    if (typeof showToast === 'function') showToast('Excel library loading or data unavailable.', 'error');
    return;
  }

  const { date_formatted, kpis, trips } = currentDashboardData;
  const wb = XLSX.utils.book_new();

  // 1. Executive Summary Sheet
  const summaryData = [
    { Metric: 'MADURAI DISTRICT CO-OPERATIVE MILK PRODUCER\'S UNION LTD', Value: 'MADURAI-20' },
    { Metric: 'Operational Report Date', Value: date_formatted || selectedDate },
    { Metric: 'Total Field Trips', Value: kpis.total_trips || 0 },
    { Metric: 'Active Trips In-Transit', Value: kpis.active_trips || 0 },
    { Metric: 'Completed Trips', Value: kpis.completed_trips || 0 },
    { Metric: 'Total Milk Volume Collected (kg)', Value: kpis.total_milk_liters || 0 }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'Executive Summary');

  // 2. All Trip Operations Overview Sheet
  const tripsData = (trips || []).map(t => {
    let totalMilkKg = 0;
    (t.visits || []).forEach(v => {
      if (v.milk_quantity_liters) totalMilkKg += Number(v.milk_quantity_liters);
    });

    return {
      'Trip ID': t.id ? t.id.slice(0, 8) : '—',
      'Trip Name': t.trip_name || '—',
      'Assigned Worker': t.worker_name || '—',
      'Driver Name': t.driver_name || '—',
      'Vehicle Board #': t.tanker_number || '—',
      'Visited BMC Route': t.route || 'No BMCs visited',
      'Out Time (Start)': t.out_time ? new Date(t.out_time).toLocaleTimeString() : '—',
      'In Time (End)': t.in_time ? new Date(t.in_time).toLocaleTimeString() : 'In Transit',
      'Total BMCs Visited': (t.visits || []).length,
      'Total Milk Collected (kg)': totalMilkKg ? `${totalMilkKg} kg` : '—',
      'Status': (t.status || 'pending').toUpperCase()
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tripsData), 'Trip Operations Overview');

  // 3. Detailed BMC Visits & Quality Tests Sheet
  const detailedVisitRows = [];
  (trips || []).forEach(t => {
    const visits = t.visits || [];
    if (visits.length === 0) {
      detailedVisitRows.push({
        'Trip Name': t.trip_name || '—',
        'Worker': t.worker_name || '—',
        'Vehicle': t.tanker_number || '—',
        'Visit Seq': '—',
        'BMC Name': 'No BMC visits recorded',
        'Milk Quantity': '—',
        'FTIR Result': '—',
        'Gerber Result': '—',
        'Visit Status': 'Pending'
      });
    } else {
      visits.forEach(v => {
        detailedVisitRows.push({
          'Trip Name': t.trip_name || '—',
          'Worker': t.worker_name || '—',
          'Vehicle': t.tanker_number || '—',
          'Visit Seq': v.visit_sequence || 1,
          'BMC Name': v.bmc_name || '—',
          'Milk Quantity': v.milk_quantity_formatted || (v.milk_quantity_liters ? `${v.milk_quantity_liters} kg` : '—'),
          'FTIR Result': v.ftir_result || '—',
          'Gerber Result': v.gerber_result || '—',
          'Visit Status': (v.status || 'completed').toUpperCase()
        });
      });
    }
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailedVisitRows), 'Detailed BMC Quality Tests');

  XLSX.writeFile(wb, `AAVIN_PIAgm_Operational_Report_${selectedDate}.xlsx`);
  if (typeof showToast === 'function') showToast('Detailed Excel report generated!', 'success');
}

function exportToPDF() {
  if (!currentDashboardData || !window.jspdf) {
    window.print();
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const { date_formatted, kpis = {}, trips = [] } = currentDashboardData;

  const dateFilterStr = currentFilter.startDate === currentFilter.endDate
    ? `Date: ${currentFilter.startDate}`
    : `Date Range: ${currentFilter.startDate} to ${currentFilter.endDate}`;

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MADURAI DISTRICT CO-OPERATIVE MILK PRODUCER\'S UNION LTD', 14, 12);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`GM PORTAL — Operational Overview Report (${dateFilterStr})`, 14, 20);

  // Executive Summary Section
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary KPIs', 14, 36);

  const kpiRows = [
    ['Total Field Trips:', String(kpis.total_trips || trips.length), 'Active Trips:', String(kpis.active_trips || trips.filter(t => t.status === 'active').length)],
    ['Finished Trips:', String(kpis.completed_trips || trips.filter(t => t.status === 'completed').length), 'Total Milk Collected:', `${(kpis.total_milk_liters || 0).toLocaleString()} kg`]
  ];

  doc.autoTable({
    startY: 39,
    body: kpiRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } }
  });

  let currentY = doc.lastAutoTable.finalY + 8;

  // Trips & BMC Sequence Section
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Field Trip Operations & Visited BMC Sequence', 14, currentY);

  const tableColumns = ['S.No', 'Route / Trip Name', 'Tanker', 'Driver', 'Status', 'Visits (In Sequence) & Quantities'];
  const tableRows = (trips || []).map((t, idx) => {
    const visits = (t.visits || []).slice().sort((a, b) => (a.visit_sequence || 0) - (b.visit_sequence || 0));
    const visitsStr = visits.length === 0
      ? 'No BMC visits'
      : visits.map(v => `${v.visit_sequence || 1}. ${v.bmc_name} (${v.milk_quantity_liters ? `${v.milk_quantity_liters} kg` : '-'})`).join('\n');

    return [
      String(idx + 1),
      t.trip_name || '—',
      t.tanker_number || '—',
      t.driver_name || '—',
      (t.status || 'pending').toUpperCase(),
      visitsStr
    ];
  });

  doc.autoTable({
    startY: currentY + 3,
    head: [tableColumns],
    body: tableRows,
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 3, verticalAlignment: 'middle' },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 35, fontStyle: 'bold' },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
      4: { cellWidth: 20, fontStyle: 'bold' },
      5: { cellWidth: 65 }
    }
  });

  const filename = `GM_Portal_Report_${currentFilter.startDate}_to_${currentFilter.endDate}.pdf`;
  doc.save(filename);
  if (typeof showToast === 'function') showToast('PDF operational report downloaded successfully!', 'success');
}

// ── Pending Trips (Transport Manager trips awaiting worker assignment) ─────────

window._allPendingTrips = [];

async function loadPendingTrips() {
  const tbody = document.getElementById('pending-trips-table-body');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:20px;">Loading trip assignments...</td></tr>`;

  try {
    const { trips = [] } = await apiGetGmPendingTrips();
    window._allPendingTrips = trips;

    // Update badge count
    const badge = document.getElementById('pending-count-badge');
    const pendingCount = trips.filter(t => t.assignment_status === 'pending_assignment').length;
    if (badge) badge.textContent = pendingCount;

    renderPendingTripsTable(trips);
  } catch (err) {
    console.error('Failed to load pending trips:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:#EF4444; padding:20px;">Failed to load trips: ${err.message}</td></tr>`;
  }
}

function renderPendingTripsTable(trips = []) {
  const tbody = document.getElementById('pending-trips-table-body');
  if (!tbody) return;

  const searchVal = (document.getElementById('pending-search-input')?.value || '').toLowerCase().trim();
  const statusVal = (document.getElementById('pending-status-filter')?.value || '');

  let filtered = trips.filter(t => {
    const matchSearch = !searchVal ||
      (t.trip_name || '').toLowerCase().includes(searchVal) ||
      (t.driver_name || '').toLowerCase().includes(searchVal) ||
      (t.tanker_number || '').toLowerCase().includes(searchVal) ||
      (t.route_description || '').toLowerCase().includes(searchVal) ||
      (t.transport_officer_name || '').toLowerCase().includes(searchVal);
    const matchStatus = !statusVal || t.assignment_status === statusVal;
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">No trips found matching the filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const statusBadge = `<span class="assign-status-badge ${t.assignment_status || 'pending_assignment'}">${formatAssignStatus(t.assignment_status)}</span>`;
    const dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const timeStr = t.out_time ? new Date(t.out_time).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '—';
    const tripNum = t.trip_number || t.id.slice(0, 8).toUpperCase();
    const bmcText = t.bmc ? `${esc(t.bmc.name)} (${esc(t.bmc.district)})` : esc(t.route_description) || '—';

    const actionBtn = t.assignment_status === 'pending_assignment'
      ? `<button class="btn-assign" onclick="openAssignWorkerModal('${t.id}')" id="assign-btn-${t.id}">Assign Worker</button>`
      : `<button class="btn-reassign" onclick="openAssignWorkerModal('${t.id}')" id="assign-btn-${t.id}">Re-assign</button>`;

    const workerCell = t.assigned_worker_name
      ? `<strong>${esc(t.assigned_worker_name)}</strong>`
      : `<span style="color:#94A3B8; font-style:italic;">Unassigned</span>`;

    return `
      <tr>
        <td><strong>${esc(t.trip_name)}</strong><div class="text-xs text-muted">${tripNum}</div></td>
        <td>${dateStr}<div class="text-xs text-muted">${timeStr}</div></td>
        <td>${bmcText}</td>
        <td>${esc(t.driver_name || '—')}<div class="text-xs text-muted">${esc(t.tanker_number || '—')}</div></td>
        <td>${esc(t.transport_officer_name || 'Transport Manager')}</td>
        <td>${workerCell}</td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

function formatAssignStatus(status) {
  const map = {
    pending_assignment: 'Pending Assignment',
    worker_assigned: 'Worker Assigned',
    in_progress: 'In Progress',
    testing_completed: 'Testing Done',
    report_submitted: 'Report Submitted',
    completed: 'Completed'
  };
  return map[status] || (status || 'Pending');
}

// ── Assign Worker Modal ────────────────────────────────────────────────────────

let assigningTripId = null;
let selectedWorkerId = null;
let _availableWorkers = [];

function setupAssignWorkerModal() {
  const modal = document.getElementById('assign-worker-modal');
  const closeBtn = document.getElementById('aw-modal-close');
  const cancelBtn = document.getElementById('aw-cancel-btn');
  const assignBtn = document.getElementById('aw-assign-btn');

  function closeModal() {
    if (modal) modal.classList.add('hidden');
    assigningTripId = null;
    selectedWorkerId = null;
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  if (assignBtn) {
    assignBtn.addEventListener('click', async () => {
      if (!assigningTripId || !selectedWorkerId) return;

      assignBtn.disabled = true;
      assignBtn.textContent = 'Assigning...';

      try {
        const result = await apiAssignWorkerToTrip(assigningTripId, selectedWorkerId);
        if (typeof showToast === 'function') {
          showToast(result.message || 'Worker assigned successfully!', 'success');
        }
        closeModal();
        await loadPendingTrips(); // Refresh the table
      } catch (err) {
        console.error('Assignment failed:', err);
        if (typeof showToast === 'function') showToast(err.message || 'Assignment failed.', 'error');
      } finally {
        assignBtn.disabled = false;
        assignBtn.textContent = 'Assign Worker';
      }
    });
  }
}

window.openAssignWorkerModal = async function(tripId) {
  const modal = document.getElementById('assign-worker-modal');
  if (!modal) return;

  assigningTripId = tripId;
  selectedWorkerId = null;

  // Find trip info from cached list
  const trip = (window._allPendingTrips || []).find(t => t.id === tripId);

  // Populate trip info
  const infoEl = document.getElementById('aw-trip-info');
  if (infoEl && trip) {
    infoEl.innerHTML = `
      <strong>Trip:</strong> ${esc(trip.trip_name)} (${trip.trip_number || tripId.slice(0, 8).toUpperCase()})<br>
      <strong>Driver:</strong> ${esc(trip.driver_name || '—')} &nbsp;|&nbsp;
      <strong>Vehicle:</strong> ${esc(trip.tanker_number || '—')}<br>
      <strong>Created by:</strong> ${esc(trip.transport_officer_name || 'Transport Manager')}<br>
      <strong>Route:</strong> ${esc(trip.route_description || 'Not specified')}
    `;
  }

  // Reset assign button
  const assignBtn = document.getElementById('aw-assign-btn');
  if (assignBtn) { assignBtn.disabled = true; assignBtn.textContent = 'Assign Worker'; }

  // Show modal with loading state
  modal.classList.remove('hidden');
  const workerList = document.getElementById('aw-worker-list');
  if (workerList) workerList.innerHTML = '<div class="aw-empty">Loading field workers...</div>';

  try {
    const { workers = [] } = await apiGetGmAvailableWorkers();
    _availableWorkers = workers;

    if (workers.length === 0) {
      if (workerList) workerList.innerHTML = '<div class="aw-empty">No approved Field Workers found.</div>';
      return;
    }

    if (workerList) {
      workerList.innerHTML = workers.map(w => {
        const initials = (w.name || 'W').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
        const isBusy = w.active_trips > 0;
        const availClass = isBusy ? 'busy' : 'free';
        const alreadyAssigned = trip && trip.assigned_worker_id === w.id;

        return `
          <div class="aw-worker-item ${alreadyAssigned ? 'selected' : ''}" 
               onclick="selectWorker('${w.id}', this)"
               data-worker-id="${w.id}">
            <div class="aw-worker-avatar">${initials}</div>
            <div style="flex:1;">
              <div class="aw-worker-name">${esc(w.name)} ${alreadyAssigned ? '✓ Currently Assigned' : ''}</div>
              <div style="font-size:0.75rem; color:#64748B;">${esc(w.email)}</div>
            </div>
            <span class="aw-worker-avail ${availClass}">${w.availability}</span>
          </div>
        `;
      }).join('');

      // Pre-select if already assigned
      if (trip && trip.assigned_worker_id) {
        selectedWorkerId = trip.assigned_worker_id;
        if (assignBtn) assignBtn.disabled = false;
      }
    }
  } catch (err) {
    console.error('Failed to load workers:', err);
    if (workerList) workerList.innerHTML = `<div class="aw-empty" style="color:#EF4444;">Failed to load workers: ${esc(err.message)}</div>`;
  }
};

window.selectWorker = function(workerId, el) {
  selectedWorkerId = workerId;

  // Highlight selection
  document.querySelectorAll('.aw-worker-item').forEach(item => item.classList.remove('selected'));
  el.classList.add('selected');

  const assignBtn = document.getElementById('aw-assign-btn');
  if (assignBtn) assignBtn.disabled = false;
};

function renderTripBoxes(trips = []) {
  const container = document.getElementById('trips-boxes-container');
  if (!container) return;

  const searchVal = (document.getElementById('trip-search-input')?.value || '').toLowerCase().trim();
  const statusFilter = (document.getElementById('trip-status-filter')?.value || '').toLowerCase();

  let filtered = trips.filter(t => {
    const matchSearch = !searchVal ||
      (t.trip_name || '').toLowerCase().includes(searchVal) ||
      (t.worker_name || '').toLowerCase().includes(searchVal) ||
      (t.driver_name || '').toLowerCase().includes(searchVal) ||
      (t.tanker_number || '').toLowerCase().includes(searchVal) ||
      (t.route || '').toLowerCase().includes(searchVal) ||
      (t.visits || []).some(v => (v.bmc_name || '').toLowerCase().includes(searchVal));
    const matchStatus = !statusFilter || (t.status || '').toLowerCase() === statusFilter;
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="content-card text-center text-muted" style="padding:40px;">
        🔍 No field trips found matching the selected filter criteria.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((t, idx) => {
    const sNo = idx + 1;
    const statusClass = (t.status || 'pending').toLowerCase();
    const isCompleted = statusClass === 'completed';
    const statusBadge = isCompleted
      ? `<span class="badge badge-success" style="font-size:0.8rem; font-weight:700;">✅ FINISHED</span>`
      : `<span class="badge badge-blue" style="font-size:0.8rem; font-weight:700;">🔄 ACTIVE</span>`;

    const visits = (t.visits || []).slice().sort((a, b) => (a.visit_sequence || 0) - (b.visit_sequence || 0));

    const bmcRowsHtml = visits.length === 0
      ? `<div class="text-xs text-muted" style="padding:10px;">No BMC visits recorded yet for this trip.</div>`
      : visits.map((v, vIdx) => {
          const seqNum = v.visit_sequence || (vIdx + 1);
          const qtyText = v.milk_quantity_formatted && v.milk_quantity_formatted !== '—' ? v.milk_quantity_formatted : (v.milk_quantity_liters ? `${v.milk_quantity_liters} L` : '—');
          const ftirText = v.ftir_result && v.ftir_result !== '—' && v.ftir_result !== 'Pending' ? v.ftir_result : '—';
          const gerberText = v.gerber_result && v.gerber_result !== '—' && v.gerber_result !== 'Pending' ? v.gerber_result : '—';
          const compartmentText = v.compartment ? v.compartment.charAt(0).toUpperCase() + v.compartment.slice(1) : '';
          const visitStatusBadge = v.status === 'completed' || v.status === 'visited'
            ? `<span style="background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;">✅ Visited</span>`
            : `<span style="background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;">⏳ Pending</span>`;

          return `
            <div class="bmc-sequence-item">
              <div class="bmc-item-left">
                <span class="bmc-seq-num">${seqNum}</span>
                <span class="bmc-item-name">${esc(v.bmc_name)}</span>
                ${compartmentText ? `<span style="background:#EFF6FF;color:#1E40AF;padding:1px 6px;border-radius:6px;font-size:0.68rem;font-weight:600;margin-left:4px;">${esc(compartmentText)}</span>` : ''}
                ${visitStatusBadge}
              </div>
              <div class="bmc-item-data">
                <span class="bmc-data-pill">🥛 Qty: <strong>${esc(qtyText)}</strong></span>
                <span class="bmc-data-pill">🔬 FTIR: <strong>${esc(ftirText)}</strong></span>
                <span class="bmc-data-pill">🧪 Gerber: <strong>${esc(gerberText)}</strong></span>
              </div>
            </div>
          `;
        }).join('');

    return `
      <div class="trip-blue-box" id="trip-box-${t.id}">
        <div class="trip-box-header">
          <div class="trip-box-header-left">
            <span class="trip-sno-badge">S.No: ${sNo}</span>
            <h4 class="trip-route-title">${esc(t.trip_name || 'Route Trip')}</h4>
          </div>
          <div class="d-flex align-items-center gap-2" style="gap:8px;">
            ${statusBadge}
            <button class="btn btn-sm btn-outline" onclick="openTripDetailModal('${t.id}')" title="View Trip Details">🔍 Details</button>
            <button class="btn btn-sm btn-outline" style="color:#ef4444; border-color:#fca5a5;" onclick="deleteTripByGm('${t.id}')" title="Delete Trip">🗑️ Delete</button>
          </div>
        </div>

        <div class="trip-box-meta-grid">
          <div class="trip-meta-tag">🗺️ <strong>Route Name:</strong> ${esc(t.route && t.route !== '—' ? t.route : (t.trip_name || '-'))}</div>
          <div class="trip-meta-tag">🚛 <strong>Tanker:</strong> ${esc(t.tanker_number && t.tanker_number !== 'Unassigned' ? t.tanker_number : '-')}</div>
          <div class="trip-meta-tag">👨‍✈️ <strong>Driver:</strong> ${esc(t.driver_name && t.driver_name !== 'Unassigned' ? (t.driver_name === 'driver' ? 'Driver' : t.driver_name) : '-')}</div>
          <div class="trip-meta-tag">👷 <strong>Worker:</strong> ${esc(t.worker_name && t.worker_name !== 'Unknown Worker' ? t.worker_name : '-')}</div>
          <div class="trip-meta-tag">⏱️ <strong>Out:</strong> ${formatTime(t.out_time)} | <strong>In:</strong> ${t.in_time ? formatTime(t.in_time) : 'Active'}</div>
        </div>

        <div class="bmc-visit-sequence-container">
          <div class="bmc-sequence-header">📍 BMC Visited (In Actual Sequence):</div>
          <div class="bmc-sequence-list">
            ${bmcRowsHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTripsTable(trips = []) {
  renderTripBoxes(trips);
}

window.deleteTripByGm = async function(tripId, optionalTripName) {
  let tripName = optionalTripName;
  if (!tripName && currentDashboardData && currentDashboardData.trips) {
    const found = currentDashboardData.trips.find(t => t.id === tripId);
    if (found) tripName = found.trip_name;
  }
  if (!tripName) tripName = 'this trip';

  if (!confirm(`Are you sure you want to delete trip "${tripName}" permanently? This action cannot be undone.`)) return;
  if (typeof toggleLoading === 'function') toggleLoading(true);
  try {
    await apiGmDeleteTrip(tripId);
    if (typeof showToast === 'function') showToast('Trip deleted successfully.', 'success');
    await loadDashboardData();
    if (typeof loadPendingTrips === 'function') await loadPendingTrips();
  } catch (err) {
    console.error('❌ Failed to delete trip:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to delete trip.', 'error');
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
};

let activeModalTripId = null;

function setupTripDetailModal() {
  const modal = document.getElementById('trip-detail-modal');
  const closeBtn = document.getElementById('trip-modal-close');
  const dismissBtn = document.getElementById('trip-modal-dismiss-btn');
  const downloadExcelBtn = document.getElementById('modal-download-excel-btn');
  const downloadPdfBtn = document.getElementById('modal-download-pdf-btn');

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

  if (downloadExcelBtn) {
    downloadExcelBtn.addEventListener('click', () => {
      if (activeModalTripId) exportSingleTripExcelById(activeModalTripId);
    });
  }
  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', () => {
      if (activeModalTripId) exportSingleTripPDFById(activeModalTripId);
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
        const displayFtir = v.ftir_result ? v.ftir_result.replace(/\s*\[FAIL\]/gi, '').replace(/\s*\[PASS\]/gi, '') : '';
        const displayGerber = v.gerber_result ? v.gerber_result.replace(/\s*\[FAIL\]/gi, '').replace(/\s*\[PASS\]/gi, '') : '';

        return `
          <tr>
            <td><strong>${v.visit_sequence || '—'}</strong></td>
            <td><strong>${esc(v.bmc_name)}</strong></td>
            <td>${esc(v.macs_result || '—')}</td>
            <td>
              <div class="text-xs">Qty: ${esc(v.milk_quantity_formatted || (v.milk_quantity_liters ? `${v.milk_quantity_liters} kg` : '—'))}</div>
              <div class="text-xs text-muted">FTIR: ${esc(displayFtir)}</div>
              <div class="text-xs text-muted">Gerber: ${esc(displayGerber)}</div>
            </td>
            <td>${esc(v.diary_result || '—')}</td>
          </tr>
        `;
      }).join('');
    }
  }

  activeModalTripId = tripId;
  modal.classList.remove('hidden');
};

window.exportSingleTripExcelById = function(tripId) {
  if (!currentDashboardData || !currentDashboardData.trips) return;
  const trip = currentDashboardData.trips.find(t => t.id === tripId);
  if (trip) exportSingleTripExcel(trip);
};

window.exportSingleTripPDFById = function(tripId) {
  if (!currentDashboardData || !currentDashboardData.trips) return;
  const trip = currentDashboardData.trips.find(t => t.id === tripId);
  if (trip) exportSingleTripPDF(trip);
};

function exportSingleTripExcel(trip) {
  if (!trip || typeof XLSX === 'undefined') {
    if (typeof showToast === 'function') showToast('Excel library not ready.', 'error');
    return;
  }

  try {
    const aoa = [];
    aoa.push(['MADURAI DISTRICT CO-OPERATIVE MILK PRODUCER\'S UNION LTD - MADURAI-20']);
    aoa.push(['SPOT ACKNOWLEDGEMENT TEST DETAILS — TRIP: ' + (trip.trip_name || trip.id).toUpperCase()]);

    // Metadata subheader
    aoa.push([
      `Worker: ${trip.worker_name || '—'}`,
      `Driver: ${trip.driver_name || '—'}`,
      `Vehicle: ${trip.tanker_number || '—'}`,
      `Out Time: ${formatTime(trip.out_time)}`,
      `In Time: ${trip.in_time ? formatTime(trip.in_time) : 'Active In-Transit'}`,
      `Status: ${(trip.status || 'Pending').toUpperCase()}`
    ]);

    // Table Header rows
    aoa.push([
      'S.NO',
      'NAME OF THE BMC',
      'FTIR TEST', '', '',
      'GERBER TEST', '', '', '',
      'CONTAINER',
      'TOTAL (kg)',
      'SUMMARY'
    ]);
    aoa.push([
      '', '',
      'FAT', 'SNF', 'QNTY(KG)',
      'FAT', 'LMR', 'SNF', 'QNTY(KG)',
      '', '', ''
    ]);

    let grandTotalQty = 0;
    const visits = trip.visits || [];

    visits.forEach((v, idx) => {
      const bmcName = v.bmc_name || 'Unknown BMC';
      const qty = v.milk_quantity_liters ? Number(v.milk_quantity_liters) : null;
      if (qty && !bmcName.includes('(After Mixing)')) {
        grandTotalQty += qty;
      }

      let ftirFat = '-', ftirSnf = '-';
      if (v.ftir_result && v.ftir_result.includes('FAT:')) {
        const m = v.ftir_result.match(/FAT:\s*([0-9.]+).*?SNF:\s*([0-9.]+)/i);
        if (m) { ftirFat = m[1]; ftirSnf = m[2]; }
      }

      let gerberFat = '-', gerberLmr = '-', gerberSnf = '-';
      if (v.gerber_result && v.gerber_result.includes('FAT:')) {
        const m = v.gerber_result.match(/FAT:\s*([0-9.]+).*?SNF:\s*([0-9.]+)/i);
        if (m) { gerberFat = m[1]; gerberSnf = m[2]; }
      }

      const summaryText = `${v.ftir_result || '—'} | ${v.gerber_result || '—'}`;

      aoa.push([
        v.visit_sequence || (idx + 1),
        bmcName,
        ftirFat,
        ftirSnf,
        qty ? qty : '',
        gerberFat,
        gerberLmr,
        gerberSnf,
        qty ? qty : '',
        'Standard Tanker',
        qty ? qty : '-',
        summaryText
      ]);
    });

    // Total row
    aoa.push([
      '', '', '', '', '', '', '', '', '', '',
      grandTotalQty > 0 ? grandTotalQty : '-',
      ''
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Merges
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
      { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
      { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } },
      { s: { r: 3, c: 2 }, e: { r: 3, c: 4 } },
      { s: { r: 3, c: 5 }, e: { r: 3, c: 8 } },
      { s: { r: 3, c: 9 }, e: { r: 4, c: 9 } },
      { s: { r: 3, c: 10 }, e: { r: 4, c: 10 } },
      { s: { r: 3, c: 11 }, e: { r: 4, c: 11 } }
    ];

    ws['!cols'] = [
      { wch: 6 },   // S.NO
      { wch: 30 },  // BMC NAME
      { wch: 8 },   // FTIR FAT
      { wch: 8 },   // FTIR SNF
      { wch: 10 },  // FTIR QNTY
      { wch: 8 },   // GERBER FAT
      { wch: 8 },   // GERBER LMR
      { wch: 8 },   // GERBER SNF
      { wch: 10 },  // GERBER QNTY
      { wch: 15 },  // CONTAINER
      { wch: 12 },  // TOTAL (kg)
      { wch: 45 }   // SUMMARY
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Spot Acknowledgement');
    const filename = `AAVIN_Single_Trip_${(trip.trip_name || trip.id).replace(/\s+/g, '_')}_Report.xlsx`;
    XLSX.writeFile(wb, filename);

    if (typeof showToast === 'function') showToast('Single trip Excel report downloaded!', 'success');
  } catch (err) {
    console.error('Failed to export single trip Excel:', err);
    if (typeof showToast === 'function') showToast('Export failed: ' + err.message, 'error');
  }
}

function exportSingleTripPDF(trip) {
  if (!trip || !window.jspdf) {
    window.print();
    return;
  }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Header banner
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('MADURAI DISTRICT CO-OPERATIVE MILK PRODUCER\'S UNION LTD', 14, 15);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('SPOT ACKNOWLEDGEMENT & SINGLE TRIP OPERATIONAL REPORT', 14, 24);

    // Trip Metadata Card
    doc.setFillColor(248, 250, 252);
    doc.rect(14, 38, 182, 38, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(14, 38, 182, 38, 'S');

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Trip: ${(trip.trip_name || 'N/A').toUpperCase()}`, 18, 46);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Worker: ${trip.worker_name || '—'}`, 18, 54);
    doc.text(`Driver: ${trip.driver_name || '—'}`, 105, 54);
    doc.text(`Vehicle: ${trip.tanker_number || '—'}`, 18, 62);
    doc.text(`Status: ${(trip.status || 'Pending').toUpperCase()}`, 105, 62);
    doc.text(`Out Time: ${formatTime(trip.out_time)}`, 18, 70);
    doc.text(`In Time: ${trip.in_time ? formatTime(trip.in_time) : 'Active In-Transit'}`, 105, 70);

    // Visited BMC Table
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Visited BMC Sequence & Quality Test Results', 14, 84);

    const visits = trip.visits || [];
    const tableBody = visits.map(v => [
      String(v.visit_sequence || '—'),
      v.bmc_name || '—',
      v.milk_quantity_formatted || (v.milk_quantity_liters ? `${v.milk_quantity_liters} kg` : '—'),
      v.ftir_result || '—',
      v.gerber_result || '—'
    ]);

    if (tableBody.length === 0) {
      tableBody.push(['—', 'No BMC visits recorded for this trip yet.', '—', '—', '—']);
    }

    doc.autoTable({
      startY: 88,
      head: [['Seq', 'BMC Center Name', 'Milk Qty (kg)', 'FTIR Quality Test', 'Gerber Quality Test']],
      body: tableBody,
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 8.5, cellPadding: 3 }
    });

    const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 12 : 140;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    const totalMilk = visits.reduce((acc, v) => acc + (Number(v.milk_quantity_liters) || 0), 0);
    doc.text(`Total Milk Collected on Trip: ${totalMilk.toLocaleString()} kg`, 14, finalY);

    const filename = `AAVIN_Single_Trip_${(trip.trip_name || trip.id).replace(/\s+/g, '_')}_Report.pdf`;
    doc.save(filename);

    if (typeof showToast === 'function') showToast('Single trip PDF report downloaded!', 'success');
  } catch (err) {
    console.error('Failed to export single trip PDF:', err);
    if (typeof showToast === 'function') showToast('PDF Export failed: ' + err.message, 'error');
  }
}

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

// pi-agm-dashboard.js — P&I AGM Executive Overview Page Logic

let currentDashboardData = null;
let selectedDate = '';

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('pi_agm');
  if (!profile) return;

  if (document.getElementById('header-pi-agm-name')) {
    document.getElementById('header-pi-agm-name').textContent = profile.name || 'P&I AGM';
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
  const datePicker = document.getElementById('pi-agm-date-picker') || document.getElementById('gm-date-picker');
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
  setupAssignWorkerModal();
  await loadDashboardData();
  await loadPendingTrips();

  // Pending trips controls
  const refreshPendingBtn = document.getElementById('refresh-pending-btn');
  if (refreshPendingBtn) refreshPendingBtn.addEventListener('click', loadPendingTrips);

  const pendingSearch = document.getElementById('pending-search-input');
  if (pendingSearch) pendingSearch.addEventListener('input', () => {
    if (window._allPendingTrips) renderPendingTripsTable(window._allPendingTrips);
  });

  const pendingStatusFilter = document.getElementById('pending-status-filter');
  if (pendingStatusFilter) pendingStatusFilter.addEventListener('change', () => {
    if (window._allPendingTrips) renderPendingTripsTable(window._allPendingTrips);
  });
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
    console.error('Failed to load P&I AGM Overview:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Failed to load operational overview.', 'error');
    }
  }
}

function renderOverview(data) {
  if (!data) return;
  const { date_formatted, kpis = {}, trips = [], workers = [], drivers = [], tankers = [] } = data;

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
    if (typeof showToast === 'function') showToast('PDF generator library not loaded. Printing page...', 'info');
    window.print();
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const { kpis = {}, trips = [], tankers = [], workers = [], issues = [] } = currentDashboardData;

  const dateFilterStr = typeof currentFilter !== 'undefined' && currentFilter.startDate && currentFilter.endDate
    ? (currentFilter.startDate === currentFilter.endDate ? `Date: ${currentFilter.startDate}` : `Date Range: ${currentFilter.startDate} to ${currentFilter.endDate}`)
    : `Date: ${typeof selectedDate !== 'undefined' ? selectedDate : 'Today'}`;

  // Helper date/time formatters
  const safeTime = (iso) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  };

  // Header Banner Rendering
  function drawHeaderBanner(pageDoc) {
    pageDoc.setFillColor(15, 23, 42); // Navy slate #0F172A
    pageDoc.rect(0, 0, pageWidth, 28, 'F');

    pageDoc.setFillColor(2, 132, 199); // Aavin blue #0284C7
    pageDoc.rect(0, 27, pageWidth, 1.5, 'F');

    pageDoc.setTextColor(255, 255, 255);
    pageDoc.setFontSize(13);
    pageDoc.setFont('helvetica', 'bold');
    pageDoc.text('MADURAI DISTRICT CO-OPERATIVE MILK PRODUCER\'S UNION LTD', 14, 11);

    pageDoc.setFontSize(10);
    pageDoc.setFont('helvetica', 'bold');
    pageDoc.setTextColor(56, 189, 248); // Light sky blue
    pageDoc.text('AAVIN P&I AGM PORTAL — EXECUTIVE OPERATIONAL REPORT', 14, 18);

    pageDoc.setFontSize(8.5);
    pageDoc.setFont('helvetica', 'normal');
    pageDoc.setTextColor(203, 213, 225); // Slate 300
    pageDoc.text(dateFilterStr, 14, 24);
  }

  drawHeaderBanner(doc);

  let currentY = 34;

  // ── 1. DASHBOARD SUMMARY ───────────────────────────────────────────────────
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('1. DASHBOARD SUMMARY', 14, currentY);

  const totalTripsVal = String(kpis.total_trips || trips.length || 0);
  const activeTripsVal = String(kpis.active_trips || trips.filter(t => ['started', 'in_progress', 'active', 'returning'].includes(t.status)).length || 0);
  const finishedTripsVal = String(kpis.completed_trips || trips.filter(t => ['completed', 'finished'].includes(t.status)).length || 0);
  const milkCollectedVal = `${(kpis.total_milk_liters || 0).toLocaleString()} kg`;

  const kpiHeader = [['Total Trips', 'Active Trips', 'Finished Trips', 'Milk Collected']];
  const kpiBody = [[totalTripsVal, activeTripsVal, finishedTripsVal, milkCollectedVal]];

  doc.autoTable({
    startY: currentY + 3,
    head: kpiHeader,
    body: kpiBody,
    theme: 'grid',
    headStyles: { fillColor: [2, 132, 199], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 9 },
    bodyStyles: { fontStyle: 'bold', halign: 'center', fontSize: 10, textColor: [15, 23, 42] },
    styles: { cellPadding: 4 },
    margin: { left: 14, right: 14 }
  });

  currentY = doc.lastAutoTable.finalY + 8;

  // ── 2. TRIPS ───────────────────────────────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('2. FIELD TRIP OPERATIONS & BMC READINGS', 14, currentY);

  const tripsTableRows = [];
  (trips || []).forEach((t, idx) => {
    const outTimeStr = safeTime(t.out_time || t.started_at);
    const inTimeStr = t.in_time ? safeTime(t.in_time) : '-';
    const driverStr = t.driver_name && t.driver_name !== '-' ? ` | Driver: ${t.driver_name}` : '';
    const tankerStr = t.tanker_number && t.tanker_number !== '-' ? ` | Tanker: ${t.tanker_number}` : '';

    tripsTableRows.push([
      { content: `Trip ${idx + 1}`, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } },
      { content: `${t.trip_name || 'Trip'}${driverStr}${tankerStr}`, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } },
      { content: outTimeStr, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42], halign: 'center' } },
      { content: inTimeStr, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42], halign: 'center' } }
    ]);

    tripsTableRows.push([
      { content: 'BMC Name', styles: { fontStyle: 'bold', fillColor: [224, 242, 254], textColor: [3, 105, 161], fontSize: 7.5 } },
      { content: 'MACS', styles: { fontStyle: 'bold', fillColor: [224, 242, 254], textColor: [3, 105, 161], fontSize: 7.5 } },
      { content: 'Spot', styles: { fontStyle: 'bold', fillColor: [224, 242, 254], textColor: [3, 105, 161], fontSize: 7.5 } },
      { content: 'Diary Readings', styles: { fontStyle: 'bold', fillColor: [224, 242, 254], textColor: [3, 105, 161], fontSize: 7.5 } }
    ]);

    const sortedVisits = (t.visits || []).slice().sort((a, b) => (a.visit_sequence || 0) - (b.visit_sequence || 0));

    if (sortedVisits.length === 0) {
      tripsTableRows.push([
        { content: 'No BMC visits recorded', styles: { fontStyle: 'italic', textColor: [100, 116, 139] } },
        { content: '-', styles: { halign: 'center', textColor: [100, 116, 139] } },
        { content: '-', styles: { halign: 'center', textColor: [100, 116, 139] } },
        { content: '-', styles: { halign: 'center', textColor: [100, 116, 139] } }
      ]);
    } else {
      sortedVisits.forEach((v, vIdx) => {
        const macsStr = v.macs_result && v.macs_result !== '—' ? v.macs_result : '-';
        
        let spotParts = [];
        if (v.ftir_result && v.ftir_result !== '—' && v.ftir_result !== 'Pending') spotParts.push(`FTIR: ${v.ftir_result}`);
        if (v.gerber_result && v.gerber_result !== '—' && v.gerber_result !== 'Pending') spotParts.push(`Gerber: ${v.gerber_result}`);
        const spotStr = spotParts.length > 0 ? spotParts.join(' | ') : (v.ftir_result || v.gerber_result || '-');

        const diaryStr = v.diary_result && v.diary_result !== '—' ? v.diary_result : (v.milk_quantity_kg ? `${v.milk_quantity_kg} kg` : '-');

        tripsTableRows.push([
          `${vIdx + 1}. ${v.bmc_name || 'BMC'}`,
          macsStr,
          spotStr,
          diaryStr
        ]);
      });
    }
  });

  if (tripsTableRows.length === 0) {
    tripsTableRows.push(['-', 'No trips found for selected period', '-', '-']);
  }

  doc.autoTable({
    startY: currentY + 3,
    head: [['S.No / BMC', 'Trip Name / MACS', 'OUT Time / Spot', 'IN Time / Diary']],
    body: tripsTableRows,
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2.5, verticalAlignment: 'middle' },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 55 },
      2: { cellWidth: 46 },
      3: { cellWidth: 46 }
    },
    margin: { left: 14, right: 14 }
  });

  currentY = doc.lastAutoTable.finalY + 8;

  // ── 3. TANKERS ─────────────────────────────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('3. TANKER FLEET PERFORMANCE', 14, currentY);

  const tankerMap = {};
  (tankers || []).forEach(tk => {
    const name = tk.tanker_number || tk.board_number || tk.vehicle_number;
    if (name) {
      tankerMap[name] = {
        name,
        hoursMs: 0,
        distance: tk.distance_km != null ? tk.distance_km : null,
        diesel: tk.diesel_liters != null ? tk.diesel_liters : null,
        mileage: tk.mileage != null ? tk.mileage : null
      };
    }
  });

  (trips || []).forEach(t => {
    const tkName = t.tanker_number;
    if (tkName && tkName !== '-') {
      if (!tankerMap[tkName]) {
        tankerMap[tkName] = { name: tkName, hoursMs: 0, distance: null, diesel: null, mileage: null };
      }
      if (t.duration_ms) {
        tankerMap[tkName].hoursMs += t.duration_ms;
      }
    }
  });

  const tankerRows = Object.values(tankerMap).map(tk => {
    const hrs = tk.hoursMs > 0 ? `${(tk.hoursMs / 3600000).toFixed(1)} hrs` : '-';
    const dist = tk.distance != null ? `${tk.distance} KM` : '-';
    const diesel = tk.diesel != null ? `${tk.diesel} L` : '-';
    let mileageStr = '-';
    if (tk.mileage != null) {
      mileageStr = `${tk.mileage} KM/L`;
    } else if (tk.distance && tk.diesel) {
      mileageStr = `${(tk.distance / tk.diesel).toFixed(1)} KM/L`;
    }

    return [tk.name, hrs, dist, diesel, mileageStr];
  });

  if (tankerRows.length === 0) {
    tankerRows.push(['-', '-', '-', '-', '-']);
  }

  doc.autoTable({
    startY: currentY + 3,
    head: [['Tanker', 'Total Hours', 'Distance Covered', 'Diesel Consumption', 'Mileage']],
    body: tankerRows,
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2.5, halign: 'center' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 }
  });

  currentY = doc.lastAutoTable.finalY + 8;

  // ── 4. FIELD WORKER / SPOT ANALYZER ───────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('4. FIELD WORKER & SPOT ANALYZER PERFORMANCE', 14, currentY);

  const workerStatsMap = {};
  (workers || []).forEach(w => {
    if (w.name) {
      workerStatsMap[w.id || w.name] = {
        name: w.name,
        hoursMs: 0,
        bmcVisited: 0,
        totalReports: 0
      };
    }
  });

  (trips || []).forEach(t => {
    const key = t.worker_id || t.worker_name;
    if (key && key !== '-') {
      if (!workerStatsMap[key]) {
        workerStatsMap[key] = { name: t.worker_name || 'Worker', hoursMs: 0, bmcVisited: 0, totalReports: 0 };
      }
      if (t.duration_ms) workerStatsMap[key].hoursMs += t.duration_ms;
      if (Array.isArray(t.visits)) {
        workerStatsMap[key].bmcVisited += t.visits.length;
        t.visits.forEach(v => {
          if (v.report || (v.bmc_issues && v.bmc_issues.length > 0)) {
            workerStatsMap[key].totalReports += (v.bmc_issues ? v.bmc_issues.length : 1);
          }
        });
      }
    }
  });

  const workerRows = Object.values(workerStatsMap).map(w => {
    let hrsStr = '-';
    if (w.hoursMs > 0) {
      const h = Math.floor(w.hoursMs / 3600000);
      const m = Math.round((w.hoursMs % 3600000) / 60000);
      hrsStr = h > 0 ? `${h} hrs ${m} mins` : `${m} mins`;
    }

    return [w.name, hrsStr, String(w.bmcVisited), String(w.totalReports)];
  });

  if (workerRows.length === 0) {
    workerRows.push(['-', '-', '0', '0']);
  }

  doc.autoTable({
    startY: currentY + 3,
    head: [['Name', 'Hours Worked', 'BMC Visited', 'Total Reports']],
    body: workerRows,
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2.5, halign: 'center' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 }
  });

  currentY = doc.lastAutoTable.finalY + 8;

  // ── 5. REPORTS ─────────────────────────────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('5. BMC ISSUES & FIELD REPORTS', 14, currentY);

  const reportRows = [];
  (issues || []).forEach(iss => {
    reportRows.push([
      iss.bmc_name || '-',
      iss.description || iss.category || '-',
      (iss.severity || iss.status || 'NORMAL').toUpperCase()
    ]);
  });

  (trips || []).forEach(t => {
    (t.visits || []).forEach(v => {
      if (v.report && !issues.some(i => i.description === v.report)) {
        reportRows.push([
          v.bmc_name || '-',
          v.report,
          (v.report_priority || 'NORMAL').toUpperCase()
        ]);
      }
    });
  });

  if (reportRows.length === 0) {
    reportRows.push(['-', 'No field reports submitted during this period', 'NORMAL']);
  }

  doc.autoTable({
    startY: currentY + 3,
    head: [['BMC Name', 'Report / Issue Description', 'Priority']],
    body: reportRows,
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 45, fontStyle: 'bold' },
      1: { cellWidth: 105 },
      2: { cellWidth: 32, halign: 'center', fontStyle: 'bold' }
    },
    margin: { left: 14, right: 14 }
  });

  // Page Numbers & Footer on all pages
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Madurai District Co-operative Milk Producer\'s Union Ltd (AAVIN)', 14, pageHeight - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: 'right' });
  }

  const filename = `Aavin_PIAgm_Operational_Report_${typeof selectedDate !== 'undefined' ? selectedDate : 'Report'}.pdf`;
  doc.save(filename);

  if (typeof showToast === 'function') {
    showToast('Aavin operational PDF report generated successfully!', 'success');
  }
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
          <div class="d-flex gap-1" style="gap:4px;">
            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); openTripDetailModal('${t.id}')" title="View Details">
              🔍 Details
            </button>
            <button class="btn btn-sm btn-outline" style="color:#059669; border-color:#a7f3d0;" onclick="event.stopPropagation(); exportSingleTripExcelById('${t.id}')" title="Download Spot Ack Excel">
              📊
            </button>
            <button class="btn btn-sm btn-outline" style="color:#dc2626; border-color:#fca5a5;" onclick="event.stopPropagation(); exportSingleTripPDFById('${t.id}')" title="Download Single Trip PDF">
              📄
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

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
    if (typeof piAgmTripMapInterval !== 'undefined' && piAgmTripMapInterval) {
      clearInterval(piAgmTripMapInterval);
      piAgmTripMapInterval = null;
    }
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

let currentModalTripVisits = [];

window.openTripDetailModal = async function(tripId) {
  activeModalTripId = tripId;
  const modal = document.getElementById('trip-detail-modal');
  if (!modal) return;

  // Reset fields to loading state
  if (document.getElementById('pigm-route-name')) document.getElementById('pigm-route-name').textContent = 'Loading...';
  if (document.getElementById('pigm-driver-name')) document.getElementById('pigm-driver-name').textContent = 'Loading...';
  if (document.getElementById('pigm-tanker-number')) document.getElementById('pigm-tanker-number').textContent = 'Loading...';
  if (document.getElementById('pigm-duty-date')) document.getElementById('pigm-duty-date').textContent = 'Loading...';
  if (document.getElementById('pigm-out-time')) document.getElementById('pigm-out-time').textContent = 'Loading...';
  if (document.getElementById('pigm-in-time')) document.getElementById('pigm-in-time').textContent = 'Loading...';
  
  const statusPill = document.getElementById('pigm-status-pill');
  if (statusPill) {
    statusPill.className = 'badge badge-warning';
    statusPill.textContent = 'Planned';
  }

  const tbody = document.getElementById('pigm-bmc-table-body');
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">Loading BMC list...</td></tr>`;

  const reportContainer = document.getElementById('pigm-reports-review-container');
  if (reportContainer) reportContainer.innerHTML = `<div class="text-muted" style="font-size:0.88rem; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:14px 16px;">Loading reports...</div>`;

  modal.classList.remove('hidden');

  try {
    let trip = null;
    let visits = [];

    // Try fetching full trip details from API
    try {
      const res = await gmFetch(`/api/trips/${tripId}`);
      if (res && res.trip) {
        trip = res.trip;
        visits = res.visits || [];
      }
    } catch (e) {
      if (currentDashboardData && currentDashboardData.trips) {
        trip = currentDashboardData.trips.find(t => t.id === tripId);
        if (trip) visits = trip.visits || [];
      }
    }

    if (!trip) {
      if (typeof showToast === 'function') showToast('Trip details not found.', 'error');
      return;
    }

    currentModalTripVisits = visits;

    // Fill metadata
    if (document.getElementById('pigm-route-name')) document.getElementById('pigm-route-name').textContent = trip.route_description || trip.trip_name || trip.route || 'Planned Duty';
    if (document.getElementById('pigm-driver-name')) document.getElementById('pigm-driver-name').textContent = trip.driver_name || (trip.driver ? trip.driver.name : 'Assigned Driver');
    if (document.getElementById('pigm-tanker-number')) document.getElementById('pigm-tanker-number').textContent = trip.tanker_number || (trip.tanker ? trip.tanker.board_number : 'Unassigned');
    
    // Duty Date
    const d = new Date(trip.out_time || trip.created_at || new Date());
    if (document.getElementById('pigm-duty-date')) document.getElementById('pigm-duty-date').textContent = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    // Times
    const formatTimeStr = (ts) => ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
    const outTimeStr = formatTimeStr(trip.started_at || trip.out_time || trip.scheduled_start_time || trip.created_at);
    const inTimeStr = (trip.in_time || trip.completed_at) ? formatTimeStr(trip.in_time || trip.completed_at) : (trip.status === 'completed' ? 'Finished' : 'In Transit / Active');
    
    if (document.getElementById('pigm-out-time')) document.getElementById('pigm-out-time').textContent = outTimeStr;
    if (document.getElementById('pigm-in-time')) document.getElementById('pigm-in-time').textContent = inTimeStr;

    // Status pill
    const isCompleted = trip.status === 'completed';
    const isStarted = trip.status === 'in_progress' || trip.status === 'active';
    if (statusPill) {
      if (isCompleted) {
        statusPill.className = 'badge badge-success';
        statusPill.textContent = '✓ Finished';
      } else if (isStarted) {
        statusPill.className = 'badge badge-blue';
        statusPill.textContent = 'In Progress';
      } else {
        statusPill.className = 'badge badge-warning';
        statusPill.textContent = 'Planned';
      }
    }

    // Render BMCs list
    if (tbody) {
      if (visits.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No BMCs selected for this route.</td></tr>`;
      } else {
        tbody.innerHTML = visits.map((v, idx) => {
          const bmcName = v.bmc ? v.bmc.name : (v.bmc_name || 'BMC');
          const bmcCode = v.bmc ? (v.bmc.bmc_code || v.bmc.district || '') : '';
          const codeText = bmcCode ? ` (${esc(bmcCode)})` : '';
          const comp = v.compartment || 'Front';

          const isVisited = v.status === 'completed' || v.visit_end_time || v.status === 'visited';
          const statusBadge = isVisited 
            ? '<span class="badge badge-success" style="font-weight:700;">✓ Visited</span>'
            : (v.status === 'in_progress' ? '<span class="badge badge-blue">In Progress</span>' : '<span class="badge badge-warning">Pending</span>');

          const viewTestBtn = `<button type="button" class="btn btn-outline btn-sm" style="padding: 5px 12px; font-weight:700; font-size:0.78rem; border-color:#3B82F6; color:#1D4ED8;" onclick="openPiAgmViewTestModal(${idx})">🧪 View Test</button>`;

          return `
            <tr>
              <td style="text-align: center;"><strong>${v.visit_sequence || (idx + 1)}</strong></td>
              <td><strong>${esc(bmcName)}</strong>${codeText}</td>
              <td><span class="badge badge-neutral">${esc(comp)}</span></td>
              <td>${statusBadge}</td>
              <td style="text-align: right; white-space: nowrap;">
                ${viewTestBtn}
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // Render Reports & Review Section
    renderPiAgmReportsAndReview(visits);

    // Setup Spot Analyzer Live Tracking Map
    setupPiAgmTripMap(trip);

  } catch (err) {
    console.error('Failed to load trip details for modal:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Failed to load trip details.', 'error');
  }
};

let piAgmTripMap = null;
let piAgmTripMapPolyline = null;
let piAgmTripMapMarker = null;
let piAgmTripMapInterval = null;

function formatTime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return isoStr; }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  } catch (e) { return isoStr; }
}

async function setupPiAgmTripMap(trip) {
  const mapSection = document.getElementById('trip-map-section');
  if (!mapSection) return;

  // Clear any existing polling interval
  if (piAgmTripMapInterval) { clearInterval(piAgmTripMapInterval); piAgmTripMapInterval = null; }

  if (!trip) {
    mapSection.classList.add('hidden');
    return;
  }

  // Always show the map section for non-pending trips — let updatePiAgmTripMapData handle the data
  const isActive = ['started', 'in_progress', 'active', 'returning', 'completed'].includes(trip.status);
  const hasLocalMapData = (trip.journey_path && trip.journey_path.length > 0) ||
                          trip.start_lat ||
                          (trip.remarks && trip.remarks.includes('__JOURNEY_DATA__='));

  if (isActive || hasLocalMapData) {
    mapSection.classList.remove('hidden');

    setTimeout(() => {
      // Destroy and recreate map to avoid stale container issues on re-open
      if (piAgmTripMap) {
        piAgmTripMap.remove();
        piAgmTripMap = null;
      }

      if (typeof L !== 'undefined') {
        piAgmTripMap = L.map('spot-analyzer-journey-map').setView([11.1271, 78.6569], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(piAgmTripMap);
      }

      if (piAgmTripMap) piAgmTripMap.invalidateSize();

      // First data fetch
      updatePiAgmTripMapData(trip.id);

      // Live polling every 15s for active trips
      if (['started', 'in_progress', 'active', 'returning'].includes(trip.status)) {
        piAgmTripMapInterval = setInterval(() => updatePiAgmTripMapData(trip.id), 15000);
      }
    }, 300);
  } else {
    mapSection.classList.add('hidden');
  }
}

async function updatePiAgmTripMapData(tripId) {
  try {
    // Always fetch fresh data from driver_trips endpoint (same as Transport Manager)
    let trip = null;
    try {
      const data = await gmFetch(`/api/transport/driver-trips/${tripId}`);
      if (data && data.trip) trip = data.trip;
    } catch (e) {
      console.warn('P&I AGM map: driver-trips fetch failed, falling back to dashboard data', e.message);
    }

    // Fallback to dashboard data if API call failed
    if (!trip) {
      trip = currentDashboardData?.trips?.find(t => t.id === tripId);
    }
    if (!trip) return;

    let remarks = trip.remarks || '';
    let interruptions = [];
    if (remarks.includes('__INTERRUPTIONS_DATA__=')) {
      try {
        const iStr = remarks.split('__INTERRUPTIONS_DATA__=')[1].split('\n')[0];
        interruptions = JSON.parse(iStr);
      } catch (e) {}
    }

    let journey = [];
    if (remarks.includes('__JOURNEY_DATA__=')) {
      try {
        const jStr = remarks.split('__JOURNEY_DATA__=')[1].split('\n')[0];
        journey = JSON.parse(jStr);
      } catch (e) {}
    } else if (Array.isArray(trip.journey_path)) {
      journey = trip.journey_path;
    }

    let latestLoc = null;

    if (trip.end_lat && trip.end_lng) {
      latestLoc = { lat: trip.end_lat, lng: trip.end_lng, timestamp: trip.updated_at };
    } else if (journey.length > 0) {
      latestLoc = journey[journey.length - 1];
    } else if (trip.start_lat && trip.start_lng) {
      latestLoc = { lat: trip.start_lat, lng: trip.start_lng, timestamp: trip.started_at };
      journey.push(latestLoc);
    }

    // Status UI
    const isTrackingOff = interruptions.length > 0 && (interruptions[interruptions.length - 1].status || '').includes('OFF');
    const mapStatusEl = document.getElementById('trip-map-status-text');
    const mapUpdateEl = document.getElementById('trip-map-last-update');

    if (mapStatusEl) {
      mapStatusEl.textContent = trip.status === 'completed' ? 'Trip Completed (Tracking Stopped)' : isTrackingOff ? '🔴 Tracking OFF' : '🟢 Tracking ON';
      mapStatusEl.style.color = trip.status === 'completed' ? '#475569' : isTrackingOff ? '#DC2626' : '#16A34A';
    }
    if (mapUpdateEl) {
      mapUpdateEl.textContent = latestLoc ? formatDateTime(latestLoc.timestamp) : 'No data';
    }

    // Interruptions list
    const intrContainer = document.getElementById('trip-map-interruptions-container');
    const intrList = document.getElementById('trip-map-interruptions-list');
    if (intrContainer && intrList) {
      if (interruptions.length > 0) {
        intrContainer.classList.remove('hidden');
        intrList.innerHTML = interruptions.map(i => `<li>${formatTime(i.timestamp)}: ${i.status}</li>`).join('');
      } else {
        intrContainer.classList.add('hidden');
      }
    }

    // Draw Map Elements
    if (!piAgmTripMap) return;
    if (piAgmTripMapPolyline) piAgmTripMap.removeLayer(piAgmTripMapPolyline);
    if (piAgmTripMapMarker) piAgmTripMap.removeLayer(piAgmTripMapMarker);
    piAgmTripMapPolyline = null;
    piAgmTripMapMarker = null;

    const latlngs = journey.map(point => [Number(point.lat), Number(point.lng)]).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
    if (latestLoc && !isNaN(latestLoc.lat) && !isNaN(latestLoc.lng)) {
      const lastPt = latlngs.length > 0 ? latlngs[latlngs.length - 1] : null;
      if (!lastPt || lastPt[0] !== Number(latestLoc.lat) || lastPt[1] !== Number(latestLoc.lng)) {
        latlngs.push([Number(latestLoc.lat), Number(latestLoc.lng)]);
      }
    }

    if (latlngs.length > 0) {
      piAgmTripMapPolyline = L.polyline(latlngs, { color: '#DC2626', weight: 4, opacity: 0.9 }).addTo(piAgmTripMap);
      piAgmTripMap.fitBounds(piAgmTripMapPolyline.getBounds());
    }

    if (latestLoc && !isNaN(latestLoc.lat) && !isNaN(latestLoc.lng)) {
      const isLive = trip.status !== 'completed' && latestLoc.timestamp && (Date.now() - new Date(latestLoc.timestamp).getTime() < 10 * 60 * 1000);
      const timeStr = isLive ? `🟢 Live Location (Updated: ${formatTime(latestLoc.timestamp)})` : `📍 Last Location (${formatDateTime(latestLoc.timestamp)})`;
      piAgmTripMapMarker = L.marker([Number(latestLoc.lat), Number(latestLoc.lng)]).addTo(piAgmTripMap);
      piAgmTripMapMarker.bindPopup(`<div style="font-family:'Outfit',sans-serif; padding:2px;"><b>🔬 Spot Analyzer: ${trip.worker_name || 'Worker'}</b><br><span style="font-size:0.82rem; color:#475569;">👨‍✈️ Driver: ${trip.driver_name || 'Driver'} (${trip.vehicle_number || trip.tanker_number || 'Tanker'})</span><br><span style="font-size:0.8rem; color:#0F172A; font-weight:600;">${timeStr}</span></div>`).openPopup();
    }
  } catch (err) {
    console.error('Error updating P&I AGM Spot Analyzer map:', err);
  }
}

window.openPiAgmViewTestModal = function(visitIdx) {
  if (!currentModalTripVisits || !currentModalTripVisits[visitIdx]) {
    if (typeof showToast === 'function') showToast('Visit test data not found.', 'error');
    return;
  }

  const v = currentModalTripVisits[visitIdx];
  const bmcName = v.bmc ? v.bmc.name : (v.bmc_name || 'BMC');
  const modal = document.getElementById('pi-agm-view-test-modal');
  if (!modal) return;

  if (document.getElementById('pigm-vt-bmc-name')) document.getElementById('pigm-vt-bmc-name').textContent = bmcName;

  // FTIR Test Data (FAT & SNF only)
  const ftirObj = Array.isArray(v.ftir_tests) ? v.ftir_tests[0] : (v.ftir_tests || null);
  const ftirGrid = document.getElementById('pigm-vt-ftir-grid');
  const ftirStatusPill = document.getElementById('pigm-vt-ftir-status');

  if (ftirObj || v.ftir_result) {
    const fatVal = ftirObj?.fat !== undefined ? `${ftirObj.fat}%` : (v.ftir_result && v.ftir_result.includes('FAT:') ? v.ftir_result.split('FAT:')[1].split(',')[0].trim() : '—');
    const snfVal = ftirObj?.snf !== undefined ? `${ftirObj.snf}%` : (v.ftir_result && v.ftir_result.includes('SNF:') ? v.ftir_result.split('SNF:')[1].trim() : '—');
    const overallRes = ftirObj?.overall_result || (v.ftir_result && v.ftir_result.includes('[FAIL]') ? 'FAIL' : (v.ftir_result && v.ftir_result !== '—' && v.ftir_result !== 'Pending' ? 'PASS' : 'Pending'));

    if (ftirStatusPill) {
      ftirStatusPill.className = `badge ${overallRes.toLowerCase() === 'pass' ? 'badge-success' : (overallRes.toLowerCase() === 'fail' ? 'badge-danger' : 'badge-neutral')}`;
      ftirStatusPill.textContent = overallRes.toUpperCase();
    }

    if (ftirGrid) {
      ftirGrid.innerHTML = `
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">FAT (%)</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${fatVal}</div></div>
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">SNF (%)</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${snfVal}</div></div>
      `;
    }
  } else {
    if (ftirStatusPill) { ftirStatusPill.className = 'badge badge-neutral'; ftirStatusPill.textContent = 'Not Tested'; }
    if (ftirGrid) ftirGrid.innerHTML = `<div style="grid-column: 1 / -1; font-size: 0.85rem; color:#64748B; font-style:italic;">No FTIR test performed for this BMC visit.</div>`;
  }

  // Gerber Test Data (FAT, SNF & Lacto only)
  const gerberObj = Array.isArray(v.gerber_tests) ? v.gerber_tests[0] : (v.gerber_tests || null);
  const gerberGrid = document.getElementById('pigm-vt-gerber-grid');
  const gerberStatusPill = document.getElementById('pigm-vt-gerber-status');

  if (gerberObj || v.gerber_result) {
    const gFatVal = gerberObj?.fat_percentage !== undefined ? `${gerberObj.fat_percentage}%` : (v.gerber_result && v.gerber_result.includes('FAT:') ? v.gerber_result.split('FAT:')[1].split(',')[0].trim() : '—');
    const gSnfVal = gerberObj?.snf !== undefined ? `${gerberObj.snf}%` : (v.gerber_result && v.gerber_result.includes('SNF:') ? v.gerber_result.split('SNF:')[1].trim() : '—');
    const gLactoVal = gerberObj?.clr !== undefined ? gerberObj.clr : (v.gerber_result && v.gerber_result.includes('CLR:') ? v.gerber_result.split('CLR:')[1].split(' ')[0].trim() : '—');
    const gOverallRes = gerberObj?.overall_result || (v.gerber_result && v.gerber_result.includes('[FAIL]') ? 'FAIL' : (v.gerber_result && v.gerber_result !== '—' && v.gerber_result !== 'Pending' ? 'PASS' : 'Pending'));

    if (gerberStatusPill) {
      gerberStatusPill.className = `badge ${gOverallRes.toLowerCase() === 'pass' ? 'badge-success' : (gOverallRes.toLowerCase() === 'fail' ? 'badge-danger' : 'badge-neutral')}`;
      gerberStatusPill.textContent = gOverallRes.toUpperCase();
    }

    if (gerberGrid) {
      gerberGrid.innerHTML = `
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">FAT (%)</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${gFatVal}</div></div>
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">SNF (%)</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${gSnfVal}</div></div>
        <div style="background:#FFF; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div style="font-size:0.75rem; color:#64748B; font-weight:700;">LACTO</div><div style="font-size:1.05rem; font-weight:800; color:#0F172A; margin-top:2px;">${gLactoVal}</div></div>
      `;
    }
  } else {
    if (gerberStatusPill) { gerberStatusPill.className = 'badge badge-neutral'; gerberStatusPill.textContent = 'Not Tested'; }
    if (gerberGrid) gerberGrid.innerHTML = `<div style="grid-column: 1 / -1; font-size: 0.85rem; color:#64748B; font-style:italic;">No Gerber test performed for this BMC visit.</div>`;
  }

  modal.classList.remove('hidden');
};

window.closePiAgmViewTestModal = function() {
  const modal = document.getElementById('pi-agm-view-test-modal');
  if (modal) modal.classList.add('hidden');
};

function renderPiAgmReportsAndReview(visits = []) {
  const container = document.getElementById('pigm-reports-review-container');
  if (!container) return;

  const allIssues = [];

  visits.forEach(v => {
    const bmcName = v.bmc ? v.bmc.name : (v.bmc_name || 'BMC');
    if (v.bmc_issues && Array.isArray(v.bmc_issues) && v.bmc_issues.length > 0) {
      v.bmc_issues.forEach(i => allIssues.push({ ...i, bmc_name: bmcName }));
    } else if (v.report || v.description) {
      allIssues.push({
        bmc_name: bmcName,
        issue_type: v.issue_type || 'Reported Issue',
        severity: v.report_priority || v.severity || 'Medium',
        description: v.report || v.description || 'No detailed description'
      });
    }
  });

  if (allIssues.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.88rem; color: #64748B; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-style: italic;">
        No issues reported for this trip.
      </div>
    `;
    return;
  }

  let html = '';

  if (allIssues.length > 0) {
    html += `
      <div style="margin-bottom: 14px;">
        <div style="font-size: 0.85rem; font-weight: 800; color: #DC2626; margin-bottom: 8px;">⚠️ Reported Issues / Non-Conformances (${allIssues.length})</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${allIssues.map(issue => `
            <div style="background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 10px 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.82rem; font-weight: 800; color: #991B1B;">🏢 ${esc(issue.bmc_name)} — ${esc(issue.issue_type || 'General Issue')}</span>
                <span class="badge badge-danger" style="font-size: 0.72rem;">${esc(issue.severity || 'Medium').toUpperCase()}</span>
              </div>
              <div style="font-size: 0.85rem; color: #7F1D1D; margin-top: 4px;">${esc(issue.description || issue.remarks || 'No detailed description')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

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

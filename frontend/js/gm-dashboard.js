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

  function syncPresetStateFromDates(sDate, eDate) {
    const todayStr = getLocalDateStr();
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yStr = getLocalDateStr(y);

    if (sDate === todayStr && eDate === todayStr) {
      updatePresetButtonUI('today');
    } else if (sDate === yStr && eDate === yStr) {
      updatePresetButtonUI('yesterday');
    } else {
      updatePresetButtonUI('custom');
    }
  }

  const todayStr = getLocalDateStr();
  currentFilter = { preset: 'today', startDate: todayStr, endDate: todayStr };

  const fromDateInput = document.getElementById('gm-from-date');
  const toDateInput = document.getElementById('gm-to-date');
  if (fromDateInput) fromDateInput.value = todayStr;
  if (toDateInput) toDateInput.value = todayStr;
  updatePresetButtonUI('today');

  const onDateInputChange = () => {
    const sDate = fromDateInput?.value;
    const eDate = toDateInput?.value;
    if (sDate && eDate) {
      syncPresetStateFromDates(sDate, eDate);
    }
  };

  if (fromDateInput) fromDateInput.addEventListener('change', onDateInputChange);
  if (toDateInput) toDateInput.addEventListener('change', onDateInputChange);

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
      syncPresetStateFromDates(sDate, eDate);
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
  if (document.getElementById('kpi-active-trips')) document.getElementById('kpi-active-trips').textContent = kpis.active_trips ?? trips.filter(t => ['started', 'in_progress', 'active', 'returning', 'in_transit'].includes(t.status)).length;
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
      const milkVal = v.milk_quantity_kg || v.in_weight || v.milk_quantity_liters;
      if (milkVal) totalMilkKg += Number(milkVal);
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

  const dateFilterStr = currentFilter.startDate === currentFilter.endDate
    ? `Date: ${currentFilter.startDate}`
    : `Date Range: ${currentFilter.startDate} to ${currentFilter.endDate}`;

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
    // Top dark banner
    pageDoc.setFillColor(15, 23, 42); // Navy slate #0F172A
    pageDoc.rect(0, 0, pageWidth, 28, 'F');

    // Accent line
    pageDoc.setFillColor(2, 132, 199); // Aavin blue #0284C7
    pageDoc.rect(0, 27, pageWidth, 1.5, 'F');

    // Header Text
    pageDoc.setTextColor(255, 255, 255);
    pageDoc.setFontSize(13);
    pageDoc.setFont('helvetica', 'bold');
    pageDoc.text('MADURAI DISTRICT CO-OPERATIVE MILK PRODUCER\'S UNION LTD', 14, 11);

    pageDoc.setFontSize(10);
    pageDoc.setFont('helvetica', 'bold');
    pageDoc.setTextColor(56, 189, 248); // Light sky blue
    pageDoc.text('AAVIN GM PORTAL — EXECUTIVE OPERATIONAL REPORT', 14, 18);

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
  const activeTripsVal = String(kpis.active_trips || trips.filter(t => ['started', 'in_progress', 'active', 'returning', 'in_transit'].includes(t.status)).length || 0);
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

    // Main Trip Header Row
    tripsTableRows.push([
      { content: `Trip ${idx + 1}`, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } },
      { content: `${t.trip_name || 'Trip'}${driverStr}${tankerStr}`, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } },
      { content: outTimeStr, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42], halign: 'center' } },
      { content: inTimeStr, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42], halign: 'center' } }
    ]);

    // Sub-header for BMC details
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

  // Group trips by tanker to aggregate hours worked
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

  // Also collect trip visit reports if not already in issues list
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

    // Footer border line
    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Madurai District Co-operative Milk Producer\'s Union Ltd (AAVIN)', 14, pageHeight - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: 'right' });
  }

  const filename = `Aavin_GM_Operational_Report_${currentFilter.startDate}_to_${currentFilter.endDate}.pdf`;
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
      (t.route_description || '').toLowerCase().includes(searchVal) ||
      (t.visits || []).some(v => (v.bmc_name || '').toLowerCase().includes(searchVal));

    let matchStatus = true;
    const st = (t.status || '').toLowerCase();
    if (statusFilter === 'in_transmit' || statusFilter === 'active') {
      matchStatus = ['started', 'in_progress', 'active', 'returning', 'in_transit'].includes(st);
    } else if (statusFilter === 'completed' || statusFilter === 'finished') {
      matchStatus = ['completed', 'finished'].includes(st);
    } else if (statusFilter) {
      matchStatus = st === statusFilter;
    }

    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="content-card text-center text-muted" style="padding:40px; border-radius:12px;">
        🔍 No field trips found matching the selected filter criteria.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((t, idx) => {
    const sNo = idx + 1;
    const statusClass = (t.status || 'pending').toLowerCase();
    const isCompleted = statusClass === 'completed';
    const isStarted = statusClass === 'in_progress' || statusClass === 'active';

    let statusBadge = '';
    if (isCompleted) {
      statusBadge = `<span class="badge badge-success" style="font-size:0.75rem; font-weight:800; padding:5px 12px; border-radius:12px;">✅ FINISHED</span>`;
    } else if (isStarted) {
      statusBadge = `<span class="badge badge-blue" style="font-size:0.75rem; font-weight:800; padding:5px 12px; border-radius:12px;">🔄 IN TRANSIT</span>`;
    } else {
      statusBadge = `<span class="badge badge-warning" style="font-size:0.75rem; font-weight:800; padding:5px 12px; border-radius:12px;">⏳ PLANNED</span>`;
    }

    const tripTitle = t.trip_name || 'Unnamed Trip';

    return `
      <div class="trip-blue-box" id="trip-box-${t.id}">
        <div class="trip-box-left">
          <span class="trip-sno-badge">S.No: ${sNo}</span>
          <div class="trip-route-content">
            <span class="trip-route-label">Trip Name</span>
            <h4 class="trip-route-title">${esc(tripTitle)}</h4>
          </div>
        </div>
        <div class="trip-box-right">
          ${statusBadge}
          <button class="btn-trip-details" onclick="openTripDetailModal('${t.id}')" title="View Details">🔍 Details</button>
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
    if (gmTripMapInterval) clearInterval(gmTripMapInterval);
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

        let macsDisp = esc(v.macs_result || '—');
        if (v.macs_result && v.macs_result.includes('T1:')) {
          const lMatch = v.macs_result.match(/T1:\s*([\d.]+\s*L)/);
          const fatMatch = v.macs_result.match(/FAT:\s*([\d.]+%)/);
          const snfMatch = v.macs_result.match(/SNF:\s*([\d.]+%)/);
          if (lMatch) {
            macsDisp = `${lMatch[1]} , FAT: ${fatMatch ? fatMatch[1] : '-'} , SNF: ${snfMatch ? snfMatch[1] : '-'}`;
          }
        }

        return `
          <tr>
            <td><strong>${v.visit_sequence || '—'}</strong></td>
            <td><strong>${esc(v.bmc_name)}</strong></td>
            <td>${macsDisp}</td>
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
  setupTripMap(trip);
};

let gmTripMap = null;
let gmTripMapPolyline = null;
let gmTripMapMarker = null;
let gmTripMapInterval = null;

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

async function setupTripMap(trip) {
  const mapSection = document.getElementById('trip-map-section');
  if (!mapSection) return;

  // Clear any existing polling interval
  if (gmTripMapInterval) { clearInterval(gmTripMapInterval); gmTripMapInterval = null; }

  if (!trip) {
    mapSection.classList.add('hidden');
    return;
  }

  // Always show the map section for non-pending trips — let updateTripMapData handle the data
  const isActive = ['started', 'in_progress', 'active', 'returning', 'completed'].includes(trip.status);
  const hasLocalMapData = (trip.journey_path && trip.journey_path.length > 0) ||
                          trip.start_lat ||
                          (trip.remarks && trip.remarks.includes('__JOURNEY_DATA__='));

  if (isActive || hasLocalMapData) {
    mapSection.classList.remove('hidden');

    setTimeout(() => {
      // Destroy and recreate map to avoid stale container issues on re-open
      if (gmTripMap) {
        gmTripMap.remove();
        gmTripMap = null;
      }

      if (typeof L !== 'undefined') {
        gmTripMap = L.map('spot-analyzer-journey-map').setView([11.1271, 78.6569], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(gmTripMap);
      }

      if (gmTripMap) gmTripMap.invalidateSize();

      // First data fetch
      updateTripMapData(trip.id);

      // Live polling every 15s for active trips
      if (['started', 'in_progress', 'active', 'returning'].includes(trip.status)) {
        gmTripMapInterval = setInterval(() => updateTripMapData(trip.id), 10000);
      }
    }, 300);
  } else {
    mapSection.classList.add('hidden');
  }
}

async function updateTripMapData(tripId) {
  try {
    // Always fetch fresh data from driver_trips endpoint (same as Transport Manager)
    let trip = null;
    try {
      const data = await gmFetch(`/api/transport/driver-trips/${tripId}`);
      if (data && data.trip) trip = data.trip;
    } catch (e) {
      console.warn('GM map: driver-trips fetch failed, falling back to dashboard data', e.message);
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
    if (!gmTripMap) return;
    if (gmTripMapPolyline) gmTripMap.removeLayer(gmTripMapPolyline);
    if (gmTripMapMarker) gmTripMap.removeLayer(gmTripMapMarker);
    gmTripMapPolyline = null;
    gmTripMapMarker = null;

    const latlngs = journey.map(point => [Number(point.lat), Number(point.lng)]).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
    if (latestLoc && !isNaN(latestLoc.lat) && !isNaN(latestLoc.lng)) {
      const lastPt = latlngs.length > 0 ? latlngs[latlngs.length - 1] : null;
      if (!lastPt || lastPt[0] !== Number(latestLoc.lat) || lastPt[1] !== Number(latestLoc.lng)) {
        latlngs.push([Number(latestLoc.lat), Number(latestLoc.lng)]);
      }
    }

    if (latlngs.length > 0) {
      gmTripMapPolyline = L.polyline(latlngs, { color: '#DC2626', weight: 4, opacity: 0.9 }).addTo(gmTripMap);
      gmTripMap.fitBounds(gmTripMapPolyline.getBounds());
    }

    if (latestLoc && !isNaN(latestLoc.lat) && !isNaN(latestLoc.lng)) {
      const isLive = trip.status !== 'completed' && latestLoc.timestamp && (Date.now() - new Date(latestLoc.timestamp).getTime() < 10 * 60 * 1000);
      const timeStr = isLive ? `🟢 Live Location (Updated: ${formatTime(latestLoc.timestamp)})` : `📍 Last Location (${formatDateTime(latestLoc.timestamp)})`;
      gmTripMapMarker = L.marker([Number(latestLoc.lat), Number(latestLoc.lng)]).addTo(gmTripMap);
      gmTripMapMarker.bindPopup(`<div style="font-family:'Outfit',sans-serif; padding:2px;"><b>🔬 Spot Analyzer: ${trip.worker_name || 'Worker'}</b><br><span style="font-size:0.82rem; color:#475569;">👨‍✈️ Driver: ${trip.driver_name || 'Driver'} (${trip.vehicle_number || trip.tanker_number || 'Tanker'})</span><br><span style="font-size:0.8rem; color:#0F172A; font-weight:600;">${timeStr}</span></div>`).openPopup();
    }
  } catch (err) {
    console.error('Error updating GM Spot Analyzer map:', err);
  }
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
    const totalMilk = visits.reduce((acc, v) => acc + (Number(v.milk_quantity_kg || v.in_weight || v.milk_quantity_liters) || 0), 0);
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

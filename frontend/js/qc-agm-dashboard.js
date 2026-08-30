// qc-agm-dashboard.js — MACS Readings Dashboard Logic

let currentMacsReadings = [];
let availableDates = [];
let selectedDate = '';
let masterBmcsList = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_agm');
  if (!profile) return;

  document.getElementById('main-qc-agm-content').classList.remove('hidden');
  document.getElementById('header-agm-name').textContent = profile.name;
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  setupQcAgmSidebarToggle();
  setupControls();
  await loadMasterBmcs();
  await loadAvailableDates();
});

function setupQcAgmSidebarToggle() {
  const toggleBtn = document.getElementById('qc-agm-toggle-btn') || document.getElementById('sidebar-toggle-btn');
  const sidebar = document.getElementById('qc-agm-sidebar') || document.querySelector('.qc-sidebar');
  const overlay = document.getElementById('qc-agm-sidebar-overlay') || document.querySelector('.qc-sidebar-overlay');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('show');
    });
  }

  if (overlay && sidebar) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }
}

async function loadMasterBmcs() {
  try {
    const res = await apiQcAgmGetBmcs();
    masterBmcsList = res.bmcs || [];
  } catch (err) {
    console.error('Error loading master BMCs:', err);
  }
}

function updateQuickDateButtonsUI(dateStr) {
  const btnToday = document.getElementById('btn-quick-today');
  const btnYesterday = document.getElementById('btn-quick-yesterday');

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const activeStyle = 'background: #2563EB; color: #FFFFFF; border: 1px solid #1D4ED8; font-weight: 700; box-shadow: 0 2px 6px rgba(37,99,235,0.3);';
  const inactiveStyle = 'background: #F1F5F9; color: #475569; border: 1px solid #CBD5E1; font-weight: 700; box-shadow: none;';

  if (btnToday) {
    if (dateStr === todayStr) {
      btnToday.setAttribute('style', `padding:6px 14px; font-size:0.82rem; border-radius:6px; cursor:pointer; transition:all 0.2s ease; ${activeStyle}`);
      btnToday.classList.add('active');
    } else {
      btnToday.setAttribute('style', `padding:6px 14px; font-size:0.82rem; border-radius:6px; cursor:pointer; transition:all 0.2s ease; ${inactiveStyle}`);
      btnToday.classList.remove('active');
    }
  }

  if (btnYesterday) {
    if (dateStr === yesterdayStr) {
      btnYesterday.setAttribute('style', `padding:6px 14px; font-size:0.82rem; border-radius:6px; cursor:pointer; transition:all 0.2s ease; ${activeStyle}`);
      btnYesterday.classList.add('active');
    } else {
      btnYesterday.setAttribute('style', `padding:6px 14px; font-size:0.82rem; border-radius:6px; cursor:pointer; transition:all 0.2s ease; ${inactiveStyle}`);
      btnYesterday.classList.remove('active');
    }
  }
}

function setupControls() {
  const dateSelect = document.getElementById('macs-date-select');
  const periodSelect = document.getElementById('macs-period-select');
  const searchInput = document.getElementById('macs-search-input');
  const routeFilter = document.getElementById('macs-route-filter');
  const btnToday = document.getElementById('btn-quick-today');
  const btnYesterday = document.getElementById('btn-quick-yesterday');

  if (dateSelect) {
    dateSelect.addEventListener('change', (e) => {
      selectedDate = e.target.value;
      updateQuickDateButtonsUI(selectedDate);
      loadReadingsForDate(selectedDate);
    });
  }

  if (periodSelect) {
    periodSelect.addEventListener('change', () => {
      loadReadingsForDate(selectedDate);
    });
  }

  if (routeFilter) {
    routeFilter.addEventListener('change', () => renderFilteredReadings());
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => renderFilteredReadings());
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      selectOrSetDate(todayStr);
    });
  }

  if (btnYesterday) {
    btnYesterday.addEventListener('click', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      selectOrSetDate(yesterday);
    });
  }
}

function selectOrSetDate(dateStr) {
  const dateSelect = document.getElementById('macs-date-select');
  if (!dateSelect) return;

  let exists = false;
  for (let i = 0; i < dateSelect.options.length; i++) {
    if (dateSelect.options[i].value === dateStr) {
      dateSelect.selectedIndex = i;
      exists = true;
      break;
    }
  }

  if (!exists) {
    const opt = document.createElement('option');
    opt.value = dateStr;
    opt.textContent = new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    dateSelect.appendChild(opt);
    dateSelect.value = dateStr;
  }

  selectedDate = dateStr;
  updateQuickDateButtonsUI(selectedDate);
  loadReadingsForDate(selectedDate);
}

async function loadAvailableDates() {
  const dateSelect = document.getElementById('macs-date-select');
  if (!dateSelect) return;

  try {
    const res = await apiQcAgmGetMacsDates();
    availableDates = res.dates || [];

    const todayStr = new Date().toISOString().split('T')[0];

    if (!availableDates.includes(todayStr)) {
      availableDates.unshift(todayStr);
    }

    dateSelect.innerHTML = availableDates.map(d => {
      const formatted = new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      return `<option value="${d}">${formatted}</option>`;
    }).join('');

    selectedDate = availableDates[0];
    dateSelect.value = selectedDate;

    updateQuickDateButtonsUI(selectedDate);
    await loadReadingsForDate(selectedDate);
  } catch (err) {
    console.error('Error loading MACS dates:', err);
    showToast('Failed to load available MACS reading dates.', 'error');
  }
}

let currentNoMacsReadings = [];

async function loadReadingsForDate(dateStr) {
  if (!dateStr) return;

  updateQuickDateButtonsUI(dateStr);
  const period = document.getElementById('macs-period-select')?.value || 'both';

  try {
    const res = await apiQcAgmGetMacsReadings(dateStr);
    let readings = res.readings || [];
    let noMacsReadings = res.no_macs_readings || [];

    if (period !== 'both') {
      readings = readings.filter(r => {
        const p = (r.raw?.period || r.raw_data?.period || 'morning').toLowerCase();
        return p === period.toLowerCase();
      });
    }

    currentMacsReadings = readings;
    currentNoMacsReadings = noMacsReadings;

    populateRouteFilterOptions();
    await updateSummaryCards(dateStr, period);
    renderFilteredReadings();
  } catch (err) {
    console.error('Error loading MACS readings:', err);
    showToast('Failed to load MACS readings for selected date.', 'error');
  }
}

function populateRouteFilterOptions() {
  const routeSelect = document.getElementById('macs-route-filter');
  if (!routeSelect) return;

  const currentVal = routeSelect.value || 'all';

  const routesSet = new Set();
  masterBmcsList.forEach(b => {
    const r = b.bmc_routes?.name || b.route_name;
    if (r) routesSet.add(r);
  });
  currentMacsReadings.forEach(item => {
    const r = getItemRouteName(item);
    if (r && r !== 'Unassigned Route') routesSet.add(r);
  });
  currentNoMacsReadings.forEach(item => {
    const r = getItemRouteName(item);
    if (r && r !== 'Unassigned Route') routesSet.add(r);
  });

  const routesList = Array.from(routesSet).sort();

  routeSelect.innerHTML = `<option value="all">🛣️ All Routes</option>` +
    routesList.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');

  if (currentVal && Array.from(routeSelect.options).some(o => o.value === currentVal)) {
    routeSelect.value = currentVal;
  }
}

async function updateSummaryCards(dateStr, periodStr) {
  try {
    const dashStats = await apiQcAgmGetDashboard(dateStr, periodStr);
    if (document.getElementById('stat-total-bmcs')) {
      document.getElementById('stat-total-bmcs').textContent = dashStats.total_bmcs || masterBmcsList.length || 0;
    }
    if (document.getElementById('stat-total-kg')) {
      document.getElementById('stat-total-kg').textContent = `${(dashStats.total_quantity_kg || 0).toLocaleString('en-IN')} KG`;
    }
    if (document.getElementById('stat-macs-total-bmcs')) {
      document.getElementById('stat-macs-total-bmcs').textContent = dashStats.macs_total_bmcs !== undefined ? dashStats.macs_total_bmcs : 0;
    }
  } catch (e) {
    console.error('Error fetching dashboard summary:', e);
  }
}

function getItemRouteName(item) {
  if (item.route_name) return item.route_name;
  if (item.bmc_routes && item.bmc_routes.name) return item.bmc_routes.name;
  if (item.route) return item.route;
  if (Array.isArray(masterBmcsList) && masterBmcsList.length > 0) {
    const found = masterBmcsList.find(b =>
      String(b.bmc_code) === String(item.bmc_code) ||
      String(b.id) === String(item.bmc_id) ||
      String(b.name).toLowerCase() === String(item.bmc_name).toLowerCase()
    );
    if (found) return found.bmc_routes?.name || found.route_name || 'Unassigned Route';
  }
  return 'Unassigned Route';
}

function renderFilteredReadings() {
  const tbody1 = document.getElementById('macs-readings-tbody');
  const tbody2 = document.getElementById('no-macs-readings-tbody');
  if (!tbody1) return;

  const query = (document.getElementById('macs-search-input')?.value || '').trim().toLowerCase();
  const selectedRoute = document.getElementById('macs-route-filter')?.value || 'all';

  const filtered1 = currentMacsReadings.filter(item => {
    const itemRoute = getItemRouteName(item);
    const routeMatches = selectedRoute === 'all' || itemRoute === selectedRoute;

    const codeMatch = String(item.bmc_code || '').toLowerCase().includes(query);
    const nameMatch = String(item.bmc_name || '').toLowerCase().includes(query);
    const searchRouteMatch = String(itemRoute).toLowerCase().includes(query);
    const searchMatches = !query || codeMatch || nameMatch || searchRouteMatch;

    return routeMatches && searchMatches;
  });

  const filtered2 = currentNoMacsReadings.filter(item => {
    const itemRoute = getItemRouteName(item);
    const routeMatches = selectedRoute === 'all' || itemRoute === selectedRoute;

    const codeMatch = String(item.bmc_code || '').toLowerCase().includes(query);
    const nameMatch = String(item.bmc_name || '').toLowerCase().includes(query);
    const searchRouteMatch = String(itemRoute).toLowerCase().includes(query);
    const searchMatches = !query || codeMatch || nameMatch || searchRouteMatch;

    return routeMatches && searchMatches;
  });

  const dash = `<span style="color:#94A3B8; font-weight:600;">-</span>`;

  // Render Table 1: Matched MACS Readings
  if (filtered1.length === 0) {
    tbody1.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:30px; color:#64748B;">
          No Data Available
        </td>
      </tr>
    `;
  } else {
    // Group Table 1 by Route
    const groups1 = {};
    filtered1.forEach(item => {
      const rName = getItemRouteName(item);
      if (!groups1[rName]) groups1[rName] = [];
      groups1[rName].push(item);
    });

    let html1 = '';
    Object.keys(groups1).forEach(rName => {
      const groupItems = groups1[rName];
      html1 += `
        <tr style="background: linear-gradient(135deg, #1e293b, #334155); color: #ffffff; font-weight: 700;">
          <td colspan="7" style="padding: 10px 16px; border-radius: 4px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>🛣️ Route: ${esc(rName)}</span>
              <span style="font-size:0.75rem; background:rgba(255,255,255,0.2); padding:2px 10px; border-radius:12px;">${groupItems.length} BMC${groupItems.length !== 1 ? 's' : ''}</span>
            </div>
          </td>
        </tr>
      `;

      html1 += groupItems.map(item => {
        const w = item.worker || {};
        const macsLit = item.macs?.quantity_liters ?? w.raw?.macs_quantity_liters ?? item.raw_data?.macs_quantity_liters;
        const macsKg = item.macs?.quantity_kg ?? (macsLit ? parseFloat((macsLit * 1.03).toFixed(2)) : null);
        const macsFat = w.fat ?? item.macs?.fat;
        const macsSnf = w.snf ?? item.macs?.snf;

        const macsStr = (macsLit !== null && macsLit !== undefined) 
          ? `<div style="font-size:0.88rem; font-weight:800; color:#1E3A8A;">${macsLit} L <span style="font-size:0.75rem; color:#475569; font-weight:600;">(${macsKg} KG)</span></div><div style="font-size:0.78rem; color:#2563EB; font-weight:700; margin-top:2px;">F: ${macsFat ?? '-'}% | S: ${macsSnf ?? '-'}%</div>`
          : dash;

        const spot = item.spot || {};
        const spotFat = (spot.fat !== null && spot.fat !== undefined && !isNaN(parseFloat(spot.fat))) ? parseFloat(spot.fat) : null;
        const spotSnf = (spot.snf !== null && spot.snf !== undefined && !isNaN(parseFloat(spot.snf))) ? parseFloat(spot.snf) : null;
        const hasSpotData = Boolean(spot.visited || spotFat !== null || spotSnf !== null);

        const spotStr = hasSpotData 
          ? `<div style="font-size:0.88rem; font-weight:800; color:#92400E;">${spot.quantity_liters ?? '-'} L <span style="font-size:0.75rem; color:#78350F; font-weight:600;">(${spot.quantity_kg ?? '-'} KG)</span></div><div style="font-size:0.78rem; color:#D97706; font-weight:700; margin-top:2px;">F: ${spotFat !== null ? spotFat : '-'}% | S: ${spotSnf !== null ? spotSnf : '-'}%</div>`
          : dash;

        const diary = item.diary || {};
        const diaryFat = (diary.fat !== null && diary.fat !== undefined && !isNaN(parseFloat(diary.fat))) ? parseFloat(diary.fat) : null;
        const diarySnf = (diary.snf !== null && diary.snf !== undefined && !isNaN(parseFloat(diary.snf))) ? parseFloat(diary.snf) : null;
        const hasDiaryData = Boolean(diary.recorded || diaryFat !== null || diarySnf !== null);

        const diaryStr = hasDiaryData
          ? `<div style="font-size:0.88rem; font-weight:800; color:#065F46;">${diary.quantity_liters ?? '-'} L <span style="font-size:0.75rem; color:#047857; font-weight:600;">(${diary.quantity_kg ?? '-'} KG)</span></div><div style="font-size:0.78rem; color:#059669; font-weight:700; margin-top:2px;">F: ${diaryFat !== null ? diaryFat : '-'}% | S: ${diarySnf !== null ? diarySnf : '-'}%</div>`
          : dash;

        // Difference = spot analyser - qc worker value (never negative)
        let diffDisplay = dash;
        const fatDiff = (spotFat !== null && diaryFat !== null) 
          ? Math.abs(parseFloat((spotFat - diaryFat).toFixed(2))) 
          : (item.fat_diff !== null && item.fat_diff !== undefined ? Math.abs(parseFloat(item.fat_diff)) : null);
        const snfDiff = (spotSnf !== null && diarySnf !== null) 
          ? Math.abs(parseFloat((spotSnf - diarySnf).toFixed(2))) 
          : (item.snf_diff !== null && item.snf_diff !== undefined ? Math.abs(parseFloat(item.snf_diff)) : null);

        if (fatDiff !== null && snfDiff !== null) {
          diffDisplay = `<span style="font-size:0.8rem; background:#F1F5F9; padding:3px 8px; border-radius:4px; font-weight:600; color:#334155;">FAT: ${fatDiff}% | SNF: ${snfDiff}%</span>`;
        } else if (fatDiff !== null) {
          diffDisplay = `<span style="font-size:0.8rem; background:#F1F5F9; padding:3px 8px; border-radius:4px; font-weight:600; color:#334155;">FAT: ${fatDiff}%</span>`;
        } else if (snfDiff !== null) {
          diffDisplay = `<span style="font-size:0.8rem; background:#F1F5F9; padding:3px 8px; border-radius:4px; font-weight:600; color:#334155;">SNF: ${snfDiff}%</span>`;
        }

        return `
          <tr style="cursor:pointer;" onclick="openDetailModal(${filtered1.indexOf(item)})">
            <td><strong>${esc(item.bmc_code)}</strong></td>
            <td><strong style="color:#0F172A;">${esc(item.bmc_name || 'N/A')}</strong></td>
            <td>${macsStr}</td>
            <td>${spotStr}</td>
            <td>${diaryStr}</td>
            <td>${diffDisplay}</td>
          </tr>
        `;
      }).join('');
    });

    tbody1.innerHTML = html1;
  }

  window._filteredMacsReadings = filtered1;
}

window.navigateToBmcDetails = function(bmcCode) {
  if (!bmcCode) return;
  const dateParam = selectedDate ? `&date=${encodeURIComponent(selectedDate)}` : '';
  window.location.href = `bmc-detail.html?code=${encodeURIComponent(bmcCode)}${dateParam}`;
};

window.openDetailModal = function(idx) {
  const item = (window._filteredMacsReadings || currentMacsReadings)[idx];
  if (!item) return;

  const modal = document.getElementById('macs-detail-modal');
  const container = document.getElementById('macs-detail-content');
  if (!modal || !container) return;

  const macs = item.macs || {};
  const w = item.worker || {};
  const spot = item.spot || {};
  const diary = item.diary || {};

  const spotFat = (spot.fat !== null && spot.fat !== undefined && !isNaN(parseFloat(spot.fat))) ? parseFloat(spot.fat) : null;
  const spotSnf = (spot.snf !== null && spot.snf !== undefined && !isNaN(parseFloat(spot.snf))) ? parseFloat(spot.snf) : null;

  const diaryFat = (diary.fat !== null && diary.fat !== undefined && !isNaN(parseFloat(diary.fat))) ? parseFloat(diary.fat) : null;
  const diarySnf = (diary.snf !== null && diary.snf !== undefined && !isNaN(parseFloat(diary.snf))) ? parseFloat(diary.snf) : null;

  const fatDiff = (spotFat !== null && diaryFat !== null) 
    ? Math.abs(parseFloat((spotFat - diaryFat).toFixed(2))) 
    : (item.fat_diff !== null && item.fat_diff !== undefined ? Math.abs(parseFloat(item.fat_diff)) : null);
  const snfDiff = (spotSnf !== null && diarySnf !== null) 
    ? Math.abs(parseFloat((spotSnf - diarySnf).toFixed(2))) 
    : (item.snf_diff !== null && item.snf_diff !== undefined ? Math.abs(parseFloat(item.snf_diff)) : null);

  const dateFormatted = new Date(item.reading_date || selectedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const macsFatVal = macs.fat ?? w.fat ?? 'N/A';
  const macsSnfVal = macs.snf ?? w.snf ?? 'N/A';

  container.innerHTML = `
    <div style="background:#F8FAFC; padding:16px; border-radius:12px; border:1px solid #E2E8F0; margin-bottom:16px;">
      <div style="font-size:1.2rem; font-weight:800; color:#0F172A;">${esc(item.bmc_name || 'BMC Center')}</div>
      <div style="font-size:0.85rem; color:#64748B; margin-top:2px;">
        BMC Code: <strong>${esc(item.bmc_code)}</strong> &nbsp;|&nbsp; Date: <strong>${esc(dateFormatted)}</strong>
      </div>
    </div>

    <!-- MACS Software Reading -->
    <div style="margin-bottom:16px;">
      <div style="font-size:0.8rem; font-weight:700; color:#2563EB; text-transform:uppercase; margin-bottom:8px;">
        📊 MACS SOFTWARE READING
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:#EFF6FF; padding:10px; border-radius:8px; border:1px solid #BFDBFE;">
          <div style="font-size:0.7rem; color:#1E40AF; font-weight:700;">FAT %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#1E3A8A;">${macsFatVal !== 'N/A' ? `${macsFatVal}%` : 'N/A'}</div>
        </div>
        <div style="background:#EFF6FF; padding:10px; border-radius:8px; border:1px solid #BFDBFE;">
          <div style="font-size:0.7rem; color:#1E40AF; font-weight:700;">SNF %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#1E3A8A;">${macsSnfVal !== 'N/A' ? `${macsSnfVal}%` : 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- Spot Analyzer Reading -->
    <div style="margin-bottom:16px;">
      <div style="font-size:0.8rem; font-weight:700; color:#D97706; text-transform:uppercase; margin-bottom:8px;">
        🔍 SPOT ANALYSER READING
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:#FEF3C7; padding:10px; border-radius:8px; border:1px solid #FDE68A;">
          <div style="font-size:0.7rem; color:#92400E; font-weight:700;">FAT %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#78350F;">${spotFat !== null ? `${spotFat}%` : 'N/A'}</div>
        </div>
        <div style="background:#FEF3C7; padding:10px; border-radius:8px; border:1px solid #FDE68A;">
          <div style="font-size:0.7rem; color:#92400E; font-weight:700;">SNF %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#78350F;">${spotSnf !== null ? `${spotSnf}%` : 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- QC Worker (Diary) Reading -->
    <div style="margin-bottom:16px;">
      <div style="font-size:0.8rem; font-weight:700; color:#059669; text-transform:uppercase; margin-bottom:8px;">
        🔬 QC WORKER (DIARY) READING
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:#ECFDF5; padding:10px; border-radius:8px; border:1px solid #A7F3D0;">
          <div style="font-size:0.7rem; color:#065F46; font-weight:700;">FAT %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#064E3B;">${diaryFat !== null ? `${diaryFat}%` : 'N/A'}</div>
        </div>
        <div style="background:#ECFDF5; padding:10px; border-radius:8px; border:1px solid #A7F3D0;">
          <div style="font-size:0.7rem; color:#065F46; font-weight:700;">SNF %</div>
          <div style="font-size:1.2rem; font-weight:800; color:#064E3B;">${diarySnf !== null ? `${diarySnf}%` : 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- Comparison (Spot Analyser - QC Worker) -->
    <div style="margin-bottom:16px;">
      <div style="font-size:0.8rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:8px;">
        📊 COMPARISON DIFFERENCES (SPOT ANALYSER - QC WORKER)
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
          <div style="font-size:0.7rem; color:#64748B; font-weight:700;">FAT DIFFERENCE</div>
          <div style="font-size:1.1rem; font-weight:800; color:${fatDiff === 0 ? '#16A34A' : '#2563EB'};">
            ${fatDiff !== null ? `${fatDiff}%` : 'N/A'}
          </div>
        </div>
        <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #E2E8F0;">
          <div style="font-size:0.7rem; color:#64748B; font-weight:700;">SNF DIFFERENCE</div>
          <div style="font-size:1.1rem; font-weight:800; color:${snfDiff === 0 ? '#16A34A' : '#2563EB'};">
            ${snfDiff !== null ? `${snfDiff}%` : 'N/A'}
          </div>
        </div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
};

window.handleDeleteMacsData = async function() {
  const selectedDate = document.getElementById('macs-date-select')?.value;
  
  let confirmMsg = selectedDate 
    ? `Are you sure you want to delete imported MACS software data for date: ${selectedDate}?`
    : 'Are you sure you want to delete ALL imported MACS software data from the system?';

  if (!confirm(confirmMsg)) return;

  const baseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
  let deleteUrl = `${baseUrl}/api/qc-agm/macs/delete-all`;
  if (selectedDate) {
    deleteUrl = `${baseUrl}/api/qc-agm/macs/delete-date?date=${encodeURIComponent(selectedDate)}`;
  }

  try {
    const token = await getQcAgmAuthToken();
    const res = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete MACS data');

    showToast(data.message || 'Imported MACS data deleted successfully.', 'success');
    await loadDatesDropdown();
    await loadMacsReadings();
  } catch (err) {
    console.error('Error deleting MACS data:', err);
    showToast(err.message || 'Failed to delete MACS data.', 'error');
  }
};

function closeDetailModal() {
  const modal = document.getElementById('macs-detail-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

window.handleManualSync = async function() {
  const btn = document.getElementById('macs-sync-btn');
  if (!btn) return;

  btn.disabled = true;
  btn.classList.add('syncing');
  btn.innerHTML = '⏳ Syncing...';

  try {
    const result = await qcAgmFetch('/api/admin/macs-api/sync', { method: 'POST' });

    if (result.success) {
      if (typeof showToast === 'function') {
        showToast(`✅ Sync complete — ${result.recordsFetched} fetched, ${result.recordsStored} stored`, 'success');
      } else {
        alert(`✅ Sync complete — ${result.recordsFetched} fetched, ${result.recordsStored} stored`);
      }
    } else {
      if (typeof showToast === 'function') {
        showToast(`❌ Sync failed: ${result.error || 'Unknown error'}`, 'error');
      } else {
        alert(`❌ Sync failed: ${result.error || 'Unknown error'}`);
      }
    }

    await loadAvailableDates();

  } catch (err) {
    if (typeof showToast === 'function') {
      showToast(`❌ Sync error: ${err.message}`, 'error');
    } else {
      alert(`❌ Sync error: ${err.message}`);
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove('syncing');
    btn.innerHTML = '🔄 Sync Now';
  }
};

window.navigateToBmcDetails = function(bmcCode) {
  if (!bmcCode) return;
  window.location.href = `bmc-detail.html?code=${encodeURIComponent(bmcCode)}`;
};

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

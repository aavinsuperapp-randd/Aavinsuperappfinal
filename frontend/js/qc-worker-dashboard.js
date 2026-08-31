// qc-worker-dashboard.js — QC Worker Dashboard logic (replicating QC AGM Dashboard overview with TEST actions)

let currentMacsReadings = [];
let currentNoMacsReadings = [];
let availableDates = [];
let selectedDate = '';
let masterBmcsList = [];

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await checkAuth('qc_worker');
  if (!profile) return;

  document.getElementById('main-qc-content').classList.remove('hidden');
  document.getElementById('qc-header-name').textContent = profile.name || 'qcworker';
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  setupControls();
  await loadMasterBmcs();
  await loadAvailableDates();
});

async function loadMasterBmcs() {
  try {
    const res = await apiQcWorkerGetBmcs();
    masterBmcsList = res.bmcs || [];
  } catch (err) {
    console.error('Error loading master BMCs:', err);
  }
}

function updateQuickDateButtonsUI(dateStr) {
  const btnToday = document.getElementById('btn-quick-today');
  const btnYesterday = document.getElementById('btn-quick-yesterday');

  const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const yesterdayStr = new Date(Date.now() - 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

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
      const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
      selectOrSetDate(todayStr);
    });
  }

  if (btnYesterday) {
    btnYesterday.addEventListener('click', () => {
      const yesterday = new Date(Date.now() - 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
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
    const res = await apiQcWorkerGetMacsDates();
    availableDates = res.dates || [];

    const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

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

async function loadReadingsForDate(dateStr) {
  if (!dateStr) return;

  updateQuickDateButtonsUI(dateStr);
  const period = document.getElementById('macs-period-select')?.value || 'both';

  try {
    const res = await apiQcWorkerGetMacsReadings(dateStr, period);
    const readings = res.readings || [];
    const noMacsReadings = res.no_macs_readings || [];

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

  const routesList = Array.from(routesSet).sort();  routeSelect.innerHTML = `<option value="all">All Routes</option>` +
    routesList.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');

  if (currentVal && Array.from(routeSelect.options).some(o => o.value === currentVal)) {
    routeSelect.value = currentVal;
  }
}

async function updateSummaryCards(dateStr, periodStr) {
  try {
    const dashStats = await apiQcWorkerGetDashboard(dateStr, periodStr);
    if (document.getElementById('stat-total-bmcs')) {
      document.getElementById('stat-total-bmcs').textContent = dashStats.total_bmcs || masterBmcsList.length || 0;
    }
    if (document.getElementById('stat-total-kg')) {
      document.getElementById('stat-total-kg').textContent = `${(dashStats.total_quantity_kg || 0).toLocaleString('en-IN')} KG`;
    }
  } catch (e) {
    console.error('Error fetching dashboard summary:', e);
  }
}

function getItemRouteName(item) {
  if (item.bmc_routes && item.bmc_routes.name) return item.bmc_routes.name;
  if (item.route_name) return item.route_name;
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
        <tr class="route-header-row" style="background: #1E293B !important; color: #ffffff !important; font-weight: 700;">
          <td colspan="7" style="padding: 10px 16px; background: #1E293B !important; color: #ffffff !important; border-radius: 4px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:#FFFFFF !important; font-weight:800; font-size:0.92rem;">Route: ${esc(rName)}</span>
              <span style="font-size:0.75rem; background:rgba(255,255,255,0.2); color:#FFFFFF !important; padding:2px 10px; border-radius:12px; font-weight:700;">${groupItems.length} BMC${groupItems.length !== 1 ? 's' : ''}</span>
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
        const spotStr = spot.visited 
          ? `<div style="font-size:0.88rem; font-weight:800; color:#92400E;">${spot.quantity_liters ?? '-'} L <span style="font-size:0.75rem; color:#78350F; font-weight:600;">(${spot.quantity_kg ?? '-'} KG)</span></div><div style="font-size:0.78rem; color:#D97706; font-weight:700; margin-top:2px;">F: ${spot.fat ?? '-'}% | S: ${spot.snf ?? '-'}%</div>`
          : dash;

        const diary = item.diary || {};
        const validFat = diary.fat !== undefined && diary.fat !== null && diary.fat !== 'undefined' && !isNaN(parseFloat(diary.fat));
        const validSnf = diary.snf !== undefined && diary.snf !== null && diary.snf !== 'undefined' && !isNaN(parseFloat(diary.snf));
        const hasDiaryData = Boolean(diary.recorded && (validFat || validSnf));

        const diaryStr = hasDiaryData
          ? `<div style="font-size:0.88rem; font-weight:800; color:#065F46;">${diary.quantity_liters ?? '-'} L <span style="font-size:0.75rem; color:#047857; font-weight:600;">(${diary.quantity_kg ?? '-'} KG)</span></div><div style="font-size:0.78rem; color:#059669; font-weight:700; margin-top:2px;">F: ${validFat ? parseFloat(diary.fat) : '-'}% | S: ${validSnf ? parseFloat(diary.snf) : '-'}%</div>`
          : dash;

        let diffDisplay = dash;
        if (hasDiaryData && item.fat_diff !== null && item.snf_diff !== null) {
          const fDiffSign = item.fat_diff > 0 ? `+${item.fat_diff}` : item.fat_diff;
          const sDiffSign = item.snf_diff > 0 ? `+${item.snf_diff}` : item.snf_diff;
          diffDisplay = `<span style="font-size:0.8rem; background:#F1F5F9; padding:3px 8px; border-radius:4px; font-weight:600;">FAT: ${fDiffSign} | SNF: ${sDiffSign}</span>`;
        }

        const isTested = hasDiaryData;
        const visitId = item.visit_id || (item.bmc_id ? `bmc_${item.bmc_id}` : `bmc_code_${item.bmc_code}`);

        const actionBtn = isTested
          ? `<span style="display:inline-block; background:#10B981; color:white; padding:6px 14px; border-radius:6px; font-weight:800; font-size:0.8rem; box-shadow:0 2px 4px rgba(16,185,129,0.2);">✅ TESTED</span>`
          : `<a href="test.html?visit_id=${visitId}" class="btn-qc" style="background:#2563EB; color:white; padding:6px 16px; border-radius:6px; font-weight:800; font-size:0.8rem; text-decoration:none; display:inline-block; transition:all 0.2s ease;">🧪 TEST</a>`;

        return `
          <tr>
            <td><strong>${esc(item.bmc_code)}</strong></td>
            <td><strong style="color:#0F172A;">${esc(item.bmc_name || 'N/A')}</strong></td>
            <td>${macsStr}</td>
            <td>${spotStr}</td>
            <td>${diaryStr}</td>
            <td>${diffDisplay}</td>
            <td>${actionBtn}</td>
          </tr>
        `;
      }).join('');
    });

    tbody1.innerHTML = html1;
  }

  window._filteredMacsReadings = filtered1;
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
